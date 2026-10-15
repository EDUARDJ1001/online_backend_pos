import { z } from "zod";
import { hasAtMostTwoDecimals } from "../inventory/inventory-rules";
import { checkDateRange } from "../shared/schema-fields";

const paymentMethod = z.enum(["EFECTIVO", "TRANSFERENCIA", "CHEQUE", "TARJETA", "OTRO"]);

// Conteo por denominaciones: { "500": 3, "100": 5, ... } (billete/moneda -> cantidad)
const breakdown = z.record(z.string(), z.coerce.number().int().min(0));

export const registerCreateSchema = z.object({
  name: z.string().trim().min(1).max(80)
});

export const registerUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  isActive: z.boolean().optional()
});

export const terminalCreateSchema = z.object({
  cashRegisterId: z.coerce.number().int().positive(),
  name: z.string().trim().min(1).max(80)
});

export const terminalIpCreateSchema = z.object({
  cashRegisterId: z.coerce.number().int().positive(),
  name: z.string().trim().min(1).max(80),
  ip: z.string().trim().min(3).max(45)
});

export const terminalUpdateSchema = z.object({
  boundIp: z.string().trim().min(3).max(45).optional(),
  cashRegisterId: z.coerce.number().int().positive().optional(),
  name: z.string().trim().min(1).max(80).optional(),
  isActive: z.boolean().optional()
});

export const networkCreateSchema = z.object({
  cidr: z.string().trim().min(2).max(64),
  // Vacío/null = todas las cajas de la empresa.
  cashRegisterId: z.coerce.number().int().positive().nullable().optional(),
  label: z.string().trim().max(80).nullish().or(z.literal(""))
});

export const pairingCreateSchema = z.object({
  name: z.string().trim().max(80).nullish().or(z.literal(""))
});

export const pairingRedeemSchema = z.object({
  code: z.string().trim().min(8).max(12),
  name: z.string().trim().max(80).nullish().or(z.literal(""))
});

export const openSessionSchema = z.object({
  cashRegisterId: z.coerce.number().int().positive(),
  openingAmount: z.coerce.number().min(0).refine((value) => hasAtMostTwoDecimals(value), "Máximo 2 decimales.").default(0),
  openingBreakdown: breakdown.optional(),
  notes: z.string().trim().max(255).nullish().or(z.literal(""))
});

export const closeSessionSchema = z
  .object({
    cashSessionId: z.coerce.number().int().positive(),
    countedAmount: z.coerce.number().min(0).refine((value) => hasAtMostTwoDecimals(value), "Máximo 2 decimales.").optional(),
    countedBreakdown: breakdown.optional(),
    notes: z.string().trim().max(255).nullish().or(z.literal(""))
  })
  .superRefine((value, ctx) => {
    if (value.countedAmount === undefined && !value.countedBreakdown) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Ingresa el efectivo contado (monto o denominaciones).",
        path: ["countedAmount"]
      });
    }
  });

export const manualMovementSchema = z.object({
  cashSessionId: z.coerce.number().int().positive(),
  type: z.enum(["INGRESO", "EGRESO", "RETIRO"]),
  method: paymentMethod.default("EFECTIVO"),
  amount: z.coerce.number().positive().refine((value) => hasAtMostTwoDecimals(value), "Máximo 2 decimales."),
  description: z.string().trim().max(255).nullish().or(z.literal(""))
});

export const listSessionsSchema = z.object({
  status: z.enum(["ABIERTA", "CERRADA", "all"]).default("all"),
  cashRegisterId: z.coerce.number().int().positive().optional(),
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20)
}).superRefine(checkDateRange);

export const sessionIdSchema = z.object({
  id: z.coerce.number().int().positive()
});
