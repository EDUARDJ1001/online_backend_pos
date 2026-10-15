import type { ResultSetHeader, RowDataPacket } from "mysql2";

import { dbPool } from "../../config/db";
import { resolvePagination } from "../../utils/pagination";
import { AppError } from "../../utils/http-error";
import { deactivationRules } from "../shared/deactivation-rules";

interface SupplierRow extends RowDataPacket {
  id: number;
  companyId: number;
  code: string | null;
  name: string;
  rtn: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  isActive: number;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
}

type SupplierPayload = {
  code?: string;
  name: string;
  rtn?: string;
  email?: string;
  phone?: string;
  address?: string;
};

const SELECT_COLUMNS = `
  id,
  company_id AS companyId,
  code,
  name,
  rtn,
  email,
  phone,
  address,
  is_active AS isActive,
  created_by AS createdBy,
  created_at AS createdAt,
  updated_at AS updatedAt`;

class SuppliersService {
  private normalizeNullable(value?: string) {
    return value?.trim() ? value.trim() : null;
  }

  private async getById(companyId: number, supplierId: number) {
    const [rows] = await dbPool.query<SupplierRow[]>(
      `SELECT ${SELECT_COLUMNS} FROM suppliers WHERE company_id = ? AND id = ? LIMIT 1`,
      [companyId, supplierId]
    );

    return rows[0];
  }

  async list(companyId: number, query: { search?: string; status: "active" | "inactive" | "all"; page?: number; pageSize?: number }) {
    const pagination = resolvePagination(query.page, query.pageSize);
    const params: Array<string | number> = [companyId];
    const conditions = ["company_id = ?"];

    if (query.search) {
      conditions.push("(name LIKE ? OR rtn LIKE ? OR code LIKE ?)");
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
    const [items] = await dbPool.query<SupplierRow[]>(
      `SELECT ${SELECT_COLUMNS} FROM suppliers WHERE ${whereClause} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, pagination.pageSize, pagination.offset]
    );

    const [countRows] = await dbPool.query<Array<RowDataPacket & { total: number }>>(
      `SELECT COUNT(*) AS total FROM suppliers WHERE ${whereClause}`,
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

  async create(companyId: number, userId: number, payload: SupplierPayload) {
    const temporaryCode = `PENDING-${companyId}-${Date.now().toString(36)}-${userId}`;

    const [result] = await dbPool.execute<ResultSetHeader>(
      `INSERT INTO suppliers
      (company_id, code, name, rtn, email, phone, address, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        companyId,
        temporaryCode,
        payload.name.trim(),
        this.normalizeNullable(payload.rtn),
        this.normalizeNullable(payload.email),
        this.normalizeNullable(payload.phone),
        this.normalizeNullable(payload.address),
        userId
      ]
    );

    await dbPool.execute("UPDATE suppliers SET code = ?, updated_at = CURRENT_TIMESTAMP WHERE company_id = ? AND id = ?", [
      String(result.insertId),
      companyId,
      result.insertId
    ]);

    const supplier = await this.getById(companyId, result.insertId);

    if (!supplier) {
      throw new AppError("No se pudo crear el proveedor.", 500);
    }

    return supplier;
  }

  async findOrFail(companyId: number, supplierId: number) {
    const supplier = await this.getById(companyId, supplierId);

    if (!supplier) {
      throw new AppError("Proveedor no encontrado para la empresa activa.", 404);
    }

    return supplier;
  }

  async update(companyId: number, supplierId: number, payload: SupplierPayload) {
    await this.findOrFail(companyId, supplierId);

    await dbPool.execute(
      `UPDATE suppliers
      SET code = ?, name = ?, rtn = ?, email = ?, phone = ?, address = ?, updated_at = CURRENT_TIMESTAMP
      WHERE company_id = ? AND id = ?`,
      [
        String(supplierId),
        payload.name.trim(),
        this.normalizeNullable(payload.rtn),
        this.normalizeNullable(payload.email),
        this.normalizeNullable(payload.phone),
        this.normalizeNullable(payload.address),
        companyId,
        supplierId
      ]
    );

    return this.findOrFail(companyId, supplierId);
  }

  async updateStatus(companyId: number, supplierId: number, isActive: boolean) {
    const supplier = await this.findOrFail(companyId, supplierId);
    if (!isActive) {
      await deactivationRules.supplier(companyId, { id: supplierId, name: supplier.name });
    }

    await dbPool.execute(
      `UPDATE suppliers SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE company_id = ? AND id = ?`,
      [isActive ? 1 : 0, companyId, supplierId]
    );

    return this.findOrFail(companyId, supplierId);
  }
}

export const suppliersService = new SuppliersService();
