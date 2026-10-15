import { z } from "zod";
import { hasAtMostTwoDecimals } from "../inventory/inventory-rules";
import { checkDateRange, pastOrTodayDate } from "../shared/schema-fields";

const queryBoolean = z.preprocess((value) => {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}, z.boolean().optional());

export const listReceivablesSchema = z.object({
  search: z.string().trim().optional(),
  overdue: queryBoolean,
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(10)
}).superRefine(checkDateRange);

export const registerPaymentSchema = z.object({
  amount: z.coerce.number().positive("El monto debe ser mayor que cero.").refine((value) => hasAtMostTwoDecimals(value), "Máximo 2 decimales."),
  paymentDate: pastOrTodayDate,
  method: z.enum(["EFECTIVO", "TRANSFERENCIA", "CHEQUE", "TARJETA", "OTRO"]).default("EFECTIVO"),
  reference: z.string().trim().max(120).nullish().or(z.literal("")),
  receiptNumber: z.string().trim().max(40).nullish().or(z.literal("")),
  notes: z.string().trim().max(255).nullish().or(z.literal(""))
});

export const receivableInvoiceIdSchema = z.object({
  invoiceId: z.coerce.number().int().positive()
});

export const receivableClientIdSchema = z.object({
  clientId: z.coerce.number().int().positive()
});
