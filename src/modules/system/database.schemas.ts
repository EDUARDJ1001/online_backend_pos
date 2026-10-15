import { z } from "zod";

export const databaseSchema = z.object({
  // Sin motor = el de la conexión actual.
  client: z.enum(["mysql", "mssql"]).optional(),
  host: z.string().trim().min(1).max(255),
  port: z.coerce.number().int().min(1).max(65535).default(3306),
  database: z.string().trim().min(1).max(64),
  user: z.string().trim().min(1).max(80),
  // Vacío = conserva la contraseña actual.
  password: z.string().max(255).nullish().or(z.literal("")),
  sslMode: z.enum(["DISABLED", "REQUIRED"]).default("DISABLED"),
  sslCa: z.string().max(20000).nullish().or(z.literal("")),
  // Solo al guardar: preparar la base si está vacía.
  initialize: z.boolean().optional()
});
