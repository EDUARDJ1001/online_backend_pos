import type { Request, Response } from "express";

import { auditService } from "../audit/audit.service";
import { clientsService } from "./clients.service";

export class ClientsController {
  async list(req: Request, res: Response) {
    const result = await clientsService.list(req.activeCompany!.id, req.query as never);

    res.json(result);
  }

  async create(req: Request, res: Response) {
    const client = await clientsService.create(req.activeCompany!.id, req.auth!.sub, req.body);

    await auditService.log(
      {
        companyId: req.activeCompany!.id,
        userId: req.auth!.sub,
        entityType: "CLIENTE",
        entityId: client.id,
        action: "CREAR",
        description: `Cliente ${client.name} creado.`,
        newValues: client
      },
      req
    );

    res.status(201).json({
      message: "Cliente creado correctamente.",
      item: client
    });
  }

  async getById(req: Request, res: Response) {
    const client = await clientsService.findOrFail(req.activeCompany!.id, Number(req.params.id));

    res.json({
      item: client
    });
  }

  async summary(req: Request, res: Response) {
    const result = await clientsService.summary(req.activeCompany!.id, Number(req.params.id));
    res.json(result);
  }

  async update(req: Request, res: Response) {
    const before = await clientsService.findOrFail(req.activeCompany!.id, Number(req.params.id));
    const client = await clientsService.update(req.activeCompany!.id, Number(req.params.id), req.body);

    await auditService.log(
      {
        companyId: req.activeCompany!.id,
        userId: req.auth!.sub,
        entityType: "CLIENTE",
        entityId: client.id,
        action: "ACTUALIZAR",
        description: `Cliente ${client.name} actualizado.`,
        oldValues: before,
        newValues: client
      },
      req
    );

    res.json({
      message: "Cliente actualizado correctamente.",
      item: client
    });
  }

  async updateStatus(req: Request, res: Response) {
    const before = await clientsService.findOrFail(req.activeCompany!.id, Number(req.params.id));
    const client = await clientsService.updateStatus(req.activeCompany!.id, Number(req.params.id), req.body.isActive);

    await auditService.log(
      {
        companyId: req.activeCompany!.id,
        userId: req.auth!.sub,
        entityType: "CLIENTE",
        entityId: client.id,
        action: "CAMBIAR_ESTADO",
        description: `Estado del cliente ${client.name} actualizado.`,
        oldValues: before,
        newValues: client
      },
      req
    );

    res.json({
      message: "Estado del cliente actualizado correctamente.",
      item: client
    });
  }
}

export const clientsController = new ClientsController();
