import type { Request } from "express";
import type { ResultSetHeader } from "mysql2";

import { dbPool, type DbConnection } from "../../config/db";

export interface AuditPayload {
  companyId?: number | null;
  userId?: number | null;
  entityType: string;
  entityId?: number | null;
  action: string;
  description?: string | null;
  oldValues?: unknown;
  newValues?: unknown;
}

class AuditService {
  async log(payload: AuditPayload, req?: Request, connection?: DbConnection) {
    const runner = connection ?? dbPool;

    const [result] = await runner.execute<ResultSetHeader>(
      `INSERT INTO audit_logs
      (company_id, user_id, entity_type, entity_id, action, description, old_values, new_values, ip_address, user_agent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        payload.companyId ?? null,
        payload.userId ?? null,
        payload.entityType,
        payload.entityId ?? null,
        payload.action,
        payload.description ?? null,
        payload.oldValues ? JSON.stringify(payload.oldValues) : null,
        payload.newValues ? JSON.stringify(payload.newValues) : null,
        req?.ip ?? null,
        req?.headers["user-agent"] ?? null
      ]
    );

    return result.insertId;
  }
}

export const auditService = new AuditService();
