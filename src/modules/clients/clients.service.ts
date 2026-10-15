import type { ResultSetHeader, RowDataPacket } from "mysql2";

import { dbPool, withTransaction } from "../../config/db";
import { nextDocumentNumber } from "../../utils/document-counter";
import { resolvePagination } from "../../utils/pagination";
import { AppError } from "../../utils/http-error";
import { deactivationRules } from "../shared/deactivation-rules";

interface ClientRow extends RowDataPacket {
  id: number;
  companyId: number;
  code: string | null;
  name: string;
  rtn: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  isGeneric: number;
  isActive: number;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
}

interface ClientListRow extends ClientRow {
  pendingBalance: number | string | null;
  lastPurchaseDate: string | Date | null;
}

interface ClientStatsRow extends RowDataPacket {
  invoiceCount: number;
  totalPurchased: number | string | null;
  lastPurchaseDate: string | Date | null;
  pendingBalance: number | string | null;
  overdueCount: number;
}

interface ClientInvoiceRow extends RowDataPacket {
  id: number;
  invoiceNumber: string;
  invoiceDate: string | Date;
  saleType: string;
  grandTotal: number | string;
  balance: number | string;
}

function dateOnly(value: string | Date | null) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  return String(value).slice(0, 10);
}

/** ¿Es una venta a "Consumidor final" (nombre genérico, sin RTN)? */
export function isGenericCustomer(name?: string | null, rtn?: string | null) {
  const normalized = (name ?? "").trim().toLowerCase();
  return (normalized === "" || normalized === "consumidor final") && !(rtn ?? "").trim();
}

/** RTN (14 dígitos) o DNI (13): se guarda solo con dígitos. */
export function normalizeRtn(value?: string | null) {
  const digits = (value ?? "").replace(/[\s-]/g, "");
  return digits ? digits : null;
}

type ClientPayload = {
  code?: string;
  name: string;
  rtn?: string;
  email?: string;
  phone?: string;
  address?: string;
  isGeneric: boolean;
};

class ClientsService {
  private normalizeNullable(value?: string | null) {
    return value?.trim() ? value.trim() : null;
  }

  /** Valida el formato y que ningún otro cliente de la empresa tenga el mismo RTN. */
  private async assertRtn(companyId: number, rtn: string | null, exceptId?: number) {
    if (!rtn) {
      return;
    }

    if (!/^\d{13,14}$/.test(rtn)) {
      throw new AppError("RTN: debe tener 14 dígitos (o 13 si es un DNI).", 400);
    }

    const [rows] = await dbPool.query<Array<RowDataPacket & { name: string; isActive: number }>>(
      `SELECT name, is_active AS isActive FROM clients
       WHERE company_id = ? AND REPLACE(REPLACE(rtn, '-', ''), ' ', '') = ? AND id <> ?
       LIMIT 1`,
      [companyId, rtn, exceptId ?? 0]
    );

    const existing = rows[0];
    if (existing) {
      throw new AppError(
        `Ya existe el cliente ${existing.name} con ese RTN${Number(existing.isActive) ? "" : " (está desactivado, puedes restaurarlo)"}.`,
        409
      );
    }
  }

  private async getById(companyId: number, clientId: number) {
    const [rows] = await dbPool.query<ClientRow[]>(
      `SELECT
        id,
        company_id AS companyId,
        code,
        name,
        rtn,
        email,
        phone,
        address,
        is_generic AS isGeneric,
        is_active AS isActive,
        created_by AS createdBy,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM clients
      WHERE company_id = ? AND id = ?
      LIMIT 1`,
      [companyId, clientId]
    );

    return rows[0];
  }

  /** Cliente "Consumidor final" de la empresa (ventas sin cliente del catálogo). */
  async findGenericId(companyId: number) {
    const [rows] = await dbPool.query<Array<RowDataPacket & { id: number }>>(
      "SELECT id FROM clients WHERE company_id = ? AND is_generic = 1 AND is_active = 1 ORDER BY id LIMIT 1",
      [companyId]
    );
    return rows[0]?.id ?? null;
  }

  async list(companyId: number, query: { search?: string; status: "active" | "inactive" | "all"; page?: number; pageSize?: number }) {
    const pagination = resolvePagination(query.page, query.pageSize);
    const params: Array<string | number> = [companyId];
    const conditions = ["c.company_id = ?"];

    if (query.search) {
      conditions.push("(c.name LIKE ? OR c.rtn LIKE ? OR c.code LIKE ? OR c.phone LIKE ? OR c.email LIKE ?)");
      const search = `%${query.search}%`;
      params.push(search, search, search, search, search);
    }

    if (query.status === "active") {
      conditions.push("c.is_active = 1");
    }

    if (query.status === "inactive") {
      conditions.push("c.is_active = 0");
    }

    const whereClause = conditions.join(" AND ");
    // Saldo y última compra solo de la página visible (subconsultas por fila, con índice por cliente).
    const [items] = await dbPool.query<ClientListRow[]>(
      `SELECT
        c.id,
        c.company_id AS companyId,
        c.code,
        c.name,
        c.rtn,
        c.email,
        c.phone,
        c.address,
        c.is_generic AS isGeneric,
        c.is_active AS isActive,
        c.created_by AS createdBy,
        c.created_at AS createdAt,
        c.updated_at AS updatedAt,
        (SELECT COALESCE(SUM(i.balance), 0) FROM invoices i
          WHERE i.customer_id = c.id AND i.company_id = c.company_id AND i.status = 'EMITIDA' AND i.balance > 0) AS pendingBalance,
        (SELECT MAX(i.invoice_date) FROM invoices i
          WHERE i.customer_id = c.id AND i.company_id = c.company_id AND i.status = 'EMITIDA') AS lastPurchaseDate
      FROM clients c
      WHERE ${whereClause}
      ORDER BY c.id DESC
      LIMIT ? OFFSET ?`,
      [...params, pagination.pageSize, pagination.offset]
    );

    const [countRows] = await dbPool.query<Array<RowDataPacket & { total: number }>>(
      `SELECT COUNT(*) AS total FROM clients c WHERE ${whereClause}`,
      params
    );

    return {
      items: items.map((row) => ({
        ...row,
        pendingBalance: Number(row.pendingBalance ?? 0),
        lastPurchaseDate: dateOnly(row.lastPurchaseDate)
      })),
      pagination: {
        page: pagination.page,
        pageSize: pagination.pageSize,
        total: countRows[0]?.total ?? 0
      }
    };
  }

  /**
   * Código correlativo por empresa (1 = Consumidor final, luego 2, 3...). El contador
   * vive en la base y se bloquea hasta el commit: dos cajas a la vez no repiten código.
   */
  async create(companyId: number, userId: number, payload: ClientPayload) {
    const rtn = normalizeRtn(payload.rtn);
    await this.assertRtn(companyId, rtn);

    const insertId = await withTransaction(async (connection) => {
      const code = await nextDocumentNumber(connection, companyId, "", { table: "clients", column: "code" }, 1);
      const [result] = await connection.execute<ResultSetHeader>(
        `INSERT INTO clients
        (company_id, code, name, rtn, email, phone, address, is_generic, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          companyId,
          code,
          payload.name.trim(),
          rtn,
          this.normalizeNullable(payload.email),
          this.normalizeNullable(payload.phone),
          this.normalizeNullable(payload.address),
          payload.isGeneric ? 1 : 0,
          userId
        ]
      );
      return result.insertId;
    });

    const client = await this.getById(companyId, insertId);

    if (!client) {
      throw new AppError("No se pudo crear el cliente.", 500);
    }

    return client;
  }

  async findOrFail(companyId: number, clientId: number) {
    const client = await this.getById(companyId, clientId);

    if (!client) {
      throw new AppError("Cliente no encontrado para la empresa activa.", 404);
    }

    return client;
  }

  async update(companyId: number, clientId: number, payload: ClientPayload) {
    const current = await this.findOrFail(companyId, clientId);
    if (!Number(current.isActive)) {
      throw new AppError("El cliente está desactivado: restáuralo para poder editarlo.", 409);
    }

    const rtn = normalizeRtn(payload.rtn);
    await this.assertRtn(companyId, rtn, clientId);

    // El código y la marca de cliente genérico no cambian al editar.
    await dbPool.execute(
      `UPDATE clients
      SET name = ?, rtn = ?, email = ?, phone = ?, address = ?, updated_at = CURRENT_TIMESTAMP
      WHERE company_id = ? AND id = ?`,
      [
        payload.name.trim(),
        rtn,
        this.normalizeNullable(payload.email),
        this.normalizeNullable(payload.phone),
        this.normalizeNullable(payload.address),
        companyId,
        clientId
      ]
    );

    return this.findOrFail(companyId, clientId);
  }

  /** Ficha del cliente: compras, saldo pendiente y últimas facturas. */
  async summary(companyId: number, clientId: number) {
    const client = await this.findOrFail(companyId, clientId);

    const [statsRows] = await dbPool.query<ClientStatsRow[]>(
      `SELECT
        COUNT(*) AS invoiceCount,
        COALESCE(SUM(grand_total), 0) AS totalPurchased,
        MAX(invoice_date) AS lastPurchaseDate,
        COALESCE(SUM(CASE WHEN balance > 0 THEN balance ELSE 0 END), 0) AS pendingBalance,
        COALESCE(SUM(CASE WHEN balance > 0 AND due_date IS NOT NULL AND due_date < CURDATE() THEN 1 ELSE 0 END), 0) AS overdueCount
      FROM invoices
      WHERE company_id = ? AND customer_id = ? AND status = 'EMITIDA'`,
      [companyId, clientId]
    );

    const [invoiceRows] = await dbPool.query<ClientInvoiceRow[]>(
      `SELECT id, invoice_number AS invoiceNumber, invoice_date AS invoiceDate, sale_type AS saleType,
              grand_total AS grandTotal, balance
       FROM invoices
       WHERE company_id = ? AND customer_id = ? AND status = 'EMITIDA'
       ORDER BY invoice_date DESC, id DESC
       LIMIT 5`,
      [companyId, clientId]
    );

    const stats = statsRows[0];

    return {
      client,
      stats: {
        invoiceCount: Number(stats?.invoiceCount ?? 0),
        totalPurchased: Number(stats?.totalPurchased ?? 0),
        lastPurchaseDate: dateOnly(stats?.lastPurchaseDate ?? null),
        pendingBalance: Number(stats?.pendingBalance ?? 0),
        overdueCount: Number(stats?.overdueCount ?? 0)
      },
      recentInvoices: invoiceRows.map((row) => ({
        id: row.id,
        invoiceNumber: row.invoiceNumber,
        invoiceDate: dateOnly(row.invoiceDate),
        saleType: row.saleType,
        grandTotal: Number(row.grandTotal),
        balance: Number(row.balance)
      }))
    };
  }

  async updateStatus(companyId: number, clientId: number, isActive: boolean) {
    const client = await this.findOrFail(companyId, clientId);
    if (!isActive) {
      await deactivationRules.client(companyId, { id: clientId, name: client.name, isGeneric: client.isGeneric });
    }

    await dbPool.execute(
      `UPDATE clients
      SET is_active = ?, updated_at = CURRENT_TIMESTAMP
      WHERE company_id = ? AND id = ?`,
      [isActive ? 1 : 0, companyId, clientId]
    );

    return this.findOrFail(companyId, clientId);
  }
}

export const clientsService = new ClientsService();
