-- ============================================================
-- Migración: 2026_09_30_000001_align_schema
-- Base:  MySQL 8 / MariaDB 10.4+
-- Objetivo:
--   Dejar TODAS las bases con la misma estructura. Hasta hoy había dos variantes:
--     a) bases creadas con la instalación completa (instalacion_completa.sql)
--     b) bases antiguas llevadas al día con migraciones (producción)
--   Diferían en columnas, nombres de índices y algunas relaciones. Esta
--   migración revisa cada punto y solo cambia lo que haga falta, así sirve
--   para las dos variantes y se puede repetir. No borra ni modifica datos.
--
--   Estructura final:
--     - Columnas: la versión más amplia (acepta todo lo que ya existe);
--       JSON nativo en MySQL; expires_at sin auto-actualización.
--     - Índices: los nombres de la instalación completa.
--     - Código de barras: índice normal (el programa no exige que sea único).
--     - Relaciones: proformas -> factura convertida, movimientos -> usuario,
--       facturas -> bodega (al borrar la bodega el campo queda vacío),
--       sesiones de caja -> caja sin ON UPDATE CASCADE (MySQL 8 no lo permite).
--
-- Versión SQL Server: migrations-mssql/ (mismo nombre de archivo).
-- ============================================================

SET NAMES utf8mb4;

-- 1) Columnas
ALTER TABLE inventory_entries
  MODIFY COLUMN document_number VARCHAR(80) NULL DEFAULT NULL,
  MODIFY COLUMN status ENUM('BORRADOR','APLICADA','ANULADA') NOT NULL DEFAULT 'APLICADA';

ALTER TABLE inventory_movements
  MODIFY COLUMN source_type ENUM('MANUAL','ENTRADA','FACTURA','AJUSTE') NOT NULL DEFAULT 'MANUAL',
  MODIFY COLUMN unit_cost DECIMAL(14,2) NULL DEFAULT NULL,
  MODIFY COLUMN unit_price DECIMAL(14,2) NULL DEFAULT NULL;

ALTER TABLE invoice_items
  MODIFY COLUMN unit_cost_snapshot DECIMAL(14,2) NULL DEFAULT NULL,
  MODIFY COLUMN tax_rate DECIMAL(5,2) NOT NULL DEFAULT 15.00;

ALTER TABLE proforma_items
  MODIFY COLUMN unit_cost_snapshot DECIMAL(14,2) NULL DEFAULT NULL,
  MODIFY COLUMN tax_rate DECIMAL(5,2) NOT NULL DEFAULT 15.00;

ALTER TABLE products
  MODIFY COLUMN type ENUM('PRODUCTO','SERVICIO','MATERIALES') NOT NULL DEFAULT 'PRODUCTO',
  MODIFY COLUMN controls_stock TINYINT(1) NOT NULL DEFAULT 1,
  MODIFY COLUMN min_stock DECIMAL(14,2) NOT NULL DEFAULT 0.00;

-- Vencimiento del código de emparejamiento: valor por defecto "ahora" y SIN
-- actualizarse solo al modificar la fila (en bases creadas con MariaDB lo hacía).
ALTER TABLE cash_terminal_pairings
  MODIFY COLUMN expires_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- JSON: en MySQL 8 columna nativa; en MariaDB JSON es el mismo texto validado de siempre.
ALTER TABLE audit_logs
  MODIFY COLUMN old_values JSON NULL DEFAULT NULL,
  MODIFY COLUMN new_values JSON NULL DEFAULT NULL;

ALTER TABLE cash_sessions
  MODIFY COLUMN opening_breakdown JSON NULL DEFAULT NULL,
  MODIFY COLUMN closing_breakdown JSON NULL DEFAULT NULL;

-- 2) Índices: primero se crean los que faltan, luego se quitan los sobrantes
--    (así cada relación siempre tiene un índice que la respalde).

-- inventory_entries
SET @alinear_sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `inventory_entries` ADD INDEX `idx_inventory_entries_company_date` (`company_id`,`entry_date`)', 'DO 0') FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'inventory_entries' AND index_name = 'idx_inventory_entries_company_date');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;

SET @alinear_sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `inventory_entries` ADD INDEX `idx_inventory_entries_warehouse` (`warehouse_id`)', 'DO 0') FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'inventory_entries' AND index_name = 'idx_inventory_entries_warehouse');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;

-- inventory_entry_items
SET @alinear_sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `inventory_entry_items` ADD INDEX `idx_inventory_entry_items_entry` (`entry_id`)', 'DO 0') FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'inventory_entry_items' AND index_name = 'idx_inventory_entry_items_entry');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;

SET @alinear_sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `inventory_entry_items` ADD INDEX `idx_inventory_entry_items_product` (`product_id`)', 'DO 0') FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'inventory_entry_items' AND index_name = 'idx_inventory_entry_items_product');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;

-- inventory_movements
SET @alinear_sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `inventory_movements` ADD INDEX `idx_inventory_movements_company` (`company_id`)', 'DO 0') FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'inventory_movements' AND index_name = 'idx_inventory_movements_company');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;

SET @alinear_sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `inventory_movements` ADD INDEX `idx_inventory_movements_entry` (`entry_id`)', 'DO 0') FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'inventory_movements' AND index_name = 'idx_inventory_movements_entry');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;

SET @alinear_sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `inventory_movements` ADD INDEX `idx_inventory_movements_entry_item` (`entry_item_id`)', 'DO 0') FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'inventory_movements' AND index_name = 'idx_inventory_movements_entry_item');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;

SET @alinear_sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `inventory_movements` ADD INDEX `idx_inventory_movements_invoice` (`invoice_id`)', 'DO 0') FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'inventory_movements' AND index_name = 'idx_inventory_movements_invoice');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;

SET @alinear_sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `inventory_movements` ADD INDEX `idx_inventory_movements_invoice_item` (`invoice_item_id`)', 'DO 0') FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'inventory_movements' AND index_name = 'idx_inventory_movements_invoice_item');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;

SET @alinear_sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `inventory_movements` ADD INDEX `idx_inventory_movements_product` (`product_id`)', 'DO 0') FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'inventory_movements' AND index_name = 'idx_inventory_movements_product');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;

SET @alinear_sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `inventory_movements` ADD INDEX `idx_inventory_movements_product_warehouse` (`product_id`,`warehouse_id`)', 'DO 0') FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'inventory_movements' AND index_name = 'idx_inventory_movements_product_warehouse');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;

SET @alinear_sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `inventory_movements` ADD INDEX `idx_inventory_movements_warehouse` (`warehouse_id`)', 'DO 0') FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'inventory_movements' AND index_name = 'idx_inventory_movements_warehouse');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;

-- invoice_items
SET @alinear_sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `invoice_items` ADD INDEX `idx_invoice_items_product` (`product_id`)', 'DO 0') FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'invoice_items' AND index_name = 'idx_invoice_items_product');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;

-- products
SET @alinear_sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `products` ADD INDEX `idx_products_category` (`category_id`)', 'DO 0') FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'products' AND index_name = 'idx_products_category');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;

SET @alinear_sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `products` ADD INDEX `idx_products_company_barcode` (`company_id`,`barcode`)', 'DO 0') FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'products' AND index_name = 'idx_products_company_barcode');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;

SET @alinear_sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `products` ADD INDEX `idx_products_company_name` (`company_id`,`name`)', 'DO 0') FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'products' AND index_name = 'idx_products_company_name');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;

-- product_categories
SET @alinear_sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `product_categories` ADD INDEX `idx_product_categories_company` (`company_id`)', 'DO 0') FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'product_categories' AND index_name = 'idx_product_categories_company');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;

-- product_stocks
SET @alinear_sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `product_stocks` ADD INDEX `idx_product_stocks_company` (`company_id`)', 'DO 0') FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'product_stocks' AND index_name = 'idx_product_stocks_company');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;

SET @alinear_sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `product_stocks` ADD INDEX `idx_product_stocks_warehouse` (`warehouse_id`)', 'DO 0') FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'product_stocks' AND index_name = 'idx_product_stocks_warehouse');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;

-- proformas
SET @alinear_sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `proformas` ADD INDEX `fk_proformas_approved_by` (`approved_by`)', 'DO 0') FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'proformas' AND index_name = 'fk_proformas_approved_by');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;

SET @alinear_sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `proformas` ADD INDEX `idx_proformas_converted` (`converted_to_invoice_id`)', 'DO 0') FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'proformas' AND index_name = 'idx_proformas_converted');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;

SET @alinear_sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `proformas` ADD INDEX `idx_proformas_customer` (`customer_id`)', 'DO 0') FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'proformas' AND index_name = 'idx_proformas_customer');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;

SET @alinear_sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `proformas` ADD INDEX `idx_proformas_series` (`proforma_series_id`)', 'DO 0') FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'proformas' AND index_name = 'idx_proformas_series');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;

SET @alinear_sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `proformas` ADD INDEX `idx_proformas_warehouse` (`warehouse_id`)', 'DO 0') FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'proformas' AND index_name = 'idx_proformas_warehouse');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;

-- proforma_items
SET @alinear_sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `proforma_items` ADD INDEX `idx_proforma_items_product` (`product_id`)', 'DO 0') FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'proforma_items' AND index_name = 'idx_proforma_items_product');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;

SET @alinear_sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `proforma_items` ADD INDEX `idx_proforma_items_proforma` (`proforma_id`)', 'DO 0') FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'proforma_items' AND index_name = 'idx_proforma_items_proforma');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;

SET @alinear_sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `proforma_items` ADD UNIQUE INDEX `uq_proforma_items_proforma_line` (`proforma_id`,`line_number`)', 'DO 0') FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'proforma_items' AND index_name = 'uq_proforma_items_proforma_line');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;

-- proforma_series
SET @alinear_sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `proforma_series` ADD INDEX `idx_proforma_series_company_active` (`company_id`,`is_active`)', 'DO 0') FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'proforma_series' AND index_name = 'idx_proforma_series_company_active');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;

-- warehouses
SET @alinear_sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `warehouses` ADD INDEX `idx_warehouses_company` (`company_id`)', 'DO 0') FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'warehouses' AND index_name = 'idx_warehouses_company');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;

SET @alinear_sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `warehouses` ADD INDEX `idx_warehouses_company_active` (`company_id`,`is_active`)', 'DO 0') FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'warehouses' AND index_name = 'idx_warehouses_company_active');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;

-- inventory_entries: sobrantes
SET @alinear_sql = (SELECT IF(COUNT(*) > 0, 'ALTER TABLE `inventory_entries` DROP INDEX `idx_inventory_entries_company_id`', 'DO 0') FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'inventory_entries' AND index_name = 'idx_inventory_entries_company_id');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;

SET @alinear_sql = (SELECT IF(COUNT(*) > 0, 'ALTER TABLE `inventory_entries` DROP INDEX `idx_inventory_entries_entry_date`', 'DO 0') FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'inventory_entries' AND index_name = 'idx_inventory_entries_entry_date');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;

SET @alinear_sql = (SELECT IF(COUNT(*) > 0, 'ALTER TABLE `inventory_entries` DROP INDEX `idx_inventory_entries_warehouse_id`', 'DO 0') FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'inventory_entries' AND index_name = 'idx_inventory_entries_warehouse_id');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;

-- inventory_entry_items: sobrantes
SET @alinear_sql = (SELECT IF(COUNT(*) > 0, 'ALTER TABLE `inventory_entry_items` DROP INDEX `idx_inventory_entry_items_entry_id`', 'DO 0') FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'inventory_entry_items' AND index_name = 'idx_inventory_entry_items_entry_id');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;

SET @alinear_sql = (SELECT IF(COUNT(*) > 0, 'ALTER TABLE `inventory_entry_items` DROP INDEX `idx_inventory_entry_items_product_id`', 'DO 0') FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'inventory_entry_items' AND index_name = 'idx_inventory_entry_items_product_id');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;

-- inventory_movements: sobrantes
SET @alinear_sql = (SELECT IF(COUNT(*) > 0, 'ALTER TABLE `inventory_movements` DROP INDEX `idx_inventory_movements_company_id`', 'DO 0') FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'inventory_movements' AND index_name = 'idx_inventory_movements_company_id');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;

SET @alinear_sql = (SELECT IF(COUNT(*) > 0, 'ALTER TABLE `inventory_movements` DROP INDEX `idx_inventory_movements_created_at`', 'DO 0') FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'inventory_movements' AND index_name = 'idx_inventory_movements_created_at');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;

SET @alinear_sql = (SELECT IF(COUNT(*) > 0, 'ALTER TABLE `inventory_movements` DROP INDEX `idx_inventory_movements_entry_id`', 'DO 0') FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'inventory_movements' AND index_name = 'idx_inventory_movements_entry_id');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;

SET @alinear_sql = (SELECT IF(COUNT(*) > 0, 'ALTER TABLE `inventory_movements` DROP INDEX `idx_inventory_movements_entry_item_id`', 'DO 0') FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'inventory_movements' AND index_name = 'idx_inventory_movements_entry_item_id');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;

SET @alinear_sql = (SELECT IF(COUNT(*) > 0, 'ALTER TABLE `inventory_movements` DROP INDEX `idx_inventory_movements_invoice_id`', 'DO 0') FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'inventory_movements' AND index_name = 'idx_inventory_movements_invoice_id');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;

SET @alinear_sql = (SELECT IF(COUNT(*) > 0, 'ALTER TABLE `inventory_movements` DROP INDEX `idx_inventory_movements_invoice_item_id`', 'DO 0') FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'inventory_movements' AND index_name = 'idx_inventory_movements_invoice_item_id');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;

SET @alinear_sql = (SELECT IF(COUNT(*) > 0, 'ALTER TABLE `inventory_movements` DROP INDEX `idx_inventory_movements_product_id`', 'DO 0') FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'inventory_movements' AND index_name = 'idx_inventory_movements_product_id');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;

SET @alinear_sql = (SELECT IF(COUNT(*) > 0, 'ALTER TABLE `inventory_movements` DROP INDEX `idx_inventory_movements_warehouse_id`', 'DO 0') FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'inventory_movements' AND index_name = 'idx_inventory_movements_warehouse_id');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;

-- invoice_items: sobrantes
SET @alinear_sql = (SELECT IF(COUNT(*) > 0, 'ALTER TABLE `invoice_items` DROP INDEX `idx_invoice_items_product_id`', 'DO 0') FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'invoice_items' AND index_name = 'idx_invoice_items_product_id');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;

-- products: sobrantes
SET @alinear_sql = (SELECT IF(COUNT(*) > 0, 'ALTER TABLE `products` DROP INDEX `idx_products_category_id`', 'DO 0') FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'products' AND index_name = 'idx_products_category_id');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;

SET @alinear_sql = (SELECT IF(COUNT(*) > 0, 'ALTER TABLE `products` DROP INDEX `idx_products_company_id`', 'DO 0') FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'products' AND index_name = 'idx_products_company_id');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;

SET @alinear_sql = (SELECT IF(COUNT(*) > 0, 'ALTER TABLE `products` DROP INDEX `idx_products_name`', 'DO 0') FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'products' AND index_name = 'idx_products_name');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;

SET @alinear_sql = (SELECT IF(COUNT(*) > 0, 'ALTER TABLE `products` DROP INDEX `uq_products_company_barcode`', 'DO 0') FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'products' AND index_name = 'uq_products_company_barcode');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;

-- product_categories: sobrantes
SET @alinear_sql = (SELECT IF(COUNT(*) > 0, 'ALTER TABLE `product_categories` DROP INDEX `idx_product_categories_company_id`', 'DO 0') FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'product_categories' AND index_name = 'idx_product_categories_company_id');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;

-- product_stocks: sobrantes
SET @alinear_sql = (SELECT IF(COUNT(*) > 0, 'ALTER TABLE `product_stocks` DROP INDEX `idx_product_stocks_company_id`', 'DO 0') FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'product_stocks' AND index_name = 'idx_product_stocks_company_id');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;

SET @alinear_sql = (SELECT IF(COUNT(*) > 0, 'ALTER TABLE `product_stocks` DROP INDEX `idx_product_stocks_product_id`', 'DO 0') FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'product_stocks' AND index_name = 'idx_product_stocks_product_id');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;

SET @alinear_sql = (SELECT IF(COUNT(*) > 0, 'ALTER TABLE `product_stocks` DROP INDEX `idx_product_stocks_warehouse_id`', 'DO 0') FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'product_stocks' AND index_name = 'idx_product_stocks_warehouse_id');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;

-- proformas: sobrantes
SET @alinear_sql = (SELECT IF(COUNT(*) > 0, 'ALTER TABLE `proformas` DROP INDEX `idx_proformas_approved_by`', 'DO 0') FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'proformas' AND index_name = 'idx_proformas_approved_by');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;

SET @alinear_sql = (SELECT IF(COUNT(*) > 0, 'ALTER TABLE `proformas` DROP INDEX `idx_proformas_converted_invoice_id`', 'DO 0') FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'proformas' AND index_name = 'idx_proformas_converted_invoice_id');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;

SET @alinear_sql = (SELECT IF(COUNT(*) > 0, 'ALTER TABLE `proformas` DROP INDEX `idx_proformas_customer_id`', 'DO 0') FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'proformas' AND index_name = 'idx_proformas_customer_id');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;

SET @alinear_sql = (SELECT IF(COUNT(*) > 0, 'ALTER TABLE `proformas` DROP INDEX `idx_proformas_series_id`', 'DO 0') FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'proformas' AND index_name = 'idx_proformas_series_id');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;

SET @alinear_sql = (SELECT IF(COUNT(*) > 0, 'ALTER TABLE `proformas` DROP INDEX `idx_proformas_warehouse_id`', 'DO 0') FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'proformas' AND index_name = 'idx_proformas_warehouse_id');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;

SET @alinear_sql = (SELECT IF(COUNT(*) > 0, 'ALTER TABLE `proformas` DROP INDEX `uq_proformas_company_sequence`', 'DO 0') FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'proformas' AND index_name = 'uq_proformas_company_sequence');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;

-- proforma_items: sobrantes
SET @alinear_sql = (SELECT IF(COUNT(*) > 0, 'ALTER TABLE `proforma_items` DROP INDEX `idx_proforma_items_product_id`', 'DO 0') FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'proforma_items' AND index_name = 'idx_proforma_items_product_id');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;

SET @alinear_sql = (SELECT IF(COUNT(*) > 0, 'ALTER TABLE `proforma_items` DROP INDEX `idx_proforma_items_proforma_id`', 'DO 0') FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'proforma_items' AND index_name = 'idx_proforma_items_proforma_id');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;

SET @alinear_sql = (SELECT IF(COUNT(*) > 0, 'ALTER TABLE `proforma_items` DROP INDEX `uq_proforma_items_line`', 'DO 0') FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'proforma_items' AND index_name = 'uq_proforma_items_line');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;

-- warehouses: sobrantes
SET @alinear_sql = (SELECT IF(COUNT(*) > 0, 'ALTER TABLE `warehouses` DROP INDEX `idx_warehouses_company_id`', 'DO 0') FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'warehouses' AND index_name = 'idx_warehouses_company_id');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;

-- Solo MySQL: la columna JSON nativa ya se valida sola; se quita el chequeo json_valid sobrante.
SET @alinear_sql = (SELECT IFNULL(MAX(CONCAT('ALTER TABLE `audit_logs` DROP CHECK `', tc.constraint_name, '`')), 'DO 0') FROM information_schema.table_constraints tc JOIN information_schema.check_constraints cc ON cc.constraint_schema = tc.constraint_schema AND cc.constraint_name = tc.constraint_name JOIN information_schema.columns c ON c.table_schema = tc.table_schema AND c.table_name = tc.table_name AND c.column_name = 'old_values' WHERE tc.table_schema = DATABASE() AND tc.table_name = 'audit_logs' AND tc.constraint_type = 'CHECK' AND c.data_type = 'json' AND cc.check_clause LIKE '%json_valid%old_values%');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;

SET @alinear_sql = (SELECT IFNULL(MAX(CONCAT('ALTER TABLE `audit_logs` DROP CHECK `', tc.constraint_name, '`')), 'DO 0') FROM information_schema.table_constraints tc JOIN information_schema.check_constraints cc ON cc.constraint_schema = tc.constraint_schema AND cc.constraint_name = tc.constraint_name JOIN information_schema.columns c ON c.table_schema = tc.table_schema AND c.table_name = tc.table_name AND c.column_name = 'new_values' WHERE tc.table_schema = DATABASE() AND tc.table_name = 'audit_logs' AND tc.constraint_type = 'CHECK' AND c.data_type = 'json' AND cc.check_clause LIKE '%json_valid%new_values%');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;

SET @alinear_sql = (SELECT IFNULL(MAX(CONCAT('ALTER TABLE `cash_sessions` DROP CHECK `', tc.constraint_name, '`')), 'DO 0') FROM information_schema.table_constraints tc JOIN information_schema.check_constraints cc ON cc.constraint_schema = tc.constraint_schema AND cc.constraint_name = tc.constraint_name JOIN information_schema.columns c ON c.table_schema = tc.table_schema AND c.table_name = tc.table_name AND c.column_name = 'opening_breakdown' WHERE tc.table_schema = DATABASE() AND tc.table_name = 'cash_sessions' AND tc.constraint_type = 'CHECK' AND c.data_type = 'json' AND cc.check_clause LIKE '%json_valid%opening_breakdown%');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;

SET @alinear_sql = (SELECT IFNULL(MAX(CONCAT('ALTER TABLE `cash_sessions` DROP CHECK `', tc.constraint_name, '`')), 'DO 0') FROM information_schema.table_constraints tc JOIN information_schema.check_constraints cc ON cc.constraint_schema = tc.constraint_schema AND cc.constraint_name = tc.constraint_name JOIN information_schema.columns c ON c.table_schema = tc.table_schema AND c.table_name = tc.table_name AND c.column_name = 'closing_breakdown' WHERE tc.table_schema = DATABASE() AND tc.table_name = 'cash_sessions' AND tc.constraint_type = 'CHECK' AND c.data_type = 'json' AND cc.check_clause LIKE '%json_valid%closing_breakdown%');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;

-- 3) Relaciones
SET @alinear_sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `inventory_movements` ADD CONSTRAINT `fk_inventory_movements_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON UPDATE CASCADE', 'DO 0') FROM information_schema.referential_constraints WHERE constraint_schema = DATABASE() AND constraint_name = 'fk_inventory_movements_created_by');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;

SET @alinear_sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `proformas` ADD CONSTRAINT `fk_proformas_converted_invoice` FOREIGN KEY (`converted_to_invoice_id`) REFERENCES `invoices` (`id`) ON DELETE SET NULL ON UPDATE CASCADE', 'DO 0') FROM information_schema.referential_constraints WHERE constraint_schema = DATABASE() AND constraint_name = 'fk_proformas_converted_invoice');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;

-- sesiones de caja -> caja: ON UPDATE RESTRICT. MySQL 8 no permite CASCADE en la base de una
-- columna calculada guardada (open_guard). Los id nunca cambian: no afecta al programa.
SET @alinear_fk = (SELECT COUNT(*) FROM information_schema.referential_constraints WHERE constraint_schema = DATABASE() AND constraint_name = 'fk_cash_sessions_register' AND update_rule <> 'RESTRICT');
SET @alinear_sql = IF(@alinear_fk > 0, 'ALTER TABLE `cash_sessions` DROP FOREIGN KEY `fk_cash_sessions_register`', 'DO 0');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;

SET @alinear_sql = IF(@alinear_fk > 0, 'ALTER TABLE `cash_sessions` ADD CONSTRAINT `fk_cash_sessions_register` FOREIGN KEY (`cash_register_id`) REFERENCES `cash_registers` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT', 'DO 0');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;

-- sesiones de caja -> usuario que abre: ON UPDATE RESTRICT (mismo motivo).
SET @alinear_fk = (SELECT COUNT(*) FROM information_schema.referential_constraints WHERE constraint_schema = DATABASE() AND constraint_name = 'fk_cash_sessions_opened_by' AND update_rule <> 'RESTRICT');
SET @alinear_sql = IF(@alinear_fk > 0, 'ALTER TABLE `cash_sessions` DROP FOREIGN KEY `fk_cash_sessions_opened_by`', 'DO 0');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;

SET @alinear_sql = IF(@alinear_fk > 0, 'ALTER TABLE `cash_sessions` ADD CONSTRAINT `fk_cash_sessions_opened_by` FOREIGN KEY (`opened_by`) REFERENCES `users` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT', 'DO 0');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;

-- facturas -> bodega: ON DELETE SET NULL
SET @alinear_fk = (SELECT COUNT(*) FROM information_schema.referential_constraints WHERE constraint_schema = DATABASE() AND constraint_name = 'fk_invoices_warehouse' AND delete_rule <> 'SET NULL');
SET @alinear_sql = IF(@alinear_fk > 0, 'ALTER TABLE `invoices` DROP FOREIGN KEY `fk_invoices_warehouse`', 'DO 0');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;

SET @alinear_sql = IF(@alinear_fk > 0, 'ALTER TABLE `invoices` ADD CONSTRAINT `fk_invoices_warehouse` FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses` (`id`) ON DELETE SET NULL ON UPDATE CASCADE', 'DO 0');
PREPARE alinear_stmt FROM @alinear_sql;
EXECUTE alinear_stmt;
DEALLOCATE PREPARE alinear_stmt;
