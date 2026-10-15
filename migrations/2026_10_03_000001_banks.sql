-- ============================================================
-- Migración: 2026_10_03_000001_banks
-- @funcion: Bancos
-- @rutas: /banks
-- @pantallas: /banks
-- Base:  MySQL 8 / MariaDB 10.4+
-- Objetivo:
--   Gestión de bancos: cuentas bancarias de cada empresa y su libro de
--   movimientos (depósitos, retiros, transferencias entre cuentas, comisiones,
--   intereses, notas y cheques emitidos). Solo crea tablas nuevas.
--
-- Versión SQL Server: migrations-mssql/ (mismo nombre de archivo).
-- Forward-only. Ejecutar una sola vez, después de 2026_10_01_000001.
-- ============================================================

SET NAMES utf8mb4;

CREATE TABLE bank_accounts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  bank_name VARCHAR(80) NOT NULL,
  account_type ENUM('CORRIENTE','AHORRO') NOT NULL DEFAULT 'CORRIENTE',
  currency ENUM('HNL','USD') NOT NULL DEFAULT 'HNL',
  account_number VARCHAR(40) NOT NULL,
  alias VARCHAR(80) NULL DEFAULT NULL,
  opening_balance DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  opening_date DATE NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bank_accounts_number (company_id, bank_name, account_number),
  KEY fk_bank_accounts_created_by (created_by),
  CONSTRAINT fk_bank_accounts_company FOREIGN KEY (company_id) REFERENCES companies (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_bank_accounts_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE bank_movements (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  bank_account_id BIGINT UNSIGNED NOT NULL,
  movement_date DATE NOT NULL,
  movement_type ENUM('DEPOSITO','RETIRO','TRANSFERENCIA_ENTRADA','TRANSFERENCIA_SALIDA','COMISION','INTERES','NOTA_CREDITO','NOTA_DEBITO','CHEQUE') NOT NULL,
  direction ENUM('IN','OUT') NOT NULL,
  amount DECIMAL(14,2) NOT NULL,
  reference VARCHAR(60) NULL DEFAULT NULL,
  description VARCHAR(255) NULL DEFAULT NULL,
  check_number VARCHAR(30) NULL DEFAULT NULL,
  beneficiary VARCHAR(150) NULL DEFAULT NULL,
  check_status ENUM('EMITIDO','COBRADO') NULL DEFAULT NULL,
  related_movement_id BIGINT UNSIGNED NULL DEFAULT NULL,
  status ENUM('ACTIVO','ANULADO') NOT NULL DEFAULT 'ACTIVO',
  void_reason VARCHAR(255) NULL DEFAULT NULL,
  voided_by BIGINT UNSIGNED NULL DEFAULT NULL,
  voided_at DATETIME NULL DEFAULT NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bank_movements_check (bank_account_id, check_number),
  KEY idx_bank_movements_account_date (bank_account_id, movement_date),
  KEY idx_bank_movements_company (company_id),
  KEY idx_bank_movements_related (related_movement_id),
  KEY fk_bank_movements_created_by (created_by),
  KEY fk_bank_movements_voided_by (voided_by),
  CONSTRAINT fk_bank_movements_company FOREIGN KEY (company_id) REFERENCES companies (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_bank_movements_account FOREIGN KEY (bank_account_id) REFERENCES bank_accounts (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_bank_movements_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON UPDATE CASCADE,
  CONSTRAINT fk_bank_movements_voided_by FOREIGN KEY (voided_by) REFERENCES users (id) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
