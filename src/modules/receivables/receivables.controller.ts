import type { Request, Response } from "express";

import { cashContextFromRequest } from "../caja/caja.context";

import { auditService } from "../audit/audit.service";
import { writeAccountStatementPdf, type StatementLedgerRow } from "../shared/account-statement-pdf";
import { receivablesService } from "./receivables.service";

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export class ReceivablesController {
  async list(req: Request, res: Response) {
    const result = await receivablesService.list(req.activeCompany!.id, req.query as never);

    res.json(result);
  }

  async getDetail(req: Request, res: Response) {
    const result = await receivablesService.getDetail(req.activeCompany!.id, Number(req.params.invoiceId));

    res.json(result);
  }

  async registerPayment(req: Request, res: Response) {
    const result = await receivablesService.registerPayment(
      req.activeCompany!.id,
      req.auth!.sub,
      Number(req.params.invoiceId),
      req.body,
      await cashContextFromRequest(req)
    );

    await auditService.log(
      {
        companyId: req.activeCompany!.id,
        userId: req.auth!.sub,
        entityType: "COBRO",
        entityId: result.paymentId,
        action: "REGISTRAR",
        description: `Abono ${result.receiptNumber} sobre la factura ${result.invoice.invoiceNumber} por L${req.body.amount}.`,
        newValues: { receiptNumber: result.receiptNumber, invoice: result.invoice }
      },
      req
    );

    res.status(201).json({
      message: "Abono registrado correctamente.",
      item: result.invoice,
      receiptNumber: result.receiptNumber
    });
  }

  async clientStatement(req: Request, res: Response) {
    const result = await receivablesService.clientStatement(req.activeCompany!.id, Number(req.params.clientId));

    res.json(result);
  }

  async clientStatementPdf(req: Request, res: Response) {
    const statement = await receivablesService.clientStatement(req.activeCompany!.id, Number(req.params.clientId));
    const company = req.activeCompany!;

    const events = [
      ...statement.invoices.map((invoice) => ({
        date: invoice.invoiceDate,
        number: invoice.invoiceNumber,
        concept: "Factura",
        charge: Number(invoice.grandTotal),
        payment: 0,
        sort: `${invoice.invoiceDate ?? ""}-A-${invoice.id}`
      })),
      ...statement.payments.map((payment) => ({
        date: payment.paymentDate,
        number: payment.receiptNumber ?? "Abono",
        concept: `Abono (${payment.method})`,
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
        filename: `estado-cuenta-${statement.client.name.replace(/\s+/g, "-").toLowerCase()}.pdf`,
        company: {
          commercialName: company.commercialName,
          legalName: company.legalName,
          rtn: company.rtn,
          phone: company.phone,
          address: company.address
        },
        party: {
          label: "Cliente",
          name: statement.client.name,
          rtn: statement.client.rtn,
          phone: statement.client.phone,
          address: statement.client.address
        },
        rows,
        totals: statement.totals
      },
      res
    );
  }
}

export const receivablesController = new ReceivablesController();
