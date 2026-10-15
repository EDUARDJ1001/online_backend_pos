import bcrypt from "bcryptjs";
import type { RowDataPacket } from "mysql2";

import { dbPool } from "../../config/db";
import { assertLicense } from "../../license/license-runtime";
import { companiesService } from "../companies/companies.service";
import { permissionsService } from "../permissions/permissions.service";
import { AppError } from "../../utils/http-error";
import { signAccessToken, signRefreshToken, verifyRefreshToken, type AuthUserPayload } from "../../utils/auth-tokens";

interface UserRow extends RowDataPacket {
  id: number;
  username: string;
  email: string;
  passwordHash: string;
  fullName: string;
  role: string;
  isActive: number;
}

class AuthService {
  private async findUserByIdentifier(identifier: string) {
    const [rows] = await dbPool.query<UserRow[]>(
      `SELECT
        u.id,
        u.username,
        u.email,
        u.password_hash AS passwordHash,
        u.full_name AS fullName,
        r.nombre AS role,
        u.is_active AS isActive
      FROM users u
      INNER JOIN roles r ON r.id = u.role_id
      WHERE u.username = ? OR u.email = ?
      LIMIT 1`,
      [identifier, identifier]
    );

    return rows[0];
  }

  private toTokenPayload(user: Pick<UserRow, "id" | "username" | "fullName" | "role">): AuthUserPayload {
    return {
      sub: user.id,
      username: user.username,
      fullName: user.fullName,
      role: user.role
    };
  }

  async login(username: string, password: string) {
    await assertLicense();
    const user = await this.findUserByIdentifier(username);

    if (!user || !user.isActive) {
      throw new AppError("Usuario o contraseña incorrectos.", 401);
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);

    if (!passwordMatches) {
      throw new AppError("Usuario o contraseña incorrectos.", 401);
    }

    await dbPool.execute("UPDATE users SET last_login_at = NOW() WHERE id = ?", [user.id]);

    const payload = this.toTokenPayload(user);
    const companies = await companiesService.getUserCompanies(user.id);
    const permissions = Array.from(await permissionsService.getRolePermissions(user.role));

    return {
      accessToken: signAccessToken(payload),
      refreshToken: signRefreshToken(payload),
      user: payload,
      companies,
      permissions
    };
  }

  async refresh(refreshToken: string) {
    let payload: AuthUserPayload;

    try {
      payload = verifyRefreshToken(refreshToken);
    } catch (_error) {
      throw new AppError("El refresh token no es válido o ya expiró.", 401);
    }

    const user = await this.findUserByIdentifier(payload.username);

    if (!user || !user.isActive) {
      throw new AppError("El usuario ya no está disponible.", 401);
    }

    const safePayload = this.toTokenPayload(user);

    return {
      accessToken: signAccessToken(safePayload),
      refreshToken: signRefreshToken(safePayload),
      user: safePayload
    };
  }

  async me(userId: number) {
    const [rows] = await dbPool.query<UserRow[]>(
      `SELECT
        u.id,
        u.username,
        u.email,
        u.password_hash AS passwordHash,
        u.full_name AS fullName,
        r.nombre AS role,
        u.is_active AS isActive
      FROM users u
      INNER JOIN roles r ON r.id = u.role_id
      WHERE u.id = ?
      LIMIT 1`,
      [userId]
    );

    const user = rows[0];

    if (!user || !user.isActive) {
      throw new AppError("El usuario ya no está disponible.", 404);
    }

    const companies = await companiesService.getUserCompanies(userId);
    const permissions = Array.from(await permissionsService.getRolePermissions(user.role));

    return {
      user: this.toTokenPayload(user),
      companies,
      permissions
    };
  }
}

export const authService = new AuthService();
