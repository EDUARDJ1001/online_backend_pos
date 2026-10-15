import { Router } from "express";

import { requirePermission } from "../../middlewares/require-permission";
import { validateRequest } from "../../middlewares/validate-request";
import { asyncHandler } from "../../utils/async-handler";
import {
  createPayableDocumentSchema,
  listPayablesSchema,
  payableIdSchema,
  payableSupplierIdSchema,
  registerPayablePaymentSchema
} from "./payables.schemas";
import { payablesController } from "./payables.controller";

export const payablesRouter = Router();

payablesRouter.get(
  "/",
  requirePermission("payables.view"),
  validateRequest(listPayablesSchema, "query"),
  asyncHandler(payablesController.list.bind(payablesController))
);
payablesRouter.post(
  "/",
  requirePermission("payables.create"),
  validateRequest(createPayableDocumentSchema),
  asyncHandler(payablesController.create.bind(payablesController))
);
payablesRouter.get(
  "/suppliers/:supplierId/statement",
  requirePermission("payables.view"),
  validateRequest(payableSupplierIdSchema, "params"),
  asyncHandler(payablesController.supplierStatement.bind(payablesController))
);
payablesRouter.get(
  "/suppliers/:supplierId/statement/pdf",
  requirePermission("payables.view"),
  validateRequest(payableSupplierIdSchema, "params"),
  asyncHandler(payablesController.supplierStatementPdf.bind(payablesController))
);
payablesRouter.get(
  "/:id",
  requirePermission("payables.view"),
  validateRequest(payableIdSchema, "params"),
  asyncHandler(payablesController.getDetail.bind(payablesController))
);
payablesRouter.patch(
  "/:id/void",
  requirePermission("payables.void"),
  validateRequest(payableIdSchema, "params"),
  asyncHandler(payablesController.void.bind(payablesController))
);
payablesRouter.post(
  "/:id/payments",
  requirePermission("payables.pay"),
  validateRequest(payableIdSchema, "params"),
  validateRequest(registerPayablePaymentSchema),
  asyncHandler(payablesController.registerPayment.bind(payablesController))
);
