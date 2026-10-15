-- ============================================================
-- Migración: 2026_10_15_000001_initial_admin_user
-- Base:  MySQL 8 / MariaDB 10.4+
-- Objetivo:
--   Usuario inicial "Admin" (contraseña admin123) con el rol SUPERADMIN, para entrar
--   la primera vez desde la app y configurar el resto. Solo se crea si no existe un
--   usuario con ese nombre o correo; nunca cambia uno existente.
--   Cambiar la contraseña después del primer ingreso.
-- @actualiza-datos: agrega el usuario inicial Admin si no existe
--
-- Versión SQL Server: migrations-mssql/ (mismo nombre de archivo).
-- Forward-only. Ejecutar una sola vez, después de 2026_10_06_000001.
-- ============================================================

SET NAMES utf8mb4;

INSERT INTO users (username, email, password_hash, full_name, role_id, is_active)
SELECT 'Admin', 'admin@pos.local', '$2b$10$hBurPfL/RLWpqhjhUwP3q.Qz8vdQjFiNliyJ2OU2pYWJm3rsKr1/C', 'Administrador', r.id, 1
FROM roles r
WHERE r.nombre = 'SUPERADMIN'
  AND NOT EXISTS (SELECT 1 FROM users u WHERE u.username = 'Admin' OR u.email = 'admin@pos.local');
