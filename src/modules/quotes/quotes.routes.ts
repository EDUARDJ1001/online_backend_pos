import { Router } from "express";

import { requirePermission } from "../../middlewares/require-permission";
import { validateRequest } from "../../middlewares/validate-request";
import { asyncHandler } from "../../utils/async-handler";
import { quotesController } from "./quotes.controller";
import { createQuoteSchema, listQuotesSchema, quoteIdSchema, updateQuoteStatusSchema } from "./quotes.schemas";

export const quotesRouter = Router();

quotesRouter.get("/", requirePermission("quotes.view"), validateRequest(listQuotesSchema, "query"), asyncHandler(quotesController.list.bind(quotesController)));
quotesRouter.post("/", requirePermission("quotes.create"), validateRequest(createQuoteSchema), asyncHandler(quotesController.create.bind(quotesController)));
quotesRouter.get(
  "/:id",
  requirePermission("quotes.view"),
  validateRequest(quoteIdSchema, "params"),
  asyncHandler(quotesController.getById.bind(quotesController))
);
quotesRouter.get(
  "/:id/pdf",
  requirePermission("quotes.view"),
  validateRequest(quoteIdSchema, "params"),
  asyncHandler(quotesController.pdf.bind(quotesController))
);
quotesRouter.patch(
  "/:id/status",
  requirePermission("quotes.create"),
  validateRequest(quoteIdSchema, "params"),
  validateRequest(updateQuoteStatusSchema),
  asyncHandler(quotesController.updateStatus.bind(quotesController))
);
quotesRouter.post(
  "/:id/convert-to-invoice",
  requirePermission("invoices.create"),
  validateRequest(quoteIdSchema, "params"),
  asyncHandler(quotesController.convertToInvoice.bind(quotesController))
);
