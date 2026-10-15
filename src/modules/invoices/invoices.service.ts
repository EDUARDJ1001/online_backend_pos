import type { RowDataPacket, ResultSetHeader } from "mysql2";

import { dbPool, withDeadlockRetry, type DbConnection } from "../../config/db";
import { assertLicense } from "../../license/license-runtime";
import { amountToSpanishWords } from "../../utils/number-to-words-es";
import { resolvePagination } from "../../utils/pagination";
import { padProductCodes } from "../../utils/product-code";
import { AppError } from "../../utils/http-error";
import { cajaService, NO_CASH_CONTEXT, type CashContext } from "../caja/caja.service";
import { clientsService, isGenericCustomer } from "../clients/clients.service";
import { inventoryService } from "../inventory/inventory.service";
import { productsService } from "../products/products.service";
import { settingsService } from "../settings/settings.service";
import { warehousesService } from "../warehouses/warehouses.service";
import { isCountableUnit, todayInHonduras } from "../inventory/inventory-rules";

interface InvoiceProjectionRow extends RowDataPacket {
  id: number;
  companyId: number;
  customerId: number | null;
  warehouseId: number | null;
  warehouseName: string | null;
  /** Usuario que emitió la factura (cajero). */
  createdByName: string | null;
  invoiceNumber: string;
  sequenceNumber: number;
  originalInvoiceDate: DbDateValue;
  printInvoiceDate: DbDateValue;
  issuedAt: string | Date;
  status: "EMITIDA" | "ANULADA";
  saleType: "CONTADO" | "CREDITO";
  dueDate: DbDateValue | null;
  paidAmount: number;
  balance: number;
  paymentStatus: "PENDIENTE" | "PARCIAL" | "PAGADA" | "ANULADA";
  printCustomerName: string;
  originalCustomerName: string;
  customerRtnSnapshot: string | null;
  customerPhoneSnapshot: string | null;
  customerAddressSnapshot: string | null;
  companyLegalNameSnapshot: string;
  companyCommercialNameSnapshot: string;
  companyRtnSnapshot: string;
  companyEmailSnapshot: string | null;
  companyPhoneSnapshot: string | null;
  companyAddressSnapshot: string | null;
  companyLogoUrl: string | null;
  companyPrimaryColor: string | null;
  companyHeaderColor: string | null;
  companySidebarColor: string | null;
  companyDocumentColor: string | null;
  caiSnapshot: string;
  resolutionNumberSnapshot: string | null;
  issueDeadlineSnapshot: DbDateValue;
  rangeStartSnapshot: number;
  rangeEndSnapshot: number;
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
  notes: string | null;
  footerText: string | null;
  payableTo: string | null;
  invoiceTitle: string;
}

interface InvoiceItemRow extends RowDataPacket {
  id: number;
  invoiceId: number;
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

interface InvoiceCorrectionRow extends RowDataPacket {
  id: number;
  correctionType: "NOMBRE_CLIENTE" | "FECHA_FACTURA" | "AMBOS";
  previousCustomerName: string | null;
  newCustomerName: string | null;
  previousInvoiceDate: DbDateValue | null;
  newInvoiceDate: DbDateValue | null;
  reason: string;
  status: "APLICADA" | "REVERTIDA";
  performedBy: number;
  performedByName: string;
  createdAt: string | Date;
}

interface CompanyAndSeriesRow extends RowDataPacket {
  companyLegalName: string;
  companyCommercialName: string;
  companyRtn: string;
  companyEmail: string | null;
  companyPhone: string | null;
  companyAddress: string | null;
  cai: string;
  resolutionNumber: string | null;
  issueDeadline: DbDateValue;
  rangeStart: number;
  rangeEnd: number;
}

interface BillingSeriesLockRow extends RowDataPacket {
  id: number;
  establishmentCode: string;
  pointCode: string;
  documentCode: string;
  currentNumber: number;
  rangeStart: number;
  rangeEnd: number;
  issueDeadline: DbDateValue;
}

type DbDateValue = string | Date;

type CreateInvoicePayload = {
  customerId?: number;
  warehouseId?: number;
  sourceProformaId?: number;
  customer?: {
    name: string;
    rtn?: string;
    phone?: string;
    address?: string;
  };
  /** Se ignora: la factura siempre lleva la fecha de hoy en Honduras. */
  invoiceDate?: string;
  saleType?: "CONTADO" | "CREDITO";
  tenderMethod?: "EFECTIVO" | "TRANSFERENCIA" | "CHEQUE" | "TARJETA" | "OTRO";
  cashSessionId?: number;
  /** Por defecto true: sin caja abierta no se factura. La conversión de cotización lo pone en false. */
  requireCashSession?: boolean;
  dueDate?: string;
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

function dateTimeValue(value: string | Date) {
  return value instanceof Date ? value.toISOString() : value;
}

class InvoicesService {
  private normalizeNullable(value?: string) {
    return value?.trim() ? value.trim() : null;
  }

  private async takeNextInvoiceNumber(connection: DbConnection, companyId: number) {
    const [seriesRows] = await connection.query<BillingSeriesLockRow[]>(
      `SELECT
        id,
        establishment_code AS establishmentCode,
        point_code AS pointCode,
        document_code AS documentCode,
        current_number AS currentNumber,
        range_start AS rangeStart,
        range_end AS rangeEnd,
        issue_deadline AS issueDeadline
      FROM billing_series
      WHERE company_id = ?
        AND document_type = 'FACTURA'
        AND is_active = 1
      ORDER BY id DESC
      LIMIT 1
      FOR UPDATE`,
      [companyId]
    );

    const series = seriesRows[0];

    if (!series) {
      throw new AppError("No existe una serie activa de facturación para la empresa seleccionada.", 400);
    }

    const [todayRows] = await connection.query<Array<RowDataPacket & { today: DbDateValue }>>("SELECT CURDATE() AS today");
    const todayRow = todayRows[0];

    if (!todayRow) {
      throw new AppError("No fue posible validar la fecha actual para emitir la factura.", 500);
    }

    const today = dateOnly(todayRow.today);
    const issueDeadline = dateOnly(series.issueDeadline);

    if (today > issueDeadline) {
      throw new AppError("La fecha límite de emisión del CAI ya venció.", 400);
    }

    // Salta correlativos ya emitidos DENTRO del rango de este CAI (mismo prefijo),
    // por si el contador quedó atrás. Así el número no choca con facturas existentes.
    const prefixLike = `${series.establishmentCode}-${series.pointCode}-${series.documentCode}-%`;
    const [maxRows] = await connection.query<Array<RowDataPacket & { maxSeq: number | null }>>(
      "SELECT MAX(sequence_number) AS maxSeq FROM invoices WHERE company_id = ? AND invoice_number LIKE ? AND sequence_number BETWEEN ? AND ?",
      [companyId, prefixLike, series.rangeStart, series.rangeEnd]
    );
    const maxEmitted = Number(maxRows[0]?.maxSeq ?? 0);
    const nextNumber = Math.max(series.currentNumber, maxEmitted + 1);

    if (nextNumber < series.rangeStart || nextNumber > series.rangeEnd) {
      throw new AppError("La serie de facturación ya no tiene correlativos disponibles.", 409);
    }

    const invoiceNumber = `${series.establishmentCode}-${series.pointCode}-${series.documentCode}-${String(nextNumber).padStart(8, "0")}`;

    await connection.execute("UPDATE billing_series SET current_number = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [
      nextNumber + 1,
      series.id
    ]);

    return {
      billingSeriesId: series.id,
      sequenceNumber: nextNumber,
      invoiceNumber
    };
  }

  /** Serie de FACTURA activa para la POS (accesible con permiso de facturar, no de configurar). */
  async getActiveFacturaSeries(companyId: number) {
    const [rows] = await dbPool.query<Array<RowDataPacket & {
      id: number;
      establishmentCode: string;
      pointCode: string;
      documentCode: string;
      cai: string;
      currentNumber: number;
      rangeStart: number;
      rangeEnd: number;
      issueDeadline: DbDateValue;
    }>>(
      `SELECT id, establishment_code AS establishmentCode, point_code AS pointCode, document_code AS documentCode,
              cai, current_number AS currentNumber, range_start AS rangeStart, range_end AS rangeEnd,
              issue_deadline AS issueDeadline
       FROM billing_series
       WHERE company_id = ? AND document_type = 'FACTURA' AND is_active = 1
       ORDER BY id DESC LIMIT 1`,
      [companyId]
    );

    const series = rows[0];
    if (!series) {
      return null;
    }

    const prefix = `${series.establishmentCode}-${series.pointCode}-${series.documentCode}`;
    const [maxRows] = await dbPool.query<Array<RowDataPacket & { maxSeq: number | null }>>(
      "SELECT MAX(sequence_number) AS maxSeq FROM invoices WHERE company_id = ? AND invoice_number LIKE ? AND sequence_number BETWEEN ? AND ?",
      [companyId, `${prefix}-%`, series.rangeStart, series.rangeEnd]
    );
    const maxEmitted = Number(maxRows[0]?.maxSeq ?? 0);
    const next = Math.max(Number(series.currentNumber), maxEmitted + 1);
    const exhausted = next > series.rangeEnd;
    const [todayRows] = await dbPool.query<Array<RowDataPacket & { today: DbDateValue }>>("SELECT CURDATE() AS today");
    const issueDeadline = dateOnly(series.issueDeadline);
    const expired = Boolean(todayRows[0] && dateOnly(todayRows[0].today) > issueDeadline);

    return {
      id: series.id,
      prefix,
      cai: series.cai,
      nextNumber: `${prefix}-${String(next).padStart(8, "0")}`,
      exhausted,
      issueDeadline,
      expired,
      isActive: true,
      documentType: "FACTURA" as const
    };
  }

  private async fetchInvoiceProjection(companyId: number, invoiceId: number) {
    const [rows] = await dbPool.query<InvoiceProjectionRow[]>(
      `SELECT
        i.id,
        i.company_id AS companyId,
        i.customer_id AS customerId,
        i.warehouse_id AS warehouseId,
        w.name AS warehouseName,
        cu.full_name AS createdByName,
        i.invoice_number AS invoiceNumber,
        i.sequence_number AS sequenceNumber,
        i.invoice_date AS originalInvoiceDate,
        vp.print_invoice_date AS printInvoiceDate,
        i.issued_at AS issuedAt,
        i.status,
        i.sale_type AS saleType,
        i.due_date AS dueDate,
        i.paid_amount AS paidAmount,
        i.balance,
        i.payment_status AS paymentStatus,
        vp.print_customer_name AS printCustomerName,
        vp.original_customer_name AS originalCustomerName,
        i.customer_rtn_snapshot AS customerRtnSnapshot,
        i.customer_phone_snapshot AS customerPhoneSnapshot,
        i.customer_address_snapshot AS customerAddressSnapshot,
        i.company_legal_name_snapshot AS companyLegalNameSnapshot,
        i.company_commercial_name_snapshot AS companyCommercialNameSnapshot,
        i.company_rtn_snapshot AS companyRtnSnapshot,
        i.company_email_snapshot AS companyEmailSnapshot,
        i.company_phone_snapshot AS companyPhoneSnapshot,
        i.company_address_snapshot AS companyAddressSnapshot,
        c.logo_url AS companyLogoUrl,
        c.primary_color AS companyPrimaryColor,
        c.header_color AS companyHeaderColor,
        c.sidebar_color AS companySidebarColor,
        c.document_color AS companyDocumentColor,
        i.cai_snapshot AS caiSnapshot,
        i.resolution_number_snapshot AS resolutionNumberSnapshot,
        i.issue_deadline_snapshot AS issueDeadlineSnapshot,
        i.range_start_snapshot AS rangeStartSnapshot,
        i.range_end_snapshot AS rangeEndSnapshot,
        i.subtotal,
        i.discount_total AS discountTotal,
        i.taxable_amount_15 AS taxableAmount15,
        i.taxable_amount_18 AS taxableAmount18,
        i.exempt_amount AS exemptAmount,
        i.exonerated_amount AS exoneratedAmount,
        i.isv_15 AS isv15,
        i.isv_18 AS isv18,
        i.tax_total AS taxTotal,
        i.grand_total AS grandTotal,
        i.total_in_words AS totalInWords,
        i.notes,
        bs.footer_text AS footerText,
        bs.payable_to AS payableTo,
        bs.invoice_title AS invoiceTitle
      FROM invoices i
      INNER JOIN vw_invoice_print_projection vp ON vp.invoice_id = i.id
      LEFT JOIN billing_settings bs ON bs.company_id = i.company_id
      LEFT JOIN companies c ON c.id = i.company_id
      LEFT JOIN warehouses w ON w.id = i.warehouse_id
      LEFT JOIN users cu ON cu.id = i.created_by
      WHERE i.company_id = ? AND i.id = ?
      LIMIT 1`,
      [companyId, invoiceId]
    );

    const invoice = rows[0];

    if (!invoice) {
      return invoice;
    }

    return {
      ...invoice,
      originalInvoiceDate: dateOnly(invoice.originalInvoiceDate),
      printInvoiceDate: dateOnly(invoice.printInvoiceDate),
      issuedAt: dateTimeValue(invoice.issuedAt),
      issueDeadlineSnapshot: dateOnly(invoice.issueDeadlineSnapshot),
      dueDate: invoice.dueDate ? dateOnly(invoice.dueDate) : null
    };
  }

  private async fetchInvoiceItems(invoiceId: number) {
    const [rows] = await dbPool.query<InvoiceItemRow[]>(
      `SELECT
        invoice_items.id,
        invoice_items.invoice_id AS invoiceId,
        invoice_items.product_id AS productId,
        invoice_items.line_number AS lineNumber,
        invoice_items.quantity,
        invoice_items.description,
        invoice_items.unit_price AS unitPrice,
        invoice_items.unit_cost_snapshot AS unitCostSnapshot,
        invoice_items.tax_rate AS taxRate,
        invoice_items.line_discount AS lineDiscount,
        invoice_items.line_subtotal AS lineSubtotal,
        invoice_items.line_tax AS lineTax,
        invoice_items.line_total AS lineTotal,
        invoice_items.affects_inventory AS affectsInventory,
        p.code AS productCode,
        p.name AS productName
      FROM invoice_items
      LEFT JOIN products p ON p.id = invoice_items.product_id
      WHERE invoice_id = ?
      ORDER BY line_number ASC`,
      [invoiceId]
    );

    return padProductCodes(rows);
  }

  async listCorrections(companyId: number, invoiceId: number) {
    const [rows] = await dbPool.query<InvoiceCorrectionRow[]>(
      `SELECT
        ic.id,
        ic.correction_type AS correctionType,
        ic.previous_customer_name AS previousCustomerName,
        ic.new_customer_name AS newCustomerName,
        ic.previous_invoice_date AS previousInvoiceDate,
        ic.new_invoice_date AS newInvoiceDate,
        ic.reason,
        ic.status,
        ic.performed_by AS performedBy,
        u.full_name AS performedByName,
        ic.created_at AS createdAt
      FROM invoice_corrections ic
      INNER JOIN users u ON u.id = ic.performed_by
      WHERE ic.company_id = ? AND ic.invoice_id = ?
      ORDER BY ic.id DESC`,
      [companyId, invoiceId]
    );

    return rows.map((row) => ({
      ...row,
      previousInvoiceDate: nullableDateOnly(row.previousInvoiceDate),
      newInvoiceDate: nullableDateOnly(row.newInvoiceDate),
      createdAt: dateTimeValue(row.createdAt)
    }));
  }

  async getInvoiceDetail(companyId: number, invoiceId: number) {
    const invoice = await this.fetchInvoiceProjection(companyId, invoiceId);

    if (!invoice) {
      throw new AppError("Factura no encontrada para la empresa activa.", 404);
    }

    const [items, corrections] = await Promise.all([
      this.fetchInvoiceItems(invoiceId),
      this.listCorrections(companyId, invoiceId)
    ]);

    return {
      ...invoice,
      items,
      corrections,
      settings: {
        footerText: invoice.footerText,
        payableTo: invoice.payableTo,
        invoiceTitle: invoice.invoiceTitle
      }
    };
  }

  async list(companyId: number, query: { search?: string; customer?: string; dateFrom?: string; dateTo?: string; page?: number; pageSize?: number }) {
    const pagination = resolvePagination(query.page, query.pageSize);
    const params: Array<string | number> = [companyId];
    const conditions = ["i.company_id = ?"];

    if (query.search) {
      conditions.push("i.invoice_number LIKE ?");
      params.push(`%${query.search}%`);
    }

    if (query.customer) {
      conditions.push("vp.print_customer_name LIKE ?");
      params.push(`%${query.customer}%`);
    }

    if (query.dateFrom) {
      conditions.push("vp.print_invoice_date >= ?");
      params.push(query.dateFrom);
    }

    if (query.dateTo) {
      conditions.push("vp.print_invoice_date <= ?");
      params.push(query.dateTo);
    }

    const whereClause = conditions.join(" AND ");
    const [items] = await dbPool.query<Array<RowDataPacket & {
      id: number;
      invoiceNumber: string;
      invoiceDate: DbDateValue;
      customerName: string;
      grandTotal: number;
      status: string;
      saleType: "CONTADO" | "CREDITO";
      dueDate: DbDateValue | null;
      paidAmount: number;
      balance: number;
      paymentStatus: "PENDIENTE" | "PARCIAL" | "PAGADA" | "ANULADA";
      createdAt: string;
    }>>(
      `SELECT
        i.id,
        i.invoice_number AS invoiceNumber,
        vp.print_invoice_date AS invoiceDate,
        vp.print_customer_name AS customerName,
        i.grand_total AS grandTotal,
        i.status,
        i.sale_type AS saleType,
        i.due_date AS dueDate,
        i.paid_amount AS paidAmount,
        i.balance,
        i.payment_status AS paymentStatus,
        i.created_at AS createdAt
      FROM invoices i
      INNER JOIN vw_invoice_print_projection vp ON vp.invoice_id = i.id
      WHERE ${whereClause}
      ORDER BY i.created_at DESC, i.id DESC
      LIMIT ? OFFSET ?`,
      [...params, pagination.pageSize, pagination.offset]
    );

    const [countRows] = await dbPool.query<Array<RowDataPacket & { total: number }>>(
      `SELECT COUNT(*) AS total
       FROM invoices i
       INNER JOIN vw_invoice_print_projection vp ON vp.invoice_id = i.id
       WHERE ${whereClause}`,
      params
    );

    return {
      items: items.map((item) => ({
        ...item,
        invoiceDate: dateOnly(item.invoiceDate),
        dueDate: item.dueDate ? dateOnly(item.dueDate) : null,
        createdAt: dateTimeValue(item.createdAt)
      })),
      pagination: {
        page: pagination.page,
        pageSize: pagination.pageSize,
        total: countRows[0]?.total ?? 0
      }
    };
  }

  async create(
    companyId: number,
    userId: number,
    _role: string,
    payload: CreateInvoicePayload,
    cashContext: CashContext = NO_CASH_CONTEXT
  ) {
    await assertLicense();
    const billingSettings = await settingsService.getBillingSettings(companyId);
    const taxRate = Number(billingSettings.defaultTaxRate ?? 15);

    const saleTypeIntent = payload.saleType === "CREDITO" ? "CREDITO" : "CONTADO";
    const tenderMethod = saleTypeIntent === "CONTADO" ? payload.tenderMethod ?? "EFECTIVO" : null;

    // Cliente y productos se leen ANTES de abrir la transacción: mientras se tiene
    // tomado el correlativo no se pide otra conexión (con muchas ventas a la vez,
    // las esperas ocuparían todas y la venta en turno no podría continuar).
    const customer = payload.customerId ? await clientsService.findOrFail(companyId, payload.customerId) : null;
    // Venta a "Consumidor final" sin cliente del catálogo: se vincula al cliente genérico
    // de la empresa (los datos impresos siguen siendo los escritos).
    const walkInCustomer = !payload.customerId && isGenericCustomer(payload.customer?.name, payload.customer?.rtn);
    const genericClientId = walkInCustomer ? await clientsService.findGenericId(companyId) : null;
    if (customer && !customer.isActive) {
      throw new AppError("El cliente seleccionado está desactivado.", 400);
    }
    // El crédito necesita a quién cobrarle: no se da a "Consumidor final".
    if (saleTypeIntent === "CREDITO" && (walkInCustomer || customer?.isGeneric)) {
      throw new AppError("La venta a crédito necesita un cliente identificado; no se puede dar crédito a Consumidor final.", 400);
    }
    // Fecha de emisión: siempre hoy (Honduras), sin importar la que se envíe.
    const invoiceDate = todayInHonduras();
    const productIds = Array.from(
      new Set(payload.items.map((item) => item.productId).filter((productId): productId is number => Boolean(productId)))
    );
    const products = await Promise.all(productIds.map((productId) => productsService.findActiveForSale(companyId, productId)));

    // Bodega de la venta (también antes de la transacción).
    let resolvedWarehouseId = payload.warehouseId ?? null;
    if (resolvedWarehouseId) {
      const warehouse = await warehousesService.findOrFail(companyId, resolvedWarehouseId);
      if (!warehouse.isActive) {
        throw new AppError("La bodega seleccionada no está activa.", 400);
      }
    }
    const saleAffectsInventory = products.some((product) => Boolean(product.controlsStock));
    if (saleAffectsInventory && !resolvedWarehouseId) {
      const defaultWarehouse = await warehousesService.findDefaultOrFirst(companyId);
      if (!defaultWarehouse) {
        throw new AppError("Debes configurar una bodega activa para facturar productos con inventario.", 400);
      }
      resolvedWarehouseId = defaultWarehouse.id;
    }

    // Reintenta si MySQL aborta por deadlock/timeout bajo emisión concurrente.
    // El correlativo solo se consume al hacer commit, así que reintentar es seguro.
    return withDeadlockRetry(async () => {
      const connection = await dbPool.getConnection();

      try {
        await connection.beginTransaction();

        // Caja: la del equipo (o la única de la empresa), con bloqueo compartido para que
        // un cierre simultáneo espere y la venta no quede fuera del arqueo.
        // Sin caja abierta no se factura; la conversión de cotización lo pone en
        // false y, si no hay caja, la factura se crea sin movimiento.
        const openCashSession = await cajaService.lockSessionForOperation(connection, companyId, cashContext, {
          required: payload.requireCashSession ?? true,
          cashSessionId: payload.cashSessionId
        });

        const sequence = await this.takeNextInvoiceNumber(connection, companyId);

      const [companyRows] = await connection.query<CompanyAndSeriesRow[]>(
        `SELECT
          c.legal_name AS companyLegalName,
          c.commercial_name AS companyCommercialName,
          c.rtn AS companyRtn,
          c.email AS companyEmail,
          c.phone AS companyPhone,
          c.address AS companyAddress,
          bs.cai,
          bs.resolution_number AS resolutionNumber,
          bs.issue_deadline AS issueDeadline,
          bs.range_start AS rangeStart,
          bs.range_end AS rangeEnd
        FROM companies c
        INNER JOIN billing_series bs ON bs.id = ?
        WHERE c.id = ?
        LIMIT 1`,
        [sequence.billingSeriesId, companyId]
      );

      const company = companyRows[0];

      if (!company) {
        throw new AppError("No se pudo cargar la configuración fiscal de la empresa.", 500);
      }

      const issueDeadline = dateOnly(company.issueDeadline);

      if (invoiceDate > issueDeadline) {
        throw new AppError("La fecha de la factura supera la fecha límite de emisión del CAI.", 400);
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

      const productMap = new Map(products.map((product) => [product.id, product]));

      const computedItems = payload.items.map((item, index) => {
        const product = item.productId ? productMap.get(item.productId) : null;
        const description = item.description?.trim() || product?.name;

        if (!description) {
          throw new AppError(`La línea ${index + 1} necesita una descripción o producto.`, 400);
        }

        const unitPrice = item.unitPrice !== undefined ? item.unitPrice : product?.salePrice;

        if (unitPrice === undefined) {
          throw new AppError(`La línea ${index + 1} necesita un precio unitario.`, 400);
        }

        if (product && isCountableUnit(product.unitMeasure) && !Number.isInteger(Number(item.quantity))) {
          throw new AppError(`${product.name} se vende por ${product.unitMeasure}: la cantidad debe ser un número entero (línea ${index + 1}).`, 400);
        }

        const itemTaxRate = product ? (product.taxable ? Number(product.taxRate) : 0) : taxRate;
        const affectsInventory = Boolean(product?.controlsStock);
        const gross = round2(item.quantity * unitPrice);
        const discount = round2(item.lineDiscount);

        if (discount > gross) {
          throw new AppError(`El descuento de la línea ${index + 1} no puede exceder el importe de la línea.`, 400);
        }

        const lineSubtotal = round2(gross - discount);
        const lineTax = round2((lineSubtotal * itemTaxRate) / 100);

        return {
          lineNumber: index + 1,
          productId: product?.id ?? null,
          description,
          quantity: round2(item.quantity),
          unitPrice: round2(unitPrice),
          unitCostSnapshot: product ? round2(Number(product.costPrice)) : null,
          taxRate: round2(itemTaxRate),
          lineDiscount: discount,
          gross,
          lineSubtotal,
          lineTax,
          lineTotal: round2(lineSubtotal + lineTax),
          affectsInventory
        };
      });

      // Clasificación por tasa de ISV: exento (<=0), 18% (>=18) y 15% (el resto positivo).
      // El impuesto por línea siempre usa su propia tasa, así que el total de ISV cuadra
      // aunque un producto tuviera una tasa fuera de estándar.
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
      const requiresInventory = computedItems.some((item) => item.affectsInventory);
      const warehouseId = resolvedWarehouseId;

      // Cuentas por cobrar: contado nace pagada; crédito nace pendiente con saldo.
      const saleType = payload.saleType === "CREDITO" ? "CREDITO" : "CONTADO";
      const dueDate = saleType === "CREDITO" ? payload.dueDate ?? null : null;
      const paidAmount = saleType === "CREDITO" ? 0 : grandTotal;
      const balance = saleType === "CREDITO" ? grandTotal : 0;
      const paymentStatus = saleType === "CREDITO" ? "PENDIENTE" : "PAGADA";

      const [invoiceResult] = await connection.execute<ResultSetHeader>(
        `INSERT INTO invoices (
          company_id,
          billing_series_id,
          customer_id,
          warehouse_id,
          source_proforma_id,
          invoice_number,
          sequence_number,
          invoice_date,
          customer_name_snapshot,
          customer_rtn_snapshot,
          customer_phone_snapshot,
          customer_address_snapshot,
          company_legal_name_snapshot,
          company_commercial_name_snapshot,
          company_rtn_snapshot,
          company_email_snapshot,
          company_phone_snapshot,
          company_address_snapshot,
          cai_snapshot,
          resolution_number_snapshot,
          issue_deadline_snapshot,
          range_start_snapshot,
          range_end_snapshot,
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
          sale_type,
          due_date,
          paid_amount,
          balance,
          payment_status,
          tender_method,
          notes,
          created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'EMITIDA', ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          companyId,
          sequence.billingSeriesId,
          customerSnapshot.id,
          warehouseId,
          payload.sourceProformaId ?? null,
          sequence.invoiceNumber,
          sequence.sequenceNumber,
          invoiceDate,
          customerSnapshot.name,
          customerSnapshot.rtn,
          customerSnapshot.phone,
          customerSnapshot.address,
          company.companyLegalName,
          company.companyCommercialName,
          company.companyRtn,
          company.companyEmail,
          company.companyPhone,
          company.companyAddress,
          company.cai,
          company.resolutionNumber,
          issueDeadline,
          company.rangeStart,
          company.rangeEnd,
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
          saleType,
          dueDate,
          paidAmount,
          balance,
          paymentStatus,
          tenderMethod,
          payload.notes?.trim() ? payload.notes.trim() : null,
          userId
        ]
      );

      const stockItems: Array<{
        productId: number;
        invoiceItemId: number;
        productName: string;
        quantity: number;
        unitCost: number | null;
        unitPrice: number;
      }> = [];

      for (const item of computedItems) {
        const [itemResult] = await connection.execute<ResultSetHeader>(
          `INSERT INTO invoice_items (
            invoice_id,
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
            invoiceResult.insertId,
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

        if (item.affectsInventory && item.productId) {
          stockItems.push({
            productId: item.productId,
            invoiceItemId: itemResult.insertId,
            productName: item.description,
            quantity: item.quantity,
            unitCost: item.unitCostSnapshot,
            unitPrice: item.unitPrice
          });
        }
      }

      if (warehouseId && stockItems.length > 0) {
        await inventoryService.applyInvoiceSale(connection, {
          companyId,
          userId,
          warehouseId,
          invoiceId: invoiceResult.insertId,
          items: stockItems
        });
      }

      // Alimenta la caja abierta con la venta de contado (ledger).
      if (saleType === "CONTADO" && openCashSession) {
        await cajaService.recordMovement(connection, {
          companyId,
          sessionId: openCashSession.id,
          userId,
          type: "VENTA_CONTADO",
          method: tenderMethod ?? "EFECTIVO",
          amount: grandTotal,
          referenceType: "invoice",
          referenceId: invoiceResult.insertId,
          description: `Venta contado ${sequence.invoiceNumber}`
        });
      }

        await connection.commit();

        return this.getInvoiceDetail(companyId, invoiceResult.insertId);
      } catch (error) {
        try {
          await connection.rollback();
        } catch (_rollbackError) {
          // noop
        }
        // El número calculado ya existe: el rango del CAI activo se solapa con
        // facturas ya emitidas del mismo prefijo. Mensaje claro en vez del error crudo.
        if ((error as { code?: string }).code === "ER_DUP_ENTRY") {
          throw new AppError(
            "El número a emitir ya existe. El rango del CAI activo se solapa con facturas anteriores; registra un CAI con un número inicial mayor o un prefijo distinto.",
            409
          );
        }
        throw error;
      } finally {
        connection.release();
      }
    });
  }

  async applyCorrection(
    companyId: number,
    userId: number,
    invoiceId: number,
    payload: {
      newCustomerName?: string;
      newInvoiceDate?: string;
      reason: string;
    }
  ) {
    const invoice = await this.getInvoiceDetail(companyId, invoiceId);
    const billingSettings = await settingsService.getBillingSettings(companyId);
    const normalizedCustomerName = this.normalizeNullable(payload.newCustomerName);
    const normalizedInvoiceDate = payload.newInvoiceDate ?? null;

    const customerChanged = Boolean(normalizedCustomerName && normalizedCustomerName !== invoice.printCustomerName);
    const dateChanged = Boolean(normalizedInvoiceDate && normalizedInvoiceDate !== invoice.printInvoiceDate);

    if (!customerChanged && !dateChanged) {
      throw new AppError("La corrección no produce cambios sobre la factura actual.", 400);
    }

    if (customerChanged && !billingSettings.allowClientNameCorrection) {
      throw new AppError("La empresa no permite corregir el nombre del cliente.", 400);
    }

    if (dateChanged && !billingSettings.allowInvoiceDateReissue) {
      throw new AppError("La empresa no permite reexpedir la factura con una nueva fecha.", 400);
    }

    if (normalizedInvoiceDate && normalizedInvoiceDate > invoice.issueDeadlineSnapshot) {
      throw new AppError("La nueva fecha supera la fecha límite de emisión del CAI de esta factura.", 400);
    }

    const correctionType = customerChanged && dateChanged ? "AMBOS" : customerChanged ? "NOMBRE_CLIENTE" : "FECHA_FACTURA";

    const [result] = await dbPool.execute<ResultSetHeader>(
      `INSERT INTO invoice_corrections (
        company_id,
        invoice_id,
        correction_type,
        previous_customer_name,
        new_customer_name,
        previous_invoice_date,
        new_invoice_date,
        reason,
        status,
        performed_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'APLICADA', ?)`,
      [
        companyId,
        invoiceId,
        correctionType,
        customerChanged ? invoice.printCustomerName : null,
        customerChanged ? normalizedCustomerName : null,
        dateChanged ? invoice.printInvoiceDate : null,
        dateChanged ? normalizedInvoiceDate : null,
        payload.reason.trim(),
        userId
      ]
    );

    const corrections = await this.listCorrections(companyId, invoiceId);
    const correction = corrections.find((item) => item.id === result.insertId);

    return {
      previous: {
        customerName: invoice.printCustomerName,
        invoiceDate: invoice.printInvoiceDate
      },
      correction,
      invoice: await this.getInvoiceDetail(companyId, invoiceId)
    };
  }
}

export const invoicesService = new InvoicesService();
