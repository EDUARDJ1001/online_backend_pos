-- ============================================================
-- Migración: 2026_09_23_000002_cash_terminal_pairings
-- Base:  facturacion_multiempresa (MySQL 8 / MariaDB 10.4+)
-- Objetivo:
--   Vincular un equipo a una caja con un código de un solo uso:
--     - El administrador genera el código para una caja (desde cualquier PC)
--     - En la PC de la caja, cualquier usuario lo ingresa y el equipo queda
--       registrado (sin iniciar sesión como administrador ahí)
--   Solo se guarda el hash del código; vence a los 10 minutos.
--
-- Forward-only. Ejecutar una sola vez, después de 2026_09_23_000001.
-- ============================================================

USE facturacion_multiempresa;

SET NAMES utf8mb4;

CREATE TABLE cash_terminal_pairings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  cash_register_id BIGINT UNSIGNED NOT NULL,
  code_hash CHAR(64) NOT NULL,
  terminal_name VARCHAR(80) NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  used_at TIMESTAMP NULL,
  used_terminal_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  KEY idx_cash_pairings_code (company_id, code_hash),
  KEY idx_cash_pairings_register (cash_register_id, used_at),

  CONSTRAINT fk_cash_pairings_company
    FOREIGN KEY (company_id) REFERENCES companies (id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_cash_pairings_register
    FOREIGN KEY (cash_register_id) REFERENCES cash_registers (id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_cash_pairings_created_by
    FOREIGN KEY (created_by) REFERENCES users (id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_cash_pairings_terminal
    FOREIGN KEY (used_terminal_id) REFERENCES cash_terminals (id)
    ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB;

-- ============================================================
-- Fin de migración.
-- +tabla cash_terminal_pairings
-- ============================================================
