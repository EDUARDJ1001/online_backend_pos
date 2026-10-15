import type { Request, Response } from "express";

import { AppError } from "../../utils/http-error";
import { listLocalTicketTargets } from "./local-printers";
import { writePrintTestPdf } from "./print-test-pdf";
import { printService } from "./print.service";
import { isRequestFromServerPc } from "./server-pc";

/** La impresora de tickets del sistema es la de su propia PC (en una caja, la de la caja). */
function requireServerPc(req: Request) {
  if (!isRequestFromServerPc(req)) {
    throw new AppError(
      "La impresora de tickets del sistema solo se usa desde la PC donde está instalado. Asigna en este equipo su propia impresora (Sistema > Impresoras).",
      403
    );
  }
}

class PrintController {
  async status(req: Request, res: Response) {
    const result = await printService.status();
    // Solo la PC del backend puede elegir su impresora de tickets.
    res.json({ ...result, isServerPc: isRequestFromServerPc(req) });
  }

  async testPdf(req: Request, res: Response) {
    writePrintTestPdf(req.query.format === "carta" ? "carta" : "ticket", req.activeCompany!.legalName, res);
  }

  /** Puertos COM e impresoras de Windows de esta PC que pueden imprimir el ticket térmico. */
  async localTargets(req: Request, res: Response) {
    requireServerPc(req);
    try {
      res.json({ items: await listLocalTicketTargets() });
    } catch (error) {
      throw new AppError(`No se pudieron leer las impresoras de esta PC: ${(error as Error).message}`, 500);
    }
  }

  async setTicketPrinter(req: Request, res: Response) {
    requireServerPc(req);
    printService.setInterface(String((req.body as { interface?: string }).interface ?? ""));
    res.json(await printService.status());
  }

  async testTicket(req: Request, res: Response) {
    requireServerPc(req);
    res.json(await printService.printTestTicket(req.activeCompany!.commercialName || req.activeCompany!.legalName));
  }

  async invoiceTicket(req: Request, res: Response) {
    requireServerPc(req);
    const result = await printService.printInvoiceTicket(req.activeCompany!.id, Number(req.params.id));
    res.json(result);
  }
}

export const printController = new PrintController();
