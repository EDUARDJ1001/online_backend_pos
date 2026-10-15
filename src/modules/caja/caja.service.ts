import { createHash, randomBytes } from "crypto";

import type { ResultSetHeader, RowDataPacket } from "mysql2";

import { dbPool, type DbConnection } from "../../config/db";
import { resolvePagination } from "../../utils/pagination";
import { AppError } from "../../utils/http-error";
import { clientIpCandidates, ipAllowed, normalizeIp, parseCidr } from "./caja-network";

export type CashMethod = "EFECTIVO" | "TRANSFERENCIA" | "CHEQUE" | "TARJETA" | "OTRO";
export type CashMovementType =
  | "APERTURA"
  | "VENTA_CONTADO"
  | "ABONO_CXC"
  | "PAGO_CXP"
  | "INGRESO"
  | "EGRESO"
  | "RETIRO"
  | "AJUSTE";
type CashDirection = "IN" | "OUT";
type CashBreakdown = Record<string, number>;
type FlowKey = "FONDO" | CashMovementType;

export const CASH_METHODS: CashMethod[] = ["EFECTIVO", "TRANSFERENCIA", "TARJETA", "CHEQUE", "OTRO"];

/** Filas fijas del cuadro de cierre (AJUSTE solo aparece si hubo alguno). */
const FLOW_ROWS: FlowKey[] = ["FONDO", "VENTA_CONTADO", "ABONO_CXC", "INGRESO", "PAGO_CXP", "EGRESO", "RETIRO"];

export interface CashFlowRow {
  key: FlowKey;
  byMethod: Record<CashMethod, number>;
  total: number;
}

export interface CashFlowTable {
  rows: CashFlowRow[];
  totals: { byMethod: Record<CashMethod, number>; total: number };
}

/** Denominaciones de lempira aceptadas en el conteo (billetes y monedas). */
export const CASH_DENOMINATIONS = [500, 200, 100, 50, 20, 10, 5, 2, 1] as const;

/** Sentido por defecto de cada tipo de movimiento. AJUSTE se pasa explícito. */
const DIRECTION_BY_TYPE: Record<Exclude<CashMovementType, "AJUSTE">, CashDirection> = {
  APERTURA: "IN",
  VENTA_CONTADO: "IN",
  ABONO_CXC: "IN",
  INGRESO: "IN",
  PAGO_CXP: "OUT",
  EGRESO: "OUT",
  RETIRO: "OUT"
};

interface RegisterRow extends RowDataPacket {
  id: number;
  name: string;
  isActive: number;
}

interface SessionRow extends RowDataPacket {
  id: number;
  companyId: number;
  cashRegisterId: number;
  registerName: string | null;
  openedBy: number;
  openedByName: string | null;
  openedAt: string;
  openingAmount: number;
  openingBreakdown: CashBreakdown | null;
  status: "ABIERTA" | "CERRADA";
  closedBy: number | null;
  closedByName: string | null;
  closedAt: string | null;
  countedAmount: number | null;
  expectedAmount: number | null;
  difference: number | null;
  closingBreakdown: CashBreakdown | null;
  openingNotes: string | null;
  closingNotes: string | null;
}

interface MovementRow extends RowDataPacket {
  id: number;
  type: CashMovementType;
  method: CashMethod;
  direction: CashDirection;
  amount: number;
  referenceType: string | null;
  referenceId: number | null;
  description: string | null;
  createdByName: string | null;
  createdAt: string;
}

interface TerminalRow extends RowDataPacket {
  id: number;
  name: string;
  cashRegisterId: number;
  registerName: string;
  isActive: number;
  lastSeenAt: string | null;
  registeredByName: string | null;
  registeredIp: string | null;
  lastIp: string | null;
  boundIp: string | null;
  createdAt: string;
}

/** Equipo (PC) registrado como caja física. */
export interface CashTerminal {
  id: number;
  name: string;
  cashRegisterId: number;
  registerName: string;
}

/**
 * Contexto de caja de una petición: qué equipo la hace y si el usuario puede
 * gestionar cajas (caja.manage). El backend decide la caja con esto; el cliente
 * no elige libremente.
 */
export interface CashContext {
  terminal: CashTerminal | null;
  canManage: boolean;
  /**
   * none: la petición no trae token · ok: equipo válido · invalid: token
   * desconocido o revocado · network: equipo válido pero fuera de la red autorizada.
   */
  terminalStatus: "none" | "ok" | "invalid" | "network";
  clientIp: string | null;
}

export const NO_CASH_CONTEXT: CashContext = { terminal: null, canManage: false, terminalStatus: "none", clientIp: null };

function outsideNetworkMessage(ip: string | null) {
  return `Este equipo está fuera de la red autorizada para caja (IP ${ip ?? "desconocida"}). Conéctalo a la red de la tienda o pide a un administrador que la autorice.`;
}

const UNREGISTERED_MESSAGE =
  "Este equipo no está registrado como caja. Pide a un administrador que asigne la IP de esta PC a una caja (Registro de cajas) o ingresa en Caja un código de vinculación.";

export interface RecordMovementParams {
  companyId: number;
  sessionId: number;
  userId: number;
  type: CashMovementType;
  method: CashMethod;
  amount: number;
  direction?: CashDirection;
  referenceType?: string | null;
  referenceId?: number | null;
  description?: string | null;
}

const SESSION_COLUMNS = `
  s.id,
  s.company_id AS companyId,
  s.cash_register_id AS cashRegisterId,
  reg.name AS registerName,
  s.opened_by AS openedBy,
  ou.full_name AS openedByName,
  s.opened_at AS openedAt,
  s.opening_amount AS openingAmount,
  s.opening_breakdown AS openingBreakdown,
  s.status,
  s.closed_by AS closedBy,
  cu.full_name AS closedByName,
  s.closed_at AS closedAt,
  s.counted_amount AS countedAmount,
  s.expected_amount AS expectedAmount,
  s.difference,
  s.closing_breakdown AS closingBreakdown,
  s.opening_notes AS openingNotes,
  s.closing_notes AS closingNotes`;

const SESSION_JOINS = `
  FROM cash_sessions s
  LEFT JOIN cash_registers reg ON reg.id = s.cash_register_id
  LEFT JOIN users ou ON ou.id = s.opened_by
  LEFT JOIN users cu ON cu.id = s.closed_by`;

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normalize(value?: string | null) {
  return value?.trim() ? value.trim() : null;
}

function directionFor(type: CashMovementType, override?: CashDirection): CashDirection {
  if (type === "AJUSTE") {
    return override ?? "IN";
  }

  return override ?? DIRECTION_BY_TYPE[type];
}

/** Suma un desglose de denominaciones a un total en lempiras. */
function sumBreakdown(breakdown?: CashBreakdown | null) {
  if (!breakdown) {
    return 0;
  }

  return round2(
    Object.entries(breakdown).reduce((total, [denomination, count]) => total + Number(denomination) * Number(count), 0)
  );
}

function parseBreakdown(value: CashBreakdown | string | null): CashBreakdown | null {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    try {
      return JSON.parse(value) as CashBreakdown;
    } catch {
      return null;
    }
  }

  return value;
}

class CajaService {
  private mapSession(row: SessionRow) {
    return {
      id: row.id,
      cashRegisterId: row.cashRegisterId,
      registerName: row.registerName,
      openedBy: row.openedBy,
      openedByName: row.openedByName,
      openedAt: row.openedAt,
      openingAmount: Number(row.openingAmount),
      openingBreakdown: parseBreakdown(row.openingBreakdown),
      status: row.status,
      closedBy: row.closedBy,
      closedByName: row.closedByName,
      closedAt: row.closedAt,
      countedAmount: row.countedAmount === null ? null : Number(row.countedAmount),
      expectedAmount: row.expectedAmount === null ? null : Number(row.expectedAmount),
      difference: row.difference === null ? null : Number(row.difference),
      closingBreakdown: parseBreakdown(row.closingBreakdown),
      openingNotes: row.openingNotes,
      closingNotes: row.closingNotes
    };
  }

  // -------- Cajas (registros) --------

  async listRegisters(companyId: number, includeInactive = false) {
    const [rows] = await dbPool.query<RegisterRow[]>(
      `SELECT id, name, is_active AS isActive FROM cash_registers
       WHERE company_id = ? ${includeInactive ? "" : "AND is_active = 1"}
       ORDER BY id DESC`,
      [companyId]
    );

    return rows.map((row) => ({ id: row.id, name: row.name, isActive: Boolean(row.isActive) }));
  }

  async createRegister(companyId: number, name: string) {
    try {
      const [result] = await dbPool.execute<ResultSetHeader>(
        "INSERT INTO cash_registers (company_id, name) VALUES (?, ?)",
        [companyId, name.trim()]
      );

      return { id: result.insertId, name: name.trim(), isActive: true };
    } catch (error) {
      if ((error as { code?: string }).code === "ER_DUP_ENTRY") {
        throw new AppError("Ya existe una caja con ese nombre.", 409);
      }
      throw error;
    }
  }

  async updateRegister(companyId: number, id: number, payload: { name?: string; isActive?: boolean }) {
    const fields: string[] = [];
    const params: Array<string | number> = [];

    if (payload.name !== undefined) {
      fields.push("name = ?");
      params.push(payload.name.trim());
    }

    if (payload.isActive !== undefined) {
      // Una caja con sesión abierta no se desactiva: primero hay que cerrarla (arqueo).
      if (!payload.isActive && (await this.findOpenSessionId(dbPool, companyId, id))) {
        throw new AppError("La caja tiene una sesión abierta. Ciérrala antes de desactivarla.", 409);
      }
      fields.push("is_active = ?");
      params.push(payload.isActive ? 1 : 0);
    }

    if (fields.length === 0) {
      return this.listRegisters(companyId, true);
    }

    params.push(companyId, id);

    try {
      await dbPool.execute(`UPDATE cash_registers SET ${fields.join(", ")} WHERE company_id = ? AND id = ?`, params);
    } catch (error) {
      if ((error as { code?: string }).code === "ER_DUP_ENTRY") {
        throw new AppError("Ya existe una caja con ese nombre.", 409);
      }
      throw error;
    }

    return this.listRegisters(companyId, true);
  }

  // -------- Movimientos --------

  /** Inserta un movimiento en el ledger. Reutilizable desde otros módulos (venta, abonos). */
  async recordMovement(connection: DbConnection, params: RecordMovementParams) {
    const amount = round2(params.amount);

    if (amount <= 0) {
      return;
    }

    await connection.execute<ResultSetHeader>(
      `INSERT INTO cash_movements
        (company_id, session_id, type, method, direction, amount, reference_type, reference_id, description, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        params.companyId,
        params.sessionId,
        params.type,
        params.method,
        directionFor(params.type, params.direction),
        amount,
        params.referenceType ?? null,
        params.referenceId ?? null,
        normalize(params.description),
        params.userId
      ]
    );
  }

  private async listMovements(companyId: number, sessionId: number) {
    const [rows] = await dbPool.query<MovementRow[]>(
      `SELECT
        m.id,
        m.type,
        m.method,
        m.direction,
        m.amount,
        m.reference_type AS referenceType,
        m.reference_id AS referenceId,
        m.description,
        u.full_name AS createdByName,
        m.created_at AS createdAt
      FROM cash_movements m
      LEFT JOIN users u ON u.id = m.created_by
      WHERE m.company_id = ? AND m.session_id = ?
      ORDER BY m.created_at DESC, m.id DESC`,
      [companyId, sessionId]
    );

    return rows.map((row) => ({ ...row, amount: Number(row.amount) }));
  }

  private buildSummary(
    openingAmount: number,
    movements: Array<{ type: CashMovementType; method: CashMethod; direction: CashDirection; amount: number }>
  ) {
    const byMethod: Record<CashMethod, { in: number; out: number }> = {
      EFECTIVO: { in: 0, out: 0 },
      TRANSFERENCIA: { in: 0, out: 0 },
      CHEQUE: { in: 0, out: 0 },
      TARJETA: { in: 0, out: 0 },
      OTRO: { in: 0, out: 0 }
    };
    const byType: Partial<Record<CashMovementType, number>> = {};

    for (const movement of movements) {
      const bucket = byMethod[movement.method];
      if (movement.direction === "IN") {
        bucket.in = round2(bucket.in + movement.amount);
      } else {
        bucket.out = round2(bucket.out + movement.amount);
      }
      byType[movement.type] = round2((byType[movement.type] ?? 0) + movement.amount);
    }

    const cashIn = byMethod.EFECTIVO.in;
    const cashOut = byMethod.EFECTIVO.out;
    const expectedCash = round2(openingAmount + cashIn - cashOut);

    return { byMethod, byType, cashIn, cashOut, expectedCash, flow: this.buildFlow(openingAmount, movements) };
  }

  /**
   * Cuadro de flujo de la sesión: concepto x método, con signo (salidas negativas).
   * La fila FONDO lleva el monto de apertura en efectivo; la fila de totales es el
   * saldo esperado por método (efectivo = lo que debe haber físicamente en caja).
   */
  private buildFlow(
    openingAmount: number,
    movements: Array<{ type: CashMovementType; method: CashMethod; direction: CashDirection; amount: number }>
  ): CashFlowTable {
    const emptyMethods = () =>
      Object.fromEntries(CASH_METHODS.map((method) => [method, 0])) as Record<CashMethod, number>;
    const rows = new Map<FlowKey, Record<CashMethod, number>>(FLOW_ROWS.map((key) => [key, emptyMethods()]));

    rows.get("FONDO")!.EFECTIVO = round2(openingAmount);

    for (const movement of movements) {
      // La apertura ya viene en FONDO (opening_amount); no se duplica.
      if (movement.type === "APERTURA") {
        continue;
      }

      const row = rows.get(movement.type) ?? emptyMethods();
      rows.set(movement.type, row);
      const signed = movement.direction === "IN" ? movement.amount : -movement.amount;
      row[movement.method] = round2(row[movement.method] + signed);
    }

    const totals = emptyMethods();
    const flowRows: CashFlowRow[] = [...rows.entries()].map(([key, byMethod]) => {
      for (const method of CASH_METHODS) {
        totals[method] = round2(totals[method] + byMethod[method]);
      }
      return { key, byMethod, total: round2(CASH_METHODS.reduce((sum, method) => sum + byMethod[method], 0)) };
    });

    return {
      rows: flowRows,
      totals: { byMethod: totals, total: round2(CASH_METHODS.reduce((sum, method) => sum + totals[method], 0)) }
    };
  }

  // -------- Equipos (terminales) --------

  private hashToken(token: string) {
    return createHash("sha256").update(token).digest("hex");
  }

  /** Equipo activo de la empresa para ese token, o null (token inválido, revocado u otra empresa). */
  /**
   * Equipo de la petición: primero por token (registro en el navegador); si no hay
   * token válido, por la IP asignada al equipo en Registro de cajas.
   *   none: sin token ni IP asignada · invalid: token revocado/desconocido
   *   network: equipo válido pero fuera de la red autorizada.
   */
  async resolveTerminal(
    companyId: number,
    token: string | null,
    clientIp: string | null
  ): Promise<{ terminal: CashTerminal | null; status: "none" | "ok" | "invalid" | "network" }> {
    const baseQuery = `SELECT t.id, t.name, t.cash_register_id AS cashRegisterId, reg.name AS registerName
       FROM cash_terminals t
       INNER JOIN cash_registers reg ON reg.id = t.cash_register_id AND reg.is_active = 1
       WHERE t.company_id = ? AND t.is_active = 1`;

    let row: TerminalRow | undefined;

    if (token) {
      const [rows] = await dbPool.query<TerminalRow[]>(`${baseQuery} AND t.token_hash = ? LIMIT 1`, [companyId, this.hashToken(token)]);
      row = rows[0];
    }

    const candidates = clientIpCandidates(clientIp);
    if (!row && candidates.length > 0) {
      const [rows] = await dbPool.query<TerminalRow[]>(
        `${baseQuery} AND t.bound_ip IN (${candidates.map(() => "?").join(", ")}) ORDER BY t.id ASC LIMIT 1`,
        [companyId, ...candidates]
      );
      row = rows[0];
    }

    if (!row) {
      return { terminal: null, status: token ? "invalid" : "none" };
    }

    const ip = normalizeIp(clientIp);

    // Último uso e IP (a lo sumo una escritura cada 5 minutos, o al cambiar de IP).
    void dbPool
      .execute(
        `UPDATE cash_terminals SET last_seen_at = CURRENT_TIMESTAMP, last_ip = ?
         WHERE id = ? AND (last_seen_at IS NULL OR last_seen_at < CURRENT_TIMESTAMP - INTERVAL 5 MINUTE
           OR NOT ((last_ip = ?) OR (last_ip IS NULL AND ? IS NULL)))`,
        [ip, row.id, ip, ip]
      )
      .catch(() => undefined);

    if (!(await this.networkAllows(companyId, ip, row.cashRegisterId))) {
      return { terminal: null, status: "network" };
    }

    return {
      terminal: { id: row.id, name: row.name, cashRegisterId: row.cashRegisterId, registerName: row.registerName },
      status: "ok"
    };
  }

  // -------- Redes autorizadas (verificación por IP) --------

  /** Reglas que aplican a una caja: las generales (todas las cajas) + las de esa caja. */
  private async networkRules(companyId: number, cashRegisterId: number) {
    const [rows] = await dbPool.query<Array<RowDataPacket & { cidr: string }>>(
      "SELECT cidr FROM cash_network_rules WHERE company_id = ? AND (cash_register_id IS NULL OR cash_register_id = ?)",
      [companyId, cashRegisterId]
    );

    return rows.map((row) => row.cidr);
  }

  /** Sin reglas aplicables no hay restricción; con reglas, la IP debe estar dentro de alguna. */
  async networkAllows(companyId: number, ip: string | null, cashRegisterId: number) {
    return ipAllowed(ip, await this.networkRules(companyId, cashRegisterId));
  }

  private async assertNetworkAllows(companyId: number, ip: string | null, cashRegisterId: number) {
    if (!(await this.networkAllows(companyId, ip, cashRegisterId))) {
      throw new AppError(outsideNetworkMessage(normalizeIp(ip)), 403);
    }
  }

  async listNetworks(companyId: number, clientIp: string | null) {
    const [rows] = await dbPool.query<
      Array<
        RowDataPacket & {
          id: number;
          cashRegisterId: number | null;
          registerName: string | null;
          cidr: string;
          label: string | null;
          createdByName: string | null;
          createdAt: string;
        }
      >
    >(
      `SELECT n.id, n.cash_register_id AS cashRegisterId, reg.name AS registerName, n.cidr, n.label,
              u.full_name AS createdByName, n.created_at AS createdAt
       FROM cash_network_rules n
       LEFT JOIN cash_registers reg ON reg.id = n.cash_register_id
       LEFT JOIN users u ON u.id = n.created_by
       WHERE n.company_id = ?
       ORDER BY n.created_at DESC, n.id DESC`,
      [companyId]
    );

    const ip = normalizeIp(clientIp);
    const general = rows.filter((row) => row.cashRegisterId === null).map((row) => row.cidr);
    const registers = await this.listRegisters(companyId, false);

    return {
      items: rows.map((row) => ({ ...row })),
      clientIp: ip,
      // Acceso desde la IP actual, caja por caja (reglas generales + las de la caja).
      byRegister: registers.map((register) => {
        const rules = [...general, ...rows.filter((row) => row.cashRegisterId === register.id).map((row) => row.cidr)];
        return { cashRegisterId: register.id, name: register.name, restricted: rules.length > 0, clientAllowed: ipAllowed(ip, rules) };
      })
    };
  }

  /** Autoriza una IP/red para todas las cajas (cashRegisterId vacío) o para una caja. */
  async addNetwork(
    companyId: number,
    userId: number,
    payload: { cidr: string; label?: string; cashRegisterId?: number | null },
    clientIp: string | null
  ) {
    const parsed = parseCidr(payload.cidr);
    const cashRegisterId = payload.cashRegisterId ?? null;

    if (cashRegisterId) {
      await this.assertActiveRegister(companyId, cashRegisterId);
    }

    const [existing] = await dbPool.query<Array<RowDataPacket & { id: number }>>(
      "SELECT id FROM cash_network_rules WHERE company_id = ? AND cidr = ? AND (cash_register_id = ? OR (cash_register_id IS NULL AND ? IS NULL)) LIMIT 1",
      [companyId, parsed.cidr, cashRegisterId, cashRegisterId]
    );

    if (existing[0]) {
      throw new AppError(cashRegisterId ? "Esa red ya está autorizada para esta caja." : "Esa red ya está autorizada para todas las cajas.", 409);
    }

    await dbPool.execute("INSERT INTO cash_network_rules (company_id, cash_register_id, cidr, label, created_by) VALUES (?, ?, ?, ?, ?)", [
      companyId,
      cashRegisterId,
      parsed.cidr,
      normalize(payload.label),
      userId
    ]);

    return this.listNetworks(companyId, clientIp);
  }

  async removeNetwork(companyId: number, id: number, clientIp: string | null) {
    const [result] = await dbPool.execute<ResultSetHeader>("DELETE FROM cash_network_rules WHERE company_id = ? AND id = ?", [
      companyId,
      id
    ]);

    if (result.affectedRows === 0) {
      throw new AppError("Red no encontrada para la empresa activa.", 404);
    }

    return this.listNetworks(companyId, clientIp);
  }

  async listTerminals(companyId: number) {
    const [rows] = await dbPool.query<TerminalRow[]>(
      `SELECT t.id, t.name, t.cash_register_id AS cashRegisterId, reg.name AS registerName, t.is_active AS isActive,
              t.last_seen_at AS lastSeenAt, u.full_name AS registeredByName, t.registered_ip AS registeredIp,
              t.last_ip AS lastIp, t.bound_ip AS boundIp, t.created_at AS createdAt
       FROM cash_terminals t
       INNER JOIN cash_registers reg ON reg.id = t.cash_register_id
       LEFT JOIN users u ON u.id = t.registered_by
       WHERE t.company_id = ?
       ORDER BY t.id DESC`,
      [companyId]
    );

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      cashRegisterId: row.cashRegisterId,
      registerName: row.registerName,
      isActive: Boolean(row.isActive),
      lastSeenAt: row.lastSeenAt,
      registeredByName: row.registeredByName,
      registeredIp: row.registeredIp,
      lastIp: row.lastIp,
      boundIp: row.boundIp,
      createdAt: row.createdAt
    }));
  }

  private async assertActiveRegister(companyId: number, cashRegisterId: number) {
    const [rows] = await dbPool.query<RegisterRow[]>(
      "SELECT id, name, is_active AS isActive FROM cash_registers WHERE company_id = ? AND id = ? LIMIT 1",
      [companyId, cashRegisterId]
    );

    const register = rows[0];

    if (!register) {
      throw new AppError("Caja no encontrada para la empresa activa.", 404);
    }

    if (!register.isActive) {
      throw new AppError("La caja seleccionada está inactiva.", 400);
    }

    return register;
  }

  /**
   * Registra el equipo desde el que se hace la petición. El token en claro solo
   * se devuelve aquí (el navegador lo guarda); en la base queda su hash.
   */
  async registerTerminal(
    companyId: number,
    userId: number,
    payload: { cashRegisterId: number; name: string },
    clientIp: string | null
  ) {
    const register = await this.assertActiveRegister(companyId, payload.cashRegisterId);
    await this.assertNetworkAllows(companyId, clientIp, register.id);
    const token = randomBytes(32).toString("base64url");
    const ip = normalizeIp(clientIp);

    const [result] = await this.inTransaction(async (connection) => {
      await this.assertRegisterWithoutTerminal(connection, companyId, register.id);
      return connection.execute<ResultSetHeader>(
        `INSERT INTO cash_terminals (company_id, cash_register_id, name, token_hash, registered_by, registered_ip, last_ip)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [companyId, register.id, payload.name.trim(), this.hashToken(token), userId, ip, ip]
      );
    });

    return {
      token,
      terminal: { id: result.insertId, name: payload.name.trim(), cashRegisterId: register.id, registerName: register.name }
    };
  }

  /**
   * Código de un solo uso para vincular un equipo a una caja sin iniciar sesión
   * como administrador en esa PC. Formato XXXX-XXXX (sin caracteres ambiguos:
   * ~10^12 combinaciones), vence a los 10 minutos y anula los códigos pendientes
   * anteriores de la misma caja. En la base solo queda su hash.
   */
  async createPairingCode(companyId: number, userId: number, cashRegisterId: number, terminalName?: string) {
    const register = await this.assertActiveRegister(companyId, cashRegisterId);
    await this.inTransaction((connection) => this.assertRegisterWithoutTerminal(connection, companyId, register.id));
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const bytes = randomBytes(8);
    const raw = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
    const code = `${raw.slice(0, 4)}-${raw.slice(4)}`;

    await dbPool.execute(
      "UPDATE cash_terminal_pairings SET expires_at = CURRENT_TIMESTAMP WHERE company_id = ? AND cash_register_id = ? AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP",
      [companyId, register.id]
    );

    const [result] = await dbPool.execute<ResultSetHeader>(
      `INSERT INTO cash_terminal_pairings (company_id, cash_register_id, code_hash, terminal_name, created_by, expires_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP + INTERVAL 10 MINUTE)`,
      [companyId, register.id, this.hashToken(code), normalize(terminalName), userId]
    );

    const [rows] = await dbPool.query<Array<RowDataPacket & { expiresAt: string }>>(
      "SELECT expires_at AS expiresAt FROM cash_terminal_pairings WHERE id = ?",
      [result.insertId]
    );

    return { code, expiresAt: rows[0]!.expiresAt, registerName: register.name };
  }

  /** Canjea un código de vinculación: registra este equipo en la caja del código. */
  async redeemPairingCode(companyId: number, payload: { code: string; name?: string }, clientIp: string | null) {
    const ip = normalizeIp(clientIp);

    const code = payload.code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    const normalizedCode = `${code.slice(0, 4)}-${code.slice(4)}`;
    const connection = await dbPool.getConnection();

    try {
      await connection.beginTransaction();

      const [rows] = await connection.query<
        Array<RowDataPacket & { id: number; cashRegisterId: number; terminalName: string | null; createdBy: number; registerName: string; isActive: number }>
      >(
        `SELECT p.id, p.cash_register_id AS cashRegisterId, p.terminal_name AS terminalName, p.created_by AS createdBy,
                reg.name AS registerName, reg.is_active AS isActive
         FROM cash_terminal_pairings p
         INNER JOIN cash_registers reg ON reg.id = p.cash_register_id
         WHERE p.company_id = ? AND p.code_hash = ? AND p.used_at IS NULL AND p.expires_at > CURRENT_TIMESTAMP
         LIMIT 1
         FOR UPDATE`,
        [companyId, this.hashToken(normalizedCode)]
      );

      const pairing = rows[0];

      if (!pairing) {
        throw new AppError("El código no es válido o ya venció. Pide uno nuevo al administrador.", 400);
      }

      if (!pairing.isActive) {
        throw new AppError("La caja de este código está inactiva.", 400);
      }

      // Con redes autorizadas para esa caja, el código solo se canjea desde ellas.
      await this.assertNetworkAllows(companyId, clientIp, pairing.cashRegisterId);
      await this.assertRegisterWithoutTerminal(connection, companyId, pairing.cashRegisterId);

      const token = randomBytes(32).toString("base64url");
      const name = normalize(payload.name) ?? pairing.terminalName ?? `Equipo ${pairing.registerName}`;

      // Queda registrado por el administrador que generó el código (quien lo autorizó).
      const [result] = await connection.execute<ResultSetHeader>(
        `INSERT INTO cash_terminals (company_id, cash_register_id, name, token_hash, registered_by, registered_ip, last_ip)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [companyId, pairing.cashRegisterId, name, this.hashToken(token), pairing.createdBy, ip, ip]
      );

      await connection.execute(
        "UPDATE cash_terminal_pairings SET used_at = CURRENT_TIMESTAMP, used_terminal_id = ? WHERE id = ?",
        [result.insertId, pairing.id]
      );

      await connection.commit();

      return {
        token,
        terminal: { id: result.insertId, name, cashRegisterId: pairing.cashRegisterId, registerName: pairing.registerName }
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Una caja admite UN solo equipo activo. Bloquea la fila de la caja (FOR UPDATE) dentro
   * de la transacción del llamador, así dos registros simultáneos no pasan los dos.
   */
  private async assertRegisterWithoutTerminal(executor: DbConnection, companyId: number, registerId: number, exceptTerminalId?: number) {
    const [registers] = await executor.query<Array<RowDataPacket & { name: string }>>(
      "SELECT name FROM cash_registers WHERE company_id = ? AND id = ? FOR UPDATE",
      [companyId, registerId]
    );
    const [rows] = await executor.query<Array<RowDataPacket & { name: string }>>(
      "SELECT name FROM cash_terminals WHERE company_id = ? AND cash_register_id = ? AND is_active = 1 AND id <> ? LIMIT 1",
      [companyId, registerId, exceptTerminalId ?? 0]
    );

    if (rows[0]) {
      throw new AppError(
        `La caja "${registers[0]?.name ?? ""}" ya tiene registrado el equipo "${rows[0].name}". Cada caja admite un solo equipo: quita ese registro en Registro de cajas antes de registrar otro.`,
        409
      );
    }
  }

  /** ¿La caja ya tiene su equipo? (sin bloqueo; para avisos y la caja única). */
  private async registerHasTerminal(executor: DbConnection | typeof dbPool, companyId: number, registerId: number) {
    const [rows] = await executor.query<Array<RowDataPacket & { id: number }>>(
      "SELECT id FROM cash_terminals WHERE company_id = ? AND cash_register_id = ? AND is_active = 1 LIMIT 1",
      [companyId, registerId]
    );
    return Boolean(rows[0]);
  }

  /** Ejecuta `work` en una transacción propia. */
  private async inTransaction<T>(work: (connection: DbConnection) => Promise<T>) {
    const connection = await dbPool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await work(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  /** IP de un equipo: una sola dirección (sin prefijo de red), en forma canónica. */
  private parseTerminalIp(input: string) {
    const invalid = new AppError("Escribe la IP de la PC (una sola dirección, sin /), por ejemplo 192.168.1.30.", 400);

    if (input.includes("/")) {
      throw invalid;
    }

    try {
      return parseCidr(input).address;
    } catch {
      throw invalid;
    }
  }

  private async assertIpFree(companyId: number, ip: string, exceptId?: number) {
    const [rows] = await dbPool.query<Array<RowDataPacket & { name: string; registerName: string }>>(
      `SELECT t.name, reg.name AS registerName
       FROM cash_terminals t INNER JOIN cash_registers reg ON reg.id = t.cash_register_id
       WHERE t.company_id = ? AND t.bound_ip = ? AND t.is_active = 1 AND t.id <> ?
       LIMIT 1`,
      [companyId, ip, exceptId ?? 0]
    );

    if (rows[0]) {
      throw new AppError(`La IP ${ip} ya está asignada al equipo "${rows[0].name}" (${rows[0].registerName}).`, 409);
    }
  }

  /**
   * Habilita una caja para la PC con esa IP (sin código ni registro en el
   * navegador). La PC debe tener IP fija; si cambia, se edita aquí.
   */
  async registerTerminalByIp(companyId: number, userId: number, payload: { cashRegisterId: number; name: string; ip: string }) {
    const register = await this.assertActiveRegister(companyId, payload.cashRegisterId);
    const ip = this.parseTerminalIp(payload.ip);
    await this.assertIpFree(companyId, ip);

    const [result] = await this.inTransaction(async (connection) => {
      await this.assertRegisterWithoutTerminal(connection, companyId, register.id);
      return connection.execute<ResultSetHeader>(
        `INSERT INTO cash_terminals (company_id, cash_register_id, name, token_hash, bound_ip, registered_by, registered_ip)
         VALUES (?, ?, ?, NULL, ?, ?, ?)`,
        [companyId, register.id, payload.name.trim(), ip, userId, ip]
      );
    });

    return { terminal: { id: result.insertId, name: payload.name.trim(), cashRegisterId: register.id, registerName: register.name, boundIp: ip } };
  }

  /** Elimina un equipo ya revocado (primero se revoca, luego se puede eliminar). */
  async deleteTerminal(companyId: number, id: number) {
    const [rows] = await dbPool.query<Array<RowDataPacket & { name: string; isActive: number }>>(
      "SELECT name, is_active AS isActive FROM cash_terminals WHERE company_id = ? AND id = ? LIMIT 1",
      [companyId, id]
    );

    const terminal = rows[0];

    if (!terminal) {
      throw new AppError("Equipo no encontrado para la empresa activa.", 404);
    }

    if (terminal.isActive) {
      throw new AppError("Revoca el equipo antes de eliminarlo.", 409);
    }

    await dbPool.execute("DELETE FROM cash_terminals WHERE company_id = ? AND id = ?", [companyId, id]);

    return { name: terminal.name, items: await this.listTerminals(companyId) };
  }

  /** Mover a otra caja, renombrar, cambiar la IP asignada o revocar (isActive=false) un equipo. */
  async updateTerminal(
    companyId: number,
    id: number,
    payload: { cashRegisterId?: number; name?: string; isActive?: boolean; boundIp?: string }
  ) {
    const fields: string[] = [];
    const params: Array<string | number> = [];

    if (payload.boundIp !== undefined) {
      const ip = this.parseTerminalIp(payload.boundIp);
      await this.assertIpFree(companyId, ip, id);
      fields.push("bound_ip = ?");
      params.push(ip);
    }

    if (payload.cashRegisterId !== undefined) {
      await this.assertActiveRegister(companyId, payload.cashRegisterId);
      fields.push("cash_register_id = ?");
      params.push(payload.cashRegisterId);
    }

    if (payload.name !== undefined) {
      fields.push("name = ?");
      params.push(payload.name.trim());
    }

    if (payload.isActive !== undefined) {
      fields.push("is_active = ?");
      params.push(payload.isActive ? 1 : 0);
    }

    if (fields.length > 0) {
      const [result] = await this.inTransaction(async (connection) => {
        // Pasa a otra caja o vuelve a quedar activo: esa caja no debe tener otro equipo.
        if (payload.cashRegisterId !== undefined || payload.isActive === true) {
          const [rows] = await connection.query<Array<RowDataPacket & { cashRegisterId: number; isActive: number }>>(
            "SELECT cash_register_id AS cashRegisterId, is_active AS isActive FROM cash_terminals WHERE company_id = ? AND id = ?",
            [companyId, id]
          );
          const current = rows[0];
          const becomesActive = payload.isActive ?? Boolean(current?.isActive);
          if (current && becomesActive) {
            await this.assertRegisterWithoutTerminal(connection, companyId, payload.cashRegisterId ?? current.cashRegisterId, id);
          }
        }
        return connection.execute<ResultSetHeader>(`UPDATE cash_terminals SET ${fields.join(", ")} WHERE company_id = ? AND id = ?`, [
          ...params,
          companyId,
          id
        ]);
      });

      if (result.affectedRows === 0) {
        throw new AppError("Equipo no encontrado para la empresa activa.", 404);
      }
    }

    return this.listTerminals(companyId);
  }

  // -------- Resolución de caja por contexto --------

  private async activeRegisters(companyId: number, executor: DbConnection | typeof dbPool = dbPool) {
    const [rows] = await executor.query<RegisterRow[]>(
      "SELECT id, name, is_active AS isActive FROM cash_registers WHERE company_id = ? AND is_active = 1",
      [companyId]
    );

    return rows;
  }

  /**
   * Caja física que corresponde a la petición:
   *   1. caja.manage + cashSessionId explícito (el administrador elige a mano)
   *   2. la caja del equipo registrado
   *   3. la única caja activa de la empresa (instalaciones de una sola caja)
   * Con varias cajas y un equipo sin registrar no hay caja: se devuelve el motivo.
   */
  private async targetRegister(
    companyId: number,
    context: CashContext,
    cashSessionId: number | undefined,
    executor: DbConnection | typeof dbPool
  ): Promise<{ registerId: number; registerName: string; sessionId?: number } | { blockedReason: string }> {
    if (context.canManage && cashSessionId) {
      const [rows] = await executor.query<Array<RowDataPacket & { cashRegisterId: number; registerName: string }>>(
        `SELECT s.cash_register_id AS cashRegisterId, reg.name AS registerName
         FROM cash_sessions s INNER JOIN cash_registers reg ON reg.id = s.cash_register_id
         WHERE s.company_id = ? AND s.id = ? LIMIT 1`,
        [companyId, cashSessionId]
      );

      if (rows[0]) {
        return { registerId: rows[0].cashRegisterId, registerName: rows[0].registerName, sessionId: cashSessionId };
      }
    }

    if (context.terminal) {
      return { registerId: context.terminal.cashRegisterId, registerName: context.terminal.registerName };
    }

    const registers = await this.activeRegisters(companyId, executor);

    // Caja única sin equipo asignado: la usa cualquier PC (instalaciones de una sola caja).
    // Si ya tiene su equipo, las demás PCs no la usan.
    if (registers.length === 1 && !(await this.registerHasTerminal(executor, companyId, registers[0]!.id))) {
      return { registerId: registers[0]!.id, registerName: registers[0]!.name };
    }

    return {
      blockedReason: context.terminalStatus === "network" ? outsideNetworkMessage(context.clientIp) : UNREGISTERED_MESSAGE
    };
  }

  private async findOpenSessionId(executor: DbConnection | typeof dbPool, companyId: number, registerId: number) {
    const [rows] = await executor.query<Array<RowDataPacket & { id: number }>>(
      "SELECT id FROM cash_sessions WHERE company_id = ? AND cash_register_id = ? AND status = 'ABIERTA' LIMIT 1",
      [companyId, registerId]
    );

    return rows[0]?.id ?? null;
  }

  /**
   * Resuelve y BLOQUEA (LOCK IN SHARE MODE: válido en MySQL 8 y MariaDB) la sesión abierta para una operación que mueve
   * dinero (venta, abono, pago), dentro de la transacción del llamador.
   *
   * El bloqueo compartido permite ventas simultáneas en la misma caja, pero hace
   * que un cierre (FOR UPDATE) espere a que terminen; y una venta que llega después
   * del cierre encuentra la sesión CERRADA y se rechaza. Así ningún movimiento cae
   * en una caja ya cerrada ni queda fuera del arqueo, aunque haya varios backends
   * contra la misma base de datos.
   *
   * required=true lanza 409 si no hay caja utilizable; si no, devuelve null.
   */
  async lockSessionForOperation(
    connection: DbConnection,
    companyId: number,
    context: CashContext,
    options: { required: boolean; cashSessionId?: number }
  ) {
    const target = await this.targetRegister(companyId, context, options.cashSessionId, connection);

    if ("blockedReason" in target) {
      if (options.required) {
        throw new AppError(target.blockedReason, 409);
      }
      return null;
    }

    // Dos intentos: si entre la búsqueda y el bloqueo la sesión se cerró y se abrió
    // otra, el segundo intento toma la nueva.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const sessionId = target.sessionId ?? (await this.findOpenSessionId(connection, companyId, target.registerId));

      if (!sessionId) {
        break;
      }

      const [rows] = await connection.query<Array<RowDataPacket & { id: number; status: string }>>(
        "SELECT id, status FROM cash_sessions WHERE company_id = ? AND id = ? LOCK IN SHARE MODE",
        [companyId, sessionId]
      );

      if (rows[0]?.status === "ABIERTA") {
        return { id: rows[0].id, cashRegisterId: target.registerId, registerName: target.registerName };
      }

      if (target.sessionId) {
        break;
      }
    }

    if (options.required) {
      throw new AppError(`La caja "${target.registerName}" está cerrada. Ábrela para continuar.`, 409);
    }

    return null;
  }

  /** Vista previa (sin bloqueo) de la caja que usaría una venta desde este equipo. */
  async previewSaleSession(companyId: number, context: CashContext) {
    const target = await this.targetRegister(companyId, context, undefined, dbPool);

    if ("blockedReason" in target) {
      return { session: null, blockedReason: target.blockedReason };
    }

    const sessionId = await this.findOpenSessionId(dbPool, companyId, target.registerId);

    if (!sessionId) {
      return {
        session: null,
        blockedReason: `La caja "${target.registerName}" está cerrada. Ábrela para poder facturar.`
      };
    }

    return { session: { id: sessionId, cashRegisterId: target.registerId, registerName: target.registerName }, blockedReason: null };
  }

  /**
   * ¿Puede este equipo/usuario abrir, cerrar o mover dinero en esa caja?
   * caja.manage: cualquiera. Equipo registrado: solo su caja. Sin registro: solo
   * si la empresa tiene una única caja activa.
   */
  private async canOperateRegister(companyId: number, context: CashContext, registerId: number) {
    if (context.canManage) {
      return true;
    }

    if (context.terminal) {
      return context.terminal.cashRegisterId === registerId;
    }

    const registers = await this.activeRegisters(companyId);
    return registers.length === 1 && registers[0]!.id === registerId && !(await this.registerHasTerminal(dbPool, companyId, registerId));
  }

  private async assertCanOperateRegister(companyId: number, context: CashContext, registerId: number) {
    if (await this.canOperateRegister(companyId, context, registerId)) {
      return;
    }

    throw new AppError(
      context.terminal
        ? `Este equipo está asignado a "${context.terminal.registerName}"; solo puede operar esa caja.`
        : context.terminalStatus === "network"
          ? outsideNetworkMessage(context.clientIp)
          : UNREGISTERED_MESSAGE,
      403
    );
  }

  // -------- Apertura / cierre / movimientos --------

  async open(
    companyId: number,
    userId: number,
    context: CashContext,
    payload: { cashRegisterId: number; openingAmount?: number; openingBreakdown?: CashBreakdown; notes?: string }
  ) {
    await this.assertActiveRegister(companyId, payload.cashRegisterId);
    await this.assertCanOperateRegister(companyId, context, payload.cashRegisterId);

    const openingAmount = payload.openingBreakdown ? sumBreakdown(payload.openingBreakdown) : round2(payload.openingAmount ?? 0);

    try {
      const [result] = await dbPool.execute<ResultSetHeader>(
        `INSERT INTO cash_sessions (company_id, cash_register_id, opened_by, opening_amount, opening_breakdown, opening_notes)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          companyId,
          payload.cashRegisterId,
          userId,
          openingAmount,
          payload.openingBreakdown ? JSON.stringify(payload.openingBreakdown) : null,
          normalize(payload.notes)
        ]
      );

      return this.getSessionDetail(companyId, result.insertId);
    } catch (error) {
      if ((error as { code?: string }).code === "ER_DUP_ENTRY") {
        throw new AppError("Esa caja ya tiene una sesión abierta. Ciérrala antes de abrir otra.", 409);
      }
      throw error;
    }
  }

  async close(
    companyId: number,
    userId: number,
    context: CashContext,
    payload: { cashSessionId: number; countedAmount?: number; countedBreakdown?: CashBreakdown; notes?: string }
  ) {
    const connection = await dbPool.getConnection();

    try {
      await connection.beginTransaction();

      const [rows] = await connection.query<SessionRow[]>(
        `SELECT s.id, s.cash_register_id AS cashRegisterId, s.opened_by AS openedBy, s.opening_amount AS openingAmount, s.status
         FROM cash_sessions s
         WHERE s.company_id = ? AND s.id = ?
         FOR UPDATE`,
        [companyId, payload.cashSessionId]
      );

      const session = rows[0];

      if (!session) {
        throw new AppError("Sesión de caja no encontrada para la empresa activa.", 404);
      }

      if (session.status === "CERRADA") {
        throw new AppError("La caja ya está cerrada.", 400);
      }

      await this.assertCanOperateRegister(companyId, context, session.cashRegisterId);

      // FOR UPDATE espera a las ventas en curso (bloqueo compartido); a partir de aquí
      // ningún movimiento nuevo entra en esta sesión hasta el commit.
      const [movements] = await connection.query<MovementRow[]>(
        "SELECT type, method, direction, amount FROM cash_movements WHERE company_id = ? AND session_id = ?",
        [companyId, session.id]
      );

      const summary = this.buildSummary(
        Number(session.openingAmount),
        movements.map((row) => ({ type: row.type, method: row.method, direction: row.direction, amount: Number(row.amount) }))
      );

      const counted = payload.countedBreakdown ? sumBreakdown(payload.countedBreakdown) : round2(payload.countedAmount ?? 0);
      const difference = round2(counted - summary.expectedCash);

      await connection.execute(
        `UPDATE cash_sessions
         SET status = 'CERRADA', closed_by = ?, closed_at = CURRENT_TIMESTAMP,
             counted_amount = ?, expected_amount = ?, difference = ?, closing_breakdown = ?, closing_notes = ?
         WHERE id = ?`,
        [
          userId,
          counted,
          summary.expectedCash,
          difference,
          payload.countedBreakdown ? JSON.stringify(payload.countedBreakdown) : null,
          normalize(payload.notes),
          session.id
        ]
      );

      await connection.commit();

      return this.getSessionDetail(companyId, session.id);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async addManualMovement(
    companyId: number,
    userId: number,
    context: CashContext,
    payload: { cashSessionId: number; type: "INGRESO" | "EGRESO" | "RETIRO"; method: CashMethod; amount: number; description?: string }
  ) {
    const connection = await dbPool.getConnection();

    try {
      await connection.beginTransaction();

      const [rows] = await connection.query<SessionRow[]>(
        "SELECT id, cash_register_id AS cashRegisterId, opened_by AS openedBy, status FROM cash_sessions WHERE company_id = ? AND id = ? LOCK IN SHARE MODE",
        [companyId, payload.cashSessionId]
      );

      const session = rows[0];

      if (!session) {
        throw new AppError("Sesión de caja no encontrada para la empresa activa.", 404);
      }

      if (session.status !== "ABIERTA") {
        throw new AppError("La caja está cerrada.", 400);
      }

      await this.assertCanOperateRegister(companyId, context, session.cashRegisterId);

      await this.recordMovement(connection, {
        companyId,
        sessionId: session.id,
        userId,
        type: payload.type,
        method: payload.method,
        amount: payload.amount,
        description: payload.description
      });

      await connection.commit();

      return this.getSessionDetail(companyId, session.id);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  // -------- Vistas --------

  /** Panorama de cajas: cada caja activa con su sesión abierta (si la hay) y resumen ligero. */
  async overview(companyId: number, context: CashContext) {
    // Garantiza que la empresa siempre tenga al menos una caja (ej. empresas nuevas).
    const existing = await this.listRegisters(companyId, true);
    if (existing.length === 0) {
      try {
        await this.createRegister(companyId, "Caja principal");
      } catch {
        // Otra petición pudo crearla en paralelo; se ignora el duplicado.
      }
    }

    const registers = await this.listRegisters(companyId, false);

    const [openRows] = await dbPool.query<SessionRow[]>(
      `SELECT ${SESSION_COLUMNS} ${SESSION_JOINS} WHERE s.company_id = ? AND s.status = 'ABIERTA'`,
      [companyId]
    );
    const openSessions = openRows.map((row) => this.mapSession(row));

    // Resumen de efectivo por sesión abierta en una sola consulta.
    const cashBySession = new Map<number, { cashIn: number; cashOut: number }>();
    if (openSessions.length > 0) {
      const ids = openSessions.map((session) => session.id);
      const placeholders = ids.map(() => "?").join(", ");
      const [cashRows] = await dbPool.query<Array<RowDataPacket & { sessionId: number; cashIn: number; cashOut: number }>>(
        `SELECT
          session_id AS sessionId,
          COALESCE(SUM(CASE WHEN method = 'EFECTIVO' AND direction = 'IN' THEN amount ELSE 0 END), 0) AS cashIn,
          COALESCE(SUM(CASE WHEN method = 'EFECTIVO' AND direction = 'OUT' THEN amount ELSE 0 END), 0) AS cashOut
        FROM cash_movements
        WHERE company_id = ? AND session_id IN (${placeholders})
        GROUP BY session_id`,
        [companyId, ...ids]
      );

      for (const row of cashRows) {
        cashBySession.set(row.sessionId, { cashIn: Number(row.cashIn), cashOut: Number(row.cashOut) });
      }
    }

    const sessionByRegister = new Map(openSessions.map((session) => [session.cashRegisterId, session]));
    const operable = new Set<number>();
    for (const register of registers) {
      if (await this.canOperateRegister(companyId, context, register.id)) {
        operable.add(register.id);
      }
    }
    const sale = await this.previewSaleSession(companyId, context);

    return {
      registers: registers.map((register) => {
        const session = sessionByRegister.get(register.id) ?? null;
        const cash = session ? cashBySession.get(session.id) ?? { cashIn: 0, cashOut: 0 } : null;
        const expectedCash = session && cash ? round2(session.openingAmount + cash.cashIn - cash.cashOut) : null;

        return {
          id: register.id,
          name: register.name,
          isActive: register.isActive,
          session,
          summary: session && cash ? { cashIn: cash.cashIn, cashOut: cash.cashOut, expectedCash: expectedCash ?? 0 } : null,
          // Abrir/cerrar/mover desde este equipo (su caja, o cualquiera con caja.manage).
          canOperate: operable.has(register.id),
          canClose: Boolean(session) && operable.has(register.id)
        };
      }),
      denominations: CASH_DENOMINATIONS,
      terminal: context.terminal,
      terminalStatus: context.terminalStatus,
      clientIp: normalizeIp(context.clientIp),
      canManage: context.canManage,
      saleSession: sale.session,
      saleBlockedReason: sale.blockedReason
    };
  }

  async getSessionDetail(companyId: number, sessionId: number) {
    const [rows] = await dbPool.query<SessionRow[]>(
      `SELECT ${SESSION_COLUMNS} ${SESSION_JOINS} WHERE s.company_id = ? AND s.id = ? LIMIT 1`,
      [companyId, sessionId]
    );

    const row = rows[0];

    if (!row) {
      throw new AppError("Sesión de caja no encontrada para la empresa activa.", 404);
    }

    const session = this.mapSession(row);
    const movements = await this.listMovements(companyId, sessionId);
    const summary = this.buildSummary(session.openingAmount, movements);

    return { session, movements, summary };
  }

  async listSessions(
    companyId: number,
    query: {
      status?: "ABIERTA" | "CERRADA" | "all";
      cashRegisterId?: number;
      dateFrom?: string;
      dateTo?: string;
      page?: number;
      pageSize?: number;
    }
  ) {
    const pagination = resolvePagination(query.page, query.pageSize);
    const params: Array<string | number> = [companyId];
    const conditions = ["s.company_id = ?"];

    if (query.status && query.status !== "all") {
      conditions.push("s.status = ?");
      params.push(query.status);
    }

    if (query.cashRegisterId) {
      conditions.push("s.cash_register_id = ?");
      params.push(query.cashRegisterId);
    }

    if (query.dateFrom) {
      conditions.push("DATE(s.opened_at) >= ?");
      params.push(query.dateFrom);
    }

    if (query.dateTo) {
      conditions.push("DATE(s.opened_at) <= ?");
      params.push(query.dateTo);
    }

    const whereClause = conditions.join(" AND ");
    const [rows] = await dbPool.query<SessionRow[]>(
      `SELECT ${SESSION_COLUMNS} ${SESSION_JOINS} WHERE ${whereClause} ORDER BY s.opened_at DESC, s.id DESC LIMIT ? OFFSET ?`,
      [...params, pagination.pageSize, pagination.offset]
    );

    const [countRows] = await dbPool.query<Array<RowDataPacket & { total: number }>>(
      `SELECT COUNT(*) AS total FROM cash_sessions s WHERE ${whereClause}`,
      params
    );

    return {
      items: rows.map((row) => this.mapSession(row)),
      pagination: {
        page: pagination.page,
        pageSize: pagination.pageSize,
        total: Number(countRows[0]?.total ?? 0)
      }
    };
  }
}

export const cajaService = new CajaService();
