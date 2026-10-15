import { Router } from "express";

import { requirePermission } from "../../middlewares/require-permission";
import { validateRequest } from "../../middlewares/validate-request";
import { asyncHandler } from "../../utils/async-handler";
import { cajaController } from "./caja.controller";
import {
  closeSessionSchema,
  listSessionsSchema,
  manualMovementSchema,
  networkCreateSchema,
  openSessionSchema,
  pairingCreateSchema,
  pairingRedeemSchema,
  registerCreateSchema,
  registerUpdateSchema,
  sessionIdSchema,
  terminalCreateSchema,
  terminalIpCreateSchema,
  terminalUpdateSchema
} from "./caja.schemas";

export const cajaRouter = Router();

cajaRouter.get("/overview", requirePermission("caja.view"), asyncHandler(cajaController.overview.bind(cajaController)));

cajaRouter.get("/registers", requirePermission("caja.view"), asyncHandler(cajaController.listRegisters.bind(cajaController)));
cajaRouter.post(
  "/registers",
  requirePermission("caja.manage"),
  validateRequest(registerCreateSchema),
  asyncHandler(cajaController.createRegister.bind(cajaController))
);
cajaRouter.patch(
  "/registers/:id",
  requirePermission("caja.manage"),
  validateRequest(sessionIdSchema, "params"),
  validateRequest(registerUpdateSchema),
  asyncHandler(cajaController.updateRegister.bind(cajaController))
);

// Equipos (PC) ligados a cada caja física.
cajaRouter.get("/terminals", requirePermission("caja.manage"), asyncHandler(cajaController.listTerminals.bind(cajaController)));
cajaRouter.post(
  "/terminals",
  requirePermission("caja.manage"),
  validateRequest(terminalCreateSchema),
  asyncHandler(cajaController.registerTerminal.bind(cajaController))
);
// Redes autorizadas (verificación extra por IP de los equipos de caja).
cajaRouter.get("/networks", requirePermission("caja.manage"), asyncHandler(cajaController.listNetworks.bind(cajaController)));
cajaRouter.post(
  "/networks",
  requirePermission("caja.manage"),
  validateRequest(networkCreateSchema),
  asyncHandler(cajaController.addNetwork.bind(cajaController))
);
cajaRouter.delete(
  "/networks/:id",
  requirePermission("caja.manage"),
  validateRequest(sessionIdSchema, "params"),
  asyncHandler(cajaController.removeNetwork.bind(cajaController))
);

// Código de vinculación: el administrador lo genera para una caja; en la PC de
// esa caja cualquier usuario con acceso a Caja lo canjea.
cajaRouter.post(
  "/registers/:id/pairing",
  requirePermission("caja.manage"),
  validateRequest(sessionIdSchema, "params"),
  validateRequest(pairingCreateSchema),
  asyncHandler(cajaController.createPairing.bind(cajaController))
);
cajaRouter.post(
  "/terminals/pair",
  requirePermission("caja.view"),
  validateRequest(pairingRedeemSchema),
  asyncHandler(cajaController.redeemPairing.bind(cajaController))
);
// Equipo por IP: la caja queda habilitada para la PC con esa IP (IP fija).
cajaRouter.post(
  "/terminals/by-ip",
  requirePermission("caja.manage"),
  validateRequest(terminalIpCreateSchema),
  asyncHandler(cajaController.registerTerminalByIp.bind(cajaController))
);
cajaRouter.patch(
  "/terminals/:id",
  requirePermission("caja.manage"),
  validateRequest(sessionIdSchema, "params"),
  validateRequest(terminalUpdateSchema),
  asyncHandler(cajaController.updateTerminal.bind(cajaController))
);
cajaRouter.delete(
  "/terminals/:id",
  requirePermission("caja.manage"),
  validateRequest(sessionIdSchema, "params"),
  asyncHandler(cajaController.deleteTerminal.bind(cajaController))
);

cajaRouter.get(
  "/sessions",
  requirePermission("caja.view"),
  validateRequest(listSessionsSchema, "query"),
  asyncHandler(cajaController.list.bind(cajaController))
);
cajaRouter.get(
  "/sessions/:id",
  requirePermission("caja.view"),
  validateRequest(sessionIdSchema, "params"),
  asyncHandler(cajaController.getById.bind(cajaController))
);
cajaRouter.get(
  "/sessions/:id/pdf",
  requirePermission("caja.view"),
  validateRequest(sessionIdSchema, "params"),
  asyncHandler(cajaController.pdf.bind(cajaController))
);

cajaRouter.post("/open", requirePermission("caja.open"), validateRequest(openSessionSchema), asyncHandler(cajaController.open.bind(cajaController)));
cajaRouter.post("/close", requirePermission("caja.close"), validateRequest(closeSessionSchema), asyncHandler(cajaController.close.bind(cajaController)));
cajaRouter.post("/movements", requirePermission("caja.move"), validateRequest(manualMovementSchema), asyncHandler(cajaController.move.bind(cajaController)));
