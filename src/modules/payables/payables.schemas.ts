import { z } from "zod";
import { hasAtMostTwoDecimals } from "../inventory/inventory-rules";
import { checkDateRange, pastOrTodayDate } from "../shared/schema-fields";

const queryBoolean = z.preprocess((value) => {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}, z.boolean().optional());

export const listPayablesSchema = z.object({
  search: z.string().trim().optional(),
  overdue: queryBoolean,
  includePaid: queryBoolean,
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(10)
}).superRefine(checkDateRange);

export const createPayableDocumentSchema = z.object({
  supplierId: z.coerce.number().int().positive(),
  documentNumber: z.string().trim().min(1).max(60),
  documentDate: pastOrTodayDate,
  dueDate: z.string().date().optional(),
  description: z.string().trim().max(255).nullish().or(z.literal("")),
  total: z.coerce.number().positive("El total debe ser mayor que cero.").refine((value) => hasAtMostTwoDecimals(value), "Máximo 2 decimales."),
  notes: z.string().trim().max(2000).nullish().or(z.literal(""))
}).superRefine((value, ctx) => {
  if (value.dueDate && value.dueDate < value.documentDate) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["dueDate"], message: "El vencimiento no puede ser anterior a la fecha del documento." });
  }
});

export const registerPayablePaymentSchema = z.object({
  amount: z.coerce.number().positive("El monto debe ser mayor que cero.").refine((value) => hasAtMostTwoDecimals(value), "Máximo 2 decimales."),
  paymentDate: pastOrTodayDate,
  method: z.enum(["EFECTIVO", "TRANSFERENCIA", "CHEQUE", "TARJETA", "OTRO"]).default("EFECTIVO"),
  reference: z.string().trim().max(120).nullish().or(z.literal("")),
  receiptNumber: z.string().trim().max(40).nullish().or(z.literal("")),
  notes: z.string().trim().max(255).nullish().or(z.literal(""))
});

export const payableIdSchema = z.object({
  id: z.coerce.number().int().positive()
});

export const payableSupplierIdSchema = z.object({
  supplierId: z.coerce.number().int().positive()
});
