import type { ResultSetHeader, RowDataPacket } from "mysql2";

import { dbPool, type DbConnection, withTransaction, isMssql } from "../../config/db";
import { padProductCodes, productCodeSearchTerm } from "../../utils/product-code";
import { AppError } from "../../utils/http-error";
import { resolvePagination } from "../../utils/pagination";
import { productsService } from "../products/products.service";
import { suppliersService } from "../suppliers/suppliers.service";
import { warehousesService } from "../warehouses/warehouses.service";
import { isCountableUnit, todayInHonduras } from "./inventory-rules";

type MovementType = "STOCK_INICIAL" | "ENTRADA" | "SALIDA" | "AJUSTE_POSITIVO" | "AJUSTE_NEGATIVO" | "VENTA" | "ANULACION_VENTA";
type SourceType = "MANUAL" | "ENTRADA" | "FACTURA" | "AJUSTE";

interface StockRow extends RowDataPacket {
  productId: number;
  productCode: string;
  productName: string;
  imageUrl: string | null;
  productType: "PRODUCTO" | "SERVICIO";
  categoryName: string | null;
  warehouseId: number | null;
  warehouseCode: string | null;
  warehouseName: string | null;
  stockQuantity: number;
  minStock: number;
  unitMeasure: string;
  salePrice: number;
  costPrice: number;
}

interface StockSummaryRow extends RowDataPacket {
  totalItems: number;
  totalCost: number;
}

interface MovementRow extends RowDataPacket {
  /** Proveedor (entradas) o cliente (ventas) del movimiento. */
  supplierName: string | null;
  customerName: string | null;
  id: number;
  companyId: number;
  productId: number;
  productCode: string;
  productName: string;
  warehouseId: number;
  warehouseName: string;
  movementType: MovementType;
  sourceType: SourceType;
  invoiceId: number | null;
  invoiceNumber: string | null;
  entryId: number | null;
  entryDocumentNumber: string | null;
  quantity: number;
  unitCost: number | null;
  unitPrice: number | null;
  stockBefore: number;
  stockAfter: number;
  notes: string | null;
  createdBy: number;
  createdByName: string;
  createdAt: string;
}

interface EntryRow extends RowDataPacket {
  supplierId: number | null;
  id: number;
  companyId: number;
  warehouseId: number;
  warehouseName: string;
  entryDate: string;
  supplierName: string | null;
  documentNumber: string | null;
  notes: string | null;
  status: "BORRADOR" | "APLICADA" | "ANULADA";
  itemCount: number;
  totalCost: number;
  createdBy: number;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

interface EntryItemRow extends RowDataPacket {
  id: number;
  entryId: number;
  productId: number;
  productCode: string;
  productName: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  createdAt: string;
}

interface StockLockRow extends RowDataPacket {
  id: number;
  stockQuantity: number;
}

interface ProductForStockRow extends RowDataPacket {
  id: number;
  name: string;
  code: string;
  type: "PRODUCTO" | "SERVICIO";
  controlsStock: number;
  isActive: number;
  unitMeasure: string;
  costPrice: number;
}

type EntryPayload = {
  warehouseId: number;
  entryDate: string;
  supplierId?: number | null;
  supplierName?: string;
  documentNumber?: string;
  notes?: string;
  items: Array<{
    productId: number;
    quantity: number;
    unitCost: number;
  }>;
};

type StockAdjustmentPayload = {
  warehouseId: number;
  productId: number;
  adjustmentType: "AJUSTE_POSITIVO" | "AJUSTE_NEGATIVO" | "STOCK_INICIAL";
  quantity: number;
  unitCost?: number;
  notes: string;
};

type InvoiceStockItem = {
  productId: number;
  invoiceItemId: number;
  productName: string;
  quantity: number;
  unitCost: number | null;
  unitPrice: number;
};

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

class InventoryService {
  private normalizeNullable(value?: string | null) {
    return value?.trim() ? value.trim() : null;
  }

  private async findProductForStock(connection: DbConnection, companyId: number, productId: number) {
    const [rows] = await connection.query<ProductForStockRow[]>(
      `SELECT
        id,
        code,
        name,
        type,
        controls_stock AS controlsStock,
        is_active AS isActive,
        unit_measure AS unitMeasure,
        cost_price AS costPrice
      FROM products
      WHERE company_id = ? AND id = ?
      LIMIT 1`,
      [companyId, productId]
    );

    const product = rows[0];

    if (!product) {
      throw new AppError("Producto no encontrado para la empresa activa.", 404);
    }

    if (product.type === "SERVICIO" || !product.controlsStock) {
      throw new AppError(`El producto ${product.name} no controla inventario.`, 400);
    }

    return product;
  }

  /** Para entradas y ajustes: el producto debe estar activo y la cantidad ser coherente con su unidad. */
  private assertProductMovable(product: ProductForStockRow, quantity: number) {
    if (!product.isActive) {
      throw new AppError(`El producto ${product.name} está inactivo.`, 400);
    }

    if (isCountableUnit(product.unitMeasure) && !Number.isInteger(quantity)) {
      throw new AppError(`${product.name} se mide en ${product.unitMeasure}: la cantidad debe ser un número entero.`, 400);
    }
  }

  private async assertActiveWarehouse(companyId: number, warehouseId: number) {
    const warehouse = await warehousesService.findOrFail(companyId, warehouseId);

    if (!warehouse.isActive) {
      throw new AppError(`La bodega ${warehouse.name} está inactiva.`, 400);
    }

    return warehouse;
  }

  private async lockStock(connection: DbConnection, companyId: number, productId: number, warehouseId: number) {
    if (isMssql()) {
      await connection.execute(
        `INSERT INTO product_stocks (company_id, product_id, warehouse_id, stock_quantity)
         SELECT ?, ?, ?, 0.00
         WHERE NOT EXISTS (
           SELECT 1 FROM product_stocks WITH (UPDLOCK, HOLDLOCK)
           WHERE company_id = ? AND product_id = ? AND warehouse_id = ?
         )`,
        [companyId, productId, warehouseId, companyId, productId, warehouseId]
      );
    } else {
      await connection.execute(
        `INSERT IGNORE INTO product_stocks (company_id, product_id, warehouse_id, stock_quantity)
         VALUES (?, ?, ?, 0.00)`,
        [companyId, productId, warehouseId]
      );
    }

    const [rows] = await connection.query<StockLockRow[]>(
      `SELECT id, stock_quantity AS stockQuantity
       FROM product_stocks
       WHERE company_id = ? AND product_id = ? AND warehouse_id = ?
       LIMIT 1
       FOR UPDATE`,
      [companyId, productId, warehouseId]
    );

    const stock = rows[0];

    if (!stock) {
      throw new AppError("No fue posible bloquear el stock del producto.", 500);
    }

    return stock;
  }

  private async applyStockChange(
    connection: DbConnection,
    params: {
      companyId: number;
      productId: number;
      warehouseId: number;
      movementType: MovementType;
      sourceType: SourceType;
      quantity: number;
      direction: "IN" | "OUT";
      userId: number;
      unitCost?: number | null;
      unitPrice?: number | null;
      notes?: string | null;
      invoiceId?: number | null;
      invoiceItemId?: number | null;
      entryId?: number | null;
      entryItemId?: number | null;
      productName?: string;
    }
  ) {
    const stock = await this.lockStock(connection, params.companyId, params.productId, params.warehouseId);
    const stockBefore = Number(stock.stockQuantity);
    const signedQuantity = params.direction === "IN" ? params.quantity : -params.quantity;
    const stockAfter = round2(stockBefore + signedQuantity);

    if (params.direction === "OUT" && stockAfter < 0) {
      throw new AppError(`Stock insuficiente para ${params.productName ?? "el producto seleccionado"}. Disponible: ${stockBefore}.`, 409);
    }

    await connection.execute(
      `UPDATE product_stocks
       SET stock_quantity = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [stockAfter, stock.id]
    );

    const [result] = await connection.execute<ResultSetHeader>(
      `INSERT INTO inventory_movements (
        company_id,
        product_id,
        warehouse_id,
        movement_type,
        source_type,
        invoice_id,
        invoice_item_id,
        entry_id,
        entry_item_id,
        quantity,
        unit_cost,
        unit_price,
        stock_before,
        stock_after,
        notes,
        created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        params.companyId,
        params.productId,
        params.warehouseId,
        params.movementType,
        params.sourceType,
        params.invoiceId ?? null,
        params.invoiceItemId ?? null,
        params.entryId ?? null,
        params.entryItemId ?? null,
        round2(params.quantity),
        // Columnas NOT NULL: sin dato se guarda 0 (p. ej. ajustes y entradas no tienen precio de venta).
        params.unitCost ?? 0,
        params.unitPrice ?? 0,
        stockBefore,
        stockAfter,
        params.notes ?? null,
        params.userId
      ]
    );

    return result.insertId;
  }

  async listStocks(companyId: number, query: { search?: string; warehouseId?: number; lowStock?: boolean; page?: number; pageSize?: number }) {
    const pagination = resolvePagination(query.page, query.pageSize);
    const params: Array<string | number> = [];
    const conditions = ["p.company_id = ?", "p.controls_stock = 1"];

    if (query.warehouseId) {
      await warehousesService.findOrFail(companyId, query.warehouseId);
      params.push(query.warehouseId);
    }

    params.push(companyId);

    if (query.search) {
      conditions.push("(p.name LIKE ? OR p.code LIKE ? OR p.code LIKE ? OR p.barcode LIKE ?)");
      const search = `%${query.search}%`;
      params.push(search, search, `%${productCodeSearchTerm(query.search)}%`, search);
    }

    const stockExpression = query.warehouseId ? "COALESCE(ps.stock_quantity, 0)" : "COALESCE(ps.stockQuantity, 0)";

    if (query.lowStock) {
      conditions.push(`${stockExpression} <= p.min_stock`);
    }

    const whereClause = conditions.join(" AND ");
    const fromClause = query.warehouseId
      ? `FROM products p
         INNER JOIN warehouses w ON w.company_id = p.company_id AND w.id = ?
         LEFT JOIN product_categories pc ON pc.id = p.category_id
         LEFT JOIN product_stocks ps ON ps.product_id = p.id AND ps.warehouse_id = w.id`
      : `FROM products p
         LEFT JOIN product_categories pc ON pc.id = p.category_id
         LEFT JOIN (
          SELECT product_id, SUM(stock_quantity) AS stockQuantity
          FROM product_stocks
          GROUP BY product_id
         ) ps ON ps.product_id = p.id`;

    const [items] = await dbPool.query<StockRow[]>(
      `SELECT
        p.id AS productId,
        p.code AS productCode,
        p.name AS productName,
        p.image_url AS imageUrl,
        p.type AS productType,
        pc.name AS categoryName,
        ${query.warehouseId ? "w.id" : "NULL"} AS warehouseId,
        ${query.warehouseId ? "w.code" : "NULL"} AS warehouseCode,
        ${query.warehouseId ? "w.name" : "NULL"} AS warehouseName,
        ${stockExpression} AS stockQuantity,
        p.min_stock AS minStock,
        p.unit_measure AS unitMeasure,
        p.sale_price AS salePrice,
        p.cost_price AS costPrice
      ${fromClause}
      WHERE ${whereClause}
      ORDER BY p.id DESC
      LIMIT ? OFFSET ?`,
      [...params, pagination.pageSize, pagination.offset]
    );

    const [countRows] = await dbPool.query<Array<RowDataPacket & { total: number }>>(
      `SELECT COUNT(*) AS total
       ${fromClause}
       WHERE ${whereClause}`,
      params
    );

    const [summaryRows] = await dbPool.query<StockSummaryRow[]>(
      `SELECT
        COALESCE(SUM(${stockExpression}), 0) AS totalItems,
        COALESCE(SUM(${stockExpression} * p.cost_price), 0) AS totalCost
       ${fromClause}
       WHERE ${whereClause}`,
      params
    );

    return {
      items: padProductCodes(items),
      summary: {
        totalItems: Number(summaryRows[0]?.totalItems ?? 0),
        totalCost: Number(summaryRows[0]?.totalCost ?? 0)
      },
      pagination: {
        page: pagination.page,
        pageSize: pagination.pageSize,
        total: countRows[0]?.total ?? 0
      }
    };
  }

  /** Existencia de un producto en cada bodega activa (0 si nunca tuvo movimientos ahí). */
  async productStockByWarehouse(companyId: number, productId: number) {
    await productsService.findOrFail(companyId, productId);

    const [rows] = await dbPool.query<Array<RowDataPacket & { warehouseId: number; warehouseCode: string; warehouseName: string; isDefault: number; stockQuantity: number }>>(
      `SELECT
        w.id AS warehouseId,
        w.code AS warehouseCode,
        w.name AS warehouseName,
        w.is_default AS isDefault,
        COALESCE(ps.stock_quantity, 0) AS stockQuantity
      FROM warehouses w
      LEFT JOIN product_stocks ps ON ps.warehouse_id = w.id AND ps.product_id = ? AND ps.company_id = w.company_id
      WHERE w.company_id = ? AND w.is_active = 1
      ORDER BY w.is_default DESC, w.name ASC`,
      [productId, companyId]
    );

    return rows.map((row) => ({
      warehouseId: row.warehouseId,
      warehouseCode: row.warehouseCode,
      warehouseName: row.warehouseName,
      isDefault: Boolean(row.isDefault),
      stockQuantity: Number(row.stockQuantity)
    }));
  }

  async listMovements(
    companyId: number,
    query: {
      productId?: number;
      warehouseId?: number;
      movementType: MovementType | "all";
      sourceType: SourceType | "all";
      dateFrom?: string;
      dateTo?: string;
      page?: number;
      pageSize?: number;
    }
  ) {
    const pagination = resolvePagination(query.page, query.pageSize);
    const params: Array<string | number> = [companyId];
    const conditions = ["im.company_id = ?"];

    if (query.productId) {
      conditions.push("im.product_id = ?");
      params.push(query.productId);
    }

    if (query.warehouseId) {
      conditions.push("im.warehouse_id = ?");
      params.push(query.warehouseId);
    }

    if (query.movementType !== "all") {
      conditions.push("im.movement_type = ?");
      params.push(query.movementType);
    }

    if (query.sourceType !== "all") {
      conditions.push("im.source_type = ?");
      params.push(query.sourceType);
    }

    if (query.dateFrom) {
      conditions.push("DATE(im.created_at) >= ?");
      params.push(query.dateFrom);
    }

    if (query.dateTo) {
      conditions.push("DATE(im.created_at) <= ?");
      params.push(query.dateTo);
    }

    const whereClause = conditions.join(" AND ");
    const [items] = await dbPool.query<MovementRow[]>(
      `SELECT
        im.id,
        im.company_id AS companyId,
        im.product_id AS productId,
        p.code AS productCode,
        p.name AS productName,
        im.warehouse_id AS warehouseId,
        w.name AS warehouseName,
        im.movement_type AS movementType,
        im.source_type AS sourceType,
        im.invoice_id AS invoiceId,
        i.invoice_number AS invoiceNumber,
        im.entry_id AS entryId,
        ie.document_number AS entryDocumentNumber,
        COALESCE(sp.name, ie.supplier_name) AS supplierName,
        i.customer_name_snapshot AS customerName,
        im.quantity,
        im.unit_cost AS unitCost,
        im.unit_price AS unitPrice,
        im.stock_before AS stockBefore,
        im.stock_after AS stockAfter,
        im.notes,
        im.created_by AS createdBy,
        u.full_name AS createdByName,
        im.created_at AS createdAt
      FROM inventory_movements im
      INNER JOIN products p ON p.id = im.product_id
      INNER JOIN warehouses w ON w.id = im.warehouse_id
      INNER JOIN users u ON u.id = im.created_by
      LEFT JOIN invoices i ON i.id = im.invoice_id
      LEFT JOIN inventory_entries ie ON ie.id = im.entry_id
      LEFT JOIN suppliers sp ON sp.id = ie.supplier_id
      WHERE ${whereClause}
      ORDER BY im.created_at DESC, im.id DESC
      LIMIT ? OFFSET ?`,
      [...params, pagination.pageSize, pagination.offset]
    );

    const [countRows] = await dbPool.query<Array<RowDataPacket & { total: number }>>(
      `SELECT COUNT(*) AS total
       FROM inventory_movements im
       WHERE ${whereClause}`,
      params
    );

    return {
      items: padProductCodes(items),
      pagination: {
        page: pagination.page,
        pageSize: pagination.pageSize,
        total: countRows[0]?.total ?? 0
      }
    };
  }

  async listEntries(
    companyId: number,
    query: { search?: string; warehouseId?: number; dateFrom?: string; dateTo?: string; page?: number; pageSize?: number }
  ) {
    const pagination = resolvePagination(query.page, query.pageSize);
    const params: Array<string | number> = [companyId];
    const conditions = ["ie.company_id = ?"];

    if (query.search) {
      conditions.push("(ie.supplier_name LIKE ? OR ie.document_number LIKE ? OR ie.notes LIKE ?)");
      const search = `%${query.search}%`;
      params.push(search, search, search);
    }

    if (query.warehouseId) {
      conditions.push("ie.warehouse_id = ?");
      params.push(query.warehouseId);
    }

    if (query.dateFrom) {
      conditions.push("ie.entry_date >= ?");
      params.push(query.dateFrom);
    }

    if (query.dateTo) {
      conditions.push("ie.entry_date <= ?");
      params.push(query.dateTo);
    }

    const whereClause = conditions.join(" AND ");
    const [items] = await dbPool.query<EntryRow[]>(
      `SELECT
        ie.id,
        ie.company_id AS companyId,
        ie.warehouse_id AS warehouseId,
        w.name AS warehouseName,
        ie.entry_date AS entryDate,
        ie.supplier_id AS supplierId,
        COALESCE(sp.name, ie.supplier_name) AS supplierName,
        ie.document_number AS documentNumber,
        ie.notes,
        ie.status,
        COALESCE(totals.itemCount, 0) AS itemCount,
        COALESCE(totals.totalCost, 0) AS totalCost,
        ie.created_by AS createdBy,
        u.full_name AS createdByName,
        ie.created_at AS createdAt,
        ie.updated_at AS updatedAt
      FROM inventory_entries ie
      INNER JOIN warehouses w ON w.id = ie.warehouse_id
      INNER JOIN users u ON u.id = ie.created_by
      LEFT JOIN suppliers sp ON sp.id = ie.supplier_id
      LEFT JOIN (
        SELECT entry_id, COUNT(*) AS itemCount, SUM(total_cost) AS totalCost
        FROM inventory_entry_items
        GROUP BY entry_id
      ) totals ON totals.entry_id = ie.id
      WHERE ${whereClause}
      ORDER BY ie.entry_date DESC, ie.id DESC
      LIMIT ? OFFSET ?`,
      [...params, pagination.pageSize, pagination.offset]
    );

    const [countRows] = await dbPool.query<Array<RowDataPacket & { total: number }>>(
      `SELECT COUNT(*) AS total FROM inventory_entries ie WHERE ${whereClause}`,
      params
    );

    return {
      items,
      pagination: {
        page: pagination.page,
        pageSize: pagination.pageSize,
        total: countRows[0]?.total ?? 0
      }
    };
  }

  async getEntryDetail(companyId: number, entryId: number) {
    const [entryRows] = await dbPool.query<EntryRow[]>(
      `SELECT
        ie.id,
        ie.company_id AS companyId,
        ie.warehouse_id AS warehouseId,
        w.name AS warehouseName,
        ie.entry_date AS entryDate,
        ie.supplier_id AS supplierId,
        COALESCE(sp.name, ie.supplier_name) AS supplierName,
        ie.document_number AS documentNumber,
        ie.notes,
        ie.status,
        COALESCE(totals.itemCount, 0) AS itemCount,
        COALESCE(totals.totalCost, 0) AS totalCost,
        ie.created_by AS createdBy,
        u.full_name AS createdByName,
        ie.created_at AS createdAt,
        ie.updated_at AS updatedAt
      FROM inventory_entries ie
      INNER JOIN warehouses w ON w.id = ie.warehouse_id
      INNER JOIN users u ON u.id = ie.created_by
      LEFT JOIN suppliers sp ON sp.id = ie.supplier_id
      LEFT JOIN (
        SELECT entry_id, COUNT(*) AS itemCount, SUM(total_cost) AS totalCost
        FROM inventory_entry_items
        GROUP BY entry_id
      ) totals ON totals.entry_id = ie.id
      WHERE ie.company_id = ? AND ie.id = ?
      LIMIT 1`,
      [companyId, entryId]
    );

    const entry = entryRows[0];

    if (!entry) {
      throw new AppError("Entrada de inventario no encontrada.", 404);
    }

    const [items] = await dbPool.query<EntryItemRow[]>(
      `SELECT
        iei.id,
        iei.entry_id AS entryId,
        iei.product_id AS productId,
        p.code AS productCode,
        p.name AS productName,
        iei.quantity,
        iei.unit_cost AS unitCost,
        iei.total_cost AS totalCost,
        iei.created_at AS createdAt
      FROM inventory_entry_items iei
      INNER JOIN products p ON p.id = iei.product_id
      WHERE iei.entry_id = ?
      ORDER BY iei.id ASC`,
      [entryId]
    );

    return {
      ...entry,
      items: padProductCodes(items)
    };
  }

  /** Proveedores activos para el selector de la entrada. */
  async supplierOptions(companyId: number) {
    const [rows] = await dbPool.query<Array<RowDataPacket & { id: number; name: string; rtn: string | null }>>(
      "SELECT id, name, rtn FROM suppliers WHERE company_id = ? AND is_active = 1 ORDER BY name ASC",
      [companyId]
    );
    return rows;
  }

  async createEntry(companyId: number, userId: number, payload: EntryPayload) {
    await this.assertActiveWarehouse(companyId, payload.warehouseId);

    // Proveedor del catálogo: se guarda el vínculo y una copia del nombre.
    const supplier = payload.supplierId ? await suppliersService.findOrFail(companyId, payload.supplierId) : null;
    if (supplier && !supplier.isActive) {
      throw new AppError(`El proveedor ${supplier.name} está inactivo.`, 400);
    }

    if (payload.entryDate > todayInHonduras()) {
      throw new AppError("La fecha de la entrada no puede ser futura.", 400);
    }

    const productIds = payload.items.map((item) => item.productId);
    if (new Set(productIds).size !== productIds.length) {
      throw new AppError("Hay productos repetidos en la entrada: suma las cantidades en una sola línea.", 400);
    }

    const entryId = await withTransaction(async (connection) => {
      const [entryResult] = await connection.execute<ResultSetHeader>(
        `INSERT INTO inventory_entries (
          company_id,
          warehouse_id,
          entry_date,
          supplier_id,
          supplier_name,
          document_number,
          notes,
          status,
          created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'APLICADA', ?)`,
        [
          companyId,
          payload.warehouseId,
          payload.entryDate,
          supplier?.id ?? null,
          supplier ? supplier.name : this.normalizeNullable(payload.supplierName),
          this.normalizeNullable(payload.documentNumber),
          this.normalizeNullable(payload.notes),
          userId
        ]
      );

      for (const item of payload.items) {
        const product = await this.findProductForStock(connection, companyId, item.productId);
        this.assertProductMovable(product, item.quantity);
        const totalCost = round2(item.quantity * item.unitCost);

        const [itemResult] = await connection.execute<ResultSetHeader>(
          `INSERT INTO inventory_entry_items (entry_id, product_id, quantity, unit_cost, total_cost)
           VALUES (?, ?, ?, ?, ?)`,
          [entryResult.insertId, item.productId, round2(item.quantity), round2(item.unitCost), totalCost]
        );

        await this.applyStockChange(connection, {
          companyId,
          productId: item.productId,
          warehouseId: payload.warehouseId,
          movementType: "ENTRADA",
          sourceType: "ENTRADA",
          quantity: round2(item.quantity),
          direction: "IN",
          unitCost: round2(item.unitCost),
          entryId: entryResult.insertId,
          entryItemId: itemResult.insertId,
          userId,
          productName: product.name
        });

        if (item.unitCost > 0) {
          await connection.execute("UPDATE products SET cost_price = ?, updated_at = CURRENT_TIMESTAMP WHERE company_id = ? AND id = ?", [
            round2(item.unitCost),
            companyId,
            item.productId
          ]);
        }
      }

      return entryResult.insertId;
    });

    return this.getEntryDetail(companyId, entryId);
  }

  async createAdjustment(companyId: number, userId: number, payload: StockAdjustmentPayload) {
    const warehouse = await this.assertActiveWarehouse(companyId, payload.warehouseId);
    await productsService.findOrFail(companyId, payload.productId);

    const movementId = await withTransaction(async (connection) => {
      const product = await this.findProductForStock(connection, companyId, payload.productId);
      this.assertProductMovable(product, payload.quantity);
      const isOut = payload.adjustmentType === "AJUSTE_NEGATIVO";

      // El stock inicial es el punto de partida: solo si el producto aún no tiene
      // movimientos en esa bodega. Después se corrige con ajustes positivos o negativos.
      if (payload.adjustmentType === "STOCK_INICIAL") {
        const [previous] = await connection.query<Array<RowDataPacket & { total: number }>>(
          "SELECT COUNT(*) AS total FROM inventory_movements WHERE company_id = ? AND product_id = ? AND warehouse_id = ?",
          [companyId, payload.productId, payload.warehouseId]
        );
        if (Number(previous[0]?.total ?? 0) > 0) {
          throw new AppError(
            `${product.name} ya tiene movimientos en ${warehouse.name}. Usa un ajuste positivo o negativo para corregir la existencia.`,
            409
          );
        }
      }

      // Costo del movimiento: el indicado; si no se indica (o es salida), el costo actual del producto.
      const unitCost = isOut || !payload.unitCost ? round2(Number(product.costPrice)) : round2(payload.unitCost);

      return this.applyStockChange(connection, {
        companyId,
        productId: payload.productId,
        warehouseId: payload.warehouseId,
        movementType: payload.adjustmentType,
        sourceType: payload.adjustmentType === "STOCK_INICIAL" ? "MANUAL" : "AJUSTE",
        quantity: round2(payload.quantity),
        direction: isOut ? "OUT" : "IN",
        unitCost,
        notes: payload.notes.trim(),
        userId,
        productName: product.name
      });
    });

    return this.findMovementOrFail(companyId, movementId);
  }

  async applyInvoiceSale(
    connection: DbConnection,
    params: {
      companyId: number;
      userId: number;
      warehouseId: number;
      invoiceId: number;
      items: InvoiceStockItem[];
    }
  ) {
    // Lockear los stocks en orden determinista (por productId) evita deadlocks
    // cuando dos facturas concurrentes incluyen los mismos productos en distinto orden.
    const orderedItems = [...params.items].sort((first, second) => first.productId - second.productId);

    for (const item of orderedItems) {
      const product = await this.findProductForStock(connection, params.companyId, item.productId);

      await this.applyStockChange(connection, {
        companyId: params.companyId,
        productId: item.productId,
        warehouseId: params.warehouseId,
        movementType: "VENTA",
        sourceType: "FACTURA",
        quantity: round2(item.quantity),
        direction: "OUT",
        unitCost: item.unitCost,
        unitPrice: item.unitPrice,
        invoiceId: params.invoiceId,
        invoiceItemId: item.invoiceItemId,
        userId: params.userId,
        productName: product.name
      });
    }
  }

  private async findMovementOrFail(companyId: number, movementId: number) {
    const [rows] = await dbPool.query<MovementRow[]>(
      `SELECT
        im.id,
        im.company_id AS companyId,
        im.product_id AS productId,
        p.code AS productCode,
        p.name AS productName,
        im.warehouse_id AS warehouseId,
        w.name AS warehouseName,
        im.movement_type AS movementType,
        im.source_type AS sourceType,
        im.invoice_id AS invoiceId,
        i.invoice_number AS invoiceNumber,
        im.entry_id AS entryId,
        ie.document_number AS entryDocumentNumber,
        COALESCE(sp.name, ie.supplier_name) AS supplierName,
        i.customer_name_snapshot AS customerName,
        im.quantity,
        im.unit_cost AS unitCost,
        im.unit_price AS unitPrice,
        im.stock_before AS stockBefore,
        im.stock_after AS stockAfter,
        im.notes,
        im.created_by AS createdBy,
        u.full_name AS createdByName,
        im.created_at AS createdAt
      FROM inventory_movements im
      INNER JOIN products p ON p.id = im.product_id
      INNER JOIN warehouses w ON w.id = im.warehouse_id
      INNER JOIN users u ON u.id = im.created_by
      LEFT JOIN invoices i ON i.id = im.invoice_id
      LEFT JOIN inventory_entries ie ON ie.id = im.entry_id
      LEFT JOIN suppliers sp ON sp.id = ie.supplier_id
      WHERE im.company_id = ? AND im.id = ?
      LIMIT 1`,
      [companyId, movementId]
    );

    const movement = padProductCodes(rows)[0];

    if (!movement) {
      throw new AppError("Movimiento de inventario no encontrado.", 404);
    }

    return movement;
  }
}

export const inventoryService = new InventoryService();
