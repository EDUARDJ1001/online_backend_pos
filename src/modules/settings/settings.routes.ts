import { Router } from "express";

import { requirePermission } from "../../middlewares/require-permission";
import { validateRequest } from "../../middlewares/validate-request";
import { asyncHandler } from "../../utils/async-handler";
import { settingsController } from "./settings.controller";
import {
  billingSeriesIdSchema,
  createBillingSeriesSchema,
  updateBillingSeriesSchema,
  updateBillingSeriesStatusSchema,
  updateBillingSettingsSchema
} from "./settings.schemas";

export const settingsRouter = Router();

settingsRouter.get("/billing", requirePermission("settings.view"), asyncHandler(settingsController.getBilling.bind(settingsController)));
settingsRouter.put(
  "/billing",
  requirePermission("settings.configure"),
  validateRequest(updateBillingSettingsSchema),
  asyncHandler(settingsController.updateBilling.bind(settingsController))
);

settingsRouter.get("/billing/series", requirePermission("settings.view"), asyncHandler(settingsController.listSeries.bind(settingsController)));
settingsRouter.post(
  "/billing/series",
  requirePermission("settings.configure"),
  validateRequest(createBillingSeriesSchema),
  asyncHandler(settingsController.createSeries.bind(settingsController))
);
settingsRouter.get(
  "/billing/series/:id",
  requirePermission("settings.view"),
  validateRequest(billingSeriesIdSchema, "params"),
  asyncHandler(settingsController.getSeries.bind(settingsController))
);
settingsRouter.put(
  "/billing/series/:id",
  requirePermission("settings.configure"),
  validateRequest(billingSeriesIdSchema, "params"),
  validateRequest(updateBillingSeriesSchema),
  asyncHandler(settingsController.updateSeries.bind(settingsController))
);
settingsRouter.patch(
  "/billing/series/:id/status",
  requirePermission("settings.configure"),
  validateRequest(billingSeriesIdSchema, "params"),
  validateRequest(updateBillingSeriesStatusSchema),
  asyncHandler(settingsController.updateSeriesStatus.bind(settingsController))
);
