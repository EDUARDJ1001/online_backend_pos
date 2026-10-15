import type { Response } from "express";
import PDFDocument from "pdfkit";

/** Página de prueba para verificar una impresora desde "Este equipo" (ticket 80 mm o carta). */
export function writePrintTestPdf(format: "ticket" | "carta", companyName: string, res: Response) {
  const isTicket = format === "ticket";
  // Ticket: 80 mm de ancho (226.77 pt), igual que el ticket de factura.
  const width = isTicket ? 226.77 : 612;
  const margin = isTicket ? 12 : 48;
  const doc = new PDFDocument({ size: isTicket ? [width, 260] : "LETTER", margin });
  const now = new Date().toLocaleString("es-HN", { timeZone: "America/Tegucigalpa" });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="prueba-${format}.pdf"`);
  doc.pipe(res);

  const contentWidth = width - margin * 2;
  doc.font("Helvetica-Bold").fontSize(isTicket ? 12 : 20).text("PRUEBA DE IMPRESIÓN", { width: contentWidth, align: "center" });
  doc.moveDown(0.6);
  doc.font("Helvetica").fontSize(isTicket ? 9 : 12);
  doc.text(companyName, { width: contentWidth, align: "center" });
  doc.text(isTicket ? "Impresora de tickets (80 mm)" : "Impresora de documentos carta", { width: contentWidth, align: "center" });
  doc.text(now, { width: contentWidth, align: "center" });
  doc.moveDown(0.8);
  doc.fontSize(isTicket ? 8 : 11).text("Si puedes leer esta página completa y centrada, la impresora quedó bien configurada para este equipo.", {
    width: contentWidth,
    align: "center"
  });
  doc.moveDown(0.8);
  doc.moveTo(margin, doc.y).lineTo(width - margin, doc.y).lineWidth(0.8).stroke();
  doc.moveDown(0.4);
  doc.fontSize(isTicket ? 8 : 10).text("0123456789 ÁÉÍÓÚ ÑÜ L 1,234.56", { width: contentWidth, align: "center" });

  doc.end();
}
