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
type ProformaStatus = "BORRADOR" | "ENVIADA" | "APROBADA" | "RECHAZADA" | "VENCIDA" | "FACTURADA";

interface ProformaSeriesLockRow extends RowDataPacket {
  id: number;
  prefix: string;
  currentNumber: number;
}

interface ProformaRow extends RowDataPacket {
  id: number;
  companyId: number;
  proformaSeriesId: number;
  customerId: number | null;
  warehouseId: number | null;
  warehouseName: string | null;
  sequenceNumber: number;
  proformaNumber: string;
  proformaDate: DbDateValue;
  validUntil: DbDateValue | null;
  customerNameSnapshot: string;
  customerRtnSnapshot: string | null;
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
  status: ProformaStatus;
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

interface ProformaItemRow extends RowDataPacket {
  id: number;
  proformaId: number;
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

type CreateProformaPayload = {
  customerId?: number;
  warehouseId?: number;
  customer?: {
    name: string;
    rtn?: string;
    phone?: string;
    address?: string;
  };
  proformaDate: string;
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

class ProformasService {
  private normalizeNullable(value?: string) {
    return value?.trim() ? value.trim() : null;
  }

  private async findActiveProformaSeries(connection: DbConnection, companyId: number) {
    const [seriesRows] = await connection.query<ProformaSeriesLockRow[]>(
      `SELECT
        id,
        prefix,
        current_number AS currentNumber
      FROM proforma_series
      WHERE company_id = ?
        AND is_active = 1
      ORDER BY id DESC
      LIMIT 1
      FOR UPDATE`,
      [companyId]
    );

    return seriesRows[0];
  }

  private async ensureActiveProformaSeries(connection: DbConnection, companyId: number) {
    // Activa la serie de la empresa; si no existe, la crea (única por empresa).
    const [updated] = await connection.execute<{ affectedRows: number }>(
      "UPDATE proforma_series SET is_active = 1, updated_at = CURRENT_TIMESTAMP WHERE company_id = ?",
      [companyId]
    );
    if (!updated.affectedRows) {
      await connection.execute(
        "INSERT INTO proforma_series (company_id, prefix, current_number, is_active) VALUES (?, 'PRO-', 1, 1)",
        [companyId]
      );
    }

    return this.findActiveProformaSeries(connection, companyId);
  }

  private async takeNextProformaNumber(connection: DbConnection, companyId: number) {
    let series = await this.findActiveProformaSeries(connection, companyId);

    if (!series) {
      series = await this.ensureActiveProformaSeries(connection, companyId);
    }

    if (!series) {
      throw new AppError("No fue posible preparar la numeración de proformas para la empresa seleccionada.", 500);
    }

    const proformaNumber = `${series.prefix}${String(series.currentNumber).padStart(8, "0")}`;

    await connection.execute("UPDATE proforma_series SET current_number = current_number + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [
      series.id
    ]);

    return {
      proformaSeriesId: series.id,
      sequenceNumber: series.currentNumber,
      proformaNumber
    };
  }

  private async fetchProformaItems(proformaId: number) {
    const [rows] = await dbPool.query<ProformaItemRow[]>(
      `SELECT
        pi.id,
        pi.proforma_id AS proformaId,
        pi.product_id AS productId,
        p.code AS productCode,
        p.name AS productName,
        pi.line_number AS lineNumber,
        pi.quantity,
        pi.description,
        pi.unit_price AS unitPrice,
        pi.unit_cost_snapshot AS unitCostSnapshot,
        pi.tax_rate AS taxRate,
        pi.line_discount AS lineDiscount,
        pi.line_subtotal AS lineSubtotal,
        pi.line_tax AS lineTax,
        pi.line_total AS lineTotal,
        pi.affects_inventory AS affectsInventory
      FROM proforma_items pi
      LEFT JOIN products p ON p.id = pi.product_id
      WHERE pi.proforma_id = ?
      ORDER BY pi.line_number ASC`,
      [proformaId]
    );

    return padProductCodes(rows);
  }

  private async fetchProformaProjection(companyId: number, proformaId: number) {
    const [rows] = await dbPool.query<ProformaRow[]>(
      `SELECT
        pf.id,
        pf.company_id AS companyId,
        pf.proforma_series_id AS proformaSeriesId,
        pf.customer_id AS customerId,
        pf.warehouse_id AS warehouseId,
        w.name AS warehouseName,
        pf.sequence_number AS sequenceNumber,
        pf.proforma_number AS proformaNumber,
        pf.proforma_date AS proformaDate,
        pf.valid_until AS validUntil,
        pf.customer_name_snapshot AS customerNameSnapshot,
        pf.customer_rtn_snapshot AS customerRtnSnapshot,
        pf.customer_phone_snapshot AS customerPhoneSnapshot,
        pf.customer_address_snapshot AS customerAddressSnapshot,
        pf.subtotal,
        pf.discount_total AS discountTotal,
        pf.taxable_amount_15 AS taxableAmount15,
        pf.taxable_amount_18 AS taxableAmount18,
        pf.exempt_amount AS exemptAmount,
        pf.exonerated_amount AS exoneratedAmount,
        pf.isv_15 AS isv15,
        pf.isv_18 AS isv18,
        pf.tax_total AS taxTotal,
        pf.grand_total AS grandTotal,
        pf.total_in_words AS totalInWords,
        pf.status,
        pf.approved_at AS approvedAt,
        pf.approved_by AS approvedBy,
        approved.full_name AS approvedByName,
        pf.converted_to_invoice_id AS convertedToInvoiceId,
        inv.invoice_number AS convertedToInvoiceNumber,
        pf.notes,
        pf.created_by AS createdBy,
        creator.full_name AS createdByName,
        pf.created_at AS createdAt,
        pf.updated_at AS updatedAt,
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
      FROM proformas pf
      INNER JOIN companies c ON c.id = pf.company_id
      INNER JOIN users creator ON creator.id = pf.created_by
      LEFT JOIN users approved ON approved.id = pf.approved_by
      LEFT JOIN warehouses w ON w.id = pf.warehouse_id
      LEFT JOIN invoices inv ON inv.id = pf.converted_to_invoice_id
      LEFT JOIN billing_settings bs ON bs.company_id = pf.company_id
      WHERE pf.company_id = ? AND pf.id = ?
      LIMIT 1`,
      [companyId, proformaId]
    );

    const proforma = rows[0];

    if (!proforma) {
      return proforma;
    }

    return {
      ...proforma,
      proformaDate: dateOnly(proforma.proformaDate),
      validUntil: nullableDateOnly(proforma.validUntil),
      approvedAt: dateTimeValue(proforma.approvedAt),
      createdAt: dateTimeValue(proforma.createdAt),
      updatedAt: dateTimeValue(proforma.updatedAt)
    };
  }

  async getDetail(companyId: number, proformaId: number) {
    const proforma = await this.fetchProformaProjection(companyId, proformaId);

    if (!proforma) {
      throw new AppError("Proforma no encontrada para la empresa activa.", 404);
    }

    const items = await this.fetchProformaItems(proformaId);

    return {
      ...proforma,
      items,
      company: {
        commercialName: proforma.companyCommercialName,
        legalName: proforma.companyLegalName,
        rtn: proforma.companyRtn,
        email: proforma.companyEmail,
        phone: proforma.companyPhone,
        address: proforma.companyAddress,
        primaryColor: proforma.companyPrimaryColor,
        headerColor: proforma.companyHeaderColor,
        sidebarColor: proforma.companySidebarColor,
        logoUrl: proforma.companyLogoUrl,
        documentColor: proforma.companyDocumentColor,
        /** Se completa solo al generar el documento (ver companiesService.documentBranding). */
        footerBrands: null as string | null
      },
      settings: {
        footerText: proforma.footerText,
        payableTo: proforma.payableTo,
        defaultTaxRate: Number(proforma.defaultTaxRate ?? 15)
      }
    };
  }

  async list(
    companyId: number,
    query: { search?: string; customer?: string; status?: string; dateFrom?: string; dateTo?: string; page?: number; pageSize?: number }
  ) {
    const pagination = resolvePagination(query.page, query.pageSize);
    const params: Array<string | number> = [companyId];
    const conditions = ["pf.company_id = ?"];

    if (query.search) {
      conditions.push("pf.proforma_number LIKE ?");
      params.push(`%${query.search}%`);
    }

    if (query.customer) {
      conditions.push("pf.customer_name_snapshot LIKE ?");
      params.push(`%${query.customer}%`);
    }

    if (query.status) {
      conditions.push("pf.status = ?");
      params.push(query.status);
    }

    if (query.dateFrom) {
      conditions.push("pf.proforma_date >= ?");
      params.push(query.dateFrom);
    }

    if (query.dateTo) {
      conditions.push("pf.proforma_date <= ?");
      params.push(query.dateTo);
    }

    const whereClause = conditions.join(" AND ");
    const [items] = await dbPool.query<
      Array<
        RowDataPacket & {
          id: number;
          proformaNumber: string;
          proformaDate: DbDateValue;
          validUntil: DbDateValue | null;
          customerName: string;
          grandTotal: number;
          status: ProformaStatus;
          convertedToInvoiceId: number | null;
          createdAt: string | Date;
        }
      >
    >(
      `SELECT
        pf.id,
        pf.proforma_number AS proformaNumber,
        pf.proforma_date AS proformaDate,
        pf.valid_until AS validUntil,
        pf.customer_name_snapshot AS customerName,
        pf.grand_total AS grandTotal,
        pf.status,
        pf.converted_to_invoice_id AS convertedToInvoiceId,
        pf.created_at AS createdAt
      FROM proformas pf
      WHERE ${whereClause}
      ORDER BY pf.created_at DESC, pf.id DESC
      LIMIT ? OFFSET ?`,
      [...params, pagination.pageSize, pagination.offset]
    );

    const [countRows] = await dbPool.query<Array<RowDataPacket & { total: number }>>(
      `SELECT COUNT(*) AS total
       FROM proformas pf
       WHERE ${whereClause}`,
      params
    );

    return {
      items: items.map((item) => ({
        ...item,
        proformaDate: dateOnly(item.proformaDate),
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

  async create(companyId: number, userId: number, payload: CreateProformaPayload) {
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

      const sequence = await this.takeNextProformaNumber(connection, companyId);

      if (customer && !customer.isActive) {
        throw new AppError("El cliente seleccionado no está activo.", 400);
      }

      const customerSnapshot = customer
        ? {
            id: customer.id,
            name: customer.name,
            rtn: customer.rtn,
            phone: customer.phone,
            address: customer.address
          }
        : {
            id: genericClientId,
            name: payload.customer!.name.trim(),
            rtn: this.normalizeNullable(payload.customer?.rtn),
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

      const [proformaResult] = await connection.execute<ResultSetHeader>(
        `INSERT INTO proformas (
          company_id,
          proforma_series_id,
          customer_id,
          warehouse_id,
          sequence_number,
          proforma_number,
          proforma_date,
          valid_until,
          customer_name_snapshot,
          customer_rtn_snapshot,
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
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'BORRADOR', ?, ?)`,
        [
          companyId,
          sequence.proformaSeriesId,
          customerSnapshot.id,
          warehouseId,
          sequence.sequenceNumber,
          sequence.proformaNumber,
          payload.proformaDate,
          payload.validUntil ?? null,
          customerSnapshot.name,
          customerSnapshot.rtn,
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
          `INSERT INTO proforma_items (
            proforma_id,
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
            proformaResult.insertId,
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

      return this.getDetail(companyId, proformaResult.insertId);
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

  async updateStatus(companyId: number, userId: number, proformaId: number, status: Exclude<ProformaStatus, "FACTURADA">) {
    const proforma = await this.getDetail(companyId, proformaId);

    if (proforma.status === "FACTURADA") {
      throw new AppError("La proforma ya fue facturada y no puede cambiar de estado.", 400);
    }

    const approvedFields = status === "APROBADA" ? ", approved_at = CURRENT_TIMESTAMP, approved_by = ?" : "";
    const approvedParams = status === "APROBADA" ? [userId] : [];

    await dbPool.execute(
      `UPDATE proformas
       SET status = ?${approvedFields}
       WHERE company_id = ? AND id = ?`,
      [status, ...approvedParams, companyId, proformaId]
    );

    return this.getDetail(companyId, proformaId);
  }

  async convertToInvoice(companyId: number, userId: number, role: string, proformaId: number, cashContext: CashContext = NO_CASH_CONTEXT) {
    const lockName = `proforma:${companyId}:${proformaId}:convert`;
    const lockConnection = await dbPool.getConnection();

    try {
      if (!(await acquireNamedLock(lockConnection, lockName, 10))) {
        throw new AppError("No fue posible bloquear la proforma para convertirla. Intenta nuevamente.", 409);
      }

      const proforma = await this.getDetail(companyId, proformaId);

      if (proforma.status === "FACTURADA" || proforma.convertedToInvoiceId) {
        throw new AppError("Esta proforma ya fue convertida a factura.", 400);
      }

      if (proforma.status === "RECHAZADA" || proforma.status === "VENCIDA") {
        throw new AppError("No se puede facturar una proforma rechazada o vencida.", 400);
      }

      // La conversión emite una factura real: exige la caja del equipo abierta
      // (invoicesService.create la resuelve y bloquea dentro de su transacción).
      const invoiceResponse = await invoicesService.create(companyId, userId, role, {
        customerId: proforma.customerId ?? undefined,
        warehouseId: proforma.warehouseId ?? undefined,
        sourceProformaId: proforma.id,
        customer: proforma.customerId
          ? undefined
          : {
              name: proforma.customerNameSnapshot,
              rtn: proforma.customerRtnSnapshot ?? undefined,
              phone: proforma.customerPhoneSnapshot ?? undefined,
              address: proforma.customerAddressSnapshot ?? undefined
            },
        notes: proforma.notes ?? undefined,
        items: proforma.items.map((item) => ({
          productId: item.productId ?? undefined,
          description: item.description,
          quantity: Number(item.quantity),
          unitPrice: Number(item.unitPrice),
          lineDiscount: Number(item.lineDiscount)
        }))
      }, cashContext);

      await dbPool.execute(
        `UPDATE proformas
         SET status = 'FACTURADA',
             converted_to_invoice_id = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE company_id = ? AND id = ?`,
        [invoiceResponse.id, companyId, proformaId]
      );

      return {
        proforma: await this.getDetail(companyId, proformaId),
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

export const proformasService = new ProformasService();
