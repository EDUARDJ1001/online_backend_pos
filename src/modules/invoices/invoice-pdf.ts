import type { Response } from "express";
import PDFDocument from "pdfkit";

import { drawFooterBrands, drawFooterText } from "./document-footer";
import { companyLogoForPdf, documentAccentColor, footerBrandBuffers } from "./invoice-assets";

interface PdfInvoiceDetail {
  invoiceNumber: string;
  /** Usuario que emitió la factura (cajero). */
  createdByName?: string | null;
  printInvoiceDate: string;
  /** Momento real de emisión (para la hora del ticket). */
  issuedAt?: string | Date | null;
  printCustomerName: string;
  customerRtnSnapshot: string | null;
  customerPhoneSnapshot: string | null;
  customerAddressSnapshot: string | null;
  companyCommercialNameSnapshot: string;
  companyLegalNameSnapshot: string;
  companyRtnSnapshot: string;
  companyPhoneSnapshot: string | null;
  companyEmailSnapshot: string | null;
  companyAddressSnapshot: string | null;
  companyLogoUrl?: string | null;
  companyDocumentColor?: string | null;
  /** Marcas del pie (JSON de data URIs), ver companiesService.documentBranding. */
  companyFooterBrands?: string | null;
  companyPrimaryColor?: string | null;
  companyHeaderColor?: string | null;
  companySidebarColor?: string | null;
  subtotal: number;
  discountTotal: number;
  taxableAmount15: number;
  taxableAmount18: number;
  exemptAmount: number;
  exoneratedAmount: number;
  isv15: number;
  isv18: number;
  grandTotal: number;
  totalInWords: string | null;
  caiSnapshot: string;
  issueDeadlineSnapshot: string;
  rangeStartSnapshot: number;
  rangeEndSnapshot: number;
  notes: string | null;
  items: Array<{
    lineNumber: number;
    productCode: string | null;
    description: string;
    quantity: number;
    unitPrice: number;
    lineDiscount: number;
    lineSubtotal?: number;
    lineTax: number;
    lineTotal: number;
  }>;
  corrections: Array<{
    correctionType: string;
    reason: string;
    createdAt: string;
    performedByName: string;
  }>;
  settings?: {
    footerText: string | null;
    payableTo: string | null;
    invoiceTitle: string;
  };
}

const brandBlue = "#416986";
const lightBlue = "#d7e1ea";
const totalBlue = "#c3d0d8";
const ink = "#1f2933";

function accentColor(detail: PdfInvoiceDetail) {
  return documentAccentColor({
    documentColor: detail.companyDocumentColor,
    primaryColor: detail.companyPrimaryColor,
    headerColor: detail.companyHeaderColor,
    sidebarColor: detail.companySidebarColor
  });
}

function money(value: number, emptyWhenZero = false) {
  if (emptyWhenZero && Math.abs(value) < 0.005) {
    return "";
  }

  return `L${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value)}`;
}

function quantity(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function printDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);

  if (match) {
    const [, year, month, day] = match;
    return new Date(Number(year), Number(month) - 1, Number(day)).toLocaleDateString("es-HN", {
      day: "numeric",
      month: "long",
      year: "numeric"
    });
  }

  return new Date(value).toLocaleDateString("es-HN", {
    day: "numeric",
    month: "long",
    year: "numeric"
  });
}

/** ", 3:45 p. m." con la hora real de emisión en hora de Honduras; vacío si no hay. */
function issuedTime(value: string | Date | null | undefined) {
  const parsed = value ? new Date(value) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) {
    return "";
  }
  return `, ${parsed.toLocaleTimeString("es-HN", { timeZone: "America/Tegucigalpa", hour: "numeric", minute: "2-digit" })}`;
}

function authorizedRange(detail: PdfInvoiceDetail) {
  const prefix = detail.invoiceNumber.match(/^(\d{3}-\d{3}-\d{2}-)/)?.[1] ?? "";
  const start = `${prefix}${String(detail.rangeStartSnapshot).padStart(8, "0")}`;
  const end = `${prefix}${String(detail.rangeEndSnapshot).padStart(8, "0")}`;

  return `${start} al ${end}`;
}

function lineAmount(item: PdfInvoiceDetail["items"][number]) {
  return item.lineSubtotal ?? item.lineTotal - item.lineTax;
}

function drawText(
  doc: PDFKit.PDFDocument,
  text: string,
  x: number,
  y: number,
  options: PDFKit.Mixins.TextOptions & { size?: number; color?: string; bold?: boolean } = {}
) {
  doc
    .font(options.bold ? "Helvetica-Bold" : "Helvetica")
    .fontSize(options.size ?? 9)
    .fillColor(options.color ?? ink)
    .text(text, x, y, options);
}

/** Tamaño de letra más grande (entre max y min) con el que el texto cabe en una línea. */
function fittedFontSize(doc: PDFKit.PDFDocument, text: string, width: number, max: number, min: number, bold = false) {
  doc.font(bold ? "Helvetica-Bold" : "Helvetica");
  let size = max;
  while (size > min && doc.fontSize(size).widthOfString(text) > width) {
    size -= 0.25;
  }
  return size;
}

function drawFittedText(
  doc: PDFKit.PDFDocument,
  text: string,
  x: number,
  y: number,
  options: PDFKit.Mixins.TextOptions & {
    size?: number;
    minSize?: number;
    maxHeight: number;
    color?: string;
    bold?: boolean;
  }
) {
  const { size = 9, minSize = 7, maxHeight, width, color, bold, ...textOptions } = options;
  let fontSize = size;
  let wrapped = wrapTextToWidth(doc, text, width, fontSize, Boolean(bold), maxHeight);

  while (wrapped.truncated && fontSize > minSize) {
    fontSize -= 0.5;
    wrapped = wrapTextToWidth(doc, text, width, fontSize, Boolean(bold), maxHeight);
  }

  wrapped.lines.forEach((line, index) => {
    drawText(doc, line, x, y + index * wrapped.lineHeight, {
      ...textOptions,
      width,
      size: fontSize,
      color,
      bold,
      lineBreak: false
    });
  });
}

function wrapTextToWidth(
  doc: PDFKit.PDFDocument,
  text: string,
  width: number | undefined,
  fontSize: number,
  bold: boolean,
  maxHeight: number
) {
  const lineHeight = fontSize * 1.15;
  const maxLines = Math.max(1, Math.floor(maxHeight / lineHeight));
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  const lines: string[] = [];
  let truncated = false;

  if (!width || !normalized) {
    return { lines: normalized ? [normalized] : [""], lineHeight, truncated: false };
  }

  doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(fontSize);

  const canFit = (value: string) => doc.widthOfString(value) <= width;
  const pushLine = (line: string) => {
    if (lines.length >= maxLines) {
      truncated = true;
      return false;
    }

    lines.push(line);
    return true;
  };

  let current = "";

  for (const word of normalized.split(" ")) {
    const candidate = current ? `${current} ${word}` : word;

    if (canFit(candidate)) {
      current = candidate;
      continue;
    }

    if (current && !pushLine(current)) {
      break;
    }

    current = "";

    if (canFit(word)) {
      current = word;
      continue;
    }

    let chunk = "";
    for (const char of Array.from(word)) {
      const nextChunk = `${chunk}${char}`;

      if (!chunk || canFit(nextChunk)) {
        chunk = nextChunk;
        continue;
      }

      if (!pushLine(chunk)) {
        break;
      }
      chunk = char;
    }

    if (truncated) {
      break;
    }

    current = chunk;
  }

  if (!truncated && current) {
    pushLine(current);
  }

  return { lines: lines.length > 0 ? lines : [""], lineHeight, truncated };
}

function drawImagePath(
  doc: PDFKit.PDFDocument,
  source: string | Buffer,
  x: number,
  y: number,
  options: PDFKit.Mixins.ImageOption
) {
  try {
    doc.image(source, x, y, options);
    return true;
  } catch (_error) {
    return false;
  }
}

/** Logo guardado de la empresa (opcional). */
function resolveLogoForPdf(detail: PdfInvoiceDetail) {
  return companyLogoForPdf(detail.companyLogoUrl);
}

function drawHeader(doc: PDFKit.PDFDocument, detail: PdfInvoiceDetail) {
  const logo = resolveLogoForPdf(detail);
  const accent = accentColor(detail);

  // El logo es opcional: si la empresa no tiene ninguno, el encabezado no dibuja
  // placeholder (círculo con iniciales), simplemente queda sin logo.
  if (logo) {
    drawImagePath(doc, logo, 28, 16, { fit: [72, 58], align: "center", valign: "center" });
  }

  drawText(doc, detail.settings?.invoiceTitle ?? "Factura", 350, 36, {
    width: 230,
    align: "right",
    size: 34,
    bold: true,
    color: brandBlue
  });

  doc.moveTo(14, 88).lineTo(598, 88).strokeColor(accent).lineWidth(1.1).stroke();
}

function drawCompany(doc: PDFKit.PDFDocument, detail: PdfInvoiceDetail) {
  const top = 102;
  const accent = accentColor(detail);
  drawText(doc, detail.companyLegalNameSnapshot, 18, top, { size: 11, bold: true, color: brandBlue });
  drawFittedText(doc, detail.companyAddressSnapshot ?? "Dirección no disponible", 18, top + 15, {
    size: 9.5,
    minSize: 7.5,
    maxHeight: 28,
    color: brandBlue,
    width: 300
  });
  drawText(doc, `Telefono: ${detail.companyPhoneSnapshot ?? "Sin teléfono"}`, 18, top + 45, { size: 9.5, color: brandBlue });
  drawText(doc, detail.companyEmailSnapshot ?? "", 18, top + 58, { size: 9.5, color: "#00a1cf" });

  const labelX = 360;
  const valueX = 442;
  drawText(doc, "Fecha:", labelX, top + 2, { size: 9.2, bold: true, color: brandBlue, align: "right", width: 70 });
  drawText(doc, printDate(detail.printInvoiceDate), valueX, top + 2, { size: 9.2, color: ink, align: "right", width: 148 });
  drawText(doc, "R.T.N.:", labelX, top + 18, { size: 9.2, bold: true, color: brandBlue, align: "right", width: 70 });
  drawText(doc, detail.companyRtnSnapshot, valueX, top + 18, { size: 9.2, bold: true, color: brandBlue, align: "right", width: 148 });
  drawText(doc, "Cai:", labelX, top + 34, { size: 9.2, bold: true, color: brandBlue, align: "right", width: 70 });
  // El CAI es largo y sin espacios: se achica hasta caber entre la etiqueta y el borde
  // (antes se salía hacia la izquierda y quedaba encima de "Cai:").
  const caiLeft = labelX + 70 + 6;
  const caiWidth = valueX + 148 - caiLeft;
  const caiSize = fittedFontSize(doc, detail.caiSnapshot, caiWidth, 7.8, 5, true);
  drawText(doc, detail.caiSnapshot, caiLeft, top + 34 + (7.8 - caiSize) / 2, {
    size: caiSize,
    bold: true,
    color: brandBlue,
    align: "right",
    width: caiWidth,
    lineBreak: false
  });

  doc.moveTo(14, 170).lineTo(598, 170).strokeColor(accent).lineWidth(1.1).stroke();
}

function drawCustomer(doc: PDFKit.PDFDocument, detail: PdfInvoiceDetail) {
  const top = 182;
  const leftValueX = 78;
  const rightLabelX = 318;
  const rightValueX = 455;
  const leftValueWidth = rightLabelX - leftValueX - 14;

  drawText(doc, "Nombre", 18, top, { bold: true, color: brandBlue, size: 10 });
  drawFittedText(doc, detail.printCustomerName, leftValueX, top, { size: 10, minSize: 8, maxHeight: 13, width: leftValueWidth });
  drawText(doc, "Dirección", 18, top + 15, { bold: true, color: brandBlue, size: 10 });
  drawFittedText(doc, detail.customerAddressSnapshot ?? "Sin dirección", leftValueX, top + 15, {
    size: 9.2,
    minSize: 7,
    maxHeight: 31,
    width: leftValueWidth
  });
  drawText(doc, "Telefono", 18, top + 49, { bold: true, color: brandBlue, size: 10 });
  drawText(doc, detail.customerPhoneSnapshot ?? "Sin teléfono", leftValueX, top + 49, { size: 10, width: leftValueWidth });
  drawText(doc, "RTN Cliente:", 18, top + 63, { bold: true, color: brandBlue, size: 10 });
  doc.rect(leftValueX, top + 61, leftValueWidth, 14).fillColor("#d9d9d9").fill();
  drawText(doc, detail.customerRtnSnapshot ?? "Consumidor final", leftValueX + 3, top + 63, { size: 10, width: leftValueWidth - 6 });

  drawText(doc, "No. Factura", rightLabelX, top + 15, { size: 9 });
  drawText(doc, detail.invoiceNumber, rightValueX, top + 15, { size: 10, bold: true, color: "#ff0000", align: "right", width: 135 });
  drawText(doc, "Fecha Límite de Emisión:", rightLabelX, top + 30, { size: 9 });
  drawText(doc, printDate(detail.issueDeadlineSnapshot), rightValueX, top + 30, { size: 8.8, align: "right", width: 135 });
  drawText(doc, "Rango Autorizado:", rightLabelX, top + 45, { size: 9 });
  drawText(doc, authorizedRange(detail), rightValueX - 28, top + 45, { size: 7.8, align: "right", width: 163 });
}

function drawItems(doc: PDFKit.PDFDocument, detail: PdfInvoiceDetail) {
  const startY = 260;
  const headerHeight = 17;
  const baseRowHeight = detail.items.length > 18 ? 12 : 15;
  const minRows = Math.max(12, detail.items.length);
  const cols: [number, number, number, number, number] = [14, 70, 335, 460, 598];
  const accent = accentColor(detail);
  const fontSize = baseRowHeight < 15 ? 7.5 : 8.5;
  const lineHeight = fontSize * 1.15;
  const descriptionWidth = cols[2] - cols[1] - 8;
  // Con pocos productos sobra espacio vertical para descripciones largas; con muchos
  // se limita el número de líneas para no empujar los totales fuera de la página.
  const maxDescriptionLines = detail.items.length <= 6 ? 5 : detail.items.length <= 12 ? 3 : 2;
  const wrappedDescriptions = detail.items.map((item) =>
    wrapTextToWidth(doc, item.description, descriptionWidth, fontSize, false, maxDescriptionLines * lineHeight + 1)
  );

  doc.rect(cols[0], startY, cols[4] - cols[0], headerHeight).fillColor(accent).fill();
  drawText(doc, "Cant.", cols[0], startY + 4, { width: cols[1] - cols[0], align: "center", color: "#ffffff", size: 9, bold: true });
  drawText(doc, "Descripción", cols[1], startY + 4, { width: cols[2] - cols[1], align: "center", color: "#ffffff", size: 9, bold: true });
  drawText(doc, "Precio por unidad", cols[2], startY + 4, { width: cols[3] - cols[2], align: "center", color: "#ffffff", size: 9, bold: true });
  drawText(doc, "Total", cols[3], startY + 4, { width: cols[4] - cols[3], align: "center", color: "#ffffff", size: 9, bold: true });

  let y = startY + headerHeight;

  for (let index = 0; index < minRows; index += 1) {
    const item = detail.items[index];
    const wrapped = item ? wrappedDescriptions[index] : undefined;
    const rowHeight = wrapped ? Math.max(baseRowHeight, wrapped.lines.length * wrapped.lineHeight + 5) : baseRowHeight;
    const isAlt = index % 2 === 1;
    doc.rect(cols[0], y, cols[4] - cols[0], rowHeight).fillColor(isAlt ? lightBlue : "#ffffff").fill();

    for (const x of cols.slice(1, 4)) {
      doc.moveTo(x, y).lineTo(x, y + rowHeight).strokeColor("#ffffff").lineWidth(1).stroke();
    }

    if (item && wrapped) {
      drawText(doc, quantity(Number(item.quantity)), cols[0], y + 3, { width: cols[1] - cols[0], align: "center", size: fontSize, color: "#000000" });
      wrapped.lines.forEach((line, lineIndex) => {
        drawText(doc, line, cols[1] + 4, y + 3 + lineIndex * wrapped.lineHeight, {
          width: descriptionWidth,
          size: fontSize,
          color: "#000000",
          lineBreak: false
        });
      });
      drawText(doc, money(Number(item.unitPrice)), cols[2] + 4, y + 3, { width: cols[3] - cols[2] - 8, align: "right", size: fontSize, color: "#000000" });
      drawText(doc, money(Number(lineAmount(item))), cols[3] + 4, y + 3, { width: cols[4] - cols[3] - 8, align: "right", size: fontSize, color: "#000000" });
    }

    y += rowHeight;
  }

  return y + 10;
}

function drawTotals(doc: PDFKit.PDFDocument, detail: PdfInvoiceDetail, y: number) {
  const summaryY = Math.max(y, 510);
  const labelX = 338;
  const amountX = 460;
  const amountWidth = 132;
  const lineHeight = 14;

  drawText(doc, "Datos del Adquiriente Exonerado:", 18, summaryY + 24, { size: 10 });
  drawText(doc, "No. Orden Compra Excenta:", 18, summaryY + 40, { size: 10 });
  drawText(doc, "No. Constancia Registro Exonerado:", 18, summaryY + 56, { size: 10 });
  drawText(doc, "No. Registro SAG:", 18, summaryY + 72, { size: 10 });

  const rows: Array<[string, string, boolean?]> = [
    ["Subtotal", money(detail.subtotal)],
    ["Descuentos y Rebajas", money(detail.discountTotal, true)],
    ["Importe Exonerado", money(detail.exoneratedAmount, true)],
    ["Importe Excento", money(detail.exemptAmount, true)],
    ["Importe Gravado 15%", money(detail.taxableAmount15, true)],
    ["Importe Gravado 18%", money(detail.taxableAmount18, true)],
    ["ISV 15%", money(detail.isv15, true)],
    ["ISV 18%", money(detail.isv18, true)],
    ["Total a Pagar", money(detail.grandTotal), true]
  ];

  rows.forEach(([label, value, grand], index) => {
    const rowY = summaryY + index * lineHeight;
    drawText(doc, label, labelX, rowY + 3, { width: amountX - labelX - 4, align: "right", size: 8.2, bold: true, color: brandBlue, lineBreak: false });
    doc.rect(amountX, rowY, amountWidth, lineHeight - 1).fillColor(grand ? lightBlue : totalBlue).fill();
    drawText(doc, value, amountX + 4, rowY + 3, { width: amountWidth - 8, align: "right", size: 8.2, bold: Boolean(grand), color: ink });
  });

  return summaryY + rows.length * lineHeight + 18;
}

function drawFooter(doc: PDFKit.PDFDocument, detail: PdfInvoiceDetail, y: number) {
  const accent = accentColor(detail);

  // El bloque de pie SIGUE a la tabla de totales (y ya viene ~18px debajo de ella);
  // se topa antes de la franja de marcas para no traslaparse con los logos.
  const brandBarY = 714;
  const base = Math.min(y, 668);

  drawText(doc, "Valor en Letras:", 210, base, { size: 9 });
  drawText(doc, detail.totalInWords ?? "No disponible", 286, base, { size: 9, bold: true, width: 290, lineBreak: false });

  const payableTo = detail.settings?.payableTo ?? detail.companyLegalNameSnapshot;
  drawText(doc, "Todos los cheques se extenderán a nombre de", 106, base + 18, { size: 9 });
  drawText(doc, payableTo, 333, base + 18, { size: 9, bold: true, width: 180, lineBreak: false });

  const brands = footerBrandBuffers(detail.companyFooterBrands);
  const corrected = detail.corrections.length > 0;
  // Un dibujo de varias líneas se achica para caber antes de las marcas (o del borde).
  const footerEnd = drawFooterText(doc, detail.settings?.footerText ?? "Gracias por su confianza.", {
    x: 20,
    y: base + 38,
    width: 572,
    size: 9.5,
    maxHeight: (brands.length > 0 ? brandBarY - 4 : 774) - (base + 38) - (corrected ? 12 : 0)
  });

  if (corrected) {
    drawText(doc, "Documento con correcciones registradas.", 0, Math.max(base + 52, footerEnd + 3), {
      width: 612,
      align: "center",
      size: 7,
      color: "#64748b"
    });
  }

  drawFooterBrands(doc, brands, brandBarY, accent);
}

export function writeInvoicePdf(detail: PdfInvoiceDetail, res: Response) {
  const doc = new PDFDocument({ size: "LETTER", margin: 0 });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="factura-${detail.invoiceNumber}.pdf"`);

  doc.pipe(res);

  doc.rect(14, 12, 584, 768).strokeColor("#001eff").lineWidth(1.1).stroke();

  drawHeader(doc, detail);
  drawCompany(doc, detail);
  drawCustomer(doc, detail);
  const afterItems = drawItems(doc, detail);
  const afterTotals = drawTotals(doc, detail, afterItems);
  drawFooter(doc, detail, afterTotals);

  doc.end();
}

const TICKET_WIDTH = 226.77; // 80mm
const TICKET_MARGIN = 10;

/**
 * Ticket de 80mm (rollo). Una columna, compacto, para impresora térmica.
 * Primero se dibuja en una hoja muy larga para medirlo y luego en una del alto
 * exacto: el rollo no avanza papel en blanco al final.
 */
export function writeInvoiceTicketPdf(detail: PdfInvoiceDetail, res: Response) {
  const margins = { top: TICKET_MARGIN, bottom: 0, left: TICKET_MARGIN, right: TICKET_MARGIN };
  const measured = drawInvoiceTicket(new PDFDocument({ size: [TICKET_WIDTH, 20000], margins }), detail);
  const doc = new PDFDocument({ size: [TICKET_WIDTH, Math.ceil(measured + TICKET_MARGIN)], margins });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="ticket-${detail.invoiceNumber}.pdf"`);
  doc.pipe(res);
  drawInvoiceTicket(doc, detail);
  doc.end();
}

/** Dibuja el ticket y devuelve dónde termina. */
function drawInvoiceTicket(doc: PDFKit.PDFDocument, detail: PdfInvoiceDetail) {
  const width = TICKET_WIDTH;
  const margin = TICKET_MARGIN;
  const inner = width - margin * 2;
  const logo = resolveLogoForPdf(detail);
  const logoHeight = 48;
  const commercialName = detail.companyCommercialNameSnapshot?.trim();
  // Con logo no se imprime el nombre comercial (el logo ya lo representa).
  const showCommercialName = !logo && Boolean(commercialName) && commercialName !== detail.companyLegalNameSnapshot;
  const footer = detail.settings?.footerText ?? "¡Gracias por su compra!";

  const line = (text: string, options: { size?: number; bold?: boolean; align?: "left" | "center" | "right"; color?: string; gap?: number } = {}) => {
    doc
      .font(options.bold ? "Helvetica-Bold" : "Helvetica")
      .fontSize(options.size ?? 8)
      .fillColor(options.color ?? ink)
      .text(text, margin, doc.y, { width: inner, align: options.align ?? "left" });
    if (options.gap) {
      doc.moveDown(options.gap);
    }
  };

  const rule = () => {
    doc.moveTo(margin, doc.y + 2).lineTo(width - margin, doc.y + 2).dash(1, { space: 1.5 }).strokeColor("#94a3b8").lineWidth(0.5).stroke().undash();
    doc.moveDown(0.5);
  };

  if (logo && drawImagePath(doc, logo, margin, doc.y, { fit: [inner, logoHeight], align: "center", valign: "center" })) {
    doc.y += logoHeight + 4;
  }
  if (showCommercialName) {
    line(commercialName!, { size: 12, bold: true, align: "center" });
  }
  line(detail.companyLegalNameSnapshot, { size: 10, bold: true, align: "center" });
  line(`RTN: ${detail.companyRtnSnapshot}`, { align: "center", size: 7.5 });
  if (detail.companyAddressSnapshot) {
    line(detail.companyAddressSnapshot, { align: "center", size: 7.5, color: "#475569" });
  }
  if (detail.companyPhoneSnapshot) {
    line(`Tel: ${detail.companyPhoneSnapshot}`, { align: "center", size: 7.5, color: "#475569" });
  }
  doc.moveDown(0.4);

  line(detail.settings?.invoiceTitle ?? "FACTURA", { size: 9, bold: true, align: "center" });
  line(`No. ${detail.invoiceNumber}`, { size: 9, bold: true, align: "center", color: "#b91c1c" });
  line(`Fecha: ${printDate(detail.printInvoiceDate)}${issuedTime(detail.issuedAt)}`, { size: 7.5, align: "center" });
  line(`Cajero: ${detail.createdByName ?? "N/D"}`, { size: 7.5, align: "center" });
  line(`CAI: ${detail.caiSnapshot}`, { size: 6.5, align: "center", color: "#475569" });
  rule();

  line(`Cliente: ${detail.printCustomerName}`, { size: 8 });
  line(`RTN: ${detail.customerRtnSnapshot ?? "Consumidor final"}`, { size: 7.5, color: "#475569" });
  rule();

  // Texto a la izquierda e importe pegado al borde derecho, en la misma línea.
  const pair = (left: string, right: string, opts: { bold?: boolean; size?: number } = {}) => {
    doc.font(opts.bold ? "Helvetica-Bold" : "Helvetica").fontSize(opts.size ?? 8).fillColor(ink);
    const top = doc.y;
    doc.text(right, margin, top, { width: inner, align: "right", lineBreak: false });
    doc.text(left, margin, top, { width: inner - doc.widthOfString(right) - 6 });
  };

  // Encabezado de columnas
  pair("Cant / Descripción", "Importe", { bold: true, size: 7 });
  doc.moveDown(0.3);

  for (const item of detail.items) {
    line(`${quantity(Number(item.quantity))} x ${money(Number(item.unitPrice))}`, { size: 7.5 });
    pair(item.description, money(lineAmount(item)), { size: 7.5 });
    doc.moveDown(0.25);
  }
  rule();

  const totalsRow = (label: string, value: string, opts: { bold?: boolean; size?: number } = {}) => {
    pair(label, value, opts);
    doc.moveDown(0.2);
  };

  totalsRow("Subtotal", money(detail.subtotal));
  if (detail.discountTotal > 0.005) {
    totalsRow("Descuentos", money(detail.discountTotal));
  }
  if (detail.exoneratedAmount > 0.005) {
    totalsRow("Exonerado", money(detail.exoneratedAmount));
  }
  if (detail.exemptAmount > 0.005) {
    totalsRow("Exento", money(detail.exemptAmount));
  }
  if (detail.taxableAmount15 > 0.005) {
    totalsRow("Gravado 15%", money(detail.taxableAmount15));
  }
  if (detail.taxableAmount18 > 0.005) {
    totalsRow("Gravado 18%", money(detail.taxableAmount18));
  }
  if (detail.isv15 > 0.005) {
    totalsRow("ISV 15%", money(detail.isv15));
  }
  if (detail.isv18 > 0.005) {
    totalsRow("ISV 18%", money(detail.isv18));
  }
  doc.moveDown(0.2);
  totalsRow("TOTAL", money(detail.grandTotal), { bold: true, size: 11 });
  doc.moveDown(0.3);

  line(detail.totalInWords ?? "", { size: 7, align: "center", color: "#475569" });
  doc.moveDown(0.4);
  return drawFooterText(doc, footer, { x: margin, y: doc.y, width: inner, size: 8 });
}
