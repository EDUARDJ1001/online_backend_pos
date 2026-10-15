-- ============================================================
-- Migración: 2026_09_25_000001_company_document_branding
-- Base:  facturacion_multiempresa (MySQL 8 / MariaDB 10.4+)
-- Objetivo:
--   Identidad de los documentos por empresa, sin reglas fijas por nombre:
--     - document_color: color de facturas, proformas y cotizaciones
--       (si es NULL se usa el color principal de la empresa).
--     - footer_brands: imágenes del pie de página (marcas que representa la
--       empresa), arreglo JSON de data URIs. NULL o vacío = sin franja.
--
-- Forward-only. Ejecutar una sola vez, después de 2026_09_24_000003.
-- ============================================================

USE facturacion_multiempresa;

SET NAMES utf8mb4;

ALTER TABLE companies
  ADD COLUMN document_color VARCHAR(20) NULL AFTER header_color,
  ADD COLUMN footer_brands LONGTEXT NULL AFTER favicon_url;

-- ============================================================
-- Fin de migración.
-- +companies.document_color, +companies.footer_brands
-- ============================================================
