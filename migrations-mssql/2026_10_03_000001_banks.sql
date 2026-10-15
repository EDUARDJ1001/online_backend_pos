/* ============================================================
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
  [account_type] NVARCHAR(9) NOT NULL CONSTRAINT [DF_bank_accounts_account_type] DEFAULT N'CORRIENTE' CONSTRAINT [CK_bank_accounts_account_type] CHECK ([account_type] IN (N'CORRIENTE', N'AHORRO')),
  [currency] NVARCHAR(3) NOT NULL CONSTRAINT [DF_bank_accounts_currency] DEFAULT N'HNL' CONSTRAINT [CK_bank_accounts_currency] CHECK ([currency] IN (N'HNL', N'USD')),
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
  [movement_type] NVARCHAR(21) NOT NULL CONSTRAINT [CK_bank_movements_movement_type] CHECK ([movement_type] IN (N'DEPOSITO', N'RETIRO', N'TRANSFERENCIA_ENTRADA', N'TRANSFERENCIA_SALIDA', N'COMISION', N'INTERES', N'NOTA_CREDITO', N'NOTA_DEBITO', N'CHEQUE')),
  [direction] NVARCHAR(3) NOT NULL CONSTRAINT [CK_bank_movements_direction] CHECK ([direction] IN (N'IN', N'OUT')),
  [amount] DECIMAL(14,2) NOT NULL,
  [reference] NVARCHAR(60) NULL,
  [description] NVARCHAR(255) NULL,
  [check_number] NVARCHAR(30) NULL,
  [beneficiary] NVARCHAR(150) NULL,
  [check_status] NVARCHAR(7) NULL CONSTRAINT [CK_bank_movements_check_status] CHECK ([check_status] IN (N'EMITIDO', N'COBRADO')),
  [related_movement_id] BIGINT NULL,
  [status] NVARCHAR(7) NOT NULL CONSTRAINT [DF_bank_movements_status] DEFAULT N'ACTIVO' CONSTRAINT [CK_bank_movements_status] CHECK ([status] IN (N'ACTIVO', N'ANULADO')),
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
ALTER TABLE [dbo].[bank_movements] ADD CONSTRAINT [fk_bank_movements_voided_by] FOREIGN KEY ([voided_by]) REFERENCES [dbo].[users] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
