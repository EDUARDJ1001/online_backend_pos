import type { Request, Response } from "express";

import { auditService } from "../audit/audit.service";
import { inventoryService } from "../inventory/inventory.service";
import { permissionsService } from "../permissions/permissions.service";
import { AppError } from "../../utils/http-error";
import { productsService } from "./products.service";

export class ProductsController {
  async listCategories(req: Request, res: Response) {
    const result = await productsService.listCategories(req.activeCompany!.id, req.query as never);
    res.json(result);
  }

  async createCategory(req: Request, res: Response) {
    const category = await productsService.createCategory(req.activeCompany!.id, req.body);

    await auditService.log(
      {
        companyId: req.activeCompany!.id,
        userId: req.auth!.sub,
        entityType: "CATEGORIA_PRODUCTO",
        entityId: category.id,
        action: "CREAR",
        description: `Categoría ${category.name} creada.`,
        newValues: category
      },
      req
    );

    res.status(201).json({
      message: "Categoría creada correctamente.",
      item: category
    });
  }

  async updateCategory(req: Request, res: Response) {
    const before = await productsService.findCategoryOrFail(req.activeCompany!.id, Number(req.params.id));
    const category = await productsService.updateCategory(req.activeCompany!.id, Number(req.params.id), req.body);

    await auditService.log(
      {
        companyId: req.activeCompany!.id,
        userId: req.auth!.sub,
        entityType: "CATEGORIA_PRODUCTO",
        entityId: category.id,
        action: "ACTUALIZAR",
        description: `Categoría ${category.name} actualizada.`,
        oldValues: before,
        newValues: category
      },
      req
    );

    res.json({
      message: "Categoría actualizada correctamente.",
      item: category
    });
  }

  async updateCategoryStatus(req: Request, res: Response) {
    const before = await productsService.findCategoryOrFail(req.activeCompany!.id, Number(req.params.id));
    const category = await productsService.updateCategoryStatus(req.activeCompany!.id, Number(req.params.id), req.body.isActive);

    await auditService.log(
      {
        companyId: req.activeCompany!.id,
        userId: req.auth!.sub,
        entityType: "CATEGORIA_PRODUCTO",
        entityId: category.id,
        action: "CAMBIAR_ESTADO",
        description: `Estado de la categoría ${category.name} actualizado.`,
        oldValues: before,
        newValues: category
      },
      req
    );

    res.json({
      message: "Estado de la categoría actualizado correctamente.",
      item: category
    });
  }

  async list(req: Request, res: Response) {
    const result = await productsService.list(req.activeCompany!.id, req.query as never);
    res.json(result);
  }

  async nextCode(req: Request, res: Response) {
    const result = await productsService.getNextCode(req.activeCompany!.id);
    res.json({ item: result });
  }

  async create(req: Request, res: Response) {
    const companyId = req.activeCompany!.id;
    const { initialStock = 0, initialWarehouseId, ...payload } = req.body as { initialStock?: number; initialWarehouseId?: number | null };

    if (initialStock > 0 && !(await permissionsService.getRolePermissions(req.auth!.role)).has("inventory.adjust")) {
      throw new AppError("No tienes permisos para registrar existencias. Crea el producto sin existencia inicial.", 403);
    }

    let product = await productsService.create(companyId, req.auth!.sub, payload as never);

    // Existencia inicial en el mismo paso: si no se puede registrar, el producto
    // se deshace para no dejarlo creado sin stock (y evitar duplicados al reintentar).
    let movement: Awaited<ReturnType<typeof inventoryService.createAdjustment>> | null = null;
    if (initialStock > 0 && initialWarehouseId) {
      try {
        movement = await inventoryService.createAdjustment(companyId, req.auth!.sub, {
          warehouseId: initialWarehouseId,
          productId: product.id,
          adjustmentType: "STOCK_INICIAL",
          quantity: initialStock,
          unitCost: product.costPrice ? Number(product.costPrice) : undefined,
          notes: "Stock inicial al crear producto"
        });
        product = await productsService.findOrFail(companyId, product.id);
      } catch (error) {
        await productsService.discardNew(companyId, product.id).catch(() => undefined);
        throw error;
      }
    }

    await auditService.log(
      {
        companyId,
        userId: req.auth!.sub,
        entityType: "PRODUCTO",
        entityId: product.id,
        action: "CREAR",
        description: `Producto ${product.name} creado.`,
        newValues: product
      },
      req
    );

    if (movement) {
      await auditService.log(
        {
          companyId,
          userId: req.auth!.sub,
          entityType: "AJUSTE_INVENTARIO",
          entityId: movement.id,
          action: "APLICAR",
          description: `Stock inicial de ${movement.productName} registrado al crear el producto.`,
          newValues: movement
        },
        req
      );
    }

    res.status(201).json({
      message: movement ? "Producto creado con su existencia inicial." : "Producto creado correctamente.",
      item: product
    });
  }

  async getById(req: Request, res: Response) {
    const product = await productsService.findOrFail(req.activeCompany!.id, Number(req.params.id));
    res.json({ item: product });
  }

  async update(req: Request, res: Response) {
    const before = await productsService.findOrFail(req.activeCompany!.id, Number(req.params.id));
    const product = await productsService.update(req.activeCompany!.id, Number(req.params.id), req.body);

    await auditService.log(
      {
        companyId: req.activeCompany!.id,
        userId: req.auth!.sub,
        entityType: "PRODUCTO",
        entityId: product.id,
        action: "ACTUALIZAR",
        description: `Producto ${product.name} actualizado.`,
        oldValues: before,
        newValues: product
      },
      req
    );

    res.json({
      message: "Producto actualizado correctamente.",
      item: product
    });
  }

  async updateStatus(req: Request, res: Response) {
    const before = await productsService.findOrFail(req.activeCompany!.id, Number(req.params.id));
    const product = await productsService.updateStatus(req.activeCompany!.id, Number(req.params.id), req.body.isActive);

    await auditService.log(
      {
        companyId: req.activeCompany!.id,
        userId: req.auth!.sub,
        entityType: "PRODUCTO",
        entityId: product.id,
        action: "CAMBIAR_ESTADO",
        description: `Estado del producto ${product.name} actualizado.`,
        oldValues: before,
        newValues: product
      },
      req
    );

    res.json({
      message: "Estado del producto actualizado correctamente.",
      item: product
    });
  }
}

export const productsController = new ProductsController();
