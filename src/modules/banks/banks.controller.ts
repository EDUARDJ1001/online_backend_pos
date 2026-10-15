import type { Request, Response } from "express";

import { auditService } from "../audit/audit.service";
import { banksService } from "./banks.service";

const MOVEMENT_LABELS: Record<string, string> = {
  DEPOSITO: "Depósito",
  RETIRO: "Retiro",
  COMISION: "Comisión bancaria",
  INTERES: "Interés",
  NOTA_CREDITO: "Nota de crédito",
  NOTA_DEBITO: "Nota de débito"
};

/** Número de cuenta en la bitácora: solo los últimos 4 dígitos. */
const masked = (accountNumber: string) => `****${accountNumber.replace(/\D/g, "").slice(-4)}`;

export class BanksController {
  async listAccounts(req: Request, res: Response) {
    const items = await banksService.listAccounts(req.activeCompany!.id, (req.query as { status?: "active" | "inactive" | "all" }).status);
    res.json({ items });
  }

  async createAccount(req: Request, res: Response) {
    const account = await banksService.createAccount(req.activeCompany!.id, req.auth!.sub, req.body);
    await auditService.log(
      {
        companyId: req.activeCompany!.id,
        userId: req.auth!.sub,
        entityType: "CUENTA_BANCARIA",
        entityId: account.id,
        action: "CREAR",
        description: `Cuenta ${account.bankName} ${masked(account.accountNumber)} creada.`
      },
      req
    );
    res.status(201).json({ message: "Cuenta bancaria creada.", item: account });
  }

  async updateAccount(req: Request, res: Response) {
    const account = await banksService.updateAccount(req.activeCompany!.id, Number(req.params.id), req.body);
    await auditService.log(
      {
        companyId: req.activeCompany!.id,
        userId: req.auth!.sub,
        entityType: "CUENTA_BANCARIA",
        entityId: account.id,
        action: "EDITAR",
        description: `Cuenta ${account.bankName} ${masked(account.accountNumber)} actualizada.`
      },
      req
    );
    res.json({ message: "Cuenta bancaria actualizada.", item: account });
  }

  async setAccountStatus(req: Request, res: Response) {
    const account = await banksService.setAccountStatus(req.activeCompany!.id, Number(req.params.id), req.body.isActive);
    await auditService.log(
      {
        companyId: req.activeCompany!.id,
        userId: req.auth!.sub,
        entityType: "CUENTA_BANCARIA",
        entityId: account.id,
        action: account.isActive ? "ACTIVAR" : "DESACTIVAR",
        description: `Cuenta ${account.bankName} ${masked(account.accountNumber)} ${account.isActive ? "activada" : "desactivada"}.`
      },
      req
    );
    res.json({ message: account.isActive ? "Cuenta activada." : "Cuenta desactivada.", item: account });
  }

  async listMovements(req: Request, res: Response) {
    const result = await banksService.listMovements(req.activeCompany!.id, Number(req.params.id), req.query as never);
    res.json(result);
  }

  async createMovement(req: Request, res: Response) {
    const { movement, warning } = await banksService.createMovement(req.activeCompany!.id, req.auth!.sub, req.body);
    await this.logMovement(req, movement.id, "CREAR", `${MOVEMENT_LABELS[movement.movementType] ?? movement.movementType} por ${movement.amount.toFixed(2)}.`);
    res.status(201).json({ message: `${MOVEMENT_LABELS[movement.movementType] ?? "Movimiento"} registrado.`, item: movement, warning });
  }

  async createCheck(req: Request, res: Response) {
    const { movement, warning } = await banksService.createCheck(req.activeCompany!.id, req.auth!.sub, req.body);
    await this.logMovement(req, movement.id, "CREAR", `Cheque ${movement.checkNumber} a ${movement.beneficiary} por ${movement.amount.toFixed(2)}.`);
    res.status(201).json({ message: `Cheque ${movement.checkNumber} registrado.`, item: movement, warning });
  }

  async createTransfer(req: Request, res: Response) {
    const { movement, warning } = await banksService.createTransfer(req.activeCompany!.id, req.auth!.sub, req.body);
    await this.logMovement(req, movement.id, "CREAR", `Transferencia por ${movement.amount.toFixed(2)} a ${movement.relatedAccountName ?? "otra cuenta"}.`);
    res.status(201).json({ message: "Transferencia registrada.", item: movement, warning });
  }

  async voidMovement(req: Request, res: Response) {
    const movement = await banksService.voidMovement(req.activeCompany!.id, req.auth!.sub, Number(req.params.id), req.body.reason);
    await this.logMovement(req, movement.id, "ANULAR", `Movimiento anulado: ${req.body.reason}`);
    res.json({ message: movement.relatedMovementId ? "Transferencia anulada en las dos cuentas." : "Movimiento anulado.", item: movement });
  }

  async setCheckStatus(req: Request, res: Response) {
    const movement = await banksService.setCheckStatus(req.activeCompany!.id, Number(req.params.id), req.body.checkStatus);
    await this.logMovement(req, movement.id, "EDITAR", `Cheque ${movement.checkNumber} marcado como ${movement.checkStatus === "COBRADO" ? "cobrado" : "emitido"}.`);
    res.json({ message: movement.checkStatus === "COBRADO" ? "Cheque marcado como cobrado." : "Cheque marcado como emitido.", item: movement });
  }

  private logMovement(req: Request, id: number, action: string, description: string) {
    return auditService.log({ companyId: req.activeCompany!.id, userId: req.auth!.sub, entityType: "MOVIMIENTO_BANCARIO", entityId: id, action, description }, req);
  }
}

export const banksController = new BanksController();
