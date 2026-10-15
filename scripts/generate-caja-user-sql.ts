/**
 * Genera los scripts del usuario limitado de las cajas (MySQL y SQL Server) a partir de la
 * estructura esperada (esquema.json). Volver a generarlos después de cada migración.
 *
 * Uso: npm run db:usuario-caja --workspace backend
 */
import fs from "fs";
import path from "path";

import { buildMssqlCajaUser, buildMysqlCajaUser, CAJA_USER_FILES } from "./lib/caja-user-sql";

fs.writeFileSync(CAJA_USER_FILES.mysql, buildMysqlCajaUser());
fs.writeFileSync(CAJA_USER_FILES.mssql, buildMssqlCajaUser());
console.log(`Scripts listos:\n  ${path.relative(process.cwd(), CAJA_USER_FILES.mysql)}\n  ${path.relative(process.cwd(), CAJA_USER_FILES.mssql)}`);
