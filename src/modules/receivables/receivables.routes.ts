import { Router } from "express";

import { requirePermission } from "../../middlewares/require-permission";
import { validateRequest } from "../../middlewares/validate-request";
import { asyncHandler } from "../../utils/async-handler";
import {
  listReceivablesSchema,
  receivableClientIdSchema,
  receivableInvoiceIdSchema,
  registerPaymentSchema
} from "./receivables.schemas";
import { receivablesController } from "./receivables.controller";

export const receivablesRouter = Router();

receivablesRouter.get(
  "/",
  requirePermission("receivables.view"),
  validateRequest(listReceivablesSchema, "query"),
  asyncHandler(receivablesController.list.bind(receivablesController))
);
receivablesRouter.get(
  "/clients/:clientId/statement",
  requirePermission("receivables.view"),
  validateRequest(receivableClientIdSchema, "params"),
  asyncHandler(receivablesController.clientStatement.bind(receivablesController))
);
receivablesRouter.get(
  "/clients/:clientId/statement/pdf",
  requirePermission("receivables.view"),
  validateRequest(receivableClientIdSchema, "params"),
  asyncHandler(receivablesController.clientStatementPdf.bind(receivablesController))
);
receivablesRouter.get(
  "/:invoiceId",
  requirePermission("receivables.view"),
  validateRequest(receivableInvoiceIdSchema, "params"),
  asyncHandler(receivablesController.getDetail.bind(receivablesController))
);
receivablesRouter.post(
  "/:invoiceId/payments",
  requirePermission("receivables.pay"),
  validateRequest(receivableInvoiceIdSchema, "params"),
  validateRequest(registerPaymentSchema),
  asyncHandler(receivablesController.registerPayment.bind(receivablesController))
);
