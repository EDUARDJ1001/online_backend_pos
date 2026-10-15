/* ============================================================
   Migración: 2026_10_01_000001_footer_text_long (SQL Server)
   Objetivo:
     Pie de factura sin el límite de 255 caracteres, para frases largas o dibujos
     hechos con caracteres (varias líneas). Solo amplía la columna: los textos que
     ya existen quedan iguales.

   Versión MySQL: migrations/ (mismo nombre de archivo).
   ============================================================ */

SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;

ALTER TABLE [dbo].[billing_settings] ALTER COLUMN [footer_text] NVARCHAR(MAX) NULL;
