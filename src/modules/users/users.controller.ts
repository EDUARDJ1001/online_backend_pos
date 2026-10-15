import type { Request, Response } from "express";

import { auditService } from "../audit/audit.service";
import { usersService, type Actor } from "./users.service";

function actorFrom(req: Request): Actor {
  return { id: req.auth!.sub, role: req.auth!.role };
}

export class UsersController {
  async list(req: Request, res: Response) {
    const actor = actorFrom(req);
    const result = await usersService.list(actor, req.activeCompany!.id, req.query as never);
    const inactiveCount = await usersService.countInactive(actor, req.activeCompany!.id);

    res.json({ ...result, inactiveCount });
  }

  async roles(req: Request, res: Response) {
    const items = await usersService.listRoles(actorFrom(req));

    res.json({ items });
  }

  async getById(req: Request, res: Response) {
    const user = await usersService.findOrFail(actorFrom(req), Number(req.params.id));

    res.json({ item: user });
  }

  async create(req: Request, res: Response) {
    const user = await usersService.create(actorFrom(req), req.body);

    await auditService.log(
      {
        companyId: req.activeCompany!.id,
        userId: req.auth!.sub,
        entityType: "USUARIO",
        entityId: user.id,
        action: "CREAR",
        description: `Usuario ${user.username} creado con rol ${user.role}.`,
        newValues: user
      },
      req
    );

    res.status(201).json({
      message: "Usuario creado correctamente.",
      item: user
    });
  }

  async update(req: Request, res: Response) {
    const actor = actorFrom(req);
    const before = await usersService.findOrFail(actor, Number(req.params.id));
    const user = await usersService.update(actor, Number(req.params.id), req.body);

    await auditService.log(
      {
        companyId: req.activeCompany!.id,
        userId: req.auth!.sub,
        entityType: "USUARIO",
        entityId: user.id,
        action: "ACTUALIZAR",
        description:
          before.role === user.role
            ? `Usuario ${user.username} actualizado.`
            : `Usuario ${user.username}: rol cambiado de ${before.role} a ${user.role}.`,
        oldValues: before,
        newValues: user
      },
      req
    );

    res.json({
      message: "Usuario actualizado correctamente.",
      item: user
    });
  }

  async updatePassword(req: Request, res: Response) {
    const user = await usersService.updatePassword(actorFrom(req), Number(req.params.id), req.body.password);

    await auditService.log(
      {
        companyId: req.activeCompany!.id,
        userId: req.auth!.sub,
        entityType: "USUARIO",
        entityId: user.id,
        action: "CAMBIAR_PASSWORD",
        description: `Contraseña de ${user.username} restablecida.`
      },
      req
    );

    res.json({
      message: "Contraseña actualizada correctamente.",
      item: user
    });
  }

  async updateStatus(req: Request, res: Response) {
    const actor = actorFrom(req);
    const before = await usersService.findOrFail(actor, Number(req.params.id));
    const user = await usersService.updateStatus(actor, Number(req.params.id), req.body.isActive);

    await auditService.log(
      {
        companyId: req.activeCompany!.id,
        userId: req.auth!.sub,
        entityType: "USUARIO",
        entityId: user.id,
        action: user.isActive ? "RESTAURAR" : "ELIMINAR",
        description: user.isActive ? `Usuario ${user.username} restaurado.` : `Usuario ${user.username} enviado a la papelera.`,
        oldValues: before,
        newValues: user
      },
      req
    );

    res.json({
      message: user.isActive ? "Usuario restaurado correctamente." : "Usuario enviado a la papelera.",
      item: user
    });
  }
}

export const usersController = new UsersController();
