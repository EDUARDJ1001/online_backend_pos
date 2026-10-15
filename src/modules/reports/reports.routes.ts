import { Router } from "express";

import { requirePermission } from "../../middlewares/require-permission";
import { validateRequest } from "../../middlewares/validate-request";
import { asyncHandler } from "../../utils/async-handler";
import { reportsController } from "./reports.controller";
import { salesReportSchema } from "./reports.schemas";

export const reportsRouter = Router();

reportsRouter.get(
  "/sales",
  requirePermission("reports.view"),
  validateRequest(salesReportSchema, "query"),
  asyncHandler(reportsController.sales.bind(reportsController))
);
reportsRouter.get(
  "/sales/csv",
  requirePermission("reports.view"),
  validateRequest(salesReportSchema, "query"),
  asyncHandler(reportsController.salesCsv.bind(reportsController))
);
