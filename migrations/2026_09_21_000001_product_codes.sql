-- ============================================================
-- @actualiza-datos: copia los códigos de barra existentes a la tabla de códigos.
-- Migración: 2026_09_21_000001_product_codes
-- Base:  facturacion_multiempresa (MySQL 8 / MariaDB 10.4+)
-- Objetivo:
--   Varios códigos por producto (barras o manuales) en tabla dedicada.
--   Se puede buscar/facturar por cualquiera de los códigos.
--   El `code` de products sigue siendo el SKU interno.
--
-- Forward-only. Ejecutar una sola vez.
-- ============================================================

USE facturacion_multiempresa;

SET NAMES utf8mb4;

CREATE TABLE product_codes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  code VARCHAR(60) NOT NULL,
  code_type ENUM('BARRA','MANUAL') NOT NULL DEFAULT 'MANUAL',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  -- Un código apunta a un solo producto dentro de la empresa (evita escaneos ambiguos).
  UNIQUE KEY uq_product_codes_company_code (company_id, code),
  KEY idx_product_codes_product (product_id),

  CONSTRAINT fk_product_codes_company
    FOREIGN KEY (company_id) REFERENCES companies (id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_product_codes_product
    FOREIGN KEY (product_id) REFERENCES products (id)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB;

-- Migra los barcodes existentes como códigos de barra (IGNORE por si hay duplicados).
INSERT IGNORE INTO product_codes (company_id, product_id, code, code_type)
SELECT company_id, id, barcode, 'BARRA'
FROM products
WHERE barcode IS NOT NULL AND barcode <> '';

-- ============================================================
-- Fin de migración. +tabla product_codes (+migración de barcodes)
-- ============================================================
