-- ============================================================
-- Migración: 2026_09_24_000002_document_counters
-- Base:  facturacion_multiempresa (MySQL 8 / MariaDB 10.4+)
-- Objetivo:
--   Correlativos de recibos (abonos REC-, pagos PG-) sin repetirse aunque varias
--   cajas (o varios backends) registren a la vez:
--     - document_counters: contador por empresa y tipo, que se bloquea
--       (FOR UPDATE) al tomar el siguiente número, igual que las series del CAI
--     - Número de recibo único por empresa (también para los escritos a mano)
--
-- Forward-only. Ejecutar una sola vez, después de 2026_09_24_000001.
-- Si falla el índice único, hay recibos repetidos: corregirlos antes.
-- ============================================================

USE facturacion_multiempresa;

SET NAMES utf8mb4;

CREATE TABLE document_counters (
  company_id BIGINT UNSIGNED NOT NULL,
  counter_key VARCHAR(40) NOT NULL,
  `last_value` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (company_id, counter_key),

  CONSTRAINT fk_document_counters_company
    FOREIGN KEY (company_id) REFERENCES companies (id)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB;

ALTER TABLE invoice_payments
  ADD UNIQUE KEY uq_invoice_payments_receipt (company_id, receipt_number);

ALTER TABLE payable_payments
  ADD UNIQUE KEY uq_payable_payments_receipt (company_id, receipt_number);

-- ============================================================
-- Fin de migración.
-- +tabla document_counters · recibos únicos por empresa
-- ============================================================
