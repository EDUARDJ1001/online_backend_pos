import { z } from "zod";

import { FOOTER_TEXT_MAX } from "../../utils/footer-text";

export const updateBillingSettingsSchema = z.object({
  defaultTaxRate: z.coerce.number().int("El ISV debe ser un número entero.").min(0).max(100),
  // Sin trim: los espacios al inicio de cada línea forman parte de los dibujos con caracteres.
  footerText: z.string().max(FOOTER_TEXT_MAX, `El pie admite hasta ${FOOTER_TEXT_MAX} caracteres.`).nullish().or(z.literal("")),
  payableTo: z.string().trim().max(180).nullish().or(z.literal("")),
  invoiceTitle: z.string().trim().max(100),
  legendOriginal: z.string().trim().min(1).max(120),
  legendCopy: z.string().trim().min(1).max(120),
  sarNotice: z.string().trim().min(1).max(255),
  allowClientNameCorrection: z.boolean(),
  allowInvoiceDateReissue: z.boolean()
});

/**
 * El CAI del SAR son 32 letras y números agrupados 6-6-6-6-6-2.
 * Ejemplo: A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-4D
 */
const caiSchema = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .refine((value) => /^[0-9A-Z]{6}(-[0-9A-Z]{6}){4}-[0-9A-Z]{2}$/.test(value), {
    message: "El CAI debe tener el formato XXXXXX-XXXXXX-XXXXXX-XXXXXX-XXXXXX-XX (letras y números)."
  });

const codeSchema = (length: number, label: string) =>
  z
    .string()
    .trim()
    .refine((value) => new RegExp(`^[0-9]{${length}}$`).test(value), {
      message: `${label} debe tener exactamente ${length} dígitos.`
    });

const seriesShape = {
  documentType: z.enum(["FACTURA", "NOTA_CREDITO", "NOTA_DEBITO", "RECIBO"]).default("FACTURA"),
  establishmentCode: codeSchema(3, "El código de establecimiento"),
  pointCode: codeSchema(3, "El punto de emisión"),
  documentCode: codeSchema(2, "El tipo de documento"),
  cai: caiSchema,
  resolutionNumber: z.string().trim().max(80).nullish().or(z.literal("")),
  resolutionDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida.")
    .optional()
    .or(z.literal("")),
  issueDeadline: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha límite de emisión es obligatoria."),
  rangeStart: z.coerce.number().int().positive().max(99999999),
  rangeEnd: z.coerce.number().int().positive().max(99999999),
  notes: z.string().trim().max(255).nullish().or(z.literal(""))
};

export const createBillingSeriesSchema = z
  .object({
    ...seriesShape,
    currentNumber: z.coerce.number().int().positive().optional(),
    isActive: z.boolean().default(true)
  })
  .superRefine((value, ctx) => {
    if (value.rangeEnd < value.rangeStart) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rangeEnd"],
        message: "El final del rango no puede ser menor que el inicio."
      });
    }

    const current = value.currentNumber ?? value.rangeStart;

    if (current < value.rangeStart || current > value.rangeEnd + 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["currentNumber"],
        message: "El correlativo actual debe estar dentro del rango autorizado."
      });
    }
  });

export const updateBillingSeriesSchema = z
  .object({
    ...seriesShape,
    currentNumber: z.coerce.number().int().positive()
  })
  .superRefine((value, ctx) => {
    if (value.rangeEnd < value.rangeStart) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rangeEnd"],
        message: "El final del rango no puede ser menor que el inicio."
      });
    }

    if (value.currentNumber < value.rangeStart || value.currentNumber > value.rangeEnd + 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["currentNumber"],
        message: "El correlativo actual debe estar dentro del rango autorizado."
      });
    }
  });

export const updateBillingSeriesStatusSchema = z.object({
  isActive: z.boolean()
});

export const billingSeriesIdSchema = z.object({
  id: z.coerce.number().int().positive()
});
