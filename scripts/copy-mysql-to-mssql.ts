/**
 * Copia TODOS los datos de la base MySQL/MariaDB configurada (.env: DB_*) a una
 * base SQL Server que ya tenga la instalación (migrations-mssql/base/instalacion_sqlserver.sql).
 *
 * - Deja la base destino como copia fiel: primero BORRA todo su contenido.
 * - Conserva los id (IDENTITY_INSERT) y ajusta los contadores al final.
 * - Fechas y horas: MySQL las tiene en hora local de esta PC (Honduras); se guardan
 *   en UTC. Las columnas solo-fecha no cambian.
 * - Al final compara cantidades de filas y totales clave entre ambas bases.
 *
 * Destino por variables de entorno:
 *   MSSQL_HOST, MSSQL_PORT (1433), MSSQL_DATABASE, MSSQL_USER, MSSQL_PASSWORD, MSSQL_SSL (true/false)
 *
 * Uso: npm run db:copy-to-mssql --workspace backend -- --confirm
 */
import { hasFlag } from "./lib/cli-args";
import mssql from "mssql";
import mysql from "mysql2/promise";

import { currentDbSettings } from "../src/config/db";

type Row = Record<string, unknown>;

const TOTALS: Array<{ table: string; column: string }> = [
  { table: "invoices", column: "grand_total" },
  { table: "invoices", column: "balance" },
  { table: "invoice_items", column: "line_total" },
  { table: "invoice_payments", column: "amount" },
  { table: "payable_documents", column: "balance" },
  { table: "product_stocks", column: "stock_quantity" },
  { table: "inventory_movements", column: "quantity" },
  { table: "cash_movements", column: "amount" }
];

function required(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta la variable ${name}.`);
  }
  return value;
}

async function main() {
  if (!hasFlag("confirm")) {
    throw new Error("Esta herramienta BORRA el contenido de la base SQL Server destino. Ejecútala con --confirm.");
  }

  const source = currentDbSettings();
  if (source.client !== "mysql") {
    throw new Error("El origen (.env DB_*) debe ser la base MySQL.");
  }

  const my = await mysql.createConnection({
    host: source.host,
    port: source.port,
    user: source.user,
    password: source.password,
    database: source.database,
    decimalNumbers: true,
    // DATE como texto: sin corrimiento de zona horaria.
    dateStrings: ["DATE"]
  });

  const ssl = process.env.MSSQL_SSL === "true";
  const ms = await new mssql.ConnectionPool({
    server: required("MSSQL_HOST"),
    port: Number(process.env.MSSQL_PORT ?? 1433),
    database: required("MSSQL_DATABASE"),
    user: required("MSSQL_USER"),
    password: required("MSSQL_PASSWORD"),
    requestTimeout: 300000,
    options: { encrypt: ssl, trustServerCertificate: !ssl, useUTC: true }
  }).connect();

  const targetTables = new Set(
    (await ms.request().query<{ name: string }>("SELECT name FROM sys.tables WHERE is_ms_shipped = 0")).recordset.map((row) => row.name)
  );
  if (!targetTables.has("companies")) {
    throw new Error("La base SQL Server no tiene la instalación. Ejecuta primero instalacion_sqlserver.sql.");
  }

  const [sourceTableRows] = await my.query<mysql.RowDataPacket[]>(
    "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE' ORDER BY table_name"
  );
  const tables = sourceTableRows.map((row) => String(row.name)).filter((name) => targetTables.has(name));

  console.log(`Origen MySQL: ${source.database}  ->  Destino SQL Server: ${process.env.MSSQL_DATABASE}`);
  console.log(`Tablas: ${tables.length}`);

  // Relaciones apagadas durante la carga (hay referencias circulares); al final se validan.
  // (Tabla por tabla: sp_MSforeachtable no existe en Azure SQL.)
  for (const table of tables) {
    await ms.request().batch(`ALTER TABLE [dbo].[${table}] NOCHECK CONSTRAINT ALL;`);
  }
  for (const table of tables) {
    await ms.request().batch(`DELETE FROM [dbo].[${table}];`);
  }

  for (const table of tables) {
    const columnsInfo = (
      await ms
        .request()
        .input("t", mssql.NVarChar, table)
        .query<{ name: string; type: string; isIdentity: boolean; isComputed: boolean }>(
          `SELECT c.name, t.name AS type, c.is_identity AS isIdentity, c.is_computed AS isComputed
           FROM sys.columns c JOIN sys.types t ON t.user_type_id = c.user_type_id
           WHERE c.object_id = OBJECT_ID(@t) ORDER BY c.column_id`
        )
    ).recordset.filter((column) => !column.isComputed);

    const [rows] = await my.query<mysql.RowDataPacket[]>(`SELECT * FROM \`${table}\``);
    const sourceColumns = rows[0] ? new Set(Object.keys(rows[0])) : new Set<string>();
    const columns = columnsInfo.filter((column) => rows.length === 0 || sourceColumns.has(column.name));
    const hasIdentity = columns.some((column) => column.isIdentity);

    if (rows.length > 0) {
      const perBatch = Math.max(1, Math.min(500, Math.floor(2000 / columns.length)));
      const transaction = new mssql.Transaction(ms);
      await transaction.begin();
      try {
        for (let start = 0; start < rows.length; start += perBatch) {
          const batch = rows.slice(start, start + perBatch) as Row[];
          const request = new mssql.Request(transaction);
          const values = batch.map((row, rowIndex) =>
            `(${columns
              .map((column, columnIndex) => {
                const name = `v${rowIndex}_${columnIndex}`;
                let value = row[column.name];
                if (value === undefined) value = null;
                if (column.type === "date" && value instanceof Date) value = value.toISOString().slice(0, 10);
                if (typeof value === "boolean") value = value ? 1 : 0;
                if (value instanceof Date) request.input(name, mssql.DateTime2(0), value);
                else if (typeof value === "number") request.input(name, Number.isInteger(value) ? mssql.BigInt : mssql.Decimal(28, 8), value);
                else if (Buffer.isBuffer(value)) request.input(name, mssql.VarBinary(mssql.MAX), value);
                else request.input(name, mssql.NVarChar(mssql.MAX), value === null ? null : String(value));
                return `@${name}`;
              })
              .join(", ")})`
          );
          const columnList = columns.map((column) => `[${column.name}]`).join(", ");
          await request.batch(
            `${hasIdentity ? `SET IDENTITY_INSERT [dbo].[${table}] ON;` : ""}
             INSERT INTO [dbo].[${table}] (${columnList}) VALUES ${values.join(",\n")};
             ${hasIdentity ? `SET IDENTITY_INSERT [dbo].[${table}] OFF;` : ""}`
          );
        }
        await transaction.commit();
      } catch (error) {
        await transaction.rollback().catch(() => undefined);
        throw new Error(`Tabla ${table}: ${(error as Error).message}`);
      }
    }

    if (hasIdentity) {
      // El próximo id sigue al mayor copiado.
      const max = Number((await ms.request().query(`SELECT ISNULL(MAX(id), 0) AS m FROM [dbo].[${table}]`)).recordset[0].m);
      await ms.request().batch(max > 0 ? `DBCC CHECKIDENT ('[dbo].[${table}]', RESEED, ${max}) WITH NO_INFOMSGS;` : `DBCC CHECKIDENT ('[dbo].[${table}]', RESEED, 0) WITH NO_INFOMSGS;`);
    }
    console.log(`  ${table.padEnd(28)} ${rows.length}`);
  }

  // Valida todas las relaciones con los datos copiados.
  for (const table of tables) {
    try {
      await ms.request().batch(`ALTER TABLE [dbo].[${table}] WITH CHECK CHECK CONSTRAINT ALL;`);
    } catch (error) {
      throw new Error(`Relaciones inválidas en ${table}: ${(error as Error).message}`);
    }
  }

  console.log("\nVerificación:");
  let problems = 0;
  for (const table of tables) {
    const [[a]] = await my.query<mysql.RowDataPacket[]>(`SELECT COUNT(*) AS n FROM \`${table}\``);
    const b = (await ms.request().query(`SELECT COUNT(*) AS n FROM [dbo].[${table}]`)).recordset[0];
    if (Number(a!.n) !== Number(b.n)) {
      problems += 1;
      console.log(`  FILAS DISTINTAS ${table}: MySQL ${a!.n} / SQL Server ${b.n}`);
    }
  }
  for (const { table, column } of TOTALS) {
    if (!tables.includes(table)) continue;
    const [[a]] = await my.query<mysql.RowDataPacket[]>(`SELECT COALESCE(SUM(\`${column}\`), 0) AS s FROM \`${table}\``);
    const b = (await ms.request().query(`SELECT ISNULL(SUM([${column}]), 0) AS s FROM [dbo].[${table}]`)).recordset[0];
    const same = Math.abs(Number(a!.s) - Number(b.s)) < 0.005;
    if (!same) problems += 1;
    console.log(`  ${same ? "OK " : "MAL"} suma ${table}.${column}: ${Number(a!.s).toFixed(2)} / ${Number(b.s).toFixed(2)}`);
  }
  console.log(problems === 0 ? "\nCopia completa y verificada." : `\nCopia con ${problems} diferencias: revisar antes de usarla.`);

  await my.end();
  await ms.close();
  process.exit(problems === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
