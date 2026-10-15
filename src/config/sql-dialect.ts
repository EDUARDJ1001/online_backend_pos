/**
 * Traducción de las consultas del sistema (escritas en SQL de MySQL) a T-SQL de
 * SQL Server. Cubre lo mecánico; lo que no se puede traducir de forma segura se
 * escribe por motor en el servicio (ver `isMssql()` en config/db.ts).
 *
 * Qué traduce:
 *   - Parámetros `?` -> `@p0, @p1...` (en orden de aparición).
 *   - Identificadores con comillas invertidas -> [corchetes].
 *   - CURRENT_TIMESTAMP / NOW() -> SYSUTCDATETIME() (la base guarda UTC).
 *   - CURDATE() -> fecha actual de Honduras (UTC-6, sin horario de verano).
 *   - `<fecha> +/- INTERVAL n UNIDAD` -> DATEADD(UNIDAD, +/-n, <fecha>).
 *   - DATE(fecha_hora) -> fecha en Honduras; IFNULL -> ISNULL; IF( -> IIF(.
 *   - LIMIT n [OFFSET m] -> OFFSET m ROWS FETCH NEXT n ROWS ONLY (en cualquier nivel;
 *     agrega ORDER BY (SELECT NULL) si ese nivel no tiene ORDER BY).
 *   - FOR UPDATE -> WITH (UPDLOCK, ROWLOCK) en cada tabla del FROM/JOIN de ese nivel.
 *   - LOCK IN SHARE MODE -> WITH (HOLDLOCK, ROWLOCK) igual.
 *
 * No toca el contenido de los textos entre comillas simples.
 */

/** Fecha actual en Honduras (UTC-6 todo el año). */
export const MSSQL_TODAY_HN = "CAST(DATEADD(HOUR, -6, SYSUTCDATETIME()) AS DATE)";

const KEYWORDS_AFTER_TABLE = new Set([
  "WHERE", "INNER", "LEFT", "RIGHT", "FULL", "CROSS", "OUTER", "JOIN", "ON", "GROUP", "ORDER", "HAVING",
  "WITH", "UNION", "SET", "OFFSET", "FOR", "LOCK", "LIMIT", "AND", "OR", "USING", "VALUES", "SELECT"
]);

interface Masked {
  text: string;
  literals: string[];
}

/** Reemplaza los textos '...' por marcadores para no alterarlos. */
function maskLiterals(sql: string): Masked {
  const literals: string[] = [];
  let text = "";
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i]!;
    if (ch === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") {
          j += 2;
          continue;
        }
        if (sql[j] === "\\" && j + 1 < sql.length) {
          j += 2;
          continue;
        }
        if (sql[j] === "'") {
          break;
        }
        j += 1;
      }
      literals.push(sql.slice(i, j + 1));
      text += `\u0000${literals.length - 1}\u0000`;
      i = j + 1;
      continue;
    }
    text += ch;
    i += 1;
  }
  return { text, literals };
}

function unmaskLiterals(text: string, literals: string[]) {
  // MySQL admite \' dentro de textos; en T-SQL se escribe ''.
  return text.replace(/\u0000(\d+)\u0000/g, (_m, index: string) => literals[Number(index)]!.replace(/\\'/g, "''"));
}

/** Posición del "(" que abre el nivel donde está `index` (o -1 si es el nivel principal). */
function scopeStart(text: string, index: number) {
  let depth = 0;
  for (let i = index - 1; i >= 0; i -= 1) {
    const ch = text[i];
    if (ch === ")") {
      depth += 1;
    } else if (ch === "(") {
      if (depth === 0) {
        return i;
      }
      depth -= 1;
    }
  }
  return -1;
}

/** Texto del nivel (sin subconsultas internas) entre `from` y `to`. */
function sameLevel(text: string, from: number, to: number) {
  let depth = 0;
  let out = "";
  for (let i = from; i < to; i += 1) {
    const ch = text[i]!;
    // Mantiene la misma longitud: las posiciones sirven para el texto original.
    if (ch === "(") {
      depth += 1;
      out += depth === 1 ? "(" : " ";
      continue;
    }
    if (ch === ")") {
      depth -= 1;
      out += depth === 0 ? ")" : " ";
      continue;
    }
    out += depth === 0 ? ch : " ";
  }
  return out;
}

/** Reemplaza llamadas NOMBRE(args) respetando paréntesis anidados. */
function replaceCall(text: string, name: string, build: (args: string) => string) {
  const pattern = new RegExp(`\\b${name}\\s*\\(`, "gi");
  let result = "";
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const open = match.index + match[0].length - 1;
    let depth = 0;
    let close = -1;
    for (let i = open; i < text.length; i += 1) {
      if (text[i] === "(") depth += 1;
      else if (text[i] === ")") {
        depth -= 1;
        if (depth === 0) {
          close = i;
          break;
        }
      }
    }
    if (close < 0) {
      break;
    }
    result += text.slice(last, match.index) + build(text.slice(open + 1, close));
    last = close + 1;
    pattern.lastIndex = close + 1;
  }
  return result + text.slice(last);
}

function translateLimits(text: string) {
  const pattern = /\bLIMIT\s+(@p\d+|\d+)(?:\s*,\s*(@p\d+|\d+))?(?:\s+OFFSET\s+(@p\d+|\d+))?/gi;
  const matches = [...text.matchAll(pattern)].reverse();
  for (const match of matches) {
    const index = match.index!;
    // LIMIT a, b  (MySQL) = OFFSET a ... FETCH b
    const [limit, offset] = match[2] ? [match[2], match[1]!] : [match[1]!, match[3] ?? "0"];
    const start = scopeStart(text, index) + 1;
    const level = sameLevel(text, start, index);
    const hasOrder = /\bORDER\s+BY\b/i.test(level);
    const replacement = `${hasOrder ? "" : "ORDER BY (SELECT NULL) "}OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`;
    text = text.slice(0, index) + replacement + text.slice(index + match[0].length);
  }
  return text;
}

function translateLocks(text: string) {
  const pattern = /\s+(FOR\s+UPDATE|LOCK\s+IN\s+SHARE\s+MODE)\b/gi;
  const matches = [...text.matchAll(pattern)].reverse();
  for (const match of matches) {
    const index = match.index!;
    const hint = /^\s+FOR/i.test(match[0]) ? " WITH (UPDLOCK, ROWLOCK)" : " WITH (HOLDLOCK, ROWLOCK)";
    const start = scopeStart(text, index) + 1;
    let segment = text.slice(start, index);
    // Tablas del FROM/JOIN de este nivel (no de subconsultas internas).
    const level = sameLevel(text, start, index);
    const tablePattern = /\b(FROM|JOIN)\s+(\[?[A-Za-z_][\w]*\]?)(\s+(?:AS\s+)?(\[?[A-Za-z_][\w]*\]?))?/gi;
    const inserts: number[] = [];
    let tableMatch: RegExpExecArray | null;
    while ((tableMatch = tablePattern.exec(level))) {
      const alias = tableMatch[4];
      const aliasIsKeyword = alias ? KEYWORDS_AFTER_TABLE.has(alias.replace(/[[\]]/g, "").toUpperCase()) : true;
      if (aliasIsKeyword) {
        // Sin alias: la sugerencia va después del nombre de la tabla, y la palabra
        // siguiente (p. ej. JOIN) se vuelve a revisar.
        const tableEnd = tableMatch.index + tableMatch[0].indexOf(tableMatch[2]!, tableMatch[1]!.length) + tableMatch[2]!.length;
        inserts.push(tableEnd);
        tablePattern.lastIndex = tableEnd;
      } else {
        inserts.push(tableMatch.index + tableMatch[0].length);
      }
    }
    for (const position of inserts.reverse()) {
      segment = segment.slice(0, position) + hint + segment.slice(position);
    }
    text = text.slice(0, start) + segment + text.slice(index + match[0].length);
  }
  return text;
}

export interface TranslatedSql {
  sql: string;
  paramCount: number;
}

const cache = new Map<string, TranslatedSql>();

export function toMssql(sql: string): TranslatedSql {
  const cached = cache.get(sql);
  if (cached) {
    return cached;
  }

  const masked = maskLiterals(sql);
  let text = masked.text;

  text = text.replace(/`([^`]+)`/g, "[$1]");

  let paramCount = 0;
  text = text.replace(/\?/g, () => `@p${paramCount++}`);

  text = text
    .replace(/\bCURRENT_TIMESTAMP(\s*\(\s*\))?/gi, "SYSUTCDATETIME()")
    .replace(/\bNOW\s*\(\s*\)/gi, "SYSUTCDATETIME()")
    .replace(/\bCURDATE\s*\(\s*\)/gi, MSSQL_TODAY_HN)
    .replace(
      /(SYSUTCDATETIME\(\)|\[?[A-Za-z_][\w.[\]]*)\s*([+-])\s*INTERVAL\s+(@p\d+|\d+)\s+(SECOND|MINUTE|HOUR|DAY|MONTH|YEAR)\b/gi,
      (_m, base: string, sign: string, amount: string, unit: string) =>
        `DATEADD(${unit.toUpperCase()}, ${sign === "-" ? `-(${amount})` : amount}, ${base})`
    )
    .replace(/\bIFNULL\s*\(/gi, "ISNULL(")
    .replace(/\bIF\s*\(/gi, "IIF(");

  // DATE(fecha_hora): las horas están en UTC; la fecha es la de Honduras.
  // (Solo se usa con columnas de fecha y hora; una columna DATE no lleva DATE().)
  text = replaceCall(text, "DATE", (args) => `CAST(DATEADD(HOUR, -6, ${args}) AS DATE)`);
  text = translateLimits(text);
  text = translateLocks(text);

  const result = { sql: unmaskLiterals(text, masked.literals), paramCount };
  if (cache.size > 2000) {
    cache.clear();
  }
  cache.set(sql, result);
  return result;
}

/** Tipo de sentencia (primera palabra, sin comentarios). */
export function statementKind(sql: string) {
  const clean = sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ").trimStart();
  return (/^[A-Za-z]+/.exec(clean)?.[0] ?? "").toUpperCase();
}
