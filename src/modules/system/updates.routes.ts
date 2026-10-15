import { Router, type NextFunction, type Request, type Response } from "express";

import { requireAuth, requireRoles } from "../../middlewares/auth.middleware";
import { asyncHandler } from "../../utils/async-handler";
import { AppError } from "../../utils/http-error";
import { schemaStatus } from "./migrations.service";
import { updatesService } from "./updates.service";

/** Sistema > Actualizaciones (programa de escritorio de cada caja). */
export const updatesRouter = Router();

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/**
 * Caja desactualizada (la base ya tiene una versión más nueva): se puede actualizar
 * sin iniciar sesión, desde la misma PC. Solo instala versiones firmadas y más nuevas.
 */
function requireOutdatedLocal(req: Request, _res: Response, next: NextFunction) {
  if (schemaStatus().unknown.length === 0) {
    return next(new AppError("Esta caja no necesita actualizarse para usar la base de datos.", 403));
  }
  if (!LOOPBACK.has(req.socket.remoteAddress ?? "")) {
    return next(new AppError("Solo se puede actualizar desde la PC donde está instalado el sistema.", 403));
  }
  next();
}

updatesRouter.post(
  "/required",
  requireOutdatedLocal,
  asyncHandler(async (_req, res) => {
    // Revisa de nuevo por si se publicó hace poco.
    await updatesService.check();
    res.json(await updatesService.apply());
  })
);

updatesRouter.use(requireAuth, requireRoles(["ADMIN", "SUPERADMIN"]));

updatesRouter.get("/", (_req, res) => {
  res.json(updatesService.status());
});

updatesRouter.post(
  "/check",
  asyncHandler(async (_req, res) => {
    res.json(await updatesService.check());
  })
);

updatesRouter.post(
  "/apply",
  asyncHandler(async (_req, res) => {
    res.json(await updatesService.apply());
  })
);

