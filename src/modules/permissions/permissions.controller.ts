import type { Request, Response } from "express";

import { auditService } from "../audit/audit.service";
import { CATALOG_BY_RESOURCE } from "./permissions.catalog";
import { permissionsService } from "./permissions.service";

export class PermissionsController {
  async listRoles(_req: Request, res: Response) {
    const items = await permissionsService.listRoles();

    res.json({ items });
  }

  async catalog(_req: Request, res: Response) {
    res.json({ groups: CATALOG_BY_RESOURCE });
  }

  async setPermissions(req: Request, res: Response) {
    const role = await permissionsService.setRolePermissions(Number(req.params.id), req.body.permissions);

    await auditService.log(
      {
        companyId: req.activeCompany?.id ?? null,
        userId: req.auth!.sub,
        entityType: "ROL",
        entityId: role.id,
        action: "ACTUALIZAR_PERMISOS",
        description: `Permisos del rol ${role.name} actualizados (${role.permissions.length}).`,
        newValues: role
      },
      req
    );

    res.json({
      message: "Permisos del rol actualizados correctamente.",
      item: role
    });
  }
}

export const permissionsController = new PermissionsController();
