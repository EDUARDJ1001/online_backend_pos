import fs from "fs";
import path from "path";

import type { DbClient, DbExecutor } from "../../config/db";

/**
 * Seguridad de las actualizaciones de la base (migraciones): solo cambian la
 * ESTRUCTURA. Los datos que ya existen no se modifican ni se borran. Si alguna
 * pendiente no cumple, no se aplica NINGUNA.
 *
 *   1. Nada que borre: DROP TABLE / COLUMN / DATABASE, TRUNCATE, DELETE.
 *   2. Nada que cambie datos existentes: UPDATE solo de columnas que la misma
 *      migración agrega (o de tablas que crea); INSERT solo en tablas que crea o en
 *      el catálogo de permisos del sistema; nunca MERGE ni REPLACE.
 *   3. Llenar columnas o tablas nuevas debe declararse en el encabezado con
 *      "-- @actualiza-datos: qué completa".
 *   4. Cada columna que cambia de tipo: los datos actuales deben caber (largo del
 *      texto, decimales, lista de valores, obligatorio, JSON válido). Se cuenta en la
 *      base cuántas filas no cabrían.
 *
 * Además, al aplicar se cuentan las filas de cada tabla antes y después de cada
 * migración (tableRowCounts): si alguna tabla pierde filas, se detiene.
 */

export interface MigrationInfo {
  file: string;
  /** Texto de "Objetivo:" del encabezado. */
  summary: string;
  /** Qué columnas o tablas nuevas llena (declarado con @actualiza-datos), o null. */
  dataChange: string | null;
  /**
   * Función que habilita (@funcion, @rutas, @pantallas). Si la migración la declara y
   * está pendiente, solo esa función queda desactivada; el resto del programa sigue.
   * Sin @funcion, la migración es central y su falta bloquea todo el sistema.
   */
  feature: { name: string; routes: string[]; screens: string[] } | null;
  sql: string;
}

export interface MigrationReview {
  file: string;
  /** Primera idea del objetivo, para mostrar. */
  title: string;
  summary: string;
  dataChange: string | null;
  /** Motivos por los que no se aplica (vacío = se puede aplicar). */
  problems: string[];
}

export function readMigrationInfo(dir: string, file: string): MigrationInfo {
  const sql = fs.readFileSync(path.join(dir, file), "utf8");
  // Encabezado: comentario de bloque inicial (SQL Server) o líneas "--" (MySQL).
  const block = /^\s*(?:﻿)?\/\*([\s\S]*?)\*\//.exec(sql)?.[1];
  const header = block
    ? block.split(/\r?\n/).map((line) => line.trim())
    : sql.split(/\r?\n/).filter((line) => line.trim().startsWith("--")).map((line) => line.replace(/^\s*--\s?/, ""));
  const start = header.findIndex((line) => /^Objetivo:/i.test(line.trim()));
  const summaryLines: string[] = [];
  if (start >= 0) {
    const first = header[start]!.replace(/^Objetivo:\s*/i, "").trim();
    if (first) summaryLines.push(first);
    for (const line of header.slice(start + 1)) {
      if (!line.trim() || /^=+$/.test(line.trim()) || /^(Versión|Forward-only|Base:|@)/i.test(line.trim())) break;
      summaryLines.push(line.trim());
    }
  }
  const dataChange = /@actualiza-datos:\s*(.+)/i.exec(sql)?.[1]?.trim() ?? null;
  const list = (tag: string) =>
    (new RegExp(`@${tag}:\\s*(.+)`, "i").exec(sql)?.[1] ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  const featureName = /@funcion:\s*(.+)/i.exec(sql)?.[1]?.trim();
  const feature = featureName ? { name: featureName, routes: list("rutas"), screens: list("pantallas") } : null;
  return { file, summary: summaryLines.join(" ").replace(/\s+/g, " ").trim() || file, dataChange, feature, sql };
}

/** Primera idea del objetivo: sin numeración inicial, hasta el primer punto o dos puntos. */
export function shortSummary(summary: string) {
  const text = summary.replace(/^\d+\.\s*/, "");
  const cut = /(?<=[^\d\s])\.\s|:\s/.exec(text);
  const sentence = (cut ? text.slice(0, cut.index) : text).trim().replace(/[.:]$/, "");
  return sentence ? `${sentence}.` : summary;
}

function stripComments(sql: string) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

/** Palabras que pueden seguir a DROP sin borrar datos. */
const SAFE_DROP = new Set(["INDEX", "KEY", "FOREIGN", "CHECK", "CONSTRAINT", "PRIMARY", "VIEW", "PROCEDURE", "FUNCTION", "TRIGGER", "DEFAULT", "STATISTICS", "PREPARE"]);

/** Catálogo del sistema donde una actualización puede agregar filas (permisos de funciones nuevas). */
const SYSTEM_CATALOG = new Set(["role_permissions"]);

/** Nombre de tabla o columna: `x`, [x], [dbo].[x] o dbo.x. */
const NAME = String.raw`(?:\[?dbo\]?\.)?[\x60\[]?(\w+)[\x60\]]?`;

/** Palabras que pueden seguir al nombre de una tabla sin ser su alias. */
const NOT_ALIAS = new Set(["SET", "WHERE", "INNER", "LEFT", "RIGHT", "JOIN", "ON", "CROSS", "OUTER", "WITH", "GROUP", "ORDER", "SELECT", "VALUES"]);

/** Texto de la sentencia que empieza en `start`: hasta el ";" o el GO siguiente. */
function statementAt(body: string, start: number) {
  const rest = body.slice(start);
  const end = /;|^\s*GO\b/im.exec(rest);
  return end ? rest.slice(0, end.index) : rest;
}

/** Divide por comas que no están dentro de paréntesis ni de comillas. */
function splitTopLevel(text: string) {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = "";
  for (const char of text) {
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
    } else if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts;
}

/** Tablas que crea la migración y columnas que agrega ("tabla.columna"). */
function newStructure(body: string) {
  const tables = new Set<string>();
  const columns = new Set<string>();
  for (const match of body.matchAll(new RegExp(String.raw`\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?${NAME}`, "gi"))) {
    tables.add(match[1]!.toLowerCase());
  }
  for (const match of body.matchAll(new RegExp(String.raw`\bALTER\s+TABLE\s+${NAME}`, "gi"))) {
    const table = match[1]!.toLowerCase();
    // Cada parte separada por coma puede ser "ADD [COLUMN] col ..." o, en SQL Server, otra columna del mismo ADD.
    let adding = false;
    for (const part of splitTopLevel(statementAt(body, match.index! + match[0].length))) {
      const add = /^\s*(?:WITH\s+(?:NO)?CHECK\s+)?ADD\b\s*(?:COLUMN\b\s*)?/i.exec(part);
      const clause = add ? part.slice(add[0].length) : part;
      if (add) adding = true;
      else if (/^\s*(?:MODIFY|DROP|CHANGE|ALTER|RENAME)\b/i.test(part)) adding = false;
      if (!adding) continue;
      const column = /^[\x60\[]?(\w+)[\x60\]]?/.exec(clause.trim())?.[1];
      if (column && !/^(?:CONSTRAINT|KEY|INDEX|UNIQUE|PRIMARY|FOREIGN|CHECK|FULLTEXT|SPATIAL|DEFAULT)$/i.test(column)) {
        columns.add(`${table}.${column.toLowerCase()}`);
      }
    }
  }
  return { tables, columns };
}

/** Problema de un UPDATE: cambia columnas que ya existían (null si solo llena columnas nuevas). */
function updateProblem(statement: string, created: ReturnType<typeof newStructure>) {
  const aliases = new Map<string, string>();
  for (const match of statement.matchAll(new RegExp(String.raw`\b(?:UPDATE|FROM|JOIN)\s+${NAME}(?:\s+(?:AS\s+)?[\x60\[]?(\w+)[\x60\]]?)?`, "gi"))) {
    const table = match[1]!.toLowerCase();
    const alias = match[2]?.toLowerCase();
    if (!aliases.has(table)) aliases.set(table, table);
    if (alias && !NOT_ALIAS.has(alias.toUpperCase())) aliases.set(alias, table);
  }
  const first = new RegExp(String.raw`^UPDATE\s+${NAME}`, "i").exec(statement)?.[1]?.toLowerCase();
  const target = first ? (aliases.get(first) ?? first) : null;
  const assignments = /\bSET\b([\s\S]*?)(?=\bWHERE\b|\bFROM\b|$)/i.exec(statement)?.[1];
  if (!target || !assignments) return "cambia datos que ya existen";
  if (created.tables.has(target)) return null;

  for (const part of splitTopLevel(assignments)) {
    const left = /^\s*(?:[\x60\[]?(\w+)[\x60\]]?\.)?[\x60\[]?(\w+)[\x60\]]?\s*=/.exec(part);
    if (!left) return "cambia datos que ya existen";
    const table = left[1] ? (aliases.get(left[1].toLowerCase()) ?? left[1].toLowerCase()) : target;
    const column = left[2]!.toLowerCase();
    if (!created.tables.has(table) && !created.columns.has(`${table}.${column}`)) {
      return `cambia datos que ya existen (${table}.${column})`;
    }
  }
  return null;
}

/** Revisión del texto de la migración (sin consultar la base). */
export function staticProblems(info: MigrationInfo): string[] {
  const body = stripComments(info.sql).toUpperCase();
  const problems = new Set<string>();
  // Columnas calculadas (se derivan de otras; no guardan datos propios): se pueden quitar.
  const computed = new Set(
    (/@quita-columna-calculada:\s*([\w, ]+)/i.exec(info.sql)?.[1] ?? "")
      .split(",")
      .map((name) => name.trim().toUpperCase())
      .filter(Boolean)
  );

  for (const match of body.matchAll(/\bDROP\s+([A-Z_]+)(?:\s+[`[]?(\w+))?/g)) {
    const word = match[1]!;
    if (SAFE_DROP.has(word)) continue;
    if (word === "COLUMN" && match[2] && computed.has(match[2].toUpperCase())) continue;
    problems.add(word === "TABLE" ? "borra una tabla" : word === "DATABASE" ? "borra la base de datos" : "borra una columna");
  }
  if (/\bTRUNCATE\b/.test(body)) problems.add("vacía una tabla");
  if (/(?<!\bON\s{1,10})\bDELETE\b/.test(body)) problems.add("elimina filas");
  if (/\bMERGE\b/.test(body) || /\bREPLACE\s+INTO\b/.test(body)) problems.add("cambia datos que ya existen");

  // Solo se pueden llenar columnas y tablas nuevas de esta misma migración.
  const created = newStructure(body);
  let fillsData = false;
  // "ON DUPLICATE KEY UPDATE" es parte del INSERT y se revisa con él.
  for (const match of body.matchAll(/(?<!\b(?:ON|FOR|AFTER|BEFORE|KEY)\s{1,10})\bUPDATE\b/g)) {
    fillsData = true;
    const problem = updateProblem(statementAt(body, match.index!), created);
    if (problem) problems.add(problem);
  }
  for (const match of body.matchAll(new RegExp(String.raw`\bINSERT\s+(?:IGNORE\s+)?(?:INTO\s+)?${NAME}`, "g"))) {
    fillsData = true;
    const table = match[1]!.toLowerCase();
    if (created.tables.has(table)) continue;
    if (!SYSTEM_CATALOG.has(table)) problems.add(`agrega filas a una tabla que ya existe (${table})`);
    // Si la fila ya existe, solo se acepta dejarla igual (col = col).
    const onDuplicate = /\bON\s+DUPLICATE\s+KEY\s+UPDATE\b([\s\S]*)$/i.exec(statementAt(body, match.index!))?.[1];
    for (const part of onDuplicate ? splitTopLevel(onDuplicate) : []) {
      const same = /^\s*(?:\w+\.)?(\w+)\s*=\s*(?:\w+\.)?(\w+)\s*$/.exec(part);
      if (!same || same[1] !== same[2]) problems.add(`cambia datos que ya existen (${table})`);
    }
  }
  if (fillsData && !info.dataChange) problems.add("llena datos y no lo declara en su encabezado");

  return [...problems];
}

interface ColumnChange {
  table: string;
  column: string;
  /** Tipo nuevo tal como está escrito (VARCHAR(80) NOT NULL ...). */
  spec: string;
  /** Lista de valores permitidos (ENUM o CHECK IN). */
  allowed?: string;
}

/** Columnas que cambian de tipo en la migración. */
function columnChanges(sql: string, client: DbClient): ColumnChange[] {
  const body = stripComments(sql);
  const changes: ColumnChange[] = [];
  if (client === "mysql") {
    for (const block of body.matchAll(/ALTER\s+TABLE\s+`?(\w+)`?\s+([\s\S]*?);/gi)) {
      const table = block[1]!;
      for (const clause of block[2]!.matchAll(/MODIFY\s+(?:COLUMN\s+)?`?(\w+)`?\s+([\s\S]*?)(?=,\s*(?:MODIFY|ADD|DROP|CHANGE|ALTER|RENAME)\b|$)/gi)) {
        const spec = clause[2]!.trim();
        const enumList = /^ENUM\s*\(([^)]*)\)/i.exec(spec)?.[1];
        changes.push({ table, column: clause[1]!, spec, allowed: enumList });
      }
    }
  } else {
    for (const match of body.matchAll(/ALTER\s+TABLE\s+(?:\[?\w+\]?\.)?\[?(\w+)\]?\s+ALTER\s+COLUMN\s+\[?(\w+)\]?\s+([^;\n]+)/gi)) {
      changes.push({ table: match[1]!, column: match[2]!, spec: match[3]!.trim() });
    }
    for (const match of body.matchAll(/ALTER\s+TABLE\s+(?:\[?\w+\]?\.)?\[?(\w+)\]?\s+(?:WITH\s+(?:NO)?CHECK\s+)?ADD\s+CONSTRAINT\s+\[?\w+\]?\s+CHECK\s*\(\s*\[?(\w+)\]?\s+IN\s*\(([^)]*)\)\s*\)/gi)) {
      changes.push({ table: match[1]!, column: match[2]!, spec: "", allowed: match[3]! });
    }
  }
  return changes;
}

/** Condición SQL de las filas que NO cabrían en el tipo nuevo (null si no hay nada que comprobar). */
function misfitCondition(change: ColumnChange, client: DbClient) {
  const col = client === "mysql" ? `\`${change.column}\`` : `[${change.column}]`;
  const spec = change.spec.toUpperCase();
  const conditions: string[] = [];

  const text = /^N?(?:VAR)?CHAR\s*\(\s*(\d+)\s*\)/.exec(spec);
  if (text) conditions.push(client === "mysql" ? `CHAR_LENGTH(${col}) > ${text[1]}` : `LEN(${col}) > ${text[1]}`);

  const decimal = /^(?:DECIMAL|NUMERIC)\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)/.exec(spec);
  if (decimal) {
    const [precision, scale] = [Number(decimal[1]), Number(decimal[2])];
    conditions.push(`${col} <> ROUND(${col}, ${scale})`, `ABS(${col}) >= POWER(10.0, ${precision - scale})`);
  }

  if (/^TINYINT\b/.test(spec) && client === "mysql") conditions.push(`${col} NOT BETWEEN -128 AND 127`);
  if (/^JSON\b/.test(spec) && client === "mysql") conditions.push(`(${col} IS NOT NULL AND JSON_VALID(${col}) = 0)`);
  if (change.allowed) conditions.push(`(${col} IS NOT NULL AND ${col} NOT IN (${change.allowed}))`);
  if (/\bNOT\s+NULL\b/.test(spec)) conditions.push(`${col} IS NULL`);

  return conditions.length ? conditions.join(" OR ") : null;
}

/** Columnas que cambian de tipo y la condición de las filas que no cabrían (para scripts SQL). */
export function fitChecks(sql: string, client: DbClient) {
  return columnChanges(sql, client)
    .map((change) => ({ table: change.table, column: change.column, condition: misfitCondition(change, client) }))
    .filter((check): check is { table: string; column: string; condition: string } => Boolean(check.condition));
}

async function columnExists(executor: DbExecutor, client: DbClient, table: string, column: string) {
  const [rows] = await executor.query<Array<{ n: number }>>(
    client === "mysql"
      ? "SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?"
      : "SELECT COUNT(*) AS n FROM sys.columns WHERE object_id = OBJECT_ID(?) AND name = ?",
    [client === "mysql" ? table : `dbo.${table}`, column]
  );
  return Number(rows[0]?.n ?? 0) > 0;
}

/** Comprueba en la base que los datos actuales quepan en cada columna que cambia. */
export async function fitProblems(executor: DbExecutor, client: DbClient, info: MigrationInfo): Promise<string[]> {
  const problems: string[] = [];
  for (const change of columnChanges(info.sql, client)) {
    const condition = misfitCondition(change, client);
    if (!condition || !(await columnExists(executor, client, change.table, change.column))) continue;
    const table = client === "mysql" ? `\`${change.table}\`` : `[dbo].[${change.table}]`;
    try {
      const [rows] = await executor.query<Array<{ n: number }>>(`SELECT COUNT(*) AS n FROM ${table} WHERE ${condition}`);
      const count = Number(rows[0]?.n ?? 0);
      if (count > 0) {
        problems.push(`${count} ${count === 1 ? "fila" : "filas"} de ${change.table}.${change.column} no cabrían en el nuevo formato`);
      }
    } catch (error) {
      problems.push(`no se pudo comprobar ${change.table}.${change.column} (${(error as Error).message})`);
    }
  }
  return problems;
}

/** Revisa las migraciones pendientes: texto + datos actuales de la base. */
export async function reviewPending(executor: DbExecutor, client: DbClient, dir: string, files: string[]): Promise<MigrationReview[]> {
  const reviews: MigrationReview[] = [];
  for (const file of files) {
    const info = readMigrationInfo(dir, file);
    const problems = [...staticProblems(info), ...(await fitProblems(executor, client, info))];
    reviews.push({ file, title: shortSummary(info.summary), summary: info.summary, dataChange: info.dataChange, problems });
  }
  return reviews;
}

/** Filas por tabla (una sola consulta). */
export async function tableRowCounts(executor: DbExecutor, client: DbClient) {
  const [tables] = await executor.query<Array<{ name: string }>>(
    client === "mysql"
      ? "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'"
      : "SELECT name FROM sys.tables WHERE is_ms_shipped = 0"
  );
  const counts = new Map<string, number>();
  if (!tables.length) return counts;
  const quote = (name: string) => (client === "mysql" ? `\`${name.replace(/`/g, "``")}\`` : `[dbo].[${name.replace(/]/g, "]]")}]`);
  const union = tables.map((table) => `SELECT '${String(table.name).replace(/'/g, "''")}' AS t, COUNT(*) AS n FROM ${quote(String(table.name))}`).join(" UNION ALL ");
  const [rows] = await executor.query<Array<{ t: string; n: number }>>(union);
  for (const row of rows) counts.set(row.t, Number(row.n));
  return counts;
}

/** Tablas que perdieron filas entre dos conteos. */
export function lostRows(before: Map<string, number>, after: Map<string, number>) {
  return [...before].filter(([table, count]) => (after.get(table) ?? 0) < count).map(([table, count]) => `${table} (${count} → ${after.get(table) ?? 0})`);
}
