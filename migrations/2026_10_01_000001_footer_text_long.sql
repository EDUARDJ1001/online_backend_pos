-- ============================================================
-- Migración: 2026_10_01_000001_footer_text_long
-- Base:  MySQL 8 / MariaDB 10.4+
-- Objetivo:
--   Pie de factura sin el límite de 255 caracteres, para frases largas o dibujos
--   hechos con caracteres (varias líneas). Solo amplía la columna: los textos que
--   ya existen quedan iguales.
--
-- Versión SQL Server: migrations-mssql/ (mismo nombre de archivo).
-- Forward-only. Ejecutar una sola vez, después de 2026_09_30_000001.
-- ============================================================

ALTER TABLE billing_settings
  MODIFY COLUMN footer_text TEXT NULL;
