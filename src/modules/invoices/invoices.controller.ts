import type { Request, Response } from "express";

import { cashContextFromRequest } from "../caja/caja.context";

import { auditService } from "../audit/audit.service";
import { companiesService } from "../companies/companies.service";
import { settingsService } from "../settings/settings.service";
import { renderInvoiceHtml } from "./invoice-renderer";
import { writeInvoicePdf, writeInvoiceTicketPdf } from "./invoice-pdf";
import { invoicesService } from "./invoices.service";

export class InvoicesController {
  async list(req: Request, res: Response) {
    const result = await invoicesService.list(req.activeCompany!.id, req.query as never);

    res.json(result);
  }

  async create(req: Request, res: Response) {
    const invoice = await invoicesService.create(req.activeCompany!.id, req.auth!.sub, req.auth!.role, req.body, await cashContextFromRequest(req));

    await auditService.log(
      {
        companyId: req.activeCompany!.id,
        userId: req.auth!.sub,
        entityType: "FACTURA",
        entityId: invoice.id,
        action: "EMITIR",
        description: `Factura ${invoice.invoiceNumber} emitida.`,
        newValues: {
          invoiceNumber: invoice.invoiceNumber,
          total: invoice.grandTotal,
          customer: invoice.printCustomerName
        }
      },
      req
    );

    res.status(201).json({
      message: "Factura emitida correctamente.",
      item: invoice
    });
  }

  async activeSeries(req: Request, res: Response) {
    const series = await invoicesService.getActiveFacturaSeries(req.activeCompany!.id);
    // Avisos de la serie (CAI por vencer, rango por agotarse) para quien factura,
    // aunque no tenga acceso a la configuración de Facturación SAR.
    const detail = series ? await settingsService.findSeriesOrFail(req.activeCompany!.id, series.id) : null;

    res.json({
      item: series ? { ...series, daysToDeadline: detail!.daysToDeadline, warnings: detail!.warnings } : null
    });
  }

  async getById(req: Request, res: Response) {
    const invoice = await invoicesService.getInvoiceDetail(req.activeCompany!.id, Number(req.params.id));

    res.json({
      item: invoice
    });
  }

  async print(req: Request, res: Response) {
    const invoice = await invoicesService.getInvoiceDetail(req.activeCompany!.id, Number(req.params.id));

    const { footerBrands } = await companiesService.documentBranding(req.activeCompany!.id);

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(renderInvoiceHtml({ ...invoice, companyFooterBrands: footerBrands }));
  }

  async pdf(req: Request, res: Response) {
    const invoice = await invoicesService.getInvoiceDetail(req.activeCompany!.id, Number(req.params.id));

    if (req.query.format === "ticket") {
      writeInvoiceTicketPdf(invoice, res);
      return;
    }

    const { footerBrands } = await companiesService.documentBranding(req.activeCompany!.id);
    writeInvoicePdf({ ...invoice, companyFooterBrands: footerBrands }, res);
  }

  async createCorrection(req: Request, res: Response) {
    const result = await invoicesService.applyCorrection(req.activeCompany!.id, req.auth!.sub, Number(req.params.id), req.body);

    await auditService.log(
      {
        companyId: req.activeCompany!.id,
        userId: req.auth!.sub,
        entityType: "FACTURA_CORRECCION",
        entityId: result.correction?.id ?? null,
        action: "APLICAR",
        description: `Corrección aplicada a la factura ${result.invoice.invoiceNumber}.`,
        oldValues: result.previous,
        newValues: result.correction
      },
      req
    );

    res.status(201).json({
      message: "Corrección aplicada correctamente.",
      item: result.invoice,
      correction: result.correction
    });
  }

  async corrections(req: Request, res: Response) {
    const items = await invoicesService.listCorrections(req.activeCompany!.id, Number(req.params.id));

    res.json({
      items
    });
  }
}

export const invoicesController = new InvoicesController();
