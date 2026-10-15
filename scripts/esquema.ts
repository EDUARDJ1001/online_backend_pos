/**
 * Estructura esperada de la base (esquema.json) para revisar bases en Sistema > Base de datos.
 *
 *   --comparar  compara la base configurada (DB_*) con esquema.json; sale con error si difieren.
 *   --guardar   escribe esquema.json desde la base configurada.
 *
 * Solo debe guardarse desde una base recién instalada con todas las migraciones: lo hace
 * `npm run db:esquema` (verificar con bases temporales). No usar con una base de trabajo.
 */
import fs from "fs";

import { currentDbSettings, dbPool } from "../src/config/db";
import { migrationFiles } from "../src/modules/system/migrations.service";
import { compareSchema, readSchema, readSnapshot, snapshotFile, sortedShape, type SchemaSnapshot } from "../src/modules/system/schema-check";

async function main() {
  const client = currentDbSettings().client;
  const actual = sortedShape(await readSchema(dbPool, client));

  if (process.argv.includes("--guardar")) {
    const file = snapshotFile(client);
    if (!file) throw new Error("No se encontró la carpeta de migraciones.");
    const snapshot: SchemaSnapshot = { migration: migrationFiles(client).at(-1) ?? "", tables: actual };
    fs.writeFileSync(file, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    console.log(`OK   estructura guardada: ${Object.keys(actual).length} tablas (${snapshot.migration})`);
    return;
  }

  const snapshot = readSnapshot(client);
  if (!snapshot) {
    console.log("FAIL no hay esquema.json: genéralo con npm run db:esquema");
    process.exitCode = 1;
    return;
  }
  const latest = migrationFiles(client).at(-1) ?? "";
  if (snapshot.migration !== latest) {
    console.log(`FAIL esquema.json es de ${snapshot.migration} y la última migración es ${latest}: regenéralo con npm run db:esquema`);
    process.exitCode = 1;
  }
  const report = compareSchema(snapshot.tables, actual);
  for (const table of report.missingTables) console.log(`FAIL falta la tabla ${table}`);
  for (const table of report.changedTables) {
    for (const column of table.missingColumns) console.log(`FAIL ${table.table}: falta la columna ${column}`);
    for (const column of table.extraColumns) console.log(`FAIL ${table.table}: columna de más ${column}`);
    for (const column of table.changedColumns) console.log(`FAIL ${table.table}.${column.column}: se esperaba ${column.expected} y hay ${column.actual}`);
  }
  for (const table of report.extraTables) console.log(`FAIL tabla que no está en esquema.json: ${table}`);
  if (report.ok && report.extraTables.length === 0 && !process.exitCode) {
    console.log(`OK   estructura igual a esquema.json (${report.expectedTables} tablas)`);
  } else {
    process.exitCode = 1;
  }
}

main()
  .catch((error: Error) => {
    console.log(`FAIL ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => dbPool.end().catch(() => undefined));
