import { z } from "zod";

import { optionalRtn } from "../shared/schema-fields";

export const listSuppliersSchema = z.object({
  search: z.string().trim().optional(),
  status: z.enum(["active", "inactive", "all"]).default("active"),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(10)
});

export const createSupplierSchema = z.object({
  code: z.string().trim().max(30).nullish().or(z.literal("")),
  name: z.string().trim().min(2).max(180),
  rtn: optionalRtn,
  email: z.string().trim().email().max(150).nullish().or(z.literal("")),
  phone: z.string().trim().max(40).nullish().or(z.literal("")),
  address: z.string().trim().max(255).nullish().or(z.literal(""))
});

export const updateSupplierSchema = createSupplierSchema;

export const updateSupplierStatusSchema = z.object({
  isActive: z.boolean()
});

export const supplierIdSchema = z.object({
  id: z.coerce.number().int().positive()
});
