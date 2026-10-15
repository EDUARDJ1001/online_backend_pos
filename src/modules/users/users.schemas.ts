import { z } from "zod";

const passwordRules = z
  .string()
  .min(8, "La contraseña debe tener al menos 8 caracteres.")
  .max(72, "La contraseña no puede superar 72 caracteres.")
  .regex(/[A-Za-z]/, "La contraseña debe incluir al menos una letra.")
  .regex(/[0-9]/, "La contraseña debe incluir al menos un número.");

export const listUsersSchema = z.object({
  search: z.string().trim().optional(),
  status: z.enum(["active", "inactive", "all"]).default("active"),
  role: z.string().trim().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(10)
});

export const createUserSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, "El usuario debe tener al menos 3 caracteres.")
    .max(50)
    .regex(/^[a-zA-Z0-9._-]+$/, "El usuario solo admite letras, números, punto, guion y guion bajo."),
  email: z.string().trim().email("Correo inválido.").max(150),
  fullName: z.string().trim().min(3, "El nombre completo es obligatorio.").max(150),
  password: passwordRules,
  roleId: z.coerce.number().int().positive(),
  companyIds: z.array(z.coerce.number().int().positive()).default([])
});

export const updateUserSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(50)
    .regex(/^[a-zA-Z0-9._-]+$/, "El usuario solo admite letras, números, punto, guion y guion bajo."),
  email: z.string().trim().email("Correo inválido.").max(150),
  fullName: z.string().trim().min(3).max(150),
  roleId: z.coerce.number().int().positive(),
  companyIds: z.array(z.coerce.number().int().positive()).default([])
});

export const updateUserPasswordSchema = z.object({
  password: passwordRules
});

export const updateUserStatusSchema = z.object({
  isActive: z.boolean()
});

export const userIdSchema = z.object({
  id: z.coerce.number().int().positive()
});
