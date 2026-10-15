import fs from "fs";
import path from "path";

const assetDirectories = [
  path.resolve(process.cwd(), "apps/backend/assets/invoices"),
  path.resolve(process.cwd(), "apps/frontend/public"),
  path.resolve(process.cwd(), "../frontend/public"),
  path.resolve(process.cwd(), "assets/invoices"),
  path.resolve(__dirname, "../../../assets/invoices"),
  path.resolve(__dirname, "../../../../assets/invoices"),
  path.resolve(__dirname, "../../../../frontend/public"),
  path.resolve(__dirname, "../../../../../frontend/public")
];

const mimeTypes: Record<string, string> = {
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png"
};

export function invoiceAssetPath(fileName: string) {
  for (const directory of assetDirectories) {
    const candidate = path.join(directory, fileName);

    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function invoiceAssetDataUri(fileName: string) {
  const assetPath = invoiceAssetPath(fileName);

  if (!assetPath) {
    return null;
  }

  const extension = path.extname(fileName).toLowerCase();
  const mimeType = mimeTypes[extension] ?? "application/octet-stream";
  const base64 = fs.readFileSync(assetPath).toString("base64");

  return `data:${mimeType};base64,${base64}`;
}

/**
 * Identidad de los documentos (facturas, proformas, cotizaciones) a partir de
 * los datos guardados de cada empresa: logo, color y marcas del pie. No hay
 * reglas por nombre de empresa.
 */

const DATA_IMAGE = /^data:image\/[a-z0-9.+-]+;base64,(.+)$/i;

/**
 * Logo guardado de la empresa para PDFKit: Buffer (data URI) o ruta de un asset
 * (nombre de archivo o ruta pública). Las URL remotas no se pueden embeber de
 * forma síncrona y se omiten. null si no hay logo utilizable.
 */
export function companyLogoForPdf(stored: string | null | undefined): Buffer | string | null {
  const value = stored?.trim();

  if (!value) {
    return null;
  }

  const match = DATA_IMAGE.exec(value);
  if (match) {
    return Buffer.from(match[1]!, "base64");
  }

  if (/^https?:\/\//i.test(value)) {
    return null;
  }

  return invoiceAssetPath(value);
}

/** Logo guardado de la empresa para HTML (src de <img>), o null si no hay. */
export function companyLogoSrc(stored: string | null | undefined) {
  const value = stored?.trim();

  if (!value) {
    return null;
  }

  if (value.startsWith("data:") || /^https?:\/\//i.test(value)) {
    return value;
  }

  return invoiceAssetDataUri(value);
}

/** Marcas del pie guardadas (JSON con data URIs). Ignora valores inválidos. */
export function parseFooterBrands(raw: string | null | undefined): string[] {
  if (!raw?.trim()) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string" && DATA_IMAGE.test(item)) : [];
  } catch (_error) {
    return [];
  }
}

/** Marcas del pie como Buffer para PDFKit. */
export function footerBrandBuffers(raw: string | null | undefined) {
  return parseFooterBrands(raw).map((uri) => Buffer.from(DATA_IMAGE.exec(uri)![1]!, "base64"));
}

export const DEFAULT_DOCUMENT_COLOR = "#416986";

function hexColor(value: string | null | undefined) {
  return value && /^#[0-9a-f]{6}$/i.test(value) ? value : null;
}

/** Color de los documentos: el propio de documentos, o el principal de la empresa. */
export function documentAccentColor(colors: {
  documentColor?: string | null;
  primaryColor?: string | null;
  headerColor?: string | null;
  sidebarColor?: string | null;
}) {
  return (
    hexColor(colors.documentColor) ??
    hexColor(colors.primaryColor) ??
    hexColor(colors.headerColor) ??
    hexColor(colors.sidebarColor) ??
    DEFAULT_DOCUMENT_COLOR
  );
}
