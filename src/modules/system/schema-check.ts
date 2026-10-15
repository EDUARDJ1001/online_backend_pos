import fs from "fs";
import path from "path";

import { currentDbSettings, dbPool, type DbClient, type DbExecutor } from "../../config/db";
import { migrationsDir } from "./migrations.service";

/**
 * Revisión de la estructura de la base contra la que espera esta versión del programa
 * (esquema.json en la carpeta base de las migraciones, generado con `npm run db:esquema`). Solo lee: dice
 * qué tablas faltan y qué columnas faltan, sobran o tienen otro tipo. No cambia nada.
 *
 * Los tipos se normalizan para que MySQL 8 y MariaDB den lo mismo (int(11) = int,
 * json = longtext); los índices, valores por defecto e intercalación no se comparan.
 */

export interface ColumnShape {
  type: string;
  nullable: boolean;
}

export type SchemaShape = Record<string, Record<string, ColumnShape>>;

export interface SchemaSnapshot {
  /** Última actualización (migración) incluida en esta estructura. */
  migration: string;
  tables: SchemaShape;
}

export interface SchemaReport {
  /** Hay estructura esperada para comparar (viene con el programa). */
  available: boolean;
  ok: boolean;
  expectedTables: number;
  missingTables: string[];
  changedTables: Array<{
    table: string;
    missingColumns: string[];
    extraColumns: string[];
    changedColumns: Array<{ column: string; expected: string; actual: string }>;
  }>;
  /** Tablas que no son del sistema (no es un error: solo se informan). */
  extraTables: string[];
}

export const SNAPSHOT_NAME = "esquema.json";

export function snapshotFile(client: DbClient = currentDbSettings().client) {
  const dir = migrationsDir(client);
  return dir ? path.join(dir, "base", SNAPSHOT_NAME) : null;
}

export function readSnapshot(client: DbClient = currentDbSettings().client): SchemaSnapshot | null {
  const file = snapshotFile(client);
  return file && fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as SchemaSnapshot) : null;
}

function normalizeMysqlType(type: string) {
  return type
    .toLowerCase()
    .replace(/\b(tinyint|smallint|mediumint|int|bigint)\(\d+\)/g, "$1")
    .replace(/^json$/, "longtext")
    .replace(/\s+/g, " ")
    .trim();
}

function mssqlType(row: { typeName: string; maxLength: number; precision: number; scale: number }) {
  const name = row.typeName.toLowerCase();
  if (["nvarchar", "nchar", "varchar", "char", "varbinary", "binary"].includes(name)) {
    if (Number(row.maxLength) === -1) return `${name}(max)`;
    const length = name.startsWith("n") ? Number(row.maxLength) / 2 : Number(row.maxLength);
    return `${name}(${length})`;
  }
  if (name === "decimal" || name === "numeric") return `${name}(${row.precision},${row.scale})`;
  if (name === "datetime2" || name === "time" || name === "datetimeoffset") return `${name}(${row.scale})`;
  return name;
}

/**
 * Tablas que no se comparan: _migrations es el registro interno de actualizaciones y
 * versiones anteriores del programa la creaban con pequeñas diferencias (inofensivas).
 */
const IGNORED_TABLES = new Set(["_migrations"]);

/** Estructura actual de la base conectada (solo lectura). */
export async function readSchema(executor: DbExecutor, client: DbClient): Promise<SchemaShape> {
  const shape = await readAllColumns(executor, client);
  for (const table of IGNORED_TABLES) delete shape[table];
  return shape;
}

async function readAllColumns(executor: DbExecutor, client: DbClient): Promise<SchemaShape> {
  const shape: SchemaShape = {};
  if (client === "mysql") {
    const [rows] = await executor.query<Array<{ tableName: string; columnName: string; columnType: string; isNullable: string }>>(
      `SELECT c.table_name AS tableName, c.column_name AS columnName, c.column_type AS columnType, c.is_nullable AS isNullable
       FROM information_schema.columns c
       INNER JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
       WHERE c.table_schema = DATABASE()`
    );
    for (const row of rows) {
      (shape[row.tableName] ??= {})[row.columnName] = { type: normalizeMysqlType(String(row.columnType)), nullable: row.isNullable === "YES" };
    }
  } else {
    const [rows] = await executor.query<Array<{ tableName: string; columnName: string; typeName: string; maxLength: number; numPrecision: number; numScale: number; isNullable: boolean | number }>>(
      `SELECT t.name AS tableName, c.name AS columnName, ty.name AS typeName, c.max_length AS maxLength, c.precision AS numPrecision, c.scale AS numScale, c.is_nullable AS isNullable
       FROM sys.columns c
       INNER JOIN sys.tables t ON t.object_id = c.object_id
       INNER JOIN sys.types ty ON ty.user_type_id = c.user_type_id
       WHERE t.is_ms_shipped = 0`
    );
    for (const row of rows) {
      (shape[row.tableName] ??= {})[row.columnName] = { type: mssqlType({ typeName: row.typeName, maxLength: row.maxLength, precision: row.numPrecision, scale: row.numScale }), nullable: Boolean(Number(row.isNullable)) };
    }
  }
  return shape;
}

/** Texto para mostrar: "varchar(80), obligatorio". */
export function describeColumn(column: ColumnShape) {
  return `${column.type}, ${column.nullable ? "opcional" : "obligatorio"}`;
}

export function compareSchema(expected: SchemaShape, actual: SchemaShape): Omit<SchemaReport, "available"> {
  const missingTables: string[] = [];
  const changedTables: SchemaReport["changedTables"] = [];
  for (const table of Object.keys(expected).sort()) {
    const actualColumns = actual[table];
    if (!actualColumns) {
      missingTables.push(table);
      continue;
    }
    const expectedColumns = expected[table]!;
    const missingColumns = Object.keys(expectedColumns).filter((column) => !actualColumns[column]).sort();
    const extraColumns = Object.keys(actualColumns).filter((column) => !expectedColumns[column]).sort();
    const changedColumns = Object.keys(expectedColumns)
      .filter((column) => actualColumns[column])
      .filter((column) => actualColumns[column]!.type !== expectedColumns[column]!.type || actualColumns[column]!.nullable !== expectedColumns[column]!.nullable)
      .sort()
      .map((column) => ({ column, expected: describeColumn(expectedColumns[column]!), actual: describeColumn(actualColumns[column]!) }));
    if (missingColumns.length || extraColumns.length || changedColumns.length) {
      changedTables.push({ table, missingColumns, extraColumns, changedColumns });
    }
  }
  const extraTables = Object.keys(actual).filter((table) => !expected[table]).sort();
  return { ok: missingTables.length === 0 && changedTables.length === 0, expectedTables: Object.keys(expected).length, missingTables, changedTables, extraTables };
}

/** Revisa la base conectada contra la estructura de esta versión. */
export async function schemaReport(executor: DbExecutor = dbPool): Promise<SchemaReport> {
  const client = currentDbSettings().client;
  const snapshot = readSnapshot(client);
  if (!snapshot) {
    return { available: false, ok: true, expectedTables: 0, missingTables: [], changedTables: [], extraTables: [] };
  }
  const expected = { ...snapshot.tables };
  for (const table of IGNORED_TABLES) delete expected[table];
  return { available: true, ...compareSchema(expected, await readSchema(executor, client)) };
}

/** Estructura ordenada (tablas y columnas por nombre) para guardar en esquema.json. */
export function sortedShape(shape: SchemaShape): SchemaShape {
  return Object.fromEntries(
    Object.keys(shape)
      .sort()
      .map((table) => [table, Object.fromEntries(Object.keys(shape[table]!).sort().map((column) => [column, shape[table]![column]!]))])
  );
}
