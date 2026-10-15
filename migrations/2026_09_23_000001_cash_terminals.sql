-- ============================================================
-- @actualiza-datos: agrega el permiso de administrar cajas a los roles.
-- Migración: 2026_09_23_000001_cash_terminals
-- Base:  facturacion_multiempresa (MySQL 8 / MariaDB 10.4+)
-- Objetivo:
--   Ligar cada equipo (PC) a una caja física:
--     - cash_terminals: equipo registrado -> caja, identificado por un
--       token secreto (solo se guarda su hash SHA-256)
--     - Permiso caja.manage (crear/editar cajas y registrar equipos),
--       separado de abrir/cerrar
--
-- Forward-only. Ejecutar una sola vez, después de 2026_09_21_000001.
-- ============================================================

USE facturacion_multiempresa;

SET NAMES utf8mb4;

-- ============================================================
-- 1) Equipos registrados como caja
-- ============================================================

CREATE TABLE cash_terminals (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  cash_register_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(80) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  registered_by BIGINT UNSIGNED NOT NULL,
  last_seen_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_cash_terminals_token (token_hash),
  KEY idx_cash_terminals_company (company_id, is_active),
  KEY idx_cash_terminals_register (cash_register_id),

  CONSTRAINT fk_cash_terminals_company
    FOREIGN KEY (company_id) REFERENCES companies (id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_cash_terminals_register
    FOREIGN KEY (cash_register_id) REFERENCES cash_registers (id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_cash_terminals_registered_by
    FOREIGN KEY (registered_by) REFERENCES users (id)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB;

-- ============================================================
-- 2) Permiso nuevo: caja.manage (solo ADMIN; SUPERADMIN tiene todo)
-- ============================================================

INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, 'caja.manage'
FROM roles r
WHERE r.nombre = 'ADMIN'
ON DUPLICATE KEY UPDATE role_permissions.permission_key = role_permissions.permission_key;

-- ============================================================
-- Fin de migración.
-- +tabla cash_terminals · +permiso caja.manage (ADMIN)
-- ============================================================
