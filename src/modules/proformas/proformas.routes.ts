import { Router } from "express";

import { requirePermission } from "../../middlewares/require-permission";
import { validateRequest } from "../../middlewares/validate-request";
import { asyncHandler } from "../../utils/async-handler";
import { proformasController } from "./proformas.controller";
import { createProformaSchema, listProformasSchema, proformaIdSchema, updateProformaStatusSchema } from "./proformas.schemas";

export const proformasRouter = Router();

proformasRouter.get("/", requirePermission("proformas.view"), validateRequest(listProformasSchema, "query"), asyncHandler(proformasController.list.bind(proformasController)));
proformasRouter.post("/", requirePermission("proformas.create"), validateRequest(createProformaSchema), asyncHandler(proformasController.create.bind(proformasController)));
proformasRouter.get(
  "/:id",
  requirePermission("proformas.view"),
  validateRequest(proformaIdSchema, "params"),
  asyncHandler(proformasController.getById.bind(proformasController))
);
proformasRouter.get(
  "/:id/print",
  requirePermission("proformas.view"),
  validateRequest(proformaIdSchema, "params"),
  asyncHandler(proformasController.print.bind(proformasController))
);
proformasRouter.get(
  "/:id/pdf",
  requirePermission("proformas.view"),
  validateRequest(proformaIdSchema, "params"),
  asyncHandler(proformasController.pdf.bind(proformasController))
);
proformasRouter.patch(
  "/:id/status",
  requirePermission("proformas.create"),
  validateRequest(proformaIdSchema, "params"),
  validateRequest(updateProformaStatusSchema),
  asyncHandler(proformasController.updateStatus.bind(proformasController))
);
proformasRouter.post(
  "/:id/convert-to-invoice",
  requirePermission("invoices.create"),
  validateRequest(proformaIdSchema, "params"),
  asyncHandler(proformasController.convertToInvoice.bind(proformasController))
);
