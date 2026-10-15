import { z } from "zod";

import { checkDateRange } from "../shared/schema-fields";
import { hasAtMostTwoDecimals, MAX_QUANTITY, MAX_UNIT_COST } from "./inventory-rules";

const nullableText = (max: number) => z.string().trim().max(max).nullish().or(z.literal(""));

const quantity = z.coerce
  .number({ invalid_type_error: "Ingresa una cantidad válida." })
  .positive("La cantidad debe ser mayor que 0.")
  .max(MAX_QUANTITY, "La cantidad es demasiado alta.")
  .refine(hasAtMostTwoDecimals, "La cantidad admite máximo 2 decimales.");

const unitCost = z.coerce
  .number({ invalid_type_error: "Ingresa un costo válido." })
  .min(0, "El costo no puede ser negativo.")
  .max(MAX_UNIT_COST, "El costo es demasiado alto.")
  .refine(hasAtMostTwoDecimals, "El costo admite máximo 2 decimales.");
const queryBoolean = z.preprocess((value) => {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}, z.boolean());

export const listStocksSchema = z.object({
  search: z.string().trim().optional(),
  warehouseId: z.coerce.number().int().positive().optional(),
  lowStock: queryBoolean.optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(50)
});

export const listMovementsSchema = z.object({
  productId: z.coerce.number().int().positive().optional(),
  warehouseId: z.coerce.number().int().positive().optional(),
  movementType: z
    .enum(["STOCK_INICIAL", "ENTRADA", "SALIDA", "AJUSTE_POSITIVO", "AJUSTE_NEGATIVO", "VENTA", "ANULACION_VENTA", "all"])
    .default("all"),
  sourceType: z.enum(["MANUAL", "ENTRADA", "FACTURA", "AJUSTE", "all"]).default("all"),
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(50)
}).superRefine(checkDateRange);

export const listInventoryEntriesSchema = z.object({
  search: z.string().trim().optional(),
  warehouseId: z.coerce.number().int().positive().optional(),
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(50)
}).superRefine(checkDateRange);

export const productIdParamSchema = z.object({
  productId: z.coerce.number().int().positive()
});

export const inventoryEntryIdSchema = z.object({
  id: z.coerce.number().int().positive()
});

export const createInventoryEntrySchema = z.object({
  warehouseId: z.coerce.number({ invalid_type_error: "Selecciona una bodega." }).int().positive("Selecciona una bodega."),
  entryDate: z.string().date("Fecha inválida."),
  // Proveedor del catálogo (recomendado). supplierName queda por compatibilidad.
  supplierId: z.coerce.number().int().positive().nullable().optional(),
  supplierName: nullableText(180),
  documentNumber: nullableText(80),
  notes: z.string().trim().max(2000).nullish().or(z.literal("")),
  items: z
    .array(
      z.object({
        productId: z.coerce.number({ invalid_type_error: "Selecciona un producto." }).int().positive("Selecciona un producto."),
        quantity,
        // Una compra siempre tiene costo: 0 distorsiona el valor del inventario.
        unitCost: unitCost.refine((value) => value > 0, "El costo debe ser mayor que 0.")
      })
    )
    .min(1, "Agrega al menos un producto.")
    .max(200, "Máximo 200 líneas por entrada.")
    .superRefine((items, ctx) => {
      const seen = new Set<number>();
      items.forEach((item, index) => {
        if (seen.has(item.productId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Producto repetido: suma las cantidades en una sola línea.",
            path: [index, "productId"]
          });
        }
        seen.add(item.productId);
      });
    })
});

export const createStockAdjustmentSchema = z
  .object({
    warehouseId: z.coerce.number({ invalid_type_error: "Selecciona una bodega." }).int().positive("Selecciona una bodega."),
    productId: z.coerce.number({ invalid_type_error: "Selecciona un producto." }).int().positive("Selecciona un producto."),
    adjustmentType: z.enum(["AJUSTE_POSITIVO", "AJUSTE_NEGATIVO", "STOCK_INICIAL"], { errorMap: () => ({ message: "Tipo de ajuste inválido." }) }),
    quantity,
    unitCost: unitCost.optional(),
    notes: z.string().trim().min(5, "Describe el motivo (mínimo 5 caracteres).").max(255, "El motivo admite máximo 255 caracteres.")
  })
  .superRefine((value, ctx) => {
    // El stock inicial define el costo de partida del producto en la bodega.
    if (value.adjustmentType === "STOCK_INICIAL" && !(Number(value.unitCost) > 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "El stock inicial requiere un costo mayor que 0.", path: ["unitCost"] });
    }
  });
