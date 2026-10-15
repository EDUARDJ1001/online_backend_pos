import type { Request, Response } from "express";

import { cashContextFromRequest } from "../caja/caja.context";

import { auditService } from "../audit/audit.service";
import { writeAccountStatementPdf, type StatementLedgerRow } from "../shared/account-statement-pdf";
import { payablesService } from "./payables.service";

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export class PayablesController {
  async list(req: Request, res: Response) {
    const result = await payablesService.list(req.activeCompany!.id, req.query as never);

    res.json(result);
  }

  async create(req: Request, res: Response) {
    const document = await payablesService.create(req.activeCompany!.id, req.auth!.sub, req.body);

    await auditService.log(
      {
        companyId: req.activeCompany!.id,
        userId: req.auth!.sub,
        entityType: "CUENTA_POR_PAGAR",
        entityId: document.id,
        action: "CREAR",
        description: `Documento por pagar ${document.documentNumber} de ${document.supplierName} por L${document.total}.`,
        newValues: document
      },
      req
    );

    res.status(201).json({
      message: "Documento por pagar registrado correctamente.",
      item: document
    });
  }

  async getDetail(req: Request, res: Response) {
    const result = await payablesService.getDetail(req.activeCompany!.id, Number(req.params.id));

    res.json(result);
  }

  async void(req: Request, res: Response) {
    const before = await payablesService.findDocumentOrFail(req.activeCompany!.id, Number(req.params.id));
    const document = await payablesService.voidDocument(req.activeCompany!.id, Number(req.params.id));

    await auditService.log(
      {
        companyId: req.activeCompany!.id,
        userId: req.auth!.sub,
        entityType: "CUENTA_POR_PAGAR",
        entityId: document.id,
        action: "ANULAR",
        description: `Documento por pagar ${document.documentNumber} anulado.`,
        oldValues: before,
        newValues: document
      },
      req
    );

    res.json({
      message: "Documento anulado correctamente.",
      item: document
    });
  }

  async registerPayment(req: Request, res: Response) {
    const result = await payablesService.registerPayment(
      req.activeCompany!.id,
      req.auth!.sub,
      Number(req.params.id),
      req.body,
      await cashContextFromRequest(req)
    );

    await auditService.log(
      {
        companyId: req.activeCompany!.id,
        userId: req.auth!.sub,
        entityType: "PAGO",
        entityId: result.paymentId,
        action: "REGISTRAR",
        description: `Pago ${result.receiptNumber} sobre el documento ${result.document.documentNumber} por L${req.body.amount}.`,
        newValues: { receiptNumber: result.receiptNumber, document: result.document }
      },
      req
    );

    res.status(201).json({
      message: "Pago registrado correctamente.",
      item: result.document,
      receiptNumber: result.receiptNumber
    });
  }

  async supplierStatement(req: Request, res: Response) {
    const result = await payablesService.supplierStatement(req.activeCompany!.id, Number(req.params.supplierId));

    res.json(result);
  }

  async supplierStatementPdf(req: Request, res: Response) {
    const statement = await payablesService.supplierStatement(req.activeCompany!.id, Number(req.params.supplierId));
    const company = req.activeCompany!;

    const events = [
      ...statement.documents.map((document) => ({
        date: document.documentDate,
        number: document.documentNumber,
        concept: document.description ?? "Documento por pagar",
        charge: Number(document.total),
        payment: 0,
        sort: `${document.documentDate ?? ""}-A-${document.id}`
      })),
      ...statement.payments.map((payment) => ({
        date: payment.paymentDate,
        number: payment.receiptNumber ?? "Pago",
        concept: `Pago (${payment.method})`,
        charge: 0,
        payment: Number(payment.amount),
        sort: `${payment.paymentDate ?? ""}-B-${payment.id}`
      }))
    ].sort((a, b) => a.sort.localeCompare(b.sort));

    let running = 0;
    const rows: StatementLedgerRow[] = events.map((event) => {
      running = round2(running + event.charge - event.payment);
      return {
        date: event.date,
        number: event.number,
        concept: event.concept,
        charge: event.charge,
        payment: event.payment,
        balance: running
      };
    });

    writeAccountStatementPdf(
      {
        title: "Estado de cuenta",
        filename: `estado-cuenta-${statement.supplier.name.replace(/\s+/g, "-").toLowerCase()}.pdf`,
        company: {
          commercialName: company.commercialName,
          legalName: company.legalName,
          rtn: company.rtn,
          phone: company.phone,
          address: company.address
        },
        party: {
          label: "Proveedor",
          name: statement.supplier.name,
          rtn: statement.supplier.rtn,
          phone: statement.supplier.phone,
          address: statement.supplier.address
        },
        rows,
        totals: statement.totals
      },
      res
    );
  }
}

export const payablesController = new PayablesController();
