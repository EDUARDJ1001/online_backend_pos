/**
 * Scripts para una base NUEVA (sin datos: estructura, roles, permisos, versiones y el
 * primer usuario), listos para ejecutar, en instaladores/base-de-datos/:
 *
 *   crear_base_mysql.sql        MySQL / MariaDB: crea la base `facturacion` e instala todo.
 *   crear_base_sqlserver.sql    SQL Server: crea la base [facturacion] e instala todo
 *                               (si ya existe, aplica solo lo que falte).
 *   usuario_caja_*.sql          Usuario limitado para las cajas (después de instalar).
 *
 * Se arman a partir de los archivos de instalación del proyecto (siempre al día con
 * npm run verificar). Uso: npm run db:scripts-nuevos --workspace backend
 */
import fs from "fs";
import path from "path";

import { CAJA_USER_FILES } from "./lib/caja-user-sql";
import { MSSQL_SCRIPT_FILE } from "./lib/mssql-update-script";

const ROOT = path.resolve(__dirname, "../../..");
const OUT = path.join(ROOT, "instaladores", "base-de-datos");

const mysqlInstall = fs.readFileSync(path.join(ROOT, "migrations", "base", "instalacion_completa.sql"), "utf8");

const mysqlHeader = [
  "-- ============================================================",
  "-- Base NUEVA de Facturación (MySQL 8 / MariaDB 10.4+): sin datos, con toda la",
  "-- configuración inicial (tablas, vista, roles, permisos, versiones y el primer usuario).",
  "--",
  "-- Cómo usarlo (como administrador, en HeidiSQL, DBeaver, phpMyAdmin o la consola mysql):",
  "--   ejecutar el archivo completo. Crea la base `facturacion` si no existe y la instala.",
  "--   Para otro nombre, cambia `facturacion` en las dos líneas de abajo (CREATE y USE).",
  "--   Solo en una base nueva o vacía: si ya tiene el sistema, usa las actualizaciones",
  "--   (gestor de licencias > Base de datos, o npm run db:actualizar).",
  "--",
  "-- Usuario inicial: superadmin / Admin123!  (cambiar la contraseña al entrar).",
  "-- Después: usuario_caja_mysql.sql para el usuario limitado de las cajas.",
  "-- ============================================================",
  "",
  "CREATE DATABASE IF NOT EXISTS `facturacion` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;",
  "USE `facturacion`;",
  "",
  ""
].join("\n");

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "crear_base_mysql.sql"), mysqlHeader + mysqlInstall);
fs.copyFileSync(MSSQL_SCRIPT_FILE, path.join(OUT, "crear_base_sqlserver.sql"));
fs.copyFileSync(CAJA_USER_FILES.mysql, path.join(OUT, "usuario_caja_mysql.sql"));
fs.copyFileSync(CAJA_USER_FILES.mssql, path.join(OUT, "usuario_caja_sqlserver.sql"));
fs.writeFileSync(
  path.join(OUT, "LEEME.txt"),
  [
    "BASE DE DATOS NUEVA (sin datos)",
    "",
    "1. Ejecuta como administrador del servidor de base de datos:",
    "     MySQL / MariaDB:  crear_base_mysql.sql",
    "     SQL Server:       crear_base_sqlserver.sql  (en SSMS, F5)",
    "   Crean la base 'facturacion' con tablas, roles, permisos y el primer usuario",
    "   (superadmin / Admin123!, cambiar la contraseña al entrar).",
    "",
    "2. Crea el usuario limitado de las cajas (reemplaza los datos indicados arriba del archivo):",
    "     MySQL / MariaDB:  usuario_caja_mysql.sql",
    "     SQL Server:       usuario_caja_sqlserver.sql",
    "",
    "3. En cada caja, conecta la base con ese usuario (no con el administrador).",
    "",
    "4. Licencias: gestor de licencias > Activar equipos de una empresa (con el usuario",
    "   administrador de la base). Sin acceso a la base: USB en cada caja.",
    ""
  ].join("\r\n")
);
console.log(`Scripts listos en ${path.relative(process.cwd(), OUT)}`);
for (const name of fs.readdirSync(OUT)) console.log(`  ${name}`);
