import type { ResultSetHeader, RowDataPacket } from "mysql2";

import { dbPool, type DbConnection, acquireNamedLock, releaseNamedLock } from "../../config/db";
import { padProductCodes } from "../../utils/product-code";
import { AppError } from "../../utils/http-error";
import { amountToSpanishWords } from "../../utils/number-to-words-es";
import { resolvePagination } from "../../utils/pagination";
import { NO_CASH_CONTEXT, type CashContext } from "../caja/caja.service";
import { clientsService, isGenericCustomer } from "../clients/clients.service";
import { invoicesService } from "../invoices/invoices.service";
import { productsService } from "../products/products.service";
import { settingsService } from "../settings/settings.service";
import { warehousesService } from "../warehouses/warehouses.service";
import { isCountableUnit } from "../inventory/inventory-rules";

type DbDateValue = string | Date;
type QuoteStatus = "BORRADOR" | "ENVIADA" | "APROBADA" | "RECHAZADA" | "VENCIDA" | "FACTURADA";

interface QuoteSeriesLockRow extends RowDataPacket {
  id: number;
  prefix: string;
  currentNumber: number;
}

interface QuoteRow extends RowDataPacket {
  id: number;
  companyId: number;
  quoteSeriesId: number;
  customerId: number | null;
  warehouseId: number | null;
  warehouseName: string | null;
  sequenceNumber: number;
  quoteNumber: string;
  quoteDate: DbDateValue;
  validUntil: DbDateValue | null;
  customerNameSnapshot: string;
  customerRtnSnapshot: string | null;
  customerEmailSnapshot: string | null;
  customerPhoneSnapshot: string | null;
  customerAddressSnapshot: string | null;
  subtotal: number;
  discountTotal: number;
  taxableAmount15: number;
  taxableAmount18: number;
  exemptAmount: number;
  exoneratedAmount: number;
  isv15: number;
  isv18: number;
  taxTotal: number;
  grandTotal: number;
  totalInWords: string | null;
  status: QuoteStatus;
  approvedAt: string | Date | null;
  approvedBy: number | null;
  approvedByName: string | null;
  convertedToInvoiceId: number | null;
  convertedToInvoiceNumber: string | null;
  notes: string | null;
  createdBy: number;
  createdByName: string;
  createdAt: string | Date;
  updatedAt: string | Date;
  companyCommercialName: string;
  companyLegalName: string;
  companyRtn: string;
  companyEmail: string | null;
  companyPhone: string | null;
  companyAddress: string | null;
  companyPrimaryColor: string | null;
  companyHeaderColor: string | null;
  companySidebarColor: string | null;
  companyLogoUrl: string | null;
  companyDocumentColor: string | null;
  footerText: string | null;
  payableTo: string | null;
  defaultTaxRate: number | null;
}

interface QuoteItemRow extends RowDataPacket {
  id: number;
  quoteId: number;
  productId: number | null;
  productCode: string | null;
  productName: string | null;
  lineNumber: number;
  quantity: number;
  description: string;
  unitPrice: number;
  unitCostSnapshot: number | null;
  taxRate: number;
  lineDiscount: number;
  lineSubtotal: number;
  lineTax: number;
  lineTotal: number;
  affectsInventory: number;
}

type CreateQuotePayload = {
  customerId?: number;
  warehouseId?: number;
  customer?: {
    name: string;
    rtn?: string;
    email?: string;
    phone?: string;
    address?: string;
  };
  quoteDate: string;
  validUntil?: string;
  notes?: string;
  items: Array<{
    productId?: number;
    description?: string;
    quantity: number;
    unitPrice?: number;
    lineDiscount: number;
  }>;
};

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function dateOnly(value: DbDateValue) {
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  return value.slice(0, 10);
}

function nullableDateOnly(value: DbDateValue | null) {
  return value ? dateOnly(value) : null;
}

function dateTimeValue(value: string | Date | null) {
  if (!value) {
    return null;
  }

  return value instanceof Date ? value.toISOString() : value;
}

/** Forma que consumen el PDF y el frontend de cotizaciones. */
export type QuoteDetail = Awaited<ReturnType<QuotesService["getDetail"]>>;

class QuotesService {
  private normalizeNullable(value?: string) {
    return value?.trim() ? value.trim() : null;
  }

  private async findActiveQuoteSeries(connection: DbConnection, companyId: number) {
    const [seriesRows] = await connection.query<QuoteSeriesLockRow[]>(
      `SELECT
        id,
        prefix,
        current_number AS currentNumber
      FROM quote_series
      WHERE company_id = ?
        AND is_active = 1
      ORDER BY id DESC
      LIMIT 1
      FOR UPDATE`,
      [companyId]
    );

    return seriesRows[0];
  }

  private async ensureActiveQuoteSeries(connection: DbConnection, companyId: number) {
    // Activa la serie de la empresa; si no existe, la crea (única por empresa).
    const [updated] = await connection.execute<{ affectedRows: number }>(
      "UPDATE quote_series SET is_active = 1, updated_at = CURRENT_TIMESTAMP WHERE company_id = ?",
      [companyId]
    );
    if (!updated.affectedRows) {
      await connection.execute(
        "INSERT INTO quote_series (company_id, prefix, current_number, is_active) VALUES (?, 'COT-', 1, 1)",
        [companyId]
      );
    }

    return this.findActiveQuoteSeries(connection, companyId);
  }

  private async takeNextQuoteNumber(connection: DbConnection, companyId: number) {
    let series = await this.findActiveQuoteSeries(connection, companyId);

    if (!series) {
      series = await this.ensureActiveQuoteSeries(connection, companyId);
    }

    if (!series) {
      throw new AppError("No fue posible preparar la numeración de cotizaciones para la empresa seleccionada.", 500);
    }

    const quoteNumber = `${series.prefix}${String(series.currentNumber).padStart(8, "0")}`;

    await connection.execute("UPDATE quote_series SET current_number = current_number + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [
      series.id
    ]);

    return {
      quoteSeriesId: series.id,
      sequenceNumber: series.currentNumber,
      quoteNumber
    };
  }

  private async fetchQuoteItems(quoteId: number) {
    const [rows] = await dbPool.query<QuoteItemRow[]>(
      `SELECT
        qi.id,
        qi.quote_id AS quoteId,
        qi.product_id AS productId,
        p.code AS productCode,
        p.name AS productName,
        qi.line_number AS lineNumber,
        qi.quantity,
        qi.description,
        qi.unit_price AS unitPrice,
        qi.unit_cost_snapshot AS unitCostSnapshot,
        qi.tax_rate AS taxRate,
        qi.line_discount AS lineDiscount,
        qi.line_subtotal AS lineSubtotal,
        qi.line_tax AS lineTax,
        qi.line_total AS lineTotal,
        qi.affects_inventory AS affectsInventory
      FROM quote_items qi
      LEFT JOIN products p ON p.id = qi.product_id
      WHERE qi.quote_id = ?
      ORDER BY qi.line_number ASC`,
      [quoteId]
    );

    return padProductCodes(rows);
  }

  private async fetchQuoteProjection(companyId: number, quoteId: number) {
    const [rows] = await dbPool.query<QuoteRow[]>(
      `SELECT
        q.id,
        q.company_id AS companyId,
        q.quote_series_id AS quoteSeriesId,
        q.customer_id AS customerId,
        q.warehouse_id AS warehouseId,
        w.name AS warehouseName,
        q.sequence_number AS sequenceNumber,
        q.quote_number AS quoteNumber,
        q.quote_date AS quoteDate,
        q.valid_until AS validUntil,
        q.customer_name_snapshot AS customerNameSnapshot,
        q.customer_rtn_snapshot AS customerRtnSnapshot,
        q.customer_email_snapshot AS customerEmailSnapshot,
        q.customer_phone_snapshot AS customerPhoneSnapshot,
        q.customer_address_snapshot AS customerAddressSnapshot,
        q.subtotal,
        q.discount_total AS discountTotal,
        q.taxable_amount_15 AS taxableAmount15,
        q.taxable_amount_18 AS taxableAmount18,
        q.exempt_amount AS exemptAmount,
        q.exonerated_amount AS exoneratedAmount,
        q.isv_15 AS isv15,
        q.isv_18 AS isv18,
        q.tax_total AS taxTotal,
        q.grand_total AS grandTotal,
        q.total_in_words AS totalInWords,
        q.status,
        q.approved_at AS approvedAt,
        q.approved_by AS approvedBy,
        approved.full_name AS approvedByName,
        q.converted_to_invoice_id AS convertedToInvoiceId,
        inv.invoice_number AS convertedToInvoiceNumber,
        q.notes,
        q.created_by AS createdBy,
        creator.full_name AS createdByName,
        q.created_at AS createdAt,
        q.updated_at AS updatedAt,
        c.commercial_name AS companyCommercialName,
        c.legal_name AS companyLegalName,
        c.rtn AS companyRtn,
        c.email AS companyEmail,
        c.phone AS companyPhone,
        c.address AS companyAddress,
        c.primary_color AS companyPrimaryColor,
        c.header_color AS companyHeaderColor,
        c.sidebar_color AS companySidebarColor,
        c.logo_url AS companyLogoUrl,
        c.document_color AS companyDocumentColor,
        bs.footer_text AS footerText,
        bs.payable_to AS payableTo,
        bs.default_tax_rate AS defaultTaxRate
      FROM quotes q
      INNER JOIN companies c ON c.id = q.company_id
      INNER JOIN users creator ON creator.id = q.created_by
      LEFT JOIN users approved ON approved.id = q.approved_by
      LEFT JOIN warehouses w ON w.id = q.warehouse_id
      LEFT JOIN invoices inv ON inv.id = q.converted_to_invoice_id
      LEFT JOIN billing_settings bs ON bs.company_id = q.company_id
      WHERE q.company_id = ? AND q.id = ?
      LIMIT 1`,
      [companyId, quoteId]
    );

    const quote = rows[0];

    if (!quote) {
      return quote;
    }

    return {
      ...quote,
      quoteDate: dateOnly(quote.quoteDate),
      validUntil: nullableDateOnly(quote.validUntil),
      approvedAt: dateTimeValue(quote.approvedAt),
      createdAt: dateTimeValue(quote.createdAt),
      updatedAt: dateTimeValue(quote.updatedAt)
    };
  }

  async getDetail(companyId: number, quoteId: number) {
    const quote = await this.fetchQuoteProjection(companyId, quoteId);

    if (!quote) {
      throw new AppError("Cotización no encontrada para la empresa activa.", 404);
    }

    const items = await this.fetchQuoteItems(quoteId);

    return {
      ...quote,
      items,
      company: {
        commercialName: quote.companyCommercialName,
        legalName: quote.companyLegalName,
        rtn: quote.companyRtn,
        email: quote.companyEmail,
        phone: quote.companyPhone,
        address: quote.companyAddress,
        primaryColor: quote.companyPrimaryColor,
        headerColor: quote.companyHeaderColor,
        sidebarColor: quote.companySidebarColor,
        logoUrl: quote.companyLogoUrl,
        documentColor: quote.companyDocumentColor,
        /** Se completa solo al generar el documento (ver companiesService.documentBranding). */
        footerBrands: null as string | null
      },
      settings: {
        footerText: quote.footerText,
        payableTo: quote.payableTo,
        defaultTaxRate: Number(quote.defaultTaxRate ?? 15)
      }
    };
  }

  async list(
    companyId: number,
    query: { search?: string; customer?: string; status?: string; dateFrom?: string; dateTo?: string; page?: number; pageSize?: number }
  ) {
    const pagination = resolvePagination(query.page, query.pageSize);
    const params: Array<string | number> = [companyId];
    const conditions = ["q.company_id = ?"];

    if (query.search) {
      conditions.push("q.quote_number LIKE ?");
      params.push(`%${query.search}%`);
    }

    if (query.customer) {
      conditions.push("q.customer_name_snapshot LIKE ?");
      params.push(`%${query.customer}%`);
    }

    if (query.status) {
      conditions.push("q.status = ?");
      params.push(query.status);
    }

    if (query.dateFrom) {
      conditions.push("q.quote_date >= ?");
      params.push(query.dateFrom);
    }

    if (query.dateTo) {
      conditions.push("q.quote_date <= ?");
      params.push(query.dateTo);
    }

    const whereClause = conditions.join(" AND ");
    const [items] = await dbPool.query<
      Array<
        RowDataPacket & {
          id: number;
          quoteNumber: string;
          quoteDate: DbDateValue;
          validUntil: DbDateValue | null;
          customerName: string;
          grandTotal: number;
          status: QuoteStatus;
          convertedToInvoiceId: number | null;
          createdAt: string | Date;
        }
      >
    >(
      `SELECT
        q.id,
        q.quote_number AS quoteNumber,
        q.quote_date AS quoteDate,
        q.valid_until AS validUntil,
        q.customer_name_snapshot AS customerName,
        q.grand_total AS grandTotal,
        q.status,
        q.converted_to_invoice_id AS convertedToInvoiceId,
        q.created_at AS createdAt
      FROM quotes q
      WHERE ${whereClause}
      ORDER BY q.created_at DESC, q.id DESC
      LIMIT ? OFFSET ?`,
      [...params, pagination.pageSize, pagination.offset]
    );

    const [countRows] = await dbPool.query<Array<RowDataPacket & { total: number }>>(
      `SELECT COUNT(*) AS total
       FROM quotes q
       WHERE ${whereClause}`,
      params
    );

    return {
      items: items.map((item) => ({
        ...item,
        quoteDate: dateOnly(item.quoteDate),
        validUntil: nullableDateOnly(item.validUntil),
        createdAt: dateTimeValue(item.createdAt)
      })),
      pagination: {
        page: pagination.page,
        pageSize: pagination.pageSize,
        total: countRows[0]?.total ?? 0
      }
    };
  }

  async create(companyId: number, userId: number, payload: CreateQuotePayload) {
    const billingSettings = await settingsService.getBillingSettings(companyId);
    const taxRate = Number(billingSettings.defaultTaxRate ?? 15);
    // Cliente y productos se leen ANTES de abrir la transacción: mientras se tiene
    // tomado el correlativo no se pide otra conexión (con muchas ventas a la vez,
    // las esperas ocuparían todas y la venta en turno no podría continuar).
    const customer = payload.customerId ? await clientsService.findOrFail(companyId, payload.customerId) : null;
    // Venta a "Consumidor final" sin cliente del catálogo: se vincula al cliente genérico
    // de la empresa (los datos impresos siguen siendo los escritos).
    const walkInCustomer = !payload.customerId && isGenericCustomer(payload.customer?.name, payload.customer?.rtn);
    const genericClientId = walkInCustomer ? await clientsService.findGenericId(companyId) : null;
    const productIds = Array.from(
      new Set(payload.items.map((item) => item.productId).filter((productId): productId is number => Boolean(productId)))
    );
    const products = await Promise.all(productIds.map((productId) => productsService.findActiveForSale(companyId, productId)));
    const connection = await dbPool.getConnection();

    try {
      await connection.beginTransaction();

      const sequence = await this.takeNextQuoteNumber(connection, companyId);

      if (customer && !customer.isActive) {
        throw new AppError("El cliente seleccionado no está activo.", 400);
      }

      const customerSnapshot = customer
        ? {
            id: customer.id,
            name: customer.name,
            rtn: customer.rtn,
            email: customer.email,
            phone: customer.phone,
            address: customer.address
          }
        : {
            id: genericClientId,
            name: payload.customer!.name.trim(),
            rtn: this.normalizeNullable(payload.customer?.rtn),
            email: this.normalizeNullable(payload.customer?.email),
            phone: this.normalizeNullable(payload.customer?.phone),
            address: this.normalizeNullable(payload.customer?.address)
          };

      let warehouseId = payload.warehouseId ?? null;

      if (warehouseId) {
        const warehouse = await warehousesService.findOrFail(companyId, warehouseId);

        if (!warehouse.isActive) {
          throw new AppError("La bodega seleccionada no está activa.", 400);
        }
      }

      const productMap = new Map(products.map((product) => [product.id, product]));

      const computedItems = payload.items.map((item, index) => {
        const product = item.productId ? productMap.get(item.productId) : null;
        const description = item.description?.trim() || product?.name;

        if (!description) {
          throw new AppError(`La línea ${index + 1} necesita una descripción o producto.`, 400);
        }

        const unitPrice = item.unitPrice !== undefined ? Number(item.unitPrice) : product ? Number(product.salePrice) : undefined;

        if (unitPrice === undefined) {
          throw new AppError(`La línea ${index + 1} necesita un precio unitario.`, 400);
        }

        if (product && isCountableUnit(product.unitMeasure) && !Number.isInteger(Number(item.quantity))) {
          throw new AppError(`${product.name} se vende por ${product.unitMeasure}: la cantidad debe ser un número entero (línea ${index + 1}).`, 400);
        }

        const itemTaxRate = product ? (Number(product.taxable) ? Number(product.taxRate) : 0) : taxRate;
        const gross = round2(Number(item.quantity) * unitPrice);
        const discount = round2(Number(item.lineDiscount ?? 0));

        if (discount > gross) {
          throw new AppError(`El descuento de la línea ${index + 1} no puede exceder el importe de la línea.`, 400);
        }

        const lineSubtotal = round2(gross - discount);
        const lineTax = round2((lineSubtotal * itemTaxRate) / 100);

        return {
          lineNumber: index + 1,
          productId: product?.id ?? null,
          description,
          quantity: round2(Number(item.quantity)),
          unitPrice: round2(unitPrice),
          unitCostSnapshot: product ? round2(Number(product.costPrice)) : null,
          taxRate: round2(itemTaxRate),
          lineDiscount: discount,
          gross,
          lineSubtotal,
          lineTax,
          lineTotal: round2(lineSubtotal + lineTax),
          affectsInventory: Boolean(product?.controlsStock)
        };
      });

      // Misma clasificación de ISV que la factura: exento (<=0), 18% (>=18), 15% (resto positivo).
      const is18 = (rate: number) => rate >= 18;
      const is15 = (rate: number) => rate > 0 && rate < 18;
      const subtotal = round2(computedItems.reduce((sum, item) => sum + item.gross, 0));
      const discountTotal = round2(computedItems.reduce((sum, item) => sum + item.lineDiscount, 0));
      const taxableAmount15 = round2(computedItems.filter((item) => is15(item.taxRate)).reduce((sum, item) => sum + item.lineSubtotal, 0));
      const taxableAmount18 = round2(computedItems.filter((item) => is18(item.taxRate)).reduce((sum, item) => sum + item.lineSubtotal, 0));
      const exemptAmount = round2(computedItems.filter((item) => item.taxRate <= 0).reduce((sum, item) => sum + item.lineSubtotal, 0));
      const exoneratedAmount = 0;
      const isv15 = round2(computedItems.filter((item) => is15(item.taxRate)).reduce((sum, item) => sum + item.lineTax, 0));
      const isv18 = round2(computedItems.filter((item) => is18(item.taxRate)).reduce((sum, item) => sum + item.lineTax, 0));
      const taxTotal = round2(isv15 + isv18);
      const grandTotal = round2(computedItems.reduce((sum, item) => sum + item.lineTotal, 0));
      const totalInWords = amountToSpanishWords(grandTotal);

      const [quoteResult] = await connection.execute<ResultSetHeader>(
        `INSERT INTO quotes (
          company_id,
          quote_series_id,
          customer_id,
          warehouse_id,
          sequence_number,
          quote_number,
          quote_date,
          valid_until,
          customer_name_snapshot,
          customer_rtn_snapshot,
          customer_email_snapshot,
          customer_phone_snapshot,
          customer_address_snapshot,
          subtotal,
          discount_total,
          taxable_amount_15,
          taxable_amount_18,
          exempt_amount,
          exonerated_amount,
          isv_15,
          isv_18,
          tax_total,
          grand_total,
          total_in_words,
          status,
          notes,
          created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'BORRADOR', ?, ?)`,
        [
          companyId,
          sequence.quoteSeriesId,
          customerSnapshot.id,
          warehouseId,
          sequence.sequenceNumber,
          sequence.quoteNumber,
          payload.quoteDate,
          payload.validUntil ?? null,
          customerSnapshot.name,
          customerSnapshot.rtn,
          customerSnapshot.email,
          customerSnapshot.phone,
          customerSnapshot.address,
          subtotal,
          discountTotal,
          taxableAmount15,
          taxableAmount18,
          exemptAmount,
          exoneratedAmount,
          isv15,
          isv18,
          taxTotal,
          grandTotal,
          totalInWords,
          payload.notes?.trim() ? payload.notes.trim() : null,
          userId
        ]
      );

      for (const item of computedItems) {
        await connection.execute(
          `INSERT INTO quote_items (
            quote_id,
            product_id,
            line_number,
            quantity,
            description,
            unit_price,
            unit_cost_snapshot,
            tax_rate,
            line_discount,
            line_subtotal,
            line_tax,
            line_total,
            affects_inventory
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            quoteResult.insertId,
            item.productId,
            item.lineNumber,
            item.quantity,
            item.description,
            item.unitPrice,
            item.unitCostSnapshot,
            item.taxRate,
            item.lineDiscount,
            item.lineSubtotal,
            item.lineTax,
            item.lineTotal,
            item.affectsInventory ? 1 : 0
          ]
        );
      }

      await connection.commit();

      return this.getDetail(companyId, quoteResult.insertId);
    } catch (error) {
      try {
        await connection.rollback();
      } catch (_rollbackError) {
        // noop
      }
      throw error;
    } finally {
      connection.release();
    }
  }

  async updateStatus(companyId: number, userId: number, quoteId: number, status: Exclude<QuoteStatus, "FACTURADA">) {
    const quote = await this.getDetail(companyId, quoteId);

    if (quote.status === "FACTURADA") {
      throw new AppError("La cotización ya fue facturada y no puede cambiar de estado.", 400);
    }

    const approvedFields = status === "APROBADA" ? ", approved_at = CURRENT_TIMESTAMP, approved_by = ?" : "";
    const approvedParams = status === "APROBADA" ? [userId] : [];

    await dbPool.execute(
      `UPDATE quotes
       SET status = ?${approvedFields}
       WHERE company_id = ? AND id = ?`,
      [status, ...approvedParams, companyId, quoteId]
    );

    return this.getDetail(companyId, quoteId);
  }

  async convertToInvoice(companyId: number, userId: number, role: string, quoteId: number, cashContext: CashContext = NO_CASH_CONTEXT) {
    const lockName = `quote:${companyId}:${quoteId}:convert`;
    const lockConnection = await dbPool.getConnection();

    try {
      if (!(await acquireNamedLock(lockConnection, lockName, 10))) {
        throw new AppError("No fue posible bloquear la cotización para convertirla. Intenta nuevamente.", 409);
      }

      const quote = await this.getDetail(companyId, quoteId);

      if (quote.status === "FACTURADA" || quote.convertedToInvoiceId) {
        throw new AppError("Esta cotización ya fue convertida a factura.", 400);
      }

      if (quote.status === "RECHAZADA" || quote.status === "VENCIDA") {
        throw new AppError("No se puede facturar una cotización rechazada o vencida.", 400);
      }

      // La cotización no exige caja abierta para convertirse. Si la caja del equipo
      // está abierta se adjunta el movimiento; si no, la factura se crea igual.
      const invoiceResponse = await invoicesService.create(companyId, userId, role, {
        customerId: quote.customerId ?? undefined,
        warehouseId: quote.warehouseId ?? undefined,
        requireCashSession: false,
        customer: quote.customerId
          ? undefined
          : {
              name: quote.customerNameSnapshot,
              rtn: quote.customerRtnSnapshot ?? undefined,
              phone: quote.customerPhoneSnapshot ?? undefined,
              address: quote.customerAddressSnapshot ?? undefined
            },
        notes: quote.notes ?? undefined,
        items: quote.items.map((item) => ({
          productId: item.productId ?? undefined,
          description: item.description,
          quantity: Number(item.quantity),
          unitPrice: Number(item.unitPrice),
          lineDiscount: Number(item.lineDiscount)
        }))
      }, cashContext);

      await dbPool.execute(
        `UPDATE quotes
         SET status = 'FACTURADA',
             converted_to_invoice_id = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE company_id = ? AND id = ?`,
        [invoiceResponse.id, companyId, quoteId]
      );

      return {
        quote: await this.getDetail(companyId, quoteId),
        invoice: invoiceResponse
      };
    } finally {
      try {
        await releaseNamedLock(lockConnection, lockName);
      } finally {
        lockConnection.release();
      }
    }
  }
}

export const quotesService = new QuotesService();
