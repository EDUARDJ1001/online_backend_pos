import type { NextFunction, Request, Response } from "express";

import { schemaBlockMessage, unavailableFeatureForPath } from "../modules/system/migrations.service";
import { AppError } from "../utils/http-error";

/**
 * Bloquea la operación si el programa y la base de datos no están en la misma
 * versión (p. ej. esta caja quedó desactualizada). Inicio de sesión y Sistema
 * quedan libres para poder revisar o corregir la configuración.
 */
export function schemaGuard(req: Request, _res: Response, next: NextFunction) {
  if (req.path.startsWith("/auth") || req.path.startsWith("/system") || req.path.startsWith("/setup")) {
    return next();
  }

  const message = schemaBlockMessage();
  if (message) {
    return next(new AppError(message, 503));
  }

  // Función cuya actualización falta: solo ella queda desactivada.
  const feature = unavailableFeatureForPath(req.path);
  if (feature) {
    return next(
      new AppError(
        `${feature.name} no está disponible todavía: falta aplicar una actualización de la base de datos. Un administrador puede aplicarla en Sistema > Base de datos.`,
        503,
        { code: "FEATURE_PENDING" }
      )
    );
  }
  return next();
}
