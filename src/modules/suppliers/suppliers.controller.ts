import type { Request, Response } from "express";

import { auditService } from "../audit/audit.service";
import { suppliersService } from "./suppliers.service";

export class SuppliersController {
  async list(req: Request, res: Response) {
    const result = await suppliersService.list(req.activeCompany!.id, req.query as never);

    res.json(result);
  }

  async create(req: Request, res: Response) {
    const supplier = await suppliersService.create(req.activeCompany!.id, req.auth!.sub, req.body);

    await auditService.log(
      {
        companyId: req.activeCompany!.id,
        userId: req.auth!.sub,
        entityType: "PROVEEDOR",
        entityId: supplier.id,
        action: "CREAR",
        description: `Proveedor ${supplier.name} creado.`,
        newValues: supplier
      },
      req
    );

    res.status(201).json({
      message: "Proveedor creado correctamente.",
      item: supplier
    });
  }

  async getById(req: Request, res: Response) {
    const supplier = await suppliersService.findOrFail(req.activeCompany!.id, Number(req.params.id));

    res.json({ item: supplier });
  }

  async update(req: Request, res: Response) {
    const before = await suppliersService.findOrFail(req.activeCompany!.id, Number(req.params.id));
    const supplier = await suppliersService.update(req.activeCompany!.id, Number(req.params.id), req.body);

    await auditService.log(
      {
        companyId: req.activeCompany!.id,
        userId: req.auth!.sub,
        entityType: "PROVEEDOR",
        entityId: supplier.id,
        action: "ACTUALIZAR",
        description: `Proveedor ${supplier.name} actualizado.`,
        oldValues: before,
        newValues: supplier
      },
      req
    );

    res.json({
      message: "Proveedor actualizado correctamente.",
      item: supplier
    });
  }

  async updateStatus(req: Request, res: Response) {
    const before = await suppliersService.findOrFail(req.activeCompany!.id, Number(req.params.id));
    const supplier = await suppliersService.updateStatus(req.activeCompany!.id, Number(req.params.id), req.body.isActive);

    await auditService.log(
      {
        companyId: req.activeCompany!.id,
        userId: req.auth!.sub,
        entityType: "PROVEEDOR",
        entityId: supplier.id,
        action: "CAMBIAR_ESTADO",
        description: `Estado del proveedor ${supplier.name} actualizado.`,
        oldValues: before,
        newValues: supplier
      },
      req
    );

    res.json({
      message: "Estado del proveedor actualizado correctamente.",
      item: supplier
    });
  }
}

export const suppliersController = new SuppliersController();
