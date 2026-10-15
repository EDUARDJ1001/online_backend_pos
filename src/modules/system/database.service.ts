import fs from "fs";
import path from "path";

import {
  currentDbSettings,
  dbPool,
  listTables,
  openTestConnection,
  serverVersion,
  switchDatabase,
  type DbClient,
  type DbExecutor,
  type DbSettings,
  type DbStandaloneConnection
} from "../../config/db";
import { ENV_FILE } from "../../config/env";
import { describeDbConnectionError } from "../../config/db-errors";
import { AppError } from "../../utils/http-error";
import { reviewPending } from "./migration-safety";
import { baseInstallFile, checkSchema, installBase, migrationFiles, migrationsDir } from "./migrations.service";

export interface DatabasePayload {
  /** Motor: MySQL/MariaDB o SQL Server (local o Azure SQL). */
  client?: DbClient;
  host: string;
  port: number;
  database: string;
  user: string;
  /** Vacío = conserva la contraseña actual. */
  password?: string;
  sslMode: "DISABLED" | "REQUIRED";
  /** Certificado CA en texto PEM (opcional). */
  sslCa?: string;
}

/** Valor seguro para una línea KEY=valor de .env. */
function envValue(value: string) {
  if (/^[A-Za-z0-9._\-:/@\\]*$/.test(value)) {
    return value;
  }
  if (!value.includes("'")) {
    return `'${value}'`;
  }
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Cambia valores de config.env (con copia .env.bak). */
export function writeEnv(values: Record<string, string>) {
  const original = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, "utf8") : "";

  if (original) {
    try {
      fs.writeFileSync(`${ENV_FILE}.bak`, original, "utf8");
    } catch {
      // Carpeta de solo lectura (instalación para todos los usuarios): sin copia de respaldo.
    }
  }

  const pending = new Map(Object.entries(values));
  const lines = original.split(/\r?\n/).map((line) => {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=/);
    if (match && pending.has(match[1]!)) {
      const key = match[1]!;
      const next = `${key}=${envValue(pending.get(key)!)}`;
      pending.delete(key);
      return next;
    }
    return line;
  });

  for (const [key, value] of pending) {
    lines.push(`${key}=${envValue(value)}`);
  }

  fs.writeFileSync(ENV_FILE, `${lines.join("\n").replace(/\n+$/, "")}\n`, "utf8");
}

class DatabaseService {
  /** Datos completos a partir del formulario (contraseña vacía = la actual; CA en PEM = se guarda a archivo). */
  private resolveSettings(payload: DatabasePayload): DbSettings {
    const current = currentDbSettings();
    let sslCaPath: string | null = null;

    if (payload.sslMode === "REQUIRED") {
      if (payload.sslCa?.trim()) {
        if (!payload.sslCa.includes("BEGIN CERTIFICATE")) {
          throw new AppError("El certificado CA debe estar en formato PEM (-----BEGIN CERTIFICATE-----).", 400);
        }
        const certsDir = path.join(path.dirname(ENV_FILE), "certs");
        fs.mkdirSync(certsDir, { recursive: true });
        sslCaPath = path.join(certsDir, "db-ca.pem");
        fs.writeFileSync(sslCaPath, `${payload.sslCa.trim()}\n`, "utf8");
      } else if (current.sslMode === "REQUIRED" && current.sslCaPath) {
        // Conserva el certificado ya configurado.
        sslCaPath = current.sslCaPath;
      }
    }

    return {
      client: payload.client ?? current.client,
      host: payload.host.trim(),
      port: payload.port,
      database: payload.database.trim(),
      user: payload.user.trim(),
      password: payload.password ? payload.password : current.password,
      sslMode: payload.sslMode,
      sslCaPath
    };
  }

  /** Versión, si tiene el esquema del sistema y cuántas migraciones le faltan. */
  private async inspect(connection: DbExecutor, client: DbClient) {
    const version = await serverVersion(connection, client);
    const names = await listTables(connection, client);
    const hasSchema = names.has("users") && names.has("companies");

    let applied: string[] = [];
    if (names.has("_migrations")) {
      const [rows] = await connection.query<Array<{ filename: string }>>("SELECT filename FROM _migrations");
      applied = rows.map((row) => row.filename);
    }

    const files = migrationFiles(client);
    const pending = names.has("_migrations") ? files.filter((file) => !applied.includes(file)) : files;

    return {
      client,
      version,
      tables: names.size,
      hasSchema,
      /** Base sin ninguna tabla: se puede preparar con la instalación completa. */
      canInitialize: names.size === 0 && baseInstallFile(client) !== null,
      migrationsTracked: names.has("_migrations"),
      pendingMigrations: hasSchema ? pending : files
    };
  }

  private describe(settings: DbSettings) {
    return {
      client: settings.client,
      host: settings.host,
      port: settings.port,
      database: settings.database,
      user: settings.user,
      sslMode: settings.sslMode,
      hasSslCa: settings.sslMode === "REQUIRED" && Boolean(settings.sslCaPath),
      hasPassword: settings.password.length > 0
    };
  }

  /** Conexión configurada, sin la contraseña. */
  currentSettings() {
    return this.describe(currentDbSettings());
  }

  async status() {
    const settings = currentDbSettings();

    try {
      const check = await this.inspect(dbPool, settings.client);
      // Qué hace cada actualización pendiente y si se puede aplicar sin perder datos.
      const dir = migrationsDir(settings.client);
      const pendingReview =
        check.hasSchema && dir && check.pendingMigrations.length > 0 ? await reviewPending(dbPool, settings.client, dir, check.pendingMigrations) : [];
      return { settings: this.describe(settings), connected: true, ...check, pendingReview, envFile: ENV_FILE };
    } catch (error) {
      return { settings: this.describe(settings), connected: false, error: (error as Error).message, envFile: ENV_FILE };
    }
  }

  /**
   * Aplica las actualizaciones pendientes de la base conectada, solo si ninguna puede
   * perder datos (migrations.service + migration-safety). Devuelve lo aplicado y lo que
   * quedó detenido con su motivo.
   */
  async migrate() {
    const before = await checkSchema(false);
    if (before.empty) {
      throw new AppError("La base no tiene el sistema instalado.", 400);
    }
    try {
      const after = await checkSchema(true);
      return { applied: before.pending.filter((file) => !after.pending.includes(file)), pending: after.pending, blocked: after.blocked };
    } catch (error) {
      const message = (error as Error).message;
      // Caja con el usuario limitado de la base: no puede cambiar la estructura.
      if (/denied|permission|permiso|ER_TABLEACCESS|ER_DBACCESS|ER_SPECIFIC_ACCESS/i.test(message)) {
        throw new AppError(
          "El usuario de la base de esta caja no tiene permiso para actualizarla. La actualización la aplica el administrador de la base desde el gestor de licencias.",
          403
        );
      }
      throw new AppError(`No se pudo actualizar la base: ${message}`, 500);
    }
  }

  /** Prueba los datos sin cambiar la conexión del sistema. */
  async test(payload: DatabasePayload) {
    const settings = this.resolveSettings(payload);
    let connection: DbStandaloneConnection | null = null;

    try {
      connection = await openTestConnection(settings);
      return { ok: true, ...(await this.inspect(connection, settings.client)) };
    } catch (error) {
      console.error("[base de datos] prueba de conexión:", (error as Error).message);
      throw new AppError(describeDbConnectionError(error, settings), 400);
    } finally {
      await connection?.end().catch(() => undefined);
    }
  }

  /**
   * Cambia la base de datos del sistema en caliente y lo guarda en .env (con copia
   * .env.bak). Exige que la base destino ya tenga el esquema (usuarios, empresas).
   */
  async apply(payload: DatabasePayload & { initialize?: boolean }) {
    const settings = this.resolveSettings(payload);
    let check = await this.test(payload);

    // Base vacía: se prepara con todas las tablas del sistema, si se pidió.
    if (!check.hasSchema && check.canInitialize && payload.initialize) {
      let connection: DbStandaloneConnection | null = null;
      try {
        connection = await openTestConnection(settings, { multipleStatements: true });
        await installBase(connection, settings.client);
      } catch (error) {
        throw new AppError(`No se pudo preparar la base de datos: ${(error as Error).message}`, 400);
      } finally {
        await connection?.end().catch(() => undefined);
      }
      check = await this.test(payload);
    }

    if (!check.hasSchema) {
      throw new AppError(
        check.canInitialize
          ? "La base de datos está vacía. Confirma que quieres prepararla para el sistema."
          : "Esa base de datos no tiene el sistema instalado y no está vacía. Usa una base vacía o una que ya tenga el sistema.",
        409
      );
    }

    await switchDatabase(settings);
    // Revisa la versión de la nueva base (y aplica pendientes si está configurado).
    await checkSchema().catch(() => undefined);

    writeEnv({
      DB_CLIENT: settings.client,
      DB_HOST: settings.host,
      DB_PORT: String(settings.port),
      DB_NAME: settings.database,
      DB_USER: settings.user,
      DB_PASSWORD: settings.password,
      DB_SSL_MODE: settings.sslMode,
      DB_SSL_CA_PATH: settings.sslCaPath ?? ""
    });

    return { ...check, settings: this.describe(settings) };
  }
}

export const databaseService = new DatabaseService();
