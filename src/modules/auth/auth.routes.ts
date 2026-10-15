import { Router } from "express";

import { requireAuth } from "../../middlewares/auth.middleware";
import { validateRequest } from "../../middlewares/validate-request";
import { asyncHandler } from "../../utils/async-handler";
import { authController } from "./auth.controller";
import { loginSchema, refreshTokenSchema } from "./auth.schemas";

export const authRouter = Router();

authRouter.post("/login", validateRequest(loginSchema), asyncHandler(authController.login.bind(authController)));
authRouter.post(
  "/refresh",
  validateRequest(refreshTokenSchema),
  asyncHandler(authController.refresh.bind(authController))
);
authRouter.get("/me", requireAuth, asyncHandler(authController.me.bind(authController)));
