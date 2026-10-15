import type { Request, Response } from "express";

import { cashContextFromRequest } from "../caja/caja.context";

import { auditService } from "../audit/audit.service";
import { withDocumentBranding } from "../companies/document-branding";
import { writeQuotePdf } from "./quotes-pdf";
import { quotesService } from "./quotes.service";

export class QuotesController {
  async list(req: Request, res: Response) {
    const result = await quotesService.list(req.activeCompany!.id, req.query as never);

    res.json(result);
  }

  async create(req: Request, res: Response) {
    const quote = await quotesService.create(req.activeCompany!.id, req.auth!.sub, req.body);

    await auditService.log(
      {
        companyId: req.activeCompany!.id,
        userId: req.auth!.sub,
        entityType: "COTIZACION",
        entityId: quote.id,
        action: "CREAR",
        description: `Cotización ${quote.quoteNumber} creada.`,
        newValues: {
          quoteNumber: quote.quoteNumber,
          total: quote.grandTotal,
          customer: quote.customerNameSnapshot
        }
      },
      req
    );

    res.status(201).json({
      message: "Cotización creada correctamente.",
      item: quote
    });
  }

  async getById(req: Request, res: Response) {
    const quote = await quotesService.getDetail(req.activeCompany!.id, Number(req.params.id));

    res.json({
      item: quote
    });
  }

  async pdf(req: Request, res: Response) {
    const quote = await quotesService.getDetail(req.activeCompany!.id, Number(req.params.id));

    writeQuotePdf(await withDocumentBranding(req.activeCompany!.id, quote), res);
  }

  async updateStatus(req: Request, res: Response) {
    const quote = await quotesService.updateStatus(req.activeCompany!.id, req.auth!.sub, Number(req.params.id), req.body.status);

    await auditService.log(
      {
        companyId: req.activeCompany!.id,
        userId: req.auth!.sub,
        entityType: "COTIZACION",
        entityId: quote.id,
        action: "CAMBIAR_ESTADO",
        description: `Cotización ${quote.quoteNumber} cambió a ${quote.status}.`,
        newValues: {
          status: quote.status
        }
      },
      req
    );

    res.json({
      message: "Estado de cotización actualizado correctamente.",
      item: quote
    });
  }

  async convertToInvoice(req: Request, res: Response) {
    const result = await quotesService.convertToInvoice(
      req.activeCompany!.id,
      req.auth!.sub,
      req.auth!.role,
      Number(req.params.id),
      await cashContextFromRequest(req)
    );

    await auditService.log(
      {
        companyId: req.activeCompany!.id,
        userId: req.auth!.sub,
        entityType: "COTIZACION",
        entityId: result.quote.id,
        action: "FACTURAR",
        description: `Cotización ${result.quote.quoteNumber} convertida a factura ${result.invoice.invoiceNumber}.`,
        newValues: {
          quoteNumber: result.quote.quoteNumber,
          invoiceId: result.invoice.id,
          invoiceNumber: result.invoice.invoiceNumber
        }
      },
      req
    );

    res.status(201).json({
      message: "Cotización convertida a factura correctamente.",
      item: result.quote,
      invoice: result.invoice
    });
  }
}

export const quotesController = new QuotesController();
