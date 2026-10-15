import type { ResultSetHeader, RowDataPacket } from "mysql2";

import { dbPool, withTransaction, type DbConnection } from "../../config/db";
import { AppError } from "../../utils/http-error";
import { resolvePagination } from "../../utils/pagination";

/**
 * Bancos: cuentas de la empresa y su libro de movimientos. El saldo de una cuenta es
 * su saldo inicial más las entradas menos las salidas activas (las anuladas no
 * cuentan). Los movimientos no se borran: se anulan con motivo.
 */

export type MovementType =
  | "DEPOSITO"
  | "RETIRO"
  | "TRANSFERENCIA_ENTRADA"
  | "TRANSFERENCIA_SALIDA"
  | "COMISION"
  | "INTERES"
  | "NOTA_CREDITO"
  | "NOTA_DEBITO"
  | "CHEQUE";

/** Sentido de cada tipo: entra o sale dinero de la cuenta. */
const DIRECTION: Record<MovementType, "IN" | "OUT"> = {
  DEPOSITO: "IN",
  TRANSFERENCIA_ENTRADA: "IN",
  INTERES: "IN",
  NOTA_CREDITO: "IN",
  RETIRO: "OUT",
  TRANSFERENCIA_SALIDA: "OUT",
  COMISION: "OUT",
  NOTA_DEBITO: "OUT",
  CHEQUE: "OUT"
};

interface AccountRow extends RowDataPacket {
  id: number;
  bankName: string;
  accountType: "CORRIENTE" | "AHORRO";
  currency: "HNL" | "USD";
  accountNumber: string;
  alias: string | null;
  openingBalance: number;
  openingDate: string | Date;
  isActive: number;
  movementsIn: number | null;
  movementsOut: number | null;
  pendingChecks: number | null;
  pendingChecksTotal: number | null;
  movementCount: number | null;
}

interface MovementRow extends RowDataPacket {
  id: number;
  bankAccountId: number;
  movementDate: string | Date;
  movementType: MovementType;
  direction: "IN" | "OUT";
  amount: number;
  reference: string | null;
  description: string | null;
  checkNumber: string | null;
  beneficiary: string | null;
  checkStatus: "EMITIDO" | "COBRADO" | null;
  relatedMovementId: number | null;
  status: "ACTIVO" | "ANULADO";
  voidReason: string | null;
  voidedAt: string | Date | null;
  createdAt: string | Date;
  createdByName: string | null;
  voidedByName: string | null;
  relatedAccountName: string | null;
}

type Executor = Pick<DbConnection, "query" | "execute">;

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function dateOnly(value: string | Date | null) {
  if (!value) return null;
  if (value instanceof Date) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }
  return String(value).slice(0, 10);
}

function isDuplicate(error: unknown) {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "ER_DUP_ENTRY";
}

/** Saldo, entradas y salidas activas por cuenta (subconsulta agrupada). */
const ACCOUNT_SELECT = `
  SELECT a.id, a.bank_name AS bankName, a.account_type AS accountType, a.currency, a.account_number AS accountNumber,
         a.alias, a.opening_balance AS openingBalance, a.opening_date AS openingDate, a.is_active AS isActive,
         t.movementsIn, t.movementsOut, t.pendingChecks, t.pendingChecksTotal, t.movementCount
  FROM bank_accounts a
  LEFT JOIN (
    SELECT bank_account_id,
           SUM(CASE WHEN status = 'ACTIVO' AND direction = 'IN' THEN amount ELSE 0 END) AS movementsIn,
           SUM(CASE WHEN status = 'ACTIVO' AND direction = 'OUT' THEN amount ELSE 0 END) AS movementsOut,
           SUM(CASE WHEN status = 'ACTIVO' AND movement_type = 'CHEQUE' AND check_status = 'EMITIDO' THEN 1 ELSE 0 END) AS pendingChecks,
           SUM(CASE WHEN status = 'ACTIVO' AND movement_type = 'CHEQUE' AND check_status = 'EMITIDO' THEN amount ELSE 0 END) AS pendingChecksTotal,
           COUNT(*) AS movementCount
    FROM bank_movements
    GROUP BY bank_account_id
  ) t ON t.bank_account_id = a.id`;

function toAccount(row: AccountRow) {
  const movementsIn = Number(row.movementsIn ?? 0);
  const movementsOut = Number(row.movementsOut ?? 0);
  return {
    id: Number(row.id),
    bankName: row.bankName,
    accountType: row.accountType,
    currency: row.currency,
    accountNumber: row.accountNumber,
    alias: row.alias,
    openingBalance: Number(row.openingBalance),
    openingDate: dateOnly(row.openingDate)!,
    isActive: Boolean(Number(row.isActive)),
    movementsIn,
    movementsOut,
    balance: round2(Number(row.openingBalance) + movementsIn - movementsOut),
    pendingChecks: Number(row.pendingChecks ?? 0),
    pendingChecksTotal: Number(row.pendingChecksTotal ?? 0),
    hasMovements: Number(row.movementCount ?? 0) > 0
  };
}

export type BankAccount = ReturnType<typeof toAccount>;

function toMovement(row: MovementRow) {
  return {
    id: Number(row.id),
    bankAccountId: Number(row.bankAccountId),
    movementDate: dateOnly(row.movementDate)!,
    movementType: row.movementType,
    direction: row.direction,
    amount: Number(row.amount),
    reference: row.reference,
    description: row.description,
    checkNumber: row.checkNumber,
    beneficiary: row.beneficiary,
    checkStatus: row.checkStatus,
    relatedMovementId: row.relatedMovementId ? Number(row.relatedMovementId) : null,
    relatedAccountName: row.relatedAccountName,
    status: row.status,
    voidReason: row.voidReason,
    voidedAt: row.voidedAt ? new Date(row.voidedAt).toISOString() : null,
    voidedByName: row.voidedByName,
    createdAt: new Date(row.createdAt).toISOString(),
    createdByName: row.createdByName
  };
}

const MOVEMENT_SELECT = `
  SELECT m.id, m.bank_account_id AS bankAccountId, m.movement_date AS movementDate, m.movement_type AS movementType,
         m.direction, m.amount, m.reference, m.description, m.check_number AS checkNumber, m.beneficiary,
         m.check_status AS checkStatus, m.related_movement_id AS relatedMovementId, m.status, m.void_reason AS voidReason,
         m.voided_at AS voidedAt, m.created_at AS createdAt, cu.full_name AS createdByName, vu.full_name AS voidedByName,
         ra.bank_name AS relatedAccountName
  FROM bank_movements m
  LEFT JOIN users cu ON cu.id = m.created_by
  LEFT JOIN users vu ON vu.id = m.voided_by
  LEFT JOIN bank_movements rm ON rm.id = m.related_movement_id
  LEFT JOIN bank_accounts ra ON ra.id = rm.bank_account_id`;

interface AccountPayload {
  bankName: string;
  accountType: "CORRIENTE" | "AHORRO";
  currency: "HNL" | "USD";
  accountNumber: string;
  alias?: string | null;
  openingBalance: number;
  openingDate: string;
}

class BanksService {
  async listAccounts(companyId: number, status: "active" | "inactive" | "all" = "active") {
    const conditions = ["a.company_id = ?"];
    if (status === "active") conditions.push("a.is_active = 1");
    if (status === "inactive") conditions.push("a.is_active = 0");
    const [rows] = await dbPool.query<AccountRow[]>(`${ACCOUNT_SELECT} WHERE ${conditions.join(" AND ")} ORDER BY a.is_active DESC, a.bank_name, a.id`, [
      companyId
    ]);
    return rows.map(toAccount);
  }

  async findAccountOrFail(companyId: number, accountId: number, executor: Executor = dbPool) {
    const [rows] = await executor.query<AccountRow[]>(`${ACCOUNT_SELECT} WHERE a.company_id = ? AND a.id = ?`, [companyId, accountId]);
    if (!rows[0]) {
      throw new AppError("La cuenta bancaria no existe en la empresa activa.", 404);
    }
    return toAccount(rows[0]);
  }

  async createAccount(companyId: number, userId: number, payload: AccountPayload) {
    try {
      const [result] = await dbPool.execute<ResultSetHeader>(
        `INSERT INTO bank_accounts (company_id, bank_name, account_type, currency, account_number, alias, opening_balance, opening_date, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [companyId, payload.bankName, payload.accountType, payload.currency, payload.accountNumber, payload.alias || null, payload.openingBalance, payload.openingDate, userId]
      );
      return this.findAccountOrFail(companyId, result.insertId);
    } catch (error) {
      if (isDuplicate(error)) throw new AppError("Ya existe una cuenta con ese banco y número.", 409);
      throw error;
    }
  }

  async updateAccount(companyId: number, accountId: number, payload: AccountPayload) {
    const current = await this.findAccountOrFail(companyId, accountId);
    // Con movimientos, cambiar la moneda o el saldo inicial alteraría todo el historial.
    if (current.hasMovements) {
      if (payload.currency !== current.currency) throw new AppError("La cuenta ya tiene movimientos: no se puede cambiar la moneda.", 409);
      if (Math.abs(payload.openingBalance - current.openingBalance) >= 0.005 || payload.openingDate !== current.openingDate) {
        throw new AppError("La cuenta ya tiene movimientos: no se puede cambiar el saldo ni la fecha inicial.", 409);
      }
    }
    try {
      await dbPool.execute(
        `UPDATE bank_accounts
         SET bank_name = ?, account_type = ?, currency = ?, account_number = ?, alias = ?, opening_balance = ?, opening_date = ?, updated_at = CURRENT_TIMESTAMP
         WHERE company_id = ? AND id = ?`,
        [payload.bankName, payload.accountType, payload.currency, payload.accountNumber, payload.alias || null, payload.openingBalance, payload.openingDate, companyId, accountId]
      );
    } catch (error) {
      if (isDuplicate(error)) throw new AppError("Ya existe una cuenta con ese banco y número.", 409);
      throw error;
    }
    return this.findAccountOrFail(companyId, accountId);
  }

  async setAccountStatus(companyId: number, accountId: number, isActive: boolean) {
    await this.findAccountOrFail(companyId, accountId);
    await dbPool.execute("UPDATE bank_accounts SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE company_id = ? AND id = ?", [
      isActive ? 1 : 0,
      companyId,
      accountId
    ]);
    return this.findAccountOrFail(companyId, accountId);
  }

  async listMovements(
    companyId: number,
    accountId: number,
    query: { dateFrom?: string; dateTo?: string; type: string; status: string; page?: number; pageSize?: number }
  ) {
    await this.findAccountOrFail(companyId, accountId);
    const pagination = resolvePagination(query.page, query.pageSize);
    const conditions = ["m.company_id = ?", "m.bank_account_id = ?"];
    const params: Array<string | number> = [companyId, accountId];
    if (query.dateFrom) {
      conditions.push("m.movement_date >= ?");
      params.push(query.dateFrom);
    }
    if (query.dateTo) {
      conditions.push("m.movement_date <= ?");
      params.push(query.dateTo);
    }
    if (query.type && query.type !== "all") {
      conditions.push("m.movement_type = ?");
      params.push(query.type);
    }
    if (query.status && query.status !== "all") {
      conditions.push("m.status = ?");
      params.push(query.status);
    }
    const where = conditions.join(" AND ");
    const [rows] = await dbPool.query<MovementRow[]>(`${MOVEMENT_SELECT} WHERE ${where} ORDER BY m.movement_date DESC, m.id DESC LIMIT ? OFFSET ?`, [
      ...params,
      pagination.pageSize,
      pagination.offset
    ]);
    const [count] = await dbPool.query<Array<RowDataPacket & { total: number }>>(`SELECT COUNT(*) AS total FROM bank_movements m WHERE ${where}`, params);
    return {
      items: rows.map(toMovement),
      pagination: { page: pagination.page, pageSize: pagination.pageSize, total: Number(count[0]?.total ?? 0) }
    };
  }

  private async findMovementOrFail(companyId: number, movementId: number, executor: Executor = dbPool) {
    const [rows] = await executor.query<MovementRow[]>(`${MOVEMENT_SELECT} WHERE m.company_id = ? AND m.id = ?`, [companyId, movementId]);
    if (!rows[0]) throw new AppError("El movimiento no existe en la empresa activa.", 404);
    return toMovement(rows[0]);
  }

  /** Cuenta activa y fecha dentro de su vigencia (no antes de su saldo inicial). */
  private async usableAccount(companyId: number, accountId: number, movementDate: string, executor: Executor) {
    const account = await this.findAccountOrFail(companyId, accountId, executor);
    if (!account.isActive) throw new AppError(`La cuenta ${account.bankName} está desactivada.`, 409);
    if (movementDate < account.openingDate) {
      throw new AppError(`La fecha no puede ser anterior al saldo inicial de la cuenta (${account.openingDate}).`, 400);
    }
    return account;
  }

  private async insertMovement(
    executor: Executor,
    companyId: number,
    userId: number,
    data: {
      bankAccountId: number;
      movementDate: string;
      movementType: MovementType;
      amount: number;
      reference?: string | null;
      description?: string | null;
      checkNumber?: string | null;
      beneficiary?: string | null;
      checkStatus?: "EMITIDO" | null;
      relatedMovementId?: number | null;
    }
  ) {
    const [result] = await executor.execute<ResultSetHeader>(
      `INSERT INTO bank_movements
       (company_id, bank_account_id, movement_date, movement_type, direction, amount, reference, description, check_number, beneficiary, check_status, related_movement_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        companyId,
        data.bankAccountId,
        data.movementDate,
        data.movementType,
        DIRECTION[data.movementType],
        round2(data.amount),
        data.reference || null,
        data.description || null,
        data.checkNumber || null,
        data.beneficiary || null,
        data.checkStatus ?? null,
        data.relatedMovementId ?? null,
        userId
      ]
    );
    return result.insertId;
  }

  /** Aviso (no bloquea) si una salida deja la cuenta en negativo. */
  private negativeWarning(account: BankAccount, outAmount: number) {
    const after = round2(account.balance - outAmount);
    return after < 0 ? `La cuenta ${account.bankName} queda con saldo negativo (${after.toFixed(2)}).` : null;
  }

  async createMovement(
    companyId: number,
    userId: number,
    payload: { bankAccountId: number; movementType: MovementType; movementDate: string; amount: number; reference?: string | null; description?: string | null }
  ) {
    return withTransaction(async (connection) => {
      const account = await this.usableAccount(companyId, payload.bankAccountId, payload.movementDate, connection);
      const id = await this.insertMovement(connection, companyId, userId, payload);
      return {
        movement: await this.findMovementOrFail(companyId, id, connection),
        warning: DIRECTION[payload.movementType] === "OUT" ? this.negativeWarning(account, payload.amount) : null
      };
    });
  }

  async createCheck(
    companyId: number,
    userId: number,
    payload: { bankAccountId: number; movementDate: string; amount: number; checkNumber: string; beneficiary: string; description?: string | null }
  ) {
    try {
      return await withTransaction(async (connection) => {
        const account = await this.usableAccount(companyId, payload.bankAccountId, payload.movementDate, connection);
        const id = await this.insertMovement(connection, companyId, userId, {
          ...payload,
          movementType: "CHEQUE",
          reference: payload.checkNumber,
          checkStatus: "EMITIDO"
        });
        return { movement: await this.findMovementOrFail(companyId, id, connection), warning: this.negativeWarning(account, payload.amount) };
      });
    } catch (error) {
      if (isDuplicate(error)) throw new AppError(`El cheque número ${payload.checkNumber} ya está registrado en esta cuenta.`, 409);
      throw error;
    }
  }

  async createTransfer(
    companyId: number,
    userId: number,
    payload: { fromAccountId: number; toAccountId: number; movementDate: string; amount: number; reference?: string | null; description?: string | null }
  ) {
    return withTransaction(async (connection) => {
      const from = await this.usableAccount(companyId, payload.fromAccountId, payload.movementDate, connection);
      const to = await this.usableAccount(companyId, payload.toAccountId, payload.movementDate, connection);
      if (from.currency !== to.currency) {
        throw new AppError("Solo se puede transferir entre cuentas de la misma moneda.", 400);
      }
      const description = payload.description || `Transferencia de ${from.bankName} a ${to.bankName}`;
      const outId = await this.insertMovement(connection, companyId, userId, {
        bankAccountId: from.id,
        movementDate: payload.movementDate,
        movementType: "TRANSFERENCIA_SALIDA",
        amount: payload.amount,
        reference: payload.reference,
        description
      });
      const inId = await this.insertMovement(connection, companyId, userId, {
        bankAccountId: to.id,
        movementDate: payload.movementDate,
        movementType: "TRANSFERENCIA_ENTRADA",
        amount: payload.amount,
        reference: payload.reference,
        description,
        relatedMovementId: outId
      });
      await connection.execute("UPDATE bank_movements SET related_movement_id = ?, updated_at = CURRENT_TIMESTAMP WHERE company_id = ? AND id = ?", [
        inId,
        companyId,
        outId
      ]);
      return { movement: await this.findMovementOrFail(companyId, outId, connection), warning: this.negativeWarning(from, payload.amount) };
    });
  }

  /** Anula el movimiento (y su par si es transferencia). Un cheque ya cobrado no se anula. */
  async voidMovement(companyId: number, userId: number, movementId: number, reason: string) {
    return withTransaction(async (connection) => {
      const movement = await this.findMovementOrFail(companyId, movementId, connection);
      if (movement.status === "ANULADO") throw new AppError("El movimiento ya está anulado.", 409);
      if (movement.movementType === "CHEQUE" && movement.checkStatus === "COBRADO") {
        throw new AppError("El cheque ya fue cobrado: márcalo como emitido antes de anularlo.", 409);
      }
      const ids = [movement.id, ...(movement.relatedMovementId ? [movement.relatedMovementId] : [])];
      for (const id of ids) {
        await connection.execute(
          `UPDATE bank_movements SET status = 'ANULADO', void_reason = ?, voided_by = ?, voided_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
           WHERE company_id = ? AND id = ? AND status = 'ACTIVO'`,
          [reason, userId, companyId, id]
        );
      }
      return this.findMovementOrFail(companyId, movement.id, connection);
    });
  }

  async setCheckStatus(companyId: number, movementId: number, checkStatus: "EMITIDO" | "COBRADO") {
    const movement = await this.findMovementOrFail(companyId, movementId);
    if (movement.movementType !== "CHEQUE") throw new AppError("El movimiento no es un cheque.", 400);
    if (movement.status === "ANULADO") throw new AppError("El cheque está anulado.", 409);
    await dbPool.execute("UPDATE bank_movements SET check_status = ?, updated_at = CURRENT_TIMESTAMP WHERE company_id = ? AND id = ?", [
      checkStatus,
      companyId,
      movementId
    ]);
    return this.findMovementOrFail(companyId, movementId);
  }
}

export const banksService = new BanksService();
