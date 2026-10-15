import { Router } from "express";

import { requirePermission } from "../../middlewares/require-permission";
import { validateRequest } from "../../middlewares/validate-request";
import { asyncHandler } from "../../utils/async-handler";
import { permissionsController } from "./permissions.controller";
import { roleIdSchema, setRolePermissionsSchema } from "./permissions.schemas";

export const rolesRouter = Router();

rolesRouter.get("/", requirePermission("roles.view"), asyncHandler(permissionsController.listRoles.bind(permissionsController)));
rolesRouter.get("/catalog", requirePermission("roles.view"), asyncHandler(permissionsController.catalog.bind(permissionsController)));
rolesRouter.put(
  "/:id/permissions",
  requirePermission("roles.edit"),
  validateRequest(roleIdSchema, "params"),
  validateRequest(setRolePermissionsSchema),
  asyncHandler(permissionsController.setPermissions.bind(permissionsController))
);
