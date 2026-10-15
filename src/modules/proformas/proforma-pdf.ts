import type { Response } from "express";
import PDFDocument from "pdfkit";

import { drawFooterBrands, drawFooterText } from "../invoices/document-footer";
import { companyLogoForPdf, documentAccentColor, footerBrandBuffers } from "../invoices/invoice-assets";

interface PdfProformaDetail {
  proformaNumber: string;
  proformaDate: string;
  validUntil: string | null;
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
  grandTotal: number;
  totalInWords: string | null;
  status: string;
  notes: string | null;
  company: {
    commercialName: string;
    legalName: string;
    rtn: string;
    email: string | null;
    phone: string | null;
    address: string | null;
    primaryColor: string | null;
    headerColor: string | null;
    sidebarColor: string | null;
    logoUrl?: string | null;
    documentColor?: string | null;
    footerBrands?: string | null;
  };
  settings: {
    footerText: string | null;
    payableTo: string | null;
    defaultTaxRate: number;
  };
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
}

const brandBlue = "#416986";
const lightBlue = "#d7e1ea";
const totalBlue = "#c3d0d8";
const ink = "#1f2933";

function accentColor(detail: PdfProformaDetail) {
  return documentAccentColor(detail.company);
}

function money(value: number, emptyWhenZero = false) {
  if (emptyWhenZero && Math.abs(value) < 0.005) {
    return "";
  }

  return `L${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number(value))}`;
}

function quantity(value: number) {
  return Number.isInteger(Number(value)) ? String(value) : Number(value).toFixed(2);
}

function printDate(value: string | null) {
  if (!value) {
    return "Sin fecha";
  }

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

function sanitizeFileName(value: string) {
  return value.replace(/[^a-z0-9-_]/gi, "_");
}

function lineAmount(item: PdfProformaDetail["items"][number]) {
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
  const { size = 9, minSize = 7, maxHeight, ...textOptions } = options;
  let fontSize = size;

  doc.font(textOptions.bold ? "Helvetica-Bold" : "Helvetica");
  while (fontSize > minSize) {
    doc.fontSize(fontSize);
    if (doc.heightOfString(text, textOptions) <= maxHeight) {
      break;
    }
    fontSize -= 0.5;
  }

  drawText(doc, text, x, y, { ...textOptions, size: fontSize, height: maxHeight });
}

function drawImagePath(doc: PDFKit.PDFDocument, assetPath: string | Buffer, x: number, y: number, options: PDFKit.Mixins.ImageOption) {
  try {
    doc.image(assetPath, x, y, options);
    return true;
  } catch (_error) {
    return false;
  }
}

function drawHeader(doc: PDFKit.PDFDocument, detail: PdfProformaDetail) {
  const logo = companyLogoForPdf(detail.company.logoUrl);
  const accent = accentColor(detail);

  // El logo es opcional: sin logo el encabezado queda sin imagen.
  if (logo) {
    drawImagePath(doc, logo, 28, 16, { fit: [72, 58], align: "center", valign: "center" });
  }

  drawText(doc, "Proforma", 350, 36, {
    width: 230,
    align: "right",
    size: 34,
    bold: true,
    color: brandBlue
  });

  doc.moveTo(14, 88).lineTo(598, 88).strokeColor(accent).lineWidth(1.1).stroke();
}

function drawCompany(doc: PDFKit.PDFDocument, detail: PdfProformaDetail) {
  const top = 102;
  const accent = accentColor(detail);
  drawText(doc, detail.company.legalName, 18, top, { size: 11, bold: true, color: brandBlue });
  drawFittedText(doc, detail.company.address ?? "Dirección no disponible", 18, top + 15, {
    size: 9.5,
    minSize: 7.5,
    maxHeight: 28,
    color: brandBlue,
    width: 300
  });
  drawText(doc, `Telefono: ${detail.company.phone ?? "Sin teléfono"}`, 18, top + 45, { size: 9.5, color: brandBlue });
  drawText(doc, detail.company.email ?? "", 18, top + 58, { size: 9.5, color: "#00a1cf" });

  const labelX = 360;
  const valueX = 442;
  drawText(doc, "Fecha:", labelX, top + 2, { size: 9.2, bold: true, color: brandBlue, align: "right", width: 70 });
  drawText(doc, printDate(detail.proformaDate), valueX, top + 2, { size: 9.2, color: ink, align: "right", width: 148 });
  drawText(doc, "R.T.N.:", labelX, top + 18, { size: 9.2, bold: true, color: brandBlue, align: "right", width: 70 });
  drawText(doc, detail.company.rtn, valueX, top + 18, { size: 9.2, bold: true, color: brandBlue, align: "right", width: 148 });
  drawText(doc, "Validez:", labelX, top + 34, { size: 9.2, bold: true, color: brandBlue, align: "right", width: 70 });
  drawText(doc, printDate(detail.validUntil), valueX - 20, top + 34, { size: 8.2, bold: true, color: brandBlue, align: "right", width: 168 });

  doc.moveTo(14, 170).lineTo(598, 170).strokeColor(accent).lineWidth(1.1).stroke();
}

function drawCustomer(doc: PDFKit.PDFDocument, detail: PdfProformaDetail) {
  const top = 182;
  const leftValueX = 78;
  const rightLabelX = 318;
  const rightValueX = 455;

  drawText(doc, "Nombre", 18, top, { bold: true, color: brandBlue, size: 10 });
  drawFittedText(doc, detail.customerNameSnapshot, leftValueX, top, { size: 10, minSize: 8, maxHeight: 13, width: 260 });
  drawText(doc, "Dirección", 18, top + 15, { bold: true, color: brandBlue, size: 10 });
  drawFittedText(doc, detail.customerAddressSnapshot ?? "Sin dirección", leftValueX, top + 15, {
    size: 9.2,
    minSize: 7,
    maxHeight: 31,
    width: 260
  });
  drawText(doc, "Telefono", 18, top + 49, { bold: true, color: brandBlue, size: 10 });
  drawText(doc, detail.customerPhoneSnapshot ?? "Sin teléfono", leftValueX, top + 49, { size: 10, width: 260 });
  drawText(doc, "RTN Cliente:", 18, top + 63, { bold: true, color: brandBlue, size: 10 });
  doc.rect(leftValueX, top + 61, 260, 14).fillColor("#d9d9d9").fill();
  drawText(doc, detail.customerRtnSnapshot ?? "Consumidor final", leftValueX + 3, top + 63, { size: 10 });

  drawText(doc, "No. Proforma", rightLabelX, top + 15, { size: 9 });
  drawText(doc, detail.proformaNumber, rightValueX, top + 15, { size: 10, bold: true, color: "#ff0000", align: "right", width: 135 });
  drawText(doc, "Fecha de Validez:", rightLabelX, top + 30, { size: 9 });
  drawText(doc, printDate(detail.validUntil), rightValueX, top + 30, { size: 8.8, align: "right", width: 135 });
  drawText(doc, "Estado:", rightLabelX, top + 45, { size: 9 });
  drawText(doc, detail.status, rightValueX - 28, top + 45, { size: 7.8, align: "right", width: 163 });
}

function drawItems(doc: PDFKit.PDFDocument, detail: PdfProformaDetail) {
  const startY = 260;
  const headerHeight = 17;
  const rowHeight = detail.items.length > 18 ? 12 : 15;
  const minRows = Math.max(12, detail.items.length);
  const cols: [number, number, number, number, number] = [14, 70, 335, 460, 598];
  const accent = accentColor(detail);

  doc.rect(cols[0], startY, cols[4] - cols[0], headerHeight).fillColor(accent).fill();
  drawText(doc, "Cant.", cols[0], startY + 4, { width: cols[1] - cols[0], align: "center", color: "#ffffff", size: 9, bold: true });
  drawText(doc, "Descripción", cols[1], startY + 4, { width: cols[2] - cols[1], align: "center", color: "#ffffff", size: 9, bold: true });
  drawText(doc, "Precio por unidad", cols[2], startY + 4, { width: cols[3] - cols[2], align: "center", color: "#ffffff", size: 9, bold: true });
  drawText(doc, "Total", cols[3], startY + 4, { width: cols[4] - cols[3], align: "center", color: "#ffffff", size: 9, bold: true });

  for (let index = 0; index < minRows; index += 1) {
    const y = startY + headerHeight + index * rowHeight;
    const isAlt = index % 2 === 1;
    doc.rect(cols[0], y, cols[4] - cols[0], rowHeight).fillColor(isAlt ? lightBlue : "#ffffff").fill();

    for (const x of cols.slice(1, 4)) {
      doc.moveTo(x, y).lineTo(x, y + rowHeight).strokeColor("#ffffff").lineWidth(1).stroke();
    }

    const item = detail.items[index];

    if (!item) {
      continue;
    }

    const fontSize = rowHeight < 15 ? 7.5 : 8.5;
    drawText(doc, quantity(Number(item.quantity)), cols[0], y + 3, { width: cols[1] - cols[0], align: "center", size: fontSize, color: "#000000" });
    drawText(doc, item.description, cols[1] + 4, y + 3, { width: cols[2] - cols[1] - 8, size: fontSize, color: "#000000", lineBreak: false });
    drawText(doc, money(Number(item.unitPrice)), cols[2] + 4, y + 3, { width: cols[3] - cols[2] - 8, align: "right", size: fontSize, color: "#000000" });
    drawText(doc, money(Number(lineAmount(item))), cols[3] + 4, y + 3, { width: cols[4] - cols[3] - 8, align: "right", size: fontSize, color: "#000000" });
  }

  return startY + headerHeight + minRows * rowHeight + 10;
}

function drawTotals(doc: PDFKit.PDFDocument, detail: PdfProformaDetail, y: number) {
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
    ["Total Impuesto", money(detail.isv15 + detail.isv18, true)],
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

function drawFooter(doc: PDFKit.PDFDocument, detail: PdfProformaDetail, y: number) {
  const accent = accentColor(detail);

  const brandBarY = 714;
  const base = Math.min(y, 668);

  drawText(doc, "Valor en Letras:", 210, base, { size: 9 });
  drawText(doc, detail.totalInWords ?? "No disponible", 286, base, { size: 9, bold: true, width: 290, lineBreak: false });

  const payableTo = detail.settings.payableTo ?? detail.company.legalName;
  drawText(doc, "Todos los cheques se extenderán a nombre de", 106, base + 18, { size: 9 });
  drawText(doc, payableTo, 333, base + 18, { size: 9, bold: true, width: 180, lineBreak: false });

  const brands = footerBrandBuffers(detail.company.footerBrands);
  // Un dibujo de varias líneas se achica para caber antes de las marcas (o del borde).
  const footerEnd = drawFooterText(doc, detail.settings.footerText ?? "Gracias por su confianza.", {
    x: 20,
    y: base + 38,
    width: 572,
    size: 9.5,
    maxHeight: (brands.length > 0 ? brandBarY - 4 : 774) - (base + 38) - (detail.notes ? 12 : 0)
  });

  if (detail.notes) {
    drawText(doc, detail.notes, 0, Math.max(base + 52, footerEnd + 3), {
      width: 612,
      align: "center",
      size: 7,
      color: "#64748b"
    });
  }

  drawFooterBrands(doc, brands, brandBarY, accent);
}

export function writeProformaPdf(detail: PdfProformaDetail, res: Response) {
  const doc = new PDFDocument({ size: "LETTER", margin: 0 });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="proforma-${sanitizeFileName(detail.proformaNumber)}.pdf"`);

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
