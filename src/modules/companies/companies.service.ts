import type { ResultSetHeader, RowDataPacket } from "mysql2";

import { dbPool, withTransaction, type DbConnection } from "../../config/db";
import { AppError } from "../../utils/http-error";

export interface CompanySummary extends RowDataPacket {
  id: number;
  code: string;
  commercialName: string;
  legalName: string;
  rtn: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  logoUrl: string | null;
  faviconUrl: string | null;
  layoutKey: string;
  primaryColor: string | null;
  secondaryColor: string | null;
  sidebarColor: string | null;
  headerColor: string | null;
  documentColor: string | null;
  themeMode: "light" | "dark";
}

export interface CreateCompanyPayload {
  commercialName: string;
  legalName: string;
  rtn: string;
  email?: string;
  phone?: string;
  address?: string;
  primaryColor?: string;
}

/** "Mi Tienda Ñandú" -> "MI_TIENDA_NANDU" (sin tildes, solo letras, números y _). */
function slug(value: string, max: number) {
  const clean = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return (clean || "EMPRESA").slice(0, max);
}

/** Primer valor libre de la columna: base, base_2, base_3... */
async function uniqueValue(connection: DbConnection, column: "code" | "layout_key", base: string, max: number) {
  for (let index = 1; index < 500; index += 1) {
    const suffix = index === 1 ? "" : `_${index}`;
    const candidate = `${base.slice(0, max - suffix.length)}${suffix}`;
    const [rows] = await connection.query<Array<RowDataPacket & { id: number }>>(`SELECT id FROM companies WHERE ${column} = ? LIMIT 1`, [candidate]);
    if (!rows[0]) {
      return candidate;
    }
  }
  throw new AppError("No se pudo generar un código para la empresa.", 500);
}

export interface UpdateCompanyPayload {
  commercialName: string;
  legalName: string;
  rtn: string;
  email?: string;
  phone?: string;
  address?: string;
  /** Data URI o URL. `undefined` conserva el valor actual, `""` lo limpia. */
  logo?: string;
  favicon?: string;
  /** Color de facturas/proformas/cotizaciones; `""` vuelve al color principal. */
  documentColor?: string;
  /** Marcas del pie (data URIs). `undefined` conserva las actuales. */
  footerBrands?: string[];
  themeMode: "light" | "dark";
}

/**
 * Columnas de la empresa que sí incluyen el logo/favicon. El logo se guarda
 * como data URI (base64) en una columna grande, así que solo se pide donde de
 * verdad se muestra (menú lateral, factura), no en cada request autenticado.
 */
const COMPANY_COLUMNS = `
  c.id,
  c.code,
  c.commercial_name AS commercialName,
  c.legal_name AS legalName,
  c.rtn,
  c.email,
  c.phone,
  c.address,
  c.logo_url AS logoUrl,
  c.favicon_url AS faviconUrl,
  c.layout_key AS layoutKey,
  c.primary_color AS primaryColor,
  c.secondary_color AS secondaryColor,
  c.sidebar_color AS sidebarColor,
  c.header_color AS headerColor,
  c.document_color AS documentColor,
  c.theme_mode AS themeMode`;

/**
 * Versión ligera para el middleware de empresa activa: se resuelve en cada
 * request, así que no arrastra el data URI del logo. Mantiene la misma forma
 * devolviendo NULL en logo/favicon.
 */
const COMPANY_COLUMNS_LEAN = `
  c.id,
  c.code,
  c.commercial_name AS commercialName,
  c.legal_name AS legalName,
  c.rtn,
  c.email,
  c.phone,
  c.address,
  NULL AS logoUrl,
  NULL AS faviconUrl,
  c.layout_key AS layoutKey,
  c.primary_color AS primaryColor,
  c.secondary_color AS secondaryColor,
  c.sidebar_color AS sidebarColor,
  c.header_color AS headerColor,
  c.document_color AS documentColor,
  c.theme_mode AS themeMode`;

function normalize(value?: string | null) {
  return value?.trim() ? value.trim() : null;
}

class CompaniesService {
  async getUserCompanies(userId: number) {
    const [rows] = await dbPool.query<CompanySummary[]>(
      `SELECT ${COMPANY_COLUMNS}
      FROM user_company_access uca
      INNER JOIN companies c ON c.id = uca.company_id
      WHERE uca.user_id = ? AND c.is_active = 1
      ORDER BY c.commercial_name ASC`,
      [userId]
    );

    return rows;
  }

  async assertUserCompanyAccess(userId: number, companyId: number) {
    const [rows] = await dbPool.query<CompanySummary[]>(
      `SELECT ${COMPANY_COLUMNS_LEAN}
      FROM user_company_access uca
      INNER JOIN companies c ON c.id = uca.company_id
      WHERE uca.user_id = ? AND uca.company_id = ? AND c.is_active = 1
      LIMIT 1`,
      [userId, companyId]
    );

    const company = rows[0];

    if (!company) {
      // COMPANY_ACCESS: la pantalla olvida la empresa guardada y pide elegir otra.
      throw new AppError("No tienes acceso a la empresa seleccionada.", 403, { code: "COMPANY_ACCESS" });
    }

    return company;
  }

  private async findCompanyById(companyId: number) {
    const [rows] = await dbPool.query<CompanySummary[]>(
      `SELECT ${COMPANY_COLUMNS} FROM companies c WHERE c.id = ? LIMIT 1`,
      [companyId]
    );

    const company = rows[0];

    if (!company) {
      throw new AppError("La empresa no existe.", 404);
    }

    return company;
  }

  /**
   * Crea una empresa lista para configurar: datos de facturación, series de
   * proformas y cotizaciones, bodega principal, "Caja 1", cliente "Consumidor
   * final" y acceso para quien la crea. Falta el CAI, que se registra en
   * "Facturación SAR" antes de poder facturar.
   */
  async createCompany(userId: number, payload: CreateCompanyPayload) {
    try {
      const companyId = await withTransaction(async (connection) => {
        const code = await uniqueValue(connection, "code", slug(payload.commercialName, 30), 30);
        const layoutKey = await uniqueValue(connection, "layout_key", slug(payload.commercialName, 50).toLowerCase(), 50);
        const legalName = payload.legalName.trim();

        const [result] = await connection.execute<ResultSetHeader>(
          `INSERT INTO companies (code, commercial_name, legal_name, rtn, email, phone, address, layout_key, primary_color, theme_mode, is_active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'light', 1)`,
          [
            code,
            payload.commercialName.trim(),
            legalName,
            payload.rtn.trim(),
            normalize(payload.email),
            normalize(payload.phone),
            normalize(payload.address),
            layoutKey,
            normalize(payload.primaryColor) ?? "#0F172A"
          ]
        );
        const id = result.insertId;

        await connection.execute(
          `INSERT INTO billing_settings (company_id, default_tax_rate, footer_text, payable_to, invoice_title, allow_client_name_correction, allow_invoice_date_reissue)
           VALUES (?, 15.00, 'Gracias por su compra.', ?, 'Factura', 1, 1)`,
          [id, legalName]
        );
        await connection.execute("INSERT INTO proforma_series (company_id, prefix, current_number, is_active) VALUES (?, 'PRO-', 1, 1)", [id]);
        await connection.execute("INSERT INTO quote_series (company_id, prefix, current_number, is_active) VALUES (?, 'COT-', 1, 1)", [id]);
        await connection.execute(
          "INSERT INTO warehouses (company_id, code, name, is_default, is_active) VALUES (?, 'PRINCIPAL', 'Bodega principal', 1, 1)",
          [id]
        );
        await connection.execute("INSERT INTO cash_registers (company_id, name) VALUES (?, 'Caja 1')", [id]);
        await connection.execute(
          "INSERT INTO clients (company_id, code, name, is_generic, created_by) VALUES (?, '1', 'Consumidor final', 1, ?)",
          [id, userId]
        );
        await connection.execute("INSERT INTO user_company_access (user_id, company_id) VALUES (?, ?)", [userId, id]);

        return id;
      });

      return this.findCompanyById(companyId);
    } catch (error) {
      if (error instanceof Error && (error as { code?: string }).code === "ER_DUP_ENTRY") {
        throw new AppError("Ya existe una empresa con ese RTN.", 409);
      }
      throw error;
    }
  }

  /**
   * Marcas del pie de los documentos (JSON de data URIs). Se piden aparte porque
   * pueden pesar varios cientos de KB: solo al generar un documento o al editarlas.
   */
  async documentBranding(companyId: number) {
    const [rows] = await dbPool.query<Array<RowDataPacket & { footerBrands: string | null }>>(
      "SELECT footer_brands AS footerBrands FROM companies WHERE id = ? LIMIT 1",
      [companyId]
    );

    return { footerBrands: rows[0]?.footerBrands ?? null };
  }

  /**
   * Actualiza los datos de identidad de la empresa y de sus documentos. No toca
   * los colores de la interfaz ni el layout.
   */
  async updateCompany(companyId: number, payload: UpdateCompanyPayload) {
    const previous = await this.findCompanyById(companyId);

    // `undefined` conserva el logo actual; `""` lo limpia; un valor lo reemplaza.
    const logoUrl = payload.logo === undefined ? previous.logoUrl : normalize(payload.logo);
    const faviconUrl = payload.favicon === undefined ? previous.faviconUrl : normalize(payload.favicon);
    const documentColor = payload.documentColor === undefined ? previous.documentColor : normalize(payload.documentColor);
    const footerBrands =
      payload.footerBrands === undefined
        ? (await this.documentBranding(companyId)).footerBrands
        : payload.footerBrands.length > 0
          ? JSON.stringify(payload.footerBrands)
          : null;

    try {
      const [result] = await dbPool.execute<ResultSetHeader>(
        `UPDATE companies
        SET commercial_name = ?, legal_name = ?, rtn = ?, email = ?, phone = ?, address = ?,
            logo_url = ?, favicon_url = ?, document_color = ?, footer_brands = ?, theme_mode = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
        [
          payload.commercialName.trim(),
          payload.legalName.trim(),
          payload.rtn.trim(),
          normalize(payload.email),
          normalize(payload.phone),
          normalize(payload.address),
          logoUrl,
          faviconUrl,
          documentColor,
          footerBrands,
          payload.themeMode,
          companyId
        ]
      );

      if (!result.affectedRows) {
        throw new AppError("No se pudo actualizar la empresa.", 500);
      }
    } catch (error) {
      if (error instanceof Error && (error as { code?: string }).code === "ER_DUP_ENTRY") {
        throw new AppError("Ya existe otra empresa con ese RTN.", 409);
      }

      throw error;
    }

    return {
      previous,
      current: await this.findCompanyById(companyId)
    };
  }
}

export const companiesService = new CompaniesService();
