import type { ResultSetHeader, RowDataPacket } from "mysql2";

import { dbPool } from "../../config/db";
import { AppError } from "../../utils/http-error";
import { ALL_PERMISSION_KEYS, isValidPermissionKey, SUPERADMIN_ROLE } from "./permissions.catalog";

interface RoleRow extends RowDataPacket {
  id: number;
  nombre: string;
  descripcion: string | null;
}

/** Cada cuánto se revisa la versión de permisos en la base (ms). */
const VERSION_CHECK_MS = 3000;

class PermissionsService {
  /**
   * Copias en memoria (permisos por rol; rol y estado por usuario). Con varias
   * cajas corriendo su propio programa contra la misma base, se sincronizan con
   * la versión 'permissions' de system_versions: si otra caja cambia permisos o
   * roles, esta lo detecta en máximo VERSION_CHECK_MS y vuelve a leer.
   */
  private cache = new Map<string, Set<string>>();
  private users = new Map<number, { role: string; isActive: boolean }>();
  private knownVersion: number | null = null;
  private lastVersionCheck = 0;

  invalidate() {
    this.cache.clear();
    this.users.clear();
  }

  private async syncVersion() {
    const now = Date.now();

    if (now - this.lastVersionCheck < VERSION_CHECK_MS) {
      return;
    }

    this.lastVersionCheck = now;
    const [rows] = await dbPool.query<Array<RowDataPacket & { version: number }>>(
      "SELECT version FROM system_versions WHERE version_key = 'permissions' LIMIT 1"
    );
    const version = Number(rows[0]?.version ?? 0);

    if (version !== this.knownVersion) {
      this.invalidate();
      this.knownVersion = version;
    }
  }

  /** Avisa a todas las cajas que cambiaron permisos, roles o usuarios. */
  async bumpVersion() {
    const [result] = await dbPool.execute<{ affectedRows: number }>(
      "UPDATE system_versions SET version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE version_key = 'permissions'"
    );
    if (!result.affectedRows) {
      await dbPool
        .execute("INSERT INTO system_versions (version_key, version) VALUES ('permissions', 1)")
        .catch((error: { code?: string }) => {
          // Otra caja la creó al mismo tiempo: ya existe.
          if (error.code !== "ER_DUP_ENTRY") throw error;
        });
    }
    this.invalidate();
    // Fuerza a releer la versión en la próxima consulta.
    this.lastVersionCheck = 0;
  }

  /** Rol y estado actuales del usuario (no los de la sesión, que pueden tener hasta 15 min). */
  async currentUser(userId: number) {
    await this.syncVersion();

    const cached = this.users.get(userId);
    if (cached) {
      return cached;
    }

    const [rows] = await dbPool.query<Array<RowDataPacket & { role: string; isActive: number }>>(
      `SELECT r.nombre AS role, u.is_active AS isActive
       FROM users u INNER JOIN roles r ON r.id = u.role_id
       WHERE u.id = ? LIMIT 1`,
      [userId]
    );

    if (!rows[0]) {
      return null;
    }

    const user = { role: rows[0].role, isActive: Boolean(rows[0].isActive) };
    this.users.set(userId, user);
    return user;
  }

  async getRolePermissions(roleName: string): Promise<Set<string>> {
    if (roleName === SUPERADMIN_ROLE) {
      return new Set(ALL_PERMISSION_KEYS);
    }

    await this.syncVersion();

    const cached = this.cache.get(roleName);

    if (cached) {
      return cached;
    }

    const [rows] = await dbPool.query<Array<RowDataPacket & { permissionKey: string }>>(
      `SELECT rp.permission_key AS permissionKey
       FROM role_permissions rp
       INNER JOIN roles r ON r.id = rp.role_id
       WHERE r.nombre = ?`,
      [roleName]
    );

    const set = new Set(rows.map((row) => row.permissionKey));
    this.cache.set(roleName, set);

    return set;
  }

  async listPermissionsForRole(roleName: string) {
    return Array.from(await this.getRolePermissions(roleName));
  }

  async listRoles() {
    const [roles] = await dbPool.query<RoleRow[]>(
      "SELECT id, nombre, descripcion FROM roles ORDER BY id ASC"
    );

    return Promise.all(
      roles.map(async (role) => ({
        id: role.id,
        name: role.nombre,
        description: role.descripcion,
        isSuperadmin: role.nombre === SUPERADMIN_ROLE,
        permissions: role.nombre === SUPERADMIN_ROLE ? ALL_PERMISSION_KEYS : await this.listPermissionsForRole(role.nombre)
      }))
    );
  }

  private async findRoleOrFail(roleId: number) {
    const [rows] = await dbPool.query<RoleRow[]>("SELECT id, nombre, descripcion FROM roles WHERE id = ? LIMIT 1", [roleId]);
    const role = rows[0];

    if (!role) {
      throw new AppError("Rol no encontrado.", 404);
    }

    return role;
  }

  async setRolePermissions(roleId: number, keys: string[]) {
    const role = await this.findRoleOrFail(roleId);

    if (role.nombre === SUPERADMIN_ROLE) {
      throw new AppError("El rol SUPERADMIN tiene todos los permisos y no se puede modificar.", 400);
    }

    const unique = Array.from(new Set(keys)).filter((key) => isValidPermissionKey(key));

    const connection = await dbPool.getConnection();

    try {
      await connection.beginTransaction();
      await connection.execute("DELETE FROM role_permissions WHERE role_id = ?", [roleId]);

      if (unique.length > 0) {
        const placeholders = unique.map(() => "(?, ?)").join(", ");
        const params = unique.flatMap((key) => [roleId, key]);
        await connection.execute<ResultSetHeader>(
          `INSERT INTO role_permissions (role_id, permission_key) VALUES ${placeholders}`,
          params
        );
      }

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    await this.bumpVersion();

    return {
      id: role.id,
      name: role.nombre,
      description: role.descripcion,
      permissions: unique
    };
  }
}

export const permissionsService = new PermissionsService();
