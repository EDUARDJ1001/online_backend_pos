import { Router } from "express";

import { requireRoles } from "../../middlewares/auth.middleware";
import { validateRequest } from "../../middlewares/validate-request";
import { asyncHandler } from "../../utils/async-handler";
import { databaseController } from "./database.controller";
import { databaseSchema } from "./database.schemas";

/** Configuración del sistema: solo SUPERADMIN. */
export const systemRouter = Router();

systemRouter.use(requireRoles(["SUPERADMIN"]));

systemRouter.get("/database", asyncHandler(databaseController.status.bind(databaseController)));
systemRouter.get("/database/structure", asyncHandler(databaseController.structure.bind(databaseController)));
systemRouter.post("/database/test", validateRequest(databaseSchema), asyncHandler(databaseController.test.bind(databaseController)));
systemRouter.put("/database", validateRequest(databaseSchema), asyncHandler(databaseController.apply.bind(databaseController)));
systemRouter.post("/database/migrate", asyncHandler(databaseController.migrate.bind(databaseController)));
