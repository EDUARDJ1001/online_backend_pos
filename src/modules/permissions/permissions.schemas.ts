import { z } from "zod";

export const roleIdSchema = z.object({
  id: z.coerce.number().int().positive()
});

export const setRolePermissionsSchema = z.object({
  permissions: z.array(z.string().trim().min(1).max(80)).max(200)
});
