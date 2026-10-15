import { z } from "zod";
import { hasAtMostTwoDecimals, MAX_QUANTITY, MAX_UNIT_COST } from "../inventory/inventory-rules";

const nullableText = (max: number) => z.string().trim().max(max).nullish().or(z.literal(""));
const queryBoolean = z.preprocess((value) => {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}, z.boolean());

export const productCategoryIdSchema = z.object({
  id: z.coerce.number().int().positive()
});

export const listProductCategoriesSchema = z.object({
  search: z.string().trim().optional(),
  status: z.enum(["active", "inactive", "all"]).default("active"),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(50)
});

export const createProductCategorySchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: nullableText(255),
  isActive: z.boolean().default(true)
});

export const updateProductCategorySchema = createProductCategorySchema;

export const updateProductCategoryStatusSchema = z.object({
  isActive: z.boolean()
});

export const productIdSchema = z.object({
  id: z.coerce.number().int().positive()
});

export const listProductsSchema = z.object({
  search: z.string().trim().optional(),
  status: z.enum(["active", "inactive", "all"]).default("active"),
  type: z.enum(["PRODUCTO", "SERVICIO", "all"]).default("all"),
  categoryId: z.coerce.number().int().positive().optional(),
  lowStock: queryBoolean.optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(50)
});

export const createProductSchema = z.object({
  categoryId: z.coerce.number().int().positive().nullable().optional(),
  code: z.string().trim().min(1).max(40),
  barcode: nullableText(60),
  codes: z
    .array(
      z.object({
        code: z.string().trim().min(1).max(60),
        codeType: z.enum(["BARRA", "MANUAL"]).default("MANUAL")
      })
    )
    .max(50)
    .default([]),
  name: z.string().trim().min(2).max(180),
  description: nullableText(255),
  imageUrl: nullableText(255),
  type: z.enum(["PRODUCTO", "SERVICIO"]).default("PRODUCTO"),
  // Unidad en mayúsculas (UND, KG...): define si se vende por piezas enteras.
  unitMeasure: z.string().trim().min(1).max(30).default("UND").transform((value) => value.toUpperCase()),
  salePrice: z.coerce.number().min(0).max(MAX_UNIT_COST, "El precio es demasiado alto.").refine((value) => hasAtMostTwoDecimals(value), "Máximo 2 decimales.").default(0),
  costPrice: z.coerce.number().min(0).max(MAX_UNIT_COST, "El costo es demasiado alto.").refine((value) => hasAtMostTwoDecimals(value), "Máximo 2 decimales.").default(0),
  taxable: z.boolean().default(true),
  taxRate: z.coerce.number().min(0).max(100).default(15),
  controlsStock: z.boolean().default(true),
  minStock: z.coerce
    .number()
    .min(0)
    .max(MAX_QUANTITY, "La existencia mínima es demasiado alta.")
    .refine((value) => hasAtMostTwoDecimals(value), "Máximo 2 decimales.")
    .default(0),
  isActive: z.boolean().default(true)
});

export const updateProductSchema = createProductSchema;

/** Al crear se puede registrar la existencia inicial en una bodega, en el mismo paso. */
export const createProductWithStockSchema = createProductSchema
  .extend({
    initialStock: z.coerce.number().min(0).max(9_999_999).default(0),
    initialWarehouseId: z.coerce.number().int().positive().nullable().optional()
  })
  .superRefine((value, ctx) => {
    if (value.initialStock > 0 && (value.type === "SERVICIO" || !value.controlsStock)) {
      ctx.addIssue({ code: "custom", path: ["initialStock"], message: "Solo los productos con control de existencias llevan existencia inicial." });
    }
    if (value.initialStock > 0 && !value.initialWarehouseId) {
      ctx.addIssue({ code: "custom", path: ["initialWarehouseId"], message: "Selecciona una bodega para registrar la existencia inicial." });
    }
    // La existencia inicial es el primer movimiento del kardex: necesita su costo.
    if (value.initialStock > 0 && !(value.costPrice > 0)) {
      ctx.addIssue({ code: "custom", path: ["costPrice"], message: "Indica el costo de compra: la existencia inicial entra al kardex con ese costo." });
    }
  });

export const updateProductStatusSchema = z.object({
  isActive: z.boolean()
});
