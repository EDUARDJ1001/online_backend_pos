-- ============================================================
-- Usuario de base de datos para las cajas (MySQL / MariaDB), con permisos limitados.
-- Generado con: npm run db:usuario-caja --workspace backend (no editar a mano).
--
-- Antes de ejecutar (como administrador), reemplaza en todo el archivo:
--   NOMBRE_BASE      -> nombre de la base (por ejemplo facturacion)
--   USUARIO_CAJA     -> usuario para las cajas (por ejemplo caja)
--   CONTRASENA_CAJA  -> contraseña de ese usuario
-- Después pon ese usuario y contraseña en config.env de cada caja (DB_USER, DB_PASSWORD).
-- Vuelve a ejecutarlo después de cada actualización de la base que agregue tablas.
-- ============================================================

CREATE USER IF NOT EXISTS 'USUARIO_CAJA'@'%' IDENTIFIED BY 'CONTRASENA_CAJA';

-- Datos del sistema: leer, agregar, cambiar y borrar (sin cambiar la estructura).
GRANT SELECT, INSERT, UPDATE, DELETE ON `NOMBRE_BASE`.`audit_logs` TO 'USUARIO_CAJA'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `NOMBRE_BASE`.`bank_accounts` TO 'USUARIO_CAJA'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `NOMBRE_BASE`.`bank_movements` TO 'USUARIO_CAJA'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `NOMBRE_BASE`.`billing_series` TO 'USUARIO_CAJA'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `NOMBRE_BASE`.`billing_settings` TO 'USUARIO_CAJA'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `NOMBRE_BASE`.`cash_movements` TO 'USUARIO_CAJA'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `NOMBRE_BASE`.`cash_network_rules` TO 'USUARIO_CAJA'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `NOMBRE_BASE`.`cash_registers` TO 'USUARIO_CAJA'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `NOMBRE_BASE`.`cash_sessions` TO 'USUARIO_CAJA'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `NOMBRE_BASE`.`cash_terminal_pairings` TO 'USUARIO_CAJA'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `NOMBRE_BASE`.`cash_terminals` TO 'USUARIO_CAJA'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `NOMBRE_BASE`.`clients` TO 'USUARIO_CAJA'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `NOMBRE_BASE`.`companies` TO 'USUARIO_CAJA'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `NOMBRE_BASE`.`document_counters` TO 'USUARIO_CAJA'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `NOMBRE_BASE`.`inventory_entries` TO 'USUARIO_CAJA'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `NOMBRE_BASE`.`inventory_entry_items` TO 'USUARIO_CAJA'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `NOMBRE_BASE`.`inventory_movements` TO 'USUARIO_CAJA'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `NOMBRE_BASE`.`invoice_corrections` TO 'USUARIO_CAJA'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `NOMBRE_BASE`.`invoice_items` TO 'USUARIO_CAJA'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `NOMBRE_BASE`.`invoice_payments` TO 'USUARIO_CAJA'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `NOMBRE_BASE`.`invoices` TO 'USUARIO_CAJA'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `NOMBRE_BASE`.`payable_documents` TO 'USUARIO_CAJA'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `NOMBRE_BASE`.`payable_payments` TO 'USUARIO_CAJA'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `NOMBRE_BASE`.`product_categories` TO 'USUARIO_CAJA'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `NOMBRE_BASE`.`product_codes` TO 'USUARIO_CAJA'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `NOMBRE_BASE`.`product_stocks` TO 'USUARIO_CAJA'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `NOMBRE_BASE`.`products` TO 'USUARIO_CAJA'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `NOMBRE_BASE`.`proforma_items` TO 'USUARIO_CAJA'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `NOMBRE_BASE`.`proforma_series` TO 'USUARIO_CAJA'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `NOMBRE_BASE`.`proformas` TO 'USUARIO_CAJA'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `NOMBRE_BASE`.`quote_items` TO 'USUARIO_CAJA'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `NOMBRE_BASE`.`quote_series` TO 'USUARIO_CAJA'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `NOMBRE_BASE`.`quotes` TO 'USUARIO_CAJA'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `NOMBRE_BASE`.`role_permissions` TO 'USUARIO_CAJA'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `NOMBRE_BASE`.`roles` TO 'USUARIO_CAJA'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `NOMBRE_BASE`.`suppliers` TO 'USUARIO_CAJA'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `NOMBRE_BASE`.`system_versions` TO 'USUARIO_CAJA'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `NOMBRE_BASE`.`user_company_access` TO 'USUARIO_CAJA'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `NOMBRE_BASE`.`users` TO 'USUARIO_CAJA'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `NOMBRE_BASE`.`warehouses` TO 'USUARIO_CAJA'@'%';
GRANT SELECT ON `NOMBRE_BASE`.`vw_invoice_print_projection` TO 'USUARIO_CAJA'@'%';

-- Licencias, anulaciones y control de actualizaciones: solo leer.
GRANT SELECT ON `NOMBRE_BASE`.`system_licenses` TO 'USUARIO_CAJA'@'%';
GRANT SELECT ON `NOMBRE_BASE`.`license_revocations` TO 'USUARIO_CAJA'@'%';
GRANT SELECT ON `NOMBRE_BASE`.`_migrations` TO 'USUARIO_CAJA'@'%';

-- Registro de equipos: cada caja anota el suyo (sin borrar).
GRANT SELECT, INSERT, UPDATE ON `NOMBRE_BASE`.`license_devices` TO 'USUARIO_CAJA'@'%';
