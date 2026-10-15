import type { NextFunction, Request, Response } from "express";

import { requireRoles } from "./auth.middleware";

/**
 * Registros desactivados: no se pueden usar y no aparecen en las vistas normales.
 * Verlos, desactivar y restaurar es exclusivo de Administrador y Super Administrador.
 */
export const DEACTIVATION_ROLES = ["ADMIN", "SUPERADMIN"];

/** Desactivar o restaurar un registro. */
export const requireDeactivationRole = requireRoles(DEACTIVATION_ROLES);

export function canManageDeactivated(role: string | undefined) {
  return Boolean(role && DEACTIVATION_ROLES.includes(role));
}

/**
 * En listas: quien no es administrador solo ve registros activos, aunque pida
 * los desactivados. Va después de validateRequest(..., "query").
 */
export function activeOnlyUnlessAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!canManageDeactivated(req.auth?.role)) {
    (req.query as Record<string, unknown>).status = "active";
  }
  next();
}
