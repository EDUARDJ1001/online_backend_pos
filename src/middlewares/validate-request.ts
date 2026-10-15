import type { NextFunction, Request, Response } from "express";
import type { ZodTypeAny } from "zod";

export function validateRequest(schema: ZodTypeAny, source: "body" | "query" | "params" = "body") {
  const middleware = (req: Request, _res: Response, next: NextFunction) => {
    req[source] = schema.parse(req[source]);
    next();
  };
  // La documentación (src/docs/openapi.ts) lee de aquí qué espera cada ruta.
  return Object.assign(middleware, { openapi: { schema, source } });
}
