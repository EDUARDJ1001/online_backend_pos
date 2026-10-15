/**
 * Prueba de la protección de las actualizaciones de la base (migration-safety).
 * Necesita una base VACÍA (la usa `npm run verificar`): instala el sistema y comprueba
 * que no se aplica nada que pueda perder datos.
 *
 * Uso: npm run db:prueba-actualizaciones --workspace backend -- --confirm
 */
import fs from "fs";
import os from "os";
import path from "path";

const ALIGN = "2026_09_30_000001_align_schema.sql";
let failures = 0;

function ok(name: string, condition: boolean, detail = "") {
  if (!condition) failures += 1;
  console.log(`${condition ? "OK  " : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`);
}

async function main() {
  if (!process.argv.includes("--confirm")) {
    throw new Error("Esta prueba escribe en la base. Úsala solo con una base vacía de prueba y --confirm.");
  }

  // Copia de las migraciones para agregar migraciones de prueba sin tocar las reales.
  const root = path.resolve(__dirname, "../../..");
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "migraciones-prueba-"));
  for (const folder of ["migrations", "migrations-mssql"]) {
    fs.cpSync(path.join(root, folder), path.join(work, folder), { recursive: true });
  }
  process.env.MIGRATIONS_DIR = path.join(work, "migrations");

  const { dbPool, isMssql } = await import("../src/config/db");
  const { checkSchema, migrationsDir, schemaBlockMessage, unavailableFeatureForPath } = await import("../src/modules/system/migrations.service");
  const { companiesService } = await import("../src/modules/companies/companies.service");
  const mssql = isMssql();
  const q = <T = Array<Record<string, unknown>>>(sql: string, params: unknown[] = []) => dbPool.query<T>(sql, params).then(([rows]) => rows);
  const count = async (table: string) => Number(((await q<Array<{ n: number }>>(`SELECT COUNT(*) AS n FROM ${table}`))[0] ?? { n: -1 }).n);
  const docLength = async () =>
    Number(
      (
        await q<Array<{ n: number }>>(
          mssql
            ? "SELECT max_length / 2 AS n FROM sys.columns WHERE object_id = OBJECT_ID('dbo.inventory_entries') AND name = 'document_number'"
            : "SELECT character_maximum_length AS n FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'inventory_entries' AND column_name = 'document_number'"
        )
      )[0]?.n ?? 0
    );
  const extraFile = (name: string, sql: string) => fs.writeFileSync(path.join(migrationsDir()!, name), sql);

  try {
    let status = await checkSchema(true);
    ok("instala la base vacía", !status.empty && status.pending.length === 0);

    // Datos: empresa (con bodega) y una entrada con número de documento largo.
    const [user] = await q<Array<{ id: number }>>("SELECT id FROM users WHERE username = 'superadmin'");
    const company = await companiesService.createCompany(user!.id, { commercialName: "Prueba", legalName: "Prueba S. de R.L.", rtn: "08019999000055" } as never);
    const [warehouse] = await q<Array<{ id: number }>>("SELECT id FROM warehouses WHERE company_id = ?", [company.id]);

    // La unificación de estructura queda "pendiente" y la columna más ancha de lo que pide.
    await q("DELETE FROM _migrations WHERE filename = ?", [ALIGN]);
    await q(
      mssql
        ? "ALTER TABLE [dbo].[inventory_entries] ALTER COLUMN [document_number] NVARCHAR(200) NULL"
        : "ALTER TABLE inventory_entries MODIFY COLUMN document_number VARCHAR(200) NULL DEFAULT NULL"
    );
    await q("INSERT INTO inventory_entries (company_id, warehouse_id, entry_date, document_number, status, created_by) VALUES (?, ?, ?, ?, 'APLICADA', ?)", [
      company.id,
      warehouse!.id,
      "2026-10-01",
      "X".repeat(120),
      user!.id
    ]);
    const entries = await count("inventory_entries");

    status = await checkSchema(true);
    const align = status.blocked.find((review) => review.file === ALIGN);
    ok("detiene la actualización si un dato no cabe", Boolean(align) && status.pending.includes(ALIGN), align?.problems.join("; "));
    ok("no cambió la estructura ni los datos", (await docLength()) === 200 && (await count("inventory_entries")) === entries);

    await q("UPDATE inventory_entries SET document_number = 'FAC-0001' WHERE company_id = ?", [company.id]);
    status = await checkSchema(true);
    ok("con el dato corregido la aplica", status.pending.length === 0 && status.blocked.length === 0, status.pending.join(", "));
    // MySQL deja la columna en 80; en SQL Server la migración solo agranda (nunca achica).
    const expectedLength = mssql ? 200 : 80;
    ok("la columna queda como define la actualización, sin perder filas", (await docLength()) === expectedLength && (await count("inventory_entries")) === entries, String(await docLength()));

    // Actualización que borra filas: no se aplica.
    const clients = await count("clients");
    extraFile("2099_01_01_000001_prueba_borrar.sql", "DELETE FROM clients;\n");
    status = await checkSchema(true);
    ok("detiene una actualización que borra filas", status.blocked.some((review) => review.problems.includes("elimina filas")) && (await count("clients")) === clients);
    fs.rmSync(path.join(migrationsDir()!, "2099_01_01_000001_prueba_borrar.sql"));

    // Cambia datos que ya existen (aunque lo declare): no se aplica.
    const names = async () => JSON.stringify(await q("SELECT id, name FROM clients ORDER BY id"));
    const namesBefore = await names();
    extraFile("2099_01_01_000002_prueba_cambio.sql", "-- @actualiza-datos: prueba\nUPDATE clients SET name = 'cambiado';\n");
    status = await checkSchema(true);
    ok("detiene un cambio de datos existentes", status.blocked.some((review) => review.problems.some((p) => p.includes("cambia datos que ya existen"))) && (await names()) === namesBefore);
    extraFile("2099_01_01_000002_prueba_cambio.sql", "-- @actualiza-datos: prueba\nINSERT INTO clients (company_id, code, name, created_by) VALUES (1, '99', 'x', 1);\n");
    status = await checkSchema(true);
    ok("detiene filas nuevas en una tabla que ya existe", status.blocked.some((review) => review.problems.some((p) => p.includes("agrega filas"))));

    // Llenar una columna nueva sin declararlo: no se aplica; declarado, sí, y los datos existentes quedan igual.
    const fill = mssql
      ? "ALTER TABLE [dbo].[clients] ADD [prueba_nueva] INT NULL;\nGO\nUPDATE c SET c.[prueba_nueva] = 1 FROM [dbo].[clients] c;\n"
      : "ALTER TABLE clients ADD COLUMN prueba_nueva INT NULL;\nUPDATE clients c SET c.prueba_nueva = 1;\n";
    extraFile("2099_01_01_000002_prueba_cambio.sql", fill);
    status = await checkSchema(true);
    ok("detiene llenar datos sin declararlo", status.blocked.some((review) => review.problems.some((p) => p.includes("no lo declara"))));
    extraFile("2099_01_01_000002_prueba_cambio.sql", `-- @actualiza-datos: prueba de columna nueva\n${fill}`);
    status = await checkSchema(true);
    const filled = await q<Array<{ n: number }>>("SELECT COUNT(*) AS n FROM clients WHERE prueba_nueva = 1");
    ok(
      "aplica el llenado de una columna nueva sin tocar lo demás",
      status.pending.length === 0 && status.blocked.length === 0 && Number(filled[0]?.n) === clients && (await names()) === namesBefore,
      status.blocked.map((review) => review.problems.join("; ")).join(" | ")
    );

    // Falta una actualización que declara su función: solo esa función queda desactivada.
    const optional = "2099_01_01_000003_prueba_funcion.sql";
    extraFile(optional, "-- @funcion: Prueba\n-- @rutas: /prueba\n-- @pantallas: /prueba\n/* Objetivo: prueba. */\nCREATE TABLE prueba_funcion (id INT);\n");
    status = await checkSchema(false);
    ok(
      "falta una función: el resto del sistema sigue y solo ella se desactiva",
      status.pending.includes(optional) && schemaBlockMessage() === null && unavailableFeatureForPath("/prueba/algo")?.name === "Prueba" && unavailableFeatureForPath("/invoices") === null
    );
    // Falta una actualización central (sin función declarada): se bloquea todo.
    const core = "2099_01_01_000004_prueba_central.sql";
    extraFile(core, "/* Objetivo: prueba. */\nCREATE TABLE prueba_central (id INT);\n");
    status = await checkSchema(false);
    ok("falta una actualización central: el sistema se bloquea", schemaBlockMessage() !== null);
    fs.rmSync(path.join(migrationsDir()!, optional));
    fs.rmSync(path.join(migrationsDir()!, core));
  } finally {
    await dbPool.end().catch(() => undefined);
    fs.rmSync(work, { recursive: true, force: true });
  }

  console.log(failures === 0 ? "\nProtección de actualizaciones correcta." : `\n${failures} pasos fallaron.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`FAIL ${(error as Error).message}`);
  process.exit(1);
});
