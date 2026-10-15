import bcrypt from "bcryptjs";
import type { ResultSetHeader, RowDataPacket } from "mysql2";

import { dbPool, withTransaction, type DbConnection } from "../../config/db";
import { resolvePagination } from "../../utils/pagination";
import { AppError } from "../../utils/http-error";
import { permissionsService } from "../permissions/permissions.service";
import { deactivationRules } from "../shared/deactivation-rules";

const BCRYPT_ROUNDS = 10;

export interface UserRow extends RowDataPacket {
  id: number;
  username: string;
  email: string;
  fullName: string;
  roleId: number;
  role: string;
  isActive: number;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface RoleRow extends RowDataPacket {
  id: number;
  nombre: string;
  descripcion: string | null;
}

interface AccessRow extends RowDataPacket {
  userId: number;
  companyId: number;
  companyCode: string;
  companyName: string;
}

interface CountRow extends RowDataPacket {
  total: number;
}

export interface UserDetail {
  id: number;
  username: string;
  email: string;
  fullName: string;
  roleId: number;
  role: string;
  isActive: number;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  companies: Array<{ id: number; code: string; name: string }>;
}

/** Quién ejecuta la acción. Determina qué puede tocar. */
export interface Actor {
  id: number;
  role: string;
}

type UserPayload = {
  username: string;
  email: string;
  fullName: string;
  roleId: number;
  companyIds: number[];
};

const SELECT_USER = `
  SELECT
    u.id,
    u.username,
    u.email,
    u.full_name AS fullName,
    u.role_id AS roleId,
    r.nombre AS role,
    u.is_active AS isActive,
    u.last_login_at AS lastLoginAt,
    u.created_at AS createdAt,
    u.updated_at AS updatedAt
  FROM users u
  INNER JOIN roles r ON r.id = u.role_id`;

function isDuplicateError(error: unknown): error is { code: string; sqlMessage?: string } {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "ER_DUP_ENTRY";
}

class UsersService {
  private isSuperadmin(role: string) {
    return role === "SUPERADMIN";
  }

  /**
   * Un ADMIN no puede ver ni modificar usuarios SUPERADMIN, ni otorgar ese rol:
   * sin esta regla cualquier ADMIN podría promoverse a sí mismo.
   */
  private assertCanManage(actor: Actor, targetRole: string) {
    if (!this.isSuperadmin(actor.role) && this.isSuperadmin(targetRole)) {
      throw new AppError("Solo un SUPERADMIN puede administrar usuarios con ese rol.", 403);
    }
  }

  private async assertRoleAssignable(actor: Actor, roleId: number) {
    const role = await this.findRoleOrFail(roleId);

    if (!this.isSuperadmin(actor.role) && this.isSuperadmin(role.nombre)) {
      throw new AppError("No puedes asignar el rol SUPERADMIN.", 403);
    }

    return role;
  }

  private async findRoleOrFail(roleId: number) {
    const [rows] = await dbPool.query<RoleRow[]>("SELECT id, nombre, descripcion FROM roles WHERE id = ? LIMIT 1", [roleId]);
    const role = rows[0];

    if (!role) {
      throw new AppError("El rol seleccionado no existe.", 400);
    }

    return role;
  }

  /** Impide quedarse sin ningún SUPERADMIN activo en el sistema. */
  private async assertNotLastActiveSuperadmin(userId: number) {
    const [rows] = await dbPool.query<CountRow[]>(
      `SELECT COUNT(*) AS total
       FROM users u
       INNER JOIN roles r ON r.id = u.role_id
       WHERE r.nombre = 'SUPERADMIN' AND u.is_active = 1 AND u.id <> ?`,
      [userId]
    );

    if ((rows[0]?.total ?? 0) === 0) {
      throw new AppError("No puedes dejar el sistema sin ningún SUPERADMIN activo.", 400);
    }
  }

  private async fetchCompanies(userIds: number[]) {
    const map = new Map<number, UserDetail["companies"]>();

    if (userIds.length === 0) {
      return map;
    }

    const placeholders = userIds.map(() => "?").join(", ");
    const [rows] = await dbPool.query<AccessRow[]>(
      `SELECT
        uca.user_id AS userId,
        c.id AS companyId,
        c.code AS companyCode,
        c.commercial_name AS companyName
      FROM user_company_access uca
      INNER JOIN companies c ON c.id = uca.company_id
      WHERE uca.user_id IN (${placeholders})
      ORDER BY c.commercial_name ASC`,
      userIds
    );

    for (const row of rows) {
      const list = map.get(row.userId) ?? [];
      list.push({ id: row.companyId, code: row.companyCode, name: row.companyName });
      map.set(row.userId, list);
    }

    return map;
  }

  private toDetail(row: UserRow, companies: UserDetail["companies"]): UserDetail {
    return {
      id: row.id,
      username: row.username,
      email: row.email,
      fullName: row.fullName,
      roleId: row.roleId,
      role: row.role,
      isActive: row.isActive,
      lastLoginAt: row.lastLoginAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      companies
    };
  }

  async listRoles(actor: Actor) {
    const [rows] = await dbPool.query<RoleRow[]>("SELECT id, nombre, descripcion FROM roles ORDER BY id ASC");

    return rows
      .filter((role) => this.isSuperadmin(actor.role) || !this.isSuperadmin(role.nombre))
      .map((role) => ({ id: role.id, name: role.nombre, description: role.descripcion }));
  }

  /**
   * SUPERADMIN ve todos los usuarios. ADMIN ve solo los que tienen acceso
   * a la empresa activa, y nunca a un SUPERADMIN.
   */
  async list(
    actor: Actor,
    activeCompanyId: number,
    query: { search?: string; status: "active" | "inactive" | "all"; role?: string; page?: number; pageSize?: number }
  ) {
    const pagination = resolvePagination(query.page, query.pageSize);
    const params: Array<string | number> = [];
    const conditions: string[] = ["1 = 1"];

    if (!this.isSuperadmin(actor.role)) {
      conditions.push("r.nombre <> 'SUPERADMIN'");
      conditions.push("EXISTS (SELECT 1 FROM user_company_access uca WHERE uca.user_id = u.id AND uca.company_id = ?)");
      params.push(activeCompanyId);
    }

    if (query.search) {
      conditions.push("(u.username LIKE ? OR u.email LIKE ? OR u.full_name LIKE ?)");
      const search = `%${query.search}%`;
      params.push(search, search, search);
    }

    if (query.status === "active") {
      conditions.push("u.is_active = 1");
    }

    if (query.status === "inactive") {
      conditions.push("u.is_active = 0");
    }

    if (query.role) {
      conditions.push("r.nombre = ?");
      params.push(query.role);
    }

    const whereClause = conditions.join(" AND ");

    const [rows] = await dbPool.query<UserRow[]>(
      `${SELECT_USER}
      WHERE ${whereClause}
      ORDER BY u.id DESC
      LIMIT ? OFFSET ?`,
      [...params, pagination.pageSize, pagination.offset]
    );

    const [countRows] = await dbPool.query<CountRow[]>(
      `SELECT COUNT(*) AS total
       FROM users u
       INNER JOIN roles r ON r.id = u.role_id
       WHERE ${whereClause}`,
      params
    );

    // Una sola consulta para las empresas de toda la página, no una por usuario.
    const companies = await this.fetchCompanies(rows.map((row) => row.id));

    return {
      items: rows.map((row) => this.toDetail(row, companies.get(row.id) ?? [])),
      pagination: {
        page: pagination.page,
        pageSize: pagination.pageSize,
        total: countRows[0]?.total ?? 0
      }
    };
  }

  /** Cuenta cuántos usuarios hay en la papelera, para el aviso de la vista. */
  async countInactive(actor: Actor, activeCompanyId: number) {
    const params: Array<string | number> = [];
    const conditions = ["u.is_active = 0"];

    if (!this.isSuperadmin(actor.role)) {
      conditions.push("r.nombre <> 'SUPERADMIN'");
      conditions.push("EXISTS (SELECT 1 FROM user_company_access uca WHERE uca.user_id = u.id AND uca.company_id = ?)");
      params.push(activeCompanyId);
    }

    const [rows] = await dbPool.query<CountRow[]>(
      `SELECT COUNT(*) AS total
       FROM users u
       INNER JOIN roles r ON r.id = u.role_id
       WHERE ${conditions.join(" AND ")}`,
      params
    );

    return rows[0]?.total ?? 0;
  }

  async findOrFail(actor: Actor, userId: number) {
    const [rows] = await dbPool.query<UserRow[]>(`${SELECT_USER} WHERE u.id = ? LIMIT 1`, [userId]);
    const row = rows[0];

    if (!row) {
      throw new AppError("Usuario no encontrado.", 404);
    }

    this.assertCanManage(actor, row.role);

    const companies = await this.fetchCompanies([row.id]);

    return this.toDetail(row, companies.get(row.id) ?? []);
  }

  /**
   * Valida las empresas solicitadas SIN escribir nada. Se ejecuta antes de
   * cualquier INSERT para que un rechazo no deje un usuario a medio crear.
   */
  private async assertCompaniesAssignable(actor: Actor, companyIds: number[]) {
    const unique = Array.from(new Set(companyIds));

    if (unique.length === 0) {
      return unique;
    }

    const placeholders = unique.map(() => "?").join(", ");
    const [rows] = await dbPool.query<Array<RowDataPacket & { id: number }>>(
      `SELECT id FROM companies WHERE id IN (${placeholders}) AND is_active = 1`,
      unique
    );

    if (rows.length !== unique.length) {
      throw new AppError("Alguna de las empresas seleccionadas no existe o está inactiva.", 400);
    }

    // Un ADMIN solo puede repartir acceso a las empresas donde él mismo trabaja.
    if (!this.isSuperadmin(actor.role)) {
      const [ownRows] = await dbPool.query<Array<RowDataPacket & { companyId: number }>>(
        "SELECT company_id AS companyId FROM user_company_access WHERE user_id = ?",
        [actor.id]
      );
      const own = new Set(ownRows.map((row) => row.companyId));

      if (unique.some((id) => !own.has(id))) {
        throw new AppError("Solo puedes asignar empresas a las que tú tengas acceso.", 403);
      }
    }

    return unique;
  }

  private async replaceCompanyAccess(connection: DbConnection, userId: number, companyIds: number[]) {
    await connection.execute("DELETE FROM user_company_access WHERE user_id = ?", [userId]);

    for (const companyId of companyIds) {
      await connection.execute("INSERT INTO user_company_access (user_id, company_id) VALUES (?, ?)", [userId, companyId]);
    }
  }

  async create(actor: Actor, payload: UserPayload & { password: string }) {
    await this.assertRoleAssignable(actor, payload.roleId);
    const companyIds = await this.assertCompaniesAssignable(actor, payload.companyIds);

    const passwordHash = await bcrypt.hash(payload.password, BCRYPT_ROUNDS);

    try {
      // Usuario y accesos se crean juntos o no se crea ninguno.
      const insertId = await withTransaction(async (connection) => {
        const [result] = await connection.execute<ResultSetHeader>(
          `INSERT INTO users (username, email, password_hash, full_name, role_id, is_active)
           VALUES (?, ?, ?, ?, ?, 1)`,
          [payload.username.trim(), payload.email.trim(), passwordHash, payload.fullName.trim(), payload.roleId]
        );

        await this.replaceCompanyAccess(connection, result.insertId, companyIds);

        return result.insertId;
      });

      return this.findOrFail(actor, insertId);
    } catch (error) {
      if (isDuplicateError(error)) {
        throw new AppError("Ya existe un usuario con ese nombre de usuario o correo.", 409);
      }

      throw error;
    }
  }

  async update(actor: Actor, userId: number, payload: UserPayload) {
    const current = await this.findOrFail(actor, userId);
    const role = await this.assertRoleAssignable(actor, payload.roleId);
    const companyIds = await this.assertCompaniesAssignable(actor, payload.companyIds);

    // Cambiarse el rol a uno mismo es la vía más fácil de perder el acceso sin querer.
    if (actor.id === userId && role.id !== current.roleId) {
      throw new AppError("No puedes cambiar tu propio rol. Pide a otro administrador que lo haga.", 400);
    }

    if (current.role === "SUPERADMIN" && role.nombre !== "SUPERADMIN") {
      await this.assertNotLastActiveSuperadmin(userId);
    }

    try {
      // Datos y accesos cambian juntos: un fallo en los accesos revierte también el rol.
      await withTransaction(async (connection) => {
        await connection.execute(
          `UPDATE users
           SET username = ?, email = ?, full_name = ?, role_id = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [payload.username.trim(), payload.email.trim(), payload.fullName.trim(), payload.roleId, userId]
        );

        await this.replaceCompanyAccess(connection, userId, companyIds);
      });
    } catch (error) {
      if (isDuplicateError(error)) {
        throw new AppError("Ya existe un usuario con ese nombre de usuario o correo.", 409);
      }

      throw error;
    }

    // El rol pudo cambiar: avisa a todas las cajas.
    await permissionsService.bumpVersion();

    return this.findOrFail(actor, userId);
  }

  async updatePassword(actor: Actor, userId: number, password: string) {
    await this.findOrFail(actor, userId);

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    await dbPool.execute("UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [passwordHash, userId]);

    return this.findOrFail(actor, userId);
  }

  /**
   * Borrado lógico: nunca se elimina la fila, solo se apaga `is_active`.
   * Las facturas, movimientos y bitácora creados por el usuario conservan su autor.
   */
  async updateStatus(actor: Actor, userId: number, isActive: boolean) {
    const current = await this.findOrFail(actor, userId);

    if (!isActive) {
      if (actor.id === userId) {
        throw new AppError("No puedes desactivar tu propio usuario.", 400);
      }

      if (current.role === "SUPERADMIN") {
        await this.assertNotLastActiveSuperadmin(userId);
      }

      await deactivationRules.user({ id: userId, fullName: current.fullName });
    }

    await dbPool.execute("UPDATE users SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [isActive ? 1 : 0, userId]);
    // Un usuario desactivado pierde el acceso en todas las cajas en segundos.
    await permissionsService.bumpVersion();

    return this.findOrFail(actor, userId);
  }
}

export const usersService = new UsersService();
