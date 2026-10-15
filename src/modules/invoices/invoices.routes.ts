import { Router } from "express";

import { requirePermission } from "../../middlewares/require-permission";
import { validateRequest } from "../../middlewares/validate-request";
import { asyncHandler } from "../../utils/async-handler";
import { createCorrectionSchema, createInvoiceSchema, invoiceIdSchema, listInvoicesSchema } from "./invoices.schemas";
import { invoicesController } from "./invoices.controller";

export const invoicesRouter = Router();

invoicesRouter.get("/", requirePermission("invoices.view"), validateRequest(listInvoicesSchema, "query"), asyncHandler(invoicesController.list.bind(invoicesController)));
invoicesRouter.post("/", requirePermission("invoices.create"), validateRequest(createInvoiceSchema), asyncHandler(invoicesController.create.bind(invoicesController)));
invoicesRouter.get("/series/active", requirePermission("invoices.view"), asyncHandler(invoicesController.activeSeries.bind(invoicesController)));
invoicesRouter.get(
  "/:id",
  requirePermission("invoices.view"),
  validateRequest(invoiceIdSchema, "params"),
  asyncHandler(invoicesController.getById.bind(invoicesController))
);
invoicesRouter.get(
  "/:id/print",
  requirePermission("invoices.view"),
  validateRequest(invoiceIdSchema, "params"),
  asyncHandler(invoicesController.print.bind(invoicesController))
);
invoicesRouter.get(
  "/:id/pdf",
  requirePermission("invoices.view"),
  validateRequest(invoiceIdSchema, "params"),
  asyncHandler(invoicesController.pdf.bind(invoicesController))
);
invoicesRouter.post(
  "/:id/corrections",
  requirePermission("invoices.void"),
  validateRequest(invoiceIdSchema, "params"),
  validateRequest(createCorrectionSchema),
  asyncHandler(invoicesController.createCorrection.bind(invoicesController))
);
invoicesRouter.get(
  "/:id/corrections",
  requirePermission("invoices.view"),
  validateRequest(invoiceIdSchema, "params"),
  asyncHandler(invoicesController.corrections.bind(invoicesController))
);
