import { z } from "zod";

import { hasAtMostTwoDecimals, MAX_UNIT_COST } from "../inventory/inventory-rules";
import { checkDateRange, pastOrTodayDate } from "../shared/schema-fields";

const text = (max: number) => z.string().transform((value) => value.trim().replace(/\s+/g, " ")).pipe(z.string().max(max));
const optionalText = (max: number) => text(max).nullish();

const amount = z.coerce
  .number()
  .positive("El monto debe ser mayor que cero.")
  .max(MAX_UNIT_COST, "El monto es demasiado alto.")
  .refine(hasAtMostTwoDecimals, "Máximo 2 decimales.");

export const accountIdSchema = z.object({ id: z.coerce.number().int().positive() });
export const movementIdSchema = z.object({ id: z.coerce.number().int().positive() });

export const listAccountsSchema = z.object({
  status: z.enum(["active", "inactive", "all"]).default("active")
});

export const createAccountSchema = z.object({
  bankName: text(80).pipe(z.string().min(2, "Escribe el nombre del banco.")),
  accountType: z.enum(["CORRIENTE", "AHORRO"]),
  currency: z.enum(["HNL", "USD"]),
  // Solo números, guiones y espacios (como aparece en la libreta o el estado de cuenta).
  accountNumber: z
    .string()
    .trim()
    .min(4, "El número de cuenta debe tener al menos 4 dígitos.")
    .max(40)
    .regex(/^[\d\s-]+$/, "El número de cuenta solo admite números, espacios y guiones.")
    .transform((value) => value.replace(/\s+/g, " ")),
  alias: optionalText(80),
  openingBalance: z.coerce.number().min(-MAX_UNIT_COST).max(MAX_UNIT_COST).refine(hasAtMostTwoDecimals, "Máximo 2 decimales.").default(0),
  openingDate: pastOrTodayDate
});

export const updateAccountSchema = createAccountSchema;

export const accountStatusSchema = z.object({ isActive: z.boolean() });

export const listMovementsSchema = z
  .object({
    dateFrom: z.string().date().optional(),
    dateTo: z.string().date().optional(),
    type: z.enum(["all", "DEPOSITO", "RETIRO", "TRANSFERENCIA_ENTRADA", "TRANSFERENCIA_SALIDA", "COMISION", "INTERES", "NOTA_CREDITO", "NOTA_DEBITO", "CHEQUE"]).default("all"),
    status: z.enum(["all", "ACTIVO", "ANULADO"]).default("all"),
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().positive().max(100).default(50)
  })
  .superRefine(checkDateRange);

/** Movimientos que se registran a mano (las transferencias y los cheques tienen su propia acción). */
export const MANUAL_TYPES = ["DEPOSITO", "RETIRO", "COMISION", "INTERES", "NOTA_CREDITO", "NOTA_DEBITO"] as const;

export const createMovementSchema = z.object({
  bankAccountId: z.coerce.number().int().positive("Elige la cuenta."),
  movementType: z.enum(MANUAL_TYPES, { message: "Elige el tipo de movimiento." }),
  movementDate: pastOrTodayDate,
  amount,
  reference: optionalText(60),
  description: optionalText(255)
});

export const createCheckSchema = z.object({
  bankAccountId: z.coerce.number().int().positive("Elige la cuenta."),
  movementDate: pastOrTodayDate,
  amount,
  checkNumber: z.string().trim().min(1, "Escribe el número de cheque.").max(30).regex(/^[\w-]+$/, "El número de cheque solo admite letras, números y guiones."),
  beneficiary: text(150).pipe(z.string().min(2, "Escribe a nombre de quién va el cheque.")),
  description: optionalText(255)
});

export const createTransferSchema = z
  .object({
    fromAccountId: z.coerce.number().int().positive("Elige la cuenta de origen."),
    toAccountId: z.coerce.number().int().positive("Elige la cuenta de destino."),
    movementDate: pastOrTodayDate,
    amount,
    reference: optionalText(60),
    description: optionalText(255)
  })
  .refine((value) => value.fromAccountId !== value.toAccountId, { path: ["toAccountId"], message: "La cuenta de destino debe ser distinta a la de origen." });

export const voidMovementSchema = z.object({
  reason: text(255).pipe(z.string().min(5, "Escribe el motivo de la anulación (mínimo 5 letras)."))
});

export const checkStatusSchema = z.object({ checkStatus: z.enum(["EMITIDO", "COBRADO"]) });
