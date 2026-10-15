import type { RowDataPacket } from "mysql2";

import { dbPool } from "../../config/db";
import type { SalesReportQuery } from "./reports.schemas";

function num(value: unknown) {
  return Number(value ?? 0);
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

class ReportsService {
  private buildWhere(companyId: number, query: SalesReportQuery) {
    const params: Array<string | number> = [companyId, query.dateFrom, query.dateTo];
    const conditions = ["i.company_id = ?", "i.invoice_date BETWEEN ? AND ?"];

    if (query.status !== "all") {
      conditions.push("i.status = ?");
      params.push(query.status);
    }

    if (query.saleType !== "all") {
      conditions.push("i.sale_type = ?");
      params.push(query.saleType);
    }

    if (query.customerId) {
      conditions.push("i.customer_id = ?");
      params.push(query.customerId);
    }

    if (query.warehouseId) {
      conditions.push("i.warehouse_id = ?");
      params.push(query.warehouseId);
    }

    return { whereClause: conditions.join(" AND "), params };
  }

  async salesReport(companyId: number, query: SalesReportQuery) {
    const { whereClause, params } = this.buildWhere(companyId, query);

    const [summaryRows] = await dbPool.query<Array<RowDataPacket & Record<string, number>>>(
      `SELECT
        COUNT(*) AS documents,
        COALESCE(SUM(i.subtotal), 0) AS subtotal,
        COALESCE(SUM(i.discount_total), 0) AS discountTotal,
        COALESCE(SUM(i.taxable_amount_15), 0) AS taxable15,
        COALESCE(SUM(i.taxable_amount_18), 0) AS taxable18,
        COALESCE(SUM(i.exempt_amount), 0) AS exempt,
        COALESCE(SUM(i.isv_15), 0) AS isv15,
        COALESCE(SUM(i.isv_18), 0) AS isv18,
        COALESCE(SUM(i.grand_total), 0) AS grandTotal,
        COALESCE(SUM(CASE WHEN i.sale_type = 'CONTADO' THEN i.grand_total ELSE 0 END), 0) AS contadoTotal,
        COALESCE(SUM(CASE WHEN i.sale_type = 'CREDITO' THEN i.grand_total ELSE 0 END), 0) AS creditoTotal
      FROM invoices i
      WHERE ${whereClause}`,
      params
    );

    const summaryRow = (summaryRows[0] ?? {}) as Record<string, number>;

    const [byDayRows] = await dbPool.query<Array<RowDataPacket & { day: string | Date; documents: number; total: number }>>(
      `SELECT i.invoice_date AS day, COUNT(*) AS documents, COALESCE(SUM(i.grand_total), 0) AS total
       FROM invoices i WHERE ${whereClause}
       GROUP BY i.invoice_date ORDER BY i.invoice_date ASC`,
      params
    );

    const [byMethodRows] = await dbPool.query<Array<RowDataPacket & { method: string; documents: number; total: number }>>(
      `SELECT
        CASE WHEN i.sale_type = 'CREDITO' THEN 'CREDITO' ELSE COALESCE(i.tender_method, 'EFECTIVO') END AS method,
        COUNT(*) AS documents,
        COALESCE(SUM(i.grand_total), 0) AS total
       FROM invoices i WHERE ${whereClause}
       GROUP BY CASE WHEN i.sale_type = 'CREDITO' THEN 'CREDITO' ELSE COALESCE(i.tender_method, 'EFECTIVO') END
       ORDER BY total DESC`,
      params
    );

    const [byProductRows] = await dbPool.query<Array<RowDataPacket & { productId: number | null; description: string; quantity: number; total: number }>>(
      `SELECT it.product_id AS productId, it.description, COALESCE(SUM(it.quantity), 0) AS quantity, COALESCE(SUM(it.line_total), 0) AS total
       FROM invoice_items it
       INNER JOIN invoices i ON i.id = it.invoice_id
       WHERE ${whereClause}
       GROUP BY it.product_id, it.description
       ORDER BY total DESC
       LIMIT 20`,
      params
    );

    const [invoiceRows] = await dbPool.query<Array<RowDataPacket & Record<string, unknown>>>(
      `SELECT
        i.id,
        i.invoice_number AS invoiceNumber,
        i.invoice_date AS invoiceDate,
        i.customer_name_snapshot AS customerName,
        i.customer_rtn_snapshot AS customerRtn,
        i.sale_type AS saleType,
        i.tender_method AS tenderMethod,
        i.payment_status AS paymentStatus,
        i.status,
        i.subtotal,
        i.discount_total AS discountTotal,
        i.isv_15 AS isv15,
        i.isv_18 AS isv18,
        i.grand_total AS grandTotal,
        i.balance
      FROM invoices i WHERE ${whereClause}
      ORDER BY i.invoice_date DESC, i.id DESC
      LIMIT 1000`,
      params
    );

    return {
      filters: query,
      summary: {
        documents: num(summaryRow.documents),
        subtotal: num(summaryRow.subtotal),
        discountTotal: num(summaryRow.discountTotal),
        taxable15: num(summaryRow.taxable15),
        taxable18: num(summaryRow.taxable18),
        exempt: num(summaryRow.exempt),
        isv15: num(summaryRow.isv15),
        isv18: num(summaryRow.isv18),
        taxTotal: num(summaryRow.isv15) + num(summaryRow.isv18),
        grandTotal: num(summaryRow.grandTotal),
        contadoTotal: num(summaryRow.contadoTotal),
        creditoTotal: num(summaryRow.creditoTotal)
      },
      byDay: byDayRows.map((row) => ({ day: dateOnly(row.day), documents: num(row.documents), total: num(row.total) })),
      byPaymentMethod: byMethodRows.map((row) => ({ method: row.method, documents: num(row.documents), total: num(row.total) })),
      byProduct: byProductRows.map((row) => ({
        productId: row.productId,
        description: row.description,
        quantity: num(row.quantity),
        total: num(row.total)
      })),
      invoices: invoiceRows.map((row) => ({
        id: row.id as number,
        invoiceNumber: row.invoiceNumber as string,
        invoiceDate: dateOnly(row.invoiceDate as string | Date),
        customerName: row.customerName as string,
        customerRtn: (row.customerRtn as string | null) ?? null,
        saleType: row.saleType as string,
        tenderMethod: (row.tenderMethod as string | null) ?? null,
        paymentStatus: row.paymentStatus as string,
        status: row.status as string,
        subtotal: num(row.subtotal),
        discountTotal: num(row.discountTotal),
        isv15: num(row.isv15),
        isv18: num(row.isv18),
        grandTotal: num(row.grandTotal),
        balance: num(row.balance)
      }))
    };
  }
}

export const reportsService = new ReportsService();
