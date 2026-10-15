import { Router } from "express";

import { requirePermission } from "../../middlewares/require-permission";
import { validateRequest } from "../../middlewares/validate-request";
import { asyncHandler } from "../../utils/async-handler";
import { createWarehouseSchema, listWarehousesSchema, updateWarehouseSchema, updateWarehouseStatusSchema, warehouseIdSchema } from "./warehouses.schemas";
import { warehousesController } from "./warehouses.controller";
import { activeOnlyUnlessAdmin, requireDeactivationRole } from "../../middlewares/deactivation.middleware";

export const warehousesRouter = Router();

warehousesRouter.get("/", requirePermission("warehouses.view"), validateRequest(listWarehousesSchema, "query"), activeOnlyUnlessAdmin, asyncHandler(warehousesController.list.bind(warehousesController)));
warehousesRouter.post("/", requirePermission("warehouses.create"), validateRequest(createWarehouseSchema), asyncHandler(warehousesController.create.bind(warehousesController)));
warehousesRouter.get("/:id", requirePermission("warehouses.view"), validateRequest(warehouseIdSchema, "params"), asyncHandler(warehousesController.getById.bind(warehousesController)));
warehousesRouter.put(
  "/:id",
  requirePermission("warehouses.edit"),
  validateRequest(warehouseIdSchema, "params"),
  validateRequest(updateWarehouseSchema),
  asyncHandler(warehousesController.update.bind(warehousesController))
);
warehousesRouter.patch(
  "/:id/status",
  requirePermission("warehouses.edit"),
  requireDeactivationRole,
  validateRequest(warehouseIdSchema, "params"),
  validateRequest(updateWarehouseStatusSchema),
  asyncHandler(warehousesController.updateStatus.bind(warehousesController))
);
