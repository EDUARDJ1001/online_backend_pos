import type { ResultSetHeader, RowDataPacket } from "mysql2";

import { dbPool, type DbConnection } from "../../config/db";
import { resolvePagination } from "../../utils/pagination";
import { nextDocumentNumber } from "../../utils/document-counter";
import { AppError } from "../../utils/http-error";
import { cajaService, NO_CASH_CONTEXT, type CashContext } from "../caja/caja.service";

export type PaymentMethod = "EFECTIVO" | "TRANSFERENCIA" | "CHEQUE" | "TARJETA" | "OTRO";

interface ReceivableRow extends RowDataPacket {
  id: number;
  invoiceNumber: string;
  invoiceDate: string | Date;
  dueDate: string | Date | null;
  customerId: number | null;
  customerName: string;
  customerRtn: string | null;
  grandTotal: number;
  paidAmount: number;
  balance: number;
  paymentStatus: string;
  saleType: string;
}

interface PaymentRow extends RowDataPacket {
  id: number;
  invoiceId: number;
  receiptNumber: string | null;
  paymentDate: string | Date;
  amount: number;
  method: PaymentMethod;
  reference: string | null;
  notes: string | null;
  createdAt: string;
}

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

const RECEIVABLE_COLUMNS = `
  i.id,
  i.invoice_number AS invoiceNumber,
  i.invoice_date AS invoiceDate,
  i.due_date AS dueDate,
  i.customer_id AS customerId,
  i.customer_name_snapshot AS customerName,
  i.customer_rtn_snapshot AS customerRtn,
  i.grand_total AS grandTotal,
  i.paid_amount AS paidAmount,
  i.balance,
  i.payment_status AS paymentStatus,
  i.sale_type AS saleType`;

class ReceivablesService {
  private mapReceivable(row: ReceivableRow) {
    return {
      ...row,
      invoiceDate: dateOnly(row.invoiceDate),
      dueDate: dateOnly(row.dueDate)
    };
  }

  async list(
    companyId: number,
    query: { search?: string; overdue?: boolean; dateFrom?: string; dateTo?: string; page?: number; pageSize?: number }
  ) {
    const pagination = resolvePagination(query.page, query.pageSize);
    const params: Array<string | number> = [companyId];
    const conditions = ["i.company_id = ?", "i.status = 'EMITIDA'", "i.balance > 0"];

    if (query.search) {
      conditions.push("(i.invoice_number LIKE ? OR i.customer_name_snapshot LIKE ?)");
      params.push(`%${query.search}%`, `%${query.search}%`);
    }

    if (query.overdue) {
      conditions.push("i.due_date IS NOT NULL AND i.due_date < CURDATE()");
    }

    if (query.dateFrom) {
      conditions.push("i.invoice_date >= ?");
      params.push(query.dateFrom);
    }

    if (query.dateTo) {
      conditions.push("i.invoice_date <= ?");
      params.push(query.dateTo);
    }

    const whereClause = conditions.join(" AND ");
    const [items] = await dbPool.query<ReceivableRow[]>(
      `SELECT ${RECEIVABLE_COLUMNS} FROM invoices i WHERE ${whereClause} ORDER BY i.invoice_date DESC, i.id DESC LIMIT ? OFFSET ?`,
      [...params, pagination.pageSize, pagination.offset]
    );

    const [summaryRows] = await dbPool.query<Array<RowDataPacket & { total: number; totalBalance: number }>>(
      `SELECT COUNT(*) AS total, COALESCE(SUM(i.balance), 0) AS totalBalance FROM invoices i WHERE ${whereClause}`,
      params
    );

    return {
      items: items.map((row) => this.mapReceivable(row)),
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

  async findInvoiceOrFail(companyId: number, invoiceId: number) {
    const [rows] = await dbPool.query<ReceivableRow[]>(
      `SELECT ${RECEIVABLE_COLUMNS} FROM invoices i WHERE i.company_id = ? AND i.id = ? LIMIT 1`,
      [companyId, invoiceId]
    );

    const row = rows[0];

    if (!row) {
      throw new AppError("Factura no encontrada para la empresa activa.", 404);
    }

    return this.mapReceivable(row);
  }

  private async listPayments(companyId: number, invoiceId: number) {
    const [rows] = await dbPool.query<PaymentRow[]>(
      `SELECT
        id,
        invoice_id AS invoiceId,
        receipt_number AS receiptNumber,
        payment_date AS paymentDate,
        amount,
        method,
        reference,
        notes,
        created_at AS createdAt
      FROM invoice_payments
      WHERE company_id = ? AND invoice_id = ?
      ORDER BY payment_date DESC, id DESC`,
      [companyId, invoiceId]
    );

    return rows.map((row) => ({ ...row, paymentDate: dateOnly(row.paymentDate) }));
  }

  async getDetail(companyId: number, invoiceId: number) {
    const invoice = await this.findInvoiceOrFail(companyId, invoiceId);
    const payments = await this.listPayments(companyId, invoiceId);

    return { invoice, payments };
  }

  /** Siguiente recibo REC-NNNNNN: contador bloqueado en la base (sin repetirse entre cajas). */
  private async nextReceiptNumber(connection: DbConnection, companyId: number) {
    return nextDocumentNumber(connection, companyId, "REC-", { table: "invoice_payments", column: "receipt_number" });
  }

  async registerPayment(
    companyId: number,
    userId: number,
    invoiceId: number,
    payload: RegisterPaymentPayload,
    cashContext: CashContext = NO_CASH_CONTEXT
  ) {
    const connection = await dbPool.getConnection();

    try {
      await connection.beginTransaction();

      const [rows] = await connection.query<
        Array<RowDataPacket & { grandTotal: number; paidAmount: number; balance: number; status: string; paymentStatus: string; invoiceDate: string | Date }>
      >(
        `SELECT grand_total AS grandTotal, paid_amount AS paidAmount, balance, status, payment_status AS paymentStatus, invoice_date AS invoiceDate
         FROM invoices WHERE company_id = ? AND id = ? FOR UPDATE`,
        [companyId, invoiceId]
      );

      const invoice = rows[0];

      if (!invoice) {
        throw new AppError("Factura no encontrada para la empresa activa.", 404);
      }

      if (invoice.status !== "EMITIDA") {
        throw new AppError("No se pueden registrar abonos en una factura anulada.", 400);
      }

      if (invoice.paymentStatus === "PAGADA") {
        throw new AppError("La factura ya está pagada por completo.", 400);
      }

      if (payload.paymentDate < dateOnly(invoice.invoiceDate)!) {
        throw new AppError("La fecha del abono no puede ser anterior a la fecha de la factura.", 400);
      }

      const amount = round2(payload.amount);

      if (amount <= 0) {
        throw new AppError("El monto del abono debe ser mayor que cero.", 400);
      }

      const balance = round2(Number(invoice.balance));

      if (amount > balance + 0.005) {
        throw new AppError(`El abono supera el saldo pendiente (${balance.toFixed(2)}).`, 400);
      }

      const receiptNumber = normalize(payload.receiptNumber) ?? (await this.nextReceiptNumber(connection, companyId));

      let result: ResultSetHeader;
      try {
        [result] = await connection.execute<ResultSetHeader>(
          `INSERT INTO invoice_payments
          (company_id, invoice_id, receipt_number, payment_date, amount, method, reference, notes, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            companyId,
            invoiceId,
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

      const newPaid = round2(Number(invoice.paidAmount) + amount);
      const newBalance = round2(Number(invoice.grandTotal) - newPaid);
      const newStatus = newBalance <= 0.005 ? "PAGADA" : "PARCIAL";

      await connection.execute(
        "UPDATE invoices SET paid_amount = ?, balance = ?, payment_status = ?, updated_at = CURRENT_TIMESTAMP WHERE company_id = ? AND id = ?",
        [newPaid, Math.max(0, newBalance), newStatus, companyId, invoiceId]
      );

      // Caja: si el equipo tiene su caja abierta, el abono entra al ledger (con bloqueo compartido).
      const openSession = await cajaService.lockSessionForOperation(connection, companyId, cashContext, { required: false });
      if (openSession) {
        await cajaService.recordMovement(connection, {
          companyId,
          sessionId: openSession.id,
          userId,
          type: "ABONO_CXC",
          method: payload.method,
          amount,
          referenceType: "invoice_payment",
          referenceId: result.insertId,
          description: `Abono ${receiptNumber}`
        });
      }

      await connection.commit();

      return {
        paymentId: result.insertId,
        receiptNumber,
        invoice: await this.findInvoiceOrFail(companyId, invoiceId)
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  /** Estado de cuenta: facturas a crédito del cliente + abonos, con saldo. */
  async clientStatement(companyId: number, clientId: number) {
    const [clientRows] = await dbPool.query<Array<RowDataPacket & { id: number; name: string; rtn: string | null; phone: string | null; address: string | null }>>(
      "SELECT id, name, rtn, phone, address FROM clients WHERE company_id = ? AND id = ? LIMIT 1",
      [companyId, clientId]
    );

    const client = clientRows[0];

    if (!client) {
      throw new AppError("Cliente no encontrado para la empresa activa.", 404);
    }

    const [invoiceRows] = await dbPool.query<ReceivableRow[]>(
      `SELECT ${RECEIVABLE_COLUMNS} FROM invoices i
       WHERE i.company_id = ? AND i.customer_id = ? AND i.status = 'EMITIDA' AND i.sale_type = 'CREDITO'
       ORDER BY i.invoice_date ASC, i.id ASC`,
      [companyId, clientId]
    );

    const [paymentRows] = await dbPool.query<Array<PaymentRow & { invoiceNumber: string }>>(
      `SELECT
        p.id,
        p.invoice_id AS invoiceId,
        i.invoice_number AS invoiceNumber,
        p.receipt_number AS receiptNumber,
        p.payment_date AS paymentDate,
        p.amount,
        p.method,
        p.reference,
        p.notes,
        p.created_at AS createdAt
      FROM invoice_payments p
      INNER JOIN invoices i ON i.id = p.invoice_id
      WHERE p.company_id = ? AND i.customer_id = ? AND i.sale_type = 'CREDITO'
      ORDER BY p.payment_date ASC, p.id ASC`,
      [companyId, clientId]
    );

    const totalCharged = round2(invoiceRows.reduce((sum, row) => sum + Number(row.grandTotal), 0));
    const totalPaid = round2(paymentRows.reduce((sum, row) => sum + Number(row.amount), 0));

    return {
      client: { id: client.id, name: client.name, rtn: client.rtn, phone: client.phone, address: client.address },
      invoices: invoiceRows.map((row) => this.mapReceivable(row)),
      payments: paymentRows.map((row) => ({ ...row, paymentDate: dateOnly(row.paymentDate) })),
      totals: {
        charged: totalCharged,
        paid: totalPaid,
        balance: round2(totalCharged - totalPaid)
      }
    };
  }
}

export const receivablesService = new ReceivablesService();
