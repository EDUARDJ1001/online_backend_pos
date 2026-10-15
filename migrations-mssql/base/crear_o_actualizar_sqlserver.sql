/* ============================================================
   Crear o actualizar la base de Facturación en SQL Server
   Generado con: npm run db:script-sqlserver (no editar a mano).

   Cómo usarlo (SQL Server Management Studio):
     1. Haz un respaldo si la base ya existe.
     2. Abre este archivo, conéctate al servidor y ejecútalo completo (F5).

   - Si la base [facturacion] no existe, la crea. Para otro nombre, cambia [facturacion] en la
     sección 1 (cuatro lugares).
   - Si está vacía, instala el sistema completo. Usuario inicial: superadmin /
     Admin123! (cambiar la contraseña al entrar).
   - Si ya tiene el sistema, aplica solo las actualizaciones que falten. Solo
     cambian la estructura: los datos que ya existen no se modifican ni se borran.
   - Se puede ejecutar varias veces: lo que ya está no se toca.
   - Si algo no se puede aplicar, se detiene y muestra el motivo en "Mensajes".

   Azure SQL Database: crea la base en el portal, conéctate a ESA base y
   ejecuta desde la sección 2 (Azure no admite CREATE DATABASE ... ni USE aquí).
   ============================================================ */

SET NOCOUNT ON;
SET XACT_ABORT ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET NOEXEC OFF;
GO

/* ---------- 1. Base de datos ---------- */
IF DB_ID(N'facturacion') IS NULL
BEGIN
  CREATE DATABASE [facturacion] COLLATE Modern_Spanish_CI_AI;
  ALTER DATABASE [facturacion] SET READ_COMMITTED_SNAPSHOT ON WITH ROLLBACK IMMEDIATE;
  ALTER DATABASE [facturacion] SET COMPATIBILITY_LEVEL = 150;
  PRINT N'Base facturacion creada.';
END
GO
USE [facturacion];
GO

/* ---------- 2. Comprobaciones ---------- */
-- La base tiene tablas pero no es de este sistema: no se toca.
IF OBJECT_ID(N'dbo.users', N'U') IS NULL AND EXISTS (SELECT 1 FROM sys.tables WHERE is_ms_shipped = 0)
BEGIN
  RAISERROR(N'La base tiene tablas que no son del sistema de facturación. Usa una base vacía.', 16, 1);
  SET NOEXEC ON;
END
GO
-- La base es más nueva que este script: hay que usar el script de la versión nueva.
-- (IF anidado: SQL Server no corta el AND y fallaría si la tabla aún no existe.)
IF OBJECT_ID(N'dbo._migrations', N'U') IS NOT NULL
BEGIN
  IF EXISTS (SELECT 1 FROM dbo._migrations WHERE filename NOT IN (N'2026_09_11_000001_inventory_products_proformas.sql', N'2026_09_17_000001_sar_billing_series.sql', N'2026_09_17_000002_company_profile_logo.sql', N'2026_09_17_000003_receivables_payables.sql', N'2026_09_18_000001_roles_permissions.sql', N'2026_09_19_000001_isv_18.sql', N'2026_09_19_000002_quotes.sql', N'2026_09_19_000003_cash_register.sql', N'2026_09_19_000004_cash_registers.sql', N'2026_09_21_000001_product_codes.sql', N'2026_09_23_000001_cash_terminals.sql', N'2026_09_23_000002_cash_terminal_pairings.sql', N'2026_09_23_000003_cash_networks.sql', N'2026_09_23_000004_cash_network_per_register.sql', N'2026_09_24_000001_cash_terminals_by_ip.sql', N'2026_09_24_000002_document_counters.sql', N'2026_09_24_000003_system_versions.sql', N'2026_09_25_000001_company_document_branding.sql', N'2026_09_27_000001_inventory_entry_supplier.sql', N'2026_09_29_000001_generic_client_code.sql', N'2026_09_30_000001_align_schema.sql', N'2026_10_01_000001_footer_text_long.sql', N'2026_10_03_000001_banks.sql', N'2026_10_06_000001_license_registry.sql'))
  BEGIN
    RAISERROR(N'La base ya tiene actualizaciones más nuevas que este script. Usa el script de la versión más reciente del programa.', 16, 1);
    SET NOEXEC ON;
  END
END
GO

/* ---------- 3. Instalación completa (solo si la base está vacía) ---------- */
IF OBJECT_ID(N'dbo.users', N'U') IS NULL
BEGIN
  BEGIN TRY
    EXEC(N'/* ============================================================
   Instalación completa: facturación multiempresa (SQL Server)
   Generado: 2026-10-06 desde la base MySQL con todas las migraciones aplicadas.
   Para: SQL Server 2019+ (local, Express incluido) y Azure SQL Database.

   Crea en la base ACTUAL (vacía) todo lo que usa el sistema: tablas, índices,
   relaciones, vista de impresión, roles, permisos por rol, versiones y el
   primer usuario administrador. No incluye empresas ni datos de operación.

   Antes: crear la base (ver docs/migracion-sql-server.md), conectarse A ESA BASE
   y ejecutar este archivo completo. Es un solo lote (sin GO) dentro de una
   transacción: si algo falla no queda nada a medias.

   Usuario inicial: superadmin / Admin123!  (cambiar la contraseña al entrar).

   Fechas y horas se guardan en UTC. Migraciones incluidas:
   @incluye 2026_09_11_000001_inventory_products_proformas.sql
   @incluye 2026_09_17_000001_sar_billing_series.sql
   @incluye 2026_09_17_000002_company_profile_logo.sql
   @incluye 2026_09_17_000003_receivables_payables.sql
   @incluye 2026_09_18_000001_roles_permissions.sql
   @incluye 2026_09_19_000001_isv_18.sql
   @incluye 2026_09_19_000002_quotes.sql
   @incluye 2026_09_19_000003_cash_register.sql
   @incluye 2026_09_19_000004_cash_registers.sql
   @incluye 2026_09_21_000001_product_codes.sql
   @incluye 2026_09_23_000001_cash_terminals.sql
   @incluye 2026_09_23_000002_cash_terminal_pairings.sql
   @incluye 2026_09_23_000003_cash_networks.sql
   @incluye 2026_09_23_000004_cash_network_per_register.sql
   @incluye 2026_09_24_000001_cash_terminals_by_ip.sql
   @incluye 2026_09_24_000002_document_counters.sql
   @incluye 2026_09_24_000003_system_versions.sql
   @incluye 2026_09_25_000001_company_document_branding.sql
   @incluye 2026_09_27_000001_inventory_entry_supplier.sql
   @incluye 2026_09_29_000001_generic_client_code.sql
   @incluye 2026_09_30_000001_align_schema.sql
   @incluye 2026_10_01_000001_footer_text_long.sql
   @incluye 2026_10_03_000001_banks.sql
   @incluye 2026_10_06_000001_license_registry.sql
   ============================================================ */

SET NOCOUNT ON;
SET XACT_ABORT ON;
-- Requeridas por índices filtrados (sqlcmd las trae desactivadas; el programa las usa activas).
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET NUMERIC_ROUNDABORT OFF;

IF DB_NAME() IN (N''master'', N''model'', N''msdb'', N''tempdb'')
  THROW 50001, N''Conéctate a la base del sistema (no a master) antes de ejecutar este archivo.'', 1;
IF EXISTS (SELECT 1 FROM sys.tables WHERE is_ms_shipped = 0)
  THROW 50002, N''La base de datos no está vacía: este archivo solo prepara una base nueva.'', 1;

BEGIN TRANSACTION;

CREATE TABLE [dbo].[companies] (
  [id] BIGINT IDENTITY(1,1) NOT NULL,
  [code] NVARCHAR(30) NOT NULL,
  [commercial_name] NVARCHAR(150) NOT NULL,
  [legal_name] NVARCHAR(180) NOT NULL,
  [rtn] NVARCHAR(30) NOT NULL,
  [email] NVARCHAR(150) NULL,
  [phone] NVARCHAR(40) NULL,
  [address] NVARCHAR(255) NULL,
  [logo_url] NVARCHAR(MAX) NULL,
  [favicon_url] NVARCHAR(MAX) NULL,
  [footer_brands] NVARCHAR(MAX) NULL,
  [layout_key] NVARCHAR(50) NOT NULL,
  [primary_color] NVARCHAR(20) NULL,
  [secondary_color] NVARCHAR(20) NULL,
  [sidebar_color] NVARCHAR(20) NULL,
  [header_color] NVARCHAR(20) NULL,
  [document_color] NVARCHAR(20) NULL,
  [theme_mode] NVARCHAR(5) NOT NULL CONSTRAINT [DF_companies_theme_mode] DEFAULT N''light'' CONSTRAINT [CK_companies_theme_mode] CHECK ([theme_mode] IN (N''light'', N''dark'')),
  [is_active] TINYINT NOT NULL CONSTRAINT [DF_companies_is_active] DEFAULT 1,
  [created_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_companies_created_at] DEFAULT SYSUTCDATETIME(),
  [updated_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_companies_updated_at] DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [PK_companies] PRIMARY KEY CLUSTERED ([id])
);

CREATE UNIQUE INDEX [uq_companies_code] ON [dbo].[companies] ([code]);
CREATE UNIQUE INDEX [uq_companies_layout_key] ON [dbo].[companies] ([layout_key]);
CREATE UNIQUE INDEX [uq_companies_rtn] ON [dbo].[companies] ([rtn]);

CREATE TABLE [dbo].[roles] (
  [id] BIGINT IDENTITY(1,1) NOT NULL,
  [nombre] NVARCHAR(50) NOT NULL,
  [descripcion] NVARCHAR(255) NULL,
  [created_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_roles_created_at] DEFAULT SYSUTCDATETIME(),
  [updated_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_roles_updated_at] DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [PK_roles] PRIMARY KEY CLUSTERED ([id])
);

CREATE UNIQUE INDEX [uq_roles_nombre] ON [dbo].[roles] ([nombre]);

CREATE TABLE [dbo].[users] (
  [id] BIGINT IDENTITY(1,1) NOT NULL,
  [username] NVARCHAR(80) NOT NULL,
  [email] NVARCHAR(150) NOT NULL,
  [password_hash] NVARCHAR(255) NOT NULL,
  [full_name] NVARCHAR(150) NOT NULL,
  [role_id] BIGINT NOT NULL,
  [is_active] TINYINT NOT NULL CONSTRAINT [DF_users_is_active] DEFAULT 1,
  [last_login_at] DATETIME2(0) NULL,
  [created_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_users_created_at] DEFAULT SYSUTCDATETIME(),
  [updated_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_users_updated_at] DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [PK_users] PRIMARY KEY CLUSTERED ([id])
);

CREATE INDEX [idx_users_role_id] ON [dbo].[users] ([role_id]);
CREATE UNIQUE INDEX [uq_users_email] ON [dbo].[users] ([email]);
CREATE UNIQUE INDEX [uq_users_username] ON [dbo].[users] ([username]);

CREATE TABLE [dbo].[audit_logs] (
  [id] BIGINT IDENTITY(1,1) NOT NULL,
  [company_id] BIGINT NULL,
  [user_id] BIGINT NULL,
  [entity_type] NVARCHAR(50) NOT NULL,
  [entity_id] BIGINT NULL,
  [action] NVARCHAR(50) NOT NULL,
  [description] NVARCHAR(255) NULL,
  [old_values] NVARCHAR(MAX) NULL,
  [new_values] NVARCHAR(MAX) NULL,
  [ip_address] NVARCHAR(45) NULL,
  [user_agent] NVARCHAR(255) NULL,
  [created_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_audit_logs_created_at] DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [PK_audit_logs] PRIMARY KEY CLUSTERED ([id]),
  CONSTRAINT [CK_audit_logs_new_values_json] CHECK (ISJSON([new_values]) = 1),
  CONSTRAINT [CK_audit_logs_old_values_json] CHECK (ISJSON([old_values]) = 1)
);

CREATE INDEX [idx_audit_logs_company] ON [dbo].[audit_logs] ([company_id]);
CREATE INDEX [idx_audit_logs_entity] ON [dbo].[audit_logs] ([entity_type], [entity_id]);
CREATE INDEX [idx_audit_logs_user] ON [dbo].[audit_logs] ([user_id]);

CREATE TABLE [dbo].[bank_accounts] (
  [id] BIGINT IDENTITY(1,1) NOT NULL,
  [company_id] BIGINT NOT NULL,
  [bank_name] NVARCHAR(80) NOT NULL,
  [account_type] NVARCHAR(9) NOT NULL CONSTRAINT [DF_bank_accounts_account_type] DEFAULT N''CORRIENTE'' CONSTRAINT [CK_bank_accounts_account_type] CHECK ([account_type] IN (N''CORRIENTE'', N''AHORRO'')),
  [currency] NVARCHAR(3) NOT NULL CONSTRAINT [DF_bank_accounts_currency] DEFAULT N''HNL'' CONSTRAINT [CK_bank_accounts_currency] CHECK ([currency] IN (N''HNL'', N''USD'')),
  [account_number] NVARCHAR(40) NOT NULL,
  [alias] NVARCHAR(80) NULL,
  [opening_balance] DECIMAL(14,2) NOT NULL CONSTRAINT [DF_bank_accounts_opening_balance] DEFAULT 0.00,
  [opening_date] DATE NOT NULL,
  [is_active] TINYINT NOT NULL CONSTRAINT [DF_bank_accounts_is_active] DEFAULT 1,
  [created_by] BIGINT NOT NULL,
  [created_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_bank_accounts_created_at] DEFAULT SYSUTCDATETIME(),
  [updated_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_bank_accounts_updated_at] DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [PK_bank_accounts] PRIMARY KEY CLUSTERED ([id])
);

CREATE INDEX [fk_bank_accounts_created_by] ON [dbo].[bank_accounts] ([created_by]);
CREATE UNIQUE INDEX [uq_bank_accounts_number] ON [dbo].[bank_accounts] ([company_id], [bank_name], [account_number]);

CREATE TABLE [dbo].[bank_movements] (
  [id] BIGINT IDENTITY(1,1) NOT NULL,
  [company_id] BIGINT NOT NULL,
  [bank_account_id] BIGINT NOT NULL,
  [movement_date] DATE NOT NULL,
  [movement_type] NVARCHAR(21) NOT NULL CONSTRAINT [CK_bank_movements_movement_type] CHECK ([movement_type] IN (N''DEPOSITO'', N''RETIRO'', N''TRANSFERENCIA_ENTRADA'', N''TRANSFERENCIA_SALIDA'', N''COMISION'', N''INTERES'', N''NOTA_CREDITO'', N''NOTA_DEBITO'', N''CHEQUE'')),
  [direction] NVARCHAR(3) NOT NULL CONSTRAINT [CK_bank_movements_direction] CHECK ([direction] IN (N''IN'', N''OUT'')),
  [amount] DECIMAL(14,2) NOT NULL,
  [reference] NVARCHAR(60) NULL,
  [description] NVARCHAR(255) NULL,
  [check_number] NVARCHAR(30) NULL,
  [beneficiary] NVARCHAR(150) NULL,
  [check_status] NVARCHAR(7) NULL CONSTRAINT [CK_bank_movements_check_status] CHECK ([check_status] IN (N''EMITIDO'', N''COBRADO'')),
  [related_movement_id] BIGINT NULL,
  [status] NVARCHAR(7) NOT NULL CONSTRAINT [DF_bank_movements_status] DEFAULT N''ACTIVO'' CONSTRAINT [CK_bank_movements_status] CHECK ([status] IN (N''ACTIVO'', N''ANULADO'')),
  [void_reason] NVARCHAR(255) NULL,
  [voided_by] BIGINT NULL,
  [voided_at] DATETIME2(0) NULL,
  [created_by] BIGINT NOT NULL,
  [created_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_bank_movements_created_at] DEFAULT SYSUTCDATETIME(),
  [updated_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_bank_movements_updated_at] DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [PK_bank_movements] PRIMARY KEY CLUSTERED ([id])
);

CREATE INDEX [fk_bank_movements_created_by] ON [dbo].[bank_movements] ([created_by]);
CREATE INDEX [fk_bank_movements_voided_by] ON [dbo].[bank_movements] ([voided_by]);
CREATE INDEX [idx_bank_movements_account_date] ON [dbo].[bank_movements] ([bank_account_id], [movement_date]);
CREATE INDEX [idx_bank_movements_company] ON [dbo].[bank_movements] ([company_id]);
CREATE INDEX [idx_bank_movements_related] ON [dbo].[bank_movements] ([related_movement_id]);
CREATE UNIQUE INDEX [uq_bank_movements_check] ON [dbo].[bank_movements] ([bank_account_id], [check_number]) WHERE [check_number] IS NOT NULL;

CREATE TABLE [dbo].[billing_series] (
  [id] BIGINT IDENTITY(1,1) NOT NULL,
  [company_id] BIGINT NOT NULL,
  [document_type] NVARCHAR(12) NOT NULL CONSTRAINT [DF_billing_series_document_type] DEFAULT N''FACTURA'' CONSTRAINT [CK_billing_series_document_type] CHECK ([document_type] IN (N''FACTURA'', N''NOTA_CREDITO'', N''NOTA_DEBITO'', N''RECIBO'')),
  [establishment_code] NCHAR(3) NOT NULL,
  [point_code] NCHAR(3) NOT NULL,
  [document_code] NCHAR(2) NOT NULL CONSTRAINT [DF_billing_series_document_code] DEFAULT N''01'',
  [cai] NVARCHAR(80) NOT NULL,
  [resolution_number] NVARCHAR(80) NULL,
  [resolution_date] DATE NULL,
  [issue_deadline] DATE NOT NULL,
  [range_start] BIGINT NOT NULL,
  [range_end] BIGINT NOT NULL,
  [current_number] BIGINT NOT NULL,
  [is_active] TINYINT NOT NULL CONSTRAINT [DF_billing_series_is_active] DEFAULT 1,
  [notes] NVARCHAR(255) NULL,
  [created_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_billing_series_created_at] DEFAULT SYSUTCDATETIME(),
  [updated_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_billing_series_updated_at] DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [PK_billing_series] PRIMARY KEY CLUSTERED ([id]),
  CONSTRAINT [chk_billing_series_current] CHECK ([current_number] >= [range_start] AND [current_number] <= [range_end] + 1),
  CONSTRAINT [chk_billing_series_range] CHECK ([range_start] <= [range_end])
);

CREATE INDEX [idx_billing_series_company] ON [dbo].[billing_series] ([company_id]);
CREATE INDEX [idx_billing_series_company_active] ON [dbo].[billing_series] ([company_id], [is_active]);
CREATE INDEX [idx_billing_series_deadline] ON [dbo].[billing_series] ([company_id], [issue_deadline]);

CREATE TABLE [dbo].[billing_settings] (
  [id] BIGINT IDENTITY(1,1) NOT NULL,
  [company_id] BIGINT NOT NULL,
  [default_tax_rate] DECIMAL(5,2) NOT NULL CONSTRAINT [DF_billing_settings_default_tax_rate] DEFAULT 15.00,
  [footer_text] NVARCHAR(MAX) NULL,
  [payable_to] NVARCHAR(180) NULL,
  [invoice_title] NVARCHAR(100) NOT NULL CONSTRAINT [DF_billing_settings_invoice_title] DEFAULT N''Factura'',
  [legend_original] NVARCHAR(120) NOT NULL CONSTRAINT [DF_billing_settings_legend_original] DEFAULT N''Original: Cliente'',
  [legend_copy] NVARCHAR(120) NOT NULL CONSTRAINT [DF_billing_settings_legend_copy] DEFAULT N''Copia: Obligado Tributario'',
  [sar_notice] NVARCHAR(255) NOT NULL CONSTRAINT [DF_billing_settings_sar_notice] DEFAULT N''La factura es beneficio de todos, ¡Exíjala!'',
  [allow_client_name_correction] TINYINT NOT NULL CONSTRAINT [DF_billing_settings_allow_client_name_correction] DEFAULT 1,
  [allow_invoice_date_reissue] TINYINT NOT NULL CONSTRAINT [DF_billing_settings_allow_invoice_date_reissue] DEFAULT 1,
  [created_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_billing_settings_created_at] DEFAULT SYSUTCDATETIME(),
  [updated_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_billing_settings_updated_at] DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [PK_billing_settings] PRIMARY KEY CLUSTERED ([id])
);

CREATE UNIQUE INDEX [uq_billing_settings_company_id] ON [dbo].[billing_settings] ([company_id]);

CREATE TABLE [dbo].[cash_registers] (
  [id] BIGINT IDENTITY(1,1) NOT NULL,
  [company_id] BIGINT NOT NULL,
  [name] NVARCHAR(80) NOT NULL,
  [is_active] TINYINT NOT NULL CONSTRAINT [DF_cash_registers_is_active] DEFAULT 1,
  [created_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_cash_registers_created_at] DEFAULT SYSUTCDATETIME(),
  [updated_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_cash_registers_updated_at] DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [PK_cash_registers] PRIMARY KEY CLUSTERED ([id])
);

CREATE INDEX [idx_cash_registers_company] ON [dbo].[cash_registers] ([company_id], [is_active]);
CREATE UNIQUE INDEX [uq_cash_registers_name] ON [dbo].[cash_registers] ([company_id], [name]);

CREATE TABLE [dbo].[cash_sessions] (
  [id] BIGINT IDENTITY(1,1) NOT NULL,
  [company_id] BIGINT NOT NULL,
  [cash_register_id] BIGINT NOT NULL,
  [opened_by] BIGINT NOT NULL,
  [opened_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_cash_sessions_opened_at] DEFAULT SYSUTCDATETIME(),
  [opening_amount] DECIMAL(14,2) NOT NULL CONSTRAINT [DF_cash_sessions_opening_amount] DEFAULT 0.00,
  [status] NVARCHAR(7) NOT NULL CONSTRAINT [DF_cash_sessions_status] DEFAULT N''ABIERTA'' CONSTRAINT [CK_cash_sessions_status] CHECK ([status] IN (N''ABIERTA'', N''CERRADA'')),
  [closed_by] BIGINT NULL,
  [closed_at] DATETIME2(0) NULL,
  [counted_amount] DECIMAL(14,2) NULL,
  [expected_amount] DECIMAL(14,2) NULL,
  [difference] DECIMAL(14,2) NULL,
  [opening_notes] NVARCHAR(255) NULL,
  [opening_breakdown] NVARCHAR(MAX) NULL,
  [closing_notes] NVARCHAR(255) NULL,
  [closing_breakdown] NVARCHAR(MAX) NULL,
  [created_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_cash_sessions_created_at] DEFAULT SYSUTCDATETIME(),
  [updated_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_cash_sessions_updated_at] DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [PK_cash_sessions] PRIMARY KEY CLUSTERED ([id]),
  CONSTRAINT [CK_cash_sessions_closing_breakdown_json] CHECK (ISJSON([closing_breakdown]) = 1),
  CONSTRAINT [CK_cash_sessions_opening_breakdown_json] CHECK (ISJSON([opening_breakdown]) = 1)
);

CREATE INDEX [fk_cash_sessions_closed_by] ON [dbo].[cash_sessions] ([closed_by]);
CREATE INDEX [idx_cash_sessions_company_status] ON [dbo].[cash_sessions] ([company_id], [status]);
CREATE INDEX [idx_cash_sessions_opened_at] ON [dbo].[cash_sessions] ([company_id], [opened_at]);
CREATE INDEX [idx_cash_sessions_opened_by] ON [dbo].[cash_sessions] ([opened_by]);
CREATE INDEX [idx_cash_sessions_register] ON [dbo].[cash_sessions] ([cash_register_id]);
CREATE UNIQUE INDEX [uq_cash_sessions_open] ON [dbo].[cash_sessions] ([cash_register_id]) WHERE [status] = N''ABIERTA'';

CREATE TABLE [dbo].[cash_movements] (
  [id] BIGINT IDENTITY(1,1) NOT NULL,
  [company_id] BIGINT NOT NULL,
  [session_id] BIGINT NOT NULL,
  [type] NVARCHAR(13) NOT NULL CONSTRAINT [CK_cash_movements_type] CHECK ([type] IN (N''APERTURA'', N''VENTA_CONTADO'', N''ABONO_CXC'', N''PAGO_CXP'', N''INGRESO'', N''EGRESO'', N''RETIRO'', N''AJUSTE'')),
  [method] NVARCHAR(13) NOT NULL CONSTRAINT [DF_cash_movements_method] DEFAULT N''EFECTIVO'' CONSTRAINT [CK_cash_movements_method] CHECK ([method] IN (N''EFECTIVO'', N''TRANSFERENCIA'', N''CHEQUE'', N''TARJETA'', N''OTRO'')),
  [direction] NVARCHAR(3) NOT NULL CONSTRAINT [CK_cash_movements_direction] CHECK ([direction] IN (N''IN'', N''OUT'')),
  [amount] DECIMAL(14,2) NOT NULL,
  [reference_type] NVARCHAR(30) NULL,
  [reference_id] BIGINT NULL,
  [description] NVARCHAR(255) NULL,
  [created_by] BIGINT NOT NULL,
  [created_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_cash_movements_created_at] DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [PK_cash_movements] PRIMARY KEY CLUSTERED ([id])
);

CREATE INDEX [fk_cash_movements_created_by] ON [dbo].[cash_movements] ([created_by]);
CREATE INDEX [idx_cash_movements_company_date] ON [dbo].[cash_movements] ([company_id], [created_at]);
CREATE INDEX [idx_cash_movements_reference] ON [dbo].[cash_movements] ([reference_type], [reference_id]);
CREATE INDEX [idx_cash_movements_session] ON [dbo].[cash_movements] ([session_id]);

CREATE TABLE [dbo].[cash_network_rules] (
  [id] BIGINT IDENTITY(1,1) NOT NULL,
  [company_id] BIGINT NOT NULL,
  [cash_register_id] BIGINT NULL,
  [cidr] NVARCHAR(64) NOT NULL,
  [label] NVARCHAR(80) NULL,
  [created_by] BIGINT NOT NULL,
  [created_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_cash_network_rules_created_at] DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [PK_cash_network_rules] PRIMARY KEY CLUSTERED ([id])
);

CREATE INDEX [fk_cash_network_rules_created_by] ON [dbo].[cash_network_rules] ([created_by]);
CREATE INDEX [fk_cash_network_rules_register] ON [dbo].[cash_network_rules] ([cash_register_id]);
CREATE INDEX [idx_cash_network_rules_scope] ON [dbo].[cash_network_rules] ([company_id], [cash_register_id]);

CREATE TABLE [dbo].[cash_terminals] (
  [id] BIGINT IDENTITY(1,1) NOT NULL,
  [company_id] BIGINT NOT NULL,
  [cash_register_id] BIGINT NOT NULL,
  [name] NVARCHAR(80) NOT NULL,
  [token_hash] NCHAR(64) NULL,
  [bound_ip] NVARCHAR(45) NULL,
  [is_active] TINYINT NOT NULL CONSTRAINT [DF_cash_terminals_is_active] DEFAULT 1,
  [registered_by] BIGINT NOT NULL,
  [registered_ip] NVARCHAR(45) NULL,
  [last_seen_at] DATETIME2(0) NULL,
  [last_ip] NVARCHAR(45) NULL,
  [created_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_cash_terminals_created_at] DEFAULT SYSUTCDATETIME(),
  [updated_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_cash_terminals_updated_at] DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [PK_cash_terminals] PRIMARY KEY CLUSTERED ([id])
);

CREATE INDEX [fk_cash_terminals_registered_by] ON [dbo].[cash_terminals] ([registered_by]);
CREATE INDEX [idx_cash_terminals_bound_ip] ON [dbo].[cash_terminals] ([company_id], [bound_ip]);
CREATE INDEX [idx_cash_terminals_company] ON [dbo].[cash_terminals] ([company_id], [is_active]);
CREATE INDEX [idx_cash_terminals_register] ON [dbo].[cash_terminals] ([cash_register_id]);
CREATE UNIQUE INDEX [uq_cash_terminals_token] ON [dbo].[cash_terminals] ([token_hash]) WHERE [token_hash] IS NOT NULL;

CREATE TABLE [dbo].[cash_terminal_pairings] (
  [id] BIGINT IDENTITY(1,1) NOT NULL,
  [company_id] BIGINT NOT NULL,
  [cash_register_id] BIGINT NOT NULL,
  [code_hash] NCHAR(64) NOT NULL,
  [terminal_name] NVARCHAR(80) NULL,
  [created_by] BIGINT NOT NULL,
  [expires_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_cash_terminal_pairings_expires_at] DEFAULT SYSUTCDATETIME(),
  [used_at] DATETIME2(0) NULL,
  [used_terminal_id] BIGINT NULL,
  [created_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_cash_terminal_pairings_created_at] DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [PK_cash_terminal_pairings] PRIMARY KEY CLUSTERED ([id])
);

CREATE INDEX [fk_cash_pairings_created_by] ON [dbo].[cash_terminal_pairings] ([created_by]);
CREATE INDEX [fk_cash_pairings_terminal] ON [dbo].[cash_terminal_pairings] ([used_terminal_id]);
CREATE INDEX [idx_cash_pairings_code] ON [dbo].[cash_terminal_pairings] ([company_id], [code_hash]);
CREATE INDEX [idx_cash_pairings_register] ON [dbo].[cash_terminal_pairings] ([cash_register_id], [used_at]);

CREATE TABLE [dbo].[clients] (
  [id] BIGINT IDENTITY(1,1) NOT NULL,
  [company_id] BIGINT NOT NULL,
  [code] NVARCHAR(30) NULL,
  [name] NVARCHAR(180) NOT NULL,
  [rtn] NVARCHAR(30) NULL,
  [email] NVARCHAR(150) NULL,
  [phone] NVARCHAR(40) NULL,
  [address] NVARCHAR(255) NULL,
  [is_generic] TINYINT NOT NULL CONSTRAINT [DF_clients_is_generic] DEFAULT 0,
  [is_active] TINYINT NOT NULL CONSTRAINT [DF_clients_is_active] DEFAULT 1,
  [created_by] BIGINT NULL,
  [created_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_clients_created_at] DEFAULT SYSUTCDATETIME(),
  [updated_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_clients_updated_at] DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [PK_clients] PRIMARY KEY CLUSTERED ([id])
);

CREATE INDEX [idx_clients_company_name] ON [dbo].[clients] ([company_id], [name]);
CREATE INDEX [idx_clients_company_rtn] ON [dbo].[clients] ([company_id], [rtn]);
CREATE INDEX [idx_clients_created_by] ON [dbo].[clients] ([created_by]);
CREATE UNIQUE INDEX [uq_clients_company_code] ON [dbo].[clients] ([company_id], [code]) WHERE [code] IS NOT NULL;

CREATE TABLE [dbo].[document_counters] (
  [company_id] BIGINT NOT NULL,
  [counter_key] NVARCHAR(40) NOT NULL,
  [last_value] BIGINT NOT NULL CONSTRAINT [DF_document_counters_last_value] DEFAULT 0,
  [updated_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_document_counters_updated_at] DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [PK_document_counters] PRIMARY KEY CLUSTERED ([company_id], [counter_key])
);


CREATE TABLE [dbo].[suppliers] (
  [id] BIGINT IDENTITY(1,1) NOT NULL,
  [company_id] BIGINT NOT NULL,
  [code] NVARCHAR(30) NULL,
  [name] NVARCHAR(180) NOT NULL,
  [rtn] NVARCHAR(30) NULL,
  [email] NVARCHAR(150) NULL,
  [phone] NVARCHAR(40) NULL,
  [address] NVARCHAR(255) NULL,
  [is_active] TINYINT NOT NULL CONSTRAINT [DF_suppliers_is_active] DEFAULT 1,
  [created_by] BIGINT NULL,
  [created_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_suppliers_created_at] DEFAULT SYSUTCDATETIME(),
  [updated_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_suppliers_updated_at] DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [PK_suppliers] PRIMARY KEY CLUSTERED ([id])
);

CREATE INDEX [idx_suppliers_company_name] ON [dbo].[suppliers] ([company_id], [name]);
CREATE INDEX [idx_suppliers_company_rtn] ON [dbo].[suppliers] ([company_id], [rtn]);
CREATE INDEX [idx_suppliers_created_by] ON [dbo].[suppliers] ([created_by]);
CREATE UNIQUE INDEX [uq_suppliers_company_code] ON [dbo].[suppliers] ([company_id], [code]) WHERE [code] IS NOT NULL;

CREATE TABLE [dbo].[warehouses] (
  [id] BIGINT IDENTITY(1,1) NOT NULL,
  [company_id] BIGINT NOT NULL,
  [code] NVARCHAR(30) NOT NULL,
  [name] NVARCHAR(120) NOT NULL,
  [address] NVARCHAR(255) NULL,
  [is_default] TINYINT NOT NULL CONSTRAINT [DF_warehouses_is_default] DEFAULT 0,
  [is_active] TINYINT NOT NULL CONSTRAINT [DF_warehouses_is_active] DEFAULT 1,
  [created_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_warehouses_created_at] DEFAULT SYSUTCDATETIME(),
  [updated_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_warehouses_updated_at] DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [PK_warehouses] PRIMARY KEY CLUSTERED ([id])
);

CREATE INDEX [idx_warehouses_company] ON [dbo].[warehouses] ([company_id]);
CREATE INDEX [idx_warehouses_company_active] ON [dbo].[warehouses] ([company_id], [is_active]);
CREATE UNIQUE INDEX [uq_warehouses_company_code] ON [dbo].[warehouses] ([company_id], [code]);

CREATE TABLE [dbo].[inventory_entries] (
  [id] BIGINT IDENTITY(1,1) NOT NULL,
  [company_id] BIGINT NOT NULL,
  [warehouse_id] BIGINT NOT NULL,
  [entry_date] DATE NOT NULL,
  [supplier_id] BIGINT NULL,
  [supplier_name] NVARCHAR(180) NULL,
  [document_number] NVARCHAR(80) NULL,
  [notes] NVARCHAR(MAX) NULL,
  [status] NVARCHAR(8) NOT NULL CONSTRAINT [DF_inventory_entries_status] DEFAULT N''APLICADA'' CONSTRAINT [CK_inventory_entries_status] CHECK ([status] IN (N''BORRADOR'', N''APLICADA'', N''ANULADA'')),
  [created_by] BIGINT NOT NULL,
  [created_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_inventory_entries_created_at] DEFAULT SYSUTCDATETIME(),
  [updated_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_inventory_entries_updated_at] DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [PK_inventory_entries] PRIMARY KEY CLUSTERED ([id])
);

CREATE INDEX [idx_inventory_entries_company_date] ON [dbo].[inventory_entries] ([company_id], [entry_date]);
CREATE INDEX [idx_inventory_entries_created_by] ON [dbo].[inventory_entries] ([created_by]);
CREATE INDEX [idx_inventory_entries_supplier] ON [dbo].[inventory_entries] ([supplier_id]);
CREATE INDEX [idx_inventory_entries_warehouse] ON [dbo].[inventory_entries] ([warehouse_id]);

CREATE TABLE [dbo].[product_categories] (
  [id] BIGINT IDENTITY(1,1) NOT NULL,
  [company_id] BIGINT NOT NULL,
  [name] NVARCHAR(120) NOT NULL,
  [description] NVARCHAR(255) NULL,
  [is_active] TINYINT NOT NULL CONSTRAINT [DF_product_categories_is_active] DEFAULT 1,
  [created_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_product_categories_created_at] DEFAULT SYSUTCDATETIME(),
  [updated_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_product_categories_updated_at] DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [PK_product_categories] PRIMARY KEY CLUSTERED ([id])
);

CREATE INDEX [idx_product_categories_company] ON [dbo].[product_categories] ([company_id]);
CREATE UNIQUE INDEX [uq_product_categories_company_name] ON [dbo].[product_categories] ([company_id], [name]);

CREATE TABLE [dbo].[products] (
  [id] BIGINT IDENTITY(1,1) NOT NULL,
  [company_id] BIGINT NOT NULL,
  [category_id] BIGINT NULL,
  [code] NVARCHAR(40) NOT NULL,
  [barcode] NVARCHAR(60) NULL,
  [name] NVARCHAR(180) NOT NULL,
  [description] NVARCHAR(255) NULL,
  [image_url] NVARCHAR(255) NULL,
  [type] NVARCHAR(10) NOT NULL CONSTRAINT [DF_products_type] DEFAULT N''PRODUCTO'' CONSTRAINT [CK_products_type] CHECK ([type] IN (N''PRODUCTO'', N''SERVICIO'', N''MATERIALES'')),
  [unit_measure] NVARCHAR(30) NOT NULL CONSTRAINT [DF_products_unit_measure] DEFAULT N''UND'',
  [sale_price] DECIMAL(14,2) NOT NULL CONSTRAINT [DF_products_sale_price] DEFAULT 0.00,
  [cost_price] DECIMAL(14,2) NOT NULL CONSTRAINT [DF_products_cost_price] DEFAULT 0.00,
  [taxable] TINYINT NOT NULL CONSTRAINT [DF_products_taxable] DEFAULT 1,
  [tax_rate] DECIMAL(5,2) NOT NULL CONSTRAINT [DF_products_tax_rate] DEFAULT 15.00,
  [controls_stock] TINYINT NOT NULL CONSTRAINT [DF_products_controls_stock] DEFAULT 1,
  [min_stock] DECIMAL(14,2) NOT NULL CONSTRAINT [DF_products_min_stock] DEFAULT 0.00,
  [is_active] TINYINT NOT NULL CONSTRAINT [DF_products_is_active] DEFAULT 1,
  [created_by] BIGINT NULL,
  [created_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_products_created_at] DEFAULT SYSUTCDATETIME(),
  [updated_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_products_updated_at] DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [PK_products] PRIMARY KEY CLUSTERED ([id])
);

CREATE INDEX [idx_products_category] ON [dbo].[products] ([category_id]);
CREATE INDEX [idx_products_company_barcode] ON [dbo].[products] ([company_id], [barcode]);
CREATE INDEX [idx_products_company_name] ON [dbo].[products] ([company_id], [name]);
CREATE INDEX [idx_products_created_by] ON [dbo].[products] ([created_by]);
CREATE UNIQUE INDEX [uq_products_company_code] ON [dbo].[products] ([company_id], [code]);

CREATE TABLE [dbo].[inventory_entry_items] (
  [id] BIGINT IDENTITY(1,1) NOT NULL,
  [entry_id] BIGINT NOT NULL,
  [product_id] BIGINT NOT NULL,
  [quantity] DECIMAL(14,2) NOT NULL CONSTRAINT [DF_inventory_entry_items_quantity] DEFAULT 0.00,
  [unit_cost] DECIMAL(14,2) NOT NULL CONSTRAINT [DF_inventory_entry_items_unit_cost] DEFAULT 0.00,
  [total_cost] DECIMAL(14,2) NOT NULL CONSTRAINT [DF_inventory_entry_items_total_cost] DEFAULT 0.00,
  [created_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_inventory_entry_items_created_at] DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [PK_inventory_entry_items] PRIMARY KEY CLUSTERED ([id])
);

CREATE INDEX [idx_inventory_entry_items_entry] ON [dbo].[inventory_entry_items] ([entry_id]);
CREATE INDEX [idx_inventory_entry_items_product] ON [dbo].[inventory_entry_items] ([product_id]);

CREATE TABLE [dbo].[proforma_series] (
  [id] BIGINT IDENTITY(1,1) NOT NULL,
  [company_id] BIGINT NOT NULL,
  [prefix] NVARCHAR(10) NOT NULL CONSTRAINT [DF_proforma_series_prefix] DEFAULT N''PRO-'',
  [current_number] BIGINT NOT NULL CONSTRAINT [DF_proforma_series_current_number] DEFAULT 1,
  [is_active] TINYINT NOT NULL CONSTRAINT [DF_proforma_series_is_active] DEFAULT 1,
  [created_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_proforma_series_created_at] DEFAULT SYSUTCDATETIME(),
  [updated_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_proforma_series_updated_at] DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [PK_proforma_series] PRIMARY KEY CLUSTERED ([id])
);

CREATE INDEX [idx_proforma_series_company_active] ON [dbo].[proforma_series] ([company_id], [is_active]);
CREATE UNIQUE INDEX [uq_proforma_series_company] ON [dbo].[proforma_series] ([company_id]);

CREATE TABLE [dbo].[proformas] (
  [id] BIGINT IDENTITY(1,1) NOT NULL,
  [company_id] BIGINT NOT NULL,
  [proforma_series_id] BIGINT NOT NULL,
  [customer_id] BIGINT NULL,
  [warehouse_id] BIGINT NULL,
  [sequence_number] BIGINT NOT NULL,
  [proforma_number] NVARCHAR(30) NOT NULL,
  [proforma_date] DATE NOT NULL,
  [valid_until] DATE NULL,
  [customer_name_snapshot] NVARCHAR(180) NOT NULL,
  [customer_rtn_snapshot] NVARCHAR(30) NULL,
  [customer_phone_snapshot] NVARCHAR(40) NULL,
  [customer_address_snapshot] NVARCHAR(255) NULL,
  [subtotal] DECIMAL(14,2) NOT NULL CONSTRAINT [DF_proformas_subtotal] DEFAULT 0.00,
  [discount_total] DECIMAL(14,2) NOT NULL CONSTRAINT [DF_proformas_discount_total] DEFAULT 0.00,
  [taxable_amount_15] DECIMAL(14,2) NOT NULL CONSTRAINT [DF_proformas_taxable_amount_15] DEFAULT 0.00,
  [taxable_amount_18] DECIMAL(14,2) NOT NULL CONSTRAINT [DF_proformas_taxable_amount_18] DEFAULT 0.00,
  [exempt_amount] DECIMAL(14,2) NOT NULL CONSTRAINT [DF_proformas_exempt_amount] DEFAULT 0.00,
  [exonerated_amount] DECIMAL(14,2) NOT NULL CONSTRAINT [DF_proformas_exonerated_amount] DEFAULT 0.00,
  [isv_15] DECIMAL(14,2) NOT NULL CONSTRAINT [DF_proformas_isv_15] DEFAULT 0.00,
  [isv_18] DECIMAL(14,2) NOT NULL CONSTRAINT [DF_proformas_isv_18] DEFAULT 0.00,
  [tax_total] DECIMAL(14,2) NOT NULL CONSTRAINT [DF_proformas_tax_total] DEFAULT 0.00,
  [grand_total] DECIMAL(14,2) NOT NULL CONSTRAINT [DF_proformas_grand_total] DEFAULT 0.00,
  [total_in_words] NVARCHAR(255) NULL,
  [status] NVARCHAR(9) NOT NULL CONSTRAINT [DF_proformas_status] DEFAULT N''BORRADOR'' CONSTRAINT [CK_proformas_status] CHECK ([status] IN (N''BORRADOR'', N''ENVIADA'', N''APROBADA'', N''RECHAZADA'', N''VENCIDA'', N''FACTURADA'')),
  [approved_at] DATETIME2(0) NULL,
  [approved_by] BIGINT NULL,
  [converted_to_invoice_id] BIGINT NULL,
  [notes] NVARCHAR(MAX) NULL,
  [created_by] BIGINT NOT NULL,
  [created_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_proformas_created_at] DEFAULT SYSUTCDATETIME(),
  [updated_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_proformas_updated_at] DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [PK_proformas] PRIMARY KEY CLUSTERED ([id])
);

CREATE INDEX [fk_proformas_approved_by] ON [dbo].[proformas] ([approved_by]);
CREATE INDEX [idx_proformas_company_date] ON [dbo].[proformas] ([company_id], [proforma_date]);
CREATE INDEX [idx_proformas_company_status] ON [dbo].[proformas] ([company_id], [status]);
CREATE INDEX [idx_proformas_converted] ON [dbo].[proformas] ([converted_to_invoice_id]);
CREATE INDEX [idx_proformas_created_by] ON [dbo].[proformas] ([created_by]);
CREATE INDEX [idx_proformas_customer] ON [dbo].[proformas] ([customer_id]);
CREATE INDEX [idx_proformas_series] ON [dbo].[proformas] ([proforma_series_id]);
CREATE INDEX [idx_proformas_warehouse] ON [dbo].[proformas] ([warehouse_id]);
CREATE UNIQUE INDEX [uq_proformas_company_number] ON [dbo].[proformas] ([company_id], [proforma_number]);

CREATE TABLE [dbo].[invoices] (
  [id] BIGINT IDENTITY(1,1) NOT NULL,
  [company_id] BIGINT NOT NULL,
  [billing_series_id] BIGINT NOT NULL,
  [customer_id] BIGINT NULL,
  [warehouse_id] BIGINT NULL,
  [source_proforma_id] BIGINT NULL,
  [invoice_number] NVARCHAR(20) NOT NULL,
  [sequence_number] BIGINT NOT NULL,
  [invoice_date] DATE NOT NULL,
  [issued_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_invoices_issued_at] DEFAULT SYSUTCDATETIME(),
  [customer_name_snapshot] NVARCHAR(180) NOT NULL,
  [customer_rtn_snapshot] NVARCHAR(30) NULL,
  [customer_phone_snapshot] NVARCHAR(40) NULL,
  [customer_address_snapshot] NVARCHAR(255) NULL,
  [company_legal_name_snapshot] NVARCHAR(180) NOT NULL,
  [company_commercial_name_snapshot] NVARCHAR(150) NOT NULL,
  [company_rtn_snapshot] NVARCHAR(30) NOT NULL,
  [company_email_snapshot] NVARCHAR(150) NULL,
  [company_phone_snapshot] NVARCHAR(40) NULL,
  [company_address_snapshot] NVARCHAR(255) NULL,
  [cai_snapshot] NVARCHAR(80) NOT NULL,
  [resolution_number_snapshot] NVARCHAR(80) NULL,
  [issue_deadline_snapshot] DATE NOT NULL,
  [range_start_snapshot] BIGINT NOT NULL,
  [range_end_snapshot] BIGINT NOT NULL,
  [subtotal] DECIMAL(14,2) NOT NULL CONSTRAINT [DF_invoices_subtotal] DEFAULT 0.00,
  [discount_total] DECIMAL(14,2) NOT NULL CONSTRAINT [DF_invoices_discount_total] DEFAULT 0.00,
  [taxable_amount_15] DECIMAL(14,2) NOT NULL CONSTRAINT [DF_invoices_taxable_amount_15] DEFAULT 0.00,
  [taxable_amount_18] DECIMAL(14,2) NOT NULL CONSTRAINT [DF_invoices_taxable_amount_18] DEFAULT 0.00,
  [exempt_amount] DECIMAL(14,2) NOT NULL CONSTRAINT [DF_invoices_exempt_amount] DEFAULT 0.00,
  [exonerated_amount] DECIMAL(14,2) NOT NULL CONSTRAINT [DF_invoices_exonerated_amount] DEFAULT 0.00,
  [isv_15] DECIMAL(14,2) NOT NULL CONSTRAINT [DF_invoices_isv_15] DEFAULT 0.00,
  [isv_18] DECIMAL(14,2) NOT NULL CONSTRAINT [DF_invoices_isv_18] DEFAULT 0.00,
  [tax_total] DECIMAL(14,2) NOT NULL CONSTRAINT [DF_invoices_tax_total] DEFAULT 0.00,
  [grand_total] DECIMAL(14,2) NOT NULL CONSTRAINT [DF_invoices_grand_total] DEFAULT 0.00,
  [total_in_words] NVARCHAR(255) NULL,
  [status] NVARCHAR(7) NOT NULL CONSTRAINT [DF_invoices_status] DEFAULT N''EMITIDA'' CONSTRAINT [CK_invoices_status] CHECK ([status] IN (N''EMITIDA'', N''ANULADA'')),
  [sale_type] NVARCHAR(7) NOT NULL CONSTRAINT [DF_invoices_sale_type] DEFAULT N''CONTADO'' CONSTRAINT [CK_invoices_sale_type] CHECK ([sale_type] IN (N''CONTADO'', N''CREDITO'')),
  [due_date] DATE NULL,
  [paid_amount] DECIMAL(14,2) NOT NULL CONSTRAINT [DF_invoices_paid_amount] DEFAULT 0.00,
  [balance] DECIMAL(14,2) NOT NULL CONSTRAINT [DF_invoices_balance] DEFAULT 0.00,
  [payment_status] NVARCHAR(9) NOT NULL CONSTRAINT [DF_invoices_payment_status] DEFAULT N''PAGADA'' CONSTRAINT [CK_invoices_payment_status] CHECK ([payment_status] IN (N''PENDIENTE'', N''PARCIAL'', N''PAGADA'', N''ANULADA'')),
  [tender_method] NVARCHAR(13) NULL CONSTRAINT [CK_invoices_tender_method] CHECK ([tender_method] IN (N''EFECTIVO'', N''TRANSFERENCIA'', N''CHEQUE'', N''TARJETA'', N''OTRO'')),
  [notes] NVARCHAR(MAX) NULL,
  [created_by] BIGINT NOT NULL,
  [created_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_invoices_created_at] DEFAULT SYSUTCDATETIME(),
  [updated_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_invoices_updated_at] DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [PK_invoices] PRIMARY KEY CLUSTERED ([id])
);

CREATE INDEX [idx_invoices_billing_series_id] ON [dbo].[invoices] ([billing_series_id]);
CREATE INDEX [idx_invoices_company_date] ON [dbo].[invoices] ([company_id], [invoice_date]);
CREATE INDEX [idx_invoices_company_status] ON [dbo].[invoices] ([company_id], [status]);
CREATE INDEX [idx_invoices_created_by] ON [dbo].[invoices] ([created_by]);
CREATE INDEX [idx_invoices_customer_id] ON [dbo].[invoices] ([customer_id]);
CREATE INDEX [idx_invoices_payment_status] ON [dbo].[invoices] ([company_id], [payment_status]);
CREATE INDEX [idx_invoices_source_proforma_id] ON [dbo].[invoices] ([source_proforma_id]);
CREATE INDEX [idx_invoices_warehouse_id] ON [dbo].[invoices] ([warehouse_id]);
CREATE UNIQUE INDEX [uq_invoices_company_invoice_number] ON [dbo].[invoices] ([company_id], [invoice_number]);
CREATE UNIQUE INDEX [uq_invoices_company_sequence] ON [dbo].[invoices] ([company_id], [sequence_number]);

CREATE TABLE [dbo].[invoice_items] (
  [id] BIGINT IDENTITY(1,1) NOT NULL,
  [invoice_id] BIGINT NOT NULL,
  [product_id] BIGINT NULL,
  [line_number] BIGINT NOT NULL,
  [quantity] DECIMAL(12,2) NOT NULL CONSTRAINT [DF_invoice_items_quantity] DEFAULT 1.00,
  [description] NVARCHAR(255) NOT NULL,
  [unit_price] DECIMAL(14,2) NOT NULL CONSTRAINT [DF_invoice_items_unit_price] DEFAULT 0.00,
  [unit_cost_snapshot] DECIMAL(14,2) NULL,
  [tax_rate] DECIMAL(5,2) NOT NULL CONSTRAINT [DF_invoice_items_tax_rate] DEFAULT 15.00,
  [line_discount] DECIMAL(14,2) NOT NULL CONSTRAINT [DF_invoice_items_line_discount] DEFAULT 0.00,
  [line_subtotal] DECIMAL(14,2) NOT NULL CONSTRAINT [DF_invoice_items_line_subtotal] DEFAULT 0.00,
  [line_tax] DECIMAL(14,2) NOT NULL CONSTRAINT [DF_invoice_items_line_tax] DEFAULT 0.00,
  [line_total] DECIMAL(14,2) NOT NULL CONSTRAINT [DF_invoice_items_line_total] DEFAULT 0.00,
  [affects_inventory] TINYINT NOT NULL CONSTRAINT [DF_invoice_items_affects_inventory] DEFAULT 0,
  [created_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_invoice_items_created_at] DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [PK_invoice_items] PRIMARY KEY CLUSTERED ([id])
);

CREATE INDEX [idx_invoice_items_invoice] ON [dbo].[invoice_items] ([invoice_id]);
CREATE INDEX [idx_invoice_items_product] ON [dbo].[invoice_items] ([product_id]);
CREATE UNIQUE INDEX [uq_invoice_items_invoice_line] ON [dbo].[invoice_items] ([invoice_id], [line_number]);

CREATE TABLE [dbo].[inventory_movements] (
  [id] BIGINT IDENTITY(1,1) NOT NULL,
  [company_id] BIGINT NOT NULL,
  [product_id] BIGINT NOT NULL,
  [warehouse_id] BIGINT NOT NULL,
  [movement_type] NVARCHAR(15) NOT NULL CONSTRAINT [CK_inventory_movements_movement_type] CHECK ([movement_type] IN (N''STOCK_INICIAL'', N''ENTRADA'', N''SALIDA'', N''AJUSTE_POSITIVO'', N''AJUSTE_NEGATIVO'', N''VENTA'', N''ANULACION_VENTA'')),
  [source_type] NVARCHAR(7) NOT NULL CONSTRAINT [DF_inventory_movements_source_type] DEFAULT N''MANUAL'' CONSTRAINT [CK_inventory_movements_source_type] CHECK ([source_type] IN (N''MANUAL'', N''ENTRADA'', N''FACTURA'', N''AJUSTE'')),
  [invoice_id] BIGINT NULL,
  [invoice_item_id] BIGINT NULL,
  [entry_id] BIGINT NULL,
  [entry_item_id] BIGINT NULL,
  [quantity] DECIMAL(14,2) NOT NULL CONSTRAINT [DF_inventory_movements_quantity] DEFAULT 0.00,
  [unit_cost] DECIMAL(14,2) NULL,
  [unit_price] DECIMAL(14,2) NULL,
  [stock_before] DECIMAL(14,2) NOT NULL CONSTRAINT [DF_inventory_movements_stock_before] DEFAULT 0.00,
  [stock_after] DECIMAL(14,2) NOT NULL CONSTRAINT [DF_inventory_movements_stock_after] DEFAULT 0.00,
  [notes] NVARCHAR(255) NULL,
  [created_by] BIGINT NOT NULL,
  [created_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_inventory_movements_created_at] DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [PK_inventory_movements] PRIMARY KEY CLUSTERED ([id])
);

CREATE INDEX [idx_inventory_movements_company] ON [dbo].[inventory_movements] ([company_id]);
CREATE INDEX [idx_inventory_movements_created_by] ON [dbo].[inventory_movements] ([created_by]);
CREATE INDEX [idx_inventory_movements_entry] ON [dbo].[inventory_movements] ([entry_id]);
CREATE INDEX [idx_inventory_movements_entry_item] ON [dbo].[inventory_movements] ([entry_item_id]);
CREATE INDEX [idx_inventory_movements_invoice] ON [dbo].[inventory_movements] ([invoice_id]);
CREATE INDEX [idx_inventory_movements_invoice_item] ON [dbo].[inventory_movements] ([invoice_item_id]);
CREATE INDEX [idx_inventory_movements_product] ON [dbo].[inventory_movements] ([product_id]);
CREATE INDEX [idx_inventory_movements_product_warehouse] ON [dbo].[inventory_movements] ([product_id], [warehouse_id]);
CREATE INDEX [idx_inventory_movements_warehouse] ON [dbo].[inventory_movements] ([warehouse_id]);

CREATE TABLE [dbo].[invoice_corrections] (
  [id] BIGINT IDENTITY(1,1) NOT NULL,
  [company_id] BIGINT NOT NULL,
  [invoice_id] BIGINT NOT NULL,
  [correction_type] NVARCHAR(14) NOT NULL CONSTRAINT [CK_invoice_corrections_correction_type] CHECK ([correction_type] IN (N''NOMBRE_CLIENTE'', N''FECHA_FACTURA'', N''AMBOS'')),
  [previous_customer_name] NVARCHAR(180) NULL,
  [new_customer_name] NVARCHAR(180) NULL,
  [previous_invoice_date] DATE NULL,
  [new_invoice_date] DATE NULL,
  [reason] NVARCHAR(255) NOT NULL,
  [status] NVARCHAR(9) NOT NULL CONSTRAINT [DF_invoice_corrections_status] DEFAULT N''APLICADA'' CONSTRAINT [CK_invoice_corrections_status] CHECK ([status] IN (N''APLICADA'', N''REVERTIDA'')),
  [performed_by] BIGINT NOT NULL,
  [created_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_invoice_corrections_created_at] DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [PK_invoice_corrections] PRIMARY KEY CLUSTERED ([id])
);

CREATE INDEX [idx_invoice_corrections_company] ON [dbo].[invoice_corrections] ([company_id]);
CREATE INDEX [idx_invoice_corrections_invoice] ON [dbo].[invoice_corrections] ([invoice_id]);
CREATE INDEX [idx_invoice_corrections_performed_by] ON [dbo].[invoice_corrections] ([performed_by]);

CREATE TABLE [dbo].[invoice_payments] (
  [id] BIGINT IDENTITY(1,1) NOT NULL,
  [company_id] BIGINT NOT NULL,
  [invoice_id] BIGINT NOT NULL,
  [receipt_number] NVARCHAR(40) NULL,
  [payment_date] DATE NOT NULL,
  [amount] DECIMAL(14,2) NOT NULL,
  [method] NVARCHAR(13) NOT NULL CONSTRAINT [DF_invoice_payments_method] DEFAULT N''EFECTIVO'' CONSTRAINT [CK_invoice_payments_method] CHECK ([method] IN (N''EFECTIVO'', N''TRANSFERENCIA'', N''CHEQUE'', N''TARJETA'', N''OTRO'')),
  [reference] NVARCHAR(120) NULL,
  [notes] NVARCHAR(255) NULL,
  [created_by] BIGINT NOT NULL,
  [created_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_invoice_payments_created_at] DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [PK_invoice_payments] PRIMARY KEY CLUSTERED ([id])
);

CREATE INDEX [fk_invoice_payments_created_by] ON [dbo].[invoice_payments] ([created_by]);
CREATE INDEX [idx_invoice_payments_company_date] ON [dbo].[invoice_payments] ([company_id], [payment_date]);
CREATE INDEX [idx_invoice_payments_invoice] ON [dbo].[invoice_payments] ([invoice_id]);
CREATE UNIQUE INDEX [uq_invoice_payments_receipt] ON [dbo].[invoice_payments] ([company_id], [receipt_number]) WHERE [receipt_number] IS NOT NULL;

CREATE TABLE [dbo].[license_devices] (
  [id] BIGINT IDENTITY(1,1) NOT NULL,
  [machine_code] NVARCHAR(12) NOT NULL,
  [machine_name] NVARCHAR(120) NULL,
  [app_version] NVARCHAR(30) NULL,
  [ip_address] NVARCHAR(45) NULL,
  [first_seen] DATETIME2(0) NOT NULL CONSTRAINT [DF_license_devices_first_seen] DEFAULT SYSUTCDATETIME(),
  [last_seen] DATETIME2(0) NULL,
  [conflict_name] NVARCHAR(120) NULL,
  [conflict_at] DATETIME2(0) NULL,
  CONSTRAINT [PK_license_devices] PRIMARY KEY CLUSTERED ([id])
);

CREATE UNIQUE INDEX [uq_license_devices_machine] ON [dbo].[license_devices] ([machine_code]);

CREATE TABLE [dbo].[license_revocations] (
  [id] BIGINT IDENTITY(1,1) NOT NULL,
  [revocation_text] NVARCHAR(MAX) NOT NULL,
  [descripcion] NVARCHAR(200) NULL,
  [created_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_license_revocations_created_at] DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [PK_license_revocations] PRIMARY KEY CLUSTERED ([id])
);


CREATE TABLE [dbo].[payable_documents] (
  [id] BIGINT IDENTITY(1,1) NOT NULL,
  [company_id] BIGINT NOT NULL,
  [supplier_id] BIGINT NOT NULL,
  [document_number] NVARCHAR(60) NOT NULL,
  [document_date] DATE NOT NULL,
  [due_date] DATE NULL,
  [description] NVARCHAR(255) NULL,
  [total] DECIMAL(14,2) NOT NULL CONSTRAINT [DF_payable_documents_total] DEFAULT 0.00,
  [paid_amount] DECIMAL(14,2) NOT NULL CONSTRAINT [DF_payable_documents_paid_amount] DEFAULT 0.00,
  [balance] DECIMAL(14,2) NOT NULL CONSTRAINT [DF_payable_documents_balance] DEFAULT 0.00,
  [status] NVARCHAR(9) NOT NULL CONSTRAINT [DF_payable_documents_status] DEFAULT N''PENDIENTE'' CONSTRAINT [CK_payable_documents_status] CHECK ([status] IN (N''PENDIENTE'', N''PARCIAL'', N''PAGADA'', N''ANULADA'')),
  [notes] NVARCHAR(MAX) NULL,
  [created_by] BIGINT NOT NULL,
  [created_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_payable_documents_created_at] DEFAULT SYSUTCDATETIME(),
  [updated_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_payable_documents_updated_at] DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [PK_payable_documents] PRIMARY KEY CLUSTERED ([id])
);

CREATE INDEX [fk_payable_documents_created_by] ON [dbo].[payable_documents] ([created_by]);
CREATE INDEX [idx_payable_documents_company_status] ON [dbo].[payable_documents] ([company_id], [status]);
CREATE INDEX [idx_payable_documents_due] ON [dbo].[payable_documents] ([company_id], [due_date]);
CREATE INDEX [idx_payable_documents_supplier] ON [dbo].[payable_documents] ([supplier_id]);
CREATE UNIQUE INDEX [uq_payable_documents_number] ON [dbo].[payable_documents] ([company_id], [supplier_id], [document_number]);

CREATE TABLE [dbo].[payable_payments] (
  [id] BIGINT IDENTITY(1,1) NOT NULL,
  [company_id] BIGINT NOT NULL,
  [payable_document_id] BIGINT NOT NULL,
  [receipt_number] NVARCHAR(40) NULL,
  [payment_date] DATE NOT NULL,
  [amount] DECIMAL(14,2) NOT NULL,
  [method] NVARCHAR(13) NOT NULL CONSTRAINT [DF_payable_payments_method] DEFAULT N''EFECTIVO'' CONSTRAINT [CK_payable_payments_method] CHECK ([method] IN (N''EFECTIVO'', N''TRANSFERENCIA'', N''CHEQUE'', N''TARJETA'', N''OTRO'')),
  [reference] NVARCHAR(120) NULL,
  [notes] NVARCHAR(255) NULL,
  [created_by] BIGINT NOT NULL,
  [created_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_payable_payments_created_at] DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [PK_payable_payments] PRIMARY KEY CLUSTERED ([id])
);

CREATE INDEX [fk_payable_payments_created_by] ON [dbo].[payable_payments] ([created_by]);
CREATE INDEX [idx_payable_payments_company_date] ON [dbo].[payable_payments] ([company_id], [payment_date]);
CREATE INDEX [idx_payable_payments_document] ON [dbo].[payable_payments] ([payable_document_id]);
CREATE UNIQUE INDEX [uq_payable_payments_receipt] ON [dbo].[payable_payments] ([company_id], [receipt_number]) WHERE [receipt_number] IS NOT NULL;

CREATE TABLE [dbo].[product_codes] (
  [id] BIGINT IDENTITY(1,1) NOT NULL,
  [company_id] BIGINT NOT NULL,
  [product_id] BIGINT NOT NULL,
  [code] NVARCHAR(60) NOT NULL,
  [code_type] NVARCHAR(6) NOT NULL CONSTRAINT [DF_product_codes_code_type] DEFAULT N''MANUAL'' CONSTRAINT [CK_product_codes_code_type] CHECK ([code_type] IN (N''BARRA'', N''MANUAL'')),
  [created_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_product_codes_created_at] DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [PK_product_codes] PRIMARY KEY CLUSTERED ([id])
);

CREATE INDEX [idx_product_codes_product] ON [dbo].[product_codes] ([product_id]);
CREATE UNIQUE INDEX [uq_product_codes_company_code] ON [dbo].[product_codes] ([company_id], [code]);

CREATE TABLE [dbo].[product_stocks] (
  [id] BIGINT IDENTITY(1,1) NOT NULL,
  [company_id] BIGINT NOT NULL,
  [product_id] BIGINT NOT NULL,
  [warehouse_id] BIGINT NOT NULL,
  [stock_quantity] DECIMAL(14,2) NOT NULL CONSTRAINT [DF_product_stocks_stock_quantity] DEFAULT 0.00,
  [created_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_product_stocks_created_at] DEFAULT SYSUTCDATETIME(),
  [updated_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_product_stocks_updated_at] DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [PK_product_stocks] PRIMARY KEY CLUSTERED ([id])
);

CREATE INDEX [idx_product_stocks_company] ON [dbo].[product_stocks] ([company_id]);
CREATE INDEX [idx_product_stocks_warehouse] ON [dbo].[product_stocks] ([warehouse_id]);
CREATE UNIQUE INDEX [uq_product_stocks_product_warehouse] ON [dbo].[product_stocks] ([product_id], [warehouse_id]);

CREATE TABLE [dbo].[proforma_items] (
  [id] BIGINT IDENTITY(1,1) NOT NULL,
  [proforma_id] BIGINT NOT NULL,
  [product_id] BIGINT NULL,
  [line_number] BIGINT NOT NULL,
  [quantity] DECIMAL(12,2) NOT NULL CONSTRAINT [DF_proforma_items_quantity] DEFAULT 1.00,
  [description] NVARCHAR(255) NOT NULL,
  [unit_price] DECIMAL(14,2) NOT NULL CONSTRAINT [DF_proforma_items_unit_price] DEFAULT 0.00,
  [unit_cost_snapshot] DECIMAL(14,2) NULL,
  [tax_rate] DECIMAL(5,2) NOT NULL CONSTRAINT [DF_proforma_items_tax_rate] DEFAULT 15.00,
  [line_discount] DECIMAL(14,2) NOT NULL CONSTRAINT [DF_proforma_items_line_discount] DEFAULT 0.00,
  [line_subtotal] DECIMAL(14,2) NOT NULL CONSTRAINT [DF_proforma_items_line_subtotal] DEFAULT 0.00,
  [line_tax] DECIMAL(14,2) NOT NULL CONSTRAINT [DF_proforma_items_line_tax] DEFAULT 0.00,
  [line_total] DECIMAL(14,2) NOT NULL CONSTRAINT [DF_proforma_items_line_total] DEFAULT 0.00,
  [affects_inventory] TINYINT NOT NULL CONSTRAINT [DF_proforma_items_affects_inventory] DEFAULT 0,
  [created_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_proforma_items_created_at] DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [PK_proforma_items] PRIMARY KEY CLUSTERED ([id])
);

CREATE INDEX [idx_proforma_items_product] ON [dbo].[proforma_items] ([product_id]);
CREATE INDEX [idx_proforma_items_proforma] ON [dbo].[proforma_items] ([proforma_id]);
CREATE UNIQUE INDEX [uq_proforma_items_proforma_line] ON [dbo].[proforma_items] ([proforma_id], [line_number]);

CREATE TABLE [dbo].[quote_series] (
  [id] BIGINT IDENTITY(1,1) NOT NULL,
  [company_id] BIGINT NOT NULL,
  [prefix] NVARCHAR(10) NOT NULL CONSTRAINT [DF_quote_series_prefix] DEFAULT N''COT-'',
  [current_number] BIGINT NOT NULL CONSTRAINT [DF_quote_series_current_number] DEFAULT 1,
  [is_active] TINYINT NOT NULL CONSTRAINT [DF_quote_series_is_active] DEFAULT 1,
  [created_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_quote_series_created_at] DEFAULT SYSUTCDATETIME(),
  [updated_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_quote_series_updated_at] DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [PK_quote_series] PRIMARY KEY CLUSTERED ([id])
);

CREATE INDEX [idx_quote_series_company_active] ON [dbo].[quote_series] ([company_id], [is_active]);
CREATE UNIQUE INDEX [uq_quote_series_company] ON [dbo].[quote_series] ([company_id]);

CREATE TABLE [dbo].[quotes] (
  [id] BIGINT IDENTITY(1,1) NOT NULL,
  [company_id] BIGINT NOT NULL,
  [quote_series_id] BIGINT NOT NULL,
  [customer_id] BIGINT NULL,
  [warehouse_id] BIGINT NULL,
  [sequence_number] BIGINT NOT NULL,
  [quote_number] NVARCHAR(30) NOT NULL,
  [quote_date] DATE NOT NULL,
  [valid_until] DATE NULL,
  [customer_name_snapshot] NVARCHAR(180) NOT NULL,
  [customer_rtn_snapshot] NVARCHAR(30) NULL,
  [customer_email_snapshot] NVARCHAR(150) NULL,
  [customer_phone_snapshot] NVARCHAR(40) NULL,
  [customer_address_snapshot] NVARCHAR(255) NULL,
  [subtotal] DECIMAL(14,2) NOT NULL CONSTRAINT [DF_quotes_subtotal] DEFAULT 0.00,
  [discount_total] DECIMAL(14,2) NOT NULL CONSTRAINT [DF_quotes_discount_total] DEFAULT 0.00,
  [taxable_amount_15] DECIMAL(14,2) NOT NULL CONSTRAINT [DF_quotes_taxable_amount_15] DEFAULT 0.00,
  [taxable_amount_18] DECIMAL(14,2) NOT NULL CONSTRAINT [DF_quotes_taxable_amount_18] DEFAULT 0.00,
  [exempt_amount] DECIMAL(14,2) NOT NULL CONSTRAINT [DF_quotes_exempt_amount] DEFAULT 0.00,
  [exonerated_amount] DECIMAL(14,2) NOT NULL CONSTRAINT [DF_quotes_exonerated_amount] DEFAULT 0.00,
  [isv_15] DECIMAL(14,2) NOT NULL CONSTRAINT [DF_quotes_isv_15] DEFAULT 0.00,
  [isv_18] DECIMAL(14,2) NOT NULL CONSTRAINT [DF_quotes_isv_18] DEFAULT 0.00,
  [tax_total] DECIMAL(14,2) NOT NULL CONSTRAINT [DF_quotes_tax_total] DEFAULT 0.00,
  [grand_total] DECIMAL(14,2) NOT NULL CONSTRAINT [DF_quotes_grand_total] DEFAULT 0.00,
  [total_in_words] NVARCHAR(255) NULL,
  [status] NVARCHAR(9) NOT NULL CONSTRAINT [DF_quotes_status] DEFAULT N''BORRADOR'' CONSTRAINT [CK_quotes_status] CHECK ([status] IN (N''BORRADOR'', N''ENVIADA'', N''APROBADA'', N''RECHAZADA'', N''VENCIDA'', N''FACTURADA'')),
  [approved_at] DATETIME2(0) NULL,
  [approved_by] BIGINT NULL,
  [converted_to_invoice_id] BIGINT NULL,
  [notes] NVARCHAR(MAX) NULL,
  [created_by] BIGINT NOT NULL,
  [created_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_quotes_created_at] DEFAULT SYSUTCDATETIME(),
  [updated_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_quotes_updated_at] DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [PK_quotes] PRIMARY KEY CLUSTERED ([id])
);

CREATE INDEX [fk_quotes_approved_by] ON [dbo].[quotes] ([approved_by]);
CREATE INDEX [idx_quotes_company_date] ON [dbo].[quotes] ([company_id], [quote_date]);
CREATE INDEX [idx_quotes_company_status] ON [dbo].[quotes] ([company_id], [status]);
CREATE INDEX [idx_quotes_converted] ON [dbo].[quotes] ([converted_to_invoice_id]);
CREATE INDEX [idx_quotes_created_by] ON [dbo].[quotes] ([created_by]);
CREATE INDEX [idx_quotes_customer] ON [dbo].[quotes] ([customer_id]);
CREATE INDEX [idx_quotes_series] ON [dbo].[quotes] ([quote_series_id]);
CREATE INDEX [idx_quotes_warehouse] ON [dbo].[quotes] ([warehouse_id]);
CREATE UNIQUE INDEX [uq_quotes_company_number] ON [dbo].[quotes] ([company_id], [quote_number]);

CREATE TABLE [dbo].[quote_items] (
  [id] BIGINT IDENTITY(1,1) NOT NULL,
  [quote_id] BIGINT NOT NULL,
  [product_id] BIGINT NULL,
  [line_number] BIGINT NOT NULL,
  [quantity] DECIMAL(12,2) NOT NULL CONSTRAINT [DF_quote_items_quantity] DEFAULT 1.00,
  [description] NVARCHAR(255) NOT NULL,
  [unit_price] DECIMAL(14,2) NOT NULL CONSTRAINT [DF_quote_items_unit_price] DEFAULT 0.00,
  [unit_cost_snapshot] DECIMAL(14,2) NOT NULL CONSTRAINT [DF_quote_items_unit_cost_snapshot] DEFAULT 0.00,
  [tax_rate] DECIMAL(5,2) NOT NULL CONSTRAINT [DF_quote_items_tax_rate] DEFAULT 0.00,
  [line_discount] DECIMAL(14,2) NOT NULL CONSTRAINT [DF_quote_items_line_discount] DEFAULT 0.00,
  [line_subtotal] DECIMAL(14,2) NOT NULL CONSTRAINT [DF_quote_items_line_subtotal] DEFAULT 0.00,
  [line_tax] DECIMAL(14,2) NOT NULL CONSTRAINT [DF_quote_items_line_tax] DEFAULT 0.00,
  [line_total] DECIMAL(14,2) NOT NULL CONSTRAINT [DF_quote_items_line_total] DEFAULT 0.00,
  [affects_inventory] TINYINT NOT NULL CONSTRAINT [DF_quote_items_affects_inventory] DEFAULT 0,
  [created_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_quote_items_created_at] DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [PK_quote_items] PRIMARY KEY CLUSTERED ([id])
);

CREATE INDEX [idx_quote_items_product] ON [dbo].[quote_items] ([product_id]);
CREATE INDEX [idx_quote_items_quote] ON [dbo].[quote_items] ([quote_id]);
CREATE UNIQUE INDEX [uq_quote_items_quote_line] ON [dbo].[quote_items] ([quote_id], [line_number]);

CREATE TABLE [dbo].[role_permissions] (
  [id] BIGINT IDENTITY(1,1) NOT NULL,
  [role_id] BIGINT NOT NULL,
  [permission_key] NVARCHAR(80) NOT NULL,
  [created_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_role_permissions_created_at] DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [PK_role_permissions] PRIMARY KEY CLUSTERED ([id])
);

CREATE INDEX [idx_role_permissions_role] ON [dbo].[role_permissions] ([role_id]);
CREATE UNIQUE INDEX [uq_role_permissions] ON [dbo].[role_permissions] ([role_id], [permission_key]);

CREATE TABLE [dbo].[system_licenses] (
  [id] BIGINT IDENTITY(1,1) NOT NULL,
  [license_text] NVARCHAR(MAX) NOT NULL,
  [license_id] NVARCHAR(40) NOT NULL,
  [empresa] NVARCHAR(150) NULL,
  [equipos] INT NOT NULL CONSTRAINT [DF_system_licenses_equipos] DEFAULT 1,
  [vence] DATE NULL,
  [emitida] DATE NOT NULL,
  [installed_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_system_licenses_installed_at] DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [PK_system_licenses] PRIMARY KEY CLUSTERED ([id])
);

CREATE UNIQUE INDEX [uq_system_licenses_license] ON [dbo].[system_licenses] ([license_id]);

CREATE TABLE [dbo].[system_versions] (
  [version_key] NVARCHAR(40) NOT NULL,
  [version] BIGINT NOT NULL CONSTRAINT [DF_system_versions_version] DEFAULT 1,
  [updated_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_system_versions_updated_at] DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [PK_system_versions] PRIMARY KEY CLUSTERED ([version_key])
);


CREATE TABLE [dbo].[user_company_access] (
  [id] BIGINT IDENTITY(1,1) NOT NULL,
  [user_id] BIGINT NOT NULL,
  [company_id] BIGINT NOT NULL,
  [created_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_user_company_access_created_at] DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [PK_user_company_access] PRIMARY KEY CLUSTERED ([id])
);

CREATE INDEX [idx_user_company_company_id] ON [dbo].[user_company_access] ([company_id]);
CREATE UNIQUE INDEX [uq_user_company] ON [dbo].[user_company_access] ([user_id], [company_id]);

CREATE TABLE [dbo].[_migrations] (
  [id] INT IDENTITY(1,1) NOT NULL,
  [filename] NVARCHAR(255) NOT NULL,
  [executed_at] DATETIME2(0) NOT NULL CONSTRAINT [DF__migrations_executed_at] DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [PK__migrations] PRIMARY KEY CLUSTERED ([id])
);

CREATE UNIQUE INDEX [filename] ON [dbo].[_migrations] ([filename]);

/* Relaciones */
ALTER TABLE [dbo].[audit_logs] ADD CONSTRAINT [fk_audit_logs_company] FOREIGN KEY ([company_id]) REFERENCES [dbo].[companies] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[audit_logs] ADD CONSTRAINT [fk_audit_logs_user] FOREIGN KEY ([user_id]) REFERENCES [dbo].[users] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[bank_accounts] ADD CONSTRAINT [fk_bank_accounts_company] FOREIGN KEY ([company_id]) REFERENCES [dbo].[companies] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[bank_accounts] ADD CONSTRAINT [fk_bank_accounts_created_by] FOREIGN KEY ([created_by]) REFERENCES [dbo].[users] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[bank_movements] ADD CONSTRAINT [fk_bank_movements_account] FOREIGN KEY ([bank_account_id]) REFERENCES [dbo].[bank_accounts] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[bank_movements] ADD CONSTRAINT [fk_bank_movements_company] FOREIGN KEY ([company_id]) REFERENCES [dbo].[companies] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[bank_movements] ADD CONSTRAINT [fk_bank_movements_created_by] FOREIGN KEY ([created_by]) REFERENCES [dbo].[users] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[bank_movements] ADD CONSTRAINT [fk_bank_movements_voided_by] FOREIGN KEY ([voided_by]) REFERENCES [dbo].[users] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[billing_series] ADD CONSTRAINT [fk_billing_series_company] FOREIGN KEY ([company_id]) REFERENCES [dbo].[companies] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[billing_settings] ADD CONSTRAINT [fk_billing_settings_company] FOREIGN KEY ([company_id]) REFERENCES [dbo].[companies] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[cash_movements] ADD CONSTRAINT [fk_cash_movements_company] FOREIGN KEY ([company_id]) REFERENCES [dbo].[companies] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[cash_movements] ADD CONSTRAINT [fk_cash_movements_created_by] FOREIGN KEY ([created_by]) REFERENCES [dbo].[users] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[cash_movements] ADD CONSTRAINT [fk_cash_movements_session] FOREIGN KEY ([session_id]) REFERENCES [dbo].[cash_sessions] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[cash_network_rules] ADD CONSTRAINT [fk_cash_network_rules_company] FOREIGN KEY ([company_id]) REFERENCES [dbo].[companies] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[cash_network_rules] ADD CONSTRAINT [fk_cash_network_rules_created_by] FOREIGN KEY ([created_by]) REFERENCES [dbo].[users] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[cash_network_rules] ADD CONSTRAINT [fk_cash_network_rules_register] FOREIGN KEY ([cash_register_id]) REFERENCES [dbo].[cash_registers] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[cash_registers] ADD CONSTRAINT [fk_cash_registers_company] FOREIGN KEY ([company_id]) REFERENCES [dbo].[companies] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[cash_sessions] ADD CONSTRAINT [fk_cash_sessions_closed_by] FOREIGN KEY ([closed_by]) REFERENCES [dbo].[users] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[cash_sessions] ADD CONSTRAINT [fk_cash_sessions_company] FOREIGN KEY ([company_id]) REFERENCES [dbo].[companies] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[cash_sessions] ADD CONSTRAINT [fk_cash_sessions_opened_by] FOREIGN KEY ([opened_by]) REFERENCES [dbo].[users] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[cash_sessions] ADD CONSTRAINT [fk_cash_sessions_register] FOREIGN KEY ([cash_register_id]) REFERENCES [dbo].[cash_registers] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[cash_terminals] ADD CONSTRAINT [fk_cash_terminals_company] FOREIGN KEY ([company_id]) REFERENCES [dbo].[companies] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[cash_terminals] ADD CONSTRAINT [fk_cash_terminals_register] FOREIGN KEY ([cash_register_id]) REFERENCES [dbo].[cash_registers] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[cash_terminals] ADD CONSTRAINT [fk_cash_terminals_registered_by] FOREIGN KEY ([registered_by]) REFERENCES [dbo].[users] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[cash_terminal_pairings] ADD CONSTRAINT [fk_cash_pairings_company] FOREIGN KEY ([company_id]) REFERENCES [dbo].[companies] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[cash_terminal_pairings] ADD CONSTRAINT [fk_cash_pairings_created_by] FOREIGN KEY ([created_by]) REFERENCES [dbo].[users] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[cash_terminal_pairings] ADD CONSTRAINT [fk_cash_pairings_register] FOREIGN KEY ([cash_register_id]) REFERENCES [dbo].[cash_registers] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[cash_terminal_pairings] ADD CONSTRAINT [fk_cash_pairings_terminal] FOREIGN KEY ([used_terminal_id]) REFERENCES [dbo].[cash_terminals] ([id]) ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE [dbo].[clients] ADD CONSTRAINT [fk_clients_company] FOREIGN KEY ([company_id]) REFERENCES [dbo].[companies] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[clients] ADD CONSTRAINT [fk_clients_created_by] FOREIGN KEY ([created_by]) REFERENCES [dbo].[users] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[document_counters] ADD CONSTRAINT [fk_document_counters_company] FOREIGN KEY ([company_id]) REFERENCES [dbo].[companies] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[inventory_entries] ADD CONSTRAINT [fk_inventory_entries_company] FOREIGN KEY ([company_id]) REFERENCES [dbo].[companies] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[inventory_entries] ADD CONSTRAINT [fk_inventory_entries_created_by] FOREIGN KEY ([created_by]) REFERENCES [dbo].[users] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[inventory_entries] ADD CONSTRAINT [fk_inventory_entries_supplier] FOREIGN KEY ([supplier_id]) REFERENCES [dbo].[suppliers] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[inventory_entries] ADD CONSTRAINT [fk_inventory_entries_warehouse] FOREIGN KEY ([warehouse_id]) REFERENCES [dbo].[warehouses] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[inventory_entry_items] ADD CONSTRAINT [fk_inventory_entry_items_entry] FOREIGN KEY ([entry_id]) REFERENCES [dbo].[inventory_entries] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[inventory_entry_items] ADD CONSTRAINT [fk_inventory_entry_items_product] FOREIGN KEY ([product_id]) REFERENCES [dbo].[products] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[inventory_movements] ADD CONSTRAINT [fk_inventory_movements_company] FOREIGN KEY ([company_id]) REFERENCES [dbo].[companies] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[inventory_movements] ADD CONSTRAINT [fk_inventory_movements_created_by] FOREIGN KEY ([created_by]) REFERENCES [dbo].[users] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[inventory_movements] ADD CONSTRAINT [fk_inventory_movements_entry] FOREIGN KEY ([entry_id]) REFERENCES [dbo].[inventory_entries] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[inventory_movements] ADD CONSTRAINT [fk_inventory_movements_entry_item] FOREIGN KEY ([entry_item_id]) REFERENCES [dbo].[inventory_entry_items] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[inventory_movements] ADD CONSTRAINT [fk_inventory_movements_invoice] FOREIGN KEY ([invoice_id]) REFERENCES [dbo].[invoices] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[inventory_movements] ADD CONSTRAINT [fk_inventory_movements_invoice_item] FOREIGN KEY ([invoice_item_id]) REFERENCES [dbo].[invoice_items] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[inventory_movements] ADD CONSTRAINT [fk_inventory_movements_product] FOREIGN KEY ([product_id]) REFERENCES [dbo].[products] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[inventory_movements] ADD CONSTRAINT [fk_inventory_movements_warehouse] FOREIGN KEY ([warehouse_id]) REFERENCES [dbo].[warehouses] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[invoices] ADD CONSTRAINT [fk_invoices_billing_series] FOREIGN KEY ([billing_series_id]) REFERENCES [dbo].[billing_series] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[invoices] ADD CONSTRAINT [fk_invoices_company] FOREIGN KEY ([company_id]) REFERENCES [dbo].[companies] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[invoices] ADD CONSTRAINT [fk_invoices_created_by] FOREIGN KEY ([created_by]) REFERENCES [dbo].[users] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[invoices] ADD CONSTRAINT [fk_invoices_customer] FOREIGN KEY ([customer_id]) REFERENCES [dbo].[clients] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[invoices] ADD CONSTRAINT [fk_invoices_source_proforma] FOREIGN KEY ([source_proforma_id]) REFERENCES [dbo].[proformas] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[invoices] ADD CONSTRAINT [fk_invoices_warehouse] FOREIGN KEY ([warehouse_id]) REFERENCES [dbo].[warehouses] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[invoice_corrections] ADD CONSTRAINT [fk_invoice_corrections_company] FOREIGN KEY ([company_id]) REFERENCES [dbo].[companies] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[invoice_corrections] ADD CONSTRAINT [fk_invoice_corrections_invoice] FOREIGN KEY ([invoice_id]) REFERENCES [dbo].[invoices] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[invoice_corrections] ADD CONSTRAINT [fk_invoice_corrections_performed_by] FOREIGN KEY ([performed_by]) REFERENCES [dbo].[users] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[invoice_items] ADD CONSTRAINT [fk_invoice_items_invoice] FOREIGN KEY ([invoice_id]) REFERENCES [dbo].[invoices] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[invoice_items] ADD CONSTRAINT [fk_invoice_items_product] FOREIGN KEY ([product_id]) REFERENCES [dbo].[products] ([id]) ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE [dbo].[invoice_payments] ADD CONSTRAINT [fk_invoice_payments_company] FOREIGN KEY ([company_id]) REFERENCES [dbo].[companies] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[invoice_payments] ADD CONSTRAINT [fk_invoice_payments_created_by] FOREIGN KEY ([created_by]) REFERENCES [dbo].[users] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[invoice_payments] ADD CONSTRAINT [fk_invoice_payments_invoice] FOREIGN KEY ([invoice_id]) REFERENCES [dbo].[invoices] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[payable_documents] ADD CONSTRAINT [fk_payable_documents_company] FOREIGN KEY ([company_id]) REFERENCES [dbo].[companies] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[payable_documents] ADD CONSTRAINT [fk_payable_documents_created_by] FOREIGN KEY ([created_by]) REFERENCES [dbo].[users] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[payable_documents] ADD CONSTRAINT [fk_payable_documents_supplier] FOREIGN KEY ([supplier_id]) REFERENCES [dbo].[suppliers] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[payable_payments] ADD CONSTRAINT [fk_payable_payments_company] FOREIGN KEY ([company_id]) REFERENCES [dbo].[companies] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[payable_payments] ADD CONSTRAINT [fk_payable_payments_created_by] FOREIGN KEY ([created_by]) REFERENCES [dbo].[users] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[payable_payments] ADD CONSTRAINT [fk_payable_payments_document] FOREIGN KEY ([payable_document_id]) REFERENCES [dbo].[payable_documents] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[products] ADD CONSTRAINT [fk_products_category] FOREIGN KEY ([category_id]) REFERENCES [dbo].[product_categories] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[products] ADD CONSTRAINT [fk_products_company] FOREIGN KEY ([company_id]) REFERENCES [dbo].[companies] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[products] ADD CONSTRAINT [fk_products_created_by] FOREIGN KEY ([created_by]) REFERENCES [dbo].[users] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[product_categories] ADD CONSTRAINT [fk_product_categories_company] FOREIGN KEY ([company_id]) REFERENCES [dbo].[companies] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[product_codes] ADD CONSTRAINT [fk_product_codes_company] FOREIGN KEY ([company_id]) REFERENCES [dbo].[companies] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[product_codes] ADD CONSTRAINT [fk_product_codes_product] FOREIGN KEY ([product_id]) REFERENCES [dbo].[products] ([id]) ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE [dbo].[product_stocks] ADD CONSTRAINT [fk_product_stocks_company] FOREIGN KEY ([company_id]) REFERENCES [dbo].[companies] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[product_stocks] ADD CONSTRAINT [fk_product_stocks_product] FOREIGN KEY ([product_id]) REFERENCES [dbo].[products] ([id]) ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE [dbo].[product_stocks] ADD CONSTRAINT [fk_product_stocks_warehouse] FOREIGN KEY ([warehouse_id]) REFERENCES [dbo].[warehouses] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[proformas] ADD CONSTRAINT [fk_proformas_approved_by] FOREIGN KEY ([approved_by]) REFERENCES [dbo].[users] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[proformas] ADD CONSTRAINT [fk_proformas_company] FOREIGN KEY ([company_id]) REFERENCES [dbo].[companies] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[proformas] ADD CONSTRAINT [fk_proformas_converted_invoice] FOREIGN KEY ([converted_to_invoice_id]) REFERENCES [dbo].[invoices] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[proformas] ADD CONSTRAINT [fk_proformas_created_by] FOREIGN KEY ([created_by]) REFERENCES [dbo].[users] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[proformas] ADD CONSTRAINT [fk_proformas_customer] FOREIGN KEY ([customer_id]) REFERENCES [dbo].[clients] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[proformas] ADD CONSTRAINT [fk_proformas_series] FOREIGN KEY ([proforma_series_id]) REFERENCES [dbo].[proforma_series] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[proformas] ADD CONSTRAINT [fk_proformas_warehouse] FOREIGN KEY ([warehouse_id]) REFERENCES [dbo].[warehouses] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[proforma_items] ADD CONSTRAINT [fk_proforma_items_product] FOREIGN KEY ([product_id]) REFERENCES [dbo].[products] ([id]) ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE [dbo].[proforma_items] ADD CONSTRAINT [fk_proforma_items_proforma] FOREIGN KEY ([proforma_id]) REFERENCES [dbo].[proformas] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[proforma_series] ADD CONSTRAINT [fk_proforma_series_company] FOREIGN KEY ([company_id]) REFERENCES [dbo].[companies] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[quotes] ADD CONSTRAINT [fk_quotes_approved_by] FOREIGN KEY ([approved_by]) REFERENCES [dbo].[users] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[quotes] ADD CONSTRAINT [fk_quotes_company] FOREIGN KEY ([company_id]) REFERENCES [dbo].[companies] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[quotes] ADD CONSTRAINT [fk_quotes_converted_invoice] FOREIGN KEY ([converted_to_invoice_id]) REFERENCES [dbo].[invoices] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[quotes] ADD CONSTRAINT [fk_quotes_created_by] FOREIGN KEY ([created_by]) REFERENCES [dbo].[users] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[quotes] ADD CONSTRAINT [fk_quotes_customer] FOREIGN KEY ([customer_id]) REFERENCES [dbo].[clients] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[quotes] ADD CONSTRAINT [fk_quotes_series] FOREIGN KEY ([quote_series_id]) REFERENCES [dbo].[quote_series] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[quotes] ADD CONSTRAINT [fk_quotes_warehouse] FOREIGN KEY ([warehouse_id]) REFERENCES [dbo].[warehouses] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[quote_items] ADD CONSTRAINT [fk_quote_items_product] FOREIGN KEY ([product_id]) REFERENCES [dbo].[products] ([id]) ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE [dbo].[quote_items] ADD CONSTRAINT [fk_quote_items_quote] FOREIGN KEY ([quote_id]) REFERENCES [dbo].[quotes] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[quote_series] ADD CONSTRAINT [fk_quote_series_company] FOREIGN KEY ([company_id]) REFERENCES [dbo].[companies] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[role_permissions] ADD CONSTRAINT [fk_role_permissions_role] FOREIGN KEY ([role_id]) REFERENCES [dbo].[roles] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[suppliers] ADD CONSTRAINT [fk_suppliers_company] FOREIGN KEY ([company_id]) REFERENCES [dbo].[companies] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[suppliers] ADD CONSTRAINT [fk_suppliers_created_by] FOREIGN KEY ([created_by]) REFERENCES [dbo].[users] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[users] ADD CONSTRAINT [fk_users_role] FOREIGN KEY ([role_id]) REFERENCES [dbo].[roles] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[user_company_access] ADD CONSTRAINT [fk_user_company_company] FOREIGN KEY ([company_id]) REFERENCES [dbo].[companies] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[user_company_access] ADD CONSTRAINT [fk_user_company_user] FOREIGN KEY ([user_id]) REFERENCES [dbo].[users] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[warehouses] ADD CONSTRAINT [fk_warehouses_company] FOREIGN KEY ([company_id]) REFERENCES [dbo].[companies] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

/* Vistas (EXEC: CREATE VIEW debe ir solo en su lote) */
EXEC(N''CREATE VIEW [dbo].[vw_invoice_print_projection] AS select [i].[id] AS [invoice_id],[i].[company_id] AS [company_id],[i].[invoice_number] AS [invoice_number],[i].[sequence_number] AS [sequence_number],[i].[status] AS [status],coalesce([ic].[new_customer_name],[i].[customer_name_snapshot]) AS [print_customer_name],coalesce([ic].[new_invoice_date],[i].[invoice_date]) AS [print_invoice_date],[i].[customer_name_snapshot] AS [original_customer_name],[i].[invoice_date] AS [original_invoice_date],[i].[customer_rtn_snapshot] AS [customer_rtn_snapshot],[i].[customer_phone_snapshot] AS [customer_phone_snapshot],[i].[customer_address_snapshot] AS [customer_address_snapshot],[i].[company_legal_name_snapshot] AS [company_legal_name_snapshot],[i].[company_commercial_name_snapshot] AS [company_commercial_name_snapshot],[i].[company_rtn_snapshot] AS [company_rtn_snapshot],[i].[company_email_snapshot] AS [company_email_snapshot],[i].[company_phone_snapshot] AS [company_phone_snapshot],[i].[company_address_snapshot] AS [company_address_snapshot],[i].[cai_snapshot] AS [cai_snapshot],[i].[issue_deadline_snapshot] AS [issue_deadline_snapshot],[i].[range_start_snapshot] AS [range_start_snapshot],[i].[range_end_snapshot] AS [range_end_snapshot],[i].[subtotal] AS [subtotal],[i].[discount_total] AS [discount_total],[i].[taxable_amount_15] AS [taxable_amount_15],[i].[exempt_amount] AS [exempt_amount],[i].[exonerated_amount] AS [exonerated_amount],[i].[isv_15] AS [isv_15],[i].[tax_total] AS [tax_total],[i].[grand_total] AS [grand_total],[i].[total_in_words] AS [total_in_words],[i].[notes] AS [notes],[i].[created_by] AS [created_by],[i].[created_at] AS [created_at],[i].[updated_at] AS [updated_at] from ([invoices] [i] left join (select [c1].[id] AS [id],[c1].[company_id] AS [company_id],[c1].[invoice_id] AS [invoice_id],[c1].[correction_type] AS [correction_type],[c1].[previous_customer_name] AS [previous_customer_name],[c1].[new_customer_name] AS [new_customer_name],[c1].[previous_invoice_date] AS [previous_invoice_date],[c1].[new_invoice_date] AS [new_invoice_date],[c1].[reason] AS [reason],[c1].[status] AS [status],[c1].[performed_by] AS [performed_by],[c1].[created_at] AS [created_at] from ([invoice_corrections] [c1] join (select [invoice_corrections].[invoice_id] AS [invoice_id],max([invoice_corrections].[id]) AS [max_id] from [invoice_corrections] where [invoice_corrections].[status] = N''''APLICADA'''' group by [invoice_corrections].[invoice_id]) [x] on([c1].[id] = [x].[max_id]))) [ic] on([ic].[invoice_id] = [i].[id]))'');

/* Catálogos del sistema */
SET IDENTITY_INSERT [dbo].[roles] ON;
INSERT INTO [dbo].[roles] ([id], [nombre], [descripcion]) VALUES
  (1, N''SUPERADMIN'', N''Acceso total al sistema''),
  (2, N''ADMIN'', N''Administración operativa y fiscal''),
  (3, N''CAJERO'', N''Emisión de facturas e historial'');
SET IDENTITY_INSERT [dbo].[roles] OFF;

SET IDENTITY_INSERT [dbo].[role_permissions] ON;
INSERT INTO [dbo].[role_permissions] ([id], [role_id], [permission_key]) VALUES
  (1, 2, N''dashboard.view''),
  (2, 2, N''invoices.view''),
  (3, 2, N''invoices.create''),
  (4, 2, N''invoices.void''),
  (5, 2, N''proformas.view''),
  (6, 2, N''proformas.create''),
  (7, 2, N''quotes.view''),
  (8, 2, N''quotes.create''),
  (9, 2, N''clients.view''),
  (10, 2, N''clients.create''),
  (11, 2, N''clients.edit''),
  (12, 2, N''products.view''),
  (13, 2, N''products.create''),
  (14, 2, N''products.edit''),
  (15, 2, N''categories.view''),
  (16, 2, N''categories.create''),
  (17, 2, N''categories.edit''),
  (18, 2, N''warehouses.view''),
  (19, 2, N''warehouses.create''),
  (20, 2, N''warehouses.edit''),
  (21, 2, N''inventory.view''),
  (22, 2, N''inventory.adjust''),
  (23, 2, N''receivables.view''),
  (24, 2, N''receivables.pay''),
  (25, 2, N''payables.view''),
  (26, 2, N''payables.create''),
  (27, 2, N''payables.pay''),
  (28, 2, N''payables.void''),
  (29, 2, N''suppliers.view''),
  (30, 2, N''suppliers.create''),
  (31, 2, N''suppliers.edit''),
  (32, 2, N''users.view''),
  (33, 2, N''users.create''),
  (34, 2, N''users.edit''),
  (35, 2, N''company.view''),
  (36, 2, N''company.edit''),
  (37, 2, N''settings.view''),
  (38, 2, N''settings.configure''),
  (39, 2, N''roles.view''),
  (64, 3, N''dashboard.view''),
  (65, 3, N''invoices.view''),
  (66, 3, N''invoices.create''),
  (67, 3, N''proformas.view''),
  (68, 3, N''proformas.create''),
  (69, 3, N''quotes.view''),
  (70, 3, N''quotes.create''),
  (71, 3, N''clients.view''),
  (72, 3, N''clients.create''),
  (73, 3, N''products.view''),
  (74, 3, N''inventory.view''),
  (75, 3, N''receivables.view''),
  (76, 3, N''receivables.pay''),
  (79, 2, N''caja.view''),
  (80, 3, N''caja.view''),
  (81, 2, N''caja.open''),
  (82, 3, N''caja.open''),
  (83, 2, N''caja.close''),
  (84, 3, N''caja.close''),
  (85, 2, N''caja.move''),
  (86, 3, N''caja.move''),
  (94, 2, N''reports.view''),
  (95, 2, N''caja.manage'');
SET IDENTITY_INSERT [dbo].[role_permissions] OFF;

INSERT INTO [dbo].[system_versions] ([version_key], [version]) VALUES
  (N''permissions'', 5);

/* Primer usuario (SUPERADMIN) */
INSERT INTO [dbo].[users] ([username], [email], [password_hash], [full_name], [role_id], [is_active]) VALUES
  (N''superadmin'', N''superadmin@sistema.local'', N''$2b$10$JyhDsF0WwgyLE0jiNBeM8OjKHzFtJR0ubChux5p/G2Go.TJ/M2Wbm'', N''Super Administrador'', 1, 1);

/* Migraciones incluidas en esta instalación */
INSERT INTO [dbo].[_migrations] ([filename]) VALUES
  (N''2026_09_11_000001_inventory_products_proformas.sql''),
  (N''2026_09_17_000001_sar_billing_series.sql''),
  (N''2026_09_17_000002_company_profile_logo.sql''),
  (N''2026_09_17_000003_receivables_payables.sql''),
  (N''2026_09_18_000001_roles_permissions.sql''),
  (N''2026_09_19_000001_isv_18.sql''),
  (N''2026_09_19_000002_quotes.sql''),
  (N''2026_09_19_000003_cash_register.sql''),
  (N''2026_09_19_000004_cash_registers.sql''),
  (N''2026_09_21_000001_product_codes.sql''),
  (N''2026_09_23_000001_cash_terminals.sql''),
  (N''2026_09_23_000002_cash_terminal_pairings.sql''),
  (N''2026_09_23_000003_cash_networks.sql''),
  (N''2026_09_23_000004_cash_network_per_register.sql''),
  (N''2026_09_24_000001_cash_terminals_by_ip.sql''),
  (N''2026_09_24_000002_document_counters.sql''),
  (N''2026_09_24_000003_system_versions.sql''),
  (N''2026_09_25_000001_company_document_branding.sql''),
  (N''2026_09_27_000001_inventory_entry_supplier.sql''),
  (N''2026_09_29_000001_generic_client_code.sql''),
  (N''2026_09_30_000001_align_schema.sql''),
  (N''2026_10_01_000001_footer_text_long.sql''),
  (N''2026_10_03_000001_banks.sql''),
  (N''2026_10_06_000001_license_registry.sql'');

COMMIT TRANSACTION;

PRINT N''Instalación completa.'';
');
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    DECLARE @error NVARCHAR(2048) = ERROR_MESSAGE();
    RAISERROR(N'No se pudo instalar el sistema: %s', 16, 1, @error);
    SET NOEXEC ON;
  END CATCH
END
GO

-- Bases antiguas sin registro de actualizaciones.
IF OBJECT_ID(N'dbo._migrations', N'U') IS NULL
  CREATE TABLE dbo._migrations (
    id INT IDENTITY(1,1) CONSTRAINT PK__migrations PRIMARY KEY,
    filename NVARCHAR(255) NOT NULL CONSTRAINT UQ__migrations_filename UNIQUE,
    executed_at DATETIME2(0) NOT NULL CONSTRAINT DF__migrations_executed_at DEFAULT SYSUTCDATETIME()
  );
GO

/* ---------- 4. Actualizaciones ---------- */

-- 2026_09_27_000001_inventory_entry_supplier.sql
IF NOT EXISTS (SELECT 1 FROM dbo._migrations WHERE filename = N'2026_09_27_000001_inventory_entry_supplier.sql')
BEGIN
  BEGIN TRY
    DECLARE @n INT = 0, @aviso NVARCHAR(2048);
    BEGIN TRANSACTION;
    EXEC(N'/* ============================================================
   @actualiza-datos: vincula las entradas existentes con el proveedor del catálogo que tiene el mismo nombre.
   Migración: 2026_09_27_000001_inventory_entry_supplier (SQL Server)
   Objetivo:
     Las entradas de mercadería se vinculan al catálogo de proveedores
     (antes solo guardaban el nombre como texto). supplier_name se conserva
     como copia del nombre al momento de la entrada.
     Las entradas anteriores cuyo texto coincide con un proveedor de la misma
     empresa quedan vinculadas.

   Versión MySQL: migrations/ (mismo nombre de archivo).
   ============================================================ */

SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;

ALTER TABLE [dbo].[inventory_entries] ADD [supplier_id] BIGINT NULL;');
    EXEC(N'CREATE INDEX [idx_inventory_entries_supplier] ON [dbo].[inventory_entries] ([supplier_id]);

ALTER TABLE [dbo].[inventory_entries] ADD CONSTRAINT [fk_inventory_entries_supplier]
  FOREIGN KEY ([supplier_id]) REFERENCES [dbo].[suppliers] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

UPDATE ie
SET ie.[supplier_id] = s.[id]
FROM [dbo].[inventory_entries] ie
INNER JOIN [dbo].[suppliers] s ON s.[company_id] = ie.[company_id] AND s.[name] = LTRIM(RTRIM(ie.[supplier_name]))
WHERE ie.[supplier_id] IS NULL AND ie.[supplier_name] IS NOT NULL;');
    INSERT INTO dbo._migrations (filename) VALUES (N'2026_09_27_000001_inventory_entry_supplier.sql');
    COMMIT TRANSACTION;
    PRINT N'Aplicada: 2026_09_27_000001_inventory_entry_supplier.sql';
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    DECLARE @error NVARCHAR(2048) = ERROR_MESSAGE();
    RAISERROR(N'No se aplicó 2026_09_27_000001_inventory_entry_supplier.sql: %s', 16, 1, @error);
    SET NOEXEC ON;
  END CATCH
END
GO

-- 2026_09_29_000001_generic_client_code.sql
IF NOT EXISTS (SELECT 1 FROM dbo._migrations WHERE filename = N'2026_09_29_000001_generic_client_code.sql')
BEGIN
  BEGIN TRY
    DECLARE @n INT = 0, @aviso NVARCHAR(2048);
    BEGIN TRANSACTION;

    INSERT INTO dbo._migrations (filename) VALUES (N'2026_09_29_000001_generic_client_code.sql');
    COMMIT TRANSACTION;
    PRINT N'Aplicada: 2026_09_29_000001_generic_client_code.sql';
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    DECLARE @error NVARCHAR(2048) = ERROR_MESSAGE();
    RAISERROR(N'No se aplicó 2026_09_29_000001_generic_client_code.sql: %s', 16, 1, @error);
    SET NOEXEC ON;
  END CATCH
END
GO

-- 2026_09_30_000001_align_schema.sql
IF NOT EXISTS (SELECT 1 FROM dbo._migrations WHERE filename = N'2026_09_30_000001_align_schema.sql')
BEGIN
  BEGIN TRY
    DECLARE @n INT = 0, @aviso NVARCHAR(2048);
    IF COL_LENGTH(N'dbo.inventory_entries', N'document_number') IS NOT NULL
    BEGIN
      EXEC sp_executesql N'SELECT @n = COUNT(*) FROM [dbo].[inventory_entries] WHERE LEN([document_number]) > 80', N'@n INT OUTPUT', @n = @n OUTPUT;
      IF @n > 0
      BEGIN
        SET @aviso = CONCAT(@n, N' ', N'filas de inventory_entries.document_number no cabrían en el nuevo formato. Corrige esos datos y vuelve a ejecutar.');
        THROW 50001, @aviso, 1;
      END
    END
    IF COL_LENGTH(N'dbo.products', N'type') IS NOT NULL
    BEGIN
      EXEC sp_executesql N'SELECT @n = COUNT(*) FROM [dbo].[products] WHERE LEN([type]) > 10 OR [type] IS NULL', N'@n INT OUTPUT', @n = @n OUTPUT;
      IF @n > 0
      BEGIN
        SET @aviso = CONCAT(@n, N' ', N'filas de products.type no cabrían en el nuevo formato. Corrige esos datos y vuelve a ejecutar.');
        THROW 50001, @aviso, 1;
      END
    END
    IF COL_LENGTH(N'dbo.products', N'min_stock') IS NOT NULL
    BEGIN
      EXEC sp_executesql N'SELECT @n = COUNT(*) FROM [dbo].[products] WHERE [min_stock] <> ROUND([min_stock], 2) OR ABS([min_stock]) >= POWER(10.0, 12) OR [min_stock] IS NULL', N'@n INT OUTPUT', @n = @n OUTPUT;
      IF @n > 0
      BEGIN
        SET @aviso = CONCAT(@n, N' ', N'filas de products.min_stock no cabrían en el nuevo formato. Corrige esos datos y vuelve a ejecutar.');
        THROW 50001, @aviso, 1;
      END
    END
    IF COL_LENGTH(N'dbo.invoice_items', N'unit_cost_snapshot') IS NOT NULL
    BEGIN
      EXEC sp_executesql N'SELECT @n = COUNT(*) FROM [dbo].[invoice_items] WHERE [unit_cost_snapshot] <> ROUND([unit_cost_snapshot], 2) OR ABS([unit_cost_snapshot]) >= POWER(10.0, 12)', N'@n INT OUTPUT', @n = @n OUTPUT;
      IF @n > 0
      BEGIN
        SET @aviso = CONCAT(@n, N' ', N'filas de invoice_items.unit_cost_snapshot no cabrían en el nuevo formato. Corrige esos datos y vuelve a ejecutar.');
        THROW 50001, @aviso, 1;
      END
    END
    IF COL_LENGTH(N'dbo.proforma_items', N'unit_cost_snapshot') IS NOT NULL
    BEGIN
      EXEC sp_executesql N'SELECT @n = COUNT(*) FROM [dbo].[proforma_items] WHERE [unit_cost_snapshot] <> ROUND([unit_cost_snapshot], 2) OR ABS([unit_cost_snapshot]) >= POWER(10.0, 12)', N'@n INT OUTPUT', @n = @n OUTPUT;
      IF @n > 0
      BEGIN
        SET @aviso = CONCAT(@n, N' ', N'filas de proforma_items.unit_cost_snapshot no cabrían en el nuevo formato. Corrige esos datos y vuelve a ejecutar.');
        THROW 50001, @aviso, 1;
      END
    END
    IF COL_LENGTH(N'dbo.inventory_movements', N'unit_cost') IS NOT NULL
    BEGIN
      EXEC sp_executesql N'SELECT @n = COUNT(*) FROM [dbo].[inventory_movements] WHERE [unit_cost] <> ROUND([unit_cost], 2) OR ABS([unit_cost]) >= POWER(10.0, 12)', N'@n INT OUTPUT', @n = @n OUTPUT;
      IF @n > 0
      BEGIN
        SET @aviso = CONCAT(@n, N' ', N'filas de inventory_movements.unit_cost no cabrían en el nuevo formato. Corrige esos datos y vuelve a ejecutar.');
        THROW 50001, @aviso, 1;
      END
    END
    IF COL_LENGTH(N'dbo.inventory_movements', N'unit_price') IS NOT NULL
    BEGIN
      EXEC sp_executesql N'SELECT @n = COUNT(*) FROM [dbo].[inventory_movements] WHERE [unit_price] <> ROUND([unit_price], 2) OR ABS([unit_price]) >= POWER(10.0, 12)', N'@n INT OUTPUT', @n = @n OUTPUT;
      IF @n > 0
      BEGIN
        SET @aviso = CONCAT(@n, N' ', N'filas de inventory_movements.unit_price no cabrían en el nuevo formato. Corrige esos datos y vuelve a ejecutar.');
        THROW 50001, @aviso, 1;
      END
    END
    IF COL_LENGTH(N'dbo.inventory_entries', N'status') IS NOT NULL
    BEGIN
      EXEC sp_executesql N'SELECT @n = COUNT(*) FROM [dbo].[inventory_entries] WHERE ([status] IS NOT NULL AND [status] NOT IN (N''BORRADOR'', N''APLICADA'', N''ANULADA''))', N'@n INT OUTPUT', @n = @n OUTPUT;
      IF @n > 0
      BEGIN
        SET @aviso = CONCAT(@n, N' ', N'filas de inventory_entries.status no cabrían en el nuevo formato. Corrige esos datos y vuelve a ejecutar.');
        THROW 50001, @aviso, 1;
      END
    END
    IF COL_LENGTH(N'dbo.products', N'type') IS NOT NULL
    BEGIN
      EXEC sp_executesql N'SELECT @n = COUNT(*) FROM [dbo].[products] WHERE ([type] IS NOT NULL AND [type] NOT IN (N''PRODUCTO'', N''SERVICIO'', N''MATERIALES''))', N'@n INT OUTPUT', @n = @n OUTPUT;
      IF @n > 0
      BEGIN
        SET @aviso = CONCAT(@n, N' ', N'filas de products.type no cabrían en el nuevo formato. Corrige esos datos y vuelve a ejecutar.');
        THROW 50001, @aviso, 1;
      END
    END
    BEGIN TRANSACTION;
    EXEC(N'/* ============================================================
   Migración: 2026_09_30_000001_align_schema (SQL Server)
   Objetivo:
     Dejar la estructura igual a la de MySQL después de la misma migración:
       - inventory_entries.document_number: hasta 80 caracteres.
       - inventory_entries.status: acepta BORRADOR.
       - products.type: acepta MATERIALES; controls_stock por defecto 1;
         min_stock DECIMAL(14,2).
       - Costos y precios de referencia pueden quedar vacíos (NULL):
         inventory_movements.unit_cost / unit_price,
         invoice_items.unit_cost_snapshot, proforma_items.unit_cost_snapshot.
       - tax_rate por defecto 15.00 en líneas de factura y proforma.
       - inventory_movements.source_type por defecto MANUAL.
       - Relación inventory_movements.created_by -> users.
     Revisa cada punto antes de cambiarlo: se puede repetir. No modifica datos.

   Versión MySQL: migrations/ (mismo nombre de archivo).
   ============================================================ */

SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;

/* ---------- inventory_entries ---------- */
IF COL_LENGTH(''dbo.inventory_entries'', ''document_number'') < 160
  ALTER TABLE [dbo].[inventory_entries] ALTER COLUMN [document_number] NVARCHAR(80) NULL;

IF OBJECT_ID(''dbo.CK_inventory_entries_status'', ''C'') IS NOT NULL
  ALTER TABLE [dbo].[inventory_entries] DROP CONSTRAINT [CK_inventory_entries_status];
ALTER TABLE [dbo].[inventory_entries] WITH CHECK ADD CONSTRAINT [CK_inventory_entries_status]
  CHECK ([status] IN (N''BORRADOR'', N''APLICADA'', N''ANULADA''));

/* ---------- products ---------- */
IF OBJECT_ID(''dbo.CK_products_type'', ''C'') IS NOT NULL
  ALTER TABLE [dbo].[products] DROP CONSTRAINT [CK_products_type];
IF OBJECT_ID(''dbo.DF_products_type'', ''D'') IS NOT NULL
  ALTER TABLE [dbo].[products] DROP CONSTRAINT [DF_products_type];
ALTER TABLE [dbo].[products] ALTER COLUMN [type] NVARCHAR(10) NOT NULL;
ALTER TABLE [dbo].[products] ADD CONSTRAINT [DF_products_type] DEFAULT N''PRODUCTO'' FOR [type];
ALTER TABLE [dbo].[products] WITH CHECK ADD CONSTRAINT [CK_products_type]
  CHECK ([type] IN (N''PRODUCTO'', N''SERVICIO'', N''MATERIALES''));

IF OBJECT_ID(''dbo.DF_products_controls_stock'', ''D'') IS NOT NULL
  ALTER TABLE [dbo].[products] DROP CONSTRAINT [DF_products_controls_stock];
ALTER TABLE [dbo].[products] ADD CONSTRAINT [DF_products_controls_stock] DEFAULT 1 FOR [controls_stock];

IF OBJECT_ID(''dbo.DF_products_min_stock'', ''D'') IS NOT NULL
  ALTER TABLE [dbo].[products] DROP CONSTRAINT [DF_products_min_stock];
ALTER TABLE [dbo].[products] ALTER COLUMN [min_stock] DECIMAL(14,2) NOT NULL;
ALTER TABLE [dbo].[products] ADD CONSTRAINT [DF_products_min_stock] DEFAULT 0.00 FOR [min_stock];

/* ---------- invoice_items ---------- */
IF OBJECT_ID(''dbo.DF_invoice_items_unit_cost_snapshot'', ''D'') IS NOT NULL
  ALTER TABLE [dbo].[invoice_items] DROP CONSTRAINT [DF_invoice_items_unit_cost_snapshot];
ALTER TABLE [dbo].[invoice_items] ALTER COLUMN [unit_cost_snapshot] DECIMAL(14,2) NULL;

IF OBJECT_ID(''dbo.DF_invoice_items_tax_rate'', ''D'') IS NOT NULL
  ALTER TABLE [dbo].[invoice_items] DROP CONSTRAINT [DF_invoice_items_tax_rate];
ALTER TABLE [dbo].[invoice_items] ADD CONSTRAINT [DF_invoice_items_tax_rate] DEFAULT 15.00 FOR [tax_rate];

/* ---------- proforma_items ---------- */
IF OBJECT_ID(''dbo.DF_proforma_items_unit_cost_snapshot'', ''D'') IS NOT NULL
  ALTER TABLE [dbo].[proforma_items] DROP CONSTRAINT [DF_proforma_items_unit_cost_snapshot];
ALTER TABLE [dbo].[proforma_items] ALTER COLUMN [unit_cost_snapshot] DECIMAL(14,2) NULL;

IF OBJECT_ID(''dbo.DF_proforma_items_tax_rate'', ''D'') IS NOT NULL
  ALTER TABLE [dbo].[proforma_items] DROP CONSTRAINT [DF_proforma_items_tax_rate];
ALTER TABLE [dbo].[proforma_items] ADD CONSTRAINT [DF_proforma_items_tax_rate] DEFAULT 15.00 FOR [tax_rate];

/* ---------- inventory_movements ---------- */
IF OBJECT_ID(''dbo.DF_inventory_movements_source_type'', ''D'') IS NULL
  ALTER TABLE [dbo].[inventory_movements] ADD CONSTRAINT [DF_inventory_movements_source_type] DEFAULT N''MANUAL'' FOR [source_type];

IF OBJECT_ID(''dbo.DF_inventory_movements_unit_cost'', ''D'') IS NOT NULL
  ALTER TABLE [dbo].[inventory_movements] DROP CONSTRAINT [DF_inventory_movements_unit_cost];
ALTER TABLE [dbo].[inventory_movements] ALTER COLUMN [unit_cost] DECIMAL(14,2) NULL;

IF OBJECT_ID(''dbo.DF_inventory_movements_unit_price'', ''D'') IS NOT NULL
  ALTER TABLE [dbo].[inventory_movements] DROP CONSTRAINT [DF_inventory_movements_unit_price];
ALTER TABLE [dbo].[inventory_movements] ALTER COLUMN [unit_price] DECIMAL(14,2) NULL;

IF OBJECT_ID(''dbo.fk_inventory_movements_created_by'', ''F'') IS NULL
  ALTER TABLE [dbo].[inventory_movements] WITH CHECK ADD CONSTRAINT [fk_inventory_movements_created_by]
    FOREIGN KEY ([created_by]) REFERENCES [dbo].[users] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;');
    INSERT INTO dbo._migrations (filename) VALUES (N'2026_09_30_000001_align_schema.sql');
    COMMIT TRANSACTION;
    PRINT N'Aplicada: 2026_09_30_000001_align_schema.sql';
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    DECLARE @error NVARCHAR(2048) = ERROR_MESSAGE();
    RAISERROR(N'No se aplicó 2026_09_30_000001_align_schema.sql: %s', 16, 1, @error);
    SET NOEXEC ON;
  END CATCH
END
GO

-- 2026_10_01_000001_footer_text_long.sql
IF NOT EXISTS (SELECT 1 FROM dbo._migrations WHERE filename = N'2026_10_01_000001_footer_text_long.sql')
BEGIN
  BEGIN TRY
    DECLARE @n INT = 0, @aviso NVARCHAR(2048);
    BEGIN TRANSACTION;
    EXEC(N'/* ============================================================
   Migración: 2026_10_01_000001_footer_text_long (SQL Server)
   Objetivo:
     Pie de factura sin el límite de 255 caracteres, para frases largas o dibujos
     hechos con caracteres (varias líneas). Solo amplía la columna: los textos que
     ya existen quedan iguales.

   Versión MySQL: migrations/ (mismo nombre de archivo).
   ============================================================ */

SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;

ALTER TABLE [dbo].[billing_settings] ALTER COLUMN [footer_text] NVARCHAR(MAX) NULL;');
    INSERT INTO dbo._migrations (filename) VALUES (N'2026_10_01_000001_footer_text_long.sql');
    COMMIT TRANSACTION;
    PRINT N'Aplicada: 2026_10_01_000001_footer_text_long.sql';
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    DECLARE @error NVARCHAR(2048) = ERROR_MESSAGE();
    RAISERROR(N'No se aplicó 2026_10_01_000001_footer_text_long.sql: %s', 16, 1, @error);
    SET NOEXEC ON;
  END CATCH
END
GO

-- 2026_10_03_000001_banks.sql
IF NOT EXISTS (SELECT 1 FROM dbo._migrations WHERE filename = N'2026_10_03_000001_banks.sql')
BEGIN
  BEGIN TRY
    DECLARE @n INT = 0, @aviso NVARCHAR(2048);
    BEGIN TRANSACTION;
    EXEC(N'/* ============================================================
   Migración: 2026_10_03_000001_banks (SQL Server)
   @funcion: Bancos
   @rutas: /banks
   @pantallas: /banks
   Objetivo:
     Gestión de bancos: cuentas bancarias de cada empresa y su libro de
     movimientos (depósitos, retiros, transferencias entre cuentas, comisiones,
     intereses, notas y cheques emitidos). Solo crea tablas nuevas.

   Versión MySQL: migrations/ (mismo nombre de archivo).
   ============================================================ */

SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;

CREATE TABLE [dbo].[bank_accounts] (
  [id] BIGINT IDENTITY(1,1) NOT NULL,
  [company_id] BIGINT NOT NULL,
  [bank_name] NVARCHAR(80) NOT NULL,
  [account_type] NVARCHAR(9) NOT NULL CONSTRAINT [DF_bank_accounts_account_type] DEFAULT N''CORRIENTE'' CONSTRAINT [CK_bank_accounts_account_type] CHECK ([account_type] IN (N''CORRIENTE'', N''AHORRO'')),
  [currency] NVARCHAR(3) NOT NULL CONSTRAINT [DF_bank_accounts_currency] DEFAULT N''HNL'' CONSTRAINT [CK_bank_accounts_currency] CHECK ([currency] IN (N''HNL'', N''USD'')),
  [account_number] NVARCHAR(40) NOT NULL,
  [alias] NVARCHAR(80) NULL,
  [opening_balance] DECIMAL(14,2) NOT NULL CONSTRAINT [DF_bank_accounts_opening_balance] DEFAULT 0.00,
  [opening_date] DATE NOT NULL,
  [is_active] TINYINT NOT NULL CONSTRAINT [DF_bank_accounts_is_active] DEFAULT 1,
  [created_by] BIGINT NOT NULL,
  [created_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_bank_accounts_created_at] DEFAULT SYSUTCDATETIME(),
  [updated_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_bank_accounts_updated_at] DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [PK_bank_accounts] PRIMARY KEY CLUSTERED ([id]),
  CONSTRAINT [uq_bank_accounts_number] UNIQUE ([company_id], [bank_name], [account_number])
);

CREATE INDEX [fk_bank_accounts_created_by] ON [dbo].[bank_accounts] ([created_by]);
ALTER TABLE [dbo].[bank_accounts] ADD CONSTRAINT [fk_bank_accounts_company] FOREIGN KEY ([company_id]) REFERENCES [dbo].[companies] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[bank_accounts] ADD CONSTRAINT [fk_bank_accounts_created_by] FOREIGN KEY ([created_by]) REFERENCES [dbo].[users] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

CREATE TABLE [dbo].[bank_movements] (
  [id] BIGINT IDENTITY(1,1) NOT NULL,
  [company_id] BIGINT NOT NULL,
  [bank_account_id] BIGINT NOT NULL,
  [movement_date] DATE NOT NULL,
  [movement_type] NVARCHAR(21) NOT NULL CONSTRAINT [CK_bank_movements_movement_type] CHECK ([movement_type] IN (N''DEPOSITO'', N''RETIRO'', N''TRANSFERENCIA_ENTRADA'', N''TRANSFERENCIA_SALIDA'', N''COMISION'', N''INTERES'', N''NOTA_CREDITO'', N''NOTA_DEBITO'', N''CHEQUE'')),
  [direction] NVARCHAR(3) NOT NULL CONSTRAINT [CK_bank_movements_direction] CHECK ([direction] IN (N''IN'', N''OUT'')),
  [amount] DECIMAL(14,2) NOT NULL,
  [reference] NVARCHAR(60) NULL,
  [description] NVARCHAR(255) NULL,
  [check_number] NVARCHAR(30) NULL,
  [beneficiary] NVARCHAR(150) NULL,
  [check_status] NVARCHAR(7) NULL CONSTRAINT [CK_bank_movements_check_status] CHECK ([check_status] IN (N''EMITIDO'', N''COBRADO'')),
  [related_movement_id] BIGINT NULL,
  [status] NVARCHAR(7) NOT NULL CONSTRAINT [DF_bank_movements_status] DEFAULT N''ACTIVO'' CONSTRAINT [CK_bank_movements_status] CHECK ([status] IN (N''ACTIVO'', N''ANULADO'')),
  [void_reason] NVARCHAR(255) NULL,
  [voided_by] BIGINT NULL,
  [voided_at] DATETIME2(0) NULL,
  [created_by] BIGINT NOT NULL,
  [created_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_bank_movements_created_at] DEFAULT SYSUTCDATETIME(),
  [updated_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_bank_movements_updated_at] DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [PK_bank_movements] PRIMARY KEY CLUSTERED ([id])
);

-- Número de cheque único por cuenta (filtrado: las filas sin cheque no cuentan).
CREATE UNIQUE INDEX [uq_bank_movements_check] ON [dbo].[bank_movements] ([bank_account_id], [check_number]) WHERE [check_number] IS NOT NULL;
CREATE INDEX [idx_bank_movements_account_date] ON [dbo].[bank_movements] ([bank_account_id], [movement_date]);
CREATE INDEX [idx_bank_movements_company] ON [dbo].[bank_movements] ([company_id]);
CREATE INDEX [idx_bank_movements_related] ON [dbo].[bank_movements] ([related_movement_id]);
CREATE INDEX [fk_bank_movements_created_by] ON [dbo].[bank_movements] ([created_by]);
CREATE INDEX [fk_bank_movements_voided_by] ON [dbo].[bank_movements] ([voided_by]);
ALTER TABLE [dbo].[bank_movements] ADD CONSTRAINT [fk_bank_movements_company] FOREIGN KEY ([company_id]) REFERENCES [dbo].[companies] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[bank_movements] ADD CONSTRAINT [fk_bank_movements_account] FOREIGN KEY ([bank_account_id]) REFERENCES [dbo].[bank_accounts] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[bank_movements] ADD CONSTRAINT [fk_bank_movements_created_by] FOREIGN KEY ([created_by]) REFERENCES [dbo].[users] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[bank_movements] ADD CONSTRAINT [fk_bank_movements_voided_by] FOREIGN KEY ([voided_by]) REFERENCES [dbo].[users] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;');
    INSERT INTO dbo._migrations (filename) VALUES (N'2026_10_03_000001_banks.sql');
    COMMIT TRANSACTION;
    PRINT N'Aplicada: 2026_10_03_000001_banks.sql';
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    DECLARE @error NVARCHAR(2048) = ERROR_MESSAGE();
    RAISERROR(N'No se aplicó 2026_10_03_000001_banks.sql: %s', 16, 1, @error);
    SET NOEXEC ON;
  END CATCH
END
GO

-- 2026_10_06_000001_license_registry.sql
IF NOT EXISTS (SELECT 1 FROM dbo._migrations WHERE filename = N'2026_10_06_000001_license_registry.sql')
BEGIN
  BEGIN TRY
    DECLARE @n INT = 0, @aviso NVARCHAR(2048);
    BEGIN TRANSACTION;
    EXEC(N'/* ============================================================
   Migración: 2026_10_06_000001_license_registry (SQL Server)
   Objetivo:
     Licencias guardadas en la base (las instala el gestor de licencias, firmadas por el
     proveedor: el programa solo confía en el texto firmado), registro de los equipos que
     usan el sistema (detecta códigos de equipo clonados) y revocaciones firmadas.
     Solo crea tablas nuevas.

   Versión MySQL: migrations/ (mismo nombre de archivo).
   ============================================================ */

SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;

CREATE TABLE [dbo].[system_licenses] (
  [id] BIGINT IDENTITY(1,1) NOT NULL,
  [license_text] NVARCHAR(MAX) NOT NULL,
  [license_id] NVARCHAR(40) NOT NULL,
  [empresa] NVARCHAR(150) NULL,
  [equipos] INT NOT NULL CONSTRAINT [DF_system_licenses_equipos] DEFAULT 1,
  [vence] DATE NULL,
  [emitida] DATE NOT NULL,
  [installed_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_system_licenses_installed_at] DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [PK_system_licenses] PRIMARY KEY CLUSTERED ([id]),
  CONSTRAINT [uq_system_licenses_license] UNIQUE ([license_id])
);

CREATE TABLE [dbo].[license_devices] (
  [id] BIGINT IDENTITY(1,1) NOT NULL,
  [machine_code] NVARCHAR(12) NOT NULL,
  [machine_name] NVARCHAR(120) NULL,
  [app_version] NVARCHAR(30) NULL,
  [ip_address] NVARCHAR(45) NULL,
  [first_seen] DATETIME2(0) NOT NULL CONSTRAINT [DF_license_devices_first_seen] DEFAULT SYSUTCDATETIME(),
  [last_seen] DATETIME2(0) NULL,
  [conflict_name] NVARCHAR(120) NULL,
  [conflict_at] DATETIME2(0) NULL,
  CONSTRAINT [PK_license_devices] PRIMARY KEY CLUSTERED ([id]),
  CONSTRAINT [uq_license_devices_machine] UNIQUE ([machine_code])
);

CREATE TABLE [dbo].[license_revocations] (
  [id] BIGINT IDENTITY(1,1) NOT NULL,
  [revocation_text] NVARCHAR(MAX) NOT NULL,
  [descripcion] NVARCHAR(200) NULL,
  [created_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_license_revocations_created_at] DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [PK_license_revocations] PRIMARY KEY CLUSTERED ([id])
);');
    INSERT INTO dbo._migrations (filename) VALUES (N'2026_10_06_000001_license_registry.sql');
    COMMIT TRANSACTION;
    PRINT N'Aplicada: 2026_10_06_000001_license_registry.sql';
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    DECLARE @error NVARCHAR(2048) = ERROR_MESSAGE();
    RAISERROR(N'No se aplicó 2026_10_06_000001_license_registry.sql: %s', 16, 1, @error);
    SET NOEXEC ON;
  END CATCH
END
GO

/* ---------- 5. Resultado ---------- */
SET NOEXEC OFF;
GO
DECLARE @al_dia BIT = 0;
IF DB_NAME() = N'facturacion' AND OBJECT_ID(N'dbo._migrations', N'U') IS NOT NULL
BEGIN
  IF NOT EXISTS (SELECT f FROM (VALUES (N'2026_09_27_000001_inventory_entry_supplier.sql'), (N'2026_09_29_000001_generic_client_code.sql'), (N'2026_09_30_000001_align_schema.sql'), (N'2026_10_01_000001_footer_text_long.sql'), (N'2026_10_03_000001_banks.sql'), (N'2026_10_06_000001_license_registry.sql')) AS pending(f) WHERE f NOT IN (SELECT filename FROM dbo._migrations))
    SET @al_dia = 1;
END
IF @al_dia = 1
  PRINT N'Listo: la base está al día.';
ELSE
  PRINT N'ATENCIÓN: la base NO quedó al día. Revisa los mensajes de arriba.';
GO
