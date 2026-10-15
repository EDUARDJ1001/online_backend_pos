import type { Request, Response } from "express";

import { auditService } from "../audit/audit.service";
import { warehousesService } from "./warehouses.service";

export class WarehousesController {
  async list(req: Request, res: Response) {
    const result = await warehousesService.list(req.activeCompany!.id, req.query as never);
    res.json(result);
  }

  async create(req: Request, res: Response) {
    const warehouse = await warehousesService.create(req.activeCompany!.id, req.body);

    await auditService.log(
      {
        companyId: req.activeCompany!.id,
        userId: req.auth!.sub,
        entityType: "BODEGA",
        entityId: warehouse.id,
        action: "CREAR",
        description: `Bodega ${warehouse.name} creada.`,
        newValues: warehouse
      },
      req
    );

    res.status(201).json({
      message: "Bodega creada correctamente.",
      item: warehouse
    });
  }

  async getById(req: Request, res: Response) {
    const warehouse = await warehousesService.findOrFail(req.activeCompany!.id, Number(req.params.id));
    res.json({ item: warehouse });
  }

  async update(req: Request, res: Response) {
    const before = await warehousesService.findOrFail(req.activeCompany!.id, Number(req.params.id));
    const warehouse = await warehousesService.update(req.activeCompany!.id, Number(req.params.id), req.body);

    await auditService.log(
      {
        companyId: req.activeCompany!.id,
        userId: req.auth!.sub,
        entityType: "BODEGA",
        entityId: warehouse.id,
        action: "ACTUALIZAR",
        description: `Bodega ${warehouse.name} actualizada.`,
        oldValues: before,
        newValues: warehouse
      },
      req
    );

    res.json({
      message: "Bodega actualizada correctamente.",
      item: warehouse
    });
  }

  async updateStatus(req: Request, res: Response) {
    const before = await warehousesService.findOrFail(req.activeCompany!.id, Number(req.params.id));
    const warehouse = await warehousesService.updateStatus(req.activeCompany!.id, Number(req.params.id), req.body.isActive);

    await auditService.log(
      {
        companyId: req.activeCompany!.id,
        userId: req.auth!.sub,
        entityType: "BODEGA",
        entityId: warehouse.id,
        action: "CAMBIAR_ESTADO",
        description: `Estado de la bodega ${warehouse.name} actualizado.`,
        oldValues: before,
        newValues: warehouse
      },
      req
    );

    res.json({
      message: "Estado de la bodega actualizado correctamente.",
      item: warehouse
    });
  }
}

export const warehousesController = new WarehousesController();
