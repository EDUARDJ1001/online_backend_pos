-- ============================================================
-- Migración: 2026_09_23_000004_cash_network_per_register
-- Base:  facturacion_multiempresa (MySQL 8 / MariaDB 10.4+)
-- Objetivo:
--   Red autorizada por caja: una regla aplica a todas las cajas de la empresa
--   (cash_register_id NULL) o solo a una caja. Un equipo se valida contra las
--   reglas generales + las de su caja; sin reglas aplicables no hay restricción.
--
-- Forward-only. Ejecutar una sola vez, después de 2026_09_23_000003.
-- ============================================================

USE facturacion_multiempresa;

SET NAMES utf8mb4;

ALTER TABLE cash_network_rules
  ADD COLUMN cash_register_id BIGINT UNSIGNED NULL AFTER company_id,
  DROP INDEX uq_cash_network_rules,
  ADD KEY idx_cash_network_rules_scope (company_id, cash_register_id),
  ADD CONSTRAINT fk_cash_network_rules_register
    FOREIGN KEY (cash_register_id) REFERENCES cash_registers (id)
    ON UPDATE CASCADE ON DELETE CASCADE;

-- ============================================================
-- Fin de migración.
-- cash_network_rules: +cash_register_id (NULL = todas las cajas)
-- ============================================================
