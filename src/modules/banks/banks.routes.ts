import { Router } from "express";

import { requireRoles } from "../../middlewares/auth.middleware";
import { validateRequest } from "../../middlewares/validate-request";
import { asyncHandler } from "../../utils/async-handler";
import { banksController } from "./banks.controller";
import {
  accountIdSchema,
  accountStatusSchema,
  checkStatusSchema,
  createAccountSchema,
  createCheckSchema,
  createMovementSchema,
  createTransferSchema,
  listAccountsSchema,
  listMovementsSchema,
  movementIdSchema,
  updateAccountSchema,
  voidMovementSchema
} from "./banks.schemas";

export const banksRouter = Router();

// De momento, Bancos es solo para el SUPERADMIN.
banksRouter.use(requireRoles(["SUPERADMIN"]));

banksRouter.get("/accounts", validateRequest(listAccountsSchema, "query"), asyncHandler(banksController.listAccounts.bind(banksController)));
banksRouter.post("/accounts", validateRequest(createAccountSchema), asyncHandler(banksController.createAccount.bind(banksController)));
banksRouter.put("/accounts/:id", validateRequest(accountIdSchema, "params"), validateRequest(updateAccountSchema), asyncHandler(banksController.updateAccount.bind(banksController)));
banksRouter.patch("/accounts/:id/status", validateRequest(accountIdSchema, "params"), validateRequest(accountStatusSchema), asyncHandler(banksController.setAccountStatus.bind(banksController)));
banksRouter.get("/accounts/:id/movements", validateRequest(accountIdSchema, "params"), validateRequest(listMovementsSchema, "query"), asyncHandler(banksController.listMovements.bind(banksController)));

banksRouter.post("/movements", validateRequest(createMovementSchema), asyncHandler(banksController.createMovement.bind(banksController)));
banksRouter.post("/checks", validateRequest(createCheckSchema), asyncHandler(banksController.createCheck.bind(banksController)));
banksRouter.post("/transfers", validateRequest(createTransferSchema), asyncHandler(banksController.createTransfer.bind(banksController)));
banksRouter.post("/movements/:id/void", validateRequest(movementIdSchema, "params"), validateRequest(voidMovementSchema), asyncHandler(banksController.voidMovement.bind(banksController)));
banksRouter.patch("/movements/:id/check-status", validateRequest(movementIdSchema, "params"), validateRequest(checkStatusSchema), asyncHandler(banksController.setCheckStatus.bind(banksController)));
