import type { NextFunction, Request, Response } from "express";

import { AppError } from "../utils/http-error";
import { permissionsService } from "../modules/permissions/permissions.service";

/** Exige un permiso "recurso.accion" del catálogo para el rol del usuario. */
export function requirePermission(key: string) {
  const middleware = async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) {
      return next(new AppError("No autorizado.", 401));
    }

    try {
      const permissions = await permissionsService.getRolePermissions(req.auth.role);

      if (!permissions.has(key)) {
        return next(new AppError("No tienes permisos para realizar esta acción.", 403));
      }

      next();
    } catch (error) {
      next(error);
    }
  };
  // La documentación (src/docs/openapi.ts) muestra el permiso que exige cada ruta.
  return Object.assign(middleware, { openapi: { permission: key } });
}
