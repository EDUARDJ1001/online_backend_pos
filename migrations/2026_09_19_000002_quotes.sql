-- Persistencia de cotizaciones.
-- Antes las cotizaciones solo generaban un PDF al vuelo (sin historial, sin folio,
-- sin conversión a factura). Se agregan tablas con el mismo patrón que proformas:
-- serie/numeración por empresa, estados y conversión a factura.

CREATE TABLE IF NOT EXISTS quote_series (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  prefix VARCHAR(10) NOT NULL DEFAULT 'COT-',
  current_number INT UNSIGNED NOT NULL DEFAULT 1,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_quote_series_company (company_id),
  KEY idx_quote_series_company_active (company_id, is_active),
  CONSTRAINT fk_quote_series_company
    FOREIGN KEY (company_id) REFERENCES companies (id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS quotes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  quote_series_id BIGINT UNSIGNED NOT NULL,
  customer_id BIGINT UNSIGNED NULL,
  warehouse_id BIGINT UNSIGNED NULL,

  sequence_number INT UNSIGNED NOT NULL,
  quote_number VARCHAR(30) NOT NULL,
  quote_date DATE NOT NULL,
  valid_until DATE NULL,

  customer_name_snapshot VARCHAR(180) NOT NULL,
  customer_rtn_snapshot VARCHAR(30) NULL,
  customer_email_snapshot VARCHAR(150) NULL,
  customer_phone_snapshot VARCHAR(40) NULL,
  customer_address_snapshot VARCHAR(255) NULL,

  subtotal DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  discount_total DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  taxable_amount_15 DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  taxable_amount_18 DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  exempt_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  exonerated_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  isv_15 DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  isv_18 DECIMAL(14,2) NOT NULL DEFAULT 0.00,
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
  UNIQUE KEY uq_quotes_company_number (company_id, quote_number),
  KEY idx_quotes_company_date (company_id, quote_date),
  KEY idx_quotes_company_status (company_id, status),
  KEY idx_quotes_customer (customer_id),
  KEY idx_quotes_series (quote_series_id),
  KEY idx_quotes_warehouse (warehouse_id),
  KEY idx_quotes_converted (converted_to_invoice_id),
  KEY idx_quotes_created_by (created_by),
  CONSTRAINT fk_quotes_company
    FOREIGN KEY (company_id) REFERENCES companies (id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  CONSTRAINT fk_quotes_series
    FOREIGN KEY (quote_series_id) REFERENCES quote_series (id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  CONSTRAINT fk_quotes_customer
    FOREIGN KEY (customer_id) REFERENCES clients (id)
    ON UPDATE CASCADE
    ON DELETE SET NULL,
  CONSTRAINT fk_quotes_warehouse
    FOREIGN KEY (warehouse_id) REFERENCES warehouses (id)
    ON UPDATE CASCADE
    ON DELETE SET NULL,
  CONSTRAINT fk_quotes_converted_invoice
    FOREIGN KEY (converted_to_invoice_id) REFERENCES invoices (id)
    ON UPDATE CASCADE
    ON DELETE SET NULL,
  CONSTRAINT fk_quotes_approved_by
    FOREIGN KEY (approved_by) REFERENCES users (id)
    ON UPDATE CASCADE
    ON DELETE SET NULL,
  CONSTRAINT fk_quotes_created_by
    FOREIGN KEY (created_by) REFERENCES users (id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS quote_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  quote_id BIGINT UNSIGNED NOT NULL,
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
  UNIQUE KEY uq_quote_items_quote_line (quote_id, line_number),
  KEY idx_quote_items_quote (quote_id),
  KEY idx_quote_items_product (product_id),
  CONSTRAINT fk_quote_items_quote
    FOREIGN KEY (quote_id) REFERENCES quotes (id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,
  CONSTRAINT fk_quote_items_product
    FOREIGN KEY (product_id) REFERENCES products (id)
    ON UPDATE CASCADE
    ON DELETE SET NULL
) ENGINE=InnoDB;
