import { Router } from "express";

import { requirePermission } from "../../middlewares/require-permission";
import { validateRequest } from "../../middlewares/validate-request";
import { asyncHandler } from "../../utils/async-handler";
import { clientIdSchema, createClientSchema, listClientsSchema, updateClientSchema, updateClientStatusSchema } from "./clients.schemas";
import { clientsController } from "./clients.controller";
import { activeOnlyUnlessAdmin, requireDeactivationRole } from "../../middlewares/deactivation.middleware";

export const clientsRouter = Router();

clientsRouter.get("/", requirePermission("clients.view"), validateRequest(listClientsSchema, "query"), activeOnlyUnlessAdmin, asyncHandler(clientsController.list.bind(clientsController)));
clientsRouter.post("/", requirePermission("clients.create"), validateRequest(createClientSchema), asyncHandler(clientsController.create.bind(clientsController)));
clientsRouter.get(
  "/:id",
  requirePermission("clients.view"),
  validateRequest(clientIdSchema, "params"),
  asyncHandler(clientsController.getById.bind(clientsController))
);
clientsRouter.get(
  "/:id/summary",
  requirePermission("clients.view"),
  validateRequest(clientIdSchema, "params"),
  asyncHandler(clientsController.summary.bind(clientsController))
);
clientsRouter.put(
  "/:id",
  requirePermission("clients.edit"),
  validateRequest(clientIdSchema, "params"),
  validateRequest(updateClientSchema),
  asyncHandler(clientsController.update.bind(clientsController))
);
clientsRouter.patch(
  "/:id/status",
  requirePermission("clients.edit"),
  requireDeactivationRole,
  validateRequest(clientIdSchema, "params"),
  validateRequest(updateClientStatusSchema),
  asyncHandler(clientsController.updateStatus.bind(clientsController))
);
