-- ============================================================
-- Instalación completa: facturación multiempresa
-- Generado: 2026-10-06 desde la base con todas las migraciones aplicadas.
-- Base: MySQL 8 / MariaDB 10.4+
--
-- Crea una base NUEVA desde cero con todo lo que usa el sistema:
--   tablas, vista de impresión, roles, permisos por rol, versiones y el
--   primer usuario administrador. No incluye empresas ni datos de operación.
--
-- Cómo usarla: crear una base vacía (utf8mb4) e importar este archivo en ella
--   (mysql, phpMyAdmin, HeidiSQL...). No lleva USE: se instala en la base elegida.
--   El sistema también la aplica solo sobre una base vacía (ver migrations.service).
--
-- Usuario inicial: superadmin / Admin123!  (cambiar la contraseña al entrar).
--
-- Las migraciones de abajo quedan registradas como aplicadas; las posteriores
-- se aplican normalmente.
-- @incluye 2026_09_11_000001_inventory_products_proformas.sql
-- @incluye 2026_09_17_000001_sar_billing_series.sql
-- @incluye 2026_09_17_000002_company_profile_logo.sql
-- @incluye 2026_09_17_000003_receivables_payables.sql
-- @incluye 2026_09_18_000001_roles_permissions.sql
-- @incluye 2026_09_19_000001_isv_18.sql
-- @incluye 2026_09_19_000002_quotes.sql
-- @incluye 2026_09_19_000003_cash_register.sql
-- @incluye 2026_09_19_000004_cash_registers.sql
-- @incluye 2026_09_21_000001_product_codes.sql
-- @incluye 2026_09_23_000001_cash_terminals.sql
-- @incluye 2026_09_23_000002_cash_terminal_pairings.sql
-- @incluye 2026_09_23_000003_cash_networks.sql
-- @incluye 2026_09_23_000004_cash_network_per_register.sql
-- @incluye 2026_09_24_000001_cash_terminals_by_ip.sql
-- @incluye 2026_09_24_000002_document_counters.sql
-- @incluye 2026_09_24_000003_system_versions.sql
-- @incluye 2026_09_25_000001_company_document_branding.sql
-- @incluye 2026_09_27_000001_inventory_entry_supplier.sql
-- @incluye 2026_09_29_000001_generic_client_code.sql
-- @incluye 2026_09_30_000001_align_schema.sql
-- @incluye 2026_10_01_000001_footer_text_long.sql
-- @incluye 2026_10_03_000001_banks.sql
-- @incluye 2026_10_06_000001_license_registry.sql
-- ============================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ------------------------------------------------------------
-- Tablas
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `companies` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `code` varchar(30) NOT NULL,
  `commercial_name` varchar(150) NOT NULL,
  `legal_name` varchar(180) NOT NULL,
  `rtn` varchar(30) NOT NULL,
  `email` varchar(150) DEFAULT NULL,
  `phone` varchar(40) DEFAULT NULL,
  `address` varchar(255) DEFAULT NULL,
  `logo_url` mediumtext DEFAULT NULL,
  `favicon_url` mediumtext DEFAULT NULL,
  `footer_brands` longtext DEFAULT NULL,
  `layout_key` varchar(50) NOT NULL,
  `primary_color` varchar(20) DEFAULT NULL,
  `secondary_color` varchar(20) DEFAULT NULL,
  `sidebar_color` varchar(20) DEFAULT NULL,
  `header_color` varchar(20) DEFAULT NULL,
  `document_color` varchar(20) DEFAULT NULL,
  `theme_mode` enum('light','dark') NOT NULL DEFAULT 'light',
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_companies_code` (`code`),
  UNIQUE KEY `uq_companies_layout_key` (`layout_key`),
  UNIQUE KEY `uq_companies_rtn` (`rtn`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `roles` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `nombre` varchar(50) NOT NULL,
  `descripcion` varchar(255) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_roles_nombre` (`nombre`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `users` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `username` varchar(80) NOT NULL,
  `email` varchar(150) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `full_name` varchar(150) NOT NULL,
  `role_id` bigint(20) unsigned NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `last_login_at` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_username` (`username`),
  UNIQUE KEY `uq_users_email` (`email`),
  KEY `idx_users_role_id` (`role_id`),
  CONSTRAINT `fk_users_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `audit_logs` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `company_id` bigint(20) unsigned DEFAULT NULL,
  `user_id` bigint(20) unsigned DEFAULT NULL,
  `entity_type` varchar(50) NOT NULL,
  `entity_id` bigint(20) unsigned DEFAULT NULL,
  `action` varchar(50) NOT NULL,
  `description` varchar(255) DEFAULT NULL,
  `old_values` json DEFAULT NULL,
  `new_values` json DEFAULT NULL,
  `ip_address` varchar(45) DEFAULT NULL,
  `user_agent` varchar(255) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_audit_logs_company` (`company_id`),
  KEY `idx_audit_logs_user` (`user_id`),
  KEY `idx_audit_logs_entity` (`entity_type`,`entity_id`),
  CONSTRAINT `fk_audit_logs_company` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_audit_logs_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `bank_accounts` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `company_id` bigint(20) unsigned NOT NULL,
  `bank_name` varchar(80) NOT NULL,
  `account_type` enum('CORRIENTE','AHORRO') NOT NULL DEFAULT 'CORRIENTE',
  `currency` enum('HNL','USD') NOT NULL DEFAULT 'HNL',
  `account_number` varchar(40) NOT NULL,
  `alias` varchar(80) DEFAULT NULL,
  `opening_balance` decimal(14,2) NOT NULL DEFAULT 0.00,
  `opening_date` date NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_by` bigint(20) unsigned NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_bank_accounts_number` (`company_id`,`bank_name`,`account_number`),
  KEY `fk_bank_accounts_created_by` (`created_by`),
  CONSTRAINT `fk_bank_accounts_company` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_bank_accounts_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `bank_movements` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `company_id` bigint(20) unsigned NOT NULL,
  `bank_account_id` bigint(20) unsigned NOT NULL,
  `movement_date` date NOT NULL,
  `movement_type` enum('DEPOSITO','RETIRO','TRANSFERENCIA_ENTRADA','TRANSFERENCIA_SALIDA','COMISION','INTERES','NOTA_CREDITO','NOTA_DEBITO','CHEQUE') NOT NULL,
  `direction` enum('IN','OUT') NOT NULL,
  `amount` decimal(14,2) NOT NULL,
  `reference` varchar(60) DEFAULT NULL,
  `description` varchar(255) DEFAULT NULL,
  `check_number` varchar(30) DEFAULT NULL,
  `beneficiary` varchar(150) DEFAULT NULL,
  `check_status` enum('EMITIDO','COBRADO') DEFAULT NULL,
  `related_movement_id` bigint(20) unsigned DEFAULT NULL,
  `status` enum('ACTIVO','ANULADO') NOT NULL DEFAULT 'ACTIVO',
  `void_reason` varchar(255) DEFAULT NULL,
  `voided_by` bigint(20) unsigned DEFAULT NULL,
  `voided_at` datetime DEFAULT NULL,
  `created_by` bigint(20) unsigned NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_bank_movements_check` (`bank_account_id`,`check_number`),
  KEY `idx_bank_movements_account_date` (`bank_account_id`,`movement_date`),
  KEY `idx_bank_movements_company` (`company_id`),
  KEY `idx_bank_movements_related` (`related_movement_id`),
  KEY `fk_bank_movements_created_by` (`created_by`),
  KEY `fk_bank_movements_voided_by` (`voided_by`),
  CONSTRAINT `fk_bank_movements_account` FOREIGN KEY (`bank_account_id`) REFERENCES `bank_accounts` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_bank_movements_company` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_bank_movements_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_bank_movements_voided_by` FOREIGN KEY (`voided_by`) REFERENCES `users` (`id`) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `billing_series` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `company_id` bigint(20) unsigned NOT NULL,
  `document_type` enum('FACTURA','NOTA_CREDITO','NOTA_DEBITO','RECIBO') NOT NULL DEFAULT 'FACTURA',
  `establishment_code` char(3) NOT NULL,
  `point_code` char(3) NOT NULL,
  `document_code` char(2) NOT NULL DEFAULT '01',
  `cai` varchar(80) NOT NULL,
  `resolution_number` varchar(80) DEFAULT NULL,
  `resolution_date` date DEFAULT NULL,
  `issue_deadline` date NOT NULL,
  `range_start` int(10) unsigned NOT NULL,
  `range_end` int(10) unsigned NOT NULL,
  `current_number` int(10) unsigned NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `notes` varchar(255) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_billing_series_company` (`company_id`),
  KEY `idx_billing_series_company_active` (`company_id`,`is_active`),
  KEY `idx_billing_series_deadline` (`company_id`,`issue_deadline`),
  CONSTRAINT `fk_billing_series_company` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `chk_billing_series_range` CHECK (`range_start` <= `range_end`),
  CONSTRAINT `chk_billing_series_current` CHECK (`current_number` >= `range_start` and `current_number` <= `range_end` + 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `billing_settings` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `company_id` bigint(20) unsigned NOT NULL,
  `default_tax_rate` decimal(5,2) NOT NULL DEFAULT 15.00,
  `footer_text` text DEFAULT NULL,
  `payable_to` varchar(180) DEFAULT NULL,
  `invoice_title` varchar(100) NOT NULL DEFAULT 'Factura',
  `legend_original` varchar(120) NOT NULL DEFAULT 'Original: Cliente',
  `legend_copy` varchar(120) NOT NULL DEFAULT 'Copia: Obligado Tributario',
  `sar_notice` varchar(255) NOT NULL DEFAULT 'La factura es beneficio de todos, ¡Exíjala!',
  `allow_client_name_correction` tinyint(1) NOT NULL DEFAULT 1,
  `allow_invoice_date_reissue` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_billing_settings_company_id` (`company_id`),
  CONSTRAINT `fk_billing_settings_company` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `cash_registers` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `company_id` bigint(20) unsigned NOT NULL,
  `name` varchar(80) NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cash_registers_name` (`company_id`,`name`),
  KEY `idx_cash_registers_company` (`company_id`,`is_active`),
  CONSTRAINT `fk_cash_registers_company` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `cash_sessions` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `company_id` bigint(20) unsigned NOT NULL,
  `cash_register_id` bigint(20) unsigned NOT NULL,
  `opened_by` bigint(20) unsigned NOT NULL,
  `opened_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `opening_amount` decimal(14,2) NOT NULL DEFAULT 0.00,
  `status` enum('ABIERTA','CERRADA') NOT NULL DEFAULT 'ABIERTA',
  `closed_by` bigint(20) unsigned DEFAULT NULL,
  `closed_at` timestamp NULL DEFAULT NULL,
  `counted_amount` decimal(14,2) DEFAULT NULL,
  `expected_amount` decimal(14,2) DEFAULT NULL,
  `difference` decimal(14,2) DEFAULT NULL,
  `opening_notes` varchar(255) DEFAULT NULL,
  `opening_breakdown` json DEFAULT NULL,
  `closing_notes` varchar(255) DEFAULT NULL,
  `closing_breakdown` json DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `open_guard` bigint(20) unsigned GENERATED ALWAYS AS (if(`status` = 'ABIERTA',`cash_register_id`,NULL)) STORED,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cash_sessions_open` (`open_guard`),
  KEY `idx_cash_sessions_company_status` (`company_id`,`status`),
  KEY `idx_cash_sessions_opened_by` (`opened_by`),
  KEY `idx_cash_sessions_opened_at` (`company_id`,`opened_at`),
  KEY `fk_cash_sessions_closed_by` (`closed_by`),
  KEY `idx_cash_sessions_register` (`cash_register_id`),
  CONSTRAINT `fk_cash_sessions_closed_by` FOREIGN KEY (`closed_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_cash_sessions_company` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_cash_sessions_opened_by` FOREIGN KEY (`opened_by`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_cash_sessions_register` FOREIGN KEY (`cash_register_id`) REFERENCES `cash_registers` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `cash_movements` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `company_id` bigint(20) unsigned NOT NULL,
  `session_id` bigint(20) unsigned NOT NULL,
  `type` enum('APERTURA','VENTA_CONTADO','ABONO_CXC','PAGO_CXP','INGRESO','EGRESO','RETIRO','AJUSTE') NOT NULL,
  `method` enum('EFECTIVO','TRANSFERENCIA','CHEQUE','TARJETA','OTRO') NOT NULL DEFAULT 'EFECTIVO',
  `direction` enum('IN','OUT') NOT NULL,
  `amount` decimal(14,2) NOT NULL,
  `reference_type` varchar(30) DEFAULT NULL,
  `reference_id` bigint(20) unsigned DEFAULT NULL,
  `description` varchar(255) DEFAULT NULL,
  `created_by` bigint(20) unsigned NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_cash_movements_session` (`session_id`),
  KEY `idx_cash_movements_company_date` (`company_id`,`created_at`),
  KEY `idx_cash_movements_reference` (`reference_type`,`reference_id`),
  KEY `fk_cash_movements_created_by` (`created_by`),
  CONSTRAINT `fk_cash_movements_company` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_cash_movements_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_cash_movements_session` FOREIGN KEY (`session_id`) REFERENCES `cash_sessions` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `cash_network_rules` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `company_id` bigint(20) unsigned NOT NULL,
  `cash_register_id` bigint(20) unsigned DEFAULT NULL,
  `cidr` varchar(64) NOT NULL,
  `label` varchar(80) DEFAULT NULL,
  `created_by` bigint(20) unsigned NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `fk_cash_network_rules_created_by` (`created_by`),
  KEY `idx_cash_network_rules_scope` (`company_id`,`cash_register_id`),
  KEY `fk_cash_network_rules_register` (`cash_register_id`),
  CONSTRAINT `fk_cash_network_rules_company` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_cash_network_rules_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_cash_network_rules_register` FOREIGN KEY (`cash_register_id`) REFERENCES `cash_registers` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `cash_terminals` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `company_id` bigint(20) unsigned NOT NULL,
  `cash_register_id` bigint(20) unsigned NOT NULL,
  `name` varchar(80) NOT NULL,
  `token_hash` char(64) DEFAULT NULL,
  `bound_ip` varchar(45) DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `registered_by` bigint(20) unsigned NOT NULL,
  `registered_ip` varchar(45) DEFAULT NULL,
  `last_seen_at` timestamp NULL DEFAULT NULL,
  `last_ip` varchar(45) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cash_terminals_token` (`token_hash`),
  KEY `idx_cash_terminals_company` (`company_id`,`is_active`),
  KEY `idx_cash_terminals_register` (`cash_register_id`),
  KEY `fk_cash_terminals_registered_by` (`registered_by`),
  KEY `idx_cash_terminals_bound_ip` (`company_id`,`bound_ip`),
  CONSTRAINT `fk_cash_terminals_company` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_cash_terminals_register` FOREIGN KEY (`cash_register_id`) REFERENCES `cash_registers` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_cash_terminals_registered_by` FOREIGN KEY (`registered_by`) REFERENCES `users` (`id`) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `cash_terminal_pairings` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `company_id` bigint(20) unsigned NOT NULL,
  `cash_register_id` bigint(20) unsigned NOT NULL,
  `code_hash` char(64) NOT NULL,
  `terminal_name` varchar(80) DEFAULT NULL,
  `created_by` bigint(20) unsigned NOT NULL,
  `expires_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `used_at` timestamp NULL DEFAULT NULL,
  `used_terminal_id` bigint(20) unsigned DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_cash_pairings_code` (`company_id`,`code_hash`),
  KEY `idx_cash_pairings_register` (`cash_register_id`,`used_at`),
  KEY `fk_cash_pairings_created_by` (`created_by`),
  KEY `fk_cash_pairings_terminal` (`used_terminal_id`),
  CONSTRAINT `fk_cash_pairings_company` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_cash_pairings_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_cash_pairings_register` FOREIGN KEY (`cash_register_id`) REFERENCES `cash_registers` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_cash_pairings_terminal` FOREIGN KEY (`used_terminal_id`) REFERENCES `cash_terminals` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `clients` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `company_id` bigint(20) unsigned NOT NULL,
  `code` varchar(30) DEFAULT NULL,
  `name` varchar(180) NOT NULL,
  `rtn` varchar(30) DEFAULT NULL,
  `email` varchar(150) DEFAULT NULL,
  `phone` varchar(40) DEFAULT NULL,
  `address` varchar(255) DEFAULT NULL,
  `is_generic` tinyint(1) NOT NULL DEFAULT 0,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_by` bigint(20) unsigned DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_clients_company_code` (`company_id`,`code`),
  KEY `idx_clients_company_name` (`company_id`,`name`),
  KEY `idx_clients_company_rtn` (`company_id`,`rtn`),
  KEY `idx_clients_created_by` (`created_by`),
  CONSTRAINT `fk_clients_company` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_clients_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `document_counters` (
  `company_id` bigint(20) unsigned NOT NULL,
  `counter_key` varchar(40) NOT NULL,
  `last_value` bigint(20) unsigned NOT NULL DEFAULT 0,
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`company_id`,`counter_key`),
  CONSTRAINT `fk_document_counters_company` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `suppliers` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `company_id` bigint(20) unsigned NOT NULL,
  `code` varchar(30) DEFAULT NULL,
  `name` varchar(180) NOT NULL,
  `rtn` varchar(30) DEFAULT NULL,
  `email` varchar(150) DEFAULT NULL,
  `phone` varchar(40) DEFAULT NULL,
  `address` varchar(255) DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_by` bigint(20) unsigned DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_suppliers_company_code` (`company_id`,`code`),
  KEY `idx_suppliers_company_name` (`company_id`,`name`),
  KEY `idx_suppliers_company_rtn` (`company_id`,`rtn`),
  KEY `idx_suppliers_created_by` (`created_by`),
  CONSTRAINT `fk_suppliers_company` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_suppliers_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `warehouses` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `company_id` bigint(20) unsigned NOT NULL,
  `code` varchar(30) NOT NULL,
  `name` varchar(120) NOT NULL,
  `address` varchar(255) DEFAULT NULL,
  `is_default` tinyint(1) NOT NULL DEFAULT 0,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_warehouses_company_code` (`company_id`,`code`),
  KEY `idx_warehouses_company` (`company_id`),
  KEY `idx_warehouses_company_active` (`company_id`,`is_active`),
  CONSTRAINT `fk_warehouses_company` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `inventory_entries` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `company_id` bigint(20) unsigned NOT NULL,
  `warehouse_id` bigint(20) unsigned NOT NULL,
  `entry_date` date NOT NULL,
  `supplier_id` bigint(20) unsigned DEFAULT NULL,
  `supplier_name` varchar(180) DEFAULT NULL,
  `document_number` varchar(80) DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `status` enum('BORRADOR','APLICADA','ANULADA') NOT NULL DEFAULT 'APLICADA',
  `created_by` bigint(20) unsigned NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_inventory_entries_company_date` (`company_id`,`entry_date`),
  KEY `idx_inventory_entries_warehouse` (`warehouse_id`),
  KEY `idx_inventory_entries_created_by` (`created_by`),
  KEY `idx_inventory_entries_supplier` (`supplier_id`),
  CONSTRAINT `fk_inventory_entries_company` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_inventory_entries_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_inventory_entries_supplier` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_inventory_entries_warehouse` FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses` (`id`) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `product_categories` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `company_id` bigint(20) unsigned NOT NULL,
  `name` varchar(120) NOT NULL,
  `description` varchar(255) DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_product_categories_company_name` (`company_id`,`name`),
  KEY `idx_product_categories_company` (`company_id`),
  CONSTRAINT `fk_product_categories_company` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `products` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `company_id` bigint(20) unsigned NOT NULL,
  `category_id` bigint(20) unsigned DEFAULT NULL,
  `code` varchar(40) NOT NULL,
  `barcode` varchar(60) DEFAULT NULL,
  `name` varchar(180) NOT NULL,
  `description` varchar(255) DEFAULT NULL,
  `image_url` varchar(255) DEFAULT NULL,
  `type` enum('PRODUCTO','SERVICIO','MATERIALES') NOT NULL DEFAULT 'PRODUCTO',
  `unit_measure` varchar(30) NOT NULL DEFAULT 'UND',
  `sale_price` decimal(14,2) NOT NULL DEFAULT 0.00,
  `cost_price` decimal(14,2) NOT NULL DEFAULT 0.00,
  `taxable` tinyint(1) NOT NULL DEFAULT 1,
  `tax_rate` decimal(5,2) NOT NULL DEFAULT 15.00,
  `controls_stock` tinyint(1) NOT NULL DEFAULT 1,
  `min_stock` decimal(14,2) NOT NULL DEFAULT 0.00,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_by` bigint(20) unsigned DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_products_company_code` (`company_id`,`code`),
  KEY `idx_products_company_name` (`company_id`,`name`),
  KEY `idx_products_company_barcode` (`company_id`,`barcode`),
  KEY `idx_products_category` (`category_id`),
  KEY `idx_products_created_by` (`created_by`),
  CONSTRAINT `fk_products_category` FOREIGN KEY (`category_id`) REFERENCES `product_categories` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_products_company` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_products_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `inventory_entry_items` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `entry_id` bigint(20) unsigned NOT NULL,
  `product_id` bigint(20) unsigned NOT NULL,
  `quantity` decimal(14,2) NOT NULL DEFAULT 0.00,
  `unit_cost` decimal(14,2) NOT NULL DEFAULT 0.00,
  `total_cost` decimal(14,2) NOT NULL DEFAULT 0.00,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_inventory_entry_items_entry` (`entry_id`),
  KEY `idx_inventory_entry_items_product` (`product_id`),
  CONSTRAINT `fk_inventory_entry_items_entry` FOREIGN KEY (`entry_id`) REFERENCES `inventory_entries` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_inventory_entry_items_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `proforma_series` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `company_id` bigint(20) unsigned NOT NULL,
  `prefix` varchar(10) NOT NULL DEFAULT 'PRO-',
  `current_number` int(10) unsigned NOT NULL DEFAULT 1,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_proforma_series_company` (`company_id`),
  KEY `idx_proforma_series_company_active` (`company_id`,`is_active`),
  CONSTRAINT `fk_proforma_series_company` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `proformas` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `company_id` bigint(20) unsigned NOT NULL,
  `proforma_series_id` bigint(20) unsigned NOT NULL,
  `customer_id` bigint(20) unsigned DEFAULT NULL,
  `warehouse_id` bigint(20) unsigned DEFAULT NULL,
  `sequence_number` int(10) unsigned NOT NULL,
  `proforma_number` varchar(30) NOT NULL,
  `proforma_date` date NOT NULL,
  `valid_until` date DEFAULT NULL,
  `customer_name_snapshot` varchar(180) NOT NULL,
  `customer_rtn_snapshot` varchar(30) DEFAULT NULL,
  `customer_phone_snapshot` varchar(40) DEFAULT NULL,
  `customer_address_snapshot` varchar(255) DEFAULT NULL,
  `subtotal` decimal(14,2) NOT NULL DEFAULT 0.00,
  `discount_total` decimal(14,2) NOT NULL DEFAULT 0.00,
  `taxable_amount_15` decimal(14,2) NOT NULL DEFAULT 0.00,
  `taxable_amount_18` decimal(14,2) NOT NULL DEFAULT 0.00,
  `exempt_amount` decimal(14,2) NOT NULL DEFAULT 0.00,
  `exonerated_amount` decimal(14,2) NOT NULL DEFAULT 0.00,
  `isv_15` decimal(14,2) NOT NULL DEFAULT 0.00,
  `isv_18` decimal(14,2) NOT NULL DEFAULT 0.00,
  `tax_total` decimal(14,2) NOT NULL DEFAULT 0.00,
  `grand_total` decimal(14,2) NOT NULL DEFAULT 0.00,
  `total_in_words` varchar(255) DEFAULT NULL,
  `status` enum('BORRADOR','ENVIADA','APROBADA','RECHAZADA','VENCIDA','FACTURADA') NOT NULL DEFAULT 'BORRADOR',
  `approved_at` datetime DEFAULT NULL,
  `approved_by` bigint(20) unsigned DEFAULT NULL,
  `converted_to_invoice_id` bigint(20) unsigned DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `created_by` bigint(20) unsigned NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_proformas_company_number` (`company_id`,`proforma_number`),
  KEY `idx_proformas_company_date` (`company_id`,`proforma_date`),
  KEY `idx_proformas_company_status` (`company_id`,`status`),
  KEY `idx_proformas_customer` (`customer_id`),
  KEY `idx_proformas_series` (`proforma_series_id`),
  KEY `idx_proformas_warehouse` (`warehouse_id`),
  KEY `idx_proformas_converted` (`converted_to_invoice_id`),
  KEY `idx_proformas_created_by` (`created_by`),
  KEY `fk_proformas_approved_by` (`approved_by`),
  CONSTRAINT `fk_proformas_approved_by` FOREIGN KEY (`approved_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_proformas_company` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_proformas_converted_invoice` FOREIGN KEY (`converted_to_invoice_id`) REFERENCES `invoices` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_proformas_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_proformas_customer` FOREIGN KEY (`customer_id`) REFERENCES `clients` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_proformas_series` FOREIGN KEY (`proforma_series_id`) REFERENCES `proforma_series` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_proformas_warehouse` FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `invoices` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `company_id` bigint(20) unsigned NOT NULL,
  `billing_series_id` bigint(20) unsigned NOT NULL,
  `customer_id` bigint(20) unsigned DEFAULT NULL,
  `warehouse_id` bigint(20) unsigned DEFAULT NULL,
  `source_proforma_id` bigint(20) unsigned DEFAULT NULL,
  `invoice_number` varchar(20) NOT NULL,
  `sequence_number` int(10) unsigned NOT NULL,
  `invoice_date` date NOT NULL,
  `issued_at` datetime NOT NULL DEFAULT current_timestamp(),
  `customer_name_snapshot` varchar(180) NOT NULL,
  `customer_rtn_snapshot` varchar(30) DEFAULT NULL,
  `customer_phone_snapshot` varchar(40) DEFAULT NULL,
  `customer_address_snapshot` varchar(255) DEFAULT NULL,
  `company_legal_name_snapshot` varchar(180) NOT NULL,
  `company_commercial_name_snapshot` varchar(150) NOT NULL,
  `company_rtn_snapshot` varchar(30) NOT NULL,
  `company_email_snapshot` varchar(150) DEFAULT NULL,
  `company_phone_snapshot` varchar(40) DEFAULT NULL,
  `company_address_snapshot` varchar(255) DEFAULT NULL,
  `cai_snapshot` varchar(80) NOT NULL,
  `resolution_number_snapshot` varchar(80) DEFAULT NULL,
  `issue_deadline_snapshot` date NOT NULL,
  `range_start_snapshot` int(10) unsigned NOT NULL,
  `range_end_snapshot` int(10) unsigned NOT NULL,
  `subtotal` decimal(14,2) NOT NULL DEFAULT 0.00,
  `discount_total` decimal(14,2) NOT NULL DEFAULT 0.00,
  `taxable_amount_15` decimal(14,2) NOT NULL DEFAULT 0.00,
  `taxable_amount_18` decimal(14,2) NOT NULL DEFAULT 0.00,
  `exempt_amount` decimal(14,2) NOT NULL DEFAULT 0.00,
  `exonerated_amount` decimal(14,2) NOT NULL DEFAULT 0.00,
  `isv_15` decimal(14,2) NOT NULL DEFAULT 0.00,
  `isv_18` decimal(14,2) NOT NULL DEFAULT 0.00,
  `tax_total` decimal(14,2) NOT NULL DEFAULT 0.00,
  `grand_total` decimal(14,2) NOT NULL DEFAULT 0.00,
  `total_in_words` varchar(255) DEFAULT NULL,
  `status` enum('EMITIDA','ANULADA') NOT NULL DEFAULT 'EMITIDA',
  `sale_type` enum('CONTADO','CREDITO') NOT NULL DEFAULT 'CONTADO',
  `due_date` date DEFAULT NULL,
  `paid_amount` decimal(14,2) NOT NULL DEFAULT 0.00,
  `balance` decimal(14,2) NOT NULL DEFAULT 0.00,
  `payment_status` enum('PENDIENTE','PARCIAL','PAGADA','ANULADA') NOT NULL DEFAULT 'PAGADA',
  `tender_method` enum('EFECTIVO','TRANSFERENCIA','CHEQUE','TARJETA','OTRO') DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `created_by` bigint(20) unsigned NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_invoices_company_invoice_number` (`company_id`,`invoice_number`),
  UNIQUE KEY `uq_invoices_company_sequence` (`company_id`,`sequence_number`),
  KEY `idx_invoices_company_date` (`company_id`,`invoice_date`),
  KEY `idx_invoices_company_status` (`company_id`,`status`),
  KEY `idx_invoices_customer_id` (`customer_id`),
  KEY `idx_invoices_created_by` (`created_by`),
  KEY `idx_invoices_billing_series_id` (`billing_series_id`),
  KEY `idx_invoices_warehouse_id` (`warehouse_id`),
  KEY `idx_invoices_source_proforma_id` (`source_proforma_id`),
  KEY `idx_invoices_payment_status` (`company_id`,`payment_status`),
  CONSTRAINT `fk_invoices_billing_series` FOREIGN KEY (`billing_series_id`) REFERENCES `billing_series` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_invoices_company` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_invoices_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_invoices_customer` FOREIGN KEY (`customer_id`) REFERENCES `clients` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_invoices_source_proforma` FOREIGN KEY (`source_proforma_id`) REFERENCES `proformas` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_invoices_warehouse` FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `invoice_items` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `invoice_id` bigint(20) unsigned NOT NULL,
  `product_id` bigint(20) unsigned DEFAULT NULL,
  `line_number` int(10) unsigned NOT NULL,
  `quantity` decimal(12,2) NOT NULL DEFAULT 1.00,
  `description` varchar(255) NOT NULL,
  `unit_price` decimal(14,2) NOT NULL DEFAULT 0.00,
  `unit_cost_snapshot` decimal(14,2) DEFAULT NULL,
  `tax_rate` decimal(5,2) NOT NULL DEFAULT 15.00,
  `line_discount` decimal(14,2) NOT NULL DEFAULT 0.00,
  `line_subtotal` decimal(14,2) NOT NULL DEFAULT 0.00,
  `line_tax` decimal(14,2) NOT NULL DEFAULT 0.00,
  `line_total` decimal(14,2) NOT NULL DEFAULT 0.00,
  `affects_inventory` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_invoice_items_invoice_line` (`invoice_id`,`line_number`),
  KEY `idx_invoice_items_invoice` (`invoice_id`),
  KEY `idx_invoice_items_product` (`product_id`),
  CONSTRAINT `fk_invoice_items_invoice` FOREIGN KEY (`invoice_id`) REFERENCES `invoices` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_invoice_items_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `inventory_movements` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `company_id` bigint(20) unsigned NOT NULL,
  `product_id` bigint(20) unsigned NOT NULL,
  `warehouse_id` bigint(20) unsigned NOT NULL,
  `movement_type` enum('STOCK_INICIAL','ENTRADA','SALIDA','AJUSTE_POSITIVO','AJUSTE_NEGATIVO','VENTA','ANULACION_VENTA') NOT NULL,
  `source_type` enum('MANUAL','ENTRADA','FACTURA','AJUSTE') NOT NULL DEFAULT 'MANUAL',
  `invoice_id` bigint(20) unsigned DEFAULT NULL,
  `invoice_item_id` bigint(20) unsigned DEFAULT NULL,
  `entry_id` bigint(20) unsigned DEFAULT NULL,
  `entry_item_id` bigint(20) unsigned DEFAULT NULL,
  `quantity` decimal(14,2) NOT NULL DEFAULT 0.00,
  `unit_cost` decimal(14,2) DEFAULT NULL,
  `unit_price` decimal(14,2) DEFAULT NULL,
  `stock_before` decimal(14,2) NOT NULL DEFAULT 0.00,
  `stock_after` decimal(14,2) NOT NULL DEFAULT 0.00,
  `notes` varchar(255) DEFAULT NULL,
  `created_by` bigint(20) unsigned NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_inventory_movements_company` (`company_id`),
  KEY `idx_inventory_movements_product` (`product_id`),
  KEY `idx_inventory_movements_warehouse` (`warehouse_id`),
  KEY `idx_inventory_movements_product_warehouse` (`product_id`,`warehouse_id`),
  KEY `idx_inventory_movements_invoice` (`invoice_id`),
  KEY `idx_inventory_movements_invoice_item` (`invoice_item_id`),
  KEY `idx_inventory_movements_entry` (`entry_id`),
  KEY `idx_inventory_movements_entry_item` (`entry_item_id`),
  KEY `idx_inventory_movements_created_by` (`created_by`),
  CONSTRAINT `fk_inventory_movements_company` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_inventory_movements_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_inventory_movements_entry` FOREIGN KEY (`entry_id`) REFERENCES `inventory_entries` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_inventory_movements_entry_item` FOREIGN KEY (`entry_item_id`) REFERENCES `inventory_entry_items` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_inventory_movements_invoice` FOREIGN KEY (`invoice_id`) REFERENCES `invoices` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_inventory_movements_invoice_item` FOREIGN KEY (`invoice_item_id`) REFERENCES `invoice_items` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_inventory_movements_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_inventory_movements_warehouse` FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses` (`id`) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `invoice_corrections` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `company_id` bigint(20) unsigned NOT NULL,
  `invoice_id` bigint(20) unsigned NOT NULL,
  `correction_type` enum('NOMBRE_CLIENTE','FECHA_FACTURA','AMBOS') NOT NULL,
  `previous_customer_name` varchar(180) DEFAULT NULL,
  `new_customer_name` varchar(180) DEFAULT NULL,
  `previous_invoice_date` date DEFAULT NULL,
  `new_invoice_date` date DEFAULT NULL,
  `reason` varchar(255) NOT NULL,
  `status` enum('APLICADA','REVERTIDA') NOT NULL DEFAULT 'APLICADA',
  `performed_by` bigint(20) unsigned NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_invoice_corrections_invoice` (`invoice_id`),
  KEY `idx_invoice_corrections_company` (`company_id`),
  KEY `idx_invoice_corrections_performed_by` (`performed_by`),
  CONSTRAINT `fk_invoice_corrections_company` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_invoice_corrections_invoice` FOREIGN KEY (`invoice_id`) REFERENCES `invoices` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_invoice_corrections_performed_by` FOREIGN KEY (`performed_by`) REFERENCES `users` (`id`) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `invoice_payments` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `company_id` bigint(20) unsigned NOT NULL,
  `invoice_id` bigint(20) unsigned NOT NULL,
  `receipt_number` varchar(40) DEFAULT NULL,
  `payment_date` date NOT NULL,
  `amount` decimal(14,2) NOT NULL,
  `method` enum('EFECTIVO','TRANSFERENCIA','CHEQUE','TARJETA','OTRO') NOT NULL DEFAULT 'EFECTIVO',
  `reference` varchar(120) DEFAULT NULL,
  `notes` varchar(255) DEFAULT NULL,
  `created_by` bigint(20) unsigned NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_invoice_payments_receipt` (`company_id`,`receipt_number`),
  KEY `idx_invoice_payments_invoice` (`invoice_id`),
  KEY `idx_invoice_payments_company_date` (`company_id`,`payment_date`),
  KEY `fk_invoice_payments_created_by` (`created_by`),
  CONSTRAINT `fk_invoice_payments_company` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_invoice_payments_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_invoice_payments_invoice` FOREIGN KEY (`invoice_id`) REFERENCES `invoices` (`id`) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `license_devices` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `machine_code` varchar(12) NOT NULL,
  `machine_name` varchar(120) DEFAULT NULL,
  `app_version` varchar(30) DEFAULT NULL,
  `ip_address` varchar(45) DEFAULT NULL,
  `first_seen` timestamp NOT NULL DEFAULT current_timestamp(),
  `last_seen` timestamp NULL DEFAULT NULL,
  `conflict_name` varchar(120) DEFAULT NULL,
  `conflict_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_license_devices_machine` (`machine_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `license_revocations` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `revocation_text` text NOT NULL,
  `descripcion` varchar(200) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `payable_documents` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `company_id` bigint(20) unsigned NOT NULL,
  `supplier_id` bigint(20) unsigned NOT NULL,
  `document_number` varchar(60) NOT NULL,
  `document_date` date NOT NULL,
  `due_date` date DEFAULT NULL,
  `description` varchar(255) DEFAULT NULL,
  `total` decimal(14,2) NOT NULL DEFAULT 0.00,
  `paid_amount` decimal(14,2) NOT NULL DEFAULT 0.00,
  `balance` decimal(14,2) NOT NULL DEFAULT 0.00,
  `status` enum('PENDIENTE','PARCIAL','PAGADA','ANULADA') NOT NULL DEFAULT 'PENDIENTE',
  `notes` text DEFAULT NULL,
  `created_by` bigint(20) unsigned NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_payable_documents_number` (`company_id`,`supplier_id`,`document_number`),
  KEY `idx_payable_documents_company_status` (`company_id`,`status`),
  KEY `idx_payable_documents_supplier` (`supplier_id`),
  KEY `idx_payable_documents_due` (`company_id`,`due_date`),
  KEY `fk_payable_documents_created_by` (`created_by`),
  CONSTRAINT `fk_payable_documents_company` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_payable_documents_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_payable_documents_supplier` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers` (`id`) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `payable_payments` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `company_id` bigint(20) unsigned NOT NULL,
  `payable_document_id` bigint(20) unsigned NOT NULL,
  `receipt_number` varchar(40) DEFAULT NULL,
  `payment_date` date NOT NULL,
  `amount` decimal(14,2) NOT NULL,
  `method` enum('EFECTIVO','TRANSFERENCIA','CHEQUE','TARJETA','OTRO') NOT NULL DEFAULT 'EFECTIVO',
  `reference` varchar(120) DEFAULT NULL,
  `notes` varchar(255) DEFAULT NULL,
  `created_by` bigint(20) unsigned NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_payable_payments_receipt` (`company_id`,`receipt_number`),
  KEY `idx_payable_payments_document` (`payable_document_id`),
  KEY `idx_payable_payments_company_date` (`company_id`,`payment_date`),
  KEY `fk_payable_payments_created_by` (`created_by`),
  CONSTRAINT `fk_payable_payments_company` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_payable_payments_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_payable_payments_document` FOREIGN KEY (`payable_document_id`) REFERENCES `payable_documents` (`id`) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `product_codes` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `company_id` bigint(20) unsigned NOT NULL,
  `product_id` bigint(20) unsigned NOT NULL,
  `code` varchar(60) NOT NULL,
  `code_type` enum('BARRA','MANUAL') NOT NULL DEFAULT 'MANUAL',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_product_codes_company_code` (`company_id`,`code`),
  KEY `idx_product_codes_product` (`product_id`),
  CONSTRAINT `fk_product_codes_company` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_product_codes_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `product_stocks` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `company_id` bigint(20) unsigned NOT NULL,
  `product_id` bigint(20) unsigned NOT NULL,
  `warehouse_id` bigint(20) unsigned NOT NULL,
  `stock_quantity` decimal(14,2) NOT NULL DEFAULT 0.00,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_product_stocks_product_warehouse` (`product_id`,`warehouse_id`),
  KEY `idx_product_stocks_company` (`company_id`),
  KEY `idx_product_stocks_warehouse` (`warehouse_id`),
  CONSTRAINT `fk_product_stocks_company` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_product_stocks_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_product_stocks_warehouse` FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `proforma_items` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `proforma_id` bigint(20) unsigned NOT NULL,
  `product_id` bigint(20) unsigned DEFAULT NULL,
  `line_number` int(10) unsigned NOT NULL,
  `quantity` decimal(12,2) NOT NULL DEFAULT 1.00,
  `description` varchar(255) NOT NULL,
  `unit_price` decimal(14,2) NOT NULL DEFAULT 0.00,
  `unit_cost_snapshot` decimal(14,2) DEFAULT NULL,
  `tax_rate` decimal(5,2) NOT NULL DEFAULT 15.00,
  `line_discount` decimal(14,2) NOT NULL DEFAULT 0.00,
  `line_subtotal` decimal(14,2) NOT NULL DEFAULT 0.00,
  `line_tax` decimal(14,2) NOT NULL DEFAULT 0.00,
  `line_total` decimal(14,2) NOT NULL DEFAULT 0.00,
  `affects_inventory` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_proforma_items_proforma_line` (`proforma_id`,`line_number`),
  KEY `idx_proforma_items_proforma` (`proforma_id`),
  KEY `idx_proforma_items_product` (`product_id`),
  CONSTRAINT `fk_proforma_items_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_proforma_items_proforma` FOREIGN KEY (`proforma_id`) REFERENCES `proformas` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `quote_series` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `company_id` bigint(20) unsigned NOT NULL,
  `prefix` varchar(10) NOT NULL DEFAULT 'COT-',
  `current_number` int(10) unsigned NOT NULL DEFAULT 1,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_quote_series_company` (`company_id`),
  KEY `idx_quote_series_company_active` (`company_id`,`is_active`),
  CONSTRAINT `fk_quote_series_company` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `quotes` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `company_id` bigint(20) unsigned NOT NULL,
  `quote_series_id` bigint(20) unsigned NOT NULL,
  `customer_id` bigint(20) unsigned DEFAULT NULL,
  `warehouse_id` bigint(20) unsigned DEFAULT NULL,
  `sequence_number` int(10) unsigned NOT NULL,
  `quote_number` varchar(30) NOT NULL,
  `quote_date` date NOT NULL,
  `valid_until` date DEFAULT NULL,
  `customer_name_snapshot` varchar(180) NOT NULL,
  `customer_rtn_snapshot` varchar(30) DEFAULT NULL,
  `customer_email_snapshot` varchar(150) DEFAULT NULL,
  `customer_phone_snapshot` varchar(40) DEFAULT NULL,
  `customer_address_snapshot` varchar(255) DEFAULT NULL,
  `subtotal` decimal(14,2) NOT NULL DEFAULT 0.00,
  `discount_total` decimal(14,2) NOT NULL DEFAULT 0.00,
  `taxable_amount_15` decimal(14,2) NOT NULL DEFAULT 0.00,
  `taxable_amount_18` decimal(14,2) NOT NULL DEFAULT 0.00,
  `exempt_amount` decimal(14,2) NOT NULL DEFAULT 0.00,
  `exonerated_amount` decimal(14,2) NOT NULL DEFAULT 0.00,
  `isv_15` decimal(14,2) NOT NULL DEFAULT 0.00,
  `isv_18` decimal(14,2) NOT NULL DEFAULT 0.00,
  `tax_total` decimal(14,2) NOT NULL DEFAULT 0.00,
  `grand_total` decimal(14,2) NOT NULL DEFAULT 0.00,
  `total_in_words` varchar(255) DEFAULT NULL,
  `status` enum('BORRADOR','ENVIADA','APROBADA','RECHAZADA','VENCIDA','FACTURADA') NOT NULL DEFAULT 'BORRADOR',
  `approved_at` datetime DEFAULT NULL,
  `approved_by` bigint(20) unsigned DEFAULT NULL,
  `converted_to_invoice_id` bigint(20) unsigned DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `created_by` bigint(20) unsigned NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_quotes_company_number` (`company_id`,`quote_number`),
  KEY `idx_quotes_company_date` (`company_id`,`quote_date`),
  KEY `idx_quotes_company_status` (`company_id`,`status`),
  KEY `idx_quotes_customer` (`customer_id`),
  KEY `idx_quotes_series` (`quote_series_id`),
  KEY `idx_quotes_warehouse` (`warehouse_id`),
  KEY `idx_quotes_converted` (`converted_to_invoice_id`),
  KEY `idx_quotes_created_by` (`created_by`),
  KEY `fk_quotes_approved_by` (`approved_by`),
  CONSTRAINT `fk_quotes_approved_by` FOREIGN KEY (`approved_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_quotes_company` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_quotes_converted_invoice` FOREIGN KEY (`converted_to_invoice_id`) REFERENCES `invoices` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_quotes_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_quotes_customer` FOREIGN KEY (`customer_id`) REFERENCES `clients` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_quotes_series` FOREIGN KEY (`quote_series_id`) REFERENCES `quote_series` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_quotes_warehouse` FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `quote_items` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `quote_id` bigint(20) unsigned NOT NULL,
  `product_id` bigint(20) unsigned DEFAULT NULL,
  `line_number` int(10) unsigned NOT NULL,
  `quantity` decimal(12,2) NOT NULL DEFAULT 1.00,
  `description` varchar(255) NOT NULL,
  `unit_price` decimal(14,2) NOT NULL DEFAULT 0.00,
  `unit_cost_snapshot` decimal(14,2) NOT NULL DEFAULT 0.00,
  `tax_rate` decimal(5,2) NOT NULL DEFAULT 0.00,
  `line_discount` decimal(14,2) NOT NULL DEFAULT 0.00,
  `line_subtotal` decimal(14,2) NOT NULL DEFAULT 0.00,
  `line_tax` decimal(14,2) NOT NULL DEFAULT 0.00,
  `line_total` decimal(14,2) NOT NULL DEFAULT 0.00,
  `affects_inventory` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_quote_items_quote_line` (`quote_id`,`line_number`),
  KEY `idx_quote_items_quote` (`quote_id`),
  KEY `idx_quote_items_product` (`product_id`),
  CONSTRAINT `fk_quote_items_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_quote_items_quote` FOREIGN KEY (`quote_id`) REFERENCES `quotes` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `role_permissions` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `role_id` bigint(20) unsigned NOT NULL,
  `permission_key` varchar(80) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_role_permissions` (`role_id`,`permission_key`),
  KEY `idx_role_permissions_role` (`role_id`),
  CONSTRAINT `fk_role_permissions_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `system_licenses` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `license_text` text NOT NULL,
  `license_id` varchar(40) NOT NULL,
  `empresa` varchar(150) DEFAULT NULL,
  `equipos` int(11) NOT NULL DEFAULT 1,
  `vence` date DEFAULT NULL,
  `emitida` date NOT NULL,
  `installed_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_system_licenses_license` (`license_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `system_versions` (
  `version_key` varchar(40) NOT NULL,
  `version` bigint(20) unsigned NOT NULL DEFAULT 1,
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`version_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `user_company_access` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` bigint(20) unsigned NOT NULL,
  `company_id` bigint(20) unsigned NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_user_company` (`user_id`,`company_id`),
  KEY `idx_user_company_company_id` (`company_id`),
  CONSTRAINT `fk_user_company_company` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_user_company_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `_migrations` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `filename` varchar(255) NOT NULL,
  `executed_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `filename` (`filename`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Vistas
-- ------------------------------------------------------------

CREATE OR REPLACE VIEW `vw_invoice_print_projection` AS select `i`.`id` AS `invoice_id`,`i`.`company_id` AS `company_id`,`i`.`invoice_number` AS `invoice_number`,`i`.`sequence_number` AS `sequence_number`,`i`.`status` AS `status`,coalesce(`ic`.`new_customer_name`,`i`.`customer_name_snapshot`) AS `print_customer_name`,coalesce(`ic`.`new_invoice_date`,`i`.`invoice_date`) AS `print_invoice_date`,`i`.`customer_name_snapshot` AS `original_customer_name`,`i`.`invoice_date` AS `original_invoice_date`,`i`.`customer_rtn_snapshot` AS `customer_rtn_snapshot`,`i`.`customer_phone_snapshot` AS `customer_phone_snapshot`,`i`.`customer_address_snapshot` AS `customer_address_snapshot`,`i`.`company_legal_name_snapshot` AS `company_legal_name_snapshot`,`i`.`company_commercial_name_snapshot` AS `company_commercial_name_snapshot`,`i`.`company_rtn_snapshot` AS `company_rtn_snapshot`,`i`.`company_email_snapshot` AS `company_email_snapshot`,`i`.`company_phone_snapshot` AS `company_phone_snapshot`,`i`.`company_address_snapshot` AS `company_address_snapshot`,`i`.`cai_snapshot` AS `cai_snapshot`,`i`.`issue_deadline_snapshot` AS `issue_deadline_snapshot`,`i`.`range_start_snapshot` AS `range_start_snapshot`,`i`.`range_end_snapshot` AS `range_end_snapshot`,`i`.`subtotal` AS `subtotal`,`i`.`discount_total` AS `discount_total`,`i`.`taxable_amount_15` AS `taxable_amount_15`,`i`.`exempt_amount` AS `exempt_amount`,`i`.`exonerated_amount` AS `exonerated_amount`,`i`.`isv_15` AS `isv_15`,`i`.`tax_total` AS `tax_total`,`i`.`grand_total` AS `grand_total`,`i`.`total_in_words` AS `total_in_words`,`i`.`notes` AS `notes`,`i`.`created_by` AS `created_by`,`i`.`created_at` AS `created_at`,`i`.`updated_at` AS `updated_at` from (`invoices` `i` left join (select `c1`.`id` AS `id`,`c1`.`company_id` AS `company_id`,`c1`.`invoice_id` AS `invoice_id`,`c1`.`correction_type` AS `correction_type`,`c1`.`previous_customer_name` AS `previous_customer_name`,`c1`.`new_customer_name` AS `new_customer_name`,`c1`.`previous_invoice_date` AS `previous_invoice_date`,`c1`.`new_invoice_date` AS `new_invoice_date`,`c1`.`reason` AS `reason`,`c1`.`status` AS `status`,`c1`.`performed_by` AS `performed_by`,`c1`.`created_at` AS `created_at` from (`invoice_corrections` `c1` join (select `invoice_corrections`.`invoice_id` AS `invoice_id`,max(`invoice_corrections`.`id`) AS `max_id` from `invoice_corrections` where `invoice_corrections`.`status` = 'APLICADA' group by `invoice_corrections`.`invoice_id`) `x` on(`c1`.`id` = `x`.`max_id`))) `ic` on(`ic`.`invoice_id` = `i`.`id`));

-- ------------------------------------------------------------
-- Catálogos del sistema
-- ------------------------------------------------------------

INSERT INTO `roles` (`id`, `nombre`, `descripcion`) VALUES
  (1, 'SUPERADMIN', 'Acceso total al sistema'),
  (2, 'ADMIN', 'Administración operativa y fiscal'),
  (3, 'CAJERO', 'Emisión de facturas e historial');

INSERT INTO `role_permissions` (`id`, `role_id`, `permission_key`) VALUES
  (1, 2, 'dashboard.view'),
  (2, 2, 'invoices.view'),
  (3, 2, 'invoices.create'),
  (4, 2, 'invoices.void'),
  (5, 2, 'proformas.view'),
  (6, 2, 'proformas.create'),
  (7, 2, 'quotes.view'),
  (8, 2, 'quotes.create'),
  (9, 2, 'clients.view'),
  (10, 2, 'clients.create'),
  (11, 2, 'clients.edit'),
  (12, 2, 'products.view'),
  (13, 2, 'products.create'),
  (14, 2, 'products.edit'),
  (15, 2, 'categories.view'),
  (16, 2, 'categories.create'),
  (17, 2, 'categories.edit'),
  (18, 2, 'warehouses.view'),
  (19, 2, 'warehouses.create'),
  (20, 2, 'warehouses.edit'),
  (21, 2, 'inventory.view'),
  (22, 2, 'inventory.adjust'),
  (23, 2, 'receivables.view'),
  (24, 2, 'receivables.pay'),
  (25, 2, 'payables.view'),
  (26, 2, 'payables.create'),
  (27, 2, 'payables.pay'),
  (28, 2, 'payables.void'),
  (29, 2, 'suppliers.view'),
  (30, 2, 'suppliers.create'),
  (31, 2, 'suppliers.edit'),
  (32, 2, 'users.view'),
  (33, 2, 'users.create'),
  (34, 2, 'users.edit'),
  (35, 2, 'company.view'),
  (36, 2, 'company.edit'),
  (37, 2, 'settings.view'),
  (38, 2, 'settings.configure'),
  (39, 2, 'roles.view'),
  (64, 3, 'dashboard.view'),
  (65, 3, 'invoices.view'),
  (66, 3, 'invoices.create'),
  (67, 3, 'proformas.view'),
  (68, 3, 'proformas.create'),
  (69, 3, 'quotes.view'),
  (70, 3, 'quotes.create'),
  (71, 3, 'clients.view'),
  (72, 3, 'clients.create'),
  (73, 3, 'products.view'),
  (74, 3, 'inventory.view'),
  (75, 3, 'receivables.view'),
  (76, 3, 'receivables.pay'),
  (79, 2, 'caja.view'),
  (80, 3, 'caja.view'),
  (81, 2, 'caja.open'),
  (82, 3, 'caja.open'),
  (83, 2, 'caja.close'),
  (84, 3, 'caja.close'),
  (85, 2, 'caja.move'),
  (86, 3, 'caja.move'),
  (94, 2, 'reports.view'),
  (95, 2, 'caja.manage');

INSERT INTO `system_versions` (`version_key`, `version`) VALUES
  ('permissions', 5);

-- Primer usuario (SUPERADMIN).
INSERT INTO `users` (`username`, `email`, `password_hash`, `full_name`, `role_id`, `is_active`) VALUES
  ('superadmin', 'superadmin@sistema.local', '$2b$10$7nvap6DMxBMClBa540xUYuq9Xsc2NfunEGabWeeS7/vUSFhlRp5na', 'Super Administrador', 1, 1);

-- Migraciones incluidas en esta instalación.
INSERT INTO `_migrations` (`filename`) VALUES
  ('2026_09_11_000001_inventory_products_proformas.sql'),
  ('2026_09_17_000001_sar_billing_series.sql'),
  ('2026_09_17_000002_company_profile_logo.sql'),
  ('2026_09_17_000003_receivables_payables.sql'),
  ('2026_09_18_000001_roles_permissions.sql'),
  ('2026_09_19_000001_isv_18.sql'),
  ('2026_09_19_000002_quotes.sql'),
  ('2026_09_19_000003_cash_register.sql'),
  ('2026_09_19_000004_cash_registers.sql'),
  ('2026_09_21_000001_product_codes.sql'),
  ('2026_09_23_000001_cash_terminals.sql'),
  ('2026_09_23_000002_cash_terminal_pairings.sql'),
  ('2026_09_23_000003_cash_networks.sql'),
  ('2026_09_23_000004_cash_network_per_register.sql'),
  ('2026_09_24_000001_cash_terminals_by_ip.sql'),
  ('2026_09_24_000002_document_counters.sql'),
  ('2026_09_24_000003_system_versions.sql'),
  ('2026_09_25_000001_company_document_branding.sql'),
  ('2026_09_27_000001_inventory_entry_supplier.sql'),
  ('2026_09_29_000001_generic_client_code.sql'),
  ('2026_09_30_000001_align_schema.sql'),
  ('2026_10_01_000001_footer_text_long.sql'),
  ('2026_10_03_000001_banks.sql'),
  ('2026_10_06_000001_license_registry.sql');

SET FOREIGN_KEY_CHECKS = 1;

-- Fin de la instalación.
