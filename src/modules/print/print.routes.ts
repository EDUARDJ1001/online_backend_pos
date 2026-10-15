import { Router } from "express";
import { z } from "zod";

import { requirePermission } from "../../middlewares/require-permission";
import { validateRequest } from "../../middlewares/validate-request";
import { asyncHandler } from "../../utils/async-handler";
import { invoiceIdSchema } from "../invoices/invoices.schemas";
import { printController } from "./print.controller";

export const printRouter = Router();

printRouter.get("/status", requirePermission("invoices.view"), asyncHandler(printController.status.bind(printController)));
printRouter.get("/test-pdf", requirePermission("invoices.view"), asyncHandler(printController.testPdf.bind(printController)));
printRouter.get("/local-targets", requirePermission("invoices.view"), asyncHandler(printController.localTargets.bind(printController)));
printRouter.put(
  "/ticket-printer",
  requirePermission("invoices.view"),
  validateRequest(z.object({ interface: z.string().trim().max(300) })),
  asyncHandler(printController.setTicketPrinter.bind(printController))
);
printRouter.post("/test-ticket", requirePermission("invoices.view"), asyncHandler(printController.testTicket.bind(printController)));
printRouter.post(
  "/invoices/:id/ticket",
  requirePermission("invoices.view"),
  validateRequest(invoiceIdSchema, "params"),
  asyncHandler(printController.invoiceTicket.bind(printController))
);
