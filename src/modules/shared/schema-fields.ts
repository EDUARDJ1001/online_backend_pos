import { z } from "zod";

import { todayInHonduras } from "../inventory/inventory-rules";

export const RTN_MESSAGE = "El RTN debe tener 14 dígitos (o 13 si es un DNI).";
export const RTN_PLACE_MESSAGE = "El RTN no es válido: los 4 primeros dígitos son el departamento (01 a 18) y el municipio.";

/** Los 4 primeros dígitos del RTN/DNI son departamento (01 a 18) y municipio (no 00). */
export function validRtnPlace(digits: string) {
  const department = Number(digits.slice(0, 2));
  return department >= 1 && department <= 18 && digits.slice(2, 4) !== "00";
}

export const PHONE_MESSAGE = "El teléfono debe tener 8 dígitos (por ejemplo 9999-9999) o empezar con + si es de otro país.";

/**
 * Teléfono opcional: de Honduras (8 dígitos, empieza con 2, 3, 7, 8 o 9; admite +504)
 * queda como 9999-9999; de otro país, con + y de 8 a 15 dígitos. Vacío = sin teléfono.
 */
export function normalizePhone(value: string) {
  const text = value.trim().replace(/\s+/g, " ");
  if (!text) return "";
  const digits = text.replace(/\D/g, "");
  const local = text.startsWith("+504") ? digits.slice(3) : text.startsWith("+") ? null : digits;
  if (local !== null) {
    return /^[23789]\d{7}$/.test(local) ? `${local.slice(0, 4)}-${local.slice(4)}` : null;
  }
  return /^\+[\d\s()-]+$/.test(text) && digits.length >= 8 && digits.length <= 15 ? text : null;
}

export const optionalPhone = z
  .string()
  .max(40)
  .transform((value, context) => {
    const phone = normalizePhone(value);
    if (phone === null) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: PHONE_MESSAGE });
      return z.NEVER;
    }
    return phone;
  })
  .nullish();

/**
 * RTN (14 dígitos) o DNI (13) opcional de clientes y proveedores. Admite guiones y
 * espacios al escribirlo; queda solo con dígitos. Vacío = sin RTN.
 */
export const optionalRtn = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s-]/g, ""))
  .refine((value) => value === "" || /^\d{13,14}$/.test(value), RTN_MESSAGE)
  .refine((value) => value === "" || !/^\d{13,14}$/.test(value) || validRtnPlace(value), RTN_PLACE_MESSAGE)
  .nullish();

/** Fecha de un cobro, pago o documento: no puede ser futura. */
export const pastOrTodayDate = z
  .string()
  .date("Fecha inválida.")
  .refine((value) => value <= todayInHonduras(), "La fecha no puede ser posterior a hoy.");

/** Filtros con rango de fechas: "desde" no puede ser mayor que "hasta". */
export function checkDateRange(value: { dateFrom?: string; dateTo?: string }, ctx: z.RefinementCtx) {
  if (value.dateFrom && value.dateTo && value.dateFrom > value.dateTo) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["dateTo"], message: "La fecha inicial no puede ser mayor que la final." });
  }
}
