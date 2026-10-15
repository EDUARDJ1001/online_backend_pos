import type { ResultSetHeader, RowDataPacket } from "mysql2";

import { dbPool, withTransaction } from "../../config/db";
import { AppError } from "../../utils/http-error";
import { resolvePagination } from "../../utils/pagination";
import { deactivationRules } from "../shared/deactivation-rules";

interface WarehouseRow extends RowDataPacket {
  id: number;
  companyId: number;
  code: string;
  name: string;
  address: string | null;
  isDefault: number;
  isActive: number;
  createdAt: string;
  updatedAt: string;
}

type WarehousePayload = {
  code: string;
  name: string;
  address?: string;
  isDefault: boolean;
  isActive: boolean;
};

class WarehousesService {
  private normalizeNullable(value?: string | null) {
    return value?.trim() ? value.trim() : null;
  }

  private async getById(companyId: number, warehouseId: number) {
    const [rows] = await dbPool.query<WarehouseRow[]>(
      `SELECT
        id,
        company_id AS companyId,
        code,
        name,
        address,
        is_default AS isDefault,
        is_active AS isActive,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM warehouses
      WHERE company_id = ? AND id = ?
      LIMIT 1`,
      [companyId, warehouseId]
    );

    return rows[0];
  }

  async findOrFail(companyId: number, warehouseId: number) {
    const warehouse = await this.getById(companyId, warehouseId);

    if (!warehouse) {
      throw new AppError("Bodega no encontrada para la empresa activa.", 404);
    }

    return warehouse;
  }

  async findDefaultOrFirst(companyId: number) {
    const [rows] = await dbPool.query<WarehouseRow[]>(
      `SELECT
        id,
        company_id AS companyId,
        code,
        name,
        address,
        is_default AS isDefault,
        is_active AS isActive,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM warehouses
      WHERE company_id = ? AND is_active = 1
      ORDER BY is_default DESC, id ASC
      LIMIT 1`,
      [companyId]
    );

    return rows[0] ?? null;
  }

  async list(companyId: number, query: { search?: string; status: "active" | "inactive" | "all"; page?: number; pageSize?: number }) {
    const pagination = resolvePagination(query.page, query.pageSize);
    const params: Array<string | number> = [companyId];
    const conditions = ["company_id = ?"];

    if (query.search) {
      conditions.push("(name LIKE ? OR code LIKE ? OR address LIKE ?)");
      const search = `%${query.search}%`;
      params.push(search, search, search);
    }

    if (query.status === "active") {
      conditions.push("is_active = 1");
    }

    if (query.status === "inactive") {
      conditions.push("is_active = 0");
    }

    const whereClause = conditions.join(" AND ");
    const [items] = await dbPool.query<WarehouseRow[]>(
      `SELECT
        id,
        company_id AS companyId,
        code,
        name,
        address,
        is_default AS isDefault,
        is_active AS isActive,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM warehouses
      WHERE ${whereClause}
      ORDER BY id DESC
      LIMIT ? OFFSET ?`,
      [...params, pagination.pageSize, pagination.offset]
    );

    const [countRows] = await dbPool.query<Array<RowDataPacket & { total: number }>>(
      `SELECT COUNT(*) AS total FROM warehouses WHERE ${whereClause}`,
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

  async create(companyId: number, payload: WarehousePayload) {
    const warehouseId = await withTransaction(async (connection) => {
      if (payload.isDefault) {
        await connection.execute("UPDATE warehouses SET is_default = 0 WHERE company_id = ?", [companyId]);
      }

      const [result] = await connection.execute<ResultSetHeader>(
        `INSERT INTO warehouses (company_id, code, name, address, is_default, is_active)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          companyId,
          payload.code.trim(),
          payload.name.trim(),
          this.normalizeNullable(payload.address),
          payload.isDefault ? 1 : 0,
          payload.isActive ? 1 : 0
        ]
      );

      return result.insertId;
    });

    return this.findOrFail(companyId, warehouseId);
  }

  async update(companyId: number, warehouseId: number, payload: WarehousePayload) {
    await this.findOrFail(companyId, warehouseId);

    await withTransaction(async (connection) => {
      if (payload.isDefault) {
        await connection.execute("UPDATE warehouses SET is_default = 0 WHERE company_id = ?", [companyId]);
      }

      await connection.execute(
        `UPDATE warehouses
         SET code = ?, name = ?, address = ?, is_default = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
         WHERE company_id = ? AND id = ?`,
        [
          payload.code.trim(),
          payload.name.trim(),
          this.normalizeNullable(payload.address),
          payload.isDefault ? 1 : 0,
          payload.isActive ? 1 : 0,
          companyId,
          warehouseId
        ]
      );

    });

    return this.findOrFail(companyId, warehouseId);
  }

  async updateStatus(companyId: number, warehouseId: number, isActive: boolean) {
    const warehouse = await this.findOrFail(companyId, warehouseId);
    if (!isActive) {
      await deactivationRules.warehouse(companyId, { id: warehouseId, name: warehouse.name, isDefault: warehouse.isDefault });
    }

    await dbPool.execute(
      `UPDATE warehouses
       SET is_active = ?, updated_at = CURRENT_TIMESTAMP
       WHERE company_id = ? AND id = ?`,
      [isActive ? 1 : 0, companyId, warehouseId]
    );

    return this.findOrFail(companyId, warehouseId);
  }
}

export const warehousesService = new WarehousesService();
