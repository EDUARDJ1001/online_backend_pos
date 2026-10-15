import { z } from "zod";
import { hasAtMostTwoDecimals, todayInHonduras } from "../inventory/inventory-rules";
import { checkDateRange, optionalRtn } from "../shared/schema-fields";

/** Máximo de líneas por documento de venta (igual en factura, proforma y cotización). */
export const MAX_SALE_LINES = 60;

const invoiceItemSchema = z.object({
  productId: z.coerce.number().int().positive().optional(),
  description: z.string().trim().max(255).nullish().or(z.literal("")),
  quantity: z.coerce
    .number({ invalid_type_error: "Cantidad inválida." })
    .positive("La cantidad debe ser mayor que 0.")
    .max(1000000, "La cantidad es demasiado alta.")
    .refine((value) => hasAtMostTwoDecimals(value), "Máximo 2 decimales."),
  unitPrice: z.coerce.number({ invalid_type_error: "Precio inválido." }).min(0, "El precio no puede ser negativo.").max(99999999, "El precio es demasiado alto.").refine((value) => hasAtMostTwoDecimals(value), "Máximo 2 decimales.").optional(),
  lineDiscount: z.coerce.number().min(0, "El descuento no puede ser negativo.").refine((value) => hasAtMostTwoDecimals(value), "Máximo 2 decimales.").default(0)
}).superRefine((value, ctx) => {
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

const manualCustomerSchema = z.object({
  name: z.string().trim().min(2).max(180),
  rtn: optionalRtn,
  phone: z.string().trim().max(40).nullish().or(z.literal("")),
  address: z.string().trim().max(255).nullish().or(z.literal(""))
});

export const createInvoiceSchema = z
  .object({
    customerId: z.coerce.number().int().positive().optional(),
    warehouseId: z.coerce.number().int().positive().optional(),
    customer: manualCustomerSchema.optional(),
    // La factura se emite con la fecha de hoy (Honduras). Si se envía, debe ser esa.
    invoiceDate: z
      .string()
      .date()
      .refine((value) => value === todayInHonduras(), "La factura solo se puede emitir con la fecha de hoy.")
      .optional(),
    saleType: z.enum(["CONTADO", "CREDITO"]).default("CONTADO"),
    tenderMethod: z.enum(["EFECTIVO", "TRANSFERENCIA", "CHEQUE", "TARJETA", "OTRO"]).optional(),
    cashSessionId: z.coerce.number().int().positive().optional(),
    dueDate: z.string().date().optional(),
    notes: z.string().trim().max(2000).nullish().or(z.literal("")),
    items: z.array(invoiceItemSchema).min(1, "Agrega al menos un producto.").max(MAX_SALE_LINES, `Máximo ${MAX_SALE_LINES} líneas por factura.`)
  })
  .superRefine((value, ctx) => {
    if (!value.customerId && !value.customer) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Debes seleccionar un cliente o ingresar los datos manuales.",
        path: ["customerId"]
      });
    }

    if (value.saleType === "CREDITO" && !value.dueDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "La fecha de vencimiento es obligatoria para ventas a crédito.",
        path: ["dueDate"]
      });
    }

    if (value.saleType === "CREDITO" && value.dueDate && value.dueDate < (value.invoiceDate ?? todayInHonduras())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "El vencimiento no puede ser anterior a la fecha de la factura.",
        path: ["dueDate"]
      });
    }
  });

export const listInvoicesSchema = z.object({
  search: z.string().trim().optional(),
  customer: z.string().trim().optional(),
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(10)
}).superRefine(checkDateRange);

export const invoiceIdSchema = z.object({
  id: z.coerce.number().int().positive()
});

export const createCorrectionSchema = z
  .object({
    newCustomerName: z.string().trim().max(180).nullish().or(z.literal("")),
    newInvoiceDate: z.string().date().optional(),
    reason: z.string().trim().min(5).max(255)
  })
  .superRefine((value, ctx) => {
    if (!value.newCustomerName && !value.newInvoiceDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Debes indicar al menos una corrección.",
        path: ["newCustomerName"]
      });
    }
  });
