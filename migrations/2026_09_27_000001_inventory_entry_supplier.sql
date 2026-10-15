-- ============================================================
-- @actualiza-datos: vincula las entradas existentes con el proveedor del catálogo que tiene el mismo nombre.
-- Migración: 2026_09_27_000001_inventory_entry_supplier
-- Base:  facturacion_multiempresa (MySQL 8 / MariaDB 10.4+)
-- Objetivo:
--   Las entradas de mercadería se vinculan al catálogo de proveedores
--   (antes solo guardaban el nombre como texto). supplier_name se conserva
--   como copia del nombre al momento de la entrada.
--   Las entradas anteriores cuyo texto coincide con un proveedor de la misma
--   empresa quedan vinculadas.
--
-- Versión SQL Server: migrations-mssql/ (mismo nombre de archivo).
-- ============================================================

SET NAMES utf8mb4;

ALTER TABLE inventory_entries
  ADD COLUMN supplier_id BIGINT UNSIGNED NULL AFTER entry_date,
  ADD KEY idx_inventory_entries_supplier (supplier_id),
  ADD CONSTRAINT fk_inventory_entries_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers (id) ON DELETE RESTRICT ON UPDATE CASCADE;

UPDATE inventory_entries ie
INNER JOIN suppliers s ON s.company_id = ie.company_id AND s.name = TRIM(ie.supplier_name)
SET ie.supplier_id = s.id
WHERE ie.supplier_id IS NULL AND ie.supplier_name IS NOT NULL;
