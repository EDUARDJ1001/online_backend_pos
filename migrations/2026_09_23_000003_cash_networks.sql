-- ============================================================
-- Migración: 2026_09_23_000003_cash_networks
-- Base:  facturacion_multiempresa (MySQL 8 / MariaDB 10.4+)
-- Objetivo:
--   Verificación extra por IP para los equipos de caja:
--     - cash_network_rules: redes/IP autorizadas por empresa (CIDR). Sin
--       reglas no hay restricción; con reglas, los equipos solo registran,
--       vinculan y operan caja desde esas redes.
--     - cash_terminals: IP desde la que se registró y la del último uso.
--
-- Forward-only. Ejecutar una sola vez, después de 2026_09_23_000002.
-- ============================================================

USE facturacion_multiempresa;

SET NAMES utf8mb4;

CREATE TABLE cash_network_rules (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  cidr VARCHAR(64) NOT NULL,
  label VARCHAR(80) NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_cash_network_rules (company_id, cidr),

  CONSTRAINT fk_cash_network_rules_company
    FOREIGN KEY (company_id) REFERENCES companies (id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_cash_network_rules_created_by
    FOREIGN KEY (created_by) REFERENCES users (id)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB;

ALTER TABLE cash_terminals
  ADD COLUMN registered_ip VARCHAR(45) NULL AFTER registered_by,
  ADD COLUMN last_ip VARCHAR(45) NULL AFTER last_seen_at;

-- ============================================================
-- Fin de migración.
-- +tabla cash_network_rules · cash_terminals: +registered_ip, +last_ip
-- ============================================================
