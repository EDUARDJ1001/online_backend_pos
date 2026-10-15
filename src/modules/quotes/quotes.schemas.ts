import { z } from "zod";
import { hasAtMostTwoDecimals } from "../inventory/inventory-rules";
import { MAX_SALE_LINES } from "../invoices/invoices.schemas";
import { checkDateRange, optionalRtn } from "../shared/schema-fields";

const optionalDateSchema = z.preprocess((value) => (value === "" ? undefined : value), z.string().date().optional());

const quoteItemSchema = z
  .object({
    productId: z.coerce.number().int().positive().optional(),
    description: z.string().trim().max(255).nullish().or(z.literal("")),
    quantity: z.coerce
      .number({ invalid_type_error: "Cantidad inválida." })
      .positive("La cantidad debe ser mayor que 0.")
      .max(1000000, "La cantidad es demasiado alta.")
    .refine((value) => hasAtMostTwoDecimals(value), "Máximo 2 decimales."),
    unitPrice: z.coerce.number({ invalid_type_error: "Precio inválido." }).min(0, "El precio no puede ser negativo.").max(99999999, "El precio es demasiado alto.").refine((value) => hasAtMostTwoDecimals(value), "Máximo 2 decimales.").optional(),
    lineDiscount: z.coerce.number().min(0, "El descuento no puede ser negativo.").refine((value) => hasAtMostTwoDecimals(value), "Máximo 2 decimales.").default(0)
  })
  .superRefine((value, ctx) => {
    if (!value.productId && !value.description?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Debes seleccionar un producto o describir la línea.",
        path: ["description"]
      });
    }

    if (!value.productId && value.unitPrice === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "El precio es obligatorio para líneas manuales.",
        path: ["unitPrice"]
      });
    }
  });

const manualQuoteCustomerSchema = z.object({
  name: z.string().trim().min(2).max(180),
  rtn: optionalRtn,
  email: z.string().trim().email().max(150).nullish().or(z.literal("")),
  phone: z.string().trim().max(40).nullish().or(z.literal("")),
  address: z.string().trim().max(255).nullish().or(z.literal(""))
});

export const createQuoteSchema = z
  .object({
    customerId: z.coerce.number().int().positive().optional(),
    warehouseId: z.coerce.number().int().positive().optional(),
    customer: manualQuoteCustomerSchema.optional(),
    quoteDate: z.string().date(),
    validUntil: optionalDateSchema,
    notes: z.string().trim().max(2000).nullish().or(z.literal("")),
    items: z.array(quoteItemSchema).min(1, "Agrega al menos un producto.").max(MAX_SALE_LINES, `Máximo ${MAX_SALE_LINES} líneas por cotización.`)
  })
  .superRefine((value, ctx) => {
    if (!value.customerId && !value.customer) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Debes seleccionar un cliente o ingresar el nombre manual.",
        path: ["customerId"]
      });
    }

    if (value.validUntil && value.validUntil < value.quoteDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "La fecha de validez no puede ser anterior a la fecha de cotización.",
        path: ["validUntil"]
      });
    }
  });

export const listQuotesSchema = z.object({
  search: z.string().trim().optional(),
  customer: z.string().trim().optional(),
  status: z.string().trim().optional(),
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(10)
}).superRefine(checkDateRange);

export const quoteIdSchema = z.object({
  id: z.coerce.number().int().positive()
});

export const updateQuoteStatusSchema = z.object({
  status: z.enum(["BORRADOR", "ENVIADA", "APROBADA", "RECHAZADA", "VENCIDA"])
});
