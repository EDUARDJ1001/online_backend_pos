import type { Response } from "express";
import PDFDocument from "pdfkit";

import { drawFooterBrands, drawFooterText } from "../invoices/document-footer";
import { companyLogoForPdf, documentAccentColor, footerBrandBuffers } from "../invoices/invoice-assets";
import type { QuoteDetail } from "./quotes.service";

const brandBlue = "#416986";
const lightBlue = "#d7e1ea";
const totalBlue = "#c3d0d8";
const ink = "#1f2933";
const pageWidth = 612;

function accentColor(detail: QuoteDetail) {
  return documentAccentColor(detail.company);
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

function drawImagePath(doc: PDFKit.PDFDocument, assetPath: string | Buffer, x: number, y: number, options: PDFKit.Mixins.ImageOption) {
  try {
    doc.image(assetPath, x, y, options);
    return true;
  } catch (_error) {
    return false;
  }
}

function drawFrame(doc: PDFKit.PDFDocument) {
  doc.rect(14, 12, 584, 768).strokeColor("#001eff").lineWidth(1.1).stroke();
}

function drawHeader(doc: PDFKit.PDFDocument, detail: QuoteDetail) {
  const logo = companyLogoForPdf(detail.company.logoUrl);
  const accent = accentColor(detail);

  // El logo es opcional: sin logo el encabezado queda sin imagen.
  if (logo) {
    drawImagePath(doc, logo, 28, 16, { fit: [72, 58], align: "center", valign: "center" });
  }

  drawText(doc, "Cotización", 350, 32, {
    width: 230,
    align: "right",
    size: 32,
    bold: true,
    color: brandBlue
  });
  drawText(doc, "Documento no fiscal", 350, 67, {
    width: 230,
    align: "right",
    size: 10,
    bold: true,
    color: "#64748b"
  });

  doc.moveTo(14, 88).lineTo(598, 88).strokeColor(accent).lineWidth(1.1).stroke();
}

function drawCompany(doc: PDFKit.PDFDocument, detail: QuoteDetail) {
  const top = 102;
  const accent = accentColor(detail);
  drawText(doc, detail.company.legalName, 18, top, { size: 11, bold: true, color: brandBlue });
  drawText(doc, detail.company.address ?? "Dirección no disponible", 18, top + 15, { size: 9.5, color: brandBlue, width: 300 });
  drawText(doc, `Telefono: ${detail.company.phone ?? "Sin teléfono"}`, 18, top + 30, { size: 9.5, color: brandBlue });
  drawText(doc, detail.company.email ?? "", 18, top + 45, { size: 9.5, color: "#00a1cf" });

  const labelX = 360;
  const valueX = 442;
  drawText(doc, "Fecha:", labelX, top + 2, { size: 9.2, bold: true, color: brandBlue, align: "right", width: 70 });
  drawText(doc, printDate(detail.quoteDate), valueX, top + 2, { size: 9.2, color: ink, align: "right", width: 148 });
  drawText(doc, "R.T.N.:", labelX, top + 18, { size: 9.2, bold: true, color: brandBlue, align: "right", width: 70 });
  drawText(doc, detail.company.rtn, valueX, top + 18, { size: 9.2, bold: true, color: brandBlue, align: "right", width: 148 });
  drawText(doc, "No.:", labelX, top + 34, { size: 9.2, bold: true, color: brandBlue, align: "right", width: 70 });
  drawText(doc, detail.quoteNumber, valueX - 24, top + 34, { size: 8.2, bold: true, color: brandBlue, align: "right", width: 172 });

  if (detail.validUntil) {
    drawText(doc, "Válida hasta:", labelX, top + 50, { size: 9, bold: true, color: brandBlue, align: "right", width: 70 });
    drawText(doc, printDate(detail.validUntil), valueX, top + 50, { size: 8.8, color: ink, align: "right", width: 148 });
  }

  doc.moveTo(14, 170).lineTo(598, 170).strokeColor(accent).lineWidth(1.1).stroke();
}

function drawCustomer(doc: PDFKit.PDFDocument, detail: QuoteDetail) {
  const top = 182;
  const leftValueX = 82;
  const emptyValue = "N/A";

  drawText(doc, "Cliente", 18, top, { bold: true, color: brandBlue, size: 10 });
  drawText(doc, detail.customerNameSnapshot, leftValueX, top, { size: 10, width: 265, lineBreak: false });
  drawText(doc, "Dirección", 18, top + 17, { bold: true, color: brandBlue, size: 10 });
  drawText(doc, detail.customerAddressSnapshot ?? emptyValue, leftValueX, top + 17, { size: 9.5, width: 265, lineBreak: false });
  drawText(doc, "Teléfono", 18, top + 34, { bold: true, color: brandBlue, size: 10 });
  drawText(doc, detail.customerPhoneSnapshot ?? emptyValue, leftValueX, top + 34, { size: 9.5, width: 265, lineBreak: false });
  drawText(doc, "Correo", 18, top + 51, { bold: true, color: brandBlue, size: 10 });
  drawText(doc, detail.customerEmailSnapshot ?? emptyValue, leftValueX, top + 51, { size: 9.5, width: 265, lineBreak: false });
  drawText(doc, "RTN", 360, top, { bold: true, color: brandBlue, size: 10 });
  doc.rect(405, top - 2, 170, 15).fillColor("#d9d9d9").fill();
  drawText(doc, detail.customerRtnSnapshot ?? emptyValue, 409, top, { size: 9.5, width: 162, lineBreak: false });

  if (detail.notes) {
    drawText(doc, "Notas", 360, top + 24, { bold: true, color: brandBlue, size: 10 });
    drawText(doc, detail.notes, 405, top + 24, { size: 8.5, width: 170, height: 38 });
  }
}

function drawTableHeader(doc: PDFKit.PDFDocument, detail: QuoteDetail, y: number) {
  const cols = { x: 14, qty: 70, desc: 335, price: 460, total: 598 };
  const headerHeight = 17;

  doc.rect(cols.x, y, cols.total - cols.x, headerHeight).fillColor(accentColor(detail)).fill();
  drawText(doc, "Cant.", cols.x, y + 4, { width: cols.qty - cols.x, align: "center", color: "#ffffff", size: 9, bold: true });
  drawText(doc, "Descripción", cols.qty, y + 4, { width: cols.desc - cols.qty, align: "center", color: "#ffffff", size: 9, bold: true });
  drawText(doc, "Precio por unidad", cols.desc, y + 4, { width: cols.price - cols.desc, align: "center", color: "#ffffff", size: 9, bold: true });
  drawText(doc, "Total", cols.price, y + 4, { width: cols.total - cols.price, align: "center", color: "#ffffff", size: 9, bold: true });

  return y + headerHeight;
}

function drawItemRow(doc: PDFKit.PDFDocument, item: QuoteDetail["items"][number], y: number, index: number) {
  const cols = { x: 14, qty: 70, desc: 335, price: 460, total: 598 };
  const rowHeight = 16;

  doc.rect(cols.x, y, cols.total - cols.x, rowHeight).fillColor(index % 2 === 1 ? lightBlue : "#ffffff").fill();

  for (const x of [cols.qty, cols.desc, cols.price]) {
    doc.moveTo(x, y).lineTo(x, y + rowHeight).strokeColor("#ffffff").lineWidth(1).stroke();
  }

  drawText(doc, quantity(Number(item.quantity)), cols.x, y + 4, { width: cols.qty - cols.x, align: "center", size: 8.2, color: "#000000" });
  drawText(doc, item.description, cols.qty + 4, y + 4, { width: cols.desc - cols.qty - 8, size: 8.2, color: "#000000", lineBreak: false });
  drawText(doc, money(Number(item.unitPrice)), cols.desc + 4, y + 4, { width: cols.price - cols.desc - 8, align: "right", size: 8.2, color: "#000000" });
  drawText(doc, money(Number(item.lineSubtotal)), cols.price + 4, y + 4, { width: cols.total - cols.price - 8, align: "right", size: 8.2, color: "#000000" });

  return y + rowHeight;
}

function drawContinuationHeader(doc: PDFKit.PDFDocument, detail: QuoteDetail) {
  const accent = accentColor(detail);

  drawFrame(doc);
  drawText(doc, "Cotización", 18, 32, { size: 18, bold: true, color: brandBlue });
  drawText(doc, detail.quoteNumber, 352, 36, { width: 225, align: "right", size: 9.5, bold: true, color: brandBlue });
  doc.moveTo(14, 70).lineTo(598, 70).strokeColor(accent).lineWidth(1.1).stroke();
}

function drawItems(doc: PDFKit.PDFDocument, detail: QuoteDetail) {
  let y = drawTableHeader(doc, detail, 248);

  detail.items.forEach((item, index) => {
    if (y > 640) {
      doc.addPage();
      drawContinuationHeader(doc, detail);
      y = drawTableHeader(doc, detail, 96);
    }

    y = drawItemRow(doc, item, y, index);
  });

  return y + 12;
}

function drawTotals(doc: PDFKit.PDFDocument, detail: QuoteDetail, y: number) {
  let summaryY = Math.max(y, 500);

  if (summaryY > 610) {
    doc.addPage();
    drawContinuationHeader(doc, detail);
    summaryY = 96;
  }

  const labelX = 338;
  const amountX = 460;
  const amountWidth = 132;
  const lineHeight = 16;

  const rows: Array<[string, string, boolean?]> = [
    ["Subtotal", money(detail.subtotal)],
    ["Descuentos y Rebajas", money(detail.discountTotal, true)],
    ["Importe Gravado 15%", money(detail.taxableAmount15, true)],
    ["Importe Gravado 18%", money(detail.taxableAmount18, true)],
    ["Importe Exento", money(detail.exemptAmount, true)],
    ["ISV 15%", money(detail.isv15, true)],
    ["ISV 18%", money(detail.isv18, true)],
    ["Total a Pagar", money(detail.grandTotal), true]
  ];

  rows.forEach(([label, value, grand], index) => {
    const rowY = summaryY + index * lineHeight;
    drawText(doc, label, labelX, rowY + 4, { width: amountX - labelX - 4, align: "right", size: 8.4, bold: true, color: brandBlue, lineBreak: false });
    doc.rect(amountX, rowY, amountWidth, lineHeight - 1).fillColor(grand ? lightBlue : totalBlue).fill();
    drawText(doc, value, amountX + 4, rowY + 4, { width: amountWidth - 8, align: "right", size: 8.4, bold: Boolean(grand), color: ink });
  });

  return summaryY + rows.length * lineHeight + 22;
}

function drawFooter(doc: PDFKit.PDFDocument, detail: QuoteDetail, y: number) {
  const accent = accentColor(detail);

  if (y > 655) {
    doc.addPage();
    drawContinuationHeader(doc, detail);
    y = 110;
  }

  const brandBarY = 714;
  const base = Math.min(y, 668);

  drawText(doc, "Valor en Letras:", 164, base, { size: 9 });
  drawText(doc, detail.totalInWords ?? "No disponible", 240, base, { size: 9, bold: true, width: 330, lineBreak: false });

  const payableTo = detail.settings.payableTo ?? detail.company.legalName;
  drawText(doc, "Cotización emitida por", 142, base + 18, { size: 9 });
  drawText(doc, payableTo, 265, base + 18, { size: 9, bold: true, width: 220, lineBreak: false });
  const brands = footerBrandBuffers(detail.company.footerBrands);
  // Un dibujo de varias líneas se achica para caber antes de las marcas (o del borde).
  drawFooterText(doc, detail.settings.footerText ?? "Gracias por su confianza.", {
    x: 20,
    y: base + 38,
    width: pageWidth - 40,
    size: 9.5,
    maxHeight: (brands.length > 0 ? brandBarY - 4 : 774) - (base + 38)
  });

  drawFooterBrands(doc, brands, brandBarY, accent);
}

export function writeQuotePdf(detail: QuoteDetail, res: Response) {
  const doc = new PDFDocument({ size: "LETTER", margin: 0 });
  const fileName = detail.quoteNumber.replace(/[^a-z0-9-]/gi, "_").toLowerCase();

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}.pdf"`);

  doc.pipe(res);

  drawFrame(doc);
  drawHeader(doc, detail);
  drawCompany(doc, detail);
  drawCustomer(doc, detail);
  const afterItems = drawItems(doc, detail);
  const afterTotals = drawTotals(doc, detail, afterItems);
  drawFooter(doc, detail, afterTotals);

  doc.end();
}
