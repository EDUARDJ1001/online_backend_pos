import type { Response } from "express";
import PDFDocument from "pdfkit";

const ink = "#1f2933";
const brand = "#416986";
const light = "#d7e1ea";

export interface StatementCompany {
  commercialName: string;
  legalName: string;
  rtn: string;
  phone: string | null;
  address: string | null;
}

export interface StatementParty {
  label: string;
  name: string;
  rtn: string | null;
  phone: string | null;
  address: string | null;
}

export interface StatementLedgerRow {
  date: string | null;
  number: string;
  concept: string;
  charge: number;
  payment: number;
  balance: number;
}

export interface AccountStatement {
  title: string;
  filename: string;
  company: StatementCompany;
  party: StatementParty;
  rows: StatementLedgerRow[];
  totals: { charged: number; paid: number; balance: number };
}

function money(value: number, emptyWhenZero = false) {
  if (emptyWhenZero && Math.abs(value) < 0.005) {
    return "";
  }

  return `L${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`;
}

function printDate(value: string | null) {
  if (!value) {
    return "";
  }

  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);

  if (!match) {
    return value;
  }

  const [, year, month, day] = match;
  return `${day}/${month}/${year}`;
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

export function writeAccountStatementPdf(statement: AccountStatement, res: Response) {
  const doc = new PDFDocument({ size: "LETTER", margin: 40 });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${statement.filename}"`);
  doc.pipe(res);

  const left = 40;
  const right = 572;

  // Encabezado
  text(doc, statement.company.legalName, left, 40, { size: 13, bold: true, color: brand });
  text(doc, `RTN: ${statement.company.rtn}`, left, 58, { size: 9, color: brand });
  if (statement.company.address) {
    text(doc, statement.company.address, left, 70, { size: 9, color: brand, width: 320 });
  }
  text(doc, statement.title, left, 40, { size: 16, bold: true, color: ink, width: right - left, align: "right" });
  text(doc, `Emitido: ${printDate(new Date().toISOString().slice(0, 10))}`, left, 62, {
    size: 9,
    color: ink,
    width: right - left,
    align: "right"
  });

  doc.moveTo(left, 96).lineTo(right, 96).strokeColor(brand).lineWidth(1).stroke();

  // Contraparte
  const partyTop = 108;
  text(doc, statement.party.label, left, partyTop, { size: 9, bold: true, color: brand });
  text(doc, statement.party.name, left, partyTop + 13, { size: 11, bold: true });
  text(doc, `RTN: ${statement.party.rtn ?? "N/D"}`, left, partyTop + 29, { size: 9 });
  text(doc, `Tel: ${statement.party.phone ?? "N/D"}`, left, partyTop + 41, { size: 9 });
  if (statement.party.address) {
    text(doc, statement.party.address, 320, partyTop + 13, { size: 9, width: 252 });
  }

  // Tabla
  const cols = { date: left, number: 120, concept: 210, charge: 360, payment: 440, balance: 520 };
  let y = partyTop + 66;

  doc.rect(left, y, right - left, 18).fillColor(brand).fill();
  text(doc, "Fecha", cols.date + 4, y + 5, { size: 8.5, bold: true, color: "#ffffff" });
  text(doc, "Documento", cols.number + 4, y + 5, { size: 8.5, bold: true, color: "#ffffff" });
  text(doc, "Concepto", cols.concept + 4, y + 5, { size: 8.5, bold: true, color: "#ffffff" });
  text(doc, "Cargo", cols.charge, y + 5, { size: 8.5, bold: true, color: "#ffffff", width: 76, align: "right" });
  text(doc, "Abono", cols.payment, y + 5, { size: 8.5, bold: true, color: "#ffffff", width: 76, align: "right" });
  text(doc, "Saldo", cols.balance, y + 5, { size: 8.5, bold: true, color: "#ffffff", width: 48, align: "right" });
  y += 18;

  const rowHeight = 16;

  statement.rows.forEach((row, index) => {
    if (y > 720) {
      doc.addPage();
      y = 40;
    }

    if (index % 2 === 1) {
      doc.rect(left, y, right - left, rowHeight).fillColor(light).fill();
    }

    text(doc, printDate(row.date), cols.date + 4, y + 4, { size: 8.2 });
    text(doc, row.number, cols.number + 4, y + 4, { size: 8.2, width: cols.concept - cols.number - 6, lineBreak: false });
    text(doc, row.concept, cols.concept + 4, y + 4, { size: 8.2, width: cols.charge - cols.concept - 8, lineBreak: false });
    text(doc, money(row.charge, true), cols.charge, y + 4, { size: 8.2, width: 76, align: "right" });
    text(doc, money(row.payment, true), cols.payment, y + 4, { size: 8.2, width: 76, align: "right" });
    text(doc, money(row.balance), cols.balance, y + 4, { size: 8.2, width: 48, align: "right" });
    y += rowHeight;
  });

  // Totales
  y += 12;
  doc.moveTo(320, y).lineTo(right, y).strokeColor(brand).lineWidth(0.8).stroke();
  y += 8;
  const totalsRows: Array<[string, string, boolean?]> = [
    ["Total facturado", money(statement.totals.charged)],
    ["Total abonado", money(statement.totals.paid)],
    ["Saldo pendiente", money(statement.totals.balance), true]
  ];

  totalsRows.forEach(([label, value, strong]) => {
    text(doc, label, 320, y + 3, { size: 9.5, bold: true, color: brand, width: 150, align: "right" });
    if (strong) {
      doc.rect(478, y, 94, 16).fillColor(light).fill();
    }
    text(doc, value, 478, y + 3, { size: 9.5, bold: Boolean(strong), width: 90, align: "right" });
    y += 18;
  });

  doc.end();
}
