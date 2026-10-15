import { Router } from "express";

import { requirePermission } from "../../middlewares/require-permission";
import { validateRequest } from "../../middlewares/validate-request";
import { asyncHandler } from "../../utils/async-handler";
import { usersController } from "./users.controller";
import { activeOnlyUnlessAdmin, requireDeactivationRole } from "../../middlewares/deactivation.middleware";
import {
  createUserSchema,
  listUsersSchema,
  updateUserPasswordSchema,
  updateUserSchema,
  updateUserStatusSchema,
  userIdSchema
} from "./users.schemas";

export const usersRouter = Router();

usersRouter.get("/", requirePermission("users.view"), validateRequest(listUsersSchema, "query"), activeOnlyUnlessAdmin, asyncHandler(usersController.list.bind(usersController)));
usersRouter.get("/roles", requirePermission("users.view"), asyncHandler(usersController.roles.bind(usersController)));
usersRouter.post("/", requirePermission("users.create"), validateRequest(createUserSchema), asyncHandler(usersController.create.bind(usersController)));
usersRouter.get("/:id", requirePermission("users.view"), validateRequest(userIdSchema, "params"), asyncHandler(usersController.getById.bind(usersController)));
usersRouter.put(
  "/:id",
  requirePermission("users.edit"),
  validateRequest(userIdSchema, "params"),
  validateRequest(updateUserSchema),
  asyncHandler(usersController.update.bind(usersController))
);
usersRouter.patch(
  "/:id/password",
  requirePermission("users.edit"),
  validateRequest(userIdSchema, "params"),
  validateRequest(updateUserPasswordSchema),
  asyncHandler(usersController.updatePassword.bind(usersController))
);
usersRouter.patch(
  "/:id/status",
  requirePermission("users.edit"),
  requireDeactivationRole,
  validateRequest(userIdSchema, "params"),
  validateRequest(updateUserStatusSchema),
  asyncHandler(usersController.updateStatus.bind(usersController))
);
