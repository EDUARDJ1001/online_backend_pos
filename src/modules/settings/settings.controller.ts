import type { Request, Response } from "express";

import { auditService } from "../audit/audit.service";
import { settingsService } from "./settings.service";

export class SettingsController {
  async getBilling(req: Request, res: Response) {
    const settings = await settingsService.getBillingSettings(req.activeCompany!.id);

    res.json({
      item: settings
    });
  }

  async updateBilling(req: Request, res: Response) {
    const result = await settingsService.updateBillingSettings(req.activeCompany!.id, req.body);

    await auditService.log(
      {
        companyId: req.activeCompany!.id,
        userId: req.auth!.sub,
        entityType: "CONFIGURACION_FACTURACION",
        entityId: result.current.id,
        action: "ACTUALIZAR",
        description: "Configuración fiscal actualizada.",
        oldValues: result.previous,
        newValues: result.current
      },
      req
    );

    res.json({
      message: "Configuración fiscal actualizada correctamente.",
      item: result.current
    });
  }

  async listSeries(req: Request, res: Response) {
    const items = await settingsService.listBillingSeries(req.activeCompany!.id);

    res.json({
      items
    });
  }

  async getSeries(req: Request, res: Response) {
    const item = await settingsService.findSeriesOrFail(req.activeCompany!.id, Number(req.params.id));

    res.json({ item });
  }

  async createSeries(req: Request, res: Response) {
    const item = await settingsService.createBillingSeries(req.activeCompany!.id, req.body);

    await auditService.log(
      {
        companyId: req.activeCompany!.id,
        userId: req.auth!.sub,
        entityType: "SERIE_FACTURACION",
        entityId: item.id,
        action: "CREAR",
        description: `CAI ${item.cai} registrado para el rango ${item.firstNumber} a ${item.lastNumber}.`,
        newValues: item
      },
      req
    );

    res.status(201).json({
      message: "Serie de facturación registrada correctamente.",
      item
    });
  }

  async updateSeries(req: Request, res: Response) {
    const before = await settingsService.findSeriesOrFail(req.activeCompany!.id, Number(req.params.id));
    const item = await settingsService.updateBillingSeries(req.activeCompany!.id, Number(req.params.id), req.body);

    await auditService.log(
      {
        companyId: req.activeCompany!.id,
        userId: req.auth!.sub,
        entityType: "SERIE_FACTURACION",
        entityId: item.id,
        action: "ACTUALIZAR",
        description: `Serie ${item.prefix} actualizada.`,
        oldValues: before,
        newValues: item
      },
      req
    );

    res.json({
      message: "Serie de facturación actualizada correctamente.",
      item
    });
  }

  async updateSeriesStatus(req: Request, res: Response) {
    const before = await settingsService.findSeriesOrFail(req.activeCompany!.id, Number(req.params.id));
    const item = await settingsService.updateBillingSeriesStatus(req.activeCompany!.id, Number(req.params.id), req.body.isActive);

    await auditService.log(
      {
        companyId: req.activeCompany!.id,
        userId: req.auth!.sub,
        entityType: "SERIE_FACTURACION",
        entityId: item.id,
        action: item.isActive ? "ACTIVAR" : "DESACTIVAR",
        description: item.isActive
          ? `Serie ${item.prefix} activada. Las facturas nuevas usarán el CAI ${item.cai}.`
          : `Serie ${item.prefix} desactivada.`,
        oldValues: before,
        newValues: item
      },
      req
    );

    res.json({
      message: item.isActive ? "Serie activada correctamente." : "Serie desactivada correctamente.",
      item
    });
  }
}

export const settingsController = new SettingsController();
