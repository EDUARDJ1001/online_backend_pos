import { Router } from "express";

import { requirePermission } from "../../middlewares/require-permission";
import { validateRequest } from "../../middlewares/validate-request";
import { asyncHandler } from "../../utils/async-handler";
import {
  createSupplierSchema,
  listSuppliersSchema,
  supplierIdSchema,
  updateSupplierSchema,
  updateSupplierStatusSchema
} from "./suppliers.schemas";
import { suppliersController } from "./suppliers.controller";
import { activeOnlyUnlessAdmin, requireDeactivationRole } from "../../middlewares/deactivation.middleware";

export const suppliersRouter = Router();

suppliersRouter.get("/", requirePermission("suppliers.view"), validateRequest(listSuppliersSchema, "query"), activeOnlyUnlessAdmin, asyncHandler(suppliersController.list.bind(suppliersController)));
suppliersRouter.post("/", requirePermission("suppliers.create"), validateRequest(createSupplierSchema), asyncHandler(suppliersController.create.bind(suppliersController)));
suppliersRouter.get("/:id", requirePermission("suppliers.view"), validateRequest(supplierIdSchema, "params"), asyncHandler(suppliersController.getById.bind(suppliersController)));
suppliersRouter.put(
  "/:id",
  requirePermission("suppliers.edit"),
  validateRequest(supplierIdSchema, "params"),
  validateRequest(updateSupplierSchema),
  asyncHandler(suppliersController.update.bind(suppliersController))
);
suppliersRouter.patch(
  "/:id/status",
  requirePermission("suppliers.edit"),
  requireDeactivationRole,
  validateRequest(supplierIdSchema, "params"),
  validateRequest(updateSupplierStatusSchema),
  asyncHandler(suppliersController.updateStatus.bind(suppliersController))
);
