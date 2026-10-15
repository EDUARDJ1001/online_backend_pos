import type { Request, Response } from "express";

import { AppError } from "../../utils/http-error";
import { auditService } from "../audit/audit.service";
import { writeCashClosePdf } from "./caja-pdf";
import { cashContextFromRequest } from "./caja.context";
import { cajaService } from "./caja.service";
import { canManageDeactivated } from "../../middlewares/deactivation.middleware";

class CajaController {
  async overview(req: Request, res: Response) {
    const result = await cajaService.overview(req.activeCompany!.id, await cashContextFromRequest(req));
    res.json(result);
  }

  async listRegisters(req: Request, res: Response) {
    const items = await cajaService.listRegisters(req.activeCompany!.id, true);
    res.json({ items });
  }

  async createRegister(req: Request, res: Response) {
    const item = await cajaService.createRegister(req.activeCompany!.id, req.body.name);
    res.status(201).json({ item });
  }

  async updateRegister(req: Request, res: Response) {
    if (req.body.isActive !== undefined && !canManageDeactivated(req.auth?.role)) {
      throw new AppError("Solo un administrador puede desactivar o restaurar cajas.", 403);
    }
    const items = await cajaService.updateRegister(req.activeCompany!.id, Number(req.params.id), req.body);
    res.json({ items });
  }

  async open(req: Request, res: Response) {
    const result = await cajaService.open(req.activeCompany!.id, req.auth!.sub, await cashContextFromRequest(req), req.body);

    await auditService.log({
      companyId: req.activeCompany!.id,
      userId: req.auth!.sub,
      entityType: "CAJA",
      entityId: result.session.id,
      action: "APERTURA",
      description: `Apertura de ${result.session.registerName ?? "caja"} con fondo L${result.session.openingAmount.toFixed(2)}.`,
      newValues: { register: result.session.registerName, openingAmount: result.session.openingAmount }
    });

    res.status(201).json(result);
  }

  async close(req: Request, res: Response) {
    const result = await cajaService.close(req.activeCompany!.id, req.auth!.sub, await cashContextFromRequest(req), req.body);

    await auditService.log({
      companyId: req.activeCompany!.id,
      userId: req.auth!.sub,
      entityType: "CAJA",
      entityId: result.session.id,
      action: "CIERRE",
      description: `Cierre de ${result.session.registerName ?? "caja"}. Esperado L${(result.session.expectedAmount ?? 0).toFixed(2)}, contado L${(result.session.countedAmount ?? 0).toFixed(2)}, diferencia L${(result.session.difference ?? 0).toFixed(2)}.`,
      newValues: {
        register: result.session.registerName,
        expected: result.session.expectedAmount,
        counted: result.session.countedAmount,
        difference: result.session.difference
      }
    });

    res.json(result);
  }

  async move(req: Request, res: Response) {
    const result = await cajaService.addManualMovement(req.activeCompany!.id, req.auth!.sub, await cashContextFromRequest(req), req.body);
    res.status(201).json(result);
  }

  async list(req: Request, res: Response) {
    const result = await cajaService.listSessions(req.activeCompany!.id, req.query as never);
    res.json(result);
  }

  async getById(req: Request, res: Response) {
    const result = await cajaService.getSessionDetail(req.activeCompany!.id, Number(req.params.id));
    res.json(result);
  }

  async listTerminals(req: Request, res: Response) {
    const items = await cajaService.listTerminals(req.activeCompany!.id);
    res.json({ items });
  }

  async registerTerminal(req: Request, res: Response) {
    const result = await cajaService.registerTerminal(req.activeCompany!.id, req.auth!.sub, req.body, req.ip ?? null);

    await auditService.log({
      companyId: req.activeCompany!.id,
      userId: req.auth!.sub,
      entityType: "CAJA",
      entityId: result.terminal.id,
      action: "REGISTRO_EQUIPO",
      description: `Equipo "${result.terminal.name}" registrado en ${result.terminal.registerName}.`,
      newValues: { terminal: result.terminal.name, register: result.terminal.registerName }
    });

    res.status(201).json(result);
  }

  async listNetworks(req: Request, res: Response) {
    res.json(await cajaService.listNetworks(req.activeCompany!.id, req.ip ?? null));
  }

  async addNetwork(req: Request, res: Response) {
    const result = await cajaService.addNetwork(req.activeCompany!.id, req.auth!.sub, req.body, req.ip ?? null);

    await auditService.log(
      {
        companyId: req.activeCompany!.id,
        userId: req.auth!.sub,
        entityType: "CAJA",
        action: "AUTORIZA_RED",
        description: `Red autorizada para caja: ${req.body.cidr}.`,
        newValues: req.body
      },
      req
    );

    res.status(201).json(result);
  }

  async removeNetwork(req: Request, res: Response) {
    const result = await cajaService.removeNetwork(req.activeCompany!.id, Number(req.params.id), req.ip ?? null);

    await auditService.log(
      {
        companyId: req.activeCompany!.id,
        userId: req.auth!.sub,
        entityType: "CAJA",
        entityId: Number(req.params.id),
        action: "QUITA_RED",
        description: "Red autorizada para caja eliminada."
      },
      req
    );

    res.json(result);
  }

  async createPairing(req: Request, res: Response) {
    const result = await cajaService.createPairingCode(req.activeCompany!.id, req.auth!.sub, Number(req.params.id), req.body.name);

    await auditService.log({
      companyId: req.activeCompany!.id,
      userId: req.auth!.sub,
      entityType: "CAJA",
      entityId: Number(req.params.id),
      action: "CODIGO_VINCULACION",
      description: `Código de vinculación generado para ${result.registerName}.`
    });

    res.status(201).json(result);
  }

  async redeemPairing(req: Request, res: Response) {
    const result = await cajaService.redeemPairingCode(req.activeCompany!.id, req.body, req.ip ?? null);

    await auditService.log({
      companyId: req.activeCompany!.id,
      userId: req.auth!.sub,
      entityType: "CAJA",
      entityId: result.terminal.id,
      action: "VINCULA_EQUIPO",
      description: `Equipo "${result.terminal.name}" vinculado a ${result.terminal.registerName} con código.`,
      newValues: { terminal: result.terminal.name, register: result.terminal.registerName }
    });

    res.status(201).json(result);
  }

  async registerTerminalByIp(req: Request, res: Response) {
    const result = await cajaService.registerTerminalByIp(req.activeCompany!.id, req.auth!.sub, req.body);

    await auditService.log(
      {
        companyId: req.activeCompany!.id,
        userId: req.auth!.sub,
        entityType: "CAJA",
        entityId: result.terminal.id,
        action: "REGISTRO_EQUIPO_IP",
        description: `Equipo "${result.terminal.name}" (IP ${result.terminal.boundIp}) asignado a ${result.terminal.registerName}.`,
        newValues: { terminal: result.terminal.name, register: result.terminal.registerName, ip: result.terminal.boundIp }
      },
      req
    );

    res.status(201).json(result);
  }

  async deleteTerminal(req: Request, res: Response) {
    const result = await cajaService.deleteTerminal(req.activeCompany!.id, Number(req.params.id));

    await auditService.log(
      {
        companyId: req.activeCompany!.id,
        userId: req.auth!.sub,
        entityType: "CAJA",
        entityId: Number(req.params.id),
        action: "ELIMINA_EQUIPO",
        description: `Equipo de caja "${result.name}" eliminado.`
      },
      req
    );

    res.json({ items: result.items });
  }

  async updateTerminal(req: Request, res: Response) {
    const items = await cajaService.updateTerminal(req.activeCompany!.id, Number(req.params.id), req.body);

    await auditService.log({
      companyId: req.activeCompany!.id,
      userId: req.auth!.sub,
      entityType: "CAJA",
      entityId: Number(req.params.id),
      action: req.body.isActive === false ? "REVOCA_EQUIPO" : "EDITA_EQUIPO",
      description: req.body.isActive === false ? "Equipo de caja revocado." : "Equipo de caja actualizado.",
      newValues: req.body
    });

    res.json({ items });
  }

  async pdf(req: Request, res: Response) {
    const detail = await cajaService.getSessionDetail(req.activeCompany!.id, Number(req.params.id));

    if (detail.session.status !== "CERRADA") {
      throw new AppError("El reporte de cierre solo está disponible para cajas cerradas.", 400);
    }

    writeCashClosePdf(req.activeCompany!, detail, res);
  }
}

export const cajaController = new CajaController();
