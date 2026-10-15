import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

import { isDbConnectionError } from "../config/db";
import { describeValidationError } from "../config/zod-es";
import { AppError } from "../utils/http-error";

export function notFoundHandler(_req: Request, _res: Response, next: NextFunction) {
  next(new AppError("La ruta solicitada no existe.", 404));
}

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (error instanceof ZodError) {
    // Mensaje claro con el campo, p. ej. "Modelo: Máximo 60 caracteres."
    return res.status(422).json({
      message: describeValidationError(error)
    });
  }

  if (error instanceof AppError) {
    return res.status(error.statusCode).json({
      message: error.message,
      details: error.details ?? null
    });
  }

  // Sin base configurada: el frontend lleva a la pantalla "Conectar base de datos".
  if ((error as { code?: string }).code === "DB_NOT_CONFIGURED") {
    return res.status(503).json({
      message: "La base de datos no está configurada.",
      details: { code: "DB_NOT_CONFIGURED" }
    });
  }

  // Sin comunicación con la base de datos: el frontend lo muestra como aviso general.
  if (isDbConnectionError(error)) {
    console.error("[base de datos] sin conexión:", (error as Error).message);
    return res.status(503).json({
      message: "No hay conexión con la base de datos. Intenta de nuevo en unos momentos.",
      details: { code: "DB_UNAVAILABLE" }
    });
  }

  // Error no previsto (base de datos, código): se registra completo en el servidor
  // y al usuario se le muestra un mensaje claro, sin detalles técnicos.
  console.error("[error]", error);

  return res.status(500).json({
    message: "No se pudo completar la operación. Intenta de nuevo y, si continúa, avisa al administrador."
  });
}
