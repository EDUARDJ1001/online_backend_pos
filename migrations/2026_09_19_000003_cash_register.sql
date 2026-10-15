-- ============================================================
-- @actualiza-datos: agrega los permisos de caja a los roles.
-- Migración: 2026_09_19_000003_cash_register
-- Base:  facturacion_multiempresa (MySQL 8 / MariaDB 10.4+)
-- Objetivo:
--   Flujo de caja (apertura / cierre) por usuario:
--     - Sesiones de caja con fondo inicial, arqueo ciego y diferencia
--     - Ledger append-only de movimientos de efectivo/otros métodos
--     - Método de pago del contado en la factura (para alimentar la caja)
--     - Permisos caja.* y reports.view para ADMIN/CAJERO
--
--   Modelo: una caja = una sesión por usuario/empresa. El "esperado" en el
--   cierre = fondo inicial + Σ(EFECTIVO IN) − Σ(EFECTIVO OUT) del ledger.
--
-- Forward-only: los ALTER no son idempotentes. Ejecutar una sola vez.
-- ============================================================

USE facturacion_multiempresa;

SET NAMES utf8mb4;

-- ============================================================
-- 1) Método de pago del contado en la factura
--    (crédito no aplica: entra por abonos en invoice_payments)
-- ============================================================

ALTER TABLE invoices
  ADD COLUMN tender_method ENUM('EFECTIVO','TRANSFERENCIA','CHEQUE','TARJETA','OTRO') NULL AFTER payment_status;

-- ============================================================
-- 2) Sesiones de caja (apertura / cierre)
-- ============================================================

CREATE TABLE cash_sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  opened_by BIGINT UNSIGNED NOT NULL,
  opened_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  opening_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  status ENUM('ABIERTA','CERRADA') NOT NULL DEFAULT 'ABIERTA',
  closed_by BIGINT UNSIGNED NULL,
  closed_at TIMESTAMP NULL,
  counted_amount DECIMAL(14,2) NULL,
  expected_amount DECIMAL(14,2) NULL,
  difference DECIMAL(14,2) NULL,
  opening_notes VARCHAR(255) NULL,
  closing_notes VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  -- Columna guardián: solo tiene valor mientras la sesión está ABIERTA,
  -- de modo que el índice único garantiza una sola caja abierta por usuario.
  open_guard BIGINT UNSIGNED AS (IF(status = 'ABIERTA', opened_by, NULL)) STORED,

  PRIMARY KEY (id),
  UNIQUE KEY uq_cash_sessions_open (company_id, open_guard),
  KEY idx_cash_sessions_company_status (company_id, status),
  KEY idx_cash_sessions_opened_by (opened_by),
  KEY idx_cash_sessions_opened_at (company_id, opened_at),

  CONSTRAINT fk_cash_sessions_company
    FOREIGN KEY (company_id) REFERENCES companies (id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_cash_sessions_opened_by
    FOREIGN KEY (opened_by) REFERENCES users (id)
    -- RESTRICT (no CASCADE): MySQL 8 no permite CASCADE en la base de la columna
    -- calculada open_guard. Corregido 2026-09-30; ver 2026_09_30_000001_align_schema.
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_cash_sessions_closed_by
    FOREIGN KEY (closed_by) REFERENCES users (id)
    ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB;

-- ============================================================
-- 3) Movimientos de caja (ledger append-only)
--    amount siempre positivo; el sentido lo da direction (IN/OUT).
-- ============================================================

CREATE TABLE cash_movements (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  session_id BIGINT UNSIGNED NOT NULL,
  type ENUM('APERTURA','VENTA_CONTADO','ABONO_CXC','PAGO_CXP','INGRESO','EGRESO','RETIRO','AJUSTE') NOT NULL,
  method ENUM('EFECTIVO','TRANSFERENCIA','CHEQUE','TARJETA','OTRO') NOT NULL DEFAULT 'EFECTIVO',
  direction ENUM('IN','OUT') NOT NULL,
  amount DECIMAL(14,2) NOT NULL,
  reference_type VARCHAR(30) NULL,
  reference_id BIGINT UNSIGNED NULL,
  description VARCHAR(255) NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  KEY idx_cash_movements_session (session_id),
  KEY idx_cash_movements_company_date (company_id, created_at),
  KEY idx_cash_movements_reference (reference_type, reference_id),

  CONSTRAINT fk_cash_movements_company
    FOREIGN KEY (company_id) REFERENCES companies (id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_cash_movements_session
    FOREIGN KEY (session_id) REFERENCES cash_sessions (id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_cash_movements_created_by
    FOREIGN KEY (created_by) REFERENCES users (id)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB;

-- ============================================================
-- 4) Permisos nuevos: caja.* (ADMIN + CAJERO) y reports.view (ADMIN)
-- ============================================================

INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, k.permission_key
FROM roles r
JOIN (
  SELECT 'caja.view' AS permission_key
  UNION ALL SELECT 'caja.open'
  UNION ALL SELECT 'caja.close'
  UNION ALL SELECT 'caja.move'
) k
WHERE r.nombre IN ('ADMIN', 'CAJERO')
ON DUPLICATE KEY UPDATE role_permissions.permission_key = role_permissions.permission_key;

INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, 'reports.view'
FROM roles r
WHERE r.nombre = 'ADMIN'
ON DUPLICATE KEY UPDATE role_permissions.permission_key = role_permissions.permission_key;

-- ============================================================
-- Fin de migración.
-- invoices: +tender_method · +tablas cash_sessions, cash_movements
-- +permisos caja.view/open/close/move y reports.view
-- ============================================================
