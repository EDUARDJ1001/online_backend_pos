/**
 * Genera migrations-mssql/base/crear_o_actualizar_sqlserver.sql: un solo script para
 * SQL Server Management Studio que crea la base (si no existe), instala el sistema
 * (si está vacía) y aplica las actualizaciones que falten. Ver lib/mssql-update-script.
 *
 * Uso: npm run db:script-sqlserver
 *      npm run db:script-sqlserver -- --base=otro_nombre   (otro nombre de base)
 */
import { flagValue } from "./lib/cli-args";
import fs from "fs";
import path from "path";

import { buildMssqlUpdateScript, MSSQL_SCRIPT_FILE } from "./lib/mssql-update-script";

const name = flagValue("base");
const target = name ? path.join(path.dirname(MSSQL_SCRIPT_FILE), `crear_o_actualizar_${name}.sql`) : MSSQL_SCRIPT_FILE;

fs.writeFileSync(target, buildMssqlUpdateScript(name || undefined), "utf8");
console.log(`Script listo: ${path.relative(process.cwd(), target)}`);
