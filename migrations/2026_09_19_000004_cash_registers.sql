-- ============================================================
-- @actualiza-datos: crea la caja principal de cada empresa y le asigna las sesiones existentes.
-- @quita-columna-calculada: open_guard
-- Migración: 2026_09_19_000004_cash_registers
-- Base:  facturacion_multiempresa (MySQL 8 / MariaDB 10.4+)
-- Objetivo:
--   Mejorar el flujo de caja:
--     - Cajas nombradas (cash_registers): varias abiertas simultáneamente
--     - La sesión de caja pertenece a una caja (no a un usuario)
--     - Conteo por denominaciones en apertura y cierre (JSON)
--     - Una sola sesión ABIERTA por caja (guardián por cash_register_id)
--
-- Forward-only. Ejecutar una sola vez, después de 2026_09_19_000003.
-- ============================================================

USE facturacion_multiempresa;

SET NAMES utf8mb4;

-- ============================================================
-- 1) Cajas (puntos de cobro nombrados)
-- ============================================================

CREATE TABLE cash_registers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(80) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_cash_registers_name (company_id, name),
  KEY idx_cash_registers_company (company_id, is_active),

  CONSTRAINT fk_cash_registers_company
    FOREIGN KEY (company_id) REFERENCES companies (id)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB;

-- Cada empresa arranca con una caja por defecto.
INSERT INTO cash_registers (company_id, name)
SELECT id, 'Caja principal' FROM companies;

-- ============================================================
-- 2) La sesión ahora pertenece a una caja
-- ============================================================

-- El guardián anterior era por usuario; se reemplaza por caja.
ALTER TABLE cash_sessions DROP INDEX uq_cash_sessions_open;
ALTER TABLE cash_sessions DROP COLUMN open_guard;

ALTER TABLE cash_sessions
  ADD COLUMN cash_register_id BIGINT UNSIGNED NULL AFTER company_id,
  ADD COLUMN opening_breakdown JSON NULL AFTER opening_notes,
  ADD COLUMN closing_breakdown JSON NULL AFTER closing_notes;

-- Backfill: asigna las sesiones existentes a la caja principal de su empresa.
UPDATE cash_sessions s
  JOIN cash_registers r ON r.company_id = s.company_id AND r.name = 'Caja principal'
  SET s.cash_register_id = r.id
  WHERE s.cash_register_id IS NULL;

ALTER TABLE cash_sessions
  MODIFY COLUMN cash_register_id BIGINT UNSIGNED NOT NULL;

ALTER TABLE cash_sessions
  ADD CONSTRAINT fk_cash_sessions_register
    FOREIGN KEY (cash_register_id) REFERENCES cash_registers (id)
    -- RESTRICT (no CASCADE): MySQL 8 no permite CASCADE en la base de la columna
    -- calculada open_guard. Corregido 2026-09-30; ver 2026_09_30_000001_align_schema.
    ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE cash_sessions
  ADD KEY idx_cash_sessions_register (cash_register_id);

-- Guardián nuevo: una sola sesión ABIERTA por caja (independiente del usuario).
ALTER TABLE cash_sessions
  ADD COLUMN open_guard BIGINT UNSIGNED AS (IF(status = 'ABIERTA', cash_register_id, NULL)) STORED;

ALTER TABLE cash_sessions
  ADD UNIQUE KEY uq_cash_sessions_open (open_guard);

-- ============================================================
-- Fin de migración.
-- +tabla cash_registers · cash_sessions: +cash_register_id,
-- +opening_breakdown, +closing_breakdown · guardián por caja
-- ============================================================
