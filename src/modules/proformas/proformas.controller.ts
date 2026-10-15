import type { Request, Response } from "express";

import { cashContextFromRequest } from "../caja/caja.context";

import { auditService } from "../audit/audit.service";
import { withDocumentBranding } from "../companies/document-branding";
import { writeProformaPdf } from "./proforma-pdf";
import { renderProformaHtml } from "./proforma-renderer";
import { proformasService } from "./proformas.service";

export class ProformasController {
  async list(req: Request, res: Response) {
    const result = await proformasService.list(req.activeCompany!.id, req.query as never);

    res.json(result);
  }

  async create(req: Request, res: Response) {
    const proforma = await proformasService.create(req.activeCompany!.id, req.auth!.sub, req.body);

    await auditService.log(
      {
        companyId: req.activeCompany!.id,
        userId: req.auth!.sub,
        entityType: "PROFORMA",
        entityId: proforma.id,
        action: "CREAR",
        description: `Proforma ${proforma.proformaNumber} creada.`,
        newValues: {
          proformaNumber: proforma.proformaNumber,
          total: proforma.grandTotal,
          customer: proforma.customerNameSnapshot
        }
      },
      req
    );

    res.status(201).json({
      message: "Proforma creada correctamente.",
      item: proforma
    });
  }

  async getById(req: Request, res: Response) {
    const proforma = await proformasService.getDetail(req.activeCompany!.id, Number(req.params.id));

    res.json({
      item: proforma
    });
  }

  async print(req: Request, res: Response) {
    const proforma = await proformasService.getDetail(req.activeCompany!.id, Number(req.params.id));

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(renderProformaHtml(await withDocumentBranding(req.activeCompany!.id, proforma)));
  }

  async pdf(req: Request, res: Response) {
    const proforma = await proformasService.getDetail(req.activeCompany!.id, Number(req.params.id));

    writeProformaPdf(await withDocumentBranding(req.activeCompany!.id, proforma), res);
  }

  async updateStatus(req: Request, res: Response) {
    const proforma = await proformasService.updateStatus(req.activeCompany!.id, req.auth!.sub, Number(req.params.id), req.body.status);

    await auditService.log(
      {
        companyId: req.activeCompany!.id,
        userId: req.auth!.sub,
        entityType: "PROFORMA",
        entityId: proforma.id,
        action: "CAMBIAR_ESTADO",
        description: `Proforma ${proforma.proformaNumber} cambió a ${proforma.status}.`,
        newValues: {
          status: proforma.status
        }
      },
      req
    );

    res.json({
      message: "Estado de proforma actualizado correctamente.",
      item: proforma
    });
  }

  async convertToInvoice(req: Request, res: Response) {
    const result = await proformasService.convertToInvoice(
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
        entityType: "PROFORMA",
        entityId: result.proforma.id,
        action: "FACTURAR",
        description: `Proforma ${result.proforma.proformaNumber} convertida a factura ${result.invoice.invoiceNumber}.`,
        newValues: {
          proformaNumber: result.proforma.proformaNumber,
          invoiceId: result.invoice.id,
          invoiceNumber: result.invoice.invoiceNumber
        }
      },
      req
    );

    res.status(201).json({
      message: "Proforma convertida a factura correctamente.",
      item: result.proforma,
      invoice: result.invoice
    });
  }
}

export const proformasController = new ProformasController();
