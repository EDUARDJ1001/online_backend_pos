import { Router } from "express";

import { requirePermission } from "../../middlewares/require-permission";
import { validateRequest } from "../../middlewares/validate-request";
import { asyncHandler } from "../../utils/async-handler";
import {
  createInventoryEntrySchema,
  createStockAdjustmentSchema,
  inventoryEntryIdSchema,
  listInventoryEntriesSchema,
  listMovementsSchema,
  listStocksSchema,
  productIdParamSchema
} from "./inventory.schemas";
import { inventoryController } from "./inventory.controller";

export const inventoryRouter = Router();

inventoryRouter.get("/suppliers", requirePermission("inventory.view"), asyncHandler(inventoryController.supplierOptions.bind(inventoryController)));
inventoryRouter.get("/stocks", requirePermission("inventory.view"), validateRequest(listStocksSchema, "query"), asyncHandler(inventoryController.stocks.bind(inventoryController)));
inventoryRouter.get(
  "/stocks/:productId/warehouses",
  requirePermission("inventory.view"),
  validateRequest(productIdParamSchema, "params"),
  asyncHandler(inventoryController.productWarehouses.bind(inventoryController))
);
inventoryRouter.get(
  "/movements",
  requirePermission("inventory.view"),
  validateRequest(listMovementsSchema, "query"),
  asyncHandler(inventoryController.movements.bind(inventoryController))
);
inventoryRouter.get(
  "/entries",
  requirePermission("inventory.view"),
  validateRequest(listInventoryEntriesSchema, "query"),
  asyncHandler(inventoryController.entries.bind(inventoryController))
);
inventoryRouter.post(
  "/entries",
  requirePermission("inventory.adjust"),
  validateRequest(createInventoryEntrySchema),
  asyncHandler(inventoryController.createEntry.bind(inventoryController))
);
inventoryRouter.get(
  "/entries/:id",
  requirePermission("inventory.view"),
  validateRequest(inventoryEntryIdSchema, "params"),
  asyncHandler(inventoryController.entryDetail.bind(inventoryController))
);
inventoryRouter.post(
  "/adjustments",
  requirePermission("inventory.adjust"),
  validateRequest(createStockAdjustmentSchema),
  asyncHandler(inventoryController.createAdjustment.bind(inventoryController))
);
