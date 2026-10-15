import type { Request } from "express";

import { permissionsService } from "../permissions/permissions.service";
import { cajaService, type CashContext } from "./caja.service";

/** Header con el token del equipo registrado como caja (lo guarda el navegador). */
export const CASH_TERMINAL_HEADER = "x-cash-terminal";

/** Construye el contexto de caja (equipo + caja.manage) de la petición. */
export async function cashContextFromRequest(req: Request): Promise<CashContext> {
  const raw = req.headers[CASH_TERMINAL_HEADER];
  const token = (Array.isArray(raw) ? raw[0] : raw)?.trim();

  const clientIp = req.ip ?? null;

  const [resolved, permissions] = await Promise.all([
    // Por token (navegador) o, si no hay, por la IP asignada al equipo.
    cajaService.resolveTerminal(req.activeCompany!.id, token || null, clientIp),
    permissionsService.getRolePermissions(req.auth!.role)
  ]);

  return {
    terminal: resolved?.terminal ?? null,
    terminalStatus: resolved?.status ?? "none",
    canManage: permissions.has("caja.manage"),
    clientIp
  };
}
