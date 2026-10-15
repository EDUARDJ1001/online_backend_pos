-- ============================================================
-- @actualiza-datos: rellena en las facturas ya emitidas la resolución de su propia serie (columna nueva).
-- Migración: 2026_09_17_000001_sar_billing_series
-- Base:  facturacion_multiempresa (MySQL 8 / MariaDB 10.4+)
-- Objetivo:
--   Completar los datos fiscales que exige el régimen de facturación
--   con CAI del SAR de Honduras:
--     - Tipos de documento adicionales a FACTURA
--     - Número y fecha de la resolución que autoriza el CAI
--     - Leyendas obligatorias del documento impreso
--     - Snapshot de la resolución en la factura emitida
--
-- Forward-only: los ALTER no son idempotentes. Ejecutar una sola vez.
-- ============================================================

USE facturacion_multiempresa;

SET NAMES utf8mb4;

-- ============================================================
-- 1) Tipos de documento autorizados por el SAR
--    Hasta ahora el ENUM solo admitía 'FACTURA'.
-- ============================================================

ALTER TABLE billing_series
  MODIFY COLUMN document_type
    ENUM('FACTURA', 'NOTA_CREDITO', 'NOTA_DEBITO', 'RECIBO')
    NOT NULL DEFAULT 'FACTURA';

-- ============================================================
-- 2) Resolución del SAR que respalda el CAI
--    Va impresa en el documento junto al CAI.
-- ============================================================

ALTER TABLE billing_series
  ADD COLUMN resolution_number VARCHAR(80) NULL AFTER cai,
  ADD COLUMN resolution_date DATE NULL AFTER resolution_number,
  ADD COLUMN notes VARCHAR(255) NULL AFTER is_active;

-- ============================================================
-- 3) Leyendas obligatorias del documento
--    Estaban ausentes del modelo y fijas en el renderizador.
-- ============================================================

ALTER TABLE billing_settings
  ADD COLUMN legend_original VARCHAR(120) NOT NULL DEFAULT 'Original: Cliente' AFTER invoice_title,
  ADD COLUMN legend_copy VARCHAR(120) NOT NULL DEFAULT 'Copia: Obligado Tributario' AFTER legend_original,
  ADD COLUMN sar_notice VARCHAR(255) NOT NULL DEFAULT 'La factura es beneficio de todos, ¡Exíjala!' AFTER legend_copy;

-- ============================================================
-- 4) Snapshot en la factura
--    El sistema congela CAI, fecha límite y rango en cada factura para
--    que el documento impreso no cambie. La resolución debe seguir la
--    misma regla, o al cambiar de CAI las facturas viejas mostrarían
--    una resolución que no era la suya.
-- ============================================================

ALTER TABLE invoices
  ADD COLUMN resolution_number_snapshot VARCHAR(80) NULL AFTER cai_snapshot;

-- Rellena las facturas ya emitidas con la resolución de su propia serie.
UPDATE invoices i
  INNER JOIN billing_series bs ON bs.id = i.billing_series_id
  SET i.resolution_number_snapshot = bs.resolution_number
  WHERE i.resolution_number_snapshot IS NULL;

-- ============================================================
-- 5) Índice para buscar series por vencimiento
--    La pantalla de configuración avisa cuáles están por vencer.
-- ============================================================

CREATE INDEX idx_billing_series_deadline ON billing_series (company_id, issue_deadline);

-- ============================================================
-- Fin de migración.
-- billing_series: +3 columnas · billing_settings: +3 · invoices: +1
-- ============================================================
