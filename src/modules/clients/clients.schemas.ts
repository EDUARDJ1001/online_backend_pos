import { z } from "zod";

import { optionalPhone, optionalRtn } from "../shared/schema-fields";

export const listClientsSchema = z.object({
  search: z.string().trim().optional(),
  status: z.enum(["active", "inactive", "all"]).default("active"),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(10)
});

export const createClientSchema = z.object({
  code: z.string().trim().max(30).nullish().or(z.literal("")),
  // Espacios repetidos fuera; debe tener al menos una letra (no solo números o signos).
  name: z
    .string()
    .transform((value) => value.trim().replace(/\s+/g, " "))
    .pipe(z.string().min(2, "Escribe el nombre del cliente (mínimo 2 letras).").max(180).regex(/\p{L}/u, "El nombre debe tener letras.")),
  rtn: optionalRtn,
  email: z.string().trim().toLowerCase().email("Escribe un correo válido, por ejemplo cliente@correo.com.").max(150).nullish().or(z.literal("")),
  phone: optionalPhone,
  address: z
    .string()
    .transform((value) => value.trim().replace(/\s+/g, " "))
    .pipe(z.string().max(255))
    .nullish(),
  isGeneric: z.boolean().default(false)
});

export const updateClientSchema = createClientSchema;

export const updateClientStatusSchema = z.object({
  isActive: z.boolean()
});

export const clientIdSchema = z.object({
  id: z.coerce.number().int().positive()
});
