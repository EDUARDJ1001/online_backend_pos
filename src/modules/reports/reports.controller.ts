import type { Request, Response } from "express";

import { reportsService } from "./reports.service";
import type { SalesReportQuery } from "./reports.schemas";

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

class ReportsController {
  async sales(req: Request, res: Response) {
    const result = await reportsService.salesReport(req.activeCompany!.id, req.query as unknown as SalesReportQuery);
    res.json(result);
  }

  async salesCsv(req: Request, res: Response) {
    const result = await reportsService.salesReport(req.activeCompany!.id, req.query as unknown as SalesReportQuery);

    const header = [
      "Numero",
      "Fecha",
      "Cliente",
      "RTN",
      "Tipo",
      "Metodo",
      "Estado pago",
      "Estado",
      "Subtotal",
      "Descuento",
      "ISV 15",
      "ISV 18",
      "Total",
      "Saldo"
    ];

    const lines = result.invoices.map((row) =>
      [
        row.invoiceNumber,
        row.invoiceDate,
        row.customerName,
        row.customerRtn,
        row.saleType,
        row.saleType === "CREDITO" ? "CREDITO" : row.tenderMethod ?? "EFECTIVO",
        row.paymentStatus,
        row.status,
        row.subtotal.toFixed(2),
        row.discountTotal.toFixed(2),
        row.isv15.toFixed(2),
        row.isv18.toFixed(2),
        row.grandTotal.toFixed(2),
        row.balance.toFixed(2)
      ]
        .map(csvCell)
        .join(",")
    );

    const csv = [header.join(","), ...lines].join("\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="ventas_${result.filters.dateFrom}_${result.filters.dateTo}.csv"`);
    res.send(`﻿${csv}`);
  }
}

export const reportsController = new ReportsController();
