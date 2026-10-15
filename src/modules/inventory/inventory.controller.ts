import type { Request, Response } from "express";

import { auditService } from "../audit/audit.service";
import { inventoryService } from "./inventory.service";

export class InventoryController {
  async stocks(req: Request, res: Response) {
    const result = await inventoryService.listStocks(req.activeCompany!.id, req.query as never);
    res.json(result);
  }

  async productWarehouses(req: Request, res: Response) {
    const items = await inventoryService.productStockByWarehouse(req.activeCompany!.id, Number(req.params.productId));
    res.json({ items });
  }

  async supplierOptions(req: Request, res: Response) {
    res.json({ items: await inventoryService.supplierOptions(req.activeCompany!.id) });
  }

  async movements(req: Request, res: Response) {
    const result = await inventoryService.listMovements(req.activeCompany!.id, req.query as never);
    res.json(result);
  }

  async entries(req: Request, res: Response) {
    const result = await inventoryService.listEntries(req.activeCompany!.id, req.query as never);
    res.json(result);
  }

  async entryDetail(req: Request, res: Response) {
    const item = await inventoryService.getEntryDetail(req.activeCompany!.id, Number(req.params.id));
    res.json({ item });
  }

  async createEntry(req: Request, res: Response) {
    const entry = await inventoryService.createEntry(req.activeCompany!.id, req.auth!.sub, req.body);

    await auditService.log(
      {
        companyId: req.activeCompany!.id,
        userId: req.auth!.sub,
        entityType: "ENTRADA_INVENTARIO",
        entityId: entry.id,
        action: "APLICAR",
        description: `Entrada de inventario ${entry.documentNumber ?? entry.id} aplicada.`,
        newValues: entry
      },
      req
    );

    res.status(201).json({
      message: "Entrada de inventario aplicada correctamente.",
      item: entry
    });
  }

  async createAdjustment(req: Request, res: Response) {
    const movement = await inventoryService.createAdjustment(req.activeCompany!.id, req.auth!.sub, req.body);

    await auditService.log(
      {
        companyId: req.activeCompany!.id,
        userId: req.auth!.sub,
        entityType: "AJUSTE_INVENTARIO",
        entityId: movement.id,
        action: "APLICAR",
        description: `Ajuste ${movement.movementType} aplicado a ${movement.productName}.`,
        newValues: movement
      },
      req
    );

    res.status(201).json({
      message: "Ajuste de inventario aplicado correctamente.",
      item: movement
    });
  }
}

export const inventoryController = new InventoryController();
