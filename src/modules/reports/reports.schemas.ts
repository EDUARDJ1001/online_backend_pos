import { z } from "zod";

import { checkDateRange } from "../shared/schema-fields";

export const salesReportSchema = z.object({
  dateFrom: z.string().date(),
  dateTo: z.string().date(),
  customerId: z.coerce.number().int().positive().optional(),
  warehouseId: z.coerce.number().int().positive().optional(),
  saleType: z.enum(["CONTADO", "CREDITO", "all"]).default("all"),
  status: z.enum(["EMITIDA", "ANULADA", "all"]).default("EMITIDA")
}).superRefine(checkDateRange);

export type SalesReportQuery = z.infer<typeof salesReportSchema>;
