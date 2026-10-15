import type { RowDataPacket } from "mysql2/promise";

import { isMssql, type DbConnection } from "../config/db";

/**
 * Siguiente correlativo de un tipo de documento (p. ej. recibos REC-/PG-), sin
 * repetirse aunque varias cajas o backends lo pidan a la vez: el contador vive en
 * la base de datos y se incrementa de forma atómica dentro de la transacción del
 * llamador (la fila queda bloqueada hasta el commit, como la serie del CAI).
 *
 * La primera vez se inicializa con el mayor número existente con ese prefijo en
 * `seed` (tabla y columna), así continúa la numeración que ya había.
 * Usa solo la conexión recibida (sin pedir otra al pool).
 */
export async function nextDocumentNumber(
  connection: DbConnection,
  companyId: number,
  prefix: string,
  seed: { table: "invoice_payments" | "payable_payments"; column: "receipt_number" } | { table: "clients"; column: "code" },
  digits = 6
) {
  const counterKey = `${seed.table}:${prefix}`;

  const [maxRows] = isMssql()
    ? await connection.query<Array<RowDataPacket & { maxNumber: number | null }>>(
        // TRY_CAST: los números con texto después del prefijo se ignoran.
        `SELECT MAX(TRY_CAST(SUBSTRING(${seed.column}, ?, 30) AS BIGINT)) AS maxNumber
         FROM ${seed.table}
         WHERE company_id = ? AND ${seed.column} LIKE ?`,
        [prefix.length + 1, companyId, `${prefix}%`]
      )
    : await connection.query<Array<RowDataPacket & { maxNumber: number | null }>>(
        `SELECT MAX(CAST(SUBSTRING(${seed.column}, ?) AS UNSIGNED)) AS maxNumber
         FROM ${seed.table}
         WHERE company_id = ? AND ${seed.column} REGEXP ?`,
        [prefix.length + 1, companyId, `^${prefix}[0-9]+$`]
      );
  const existingMax = Number(maxRows[0]?.maxNumber ?? 0);

  // Insertar o incrementar en una sola sentencia: bloquea la fila hasta el commit.
  // El mayor entre el contador y lo existente: si alguien escribió a mano un número
  // mayor, se sigue desde ahí.
  if (isMssql()) {
    await connection.execute(
      `MERGE document_counters WITH (HOLDLOCK) AS t
       USING (SELECT ? AS company_id, ? AS counter_key) AS s
         ON t.company_id = s.company_id AND t.counter_key = s.counter_key
       WHEN MATCHED THEN
         UPDATE SET last_value = IIF(t.last_value > ?, t.last_value, ?) + 1, updated_at = SYSUTCDATETIME()
       WHEN NOT MATCHED THEN
         INSERT (company_id, counter_key, last_value) VALUES (s.company_id, s.counter_key, ?);`,
      [companyId, counterKey, existingMax, existingMax, existingMax + 1]
    );
  } else {
    // `last_value` entre acentos graves: es palabra reservada en MySQL 8 (MariaDB la acepta).
    await connection.execute(
      `INSERT INTO document_counters (company_id, counter_key, \`last_value\`)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE \`last_value\` = GREATEST(\`last_value\`, ?) + 1`,
      [companyId, counterKey, existingMax + 1, existingMax]
    );
  }

  const [rows] = await connection.query<Array<RowDataPacket & { lastValue: number }>>(
    isMssql()
      ? "SELECT last_value AS lastValue FROM document_counters WHERE company_id = ? AND counter_key = ?"
      : "SELECT `last_value` AS lastValue FROM document_counters WHERE company_id = ? AND counter_key = ?",
    [companyId, counterKey]
  );

  return `${prefix}${String(Number(rows[0]?.lastValue ?? existingMax + 1)).padStart(digits, "0")}`;
}
