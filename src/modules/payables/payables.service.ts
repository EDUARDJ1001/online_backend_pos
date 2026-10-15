import type { ResultSetHeader, RowDataPacket } from "mysql2";

import { dbPool, type DbConnection } from "../../config/db";
import { resolvePagination } from "../../utils/pagination";
import { nextDocumentNumber } from "../../utils/document-counter";
import { AppError } from "../../utils/http-error";
import { cajaService, NO_CASH_CONTEXT, type CashContext } from "../caja/caja.service";

export type PaymentMethod = "EFECTIVO" | "TRANSFERENCIA" | "CHEQUE" | "TARJETA" | "OTRO";

interface PayableRow extends RowDataPacket {
  id: number;
  supplierId: number;
  supplierName: string;
  documentNumber: string;
  documentDate: string | Date;
  dueDate: string | Date | null;
  description: string | null;
  total: number;
  paidAmount: number;
  balance: number;
  status: string;
  notes: string | null;
}

interface PayablePaymentRow extends RowDataPacket {
  id: number;
  payableDocumentId: number;
  receiptNumber: string | null;
  paymentDate: string | Date;
  amount: number;
  method: PaymentMethod;
  reference: string | null;
  notes: string | null;
  createdAt: string;
}

export type CreatePayablePayload = {
  supplierId: number;
  documentNumber: string;
  documentDate: string;
  dueDate?: string;
  description?: string;
  total: number;
  notes?: string;
};

export type RegisterPaymentPayload = {
  amount: number;
  paymentDate: string;
  method: PaymentMethod;
  reference?: string;
  receiptNumber?: string;
  notes?: string;
};

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
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

  return value.slice(0, 10);
}

function normalize(value?: string | null) {
  return value?.trim() ? value.trim() : null;
}

const PAYABLE_COLUMNS = `
  d.id,
  d.supplier_id AS supplierId,
  s.name AS supplierName,
  d.document_number AS documentNumber,
  d.document_date AS documentDate,
  d.due_date AS dueDate,
  d.description,
  d.total,
  d.paid_amount AS paidAmount,
  d.balance,
  d.status,
  d.notes`;

class PayablesService {
  private mapDocument(row: PayableRow) {
    return {
      ...row,
      documentDate: dateOnly(row.documentDate),
      dueDate: dateOnly(row.dueDate)
    };
  }

  async list(
    companyId: number,
    query: { search?: string; overdue?: boolean; includePaid?: boolean; dateFrom?: string; dateTo?: string; page?: number; pageSize?: number }
  ) {
    const pagination = resolvePagination(query.page, query.pageSize);
    const params: Array<string | number> = [companyId];
    const conditions = ["d.company_id = ?", "d.status <> 'ANULADA'"];

    if (!query.includePaid) {
      conditions.push("d.balance > 0");
    }

    if (query.search) {
      conditions.push("(d.document_number LIKE ? OR s.name LIKE ?)");
      params.push(`%${query.search}%`, `%${query.search}%`);
    }

    if (query.overdue) {
      conditions.push("d.due_date IS NOT NULL AND d.due_date < CURDATE() AND d.balance > 0");
    }

    if (query.dateFrom) {
      conditions.push("d.document_date >= ?");
      params.push(query.dateFrom);
    }

    if (query.dateTo) {
      conditions.push("d.document_date <= ?");
      params.push(query.dateTo);
    }

    const whereClause = conditions.join(" AND ");
    const [items] = await dbPool.query<PayableRow[]>(
      `SELECT ${PAYABLE_COLUMNS}
       FROM payable_documents d
       INNER JOIN suppliers s ON s.id = d.supplier_id
       WHERE ${whereClause}
       ORDER BY d.document_date DESC, d.id DESC
       LIMIT ? OFFSET ?`,
      [...params, pagination.pageSize, pagination.offset]
    );

    const [summaryRows] = await dbPool.query<Array<RowDataPacket & { total: number; totalBalance: number }>>(
      `SELECT COUNT(*) AS total, COALESCE(SUM(d.balance), 0) AS totalBalance
       FROM payable_documents d
       INNER JOIN suppliers s ON s.id = d.supplier_id
       WHERE ${whereClause}`,
      params
    );

    return {
      items: items.map((row) => this.mapDocument(row)),
      summary: {
        totalDue: Number(summaryRows[0]?.totalBalance ?? 0),
        documents: Number(summaryRows[0]?.total ?? 0)
      },
      pagination: {
        page: pagination.page,
        pageSize: pagination.pageSize,
        total: Number(summaryRows[0]?.total ?? 0)
      }
    };
  }

  async findDocumentOrFail(companyId: number, documentId: number) {
    const [rows] = await dbPool.query<PayableRow[]>(
      `SELECT ${PAYABLE_COLUMNS}
       FROM payable_documents d
       INNER JOIN suppliers s ON s.id = d.supplier_id
       WHERE d.company_id = ? AND d.id = ? LIMIT 1`,
      [companyId, documentId]
    );

    const row = rows[0];

    if (!row) {
      throw new AppError("Documento por pagar no encontrado para la empresa activa.", 404);
    }

    return this.mapDocument(row);
  }

  async create(companyId: number, userId: number, payload: CreatePayablePayload) {
    const [supplierRows] = await dbPool.query<Array<RowDataPacket & { id: number }>>(
      "SELECT id FROM suppliers WHERE company_id = ? AND id = ? AND is_active = 1 LIMIT 1",
      [companyId, payload.supplierId]
    );

    if (!supplierRows[0]) {
      throw new AppError("El proveedor no existe o está inactivo.", 400);
    }

    const total = round2(payload.total);

    if (total <= 0) {
      throw new AppError("El total del documento debe ser mayor que cero.", 400);
    }

    try {
      const [result] = await dbPool.execute<ResultSetHeader>(
        `INSERT INTO payable_documents
        (company_id, supplier_id, document_number, document_date, due_date, description, total, paid_amount, balance, status, notes, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 'PENDIENTE', ?, ?)`,
        [
          companyId,
          payload.supplierId,
          payload.documentNumber.trim(),
          payload.documentDate,
          normalize(payload.dueDate),
          normalize(payload.description),
          total,
          total,
          normalize(payload.notes),
          userId
        ]
      );

      return this.findDocumentOrFail(companyId, result.insertId);
    } catch (error) {
      if (error instanceof Error && (error as { code?: string }).code === "ER_DUP_ENTRY") {
        throw new AppError("Ya existe un documento con ese número para el proveedor.", 409);
      }

      throw error;
    }
  }

  async voidDocument(companyId: number, documentId: number) {
    const document = await this.findDocumentOrFail(companyId, documentId);

    if (Number(document.paidAmount) > 0) {
      throw new AppError("No se puede anular un documento con abonos registrados.", 400);
    }

    await dbPool.execute(
      "UPDATE payable_documents SET status = 'ANULADA', balance = 0, updated_at = CURRENT_TIMESTAMP WHERE company_id = ? AND id = ?",
      [companyId, documentId]
    );

    return this.findDocumentOrFail(companyId, documentId);
  }

  private async listPayments(companyId: number, documentId: number) {
    const [rows] = await dbPool.query<PayablePaymentRow[]>(
      `SELECT
        id,
        payable_document_id AS payableDocumentId,
        receipt_number AS receiptNumber,
        payment_date AS paymentDate,
        amount,
        method,
        reference,
        notes,
        created_at AS createdAt
      FROM payable_payments
      WHERE company_id = ? AND payable_document_id = ?
      ORDER BY payment_date DESC, id DESC`,
      [companyId, documentId]
    );

    return rows.map((row) => ({ ...row, paymentDate: dateOnly(row.paymentDate) }));
  }

  async getDetail(companyId: number, documentId: number) {
    const document = await this.findDocumentOrFail(companyId, documentId);
    const payments = await this.listPayments(companyId, documentId);

    return { document, payments };
  }

  /** Siguiente recibo PG-NNNNNN: contador bloqueado en la base (sin repetirse entre cajas). */
  private async nextReceiptNumber(connection: DbConnection, companyId: number) {
    return nextDocumentNumber(connection, companyId, "PG-", { table: "payable_payments", column: "receipt_number" });
  }

  async registerPayment(
    companyId: number,
    userId: number,
    documentId: number,
    payload: RegisterPaymentPayload,
    cashContext: CashContext = NO_CASH_CONTEXT
  ) {
    const connection = await dbPool.getConnection();

    try {
      await connection.beginTransaction();

      const [rows] = await connection.query<Array<RowDataPacket & { total: number; paidAmount: number; balance: number; status: string; documentDate: string | Date }>>(
        `SELECT total, paid_amount AS paidAmount, balance, status, document_date AS documentDate
         FROM payable_documents WHERE company_id = ? AND id = ? FOR UPDATE`,
        [companyId, documentId]
      );

      const document = rows[0];

      if (!document) {
        throw new AppError("Documento por pagar no encontrado para la empresa activa.", 404);
      }

      if (document.status === "ANULADA") {
        throw new AppError("El documento está anulado.", 400);
      }

      if (document.status === "PAGADA") {
        throw new AppError("El documento ya está pagado por completo.", 400);
      }

      if (payload.paymentDate < dateOnly(document.documentDate)!) {
        throw new AppError("La fecha del pago no puede ser anterior a la fecha del documento.", 400);
      }

      const amount = round2(payload.amount);

      if (amount <= 0) {
        throw new AppError("El monto del abono debe ser mayor que cero.", 400);
      }

      const balance = round2(Number(document.balance));

      if (amount > balance + 0.005) {
        throw new AppError(`El abono supera el saldo pendiente (${balance.toFixed(2)}).`, 400);
      }

      const receiptNumber = normalize(payload.receiptNumber) ?? (await this.nextReceiptNumber(connection, companyId));

      let result: ResultSetHeader;
      try {
        [result] = await connection.execute<ResultSetHeader>(
          `INSERT INTO payable_payments
          (company_id, payable_document_id, receipt_number, payment_date, amount, method, reference, notes, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            companyId,
            documentId,
            receiptNumber,
            payload.paymentDate,
            amount,
            payload.method,
            normalize(payload.reference),
            normalize(payload.notes),
            userId
          ]
        );
      } catch (error) {
        if ((error as { code?: string }).code === "ER_DUP_ENTRY") {
          throw new AppError(`El número de recibo ${receiptNumber} ya existe. Usa otro o déjalo vacío para asignarlo automáticamente.`, 409);
        }
        throw error;
      }

      const newPaid = round2(Number(document.paidAmount) + amount);
      const newBalance = round2(Number(document.total) - newPaid);
      const newStatus = newBalance <= 0.005 ? "PAGADA" : "PARCIAL";

      await connection.execute(
        "UPDATE payable_documents SET paid_amount = ?, balance = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE company_id = ? AND id = ?",
        [newPaid, Math.max(0, newBalance), newStatus, companyId, documentId]
      );

      // Caja: si el equipo tiene su caja abierta, el pago sale del ledger (con bloqueo compartido).
      const openSession = await cajaService.lockSessionForOperation(connection, companyId, cashContext, { required: false });
      if (openSession) {
        await cajaService.recordMovement(connection, {
          companyId,
          sessionId: openSession.id,
          userId,
          type: "PAGO_CXP",
          method: payload.method,
          amount,
          referenceType: "payable_payment",
          referenceId: result.insertId,
          description: `Pago ${receiptNumber}`
        });
      }

      await connection.commit();

      return {
        paymentId: result.insertId,
        receiptNumber,
        document: await this.findDocumentOrFail(companyId, documentId)
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async supplierStatement(companyId: number, supplierId: number) {
    const [supplierRows] = await dbPool.query<Array<RowDataPacket & { id: number; name: string; rtn: string | null; phone: string | null; address: string | null }>>(
      "SELECT id, name, rtn, phone, address FROM suppliers WHERE company_id = ? AND id = ? LIMIT 1",
      [companyId, supplierId]
    );

    const supplier = supplierRows[0];

    if (!supplier) {
      throw new AppError("Proveedor no encontrado para la empresa activa.", 404);
    }

    const [documentRows] = await dbPool.query<PayableRow[]>(
      `SELECT ${PAYABLE_COLUMNS}
       FROM payable_documents d
       INNER JOIN suppliers s ON s.id = d.supplier_id
       WHERE d.company_id = ? AND d.supplier_id = ? AND d.status <> 'ANULADA'
       ORDER BY d.document_date ASC, d.id ASC`,
      [companyId, supplierId]
    );

    const [paymentRows] = await dbPool.query<Array<PayablePaymentRow & { documentNumber: string }>>(
      `SELECT
        p.id,
        p.payable_document_id AS payableDocumentId,
        d.document_number AS documentNumber,
        p.receipt_number AS receiptNumber,
        p.payment_date AS paymentDate,
        p.amount,
        p.method,
        p.reference,
        p.notes,
        p.created_at AS createdAt
      FROM payable_payments p
      INNER JOIN payable_documents d ON d.id = p.payable_document_id
      WHERE p.company_id = ? AND d.supplier_id = ? AND d.status <> 'ANULADA'
      ORDER BY p.payment_date ASC, p.id ASC`,
      [companyId, supplierId]
    );

    const totalCharged = round2(documentRows.reduce((sum, row) => sum + Number(row.total), 0));
    const totalPaid = round2(paymentRows.reduce((sum, row) => sum + Number(row.amount), 0));

    return {
      supplier: { id: supplier.id, name: supplier.name, rtn: supplier.rtn, phone: supplier.phone, address: supplier.address },
      documents: documentRows.map((row) => this.mapDocument(row)),
      payments: paymentRows.map((row) => ({ ...row, paymentDate: dateOnly(row.paymentDate) })),
      totals: {
        charged: totalCharged,
        paid: totalPaid,
        balance: round2(totalCharged - totalPaid)
      }
    };
  }
}

export const payablesService = new PayablesService();
