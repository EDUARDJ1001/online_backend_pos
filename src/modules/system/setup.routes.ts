import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";

import { isDbConfigured, pingDatabase } from "../../config/db";
import { validateRequest } from "../../middlewares/validate-request";
import { asyncHandler } from "../../utils/async-handler";
import { AppError } from "../../utils/http-error";
import { databaseSchema } from "./database.schemas";
import { databaseService } from "./database.service";
import { isTechnician, technicianLogin } from "./technician";

/**
 * Conexión a la base de datos sin iniciar sesión, desde la pantalla "Conectar base de datos":
 *   - Configuración inicial: todavía no hay base configurada.
 *   - Recuperación: la base configurada no responde (servidor cambiado, contraseña
 *     cambiada...). Sin base no se puede iniciar sesión para usar Sistema > Base de datos.
 * Solo desde la misma PC. El cambio se guarda solo si la conexión nueva funciona, así que
 * hace falta conocer datos válidos de una base. Con la base respondiendo, la conexión se
 * cambia en Sistema > Base de datos (SUPERADMIN), o con el acceso de técnico (technician.ts).
 */
export const setupRouter = Router();

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const PING_TIMEOUT_MS = 4000;

function isLocal(req: Request) {
  return LOOPBACK.has(req.socket.remoteAddress ?? "");
}

function requireSetupMode(req: Request, _res: Response, next: NextFunction) {
  if (!isLocal(req)) {
    return next(new AppError("La conexión a la base de datos solo se puede cambiar desde la PC donde está instalado el sistema.", 403));
  }
  if (!isDbConfigured() || isTechnician(req)) {
    return next();
  }
  void pingDatabase(PING_TIMEOUT_MS).then((connected) =>
    next(connected ? new AppError("La base de datos responde. Para cambiar la conexión usa Sistema > Base de datos.", 403) : undefined)
  );
}

setupRouter.get(
  "/status",
  asyncHandler(async (req, res) => {
    const configured = isDbConfigured();
    const connected = configured ? await pingDatabase(PING_TIMEOUT_MS) : false;
    const local = isLocal(req);
    res.json({
      configured,
      connected,
      local,
      // Recuperación: datos actuales para corregir solo lo que cambió (nunca la contraseña).
      settings: configured && local && (!connected || isTechnician(req)) ? databaseService.currentSettings() : undefined,
      technician: local && isTechnician(req)
    });
  })
);

/** Acceso de técnico (Ctrl + Shift + F9): clave que solo conoce el desarrollador. */
setupRouter.post(
  "/tecnico",
  validateRequest(z.object({ clave: z.string().min(1).max(200) })),
  (req, res, next) => {
    if (!isLocal(req)) {
      return next(new AppError("Este acceso solo funciona en la PC donde está instalado el sistema.", 403));
    }
    const result = technicianLogin((req.body as { clave: string }).clave);
    if (result.ok) {
      return res.json({ token: result.token });
    }
    const message =
      result.reason === "locked"
        ? `Demasiados intentos. Espera ${result.minutes} ${result.minutes === 1 ? "minuto" : "minutos"}.`
        : result.reason === "disabled"
          ? "Acceso no disponible."
          : "Clave incorrecta.";
    return next(new AppError(message, 403));
  }
);

setupRouter.post(
  "/test",
  requireSetupMode,
  validateRequest(databaseSchema),
  asyncHandler(async (req, res) => {
    res.json(await databaseService.test(req.body));
  })
);

setupRouter.post(
  "/apply",
  requireSetupMode,
  validateRequest(databaseSchema),
  asyncHandler(async (req, res) => {
    const recovering = isDbConfigured();
    const technician = isTechnician(req);
    // Una base vacía se prepara solo si el usuario lo confirmó en la pantalla.
    const result = await databaseService.apply({ ...req.body, initialize: Boolean(req.body.initialize) });
    const target = `${result.settings.user}@${result.settings.host}:${result.settings.port}/${result.settings.database}`;
    console.log(
      technician
        ? `[técnico] Conexión cambiada con el acceso de técnico: ${target}`
        : recovering
          ? `[conexión] La base no respondía; conexión cambiada desde esta PC: ${target}`
          : `[configuración inicial] Base conectada: ${target}`
    );
    res.json(result);
  })
);
