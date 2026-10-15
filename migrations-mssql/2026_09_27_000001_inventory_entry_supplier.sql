/* ============================================================
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

ALTER TABLE [dbo].[inventory_entries] ADD [supplier_id] BIGINT NULL;
GO

CREATE INDEX [idx_inventory_entries_supplier] ON [dbo].[inventory_entries] ([supplier_id]);

ALTER TABLE [dbo].[inventory_entries] ADD CONSTRAINT [fk_inventory_entries_supplier]
  FOREIGN KEY ([supplier_id]) REFERENCES [dbo].[suppliers] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

UPDATE ie
SET ie.[supplier_id] = s.[id]
FROM [dbo].[inventory_entries] ie
INNER JOIN [dbo].[suppliers] s ON s.[company_id] = ie.[company_id] AND s.[name] = LTRIM(RTRIM(ie.[supplier_name]))
WHERE ie.[supplier_id] IS NULL AND ie.[supplier_name] IS NOT NULL;
