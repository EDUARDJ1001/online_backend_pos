/**
 * Red de seguridad antes de entregar cambios:
 *   1. Tipos de backend, pantallas y agente de impresión (tsc).
 *   2. Validaciones vigentes (scripts/validation-test.ts).
 *   3. Migraciones: cada una existe para ambos motores y las instalaciones están al día.
 *   4. Por cada motor de `.env.verificar`: crea una base temporal, la prepara como
 *      el programa (instalación + migraciones), corre el flujo completo
 *      (scripts/flow-test.ts) y, con --medir, la medición (scripts/medir.ts).
 *      La base temporal se borra siempre al terminar.
 *
 * Uso: npm run verificar [-- --medir] [-- --motor=mariadb,mssql] [-- --sin-tipos] [-- --detalle]
 *
 * Este script no importa src/: así no abre el pool de la base configurada en .env.
 */
import { spawn } from "child_process";
import fs from "fs";
import path from "path";

import dotenv from "dotenv";
import mssql from "mssql";
import mysql from "mysql2/promise";

import { readMigrationInfo, staticProblems } from "../src/modules/system/migration-safety";
import { buildMssqlCajaUser, buildMysqlCajaUser, CAJA_USER_FILES } from "./lib/caja-user-sql";
import { flagValue, hasFlag } from "./lib/cli-args";
import { buildMssqlUpdateScript, MSSQL_SCRIPT_FILE } from "./lib/mssql-update-script";

const ROOT = path.resolve(__dirname, "../../..");
const BACKEND = path.resolve(__dirname, "..");
const CONFIG_FILE = path.join(ROOT, ".env.verificar");
/** Solo se crean y borran bases con este nombre. */
const TEMP_PREFIX = "tmp_verificar_";
const TEMP_NAME = /^tmp_verificar_\d+$/;

const withMeasure = hasFlag("medir");
const skipTypes = hasFlag("sin-tipos");
const showSteps = hasFlag("detalle");
// Guarda esquema.json desde las bases temporales (MariaDB para MySQL, SQL Server) en vez de compararlo.
const saveSchema = hasFlag("actualizar-esquema");
const engineFilter = flagValue("motor")?.split(",");

type EngineName = "mariadb" | "mssql" | "mysql8";

interface Engine {
  name: EngineName;
  label: string;
  client: "mysql" | "mssql";
  host: string;
  port: number;
  user: string;
  password: string;
  sslMode: "DISABLED" | "REQUIRED";
  sslCaPath: string;
}

const ENGINES: Array<{ name: EngineName; label: string; client: "mysql" | "mssql"; port: number }> = [
  { name: "mariadb", label: "MariaDB (local)", client: "mysql", port: 3306 },
  { name: "mssql", label: "SQL Server", client: "mssql", port: 1433 },
  { name: "mysql8", label: "MySQL 8 (nube)", client: "mysql", port: 3306 }
];

let failures = 0;
const summary: string[] = [];

function line(status: "OK" | "FAIL" | "AVISO", text: string) {
  if (status === "FAIL") failures += 1;
  const message = `${status.padEnd(5)} ${text}`;
  console.log(message);
  summary.push(message);
}

function run(command: string, commandArgs: string[], options: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs?: number }) {
  return new Promise<{ code: number; output: string; ms: number }>((resolve) => {
    const started = Date.now();
    const child = spawn(command, commandArgs, { cwd: options.cwd, env: options.env ?? process.env, shell: true });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    const timer = setTimeout(() => child.kill(), options.timeoutMs ?? 15 * 60_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, output, ms: Date.now() - started });
    });
  });
}

function seconds(ms: number) {
  return `${(ms / 1000).toFixed(1)} s`;
}

// ------------------------------------------------------------------ 1-2. Tipos y validaciones

async function checkTypes() {
  const projects = [
    ["backend", "apps/backend/tsconfig.json"],
    ["pantallas", "apps/frontend/tsconfig.json"],
    ["agente de impresión", "apps/print-agent/tsconfig.json"]
  ];
  const results = await Promise.all(projects.map(([, project]) => run("npx", ["tsc", "--noEmit", "-p", project!], { cwd: ROOT })));
  results.forEach((result, index) => {
    const errors = result.output.split("\n").filter((text) => /error TS\d+/.test(text));
    if (result.code === 0) {
      line("OK", `tipos de ${projects[index]![0]} (${seconds(result.ms)})`);
    } else {
      line("FAIL", `tipos de ${projects[index]![0]}: ${errors.length} errores`);
      errors.slice(0, 10).forEach((text) => console.log(`      ${text.trim()}`));
    }
  });
}

async function checkValidations() {
  for (const script of ["scripts/validation-test.ts", "scripts/licencia-test.ts"]) {
    await checkScript(script);
  }
}

async function checkScript(script: string) {
  const result = await run("npx", ["tsx", script], { cwd: BACKEND });
  const last = result.output.trim().split("\n").pop() ?? "";
  if (result.code === 0) {
    line("OK", last);
  } else {
    line("FAIL", last);
    result.output.split("\n").filter((text) => text.startsWith("FAIL")).forEach((text) => console.log(`      ${text}`));
  }
}

// ------------------------------------------------------------------ 3. Migraciones

function checkMigrations() {
  const list = (folder: string) => fs.readdirSync(path.join(ROOT, folder)).filter((file) => file.endsWith(".sql")).sort();
  const included = (file: string) => new Set([...fs.readFileSync(path.join(ROOT, file), "utf8").matchAll(/@incluye\s+(\S+\.sql)/g)].map((match) => match[1]!));
  const mysqlFiles = list("migrations");
  const mssqlFiles = list("migrations-mssql");
  const mysqlInstall = included("migrations/base/instalacion_completa.sql");
  const mssqlInstall = included("migrations-mssql/base/instalacion_sqlserver.sql");

  let ok = true;
  for (const file of mssqlFiles.filter((name) => !mysqlFiles.includes(name))) {
    ok = false;
    line("FAIL", `migración ${file}: existe para SQL Server pero no para MySQL`);
  }
  for (const file of mysqlFiles.filter((name) => !mssqlFiles.includes(name) && !mssqlInstall.has(name))) {
    ok = false;
    line("FAIL", `migración ${file}: falta la versión para SQL Server (migrations-mssql/)`);
  }
  const staleMysql = mysqlFiles.filter((name) => !mysqlInstall.has(name));
  const staleMssql = mssqlFiles.filter((name) => !mssqlInstall.has(name));
  if (staleMysql.length) line("AVISO", `instalación MySQL sin ${staleMysql.join(", ")} (regenerar con npm run db:install-sql)`);
  if (staleMssql.length) line("AVISO", `instalación SQL Server sin ${staleMssql.join(", ")} (regenerar con npm run db:mssql-sql)`);
  if (ok) line("OK", `migraciones: ${mysqlFiles.length} MySQL, ${mssqlFiles.length} SQL Server, todas con su par`);

  // Ninguna migración debe borrar datos ni cambiarlos sin declararlo (migration-safety).
  const unsafe: string[] = [];
  for (const [folder, files] of [["migrations", mysqlFiles], ["migrations-mssql", mssqlFiles]] as const) {
    for (const file of files) {
      const problems = staticProblems(readMigrationInfo(path.join(ROOT, folder), file));
      if (problems.length) unsafe.push(`${folder}/${file}: ${problems.join("; ")}`);
    }
  }
  if (unsafe.length) {
    unsafe.forEach((text) => line("FAIL", `migración que no se aplicaría sola: ${text}`));
  } else {
    line("OK", "migraciones: solo cambian estructura (ninguna modifica ni borra datos existentes)");
  }

  // El script para SSMS debe traer todas las migraciones actuales.
  try {
    const current = fs.existsSync(MSSQL_SCRIPT_FILE) ? fs.readFileSync(MSSQL_SCRIPT_FILE, "utf8") : "";
    if (current === buildMssqlUpdateScript()) {
      line("OK", "script de SQL Server (crear o actualizar) al día");
    } else {
      line("FAIL", "script de SQL Server desactualizado: npm run db:script-sqlserver");
    }
  } catch (error) {
    line("FAIL", `script de SQL Server: ${(error as Error).message}`);
  }

  // Los scripts del usuario limitado de las cajas deben traer todas las tablas actuales.
  const current = (file: string) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "");
  if (current(CAJA_USER_FILES.mysql) === buildMysqlCajaUser() && current(CAJA_USER_FILES.mssql) === buildMssqlCajaUser()) {
    line("OK", "scripts del usuario de caja al día");
  } else {
    line("FAIL", "scripts del usuario de caja desactualizados: npm run db:usuario-caja --workspace backend");
  }
}

// ------------------------------------------------------------------ 4. Motores

function loadEngines(): Engine[] {
  if (!fs.existsSync(CONFIG_FILE)) {
    line("AVISO", "no existe .env.verificar: se omiten las pruebas con base de datos (ver .env.verificar.example)");
    return [];
  }
  const values = dotenv.parse(fs.readFileSync(CONFIG_FILE));
  const engines: Engine[] = [];
  for (const engine of ENGINES) {
    const prefix = engine.name.toUpperCase();
    const host = values[`${prefix}_HOST`];
    if (!host || (engineFilter && !engineFilter.includes(engine.name))) continue;
    const caPath = values[`${prefix}_SSL_CA_PATH`] ?? "";
    engines.push({
      ...engine,
      host,
      port: Number(values[`${prefix}_PORT`] || engine.port),
      user: values[`${prefix}_USER`] ?? "",
      password: values[`${prefix}_PASSWORD`] ?? "",
      sslMode: values[`${prefix}_SSL_MODE`] === "REQUIRED" ? "REQUIRED" : "DISABLED",
      sslCaPath: caPath ? path.resolve(ROOT, caPath) : ""
    });
  }
  return engines;
}

interface Admin {
  create(name: string): Promise<void>;
  drop(name: string): Promise<void>;
  leftovers(): Promise<string[]>;
  close(): Promise<void>;
}

async function connectAdmin(engine: Engine): Promise<Admin> {
  if (engine.client === "mssql") {
    const [server, instanceName] = engine.host.split("\\");
    const pool = await new mssql.ConnectionPool({
      server: server!,
      port: instanceName ? undefined : engine.port,
      user: engine.user,
      password: engine.password,
      database: "master",
      connectionTimeout: 10000,
      requestTimeout: 120000,
      options: { instanceName: instanceName || undefined, encrypt: engine.sslMode === "REQUIRED", trustServerCertificate: engine.sslMode !== "REQUIRED" }
    }).connect();
    return {
      create: async (name) => void (await pool.request().batch(`CREATE DATABASE [${name}]`)),
      drop: async (name) =>
        void (await pool.request().batch(`IF DB_ID('${name}') IS NOT NULL BEGIN ALTER DATABASE [${name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${name}]; END`)),
      leftovers: async () => (await pool.request().query(`SELECT name FROM sys.databases WHERE name LIKE '${TEMP_PREFIX}%'`)).recordset.map((row) => String(row.name)),
      close: () => pool.close()
    };
  }
  const connection = await mysql.createConnection({
    host: engine.host,
    port: engine.port,
    user: engine.user,
    password: engine.password,
    connectTimeout: 10000,
    ssl:
      engine.sslMode === "REQUIRED"
        ? engine.sslCaPath
          ? { ca: fs.readFileSync(engine.sslCaPath, "utf8"), rejectUnauthorized: true }
          : { rejectUnauthorized: true }
        : undefined
  });
  return {
    create: async (name) => void (await connection.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)),
    drop: async (name) => void (await connection.query(`DROP DATABASE IF EXISTS \`${name}\``)),
    leftovers: async () => {
      const [rows] = await connection.query(`SHOW DATABASES LIKE '${TEMP_PREFIX}%'`);
      return (rows as Array<Record<string, string>>).map((row) => Object.values(row)[0]!);
    },
    close: () => connection.end()
  };
}

function childEnv(engine: Engine, database: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith("DB_") && key !== "FACTURACION_ENV_FILE") env[key] = value;
  }
  return {
    ...env,
    DB_CLIENT: engine.client,
    DB_HOST: engine.host,
    DB_PORT: String(engine.port),
    DB_USER: engine.user,
    DB_PASSWORD: engine.password,
    DB_NAME: database,
    DB_SSL_MODE: engine.sslMode,
    DB_SSL_CA_PATH: engine.sslCaPath,
    DB_AUTO_MIGRATE: "true"
  };
}

interface EngineResult {
  engine: Engine;
  log: string[];
  failed: boolean;
  measure?: { results: Array<{ operation: string; queries: number; ms: number }> };
}

async function verifyEngine(engine: Engine): Promise<EngineResult> {
  const log: string[] = [];
  const result: EngineResult = { engine, log, failed: false };
  const fail = (text: string) => {
    result.failed = true;
    log.push(`FAIL  ${engine.label}: ${text}`);
  };
  const database = `${TEMP_PREFIX}${Date.now()}`;
  let admin: Admin | null = null;

  try {
    admin = await connectAdmin(engine);
  } catch (error) {
    fail(`no se pudo conectar (${(error as Error).message})`);
    return result;
  }

  try {
    for (const old of (await admin.leftovers()).filter((name) => TEMP_NAME.test(name))) {
      await admin.drop(old);
    }
    await admin.create(database);

    const flow = await run("npx", ["tsx", "scripts/flow-test.ts", "--confirm", "--instalar"], { cwd: BACKEND, env: childEnv(engine, database) });
    const steps = flow.output.split("\n");
    const ok = steps.filter((text) => text.startsWith("OK")).length;
    const failed = steps.filter((text) => text.startsWith("FAIL"));
    if (showSteps) {
      steps.filter((text) => /^(OK|FAIL)/.test(text)).forEach((text) => log.push(`        ${text.trim().slice(0, 200)}`));
    }
    if (flow.code === 0 && failed.length === 0) {
      log.push(`OK    ${engine.label}: flujo completo, ${ok} pasos (${seconds(flow.ms)})`);
    } else {
      fail(`flujo con ${failed.length} fallas de ${ok + failed.length} pasos`);
      (failed.length ? failed : steps.slice(-15)).forEach((text) => log.push(`        ${text.trim().slice(0, 200)}`));
    }

    // Estructura de la base recién preparada contra esquema.json (lo que revisa Sistema > Base de datos).
    if (!result.failed) {
      const mode = saveSchema && engine.name !== "mysql8" ? "--guardar" : "--comparar";
      const schema = await run("npx", ["tsx", "scripts/esquema.ts", mode], { cwd: BACKEND, env: childEnv(engine, database) });
      const lines = schema.output.split("\n").filter((text) => /^(OK|FAIL)/.test(text));
      if (schema.code === 0 && !lines.some((text) => text.startsWith("FAIL"))) {
        log.push(`OK    ${engine.label}: ${lines.at(-1)?.replace(/^OK\s+/, "") ?? "estructura"}`);
      } else {
        fail("estructura distinta a esquema.json");
        (lines.length ? lines : schema.output.split("\n").slice(-10)).slice(0, 20).forEach((text) => log.push(`        ${text.trim().slice(0, 200)}`));
      }
    }

    if (withMeasure && !result.failed) {
      const measured = await run("npx", ["tsx", "scripts/medir.ts", "--confirm", "--json"], { cwd: BACKEND, env: childEnv(engine, database) });
      const json = measured.output.split("\n").find((text) => text.startsWith("MEDICION "));
      if (measured.code === 0 && json) {
        result.measure = JSON.parse(json.slice("MEDICION ".length));
        log.push(`OK    ${engine.label}: medición (${seconds(measured.ms)})`);
      } else {
        fail("medición");
        measured.output.split("\n").slice(-10).forEach((text) => log.push(`        ${text.trim().slice(0, 200)}`));
      }
    }
    // Protección de las actualizaciones de la base, en otra base temporal vacía.
    const safetyDb = `${TEMP_PREFIX}${Date.now()}1`;
    await admin.create(safetyDb);
    try {
      const safety = await run("npx", ["tsx", "scripts/migration-safety-test.ts", "--confirm"], { cwd: BACKEND, env: childEnv(engine, safetyDb) });
      const lines = safety.output.split("\n");
      const failed = lines.filter((text) => text.startsWith("FAIL"));
      if (showSteps) lines.filter((text) => /^(OK|FAIL)/.test(text)).forEach((text) => log.push(`        ${text.trim().slice(0, 200)}`));
      if (safety.code === 0 && failed.length === 0) {
        log.push(`OK    ${engine.label}: protección de actualizaciones, ${lines.filter((text) => text.startsWith("OK")).length} pasos`);
      } else {
        fail(`protección de actualizaciones con ${failed.length} fallas`);
        (failed.length ? failed : lines.slice(-10)).forEach((text) => log.push(`        ${text.trim().slice(0, 200)}`));
      }
    } finally {
      await admin.drop(safetyDb);
    }

    // Usuario limitado de las cajas: crea y borra un usuario temporal.
    {
      const cajaDb = `${TEMP_PREFIX}${Date.now()}3`;
      await admin.create(cajaDb);
      try {
        const tested = await run("npx", ["tsx", "scripts/caja-user-test.ts", "--confirm"], { cwd: BACKEND, env: childEnv(engine, cajaDb) });
        const lines = tested.output.split("\n");
        const failed = lines.filter((text) => text.startsWith("FAIL"));
        if (showSteps) lines.filter((text) => /^(OK|FAIL)/.test(text)).forEach((text) => log.push(`        ${text.trim().slice(0, 200)}`));
        const warning = lines.find((text) => text.startsWith("AVISO"));
        if (warning && tested.code === 0) {
          log.push(`AVISO ${engine.label}: usuario limitado de caja sin probar: ${warning.slice(6)}`);
        } else if (tested.code === 0 && failed.length === 0) {
          log.push(`OK    ${engine.label}: usuario limitado de caja, ${lines.filter((text) => text.startsWith("OK")).length} pasos`);
        } else {
          fail(`usuario limitado de caja con ${failed.length} fallas`);
          (failed.length ? failed : lines.slice(-10)).forEach((text) => log.push(`        ${text.trim().slice(0, 200)}`));
        }
      } finally {
        await admin.drop(cajaDb);
      }
    }

    // Script para SSMS: crea su propia base temporal y la prueba completa.
    if (engine.client === "mssql") {
      const scriptDb = `${TEMP_PREFIX}${Date.now()}2`;
      try {
        const tested = await run("npx", ["tsx", "scripts/mssql-script-test.ts", "--confirm"], { cwd: BACKEND, env: childEnv(engine, scriptDb) });
        const lines = tested.output.split("\n");
        const failed = lines.filter((text) => text.startsWith("FAIL"));
        if (showSteps) lines.filter((text) => /^(OK|FAIL)/.test(text)).forEach((text) => log.push(`        ${text.trim().slice(0, 200)}`));
        if (tested.code === 0 && failed.length === 0) {
          log.push(`OK    ${engine.label}: script crear o actualizar, ${lines.filter((text) => text.startsWith("OK")).length} pasos`);
        } else {
          fail(`script crear o actualizar con ${failed.length} fallas`);
          (failed.length ? failed : lines.slice(-10)).forEach((text) => log.push(`        ${text.trim().slice(0, 200)}`));
        }
      } finally {
        await admin.drop(scriptDb);
        await admin.drop(`${scriptDb}_ajena`);
      }
    }
  } catch (error) {
    fail((error as Error).message);
  } finally {
    try {
      await admin.drop(database);
    } catch (error) {
      fail(`no se pudo borrar la base temporal ${database} (${(error as Error).message})`);
    }
    await admin.close().catch(() => undefined);
  }
  return result;
}

function printMeasures(results: EngineResult[]) {
  const measured = results.filter((result) => result.measure);
  if (!measured.length) return;
  const operations = measured[0]!.measure!.results.map((row) => row.operation);
  const header = `| Operación | ${measured.map((result) => `${result.engine.label}: viajes · ms`).join(" | ")} |`;
  console.log(`\nMedición (mediana de 3 vueltas):\n\n${header}\n|---|${measured.map(() => "---|").join("")}`);
  for (const operation of operations) {
    const cells = measured.map((result) => {
      const row = result.measure!.results.find((item) => item.operation === operation);
      return row ? `${row.queries} · ${row.ms}` : "";
    });
    console.log(`| ${operation} | ${cells.join(" | ")} |`);
  }
}

async function main() {
  const started = Date.now();
  console.log("Verificación del sistema\n");

  if (!skipTypes) await checkTypes();
  await checkValidations();
  checkMigrations();

  const engines = loadEngines();
  if (engines.length) {
    console.log(`\nMotores: ${engines.map((engine) => engine.label).join(", ")} (en paralelo)...`);
    const results = await Promise.all(engines.map(verifyEngine));
    for (const result of results) {
      for (const text of result.log) {
        console.log(text);
        if (/^(OK|FAIL)/.test(text)) summary.push(text);
      }
      if (result.failed) failures += 1;
    }
    printMeasures(results);
  }

  console.log(failures === 0 ? `\nTodo correcto (${seconds(Date.now() - started)}).` : `\n${failures} verificaciones fallaron (${seconds(Date.now() - started)}).`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
