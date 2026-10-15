-- ============================================================
-- @actualiza-datos: agrega los permisos de cada rol.
-- Migración: 2026_09_18_000001_roles_permissions
-- Base:  facturacion_multiempresa (MySQL 8 / MariaDB 10.4+)
-- Objetivo:
--   Permisos por rol configurables. El catálogo de permisos vive en el
--   backend (permissions.catalog.ts); aquí se guarda la asignación
--   rol -> permiso, editable desde la pantalla "Roles y permisos".
--   SUPERADMIN tiene todos los permisos de forma implícita (no se guarda).
--
-- Forward-only. Ejecutar una sola vez.
-- ============================================================

USE facturacion_multiempresa;

SET NAMES utf8mb4;

CREATE TABLE role_permissions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  role_id BIGINT UNSIGNED NOT NULL,
  permission_key VARCHAR(80) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_role_permissions (role_id, permission_key),
  KEY idx_role_permissions_role (role_id),
  CONSTRAINT fk_role_permissions_role
    FOREIGN KEY (role_id) REFERENCES roles (id)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Seed por defecto para ADMIN (todo menos roles.edit)
-- ------------------------------------------------------------
INSERT INTO role_permissions (role_id, permission_key)
SELECT (SELECT id FROM roles WHERE nombre = 'ADMIN'), k FROM (
  SELECT 'dashboard.view' AS k
  UNION ALL SELECT 'invoices.view'
  UNION ALL SELECT 'invoices.create'
  UNION ALL SELECT 'invoices.void'
  UNION ALL SELECT 'proformas.view'
  UNION ALL SELECT 'proformas.create'
  UNION ALL SELECT 'quotes.view'
  UNION ALL SELECT 'quotes.create'
  UNION ALL SELECT 'clients.view'
  UNION ALL SELECT 'clients.create'
  UNION ALL SELECT 'clients.edit'
  UNION ALL SELECT 'products.view'
  UNION ALL SELECT 'products.create'
  UNION ALL SELECT 'products.edit'
  UNION ALL SELECT 'categories.view'
  UNION ALL SELECT 'categories.create'
  UNION ALL SELECT 'categories.edit'
  UNION ALL SELECT 'warehouses.view'
  UNION ALL SELECT 'warehouses.create'
  UNION ALL SELECT 'warehouses.edit'
  UNION ALL SELECT 'inventory.view'
  UNION ALL SELECT 'inventory.adjust'
  UNION ALL SELECT 'receivables.view'
  UNION ALL SELECT 'receivables.pay'
  UNION ALL SELECT 'payables.view'
  UNION ALL SELECT 'payables.create'
  UNION ALL SELECT 'payables.pay'
  UNION ALL SELECT 'payables.void'
  UNION ALL SELECT 'suppliers.view'
  UNION ALL SELECT 'suppliers.create'
  UNION ALL SELECT 'suppliers.edit'
  UNION ALL SELECT 'users.view'
  UNION ALL SELECT 'users.create'
  UNION ALL SELECT 'users.edit'
  UNION ALL SELECT 'company.view'
  UNION ALL SELECT 'company.edit'
  UNION ALL SELECT 'settings.view'
  UNION ALL SELECT 'settings.configure'
  UNION ALL SELECT 'roles.view'
) AS admin_keys
WHERE EXISTS (SELECT 1 FROM roles WHERE nombre = 'ADMIN');

-- ------------------------------------------------------------
-- Seed por defecto para CAJERO (ventas y consulta)
-- ------------------------------------------------------------
INSERT INTO role_permissions (role_id, permission_key)
SELECT (SELECT id FROM roles WHERE nombre = 'CAJERO'), k FROM (
  SELECT 'dashboard.view' AS k
  UNION ALL SELECT 'invoices.view'
  UNION ALL SELECT 'invoices.create'
  UNION ALL SELECT 'proformas.view'
  UNION ALL SELECT 'proformas.create'
  UNION ALL SELECT 'quotes.view'
  UNION ALL SELECT 'quotes.create'
  UNION ALL SELECT 'clients.view'
  UNION ALL SELECT 'clients.create'
  UNION ALL SELECT 'products.view'
  UNION ALL SELECT 'inventory.view'
  UNION ALL SELECT 'receivables.view'
  UNION ALL SELECT 'receivables.pay'
) AS cajero_keys
WHERE EXISTS (SELECT 1 FROM roles WHERE nombre = 'CAJERO');

-- ============================================================
-- Fin de migración. Tabla role_permissions + seed ADMIN/CAJERO.
-- ============================================================
