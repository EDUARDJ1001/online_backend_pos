/**
 * Arma un solo script T-SQL para SQL Server que, ejecutado en SSMS (o sqlcmd):
 *
 *   1. Crea la base si no existe (Modern_Spanish_CI_AI, READ_COMMITTED_SNAPSHOT, nivel 150).
 *   2. Si la base está vacía, instala el sistema completo (instalacion_sqlserver.sql).
 *   3. Aplica solo las actualizaciones que falten, una por una y cada una en su
 *      transacción, con las mismas reglas que el programa: solo estructura, y antes
 *      de cambiar una columna comprueba que los datos actuales quepan.
 *
 * Se puede ejecutar las veces que haga falta: lo que ya está no se toca. Si algo no
 * se puede aplicar, se detiene ahí y no ejecuta nada más.
 */
import fs from "fs";
import path from "path";

import { fitChecks, readMigrationInfo, staticProblems } from "../../src/modules/system/migration-safety";

const ROOT = path.resolve(__dirname, "../../../..");
export const MSSQL_DIR = path.join(ROOT, "migrations-mssql");
export const MSSQL_SCRIPT_FILE = path.join(MSSQL_DIR, "base", "crear_o_actualizar_sqlserver.sql");

/** Texto dentro de N'...'. */
const quote = (text: string) => `N'${text.replace(/'/g, "''")}'`;

/** Lotes de una migración (separados por GO), sin "USE otra_base" ni lotes solo de comentarios. */
function batches(sql: string) {
  return sql
    .replace(/^\s*USE\s+[`[\]\w]+\s*;?\s*$/gim, "")
    .split(/^\s*GO\s*;?\s*$/gim)
    .filter((batch) => batch.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "").trim());
}

/** Si falla: muestra el motivo y ya no ejecuta nada más del script (SET NOEXEC ON). */
function stopOnError(what: string) {
  return `  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    DECLARE @error NVARCHAR(2048) = ERROR_MESSAGE();
    RAISERROR(N'${what.replace(/'/g, "''")}: %s', 16, 1, @error);
    SET NOEXEC ON;
  END CATCH`;
}

export function buildMssqlUpdateScript(database = "facturacion", dir = MSSQL_DIR) {
  const files = fs.readdirSync(dir).filter((file) => file.endsWith(".sql")).sort();
  const base = fs.readFileSync(path.join(dir, "base", "instalacion_sqlserver.sql"), "utf8");
  const included = [...base.matchAll(/@incluye\s+(\S+\.sql)/g)].map((match) => match[1]!);
  const known = [...new Set([...included, ...files])].sort();
  const db = `[${database.replace(/]/g, "]]")}]`;

  const out: string[] = [];
  out.push(`/* ============================================================
   Crear o actualizar la base de Facturación en SQL Server
   Generado con: npm run db:script-sqlserver (no editar a mano).

   Cómo usarlo (SQL Server Management Studio):
     1. Haz un respaldo si la base ya existe.
     2. Abre este archivo, conéctate al servidor y ejecútalo completo (F5).

   - Si la base ${db} no existe, la crea. Para otro nombre, cambia ${db} en la
     sección 1 (cuatro lugares).
   - Si está vacía, instala el sistema completo. Usuario inicial: superadmin /
     Admin123! (cambiar la contraseña al entrar).
   - Si ya tiene el sistema, aplica solo las actualizaciones que falten. Solo
     cambian la estructura: los datos que ya existen no se modifican ni se borran.
   - Se puede ejecutar varias veces: lo que ya está no se toca.
   - Si algo no se puede aplicar, se detiene y muestra el motivo en "Mensajes".

   Azure SQL Database: crea la base en el portal, conéctate a ESA base y
   ejecuta desde la sección 2 (Azure no admite CREATE DATABASE ... ni USE aquí).
   ============================================================ */

SET NOCOUNT ON;
SET XACT_ABORT ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET NOEXEC OFF;
GO

/* ---------- 1. Base de datos ---------- */
IF DB_ID(${quote(database)}) IS NULL
BEGIN
  CREATE DATABASE ${db} COLLATE Modern_Spanish_CI_AI;
  ALTER DATABASE ${db} SET READ_COMMITTED_SNAPSHOT ON WITH ROLLBACK IMMEDIATE;
  ALTER DATABASE ${db} SET COMPATIBILITY_LEVEL = 150;
  PRINT N'Base ${database.replace(/'/g, "''")} creada.';
END
GO
USE ${db};
GO

/* ---------- 2. Comprobaciones ---------- */
-- La base tiene tablas pero no es de este sistema: no se toca.
IF OBJECT_ID(N'dbo.users', N'U') IS NULL AND EXISTS (SELECT 1 FROM sys.tables WHERE is_ms_shipped = 0)
BEGIN
  RAISERROR(N'La base tiene tablas que no son del sistema de facturación. Usa una base vacía.', 16, 1);
  SET NOEXEC ON;
END
GO
-- La base es más nueva que este script: hay que usar el script de la versión nueva.
-- (IF anidado: SQL Server no corta el AND y fallaría si la tabla aún no existe.)
IF OBJECT_ID(N'dbo._migrations', N'U') IS NOT NULL
BEGIN
  IF EXISTS (SELECT 1 FROM dbo._migrations WHERE filename NOT IN (${known.map(quote).join(", ")}))
  BEGIN
    RAISERROR(N'La base ya tiene actualizaciones más nuevas que este script. Usa el script de la versión más reciente del programa.', 16, 1);
    SET NOEXEC ON;
  END
END
GO

/* ---------- 3. Instalación completa (solo si la base está vacía) ---------- */
IF OBJECT_ID(N'dbo.users', N'U') IS NULL
BEGIN
  BEGIN TRY
    EXEC(${quote(base)});
  END TRY
${stopOnError("No se pudo instalar el sistema")}
END
GO

-- Bases antiguas sin registro de actualizaciones.
IF OBJECT_ID(N'dbo._migrations', N'U') IS NULL
  CREATE TABLE dbo._migrations (
    id INT IDENTITY(1,1) CONSTRAINT PK__migrations PRIMARY KEY,
    filename NVARCHAR(255) NOT NULL CONSTRAINT UQ__migrations_filename UNIQUE,
    executed_at DATETIME2(0) NOT NULL CONSTRAINT DF__migrations_executed_at DEFAULT SYSUTCDATETIME()
  );
GO

/* ---------- 4. Actualizaciones ---------- */`);

  for (const file of files) {
    const info = readMigrationInfo(dir, file);
    const problems = staticProblems(info);
    if (problems.length) {
      throw new Error(`${file} no se puede incluir: ${problems.join("; ")}`);
    }
    const checks = fitChecks(info.sql, "mssql").map((check) => {
      const count = `SELECT @n = COUNT(*) FROM [dbo].[${check.table}] WHERE ${check.condition}`;
      const message = `filas de ${check.table}.${check.column} no cabrían en el nuevo formato. Corrige esos datos y vuelve a ejecutar.`;
      return `    IF COL_LENGTH(${quote(`dbo.${check.table}`)}, ${quote(check.column)}) IS NOT NULL
    BEGIN
      EXEC sp_executesql ${quote(count)}, N'@n INT OUTPUT', @n = @n OUTPUT;
      IF @n > 0
      BEGIN
        SET @aviso = CONCAT(@n, N' ', ${quote(message)});
        THROW 50001, @aviso, 1;
      END
    END`;
    });

    out.push(`
-- ${file}
IF NOT EXISTS (SELECT 1 FROM dbo._migrations WHERE filename = ${quote(file)})
BEGIN
  BEGIN TRY
    DECLARE @n INT = 0, @aviso NVARCHAR(2048);
${checks.length ? `${checks.join("\n")}\n` : ""}    BEGIN TRANSACTION;
${batches(info.sql).map((batch) => `    EXEC(${quote(batch.trim())});`).join("\n")}
    INSERT INTO dbo._migrations (filename) VALUES (${quote(file)});
    COMMIT TRANSACTION;
    PRINT N'Aplicada: ${file}';
  END TRY
${stopOnError(`No se aplicó ${file}`)}
END
GO`);
  }

  out.push(`
/* ---------- 5. Resultado ---------- */
SET NOEXEC OFF;
GO
DECLARE @al_dia BIT = 0;
IF DB_NAME() = ${quote(database)} AND OBJECT_ID(N'dbo._migrations', N'U') IS NOT NULL
BEGIN
  IF NOT EXISTS (SELECT f FROM (VALUES ${files.map((file) => `(${quote(file)})`).join(", ")}) AS pending(f) WHERE f NOT IN (SELECT filename FROM dbo._migrations))
    SET @al_dia = 1;
END
IF @al_dia = 1
  PRINT N'Listo: la base está al día.';
ELSE
  PRINT N'ATENCIÓN: la base NO quedó al día. Revisa los mensajes de arriba.';
GO
`);

  return out.join("\n");
}
