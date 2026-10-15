/**
 * Genera migrations/base/instalacion_completa.sql a partir de la base configurada
 * (que debe tener aplicadas todas las migraciones).
 *
 * El archivo resultante crea una base nueva desde cero con todo lo que usa el
 * sistema: tablas, vistas, catálogos (roles, permisos, versiones) y el primer
 * usuario administrador. No incluye empresas ni datos de operación.
 *
 * Uso: npm run db:install-sql --workspace backend
 */
import fs from "fs";
import path from "path";

import bcrypt from "bcryptjs";
import type { RowDataPacket } from "mysql2/promise";

import { dbPool } from "../src/config/db";
import { migrationFiles, migrationsDir } from "../src/modules/system/migrations.service";

/** Contraseña del primer usuario; se debe cambiar al entrar por primera vez. */
const INITIAL_ADMIN = { username: "superadmin", email: "superadmin@sistema.local", fullName: "Super Administrador", password: "Admin123!" };

/** Tablas cuyo contenido es catálogo del sistema (no datos de una empresa). */
const CATALOG_TABLES = ["roles", "role_permissions", "system_versions"];

/** Rutinas que existen en bases antiguas pero el programa ya no usa. */
const SKIP_ROUTINES = new Set(["sp_take_next_invoice_number"]);

type Row = RowDataPacket & Record<string, unknown>;

function sqlValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "NULL";
  }
  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  if (value instanceof Date) {
    return `'${value.toISOString().slice(0, 19).replace("T", " ")}'`;
  }
  return `'${String(value).replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
}

/** Orden de creación respetando llaves foráneas. */
function sortByDependencies(tables: string[], deps: Map<string, Set<string>>) {
  const sorted: string[] = [];
  const visiting = new Set<string>();
  const done = new Set<string>();
  const visit = (table: string) => {
    if (done.has(table) || visiting.has(table)) {
      return;
    }
    visiting.add(table);
    for (const dep of deps.get(table) ?? []) {
      if (dep !== table) {
        visit(dep);
      }
    }
    visiting.delete(table);
    done.add(table);
    sorted.push(table);
  };
  tables.forEach(visit);
  return sorted;
}

async function main() {
  const [dbRows] = await dbPool.query<Row[]>("SELECT DATABASE() AS db");
  const database = String(dbRows[0]!.db);

  const [applied] = await dbPool.query<Row[]>("SELECT filename FROM _migrations ORDER BY filename");
  const appliedNames = applied.map((row) => String(row.filename));
  const files = migrationFiles();
  const missing = files.filter((file) => !appliedNames.includes(file));
  if (missing.length > 0) {
    throw new Error(`La base no tiene aplicadas todas las migraciones: ${missing.join(", ")}`);
  }

  const [tableRows] = await dbPool.query<Row[]>(
    "SELECT table_name AS name, table_type AS type FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name"
  );
  const tables = tableRows.filter((row) => row.type === "BASE TABLE").map((row) => String(row.name));
  const views = tableRows.filter((row) => row.type === "VIEW").map((row) => String(row.name));

  const [fkRows] = await dbPool.query<Row[]>(
    `SELECT table_name AS tableName, referenced_table_name AS refTable
     FROM information_schema.key_column_usage
     WHERE table_schema = DATABASE() AND referenced_table_name IS NOT NULL`
  );
  const deps = new Map<string, Set<string>>();
  for (const row of fkRows) {
    const set = deps.get(String(row.tableName)) ?? new Set<string>();
    set.add(String(row.refTable));
    deps.set(String(row.tableName), set);
  }

  const out: string[] = [];
  out.push(
    "-- ============================================================",
    "-- Instalación completa: facturación multiempresa",
    `-- Generado: ${new Date().toISOString().slice(0, 10)} desde la base con todas las migraciones aplicadas.`,
    "-- Base: MySQL 8 / MariaDB 10.4+",
    "--",
    "-- Crea una base NUEVA desde cero con todo lo que usa el sistema:",
    "--   tablas, vista de impresión, roles, permisos por rol, versiones y el",
    "--   primer usuario administrador. No incluye empresas ni datos de operación.",
    "--",
    "-- Cómo usarla: crear una base vacía (utf8mb4) e importar este archivo en ella",
    "--   (mysql, phpMyAdmin, HeidiSQL...). No lleva USE: se instala en la base elegida.",
    "--   El sistema también la aplica solo sobre una base vacía (ver migrations.service).",
    "--",
    `-- Usuario inicial: ${INITIAL_ADMIN.username} / ${INITIAL_ADMIN.password}  (cambiar la contraseña al entrar).`,
    "--",
    "-- Las migraciones de abajo quedan registradas como aplicadas; las posteriores",
    "-- se aplican normalmente.",
    ...files.map((file) => `-- @incluye ${file}`),
    "-- ============================================================",
    "",
    "SET NAMES utf8mb4;",
    "SET FOREIGN_KEY_CHECKS = 0;",
    ""
  );

  out.push("-- ------------------------------------------------------------", "-- Tablas", "-- ------------------------------------------------------------", "");
  for (const table of sortByDependencies(tables, deps)) {
    const [[row]] = await dbPool.query<Row[]>(`SHOW CREATE TABLE \`${table}\``);
    const create = String(row!["Create Table"])
      .replace(/ AUTO_INCREMENT=\d+/, "")
      .replace(/^CREATE TABLE /, "CREATE TABLE IF NOT EXISTS ")
      // MariaDB muestra JSON como LONGTEXT + CHECK json_valid: se escribe JSON para que
      // MySQL 8 cree la columna nativa (en MariaDB JSON sigue siendo el mismo alias).
      .replace(/`(\w+)` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin (DEFAULT NULL |NOT NULL )?CHECK \(json_valid\(`\1`\)\)/g, "`$1` json $2")
      .replace(/ +,/g, ",");
    out.push(`${create};`, "");
  }

  out.push("-- ------------------------------------------------------------", "-- Vistas", "-- ------------------------------------------------------------", "");
  for (const view of views) {
    const [[row]] = await dbPool.query<Row[]>(`SHOW CREATE VIEW \`${view}\``);
    const create = String(row!["Create View"])
      .replace(/^CREATE .*?VIEW /, "CREATE OR REPLACE VIEW ")
      .split(`\`${database}\`.`)
      .join("");
    out.push(`${create};`, "");
  }

  const [routines] = await dbPool.query<Row[]>(
    "SELECT routine_name AS name FROM information_schema.routines WHERE routine_schema = DATABASE()"
  );
  const unexpected = routines.map((row) => String(row.name)).filter((name) => !SKIP_ROUTINES.has(name));
  if (unexpected.length > 0) {
    throw new Error(`Hay procedimientos/funciones no contemplados: ${unexpected.join(", ")}`);
  }

  out.push("-- ------------------------------------------------------------", "-- Catálogos del sistema", "-- ------------------------------------------------------------", "");
  for (const table of CATALOG_TABLES) {
    const [rows] = await dbPool.query<Row[]>(`SELECT * FROM \`${table}\``);
    if (rows.length === 0) {
      continue;
    }
    const columns = Object.keys(rows[0]!).filter((column) => !["created_at", "updated_at"].includes(column));
    out.push(`INSERT INTO \`${table}\` (${columns.map((c) => `\`${c}\``).join(", ")}) VALUES`);
    out.push(rows.map((row) => `  (${columns.map((c) => sqlValue(row[c])).join(", ")})`).join(",\n") + ";", "");
  }

  const [[role]] = await dbPool.query<Row[]>("SELECT id FROM roles WHERE nombre = 'SUPERADMIN' LIMIT 1");
  const hash = await bcrypt.hash(INITIAL_ADMIN.password, 10);
  out.push(
    "-- Primer usuario (SUPERADMIN).",
    "INSERT INTO `users` (`username`, `email`, `password_hash`, `full_name`, `role_id`, `is_active`) VALUES",
    `  (${sqlValue(INITIAL_ADMIN.username)}, ${sqlValue(INITIAL_ADMIN.email)}, ${sqlValue(hash)}, ${sqlValue(INITIAL_ADMIN.fullName)}, ${Number(role!.id)}, 1);`,
    ""
  );

  out.push("-- Migraciones incluidas en esta instalación.");
  out.push("INSERT INTO `_migrations` (`filename`) VALUES");
  out.push(files.map((file) => `  (${sqlValue(file)})`).join(",\n") + ";", "");

  out.push("SET FOREIGN_KEY_CHECKS = 1;", "", "-- Fin de la instalación.", "");

  const target = path.join(migrationsDir()!, "base", "instalacion_completa.sql");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, out.join("\n"), "utf8");
  console.log(`Generado ${target} (${tables.length} tablas, ${views.length} vistas, ${files.length} migraciones incluidas).`);
  await dbPool.end();
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await dbPool.end();
  process.exit(1);
});
