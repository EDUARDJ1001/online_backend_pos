/**
 * Genera migrations-mssql/base/instalacion_sqlserver.sql: la instalación completa
 * del sistema para SQL Server 2019+ y Azure SQL Database, convertida desde la base
 * MySQL/MariaDB configurada (que debe tener aplicadas todas las migraciones).
 *
 * Reglas de conversión (ver docs/migracion-sql-server.md):
 *   - Tipos: BIGINT/INT UNSIGNED -> BIGINT, TINYINT(1) -> TINYINT (0/1, igual que hoy),
 *     VARCHAR -> NVARCHAR, TEXT/LONGTEXT -> NVARCHAR(MAX), TIMESTAMP/DATETIME -> DATETIME2(0),
 *     ENUM -> NVARCHAR + CHECK, JSON (json_valid) -> NVARCHAR(MAX) + CHECK ISJSON.
 *   - Fechas: se guardan en UTC (DEFAULT SYSUTCDATETIME()). Azure SQL siempre usa UTC.
 *   - ON UPDATE CURRENT_TIMESTAMP no existe: el programa asigna updated_at en cada UPDATE.
 *   - Únicos sobre columnas que admiten NULL -> índice único filtrado (WHERE col IS NOT NULL).
 *   - Llaves foráneas: ON UPDATE NO ACTION (los id nunca cambian); ON DELETE en cascada
 *     solo donde el programa borra el registro padre y sin caminos múltiples de cascada.
 *   - Todas las restricciones con nombre fijo (PK_, FK, UQ, CK_, DF_) para poder
 *     modificarlas en migraciones futuras.
 *   - Un solo lote, sin GO: se ejecuta igual en SSMS, sqlcmd, Azure Data Studio o desde el programa.
 *
 * Uso: npm run db:mssql-sql --workspace backend
 */
import fs from "fs";
import path from "path";

import bcrypt from "bcryptjs";
import type { RowDataPacket } from "mysql2/promise";

import { dbPool } from "../src/config/db";
import { migrationFiles, migrationsDir } from "../src/modules/system/migrations.service";

const INITIAL_ADMIN = { username: "superadmin", email: "superadmin@sistema.local", fullName: "Super Administrador", password: "Admin123!" };
const CATALOG_TABLES = ["roles", "role_permissions", "system_versions"];

/** Tablas que el programa borra: sus hijos conservan el ON DELETE original. */
const DELETED_PARENTS = new Set(["cash_terminals", "cash_network_rules", "products", "product_codes", "product_stocks", "role_permissions", "user_company_access"]);

/** Columnas calculadas de MySQL que en SQL Server se resuelven con índices filtrados. */
const REPLACED_GENERATED: Record<string, { column: string; index: string; sql: string }> = {
  "cash_sessions.open_guard": {
    column: "open_guard",
    index: "uq_cash_sessions_open",
    // Una sola sesión ABIERTA por caja.
    sql: "CREATE UNIQUE INDEX [uq_cash_sessions_open] ON [dbo].[cash_sessions] ([cash_register_id]) WHERE [status] = N'ABIERTA';"
  }
};

type Row = RowDataPacket & Record<string, unknown>;

interface Column {
  table: string;
  name: string;
  columnType: string;
  dataType: string;
  nullable: boolean;
  defaultValue: string | null;
  extra: string;
  maxLength: number | null;
  generation: string | null;
}

const q = (name: string) => `[${name.replace(/]/g, "]]")}]`;
const nstr = (value: string) => `N'${value.replace(/'/g, "''")}'`;

function sqlValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "NULL";
  }
  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  return nstr(String(value));
}

function enumValues(columnType: string) {
  return [...columnType.matchAll(/'((?:[^']|'')*)'/g)].map((match) => match[1]!.replace(/''/g, "'"));
}

function mapType(column: Column): string {
  const type = column.columnType.toLowerCase();
  const unsigned = type.includes("unsigned");
  switch (column.dataType) {
    case "bigint":
      return "BIGINT";
    case "int":
    case "mediumint":
      return unsigned ? "BIGINT" : "INT";
    case "smallint":
      return unsigned ? "INT" : "SMALLINT";
    case "tinyint":
      return unsigned || type.startsWith("tinyint(1)") ? "TINYINT" : "SMALLINT";
    case "decimal": {
      const match = /decimal\((\d+),(\d+)\)/.exec(type);
      return match ? `DECIMAL(${match[1]},${match[2]})` : "DECIMAL(18,2)";
    }
    case "varchar":
      return column.maxLength && column.maxLength <= 4000 ? `NVARCHAR(${column.maxLength})` : "NVARCHAR(MAX)";
    case "char":
      return `NCHAR(${column.maxLength ?? 1})`;
    case "text":
    case "mediumtext":
    case "longtext":
      return "NVARCHAR(MAX)";
    case "date":
      return "DATE";
    case "datetime":
    case "timestamp":
      return "DATETIME2(0)";
    case "time":
      return "TIME(0)";
    case "enum": {
      const longest = Math.max(...enumValues(column.columnType).map((value) => value.length), 1);
      return `NVARCHAR(${longest})`;
    }
    default:
      throw new Error(`Tipo no contemplado: ${column.table}.${column.name} ${column.columnType}`);
  }
}

function mapDefault(column: Column): string | null {
  const value = column.defaultValue;
  if (value === null || value === "NULL") {
    return null;
  }
  if (/^current_timestamp(\(\))?$/i.test(value)) {
    return "SYSUTCDATETIME()";
  }
  if (/^'.*'$/s.test(value)) {
    return nstr(value.slice(1, -1).replace(/''/g, "'"));
  }
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return value;
  }
  throw new Error(`Valor por defecto no contemplado: ${column.table}.${column.name} = ${value}`);
}

/** Traduce una expresión CHECK de MySQL a T-SQL. */
function mapCheck(clause: string) {
  return clause
    .replace(/json_valid\(`([^`]+)`\)/gi, (_m, col: string) => `ISJSON(${q(col)}) = 1`)
    .replace(/`([^`]+)`/g, (_m, name: string) => q(name))
    .replace(/\band\b/g, "AND")
    .replace(/\bor\b/g, "OR");
}

/** Bytes de la clave de un índice en SQL Server (límite 1700 no agrupado, 900 agrupado). */
function keyBytes(columns: Column[]) {
  return columns.reduce((total, column) => {
    const type = mapType(column);
    const match = /NVARCHAR\((\d+)\)|NCHAR\((\d+)\)/.exec(type);
    if (match) {
      return total + Number(match[1] ?? match[2]) * 2;
    }
    if (type === "NVARCHAR(MAX)") {
      return total + 99999;
    }
    return total + (type === "BIGINT" || type.startsWith("DATETIME2") ? 8 : type.startsWith("DECIMAL") ? 9 : 4);
  }, 0);
}

function sortByDependencies(tables: string[], deps: Map<string, Set<string>>) {
  const sorted: string[] = [];
  const done = new Set<string>();
  const visiting = new Set<string>();
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

  const [applied] = await dbPool.query<Row[]>("SELECT filename FROM _migrations");
  const appliedNames = new Set(applied.map((row) => String(row.filename)));
  const files = migrationFiles();
  const missing = files.filter((file) => !appliedNames.has(file));
  if (missing.length > 0) {
    throw new Error(`La base no tiene aplicadas todas las migraciones: ${missing.join(", ")}`);
  }

  const [tableRows] = await dbPool.query<Row[]>(
    "SELECT table_name AS name, table_type AS type FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name"
  );
  const tables = tableRows.filter((row) => row.type === "BASE TABLE").map((row) => String(row.name));
  const views = tableRows.filter((row) => row.type === "VIEW").map((row) => String(row.name));

  const [columnRows] = await dbPool.query<Row[]>(
    `SELECT table_name AS t, column_name AS c, column_type AS ct, data_type AS dt, is_nullable AS n, column_default AS d,
            extra AS e, character_maximum_length AS len, generation_expression AS g
     FROM information_schema.columns WHERE table_schema = DATABASE() ORDER BY table_name, ordinal_position`
  );
  const columns = new Map<string, Column[]>();
  for (const row of columnRows) {
    const column: Column = {
      table: String(row.t),
      name: String(row.c),
      columnType: String(row.ct),
      dataType: String(row.dt).toLowerCase(),
      nullable: row.n === "YES",
      defaultValue: row.d === null ? null : String(row.d),
      extra: String(row.e ?? "").toLowerCase(),
      maxLength: row.len === null ? null : Number(row.len),
      generation: row.g ? String(row.g) : null
    };
    const list = columns.get(column.table) ?? [];
    list.push(column);
    columns.set(column.table, list);
  }

  const [indexRows] = await dbPool.query<Row[]>(
    `SELECT table_name AS t, index_name AS i, non_unique AS nu, column_name AS c
     FROM information_schema.statistics WHERE table_schema = DATABASE() ORDER BY table_name, index_name, seq_in_index`
  );
  type IndexInfo = { unique: boolean; columns: string[] };
  const indexes = new Map<string, Map<string, IndexInfo>>();
  for (const row of indexRows) {
    const byTable = indexes.get(String(row.t)) ?? new Map<string, IndexInfo>();
    const index = byTable.get(String(row.i)) ?? { unique: Number(row.nu) === 0, columns: [] };
    index.columns.push(String(row.c));
    byTable.set(String(row.i), index);
    indexes.set(String(row.t), byTable);
  }

  const [fkRows] = await dbPool.query<Row[]>(
    `SELECT k.table_name AS t, k.constraint_name AS name, k.column_name AS c, k.referenced_table_name AS rt,
            k.referenced_column_name AS rc, r.delete_rule AS del
     FROM information_schema.key_column_usage k
     JOIN information_schema.referential_constraints r
       ON r.constraint_schema = k.table_schema AND r.constraint_name = k.constraint_name AND r.table_name = k.table_name
     WHERE k.table_schema = DATABASE() AND k.referenced_table_name IS NOT NULL
     ORDER BY k.table_name, k.constraint_name, k.ordinal_position`
  );
  const fks = new Map<string, { table: string; name: string; columns: string[]; refTable: string; refColumns: string[]; del: string }>();
  for (const row of fkRows) {
    const key = `${row.t}.${row.name}`;
    const fk = fks.get(key) ?? { table: String(row.t), name: String(row.name), columns: [], refTable: String(row.rt), refColumns: [], del: String(row.del) };
    fk.columns.push(String(row.c));
    fk.refColumns.push(String(row.rc));
    fks.set(key, fk);
  }

  const [checkRows] = await dbPool.query<Row[]>(
    "SELECT table_name AS t, constraint_name AS name, check_clause AS clause FROM information_schema.check_constraints WHERE constraint_schema = DATABASE() ORDER BY 1, 2"
  );

  const deps = new Map<string, Set<string>>();
  for (const fk of fks.values()) {
    const set = deps.get(fk.table) ?? new Set<string>();
    set.add(fk.refTable);
    deps.set(fk.table, set);
  }
  const ordered = sortByDependencies(tables, deps);

  const warnings: string[] = [];
  const out: string[] = [];
  out.push(
    "/* ============================================================",
    "   Instalación completa: facturación multiempresa (SQL Server)",
    `   Generado: ${new Date().toISOString().slice(0, 10)} desde la base MySQL con todas las migraciones aplicadas.`,
    "   Para: SQL Server 2019+ (local, Express incluido) y Azure SQL Database.",
    "",
    "   Crea en la base ACTUAL (vacía) todo lo que usa el sistema: tablas, índices,",
    "   relaciones, vista de impresión, roles, permisos por rol, versiones y el",
    "   primer usuario administrador. No incluye empresas ni datos de operación.",
    "",
    "   Antes: crear la base (ver docs/migracion-sql-server.md), conectarse A ESA BASE",
    "   y ejecutar este archivo completo. Es un solo lote (sin GO) dentro de una",
    "   transacción: si algo falla no queda nada a medias.",
    "",
    `   Usuario inicial: ${INITIAL_ADMIN.username} / ${INITIAL_ADMIN.password}  (cambiar la contraseña al entrar).`,
    "",
    "   Fechas y horas se guardan en UTC. Migraciones incluidas:",
    ...files.map((file) => `   @incluye ${file}`),
    "   ============================================================ */",
    "",
    "SET NOCOUNT ON;",
    "SET XACT_ABORT ON;",
    "-- Requeridas por índices filtrados (sqlcmd las trae desactivadas; el programa las usa activas).",
    "SET QUOTED_IDENTIFIER ON;",
    "SET ANSI_NULLS ON;",
    "SET ANSI_PADDING ON;",
    "SET ANSI_WARNINGS ON;",
    "SET ARITHABORT ON;",
    "SET CONCAT_NULL_YIELDS_NULL ON;",
    "SET NUMERIC_ROUNDABORT OFF;",
    "",
    "IF DB_NAME() IN (N'master', N'model', N'msdb', N'tempdb')",
    "  THROW 50001, N'Conéctate a la base del sistema (no a master) antes de ejecutar este archivo.', 1;",
    "IF EXISTS (SELECT 1 FROM sys.tables WHERE is_ms_shipped = 0)",
    "  THROW 50002, N'La base de datos no está vacía: este archivo solo prepara una base nueva.', 1;",
    "",
    "BEGIN TRANSACTION;",
    ""
  );

  for (const table of ordered) {
    const tableColumns = columns.get(table)!;
    const tableIndexes = indexes.get(table) ?? new Map<string, IndexInfo>();
    const lines: string[] = [];

    for (const column of tableColumns) {
      if (column.generation) {
        if (!REPLACED_GENERATED[`${table}.${column.name}`]) {
          throw new Error(`Columna calculada no contemplada: ${table}.${column.name}`);
        }
        continue;
      }
      let line = `  ${q(column.name)} ${mapType(column)}`;
      if (column.extra.includes("auto_increment")) {
        line += " IDENTITY(1,1)";
      }
      line += column.nullable ? " NULL" : " NOT NULL";
      const def = mapDefault(column);
      if (def !== null && !column.extra.includes("auto_increment")) {
        line += ` CONSTRAINT ${q(`DF_${table}_${column.name}`)} DEFAULT ${def}`;
      }
      if (column.dataType === "enum") {
        line += ` CONSTRAINT ${q(`CK_${table}_${column.name}`)} CHECK (${q(column.name)} IN (${enumValues(column.columnType).map(nstr).join(", ")}))`;
      }
      lines.push(line);
    }

    const primary = tableIndexes.get("PRIMARY");
    if (!primary) {
      throw new Error(`Tabla sin llave primaria: ${table}`);
    }
    lines.push(`  CONSTRAINT ${q(`PK_${table}`)} PRIMARY KEY CLUSTERED (${primary.columns.map(q).join(", ")})`);

    for (const check of checkRows.filter((row) => String(row.t) === table)) {
      const name = String(check.name);
      const isColumnJson = /^json_valid\(`[^`]+`\)$/i.test(String(check.clause));
      lines.push(`  CONSTRAINT ${q(isColumnJson ? `CK_${table}_${name}_json` : name)} CHECK (${mapCheck(String(check.clause))})`);
    }

    out.push(`CREATE TABLE [dbo].${q(table)} (`, lines.join(",\n"), ");", "");

    for (const [indexName, index] of tableIndexes) {
      if (indexName === "PRIMARY") {
        continue;
      }
      const replaced = Object.values(REPLACED_GENERATED).find((item) => item.index === indexName && index.columns.includes(item.column));
      if (replaced) {
        out.push(replaced.sql);
        continue;
      }
      const indexColumns = index.columns.map((name: string) => tableColumns.find((column) => column.name === name)!);
      const bytes = keyBytes(indexColumns);
      if (bytes > 1700) {
        warnings.push(`Índice ${table}.${indexName} supera 1700 bytes (${bytes}).`);
      }
      const nullable = indexColumns.filter((column) => column.nullable);
      const filter = index.unique && nullable.length > 0 ? ` WHERE ${nullable.map((column) => `${q(column.name)} IS NOT NULL`).join(" AND ")}` : "";
      out.push(
        `CREATE ${index.unique ? "UNIQUE " : ""}INDEX ${q(indexName)} ON [dbo].${q(table)} (${index.columns.map(q).join(", ")})${filter};`
      );
    }
    out.push("");
  }

  // Llaves foráneas: cascada solo donde hace falta y sin caminos múltiples.
  const cascadeEdges = new Map<string, Set<string>>();
  const reaches = (from: string, to: string): boolean => {
    if (from === to) {
      return true;
    }
    const seen = new Set<string>();
    const stack = [from];
    while (stack.length) {
      const node = stack.pop()!;
      for (const next of cascadeEdges.get(node) ?? []) {
        if (next === to) {
          return true;
        }
        if (!seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      }
    }
    return false;
  };
  const ancestors = (node: string) => tables.filter((table) => reaches(table, node));
  const descendants = (node: string) => tables.filter((table) => reaches(node, table));

  out.push("/* Relaciones */");
  const downgraded: string[] = [];
  for (const fk of fks.values()) {
    let action = fk.del === "RESTRICT" || fk.del === "NO ACTION" ? "NO ACTION" : fk.del;
    if (action !== "NO ACTION" && !DELETED_PARENTS.has(fk.refTable)) {
      action = "NO ACTION";
    }
    if (action !== "NO ACTION") {
      const from = ancestors(fk.refTable);
      const to = descendants(fk.table);
      const conflict = fk.refTable === fk.table || from.some((x) => to.some((d) => reaches(x, d)));
      if (conflict) {
        downgraded.push(`${fk.table}.${fk.name} (${fk.del})`);
        action = "NO ACTION";
      } else {
        const set = cascadeEdges.get(fk.refTable) ?? new Set<string>();
        set.add(fk.table);
        cascadeEdges.set(fk.refTable, set);
      }
    }
    out.push(
      `ALTER TABLE [dbo].${q(fk.table)} ADD CONSTRAINT ${q(fk.name)} FOREIGN KEY (${fk.columns.map(q).join(", ")}) ` +
        `REFERENCES [dbo].${q(fk.refTable)} (${fk.refColumns.map(q).join(", ")}) ON DELETE ${action} ON UPDATE NO ACTION;`
    );
  }
  out.push("");

  out.push("/* Vistas (EXEC: CREATE VIEW debe ir solo en su lote) */");
  for (const view of views) {
    const [[row]] = await dbPool.query<Row[]>(`SHOW CREATE VIEW \`${view}\``);
    const body = String(row!["Create View"])
      .replace(/^CREATE .*?VIEW `[^`]+` AS /, "")
      .split(`\`${database}\`.`)
      .join("")
      .replace(/`([^`]+)`/g, (_m, name: string) => q(name))
      .replace(/'([^']*)'/g, (_m, value: string) => nstr(value));
    out.push(`EXEC(N'CREATE VIEW [dbo].${q(view)} AS ${body.replace(/'/g, "''")}');`);
  }
  out.push("");

  out.push("/* Catálogos del sistema */");
  for (const table of CATALOG_TABLES) {
    const [rows] = await dbPool.query<Row[]>(`SELECT * FROM \`${table}\``);
    if (rows.length === 0) {
      continue;
    }
    const tableColumns = columns.get(table)!;
    const identity = tableColumns.find((column) => column.extra.includes("auto_increment"));
    const names = Object.keys(rows[0]!).filter((name) => !["created_at", "updated_at"].includes(name));
    if (identity && names.includes(identity.name)) {
      out.push(`SET IDENTITY_INSERT [dbo].${q(table)} ON;`);
    }
    out.push(`INSERT INTO [dbo].${q(table)} (${names.map(q).join(", ")}) VALUES`);
    out.push(rows.map((row) => `  (${names.map((name) => sqlValue(row[name])).join(", ")})`).join(",\n") + ";");
    if (identity && names.includes(identity.name)) {
      out.push(`SET IDENTITY_INSERT [dbo].${q(table)} OFF;`);
    }
    out.push("");
  }

  const [[role]] = await dbPool.query<Row[]>("SELECT id FROM roles WHERE nombre = 'SUPERADMIN' LIMIT 1");
  const hash = await bcrypt.hash(INITIAL_ADMIN.password, 10);
  out.push(
    "/* Primer usuario (SUPERADMIN) */",
    "INSERT INTO [dbo].[users] ([username], [email], [password_hash], [full_name], [role_id], [is_active]) VALUES",
    `  (${sqlValue(INITIAL_ADMIN.username)}, ${sqlValue(INITIAL_ADMIN.email)}, ${sqlValue(hash)}, ${sqlValue(INITIAL_ADMIN.fullName)}, ${Number(role!.id)}, 1);`,
    "",
    "/* Migraciones incluidas en esta instalación */",
    "INSERT INTO [dbo].[_migrations] ([filename]) VALUES",
    files.map((file) => `  (${sqlValue(file)})`).join(",\n") + ";",
    "",
    "COMMIT TRANSACTION;",
    "",
    "PRINT N'Instalación completa.';",
    ""
  );

  const root = path.resolve(migrationsDir()!, "..", "migrations-mssql", "base");
  fs.mkdirSync(root, { recursive: true });
  const target = path.join(root, "instalacion_sqlserver.sql");
  fs.writeFileSync(target, out.join("\n"), "utf8");

  console.log(`Generado ${target}`);
  console.log(`  ${ordered.length} tablas, ${views.length} vistas, ${fks.size} relaciones, ${files.length} migraciones incluidas.`);
  if (downgraded.length) {
    console.log(`  Cascadas cambiadas a NO ACTION por caminos múltiples: ${downgraded.join("; ")}`);
  }
  warnings.forEach((warning) => console.log(`  AVISO: ${warning}`));
  await dbPool.end();
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await dbPool.end();
  process.exit(1);
});
