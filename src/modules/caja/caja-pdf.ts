import type { Response } from "express";
import PDFDocument from "pdfkit";

import type { CompanySummary } from "../companies/companies.service";
import { CASH_METHODS, type cajaService, type CashMethod, type CashMovementType } from "./caja.service";

type SessionDetail = Awaited<ReturnType<typeof cajaService.getSessionDetail>>;

const ink = "#1f2933";
const muted = "#52606d";
const brand = "#416986";
const light = "#d7e1ea";
const TIME_ZONE = "America/Tegucigalpa";

// Carta: 612 x 792 pt
const LEFT = 40;
const RIGHT = 572;
const WIDTH = RIGHT - LEFT;
const PAGE_BOTTOM = 740;

const FLOW_LABEL: Record<"FONDO" | CashMovementType, string> = {
  FONDO: "Fondo de apertura",
  APERTURA: "Apertura",
  VENTA_CONTADO: "Ventas de contado",
  ABONO_CXC: "Abonos de clientes (CxC)",
  PAGO_CXP: "Pagos a proveedores (CxP)",
  INGRESO: "Otros ingresos",
  EGRESO: "Egresos",
  RETIRO: "Retiros",
  AJUSTE: "Ajustes"
};

const METHOD_LABEL: Record<CashMethod, string> = {
  EFECTIVO: "Efectivo",
  TRANSFERENCIA: "Transferencia",
  TARJETA: "Tarjeta",
  CHEQUE: "Cheque",
  OTRO: "Otro"
};

const outColor = "#b42318";

/** Monto sin signo: las salidas se distinguen por color, no con "-". */
function money(value: number) {
  const formatted = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(value));
  return `L${formatted}`;
}

function amountColor(value: number) {
  return value < -0.005 ? outColor : ink;
}

function dateTime(value: string | Date | null) {
  if (!value) {
    return "N/D";
  }

  const parsed = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat("es-HN", {
    timeZone: TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true
  }).format(parsed);
}

function text(
  doc: PDFKit.PDFDocument,
  value: string,
  x: number,
  y: number,
  options: PDFKit.Mixins.TextOptions & { size?: number; color?: string; bold?: boolean } = {}
) {
  doc
    .font(options.bold ? "Helvetica-Bold" : "Helvetica")
    .fontSize(options.size ?? 9)
    .fillColor(options.color ?? ink)
    .text(value, x, y, options);
}

function sectionTitle(doc: PDFKit.PDFDocument, title: string, y: number) {
  text(doc, title.toUpperCase(), LEFT, y, { size: 9.5, bold: true, color: brand });
  doc.moveTo(LEFT, y + 14).lineTo(RIGHT, y + 14).strokeColor(light).lineWidth(0.8).stroke();
  return y + 22;
}

function ensureSpace(doc: PDFKit.PDFDocument, y: number, needed: number) {
  if (y + needed > PAGE_BOTTOM) {
    doc.addPage();
    return 40;
  }
  return y;
}

/** Reporte de cierre de caja en tamaño carta (único formato soportado). */
export function writeCashClosePdf(company: CompanySummary, detail: SessionDetail, res: Response) {
  const { session, summary } = detail;
  const doc = new PDFDocument({ size: "LETTER", margin: 40 });
  // Nombre: cierre-{caja}-{fecha de cierre}.pdf (solo ASCII para el header).
  const registerSlug =
    (session.registerName ?? "caja")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "caja";
  // en-CA formatea como YYYY-MM-DD, en hora de Honduras.
  const closeDate = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(new Date(session.closedAt ?? Date.now()));

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="cierre-${registerSlug}-${closeDate}.pdf"`);
  doc.pipe(res);

  // ---- Encabezado ----
  text(doc, company.legalName, LEFT, 40, { size: 13, bold: true, color: brand, width: 330 });
  text(doc, `RTN: ${company.rtn}`, LEFT, 58, { size: 9, color: brand });
  if (company.address) {
    text(doc, company.address, LEFT, 70, { size: 9, color: brand, width: 320 });
  }
  text(doc, "CIERRE DE CAJA", LEFT, 40, { size: 16, bold: true, width: WIDTH, align: "right" });
  text(doc, `Sesión #${session.id}`, LEFT, 60, { size: 9, color: muted, width: WIDTH, align: "right" });
  text(doc, `Emitido: ${dateTime(new Date())}`, LEFT, 72, { size: 9, color: muted, width: WIDTH, align: "right" });
  doc.moveTo(LEFT, 96).lineTo(RIGHT, 96).strokeColor(brand).lineWidth(1).stroke();

  // ---- Datos de la sesión ----
  let y = 108;
  const info: Array<[string, string, string, string]> = [
    ["Caja", session.registerName ?? "N/D", "Estado", session.status],
    ["Aperturada por", session.openedByName ?? "N/D", "Cerrada por", session.closedByName ?? "N/D"],
    ["Fecha y hora de apertura", dateTime(session.openedAt), "Fecha y hora de cierre", dateTime(session.closedAt)],
    ["Monto de apertura", money(session.openingAmount), "", ""]
  ];

  for (const [l1, v1, l2, v2] of info) {
    text(doc, l1, LEFT, y, { size: 8.5, color: muted });
    text(doc, v1, LEFT + 120, y, { size: 9, bold: true, width: 150 });
    if (l2) {
      text(doc, l2, 320, y, { size: 8.5, color: muted });
      text(doc, v2, 440, y, { size: 9, bold: true, width: 132 });
    }
    y += 15;
  }

  // ---- Cuadro de flujo ----
  y = sectionTitle(doc, "Cuadro de flujo de dinero", y + 10);

  const conceptWidth = 142;
  const colWidth = (WIDTH - conceptWidth) / (CASH_METHODS.length + 1);
  const colX = (index: number) => LEFT + conceptWidth + index * colWidth;

  doc.rect(LEFT, y, WIDTH, 18).fillColor(brand).fill();
  text(doc, "Concepto", LEFT + 4, y + 5, { size: 8.3, bold: true, color: "#ffffff" });
  CASH_METHODS.forEach((method, index) => {
    text(doc, METHOD_LABEL[method], colX(index), y + 5, { size: 8.3, bold: true, color: "#ffffff", width: colWidth - 4, align: "right" });
  });
  text(doc, "Total", colX(CASH_METHODS.length), y + 5, { size: 8.3, bold: true, color: "#ffffff", width: colWidth - 4, align: "right" });
  y += 18;

  summary.flow.rows.forEach((row, index) => {
    if (index % 2 === 1) {
      doc.rect(LEFT, y, WIDTH, 16).fillColor("#f3f6f9").fill();
    }
    text(doc, FLOW_LABEL[row.key], LEFT + 4, y + 4, { size: 8.3, width: conceptWidth - 6, lineBreak: false });
    CASH_METHODS.forEach((method, methodIndex) => {
      text(doc, money(row.byMethod[method]), colX(methodIndex), y + 4, { size: 8.3, color: amountColor(row.byMethod[method]), width: colWidth - 4, align: "right" });
    });
    text(doc, money(row.total), colX(CASH_METHODS.length), y + 4, { size: 8.3, bold: true, color: amountColor(row.total), width: colWidth - 4, align: "right" });
    y += 16;
  });

  doc.rect(LEFT, y, WIDTH, 18).fillColor(light).fill();
  text(doc, "Saldo esperado", LEFT + 4, y + 5, { size: 8.6, bold: true });
  CASH_METHODS.forEach((method, index) => {
    text(doc, money(summary.flow.totals.byMethod[method]), colX(index), y + 5, { size: 8.6, bold: true, color: amountColor(summary.flow.totals.byMethod[method]), width: colWidth - 4, align: "right" });
  });
  text(doc, money(summary.flow.totals.total), colX(CASH_METHODS.length), y + 5, { size: 8.6, bold: true, color: amountColor(summary.flow.totals.total), width: colWidth - 4, align: "right" });
  y += 26;

  // ---- Arqueo de efectivo ----
  y = ensureSpace(doc, y, 110);
  y = sectionTitle(doc, "Arqueo de efectivo", y);

  const expected = session.expectedAmount ?? summary.expectedCash;
  const counted = session.countedAmount;
  const difference = session.difference;
  const verdict =
    difference === null ? "" : Math.abs(difference) < 0.005 ? "Caja cuadrada" : difference > 0 ? "Sobrante" : "Faltante";

  const arqueo: Array<[string, string, boolean?]> = [
    ["Fondo de apertura", money(session.openingAmount)],
    ["Entradas en efectivo", money(summary.cashIn)],
    ["Salidas en efectivo", money(summary.cashOut)],
    ["Efectivo esperado", money(expected), true],
    ["Efectivo contado", money(counted ?? 0), true],
    [`Diferencia${verdict ? ` (${verdict})` : ""}`, money(difference ?? 0), true]
  ];

  for (const [label, value, strong] of arqueo) {
    if (strong) {
      doc.rect(300, y - 2, RIGHT - 300, 16).fillColor("#f3f6f9").fill();
    }
    text(doc, label, 304, y + 2, { size: 9, bold: Boolean(strong), color: strong ? ink : muted, width: 160 });
    text(doc, value, 468, y + 2, { size: 9, bold: Boolean(strong), width: RIGHT - 472, align: "right" });
    y += 17;
  }

  // Desglose de denominaciones contadas (si se registró).
  const breakdown = session.closingBreakdown;
  if (breakdown && Object.keys(breakdown).length > 0) {
    let by = y - 17 * arqueo.length;
    text(doc, "Denominación", LEFT, by, { size: 8.3, bold: true, color: muted });
    text(doc, "Cant.", LEFT + 90, by, { size: 8.3, bold: true, color: muted, width: 40, align: "right" });
    text(doc, "Subtotal", LEFT + 140, by, { size: 8.3, bold: true, color: muted, width: 90, align: "right" });
    by += 13;
    for (const [denomination, count] of Object.entries(breakdown).sort((a, b) => Number(b[0]) - Number(a[0]))) {
      if (!Number(count)) {
        continue;
      }
      text(doc, `L ${denomination}`, LEFT, by, { size: 8.3 });
      text(doc, String(count), LEFT + 90, by, { size: 8.3, width: 40, align: "right" });
      text(doc, money(Number(denomination) * Number(count)), LEFT + 140, by, { size: 8.3, width: 90, align: "right" });
      by += 12;
    }
    y = Math.max(y, by);
  }

  // ---- Notas ----
  const notes = [
    session.openingNotes ? `Apertura: ${session.openingNotes}` : null,
    session.closingNotes ? `Cierre: ${session.closingNotes}` : null
  ].filter(Boolean) as string[];

  if (notes.length > 0) {
    y = ensureSpace(doc, y + 12, 50);
    y = sectionTitle(doc, "Observaciones", y);
    for (const note of notes) {
      text(doc, note, LEFT, y, { size: 8.8, width: WIDTH });
      y = doc.y + 4;
    }
  }

  // ---- Firmas ----
  y = ensureSpace(doc, y + 40, 50);
  const signY = y + 20;
  doc.moveTo(LEFT + 20, signY).lineTo(LEFT + 220, signY).strokeColor(ink).lineWidth(0.6).stroke();
  doc.moveTo(RIGHT - 220, signY).lineTo(RIGHT - 20, signY).strokeColor(ink).lineWidth(0.6).stroke();
  text(doc, `Entregado por: ${session.closedByName ?? session.openedByName ?? ""}`, LEFT + 20, signY + 5, { size: 8.5, width: 200, align: "center" });
  text(doc, "Recibido / revisado por", RIGHT - 220, signY + 5, { size: 8.5, width: 200, align: "center" });

  doc.end();
}
