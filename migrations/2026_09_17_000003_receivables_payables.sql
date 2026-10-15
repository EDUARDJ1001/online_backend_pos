-- ============================================================
-- @actualiza-datos: las facturas existentes quedan como contado pagado (columnas nuevas de saldo y tipo de venta).
-- Migración: 2026_09_17_000003_receivables_payables
-- Base:  facturacion_multiempresa (MySQL 8 / MariaDB 10.4+)
-- Objetivo:
--   Cuentas por cobrar (CxC) y cuentas por pagar (CxP):
--     - Facturas con tipo de venta, vencimiento, pagado, saldo y estado de pago
--     - Maestro de proveedores
--     - Documentos por pagar (deuda a proveedores, manual)
--     - Abonos (pagos parciales) de facturas y de documentos por pagar
--
-- Forward-only: los ALTER no son idempotentes. Ejecutar una sola vez.
-- ============================================================

USE facturacion_multiempresa;

SET NAMES utf8mb4;

-- ============================================================
-- 1) Campos de cuentas por cobrar en la factura
-- ============================================================

ALTER TABLE invoices
  ADD COLUMN sale_type ENUM('CONTADO','CREDITO') NOT NULL DEFAULT 'CONTADO' AFTER status,
  ADD COLUMN due_date DATE NULL AFTER sale_type,
  ADD COLUMN paid_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00 AFTER due_date,
  ADD COLUMN balance DECIMAL(14,2) NOT NULL DEFAULT 0.00 AFTER paid_amount,
  ADD COLUMN payment_status ENUM('PENDIENTE','PARCIAL','PAGADA','ANULADA') NOT NULL DEFAULT 'PAGADA' AFTER balance;

CREATE INDEX idx_invoices_payment_status ON invoices (company_id, payment_status);

-- Backfill: las facturas históricas se tratan como contado pagado (sin deuda fantasma).
UPDATE invoices
  SET paid_amount = grand_total,
      balance = 0.00,
      payment_status = IF(status = 'ANULADA', 'ANULADA', 'PAGADA'),
      sale_type = 'CONTADO';

-- ============================================================
-- 2) Proveedores (maestro), espejo de clients
-- ============================================================

CREATE TABLE suppliers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  code VARCHAR(30) NULL,
  name VARCHAR(180) NOT NULL,
  rtn VARCHAR(30) NULL,
  email VARCHAR(150) NULL,
  phone VARCHAR(40) NULL,
  address VARCHAR(255) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_suppliers_company_code (company_id, code),
  KEY idx_suppliers_company_name (company_id, name),
  KEY idx_suppliers_company_rtn (company_id, rtn),
  KEY idx_suppliers_created_by (created_by),

  CONSTRAINT fk_suppliers_company
    FOREIGN KEY (company_id) REFERENCES companies (id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_suppliers_created_by
    FOREIGN KEY (created_by) REFERENCES users (id)
    ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB;

-- ============================================================
-- 3) Documentos por pagar (deuda a proveedores)
-- ============================================================

CREATE TABLE payable_documents (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  supplier_id BIGINT UNSIGNED NOT NULL,
  document_number VARCHAR(60) NOT NULL,
  document_date DATE NOT NULL,
  due_date DATE NULL,
  description VARCHAR(255) NULL,
  total DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  paid_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  balance DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  status ENUM('PENDIENTE','PARCIAL','PAGADA','ANULADA') NOT NULL DEFAULT 'PENDIENTE',
  notes TEXT NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_payable_documents_number (company_id, supplier_id, document_number),
  KEY idx_payable_documents_company_status (company_id, status),
  KEY idx_payable_documents_supplier (supplier_id),
  KEY idx_payable_documents_due (company_id, due_date),

  CONSTRAINT fk_payable_documents_company
    FOREIGN KEY (company_id) REFERENCES companies (id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_payable_documents_supplier
    FOREIGN KEY (supplier_id) REFERENCES suppliers (id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_payable_documents_created_by
    FOREIGN KEY (created_by) REFERENCES users (id)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB;

-- ============================================================
-- 4) Abonos (pagos parciales)
-- ============================================================

CREATE TABLE invoice_payments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  invoice_id BIGINT UNSIGNED NOT NULL,
  receipt_number VARCHAR(40) NULL,
  payment_date DATE NOT NULL,
  amount DECIMAL(14,2) NOT NULL,
  method ENUM('EFECTIVO','TRANSFERENCIA','CHEQUE','TARJETA','OTRO') NOT NULL DEFAULT 'EFECTIVO',
  reference VARCHAR(120) NULL,
  notes VARCHAR(255) NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  KEY idx_invoice_payments_invoice (invoice_id),
  KEY idx_invoice_payments_company_date (company_id, payment_date),

  CONSTRAINT fk_invoice_payments_company
    FOREIGN KEY (company_id) REFERENCES companies (id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_invoice_payments_invoice
    FOREIGN KEY (invoice_id) REFERENCES invoices (id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_invoice_payments_created_by
    FOREIGN KEY (created_by) REFERENCES users (id)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE payable_payments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  payable_document_id BIGINT UNSIGNED NOT NULL,
  receipt_number VARCHAR(40) NULL,
  payment_date DATE NOT NULL,
  amount DECIMAL(14,2) NOT NULL,
  method ENUM('EFECTIVO','TRANSFERENCIA','CHEQUE','TARJETA','OTRO') NOT NULL DEFAULT 'EFECTIVO',
  reference VARCHAR(120) NULL,
  notes VARCHAR(255) NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  KEY idx_payable_payments_document (payable_document_id),
  KEY idx_payable_payments_company_date (company_id, payment_date),

  CONSTRAINT fk_payable_payments_company
    FOREIGN KEY (company_id) REFERENCES companies (id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_payable_payments_document
    FOREIGN KEY (payable_document_id) REFERENCES payable_documents (id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_payable_payments_created_by
    FOREIGN KEY (created_by) REFERENCES users (id)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB;

-- ============================================================
-- Fin de migración.
-- invoices: +5 columnas · +tablas suppliers, payable_documents,
-- invoice_payments, payable_payments
-- ============================================================
