-- ============================================================
-- Migración: 2026_09_24_000001_cash_terminals_by_ip
-- Base:  facturacion_multiempresa (MySQL 8 / MariaDB 10.4+)
-- Objetivo:
--   Equipos de caja asignados por IP: el administrador escribe la IP de la PC
--   y la caja queda habilitada para esa PC, sin código ni registro en el
--   navegador. Requiere IP fija en cada PC (reserva en el router).
--     - cash_terminals.bound_ip: IP del equipo (NULL = equipo por token)
--     - token_hash pasa a ser opcional (los equipos por IP no tienen token)
--
-- Forward-only. Ejecutar una sola vez, después de 2026_09_23_000004.
-- ============================================================

USE facturacion_multiempresa;

SET NAMES utf8mb4;

ALTER TABLE cash_terminals
  MODIFY COLUMN token_hash CHAR(64) NULL,
  ADD COLUMN bound_ip VARCHAR(45) NULL AFTER token_hash,
  ADD KEY idx_cash_terminals_bound_ip (company_id, bound_ip);

-- ============================================================
-- Fin de migración.
-- cash_terminals: token_hash NULL, +bound_ip
-- ============================================================
