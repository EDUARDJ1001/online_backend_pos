import type { ResultSetHeader, RowDataPacket } from "mysql2";

import { dbPool } from "../../config/db";
import { cleanFooterText } from "../../utils/footer-text";
import { AppError } from "../../utils/http-error";

type DocumentType = "FACTURA" | "NOTA_CREDITO" | "NOTA_DEBITO" | "RECIBO";

/** Aviso cuando faltan 30 días o menos para la fecha límite de emisión. */
const DEADLINE_WARNING_DAYS = 30;
/** Aviso cuando quedan 50 correlativos o menos por usar. */
const RANGE_WARNING_REMAINING = 50;

interface BillingSettingsRow extends RowDataPacket {
  id: number;
  companyId: number;
  defaultTaxRate: number;
  footerText: string | null;
  payableTo: string | null;
  invoiceTitle: string;
  legendOriginal: string;
  legendCopy: string;
  sarNotice: string;
  allowClientNameCorrection: number;
  allowInvoiceDateReissue: number;
  createdAt: string;
  updatedAt: string;
}

interface BillingSeriesRow extends RowDataPacket {
  id: number;
  companyId: number;
  documentType: DocumentType;
  establishmentCode: string;
  pointCode: string;
  documentCode: string;
  cai: string;
  resolutionNumber: string | null;
  resolutionDate: string | Date | null;
  issueDeadline: string | Date;
  rangeStart: number;
  rangeEnd: number;
  currentNumber: number;
  isActive: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export type SeriesStatus = "VIGENTE" | "POR_VENCER" | "VENCIDA" | "AGOTADA" | "INACTIVA";

export interface BillingSeriesDetail {
  id: number;
  companyId: number;
  documentType: DocumentType;
  establishmentCode: string;
  pointCode: string;
  documentCode: string;
  cai: string;
  resolutionNumber: string | null;
  resolutionDate: string | null;
  issueDeadline: string;
  rangeStart: number;
  rangeEnd: number;
  currentNumber: number;
  isActive: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  /** Datos derivados, calculados para la pantalla de configuración. */
  prefix: string;
  firstNumber: string;
  lastNumber: string;
  nextNumber: string | null;
  totalAuthorized: number;
  issuedCount: number;
  remainingCount: number;
  usedPercent: number;
  daysToDeadline: number;
  status: SeriesStatus;
  warnings: string[];
}

type SeriesPayload = {
  documentType: DocumentType;
  establishmentCode: string;
  pointCode: string;
  documentCode: string;
  cai: string;
  resolutionNumber?: string;
  resolutionDate?: string;
  issueDeadline: string;
  rangeStart: number;
  rangeEnd: number;
  currentNumber?: number;
  isActive?: boolean;
  notes?: string;
};

const SELECT_SERIES = `
  SELECT
    id,
    company_id AS companyId,
    document_type AS documentType,
    establishment_code AS establishmentCode,
    point_code AS pointCode,
    document_code AS documentCode,
    cai,
    resolution_number AS resolutionNumber,
    resolution_date AS resolutionDate,
    issue_deadline AS issueDeadline,
    range_start AS rangeStart,
    range_end AS rangeEnd,
    current_number AS currentNumber,
    is_active AS isActive,
    notes,
    created_at AS createdAt,
    updated_at AS updatedAt
  FROM billing_series`;

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

function todayOnly() {
  return dateOnly(new Date())!;
}

function daysBetween(fromIso: string, toIso: string) {
  const from = Date.UTC(Number(fromIso.slice(0, 4)), Number(fromIso.slice(5, 7)) - 1, Number(fromIso.slice(8, 10)));
  const to = Date.UTC(Number(toIso.slice(0, 4)), Number(toIso.slice(5, 7)) - 1, Number(toIso.slice(8, 10)));

  return Math.round((to - from) / 86400000);
}

function normalize(value?: string | null) {
  return value?.trim() ? value.trim() : null;
}

class SettingsService {
  private async fetchSettings(companyId: number) {
    const [rows] = await dbPool.query<BillingSettingsRow[]>(
      `SELECT
        id,
        company_id AS companyId,
        default_tax_rate AS defaultTaxRate,
        footer_text AS footerText,
        payable_to AS payableTo,
        invoice_title AS invoiceTitle,
        legend_original AS legendOriginal,
        legend_copy AS legendCopy,
        sar_notice AS sarNotice,
        allow_client_name_correction AS allowClientNameCorrection,
        allow_invoice_date_reissue AS allowInvoiceDateReissue,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM billing_settings
      WHERE company_id = ?
      LIMIT 1`,
      [companyId]
    );

    return rows[0];
  }

  async getBillingSettings(companyId: number) {
    const settings = await this.fetchSettings(companyId);

    if (!settings) {
      throw new AppError("La empresa activa no tiene configuración de facturación.", 404);
    }

    return settings;
  }

  async updateBillingSettings(
    companyId: number,
    payload: {
      defaultTaxRate: number;
      footerText?: string;
      payableTo?: string;
      invoiceTitle: string;
      legendOriginal: string;
      legendCopy: string;
      sarNotice: string;
      allowClientNameCorrection: boolean;
      allowInvoiceDateReissue: boolean;
    }
  ) {
    const current = await this.getBillingSettings(companyId);

    const [result] = await dbPool.execute<ResultSetHeader>(
      `UPDATE billing_settings
      SET default_tax_rate = ?, footer_text = ?, payable_to = ?, invoice_title = ?,
          legend_original = ?, legend_copy = ?, sar_notice = ?,
          allow_client_name_correction = ?, allow_invoice_date_reissue = ?, updated_at = CURRENT_TIMESTAMP
      WHERE company_id = ?`,
      [
        payload.defaultTaxRate,
        cleanFooterText(payload.footerText),
        normalize(payload.payableTo),
        payload.invoiceTitle.trim(),
        payload.legendOriginal.trim(),
        payload.legendCopy.trim(),
        payload.sarNotice.trim(),
        payload.allowClientNameCorrection ? 1 : 0,
        payload.allowInvoiceDateReissue ? 1 : 0,
        companyId
      ]
    );

    if (!result.affectedRows) {
      throw new AppError("No se pudo actualizar la configuración fiscal.", 500);
    }

    return {
      previous: current,
      current: await this.getBillingSettings(companyId)
    };
  }

  /* ---------------------------------------------------------------- */
  /* Series de facturación (CAI)                                       */
  /* ---------------------------------------------------------------- */

  private format(number: number, row: Pick<BillingSeriesRow, "establishmentCode" | "pointCode" | "documentCode">) {
    return `${row.establishmentCode}-${row.pointCode}-${row.documentCode}-${String(number).padStart(8, "0")}`;
  }

  private toDetail(row: BillingSeriesRow): BillingSeriesDetail {
    const issueDeadline = dateOnly(row.issueDeadline)!;
    const today = todayOnly();
    const daysToDeadline = daysBetween(today, issueDeadline);

    const totalAuthorized = row.rangeEnd - row.rangeStart + 1;
    const issuedCount = Math.max(0, row.currentNumber - row.rangeStart);
    const remainingCount = Math.max(0, row.rangeEnd - row.currentNumber + 1);
    const expired = daysToDeadline < 0;
    const exhausted = remainingCount === 0;

    let status: SeriesStatus = "VIGENTE";

    if (!row.isActive) {
      status = "INACTIVA";
    } else if (expired) {
      status = "VENCIDA";
    } else if (exhausted) {
      status = "AGOTADA";
    } else if (daysToDeadline <= DEADLINE_WARNING_DAYS) {
      status = "POR_VENCER";
    }

    const warnings: string[] = [];

    if (row.isActive && expired) {
      warnings.push(`El CAI venció el ${issueDeadline}. No se pueden emitir facturas con esta serie.`);
    } else if (row.isActive && daysToDeadline <= DEADLINE_WARNING_DAYS) {
      warnings.push(`Faltan ${daysToDeadline} días para la fecha límite de emisión. Solicita un CAI nuevo al SAR.`);
    }

    if (row.isActive && exhausted) {
      warnings.push("El rango autorizado está agotado. No quedan correlativos disponibles.");
    } else if (row.isActive && remainingCount <= RANGE_WARNING_REMAINING) {
      warnings.push(`Quedan ${remainingCount} facturas del rango autorizado.`);
    }

    return {
      id: row.id,
      companyId: row.companyId,
      documentType: row.documentType,
      establishmentCode: row.establishmentCode,
      pointCode: row.pointCode,
      documentCode: row.documentCode,
      cai: row.cai,
      resolutionNumber: row.resolutionNumber,
      resolutionDate: dateOnly(row.resolutionDate),
      issueDeadline,
      rangeStart: row.rangeStart,
      rangeEnd: row.rangeEnd,
      currentNumber: row.currentNumber,
      isActive: row.isActive,
      notes: row.notes,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      prefix: `${row.establishmentCode}-${row.pointCode}-${row.documentCode}`,
      firstNumber: this.format(row.rangeStart, row),
      lastNumber: this.format(row.rangeEnd, row),
      nextNumber: exhausted ? null : this.format(row.currentNumber, row),
      totalAuthorized,
      issuedCount,
      remainingCount,
      usedPercent: totalAuthorized > 0 ? Math.round((issuedCount / totalAuthorized) * 100) : 0,
      daysToDeadline,
      status,
      warnings
    };
  }

  async listBillingSeries(companyId: number) {
    const [rows] = await dbPool.query<BillingSeriesRow[]>(
      `${SELECT_SERIES} WHERE company_id = ? ORDER BY id DESC`,
      [companyId]
    );

    return rows.map((row) => this.toDetail(row));
  }

  async findSeriesOrFail(companyId: number, seriesId: number) {
    const [rows] = await dbPool.query<BillingSeriesRow[]>(`${SELECT_SERIES} WHERE company_id = ? AND id = ? LIMIT 1`, [
      companyId,
      seriesId
    ]);

    const row = rows[0];

    if (!row) {
      throw new AppError("La serie de facturación no existe para la empresa activa.", 404);
    }

    return this.toDetail(row);
  }

  /** El CAI es único por empresa: no se puede registrar dos veces. */
  private async assertCaiUnique(companyId: number, cai: string, excludeId?: number) {
    const params: Array<string | number> = [companyId, cai];
    let sql = "SELECT id FROM billing_series WHERE company_id = ? AND UPPER(cai) = UPPER(?)";

    if (excludeId) {
      sql += " AND id <> ?";
      params.push(excludeId);
    }

    const [rows] = await dbPool.query<Array<RowDataPacket & { id: number }>>(`${sql} LIMIT 1`, params);

    if (rows[0]) {
      throw new AppError("Ese CAI ya está registrado. El CAI debe ser único.", 409);
    }
  }

  /** Solo puede haber una serie activa por tipo de documento: es la que toma el correlativo. */
  private async deactivateOthers(companyId: number, documentType: DocumentType, keepId: number) {
    await dbPool.execute(
      `UPDATE billing_series
       SET is_active = 0, updated_at = CURRENT_TIMESTAMP
       WHERE company_id = ? AND document_type = ? AND id <> ? AND is_active = 1`,
      [companyId, documentType, keepId]
    );
  }

  async createBillingSeries(companyId: number, payload: SeriesPayload) {
    // Única validación del CAI: no puede repetirse. Los números inicial/final son manuales.
    await this.assertCaiUnique(companyId, payload.cai);

    const currentNumber = payload.currentNumber ?? payload.rangeStart;
    const isActive = payload.isActive ?? true;

    // El CAI nuevo reemplaza al activo anterior: se desactiva primero para que
    // no haya conflicto de traslape ni dos series activas a la vez.
    if (isActive) {
      await dbPool.execute(
        "UPDATE billing_series SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE company_id = ? AND document_type = ? AND is_active = 1",
        [companyId, payload.documentType]
      );
    }

    const [result] = await dbPool.execute<ResultSetHeader>(
      `INSERT INTO billing_series
      (company_id, document_type, establishment_code, point_code, document_code, cai,
       resolution_number, resolution_date, issue_deadline, range_start, range_end,
       current_number, is_active, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        companyId,
        payload.documentType,
        payload.establishmentCode,
        payload.pointCode,
        payload.documentCode,
        payload.cai,
        normalize(payload.resolutionNumber),
        normalize(payload.resolutionDate),
        payload.issueDeadline,
        payload.rangeStart,
        payload.rangeEnd,
        currentNumber,
        isActive ? 1 : 0,
        normalize(payload.notes)
      ]
    );

    return this.findSeriesOrFail(companyId, result.insertId);
  }

  async updateBillingSeries(companyId: number, seriesId: number, payload: SeriesPayload & { currentNumber: number }) {
    const current = await this.findSeriesOrFail(companyId, seriesId);

    await this.assertCaiUnique(companyId, payload.cai, seriesId);

    // Retroceder el correlativo repetiría números ya impresos y entregados.
    if (payload.currentNumber < current.currentNumber) {
      throw new AppError(
        `El correlativo no puede retroceder: ya se emitieron facturas hasta ${this.format(current.currentNumber - 1, current)}.`,
        400
      );
    }

    if (current.issuedCount > 0 && payload.rangeStart !== current.rangeStart) {
      throw new AppError("No puedes cambiar el inicio del rango en una serie que ya emitió facturas.", 400);
    }

    await dbPool.execute(
      `UPDATE billing_series
      SET document_type = ?, establishment_code = ?, point_code = ?, document_code = ?, cai = ?,
          resolution_number = ?, resolution_date = ?, issue_deadline = ?, range_start = ?,
          range_end = ?, current_number = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
      WHERE company_id = ? AND id = ?`,
      [
        payload.documentType,
        payload.establishmentCode,
        payload.pointCode,
        payload.documentCode,
        payload.cai,
        normalize(payload.resolutionNumber),
        normalize(payload.resolutionDate),
        payload.issueDeadline,
        payload.rangeStart,
        payload.rangeEnd,
        payload.currentNumber,
        normalize(payload.notes),
        companyId,
        seriesId
      ]
    );

    return this.findSeriesOrFail(companyId, seriesId);
  }

  async updateBillingSeriesStatus(companyId: number, seriesId: number, isActive: boolean) {
    const current = await this.findSeriesOrFail(companyId, seriesId);

    if (isActive) {
      if (current.daysToDeadline < 0) {
        throw new AppError("No puedes activar una serie cuyo CAI ya venció.", 400);
      }

      if (current.remainingCount === 0) {
        throw new AppError("No puedes activar una serie con el rango agotado.", 400);
      }
    }

    await dbPool.execute("UPDATE billing_series SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE company_id = ? AND id = ?", [
      isActive ? 1 : 0,
      companyId,
      seriesId
    ]);

    if (isActive) {
      await this.deactivateOthers(companyId, current.documentType, seriesId);
    }

    return this.findSeriesOrFail(companyId, seriesId);
  }
}

export const settingsService = new SettingsService();
