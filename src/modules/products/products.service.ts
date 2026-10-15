import type { ResultSetHeader, RowDataPacket } from "mysql2";

import { dbPool, withTransaction, nextIdentityValue } from "../../config/db";
import { padProductCode, productCodeSearchTerm } from "../../utils/product-code";
import { AppError } from "../../utils/http-error";
import { resolvePagination } from "../../utils/pagination";
import { unitTypeProblem } from "../inventory/inventory-rules";
import { deactivationRules } from "../shared/deactivation-rules";

interface ProductCategoryRow extends RowDataPacket {
  id: number;
  companyId: number;
  name: string;
  description: string | null;
  isActive: number;
  createdAt: string;
  updatedAt: string;
}

interface ProductRow extends RowDataPacket {
  id: number;
  companyId: number;
  categoryId: number | null;
  categoryName: string | null;
  code: string;
  barcode: string | null;
  name: string;
  description: string | null;
  imageUrl: string | null;
  type: "PRODUCTO" | "SERVICIO";
  unitMeasure: string;
  salePrice: number;
  costPrice: number;
  taxable: number;
  taxRate: number;
  controlsStock: number;
  minStock: number;
  isActive: number;
  createdBy: number | null;
  stockQuantity: number;
  createdAt: string;
  updatedAt: string;
}

interface NextProductIdRow extends RowDataPacket {
  nextId: number | null;
}

type ProductCodeInput = { code: string; codeType?: "BARRA" | "MANUAL" };

type ProductPayload = {
  categoryId?: number | null;
  code: string;
  barcode?: string;
  codes?: ProductCodeInput[];
  name: string;
  description?: string;
  imageUrl?: string;
  type: "PRODUCTO" | "SERVICIO";
  unitMeasure: string;
  salePrice: number;
  costPrice: number;
  taxable: boolean;
  taxRate: number;
  controlsStock: boolean;
  minStock: number;
  isActive: boolean;
};

type CategoryPayload = {
  name: string;
  description?: string;
  isActive: boolean;
};

class ProductsService {
  private normalizeNullable(value?: string | null) {
    return value?.trim() ? value.trim() : null;
  }

  private normalizeCategoryId(value?: number | null) {
    return value && value > 0 ? value : null;
  }

  private async getCategoryById(companyId: number, categoryId: number) {
    const [rows] = await dbPool.query<ProductCategoryRow[]>(
      `SELECT
        id,
        company_id AS companyId,
        name,
        description,
        is_active AS isActive,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM product_categories
      WHERE company_id = ? AND id = ?
      LIMIT 1`,
      [companyId, categoryId]
    );

    return rows[0];
  }

  async findCategoryOrFail(companyId: number, categoryId: number) {
    const category = await this.getCategoryById(companyId, categoryId);

    if (!category) {
      throw new AppError("Categoría no encontrada para la empresa activa.", 404);
    }

    return category;
  }

  async listCategories(companyId: number, query: { search?: string; status: "active" | "inactive" | "all"; page?: number; pageSize?: number }) {
    const pagination = resolvePagination(query.page, query.pageSize);
    const params: Array<string | number> = [companyId];
    const conditions = ["company_id = ?"];

    if (query.search) {
      conditions.push("(name LIKE ? OR description LIKE ?)");
      const search = `%${query.search}%`;
      params.push(search, search);
    }

    if (query.status === "active") {
      conditions.push("is_active = 1");
    }

    if (query.status === "inactive") {
      conditions.push("is_active = 0");
    }

    const whereClause = conditions.join(" AND ");
    const [items] = await dbPool.query<ProductCategoryRow[]>(
      `SELECT
        id,
        company_id AS companyId,
        name,
        description,
        is_active AS isActive,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM product_categories
      WHERE ${whereClause}
      ORDER BY id DESC
      LIMIT ? OFFSET ?`,
      [...params, pagination.pageSize, pagination.offset]
    );

    const [countRows] = await dbPool.query<Array<RowDataPacket & { total: number }>>(
      `SELECT COUNT(*) AS total FROM product_categories WHERE ${whereClause}`,
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

  async createCategory(companyId: number, payload: CategoryPayload) {
    const [result] = await dbPool.execute<ResultSetHeader>(
      `INSERT INTO product_categories (company_id, name, description, is_active)
       VALUES (?, ?, ?, ?)`,
      [companyId, payload.name.trim(), this.normalizeNullable(payload.description), payload.isActive ? 1 : 0]
    );

    return this.findCategoryOrFail(companyId, result.insertId);
  }

  async updateCategory(companyId: number, categoryId: number, payload: CategoryPayload) {
    await this.findCategoryOrFail(companyId, categoryId);

    await dbPool.execute(
      `UPDATE product_categories
       SET name = ?, description = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
       WHERE company_id = ? AND id = ?`,
      [payload.name.trim(), this.normalizeNullable(payload.description), payload.isActive ? 1 : 0, companyId, categoryId]
    );

    return this.findCategoryOrFail(companyId, categoryId);
  }

  async updateCategoryStatus(companyId: number, categoryId: number, isActive: boolean) {
    const category = await this.findCategoryOrFail(companyId, categoryId);
    if (!isActive) {
      await deactivationRules.category(companyId, { id: categoryId, name: category.name });
    }

    await dbPool.execute(
      `UPDATE product_categories
       SET is_active = ?, updated_at = CURRENT_TIMESTAMP
       WHERE company_id = ? AND id = ?`,
      [isActive ? 1 : 0, companyId, categoryId]
    );

    return this.findCategoryOrFail(companyId, categoryId);
  }

  /** Códigos (barras/manuales) de un conjunto de productos, agrupados por producto. */
  private async fetchCodesForProducts(productIds: number[]) {
    const map = new Map<number, Array<{ code: string; codeType: "BARRA" | "MANUAL" }>>();
    if (productIds.length === 0) {
      return map;
    }
    const placeholders = productIds.map(() => "?").join(", ");
    const [rows] = await dbPool.query<Array<RowDataPacket & { productId: number; code: string; codeType: "BARRA" | "MANUAL" }>>(
      `SELECT product_id AS productId, code, code_type AS codeType
       FROM product_codes WHERE product_id IN (${placeholders}) ORDER BY id ASC`,
      productIds
    );
    for (const row of rows) {
      const list = map.get(row.productId) ?? [];
      list.push({ code: row.code, codeType: row.codeType });
      map.set(row.productId, list);
    }
    return map;
  }

  /** Reemplaza los códigos de un producto. Valida que no choquen con otros productos. */
  private async syncCodes(companyId: number, productId: number, codes: ProductCodeInput[] = []) {
    const seen = new Set<string>();
    const clean: Array<{ code: string; codeType: "BARRA" | "MANUAL" }> = [];
    for (const entry of codes) {
      const code = entry.code?.trim();
      if (!code) {
        continue;
      }
      const key = code.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      clean.push({ code, codeType: entry.codeType === "BARRA" ? "BARRA" : "MANUAL" });
    }

    // Choque con códigos de OTROS productos de la misma empresa.
    if (clean.length > 0) {
      const placeholders = clean.map(() => "?").join(", ");
      const [dups] = await dbPool.query<Array<RowDataPacket & { code: string }>>(
        `SELECT code FROM product_codes WHERE company_id = ? AND product_id <> ? AND code IN (${placeholders})`,
        [companyId, productId, ...clean.map((item) => item.code)]
      );
      if (dups[0]) {
        throw new AppError(`El código "${dups[0].code}" ya está asignado a otro producto.`, 409);
      }
    }

    const connection = await dbPool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute("DELETE FROM product_codes WHERE company_id = ? AND product_id = ?", [companyId, productId]);
      for (const item of clean) {
        await connection.execute(
          "INSERT INTO product_codes (company_id, product_id, code, code_type) VALUES (?, ?, ?, ?)",
          [companyId, productId, item.code, item.codeType]
        );
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      if ((error as { code?: string }).code === "ER_DUP_ENTRY") {
        throw new AppError("Uno de los códigos ya está asignado a otro producto.", 409);
      }
      throw error;
    } finally {
      connection.release();
    }
  }

  private async getProductById(companyId: number, productId: number) {
    const [rows] = await dbPool.query<ProductRow[]>(
      `SELECT
        p.id,
        p.company_id AS companyId,
        p.category_id AS categoryId,
        pc.name AS categoryName,
        p.code,
        p.barcode,
        p.name,
        p.description,
        p.image_url AS imageUrl,
        p.type,
        p.unit_measure AS unitMeasure,
        p.sale_price AS salePrice,
        p.cost_price AS costPrice,
        p.taxable,
        p.tax_rate AS taxRate,
        p.controls_stock AS controlsStock,
        p.min_stock AS minStock,
        p.is_active AS isActive,
        p.created_by AS createdBy,
        COALESCE(ps.stockQuantity, 0) AS stockQuantity,
        p.created_at AS createdAt,
        p.updated_at AS updatedAt
      FROM products p
      LEFT JOIN product_categories pc ON pc.id = p.category_id
      LEFT JOIN (
        SELECT product_id, SUM(stock_quantity) AS stockQuantity
        FROM product_stocks
        GROUP BY product_id
      ) ps ON ps.product_id = p.id
      WHERE p.company_id = ? AND p.id = ?
      LIMIT 1`,
      [companyId, productId]
    );

    return rows[0];
  }

  async findOrFail(companyId: number, productId: number) {
    const product = await this.getProductById(companyId, productId);

    if (!product) {
      throw new AppError("Producto no encontrado para la empresa activa.", 404);
    }

    const codesMap = await this.fetchCodesForProducts([product.id]);
    return { ...product, code: padProductCode(product.code), codes: codesMap.get(product.id) ?? [] };
  }

  async findActiveForSale(companyId: number, productId: number) {
    const product = await this.findOrFail(companyId, productId);

    if (!product.isActive) {
      throw new AppError(`El producto ${product.name} no está activo.`, 400);
    }

    return product;
  }

  async getNextCode(companyId: number) {
    const nextId = await nextIdentityValue("products");

    const nextCode = padProductCode(String(nextId));

    return { code: nextCode };
  }

  async list(
    companyId: number,
    query: {
      search?: string;
      status: "active" | "inactive" | "all";
      type: "PRODUCTO" | "SERVICIO" | "all";
      categoryId?: number;
      lowStock?: boolean;
      page?: number;
      pageSize?: number;
    }
  ) {
    const pagination = resolvePagination(query.page, query.pageSize);
    const params: Array<string | number> = [companyId];
    const conditions = ["p.company_id = ?"];

    if (query.search) {
      conditions.push(
        "(p.name LIKE ? OR p.code LIKE ? OR p.code LIKE ? OR p.barcode LIKE ? OR EXISTS (SELECT 1 FROM product_codes pcx WHERE pcx.product_id = p.id AND pcx.code LIKE ?))"
      );
      const search = `%${query.search}%`;
      // 0000212 también encuentra el 212 guardado antes con menos dígitos.
      params.push(search, search, `%${productCodeSearchTerm(query.search)}%`, search, search);
    }

    if (query.status === "active") {
      conditions.push("p.is_active = 1");
    }

    if (query.status === "inactive") {
      conditions.push("p.is_active = 0");
    }

    if (query.type !== "all") {
      conditions.push("p.type = ?");
      params.push(query.type);
    }

    if (query.categoryId) {
      conditions.push("p.category_id = ?");
      params.push(query.categoryId);
    }

    if (query.lowStock) {
      conditions.push("p.controls_stock = 1 AND COALESCE(ps.stockQuantity, 0) <= p.min_stock");
    }

    const whereClause = conditions.join(" AND ");

    const [items] = await dbPool.query<ProductRow[]>(
      `SELECT
        p.id,
        p.company_id AS companyId,
        p.category_id AS categoryId,
        pc.name AS categoryName,
        p.code,
        p.barcode,
        p.name,
        p.description,
        p.image_url AS imageUrl,
        p.type,
        p.unit_measure AS unitMeasure,
        p.sale_price AS salePrice,
        p.cost_price AS costPrice,
        p.taxable,
        p.tax_rate AS taxRate,
        p.controls_stock AS controlsStock,
        p.min_stock AS minStock,
        p.is_active AS isActive,
        p.created_by AS createdBy,
        COALESCE(ps.stockQuantity, 0) AS stockQuantity,
        p.created_at AS createdAt,
        p.updated_at AS updatedAt
      FROM products p
      LEFT JOIN product_categories pc ON pc.id = p.category_id
      LEFT JOIN (
        SELECT product_id, SUM(stock_quantity) AS stockQuantity
        FROM product_stocks
        GROUP BY product_id
      ) ps ON ps.product_id = p.id
      WHERE ${whereClause}
      ORDER BY p.id DESC
      LIMIT ? OFFSET ?`,
      [...params, pagination.pageSize, pagination.offset]
    );

    const [countRows] = await dbPool.query<Array<RowDataPacket & { total: number }>>(
      `SELECT COUNT(*) AS total
       FROM products p
       LEFT JOIN (
        SELECT product_id, SUM(stock_quantity) AS stockQuantity
        FROM product_stocks
        GROUP BY product_id
       ) ps ON ps.product_id = p.id
       WHERE ${whereClause}`,
      params
    );

    const codesMap = await this.fetchCodesForProducts(items.map((item) => item.id));

    return {
      items: items.map((item) => ({ ...item, code: padProductCode(item.code), codes: codesMap.get(item.id) ?? [] })),
      pagination: {
        page: pagination.page,
        pageSize: pagination.pageSize,
        total: countRows[0]?.total ?? 0
      }
    };
  }

  private async assertCategory(companyId: number, categoryId?: number | null) {
    const normalizedCategoryId = this.normalizeCategoryId(categoryId);

    if (!normalizedCategoryId) {
      return null;
    }

    await this.findCategoryOrFail(companyId, normalizedCategoryId);
    return normalizedCategoryId;
  }

  async create(companyId: number, userId: number, payload: ProductPayload) {
    const unitProblem = unitTypeProblem(payload.type, payload.unitMeasure);
    if (unitProblem) throw new AppError(unitProblem, 400);
    const categoryId = await this.assertCategory(companyId, payload.categoryId);
    const controlsStock = payload.type === "SERVICIO" ? false : payload.controlsStock;
    const temporaryCode = `PENDING-${companyId}-${Date.now().toString(36)}-${userId}`;

    const [result] = await dbPool.execute<ResultSetHeader>(
      `INSERT INTO products (
        company_id,
        category_id,
        code,
        barcode,
        name,
        description,
        image_url,
        type,
        unit_measure,
        sale_price,
        cost_price,
        taxable,
        tax_rate,
        controls_stock,
        min_stock,
        is_active,
        created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        companyId,
        categoryId,
        temporaryCode,
        this.normalizeNullable(payload.barcode),
        payload.name.trim(),
        this.normalizeNullable(payload.description),
        this.normalizeNullable(payload.imageUrl),
        payload.type,
        payload.unitMeasure.trim(),
        payload.salePrice,
        payload.costPrice,
        payload.taxable ? 1 : 0,
        payload.taxable ? payload.taxRate : 0,
        controlsStock ? 1 : 0,
        payload.minStock,
        payload.isActive ? 1 : 0,
        userId
      ]
    );

    // Código correlativo de 7 dígitos (0000212): se ve simétrico en tablas y documentos.
    await dbPool.execute("UPDATE products SET code = ?, updated_at = CURRENT_TIMESTAMP WHERE company_id = ? AND id = ?", [
      padProductCode(String(result.insertId)),
      companyId,
      result.insertId
    ]);

    await this.syncCodes(companyId, result.insertId, payload.codes);

    return this.findOrFail(companyId, result.insertId);
  }

  /**
   * Borra un producto recién creado que todavía no tiene movimientos (se usa si
   * no se pudo registrar su existencia inicial, para no dejarlo a medias).
   */
  async discardNew(companyId: number, productId: number) {
    await withTransaction(async (connection) => {
      const [movements] = await connection.query<Array<RowDataPacket & { total: number }>>(
        "SELECT COUNT(*) AS total FROM inventory_movements WHERE company_id = ? AND product_id = ?",
        [companyId, productId]
      );
      if (Number(movements[0]?.total ?? 0) > 0) {
        return;
      }
      await connection.execute("DELETE FROM product_stocks WHERE company_id = ? AND product_id = ?", [companyId, productId]);
      await connection.execute("DELETE FROM product_codes WHERE company_id = ? AND product_id = ?", [companyId, productId]);
      await connection.execute("DELETE FROM products WHERE company_id = ? AND id = ?", [companyId, productId]);
    });
  }

  async update(companyId: number, productId: number, payload: ProductPayload) {
    const current = await this.findOrFail(companyId, productId);
    // Solo si cambia el tipo o la unidad: los registros antiguos se pueden seguir editando.
    const unitChanged = payload.unitMeasure.trim().toUpperCase() !== String(current.unitMeasure).trim().toUpperCase();
    const unitProblem = unitTypeProblem(payload.type, payload.unitMeasure);
    if (unitProblem && (unitChanged || payload.type !== current.type)) throw new AppError(unitProblem, 400);
    const categoryId = await this.assertCategory(companyId, payload.categoryId);
    const controlsStock = payload.type === "SERVICIO" ? false : payload.controlsStock;

    // Con movimientos en el kardex, lo que define cómo se cuenta y valora el
    // inventario ya no se cambia desde aquí (quedaría inconsistente con su historial).
    const [movementRows] = await dbPool.query<Array<RowDataPacket & { total: number }>>(
      "SELECT COUNT(*) AS total FROM inventory_movements WHERE company_id = ? AND product_id = ?",
      [companyId, productId]
    );
    if (Number(movementRows[0]?.total ?? 0) > 0) {
      const locked: string[] = [];
      if (payload.type !== current.type) locked.push("el tipo");
      if (Boolean(controlsStock) !== Boolean(current.controlsStock)) locked.push("el control de existencias");
      if (payload.unitMeasure.trim().toUpperCase() !== String(current.unitMeasure).trim().toUpperCase()) locked.push("la unidad de medida");
      // El costo lo actualizan las entradas; se permite fijarlo solo si aún no tiene.
      if (Number(current.costPrice) > 0 && Math.abs(Number(payload.costPrice) - Number(current.costPrice)) >= 0.005) locked.push("el costo");
      if (locked.length > 0) {
        const fields = locked.length > 1 ? `${locked.slice(0, -1).join(", ")} ni ${locked[locked.length - 1]}` : locked[0];
        const costNote = locked.includes("el costo") ? " El costo se actualiza con las entradas de inventario." : "";
        throw new AppError(`${current.name} ya tiene movimientos en el kardex: no se puede cambiar ${fields}.${costNote}`, 409);
      }
    }

    await dbPool.execute(
      `UPDATE products
       SET category_id = ?,
           code = ?,
           barcode = ?,
           name = ?,
           description = ?,
           image_url = ?,
           type = ?,
           unit_measure = ?,
           sale_price = ?,
           cost_price = ?,
           taxable = ?,
           tax_rate = ?,
           controls_stock = ?,
           min_stock = ?,
           is_active = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE company_id = ? AND id = ?`,
      [
        categoryId,
        payload.code.trim(),
        this.normalizeNullable(payload.barcode),
        payload.name.trim(),
        this.normalizeNullable(payload.description),
        this.normalizeNullable(payload.imageUrl),
        payload.type,
        payload.unitMeasure.trim().toUpperCase(),
        payload.salePrice,
        payload.costPrice,
        payload.taxable ? 1 : 0,
        payload.taxable ? payload.taxRate : 0,
        controlsStock ? 1 : 0,
        payload.minStock,
        payload.isActive ? 1 : 0,
        companyId,
        productId
      ]
    );

    await this.syncCodes(companyId, productId, payload.codes);

    return this.findOrFail(companyId, productId);
  }

  async updateStatus(companyId: number, productId: number, isActive: boolean) {
    const product = await this.findOrFail(companyId, productId);
    if (isActive) {
      await deactivationRules.productRestore(companyId, { name: product.name, categoryId: product.categoryId });
    } else {
      await deactivationRules.product(companyId, { id: productId, name: product.name, unitMeasure: product.unitMeasure });
    }

    await dbPool.execute(
      `UPDATE products
       SET is_active = ?, updated_at = CURRENT_TIMESTAMP
       WHERE company_id = ? AND id = ?`,
      [isActive ? 1 : 0, companyId, productId]
    );

    return this.findOrFail(companyId, productId);
  }
}

export const productsService = new ProductsService();
