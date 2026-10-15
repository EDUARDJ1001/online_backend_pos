import { Router, type NextFunction, type Request, type Response } from "express";

import { AppError } from "../utils/http-error";
import { licenseStatus } from "./license-runtime";

/**
 * Licencia de este equipo: solo se consulta (sin sesión: se usa antes de entrar). El
 * programa no instala ni cambia licencias; eso lo hace el gestor de licencias, desde fuera.
 */
export const licenseRouter = Router();

licenseRouter.get("/estado", async (_req, res, next) => {
  try {
    res.json(await licenseStatus());
  } catch (error) {
    next(error);
  }
});

/** Sin licencia válida (cuando se exige), el sistema no responde más que el estado. */
export async function licenseGuard(_req: Request, _res: Response, next: NextFunction) {
  try {
    const status = await licenseStatus();
    if (!status.required || status.valid) return next();
    return next(new AppError(status.message ?? "Este equipo no tiene una licencia válida.", 403, { code: "LICENSE_REQUIRED" }));
  } catch (error) {
    return next(error);
  }
}
