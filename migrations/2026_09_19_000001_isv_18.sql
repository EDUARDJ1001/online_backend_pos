-- Soporte de dos tasas de ISV (15% y 18%) en facturas y proformas.
-- Honduras aplica 18% a turismo, licores, tabaco y telecom; 15% al resto.
-- Se agregan columnas dedicadas para que el reporte fiscal (Reporte 4 / libro de ventas)
-- distinga la base gravada y el ISV por cada tasa.

ALTER TABLE invoices
  ADD COLUMN taxable_amount_18 DECIMAL(14,2) NOT NULL DEFAULT 0.00 AFTER taxable_amount_15,
  ADD COLUMN isv_18 DECIMAL(14,2) NOT NULL DEFAULT 0.00 AFTER isv_15;

ALTER TABLE proformas
  ADD COLUMN taxable_amount_18 DECIMAL(14,2) NOT NULL DEFAULT 0.00 AFTER taxable_amount_15,
  ADD COLUMN isv_18 DECIMAL(14,2) NOT NULL DEFAULT 0.00 AFTER isv_15;
