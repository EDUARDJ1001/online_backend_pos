-- ============================================================
-- Migración: 2026_09_17_000002_company_profile_logo
-- Base:  facturacion_multiempresa (MySQL 8 / MariaDB 10.4+)
-- Objetivo:
--   Permitir editar los datos de la empresa desde la aplicación,
--   incluido el logo. El logo se guarda como data URI (base64), que
--   no cabe en VARCHAR(255); se amplían logo_url y favicon_url.
--
-- Forward-only: los ALTER no son idempotentes. Ejecutar una sola vez.
-- ============================================================

USE facturacion_multiempresa;

SET NAMES utf8mb4;

-- ============================================================
-- 1) Logo/favicon como data URI
--    Antes VARCHAR(255): solo alcanzaba para una ruta corta.
--    MEDIUMTEXT admite el data URI base64 de una imagen.
-- ============================================================

ALTER TABLE companies
  MODIFY COLUMN logo_url MEDIUMTEXT NULL,
  MODIFY COLUMN favicon_url MEDIUMTEXT NULL;

-- ============================================================
-- Fin de migración.
-- companies: logo_url y favicon_url -> MEDIUMTEXT
-- ============================================================
