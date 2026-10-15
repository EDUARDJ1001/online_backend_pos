import { z } from "zod";

const nullableText = (max: number) => z.string().trim().max(max).nullish().or(z.literal(""));

export const warehouseIdSchema = z.object({
  id: z.coerce.number().int().positive()
});

export const listWarehousesSchema = z.object({
  search: z.string().trim().optional(),
  status: z.enum(["active", "inactive", "all"]).default("active"),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(50)
});

export const createWarehouseSchema = z.object({
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(2).max(120),
  address: nullableText(255),
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true)
});

export const updateWarehouseSchema = createWarehouseSchema;

export const updateWarehouseStatusSchema = z.object({
  isActive: z.boolean()
});
