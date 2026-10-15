import type { Request, Response } from "express";

import { databaseService } from "./database.service";
import { schemaReport } from "./schema-check";

class DatabaseController {
  async status(_req: Request, res: Response) {
    res.json(await databaseService.status());
  }

  /** Solo lectura: compara la estructura de la base con la que espera esta versión. */
  async structure(_req: Request, res: Response) {
    res.json(await schemaReport());
  }

  async test(req: Request, res: Response) {
    res.json(await databaseService.test(req.body));
  }

  async migrate(req: Request, res: Response) {
    const result = await databaseService.migrate();
    console.log(`[system] Actualizaciones de la base aplicadas por usuario ${req.auth!.sub}: ${result.applied.join(", ") || "ninguna"}${result.blocked.length ? " (detenidas por seguridad)" : ""}`);
    res.json(result);
  }

  async apply(req: Request, res: Response) {
    const result = await databaseService.apply(req.body);
    console.log(
      `[system] Base de datos cambiada por usuario ${req.auth!.sub}: ${result.settings.user}@${result.settings.host}:${result.settings.port}/${result.settings.database}`
    );
    res.json(result);
  }
}

export const databaseController = new DatabaseController();
