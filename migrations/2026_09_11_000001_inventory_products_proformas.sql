-- ============================================================
-- Migración: 2026_09_11_000001_inventory_products_proformas
-- Base:  facturacion_multiempresa (MySQL 8+)
-- Objetivo:
--   Llevar el esquema base (facturacion_multiempresa_mysql.sql, 12 tablas)
--   al esquema actual en producción (21 tablas + vista), agregando:
--     - Catálogo de productos e inventario
--     - Almacenes y stock por almacén
--     - Proformas / cotizaciones
--     - Columnas nuevas en invoices e invoice_items
--     - Vista de reimpresión actualizada
--
-- Migración de una sola pasada (forward-only). MySQL 8 no soporta
-- ADD COLUMN IF NOT EXISTS: ejecutar solo sobre una BD en el esquema base.
-- ============================================================

USE facturacion_multiempresa;

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ============================================================
-- 1) Catálogo de productos
-- ============================================================

CREATE TABLE IF NOT EXISTS product_categories (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(120) NOT NULL,
  description VARCHAR(255) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_product_categories_company_name (company_id, name),
  KEY idx_product_categories_company (company_id),
  CONSTRAINT fk_product_categories_company
    FOREIGN KEY (company_id) REFERENCES companies (id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS products (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  category_id BIGINT UNSIGNED NULL,
  code VARCHAR(40) NOT NULL,
  barcode VARCHAR(60) NULL,
  name VARCHAR(180) NOT NULL,
  description VARCHAR(255) NULL,
  image_url VARCHAR(255) NULL,
  type ENUM('PRODUCTO','SERVICIO') NOT NULL DEFAULT 'PRODUCTO',
  unit_measure VARCHAR(30) NOT NULL DEFAULT 'UND',
  sale_price DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  cost_price DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  taxable TINYINT(1) NOT NULL DEFAULT 1,
  tax_rate DECIMAL(5,2) NOT NULL DEFAULT 15.00,
  controls_stock TINYINT(1) NOT NULL DEFAULT 0,
  min_stock DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_products_company_code (company_id, code),
  KEY idx_products_company_name (company_id, name),
  KEY idx_products_company_barcode (company_id, barcode),
  KEY idx_products_category (category_id),
  KEY idx_products_created_by (created_by),
  CONSTRAINT fk_products_company
    FOREIGN KEY (company_id) REFERENCES companies (id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,
  CONSTRAINT fk_products_category
    FOREIGN KEY (category_id) REFERENCES product_categories (id)
    ON UPDATE CASCADE
    ON DELETE SET NULL,
  CONSTRAINT fk_products_created_by
    FOREIGN KEY (created_by) REFERENCES users (id)
    ON UPDATE CASCADE
    ON DELETE SET NULL
) ENGINE=InnoDB;

-- ============================================================
-- 2) Almacenes y stock
-- ============================================================

CREATE TABLE IF NOT EXISTS warehouses (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  code VARCHAR(30) NOT NULL,
  name VARCHAR(120) NOT NULL,
  address VARCHAR(255) NULL,
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_warehouses_company_code (company_id, code),
  KEY idx_warehouses_company (company_id),
  KEY idx_warehouses_company_active (company_id, is_active),
  CONSTRAINT fk_warehouses_company
    FOREIGN KEY (company_id) REFERENCES companies (id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS product_stocks (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  warehouse_id BIGINT UNSIGNED NOT NULL,
  stock_quantity DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_product_stocks_product_warehouse (product_id, warehouse_id),
  KEY idx_product_stocks_company (company_id),
  KEY idx_product_stocks_warehouse (warehouse_id),
  CONSTRAINT fk_product_stocks_company
    FOREIGN KEY (company_id) REFERENCES companies (id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,
  CONSTRAINT fk_product_stocks_product
    FOREIGN KEY (product_id) REFERENCES products (id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,
  CONSTRAINT fk_product_stocks_warehouse
    FOREIGN KEY (warehouse_id) REFERENCES warehouses (id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
) ENGINE=InnoDB;

-- ============================================================
-- 3) Proformas / cotizaciones
--    (proforma_series ya existe en el esquema base)
-- ============================================================

CREATE TABLE IF NOT EXISTS proformas (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  proforma_series_id BIGINT UNSIGNED NOT NULL,
  customer_id BIGINT UNSIGNED NULL,
  warehouse_id BIGINT UNSIGNED NULL,

  sequence_number INT UNSIGNED NOT NULL,
  proforma_number VARCHAR(30) NOT NULL,
  proforma_date DATE NOT NULL,
  valid_until DATE NULL,

  customer_name_snapshot VARCHAR(180) NOT NULL,
  customer_rtn_snapshot VARCHAR(30) NULL,
  customer_phone_snapshot VARCHAR(40) NULL,
  customer_address_snapshot VARCHAR(255) NULL,

  subtotal DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  discount_total DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  taxable_amount_15 DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  exempt_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  exonerated_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  isv_15 DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  tax_total DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  grand_total DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  total_in_words VARCHAR(255) NULL,

  status ENUM('BORRADOR','ENVIADA','APROBADA','RECHAZADA','VENCIDA','FACTURADA')
    NOT NULL DEFAULT 'BORRADOR',
  approved_at DATETIME NULL,
  approved_by BIGINT UNSIGNED NULL,
  converted_to_invoice_id BIGINT UNSIGNED NULL,

  notes TEXT NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_proformas_company_number (company_id, proforma_number),
  KEY idx_proformas_company_date (company_id, proforma_date),
  KEY idx_proformas_company_status (company_id, status),
  KEY idx_proformas_customer (customer_id),
  KEY idx_proformas_series (proforma_series_id),
  KEY idx_proformas_warehouse (warehouse_id),
  KEY idx_proformas_converted (converted_to_invoice_id),
  KEY idx_proformas_created_by (created_by),
  CONSTRAINT fk_proformas_company
    FOREIGN KEY (company_id) REFERENCES companies (id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  CONSTRAINT fk_proformas_series
    FOREIGN KEY (proforma_series_id) REFERENCES proforma_series (id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  CONSTRAINT fk_proformas_customer
    FOREIGN KEY (customer_id) REFERENCES clients (id)
    ON UPDATE CASCADE
    ON DELETE SET NULL,
  CONSTRAINT fk_proformas_warehouse
    FOREIGN KEY (warehouse_id) REFERENCES warehouses (id)
    ON UPDATE CASCADE
    ON DELETE SET NULL,
  CONSTRAINT fk_proformas_converted_invoice
    FOREIGN KEY (converted_to_invoice_id) REFERENCES invoices (id)
    ON UPDATE CASCADE
    ON DELETE SET NULL,
  CONSTRAINT fk_proformas_approved_by
    FOREIGN KEY (approved_by) REFERENCES users (id)
    ON UPDATE CASCADE
    ON DELETE SET NULL,
  CONSTRAINT fk_proformas_created_by
    FOREIGN KEY (created_by) REFERENCES users (id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS proforma_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  proforma_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NULL,
  line_number INT UNSIGNED NOT NULL,
  quantity DECIMAL(12,2) NOT NULL DEFAULT 1.00,
  description VARCHAR(255) NOT NULL,
  unit_price DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  unit_cost_snapshot DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  tax_rate DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  line_discount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  line_subtotal DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  line_tax DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  line_total DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  affects_inventory TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_proforma_items_proforma_line (proforma_id, line_number),
  KEY idx_proforma_items_proforma (proforma_id),
  KEY idx_proforma_items_product (product_id),
  CONSTRAINT fk_proforma_items_proforma
    FOREIGN KEY (proforma_id) REFERENCES proformas (id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,
  CONSTRAINT fk_proforma_items_product
    FOREIGN KEY (product_id) REFERENCES products (id)
    ON UPDATE CASCADE
    ON DELETE SET NULL
) ENGINE=InnoDB;

-- ============================================================
-- 4) Inventario: entradas y kardex de movimientos
-- ============================================================

CREATE TABLE IF NOT EXISTS inventory_entries (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  warehouse_id BIGINT UNSIGNED NOT NULL,
  entry_date DATE NOT NULL,
  supplier_name VARCHAR(180) NULL,
  document_number VARCHAR(60) NULL,
  notes TEXT NULL,
  status ENUM('APLICADA','ANULADA') NOT NULL DEFAULT 'APLICADA',
  created_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  KEY idx_inventory_entries_company_date (company_id, entry_date),
  KEY idx_inventory_entries_warehouse (warehouse_id),
  KEY idx_inventory_entries_created_by (created_by),
  CONSTRAINT fk_inventory_entries_company
    FOREIGN KEY (company_id) REFERENCES companies (id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,
  CONSTRAINT fk_inventory_entries_warehouse
    FOREIGN KEY (warehouse_id) REFERENCES warehouses (id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  CONSTRAINT fk_inventory_entries_created_by
    FOREIGN KEY (created_by) REFERENCES users (id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS inventory_entry_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  entry_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  quantity DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  unit_cost DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  total_cost DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  KEY idx_inventory_entry_items_entry (entry_id),
  KEY idx_inventory_entry_items_product (product_id),
  CONSTRAINT fk_inventory_entry_items_entry
    FOREIGN KEY (entry_id) REFERENCES inventory_entries (id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,
  CONSTRAINT fk_inventory_entry_items_product
    FOREIGN KEY (product_id) REFERENCES products (id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS inventory_movements (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  warehouse_id BIGINT UNSIGNED NOT NULL,
  movement_type ENUM(
    'STOCK_INICIAL','ENTRADA','SALIDA',
    'AJUSTE_POSITIVO','AJUSTE_NEGATIVO',
    'VENTA','ANULACION_VENTA'
  ) NOT NULL,
  source_type ENUM('MANUAL','ENTRADA','FACTURA','AJUSTE') NOT NULL,
  invoice_id BIGINT UNSIGNED NULL,
  invoice_item_id BIGINT UNSIGNED NULL,
  entry_id BIGINT UNSIGNED NULL,
  entry_item_id BIGINT UNSIGNED NULL,
  quantity DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  unit_cost DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  unit_price DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  stock_before DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  stock_after DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  notes VARCHAR(255) NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  KEY idx_inventory_movements_company (company_id),
  KEY idx_inventory_movements_product (product_id),
  KEY idx_inventory_movements_warehouse (warehouse_id),
  KEY idx_inventory_movements_product_warehouse (product_id, warehouse_id),
  KEY idx_inventory_movements_invoice (invoice_id),
  KEY idx_inventory_movements_invoice_item (invoice_item_id),
  KEY idx_inventory_movements_entry (entry_id),
  KEY idx_inventory_movements_entry_item (entry_item_id),
  KEY idx_inventory_movements_created_by (created_by),
  CONSTRAINT fk_inventory_movements_company
    FOREIGN KEY (company_id) REFERENCES companies (id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,
  CONSTRAINT fk_inventory_movements_product
    FOREIGN KEY (product_id) REFERENCES products (id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  CONSTRAINT fk_inventory_movements_warehouse
    FOREIGN KEY (warehouse_id) REFERENCES warehouses (id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  CONSTRAINT fk_inventory_movements_invoice
    FOREIGN KEY (invoice_id) REFERENCES invoices (id)
    ON UPDATE CASCADE
    ON DELETE SET NULL,
  CONSTRAINT fk_inventory_movements_invoice_item
    FOREIGN KEY (invoice_item_id) REFERENCES invoice_items (id)
    ON UPDATE CASCADE
    ON DELETE SET NULL,
  CONSTRAINT fk_inventory_movements_entry
    FOREIGN KEY (entry_id) REFERENCES inventory_entries (id)
    ON UPDATE CASCADE
    ON DELETE SET NULL,
  CONSTRAINT fk_inventory_movements_entry_item
    FOREIGN KEY (entry_item_id) REFERENCES inventory_entry_items (id)
    ON UPDATE CASCADE
    ON DELETE SET NULL
) ENGINE=InnoDB;

-- ============================================================
-- 5) Columnas nuevas en invoices
--    (warehouse_id, source_proforma_id)
-- ============================================================

ALTER TABLE invoices
  ADD COLUMN warehouse_id BIGINT UNSIGNED NULL AFTER customer_id,
  ADD COLUMN source_proforma_id BIGINT UNSIGNED NULL AFTER warehouse_id,
  ADD KEY idx_invoices_warehouse_id (warehouse_id),
  ADD KEY idx_invoices_source_proforma_id (source_proforma_id),
  ADD CONSTRAINT fk_invoices_warehouse
    FOREIGN KEY (warehouse_id) REFERENCES warehouses (id)
    ON UPDATE CASCADE
    ON DELETE SET NULL,
  ADD CONSTRAINT fk_invoices_source_proforma
    FOREIGN KEY (source_proforma_id) REFERENCES proformas (id)
    ON UPDATE CASCADE
    ON DELETE SET NULL;

-- ============================================================
-- 6) Columnas nuevas en invoice_items
--    (product_id, unit_cost_snapshot, tax_rate,
--     line_subtotal, line_tax, affects_inventory)
-- ============================================================

ALTER TABLE invoice_items
  ADD COLUMN product_id BIGINT UNSIGNED NULL AFTER invoice_id,
  ADD COLUMN unit_cost_snapshot DECIMAL(14,2) NOT NULL DEFAULT 0.00 AFTER unit_price,
  ADD COLUMN tax_rate DECIMAL(5,2) NOT NULL DEFAULT 0.00 AFTER unit_cost_snapshot,
  ADD COLUMN line_subtotal DECIMAL(14,2) NOT NULL DEFAULT 0.00 AFTER line_discount,
  ADD COLUMN line_tax DECIMAL(14,2) NOT NULL DEFAULT 0.00 AFTER line_subtotal,
  ADD COLUMN affects_inventory TINYINT(1) NOT NULL DEFAULT 0 AFTER line_total,
  ADD KEY idx_invoice_items_product (product_id),
  ADD CONSTRAINT fk_invoice_items_product
    FOREIGN KEY (product_id) REFERENCES products (id)
    ON UPDATE CASCADE
    ON DELETE SET NULL;

-- ============================================================
-- 7) Vista de reimpresión (recrear, sin cambios estructurales)
-- ============================================================

CREATE OR REPLACE VIEW vw_invoice_print_projection AS
SELECT
  i.id AS invoice_id,
  i.company_id,
  i.invoice_number,
  i.sequence_number,
  i.status,

  COALESCE(ic.new_customer_name, i.customer_name_snapshot) AS print_customer_name,
  COALESCE(ic.new_invoice_date, i.invoice_date) AS print_invoice_date,

  i.customer_name_snapshot AS original_customer_name,
  i.invoice_date AS original_invoice_date,

  i.customer_rtn_snapshot,
  i.customer_phone_snapshot,
  i.customer_address_snapshot,

  i.company_legal_name_snapshot,
  i.company_commercial_name_snapshot,
  i.company_rtn_snapshot,
  i.company_email_snapshot,
  i.company_phone_snapshot,
  i.company_address_snapshot,

  i.cai_snapshot,
  i.issue_deadline_snapshot,
  i.range_start_snapshot,
  i.range_end_snapshot,

  i.subtotal,
  i.discount_total,
  i.taxable_amount_15,
  i.exempt_amount,
  i.exonerated_amount,
  i.isv_15,
  i.tax_total,
  i.grand_total,
  i.total_in_words,
  i.notes,
  i.created_by,
  i.created_at,
  i.updated_at
FROM invoices i
LEFT JOIN (
  SELECT c1.*
  FROM invoice_corrections c1
  INNER JOIN (
    SELECT invoice_id, MAX(id) AS max_id
    FROM invoice_corrections
    WHERE status = 'APLICADA'
    GROUP BY invoice_id
  ) x
    ON c1.id = x.max_id
) ic
  ON ic.invoice_id = i.id;

SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================
-- Fin de migración. Resultado: 21 tablas + 1 vista.
-- Nuevas tablas: product_categories, products, warehouses,
--   product_stocks, proformas, proforma_items,
--   inventory_entries, inventory_entry_items, inventory_movements.
-- ============================================================
