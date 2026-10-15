/* ============================================================
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
IF COL_LENGTH('dbo.inventory_entries', 'document_number') < 160
  ALTER TABLE [dbo].[inventory_entries] ALTER COLUMN [document_number] NVARCHAR(80) NULL;

IF OBJECT_ID('dbo.CK_inventory_entries_status', 'C') IS NOT NULL
  ALTER TABLE [dbo].[inventory_entries] DROP CONSTRAINT [CK_inventory_entries_status];
ALTER TABLE [dbo].[inventory_entries] WITH CHECK ADD CONSTRAINT [CK_inventory_entries_status]
  CHECK ([status] IN (N'BORRADOR', N'APLICADA', N'ANULADA'));

/* ---------- products ---------- */
IF OBJECT_ID('dbo.CK_products_type', 'C') IS NOT NULL
  ALTER TABLE [dbo].[products] DROP CONSTRAINT [CK_products_type];
IF OBJECT_ID('dbo.DF_products_type', 'D') IS NOT NULL
  ALTER TABLE [dbo].[products] DROP CONSTRAINT [DF_products_type];
ALTER TABLE [dbo].[products] ALTER COLUMN [type] NVARCHAR(10) NOT NULL;
ALTER TABLE [dbo].[products] ADD CONSTRAINT [DF_products_type] DEFAULT N'PRODUCTO' FOR [type];
ALTER TABLE [dbo].[products] WITH CHECK ADD CONSTRAINT [CK_products_type]
  CHECK ([type] IN (N'PRODUCTO', N'SERVICIO', N'MATERIALES'));

IF OBJECT_ID('dbo.DF_products_controls_stock', 'D') IS NOT NULL
  ALTER TABLE [dbo].[products] DROP CONSTRAINT [DF_products_controls_stock];
ALTER TABLE [dbo].[products] ADD CONSTRAINT [DF_products_controls_stock] DEFAULT 1 FOR [controls_stock];

IF OBJECT_ID('dbo.DF_products_min_stock', 'D') IS NOT NULL
  ALTER TABLE [dbo].[products] DROP CONSTRAINT [DF_products_min_stock];
ALTER TABLE [dbo].[products] ALTER COLUMN [min_stock] DECIMAL(14,2) NOT NULL;
ALTER TABLE [dbo].[products] ADD CONSTRAINT [DF_products_min_stock] DEFAULT 0.00 FOR [min_stock];

/* ---------- invoice_items ---------- */
IF OBJECT_ID('dbo.DF_invoice_items_unit_cost_snapshot', 'D') IS NOT NULL
  ALTER TABLE [dbo].[invoice_items] DROP CONSTRAINT [DF_invoice_items_unit_cost_snapshot];
ALTER TABLE [dbo].[invoice_items] ALTER COLUMN [unit_cost_snapshot] DECIMAL(14,2) NULL;

IF OBJECT_ID('dbo.DF_invoice_items_tax_rate', 'D') IS NOT NULL
  ALTER TABLE [dbo].[invoice_items] DROP CONSTRAINT [DF_invoice_items_tax_rate];
ALTER TABLE [dbo].[invoice_items] ADD CONSTRAINT [DF_invoice_items_tax_rate] DEFAULT 15.00 FOR [tax_rate];

/* ---------- proforma_items ---------- */
IF OBJECT_ID('dbo.DF_proforma_items_unit_cost_snapshot', 'D') IS NOT NULL
  ALTER TABLE [dbo].[proforma_items] DROP CONSTRAINT [DF_proforma_items_unit_cost_snapshot];
ALTER TABLE [dbo].[proforma_items] ALTER COLUMN [unit_cost_snapshot] DECIMAL(14,2) NULL;

IF OBJECT_ID('dbo.DF_proforma_items_tax_rate', 'D') IS NOT NULL
  ALTER TABLE [dbo].[proforma_items] DROP CONSTRAINT [DF_proforma_items_tax_rate];
ALTER TABLE [dbo].[proforma_items] ADD CONSTRAINT [DF_proforma_items_tax_rate] DEFAULT 15.00 FOR [tax_rate];

/* ---------- inventory_movements ---------- */
IF OBJECT_ID('dbo.DF_inventory_movements_source_type', 'D') IS NULL
  ALTER TABLE [dbo].[inventory_movements] ADD CONSTRAINT [DF_inventory_movements_source_type] DEFAULT N'MANUAL' FOR [source_type];

IF OBJECT_ID('dbo.DF_inventory_movements_unit_cost', 'D') IS NOT NULL
  ALTER TABLE [dbo].[inventory_movements] DROP CONSTRAINT [DF_inventory_movements_unit_cost];
ALTER TABLE [dbo].[inventory_movements] ALTER COLUMN [unit_cost] DECIMAL(14,2) NULL;

IF OBJECT_ID('dbo.DF_inventory_movements_unit_price', 'D') IS NOT NULL
  ALTER TABLE [dbo].[inventory_movements] DROP CONSTRAINT [DF_inventory_movements_unit_price];
ALTER TABLE [dbo].[inventory_movements] ALTER COLUMN [unit_price] DECIMAL(14,2) NULL;

IF OBJECT_ID('dbo.fk_inventory_movements_created_by', 'F') IS NULL
  ALTER TABLE [dbo].[inventory_movements] WITH CHECK ADD CONSTRAINT [fk_inventory_movements_created_by]
    FOREIGN KEY ([created_by]) REFERENCES [dbo].[users] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
