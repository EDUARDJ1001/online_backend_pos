import type { NextFunction, Request, Response } from "express";

import { AppError } from "../utils/http-error";
import { verifyAccessToken } from "../utils/auth-tokens";
import { permissionsService } from "../modules/permissions/permissions.service";

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const authorization = req.headers.authorization;

  if (!authorization?.startsWith("Bearer ")) {
    return next(new AppError("Debes iniciar sesión para continuar.", 401));
  }

  const token = authorization.slice("Bearer ".length);

  try {
    req.auth = verifyAccessToken(token);
  } catch (_error) {
    return next(new AppError("Tu sesión no es válida o ya expiró.", 401));
  }

  try {
    // Rol y estado actuales (desde la base, sincronizados entre cajas): un cambio
    // de rol o una desactivación aplica de inmediato, sin esperar a que venza la sesión.
    const current = await permissionsService.currentUser(req.auth.sub);

    if (!current || !current.isActive) {
      return next(new AppError("Tu usuario está inactivo o ya no existe.", 401));
    }

    req.auth = { ...req.auth, role: current.role };
    next();
  } catch (error) {
    next(error);
  }
}

export function requireRoles(roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) {
      return next(new AppError("No autorizado.", 401));
    }

    if (!roles.includes(req.auth.role)) {
      return next(new AppError("No tienes permisos para realizar esta acción.", 403));
    }

    next();
  };
}
