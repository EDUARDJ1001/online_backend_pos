/* ============================================================
   Usuario de base de datos para las cajas (SQL Server / Azure SQL), con permisos limitados.
   Generado con: npm run db:usuario-caja --workspace backend (no editar a mano).

   Antes de ejecutar (como administrador, conectado a la base del sistema), reemplaza:
     USUARIO_CAJA     -> usuario para las cajas (por ejemplo caja)
     CONTRASENA_CAJA  -> contraseña de ese usuario
   Después pon ese usuario y contraseña en config.env de cada caja (DB_USER, DB_PASSWORD).
   Las tablas nuevas de futuras actualizaciones quedan incluidas solas (roles de la base).
   ============================================================ */

/* SQL Server: inicio de sesión del servidor + usuario en esta base. En Azure SQL Database,
   usa en su lugar: CREATE USER [USUARIO_CAJA] WITH PASSWORD = 'CONTRASENA_CAJA'; */
IF SUSER_ID(N'USUARIO_CAJA') IS NULL EXEC(N'CREATE LOGIN [USUARIO_CAJA] WITH PASSWORD = N''CONTRASENA_CAJA'', CHECK_POLICY = OFF');
IF USER_ID(N'USUARIO_CAJA') IS NULL EXEC(N'CREATE USER [USUARIO_CAJA] FOR LOGIN [USUARIO_CAJA]');

/* Datos del sistema: leer, agregar, cambiar y borrar (sin cambiar la estructura). */
ALTER ROLE db_datareader ADD MEMBER [USUARIO_CAJA];
ALTER ROLE db_datawriter ADD MEMBER [USUARIO_CAJA];

/* Licencias, anulaciones y control de actualizaciones: solo leer. */
DENY INSERT, UPDATE, DELETE ON [dbo].[system_licenses] TO [USUARIO_CAJA];
DENY INSERT, UPDATE, DELETE ON [dbo].[license_revocations] TO [USUARIO_CAJA];
DENY INSERT, UPDATE, DELETE ON [dbo].[_migrations] TO [USUARIO_CAJA];

/* Registro de equipos: cada caja anota el suyo (sin borrar). */
DENY DELETE ON [dbo].[license_devices] TO [USUARIO_CAJA];
