/**
 * Prueba del usuario limitado de las cajas, en la base configurada (debe ser una base
 * TEMPORAL vacía y el usuario configurado, administrador). Instala el sistema, crea un
 * usuario de caja temporal con el script generado, revisa qué puede y qué no, y lo borra.
 *
 * Uso (lo corre npm run verificar): npx tsx scripts/caja-user-test.ts --confirm
 */
import crypto from "crypto";

import { currentDbSettings, openTestConnection, runSqlScript, type DbStandaloneConnection } from "../src/config/db";
import { checkSchema } from "../src/modules/system/migrations.service";
import { buildMssqlCajaUser, buildMysqlCajaUser } from "./lib/caja-user-sql";

let failures = 0;
function report(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures += 1;
}

async function allowed(connection: DbStandaloneConnection, sql: string) {
  try {
    await connection.query(sql);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!process.argv.includes("--confirm")) throw new Error("Solo en una base temporal: agrega --confirm.");
  const settings = currentDbSettings();
  const status = await checkSchema(true);
  if (status.empty || status.pending.length) throw new Error("No se pudo preparar la base.");

  const user = `tmp_caja_${Date.now() % 1_000_000}`;
  const password = `Caja-${crypto.randomBytes(9).toString("base64url")}9a`;
  const mssql = settings.client === "mssql";
  const script = (mssql ? buildMssqlCajaUser() : buildMysqlCajaUser()).replace(/NOMBRE_BASE/g, settings.database).replace(/USUARIO_CAJA/g, user).replace(/CONTRASENA_CAJA/g, password);

  const admin = await openTestConnection(settings, { multipleStatements: true });
  let caja: DbStandaloneConnection | null = null;
  try {
    try {
      await runSqlScript(admin, script, settings.client);
    } catch (error) {
      // MariaDB con la tabla interna de usuarios dañada: no se puede probar en este servidor.
      if (/Aria|wrong checksum|is marked as crashed|corrupt/i.test((error as Error).message)) {
        console.log(`AVISO este servidor no permite crear usuarios (${(error as Error).message.slice(0, 80)})`);
        return;
      }
      throw error;
    }
    report("crear el usuario de caja con el script", true);
    caja = await openTestConnection({ ...settings, user, password });

    const code = `T${Date.now() % 100_000_000_000}`.slice(0, 12);
    report("leer datos del sistema", await allowed(caja, "SELECT COUNT(*) AS total FROM companies"));
    report("cambiar datos del sistema", await allowed(caja, "UPDATE companies SET phone = phone WHERE 1 = 0"));
    report("leer licencias y anulaciones", (await allowed(caja, "SELECT COUNT(*) AS total FROM system_licenses")) && (await allowed(caja, "SELECT COUNT(*) AS total FROM license_revocations")));
    report("leer el control de actualizaciones", await allowed(caja, "SELECT COUNT(*) AS total FROM _migrations"));
    report("registrar su equipo", await allowed(caja, `INSERT INTO license_devices (machine_code, machine_name) VALUES ('${code}', 'prueba')`));
    report("actualizar su equipo", await allowed(caja, `UPDATE license_devices SET machine_name = 'prueba2' WHERE machine_code = '${code}'`));
    report("NO puede escribir licencias", !(await allowed(caja, "INSERT INTO system_licenses (license_text, license_id, equipos, emitida) VALUES ('x', 'x', 1, '2026-01-01')")));
    report("NO puede borrar anulaciones", !(await allowed(caja, "DELETE FROM license_revocations")));
    report("NO puede borrar equipos registrados", !(await allowed(caja, `DELETE FROM license_devices WHERE machine_code = '${code}'`)));
    report("NO puede tocar el control de actualizaciones", !(await allowed(caja, "DELETE FROM _migrations")));
    report("NO puede cambiar la estructura", !(await allowed(caja, "CREATE TABLE tmp_prueba_caja (id INT)")));
  } finally {
    await caja?.end().catch(() => undefined);
    await admin
      .query(mssql ? `IF USER_ID(N'${user}') IS NOT NULL DROP USER [${user}]` : `DROP USER IF EXISTS '${user}'@'%'`)
      .catch(() => undefined);
    if (mssql) await admin.query(`IF SUSER_ID(N'${user}') IS NOT NULL DROP LOGIN [${user}]`).catch(() => undefined);
    await admin.end().catch(() => undefined);
  }
}

main()
  .catch((error) => {
    failures += 1;
    console.log(`FAIL ${(error as Error).message}`);
  })
  .finally(() => process.exit(failures === 0 ? 0 : 1));
