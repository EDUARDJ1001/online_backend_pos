/**
 * Prueba del script para SQL Server Management Studio (crear_o_actualizar_sqlserver.sql).
 * Usa DB_* (SQL Server) y DB_NAME como nombre de una base que NO debe existir: el script
 * la crea. Lo ejecuta lote por lote (separados por GO) en una sola conexión, como SSMS.
 * La borra quien la llame (`npm run verificar`).
 *
 * Uso: DB_CLIENT=mssql DB_NAME=tmp_... npx tsx scripts/mssql-script-test.ts --confirm
 */
import fs from "fs";
import os from "os";
import path from "path";

import mssql from "mssql";

import { buildMssqlUpdateScript, MSSQL_DIR } from "./lib/mssql-update-script";

let failures = 0;
function ok(name: string, condition: boolean, detail = "") {
  if (!condition) failures += 1;
  console.log(`${condition ? "OK  " : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`);
}

async function main() {
  if (!process.argv.includes("--confirm") || process.env.DB_CLIENT !== "mssql") {
    throw new Error("Solo para una base SQL Server de prueba: DB_CLIENT=mssql y --confirm.");
  }
  const database = process.env.DB_NAME!;
  const [server, instanceName] = (process.env.DB_HOST ?? "localhost").split("\\");
  const pool = await new mssql.ConnectionPool({
    server: server!,
    port: instanceName ? undefined : Number(process.env.DB_PORT ?? 1433),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: "master",
    requestTimeout: 300000,
    // Una sola conexión: SET NOEXEC y USE duran entre lotes, igual que en SSMS.
    pool: { min: 1, max: 1 },
    options: { instanceName: instanceName || undefined, encrypt: process.env.DB_SSL_MODE === "REQUIRED", trustServerCertificate: process.env.DB_SSL_MODE !== "REQUIRED" }
  }).connect();

  /** Ejecuta el script como SSMS: lote por lote, sigue aunque uno falle; junta mensajes y errores. */
  const runScript = async (script: string) => {
    const messages: string[] = [];
    const errors: string[] = [];
    for (const batch of script.split(/^\s*GO\s*;?\s*$/gim)) {
      if (!batch.trim()) continue;
      const request = pool.request();
      request.on("info", (info: { message: string }) => messages.push(info.message));
      try {
        await request.batch(batch);
      } catch (error) {
        errors.push((error as Error).message);
      }
    }
    return { messages, errors, text: [...messages, ...errors].join("\n") };
  };
  const q = async <T = Record<string, unknown>>(sql: string) => (await pool.request().query<T>(`USE [${database}]; ${sql}`)).recordset;
  const footerLength = async () => Number((await q<{ n: number }>("SELECT max_length AS n FROM sys.columns WHERE object_id = OBJECT_ID('dbo.billing_settings') AND name = 'footer_text'"))[0]?.n);
  // Actualización que se puede revertir a mano para simular una base desactualizada (solo amplía una columna).
  const lastFile = "2026_10_01_000001_footer_text_long.sql";

  try {
    const script = buildMssqlUpdateScript(database);

    // 1) Sin base: la crea e instala todo.
    let run = await runScript(script);
    ok("crea la base e instala el sistema", run.errors.length === 0 && run.text.includes("Listo: la base está al día"), run.errors.join(" | "));
    const settings = (await q<{ collation: string; rcsi: boolean }>(
      `SELECT collation_name AS collation, is_read_committed_snapshot_on AS rcsi FROM sys.databases WHERE name = N'${database}'`
    ))[0];
    ok("base con intercalación española y lecturas sin bloqueo", settings?.collation === "Modern_Spanish_CI_AI" && Boolean(settings?.rcsi));

    // El programa la reconoce al día (mismas actualizaciones, ninguna desconocida).
    const { checkSchema } = await import("../src/modules/system/migrations.service");
    const status = await checkSchema(false);
    ok("el programa la ve al día", !status.empty && status.pending.length === 0 && status.unknown.length === 0, JSON.stringify(status.pending));

    // 2) Repetir no cambia nada.
    run = await runScript(script);
    ok("ejecutarlo otra vez no aplica nada", run.errors.length === 0 && !run.text.includes("Aplicada:") && run.text.includes("Listo"));

    // 3) Base desactualizada: aplica solo lo que falta.
    await q(`DELETE FROM dbo._migrations WHERE filename = N'${lastFile}'`);
    await q("ALTER TABLE dbo.billing_settings ALTER COLUMN footer_text NVARCHAR(255) NULL");
    run = await runScript(script);
    ok("base desactualizada: aplica solo lo que falta", run.errors.length === 0 && run.text.includes(`Aplicada: ${lastFile}`) && run.messages.filter((m) => m.startsWith("Aplicada:")).length === 1, run.errors.join(" | "));
    ok("pie de factura sin límite", (await footerLength()) === -1);

    // 4) Una actualización cuyos datos no caben: se detiene sin cambiar nada.
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "script-sqlserver-"));
    try {
      fs.cpSync(MSSQL_DIR, work, { recursive: true });
      fs.writeFileSync(
        path.join(work, "2099_01_01_000001_prueba_achica.sql"),
        "/* Objetivo: prueba. */\nALTER TABLE [dbo].[users] ALTER COLUMN [full_name] NVARCHAR(5) NOT NULL;\n"
      );
      run = await runScript(buildMssqlUpdateScript(database, work));
      const applied = await q("SELECT 1 AS x FROM dbo._migrations WHERE filename = N'2099_01_01_000001_prueba_achica.sql'");
      const width = Number((await q<{ n: number }>("SELECT max_length / 2 AS n FROM sys.columns WHERE object_id = OBJECT_ID('dbo.users') AND name = 'full_name'"))[0]?.n);
      ok("datos que no caben: se detiene y no cambia la columna", run.text.includes("no cabrían") && applied.length === 0 && width > 5 && run.text.includes("NO quedó al día"));
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }

    // 5) Base más nueva que el script: no toca nada.
    await q("INSERT INTO dbo._migrations (filename) VALUES (N'2099_12_31_000001_futura.sql')");
    run = await runScript(script);
    ok("base más nueva: avisa y no hace nada", run.text.includes("más nuevas que este script") && !run.text.includes("Aplicada:"));
    await q("DELETE FROM dbo._migrations WHERE filename = N'2099_12_31_000001_futura.sql'");

    // 6) Base con tablas ajenas: no la toca.
    const foreign = `${database}_ajena`;
    await pool.request().batch(`CREATE DATABASE [${foreign}]`);
    try {
      await pool.request().batch(`USE [${foreign}]; CREATE TABLE dbo.otra (id INT)`);
      run = await runScript(buildMssqlUpdateScript(foreign));
      const tables = (await pool.request().query<{ n: number }>(`USE [${foreign}]; SELECT COUNT(*) AS n FROM sys.tables`)).recordset[0]?.n;
      ok("base con tablas ajenas: no la toca", run.text.includes("no son del sistema") && Number(tables) === 1);
    } finally {
      await pool.request().batch(`USE master; ALTER DATABASE [${foreign}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${foreign}];`);
    }
  } finally {
    await pool.request().batch("USE master").catch(() => undefined);
    await pool.close().catch(() => undefined);
    const { dbPool } = await import("../src/config/db");
    await dbPool.end().catch(() => undefined);
  }

  console.log(failures === 0 ? "\nScript de SQL Server correcto." : `\n${failures} pasos fallaron.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`FAIL ${(error as Error).message}`);
  process.exit(1);
});
