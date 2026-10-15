/**
 * Regenera todos los archivos de base de datos del proyecto después de agregar una
 * migración, sin tocar ninguna base real:
 *
 *   1. Crea una base temporal en el MariaDB/MySQL local de .env.verificar (MARIADB_*),
 *      le instala el sistema y aplica todas las migraciones.
 *   2. Genera desde ella las instalaciones completas (MySQL y SQL Server).
 *   3. Regenera el script de SSMS, los del usuario de caja y los de base nueva
 *      (instaladores/base-de-datos).
 *   4. Borra la base temporal.
 *
 * Antes: npm run db:esquema --workspace backend (estructura esperada).
 * Uso: npm run db:regenerar --workspace backend
 */
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

import dotenv from "dotenv";
import mysql from "mysql2/promise";

const BACKEND = path.resolve(__dirname, "..");
const ROOT = path.resolve(BACKEND, "../..");
const TSX = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");

function engine() {
  const file = path.join(ROOT, ".env.verificar");
  if (!fs.existsSync(file)) throw new Error("Falta .env.verificar con MARIADB_HOST (ver .env.verificar.example).");
  const values = dotenv.parse(fs.readFileSync(file));
  if (!values.MARIADB_HOST) throw new Error("En .env.verificar falta MARIADB_HOST (el MariaDB/MySQL local para la base temporal).");
  return { host: values.MARIADB_HOST, port: Number(values.MARIADB_PORT || 3306), user: values.MARIADB_USER ?? "", password: values.MARIADB_PASSWORD ?? "" };
}

function run(script: string, env: NodeJS.ProcessEnv = process.env, args: string[] = []) {
  const result = spawnSync(process.execPath, [TSX, script, ...args], { cwd: BACKEND, env, encoding: "utf8" });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  if (result.status !== 0) throw new Error(`${script} falló:\n${output.split("\n").slice(-8).join("\n")}`);
  return output;
}

async function main() {
  const server = engine();
  const database = `tmp_verificar_${Date.now()}`;
  const base: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) if (!key.startsWith("DB_") && key !== "FACTURACION_ENV_FILE") base[key] = value;
  const env = { ...base, DB_CLIENT: "mysql", DB_HOST: server.host, DB_PORT: String(server.port), DB_USER: server.user, DB_PASSWORD: server.password, DB_NAME: database, DB_SSL_MODE: "DISABLED", DB_SSL_CA_PATH: "", DB_AUTO_MIGRATE: "false" };

  const admin = await mysql.createConnection({ host: server.host, port: server.port, user: server.user, password: server.password });
  await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  console.log("1. Base temporal con todas las migraciones...");
  try {
    const prepare = path.join(BACKEND, "scripts", "_preparar-temporal.ts");
    fs.writeFileSync(
      prepare,
      'import { checkSchema } from "../src/modules/system/migrations.service";\n' +
        "checkSchema(true).then((s) => process.exit(s.empty || s.pending.length || s.unknown.length ? 1 : 0), (e) => { console.error(e.message); process.exit(1); });\n"
    );
    try {
      run(prepare, env);
    } finally {
      fs.rmSync(prepare, { force: true });
    }
    console.log("2. Instalaciones completas...");
    console.log(`   ${run("scripts/generate-install-sql.ts", env).split("\n").pop()}`);
    console.log(`   ${run("scripts/generate-mssql-sql.ts", env).split("\n").filter(Boolean).slice(-2).join(" ")}`);
  } finally {
    await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await admin.end();
  }
  console.log("3. Script de SSMS, usuario de caja y base nueva...");
  run("scripts/generate-mssql-update-script.ts");
  run("scripts/generate-caja-user-sql.ts");
  run("scripts/generate-new-db-scripts.ts");
  console.log("\nListo. Revisa con: npm run verificar");
}

main().catch((error) => {
  console.error(`No se regeneró: ${(error as Error).message}`);
  process.exitCode = 1;
});
