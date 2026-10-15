import fs from "fs";
import path from "path";

import {
  acquireNamedLock,
  currentDbSettings,
  isDbConnectionError,
  listTables,
  openTestConnection,
  releaseNamedLock,
  runSqlScript,
  type DbClient,
  type DbStandaloneConnection
} from "../../config/db";
import { ENV_FILE, env } from "../../config/env";
import { lostRows, readMigrationInfo, reviewPending, tableRowCounts, type MigrationReview } from "./migration-safety";

/**
 * Migraciones y control de versión entre el programa y la base de datos.
 *
 * Cada motor tiene su carpeta: `migrations/` (MySQL/MariaDB) y `migrations-mssql/`
 * (SQL Server). Durante la transición, una migración nueva se escribe en ambas con
 * el MISMO nombre de archivo; la tabla `_migrations` registra ese nombre.
 *
 * Con varias cajas corriendo su propio programa contra la misma base:
 *   - Pendientes (el programa trae migraciones que la base no tiene): si
 *     DB_AUTO_MIGRATE=true, las aplica UNA sola caja (bloqueo con nombre) y las
 *     registra en _migrations.
 *   - Desconocidas (la base tiene migraciones que este programa no trae): el
 *     programa está desactualizado; se bloquea la operación hasta actualizarlo.
 *
 * Antes de aplicar, migration-safety revisa las pendientes: si alguna puede perder
 * datos, no se aplica ninguna (quedan en `blocked`). Al aplicar, si una tabla pierde
 * filas se detiene (en SQL Server se deshace todo lo de esa vuelta).
 */

const LOCK_NAME = "facturacion:migrations";

const FOLDERS: Record<DbClient, string> = { mysql: "migrations", mssql: "migrations-mssql" };
const BASE_FILES: Record<DbClient, string> = { mysql: "instalacion_completa.sql", mssql: "instalacion_sqlserver.sql" };

export interface SchemaStatus {
  checkedAt: string | null;
  /** Base sin las tablas del sistema (hay que inicializarla). */
  empty: boolean;
  pending: string[];
  /** Migraciones en la base que este programa no conoce (programa desactualizado). */
  unknown: string[];
  /** Pendientes que no se aplicaron porque podrían perder datos (con el motivo). */
  blocked: MigrationReview[];
  /** Pendientes centrales (sin @funcion): mientras falten, el sistema queda bloqueado. */
  corePending: string[];
  /** Funciones desactivadas porque falta su actualización (el resto del sistema sigue). */
  features: PendingFeature[];
  error: string | null;
}

export interface PendingFeature {
  name: string;
  /** Rutas de la API que se rechazan mientras falte (p. ej. /banks). */
  routes: string[];
  /** Pantallas que muestran el aviso en lugar de su contenido (p. ej. /banks). */
  screens: string[];
  files: string[];
}

let status: SchemaStatus = { checkedAt: null, empty: false, pending: [], unknown: [], blocked: [], corePending: [], features: [], error: null };

/** Separa las pendientes en centrales y en funciones que se pueden desactivar. */
function classifyPending(client: DbClient, pending: string[]) {
  const dir = migrationsDir(client);
  const corePending: string[] = [];
  const features = new Map<string, PendingFeature>();
  for (const file of pending) {
    const feature = dir ? readMigrationInfo(dir, file).feature : null;
    if (!feature || feature.routes.length === 0) {
      corePending.push(file);
      continue;
    }
    const current = features.get(feature.name) ?? { name: feature.name, routes: [], screens: [], files: [] };
    current.routes = [...new Set([...current.routes, ...feature.routes])];
    current.screens = [...new Set([...current.screens, ...feature.screens])];
    current.files.push(file);
    features.set(feature.name, current);
  }
  return { corePending, features: [...features.values()] };
}
/** La última revisión falló por no poder conectarse (no por un error de las migraciones). */
let lostConnection = false;

export function schemaStatus() {
  return status;
}

export function migrationsDir(client: DbClient = currentDbSettings().client) {
  const folder = FOLDERS[client];
  const candidates = [
    ...(env.MIGRATIONS_DIR ? [path.resolve(env.MIGRATIONS_DIR, "..", folder), path.resolve(env.MIGRATIONS_DIR)] : []),
    path.resolve(path.dirname(ENV_FILE), folder),
    path.resolve(__dirname, "../../../../..", folder),
    path.resolve(process.cwd(), folder),
    path.resolve(process.cwd(), "../..", folder)
  ];
  return candidates.find((candidate) => fs.existsSync(candidate) && path.basename(candidate) === folder) ?? null;
}

export function migrationFiles(client: DbClient = currentDbSettings().client) {
  const dir = migrationsDir(client);
  return dir ? fs.readdirSync(dir).filter((file) => file.endsWith(".sql")).sort() : [];
}

/**
 * Instalación completa (todas las tablas, catálogos y el primer usuario) para
 * una base vacía. Se genera con `npm run db:install-sql` (MySQL) o
 * `npm run db:mssql-sql` (SQL Server), en el workspace backend.
 */
export function baseInstallFile(client: DbClient = currentDbSettings().client) {
  const dir = migrationsDir(client);
  const file = dir ? path.join(dir, "base", BASE_FILES[client]) : null;
  return file && fs.existsSync(file) ? file : null;
}

/** Migraciones que la instalación completa ya incluye (líneas "@incluye archivo.sql"). */
function baseIncludedMigrations(client: DbClient) {
  const file = baseInstallFile(client);
  if (!file) {
    return [];
  }
  return [...fs.readFileSync(file, "utf8").matchAll(/@incluye\s+(\S+\.sql)/g)].map((match) => match[1]!);
}

/** Quita "USE otra_base;": la migración se aplica en la base configurada, sea cual sea su nombre. */
function prepareSql(sql: string) {
  return sql.replace(/^\s*USE\s+[`[\]\w]+\s*;?\s*$/gim, "");
}

async function withMigrationLock<T>(connection: DbStandaloneConnection, client: DbClient, work: () => Promise<T>) {
  if (!(await acquireNamedLock(connection, LOCK_NAME, 120, client))) {
    throw new Error("Otra caja está actualizando la base de datos. Intenta de nuevo en un momento.");
  }

  try {
    const result = await work();
    await releaseNamedLock(connection, LOCK_NAME, client);
    return result;
  } catch (error) {
    // SQL Server: el bloqueo vive en una transacción; al fallar se revierte todo lo de esa vuelta.
    if (client === "mssql") {
      await connection.rollback();
    } else {
      await releaseNamedLock(connection, LOCK_NAME, client).catch(() => undefined);
    }
    throw error;
  }
}

/**
 * Instala el sistema completo en una base SIN tablas. Usa el mismo bloqueo que
 * las migraciones (una sola caja).
 */
export async function installBase(connection: DbStandaloneConnection, client: DbClient = currentDbSettings().client) {
  const file = baseInstallFile(client);
  if (!file) {
    throw new Error("Esta instalación no incluye el archivo para preparar una base nueva.");
  }

  await withMigrationLock(connection, client, async () => {
    if ((await listTables(connection, client)).size > 0) {
      throw new Error("La base de datos no está vacía: solo se puede preparar una base nueva sin tablas.");
    }

    console.log("[migraciones] Preparando base nueva con la instalación completa...");
    await runSqlScript(connection, prepareSql(fs.readFileSync(file, "utf8")), client);
  });
}

/**
 * Revisa la base y, si corresponde, aplica las migraciones pendientes.
 * `apply`: por defecto DB_AUTO_MIGRATE.
 */
export async function checkSchema(apply = env.DB_AUTO_MIGRATE === "true"): Promise<SchemaStatus> {
  const settings = currentDbSettings();
  const client = settings.client;
  const files = migrationFiles(client);
  let connection: DbStandaloneConnection | null = null;

  try {
    connection = await openTestConnection(settings, { multipleStatements: true });
    const conn = connection;

    let names = await listTables(conn, client);

    // Base totalmente vacía: se prepara con la instalación completa (si está permitido).
    if (apply && names.size === 0 && baseInstallFile(client)) {
      await installBase(conn, client);
      names = await listTables(conn, client);
    }

    if (!names.has("users") || !names.has("companies")) {
      status = { checkedAt: new Date().toISOString(), empty: true, pending: files, unknown: [], blocked: [], corePending: files, features: [], error: null };
      return status;
    }

    if (!names.has("_migrations")) {
      await conn.query(
        client === "mssql"
          ? `CREATE TABLE _migrations (
              id INT IDENTITY(1,1) CONSTRAINT PK__migrations PRIMARY KEY,
              filename NVARCHAR(255) NOT NULL CONSTRAINT UQ__migrations_filename UNIQUE,
              executed_at DATETIME2(0) NOT NULL CONSTRAINT DF__migrations_executed_at DEFAULT SYSUTCDATETIME()
            )`
          : `CREATE TABLE IF NOT EXISTS _migrations (
              id INT AUTO_INCREMENT PRIMARY KEY,
              filename VARCHAR(255) NOT NULL UNIQUE,
              executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`
      );
    }

    const readApplied = async () => {
      const [rows] = await conn.query<Array<{ filename: string }>>("SELECT filename FROM _migrations");
      return new Set(rows.map((row) => row.filename));
    };

    let applied = await readApplied();
    let pending = files.filter((file) => !applied.has(file));
    let blocked: MigrationReview[] = [];

    if (apply && pending.length > 0) {
      await withMigrationLock(conn, client, async () => {
        // Otra caja pudo aplicarlas mientras esperábamos el bloqueo.
        applied = await readApplied();
        pending = files.filter((file) => !applied.has(file));
        if (pending.length === 0) return;

        // Solo si NINGUNA puede perder datos.
        blocked = (await reviewPending(conn, client, migrationsDir(client)!, pending)).filter((review) => review.problems.length > 0);
        if (blocked.length > 0) {
          console.warn("[migraciones] No se aplican: podrían perder datos.", blocked.map((review) => `${review.file}: ${review.problems.join("; ")}`));
          return;
        }

        for (const file of pending) {
          const before = await tableRowCounts(conn, client);
          const sql = prepareSql(fs.readFileSync(path.join(migrationsDir(client)!, file), "utf8"));
          console.log(`[migraciones] Aplicando ${file}...`);
          await runSqlScript(conn, sql, client);
          await conn.query(
            client === "mssql"
              ? "IF NOT EXISTS (SELECT 1 FROM _migrations WHERE filename = ?) INSERT INTO _migrations (filename) VALUES (?)"
              : "INSERT IGNORE INTO _migrations (filename) VALUES (?)",
            client === "mssql" ? [file, file] : [file]
          );
          const lost = lostRows(before, await tableRowCounts(conn, client));
          if (lost.length > 0) {
            throw new Error(`La actualización ${file} se detuvo: estas tablas perdieron filas: ${lost.join(", ")}.`);
          }
        }
      });

      applied = await readApplied();
      pending = files.filter((file) => !applied.has(file));
    }

    // Lo que trae la instalación completa también es conocido (en SQL Server las
    // migraciones anteriores a la instalación solo existen en la carpeta de MySQL).
    const known = new Set([...files, ...baseIncludedMigrations(client)]);
    const unknown = [...applied].filter((file) => !known.has(file)).sort();

    status = { checkedAt: new Date().toISOString(), empty: false, pending, unknown, blocked, ...classifyPending(client, pending), error: null };
    lostConnection = false;
    return status;
  } catch (error) {
    lostConnection = isDbConnectionError(error);
    status = { ...status, checkedAt: new Date().toISOString(), error: (error as Error).message };
    throw error;
  } finally {
    await connection?.end().catch(() => undefined);
  }
}

let recovering = false;

/**
 * Si la última revisión falló por falta de conexión y la base ya responde, se
 * vuelve a revisar (y aplica migraciones si está habilitado) sin reiniciar.
 * Devuelve true si inició esa revisión (o ya hay una en curso).
 */
export function recoverSchemaStatus() {
  if (!lostConnection) {
    return false;
  }
  if (!recovering) {
    recovering = true;
    void checkSchema()
      .catch(() => undefined)
      .finally(() => {
        recovering = false;
      });
  }
  return true;
}

/** Mensaje para bloquear la operación, o null si el programa y la base coinciden. */
export function schemaBlockMessage() {
  if (status.unknown.length > 0) {
    return "Esta aplicación está desactualizada: la base de datos ya tiene una versión más nueva. Actualiza el programa en esta caja.";
  }
  if (status.empty) {
    return "La base de datos no tiene las tablas del sistema.";
  }
  // Solo las pendientes centrales bloquean; las de una función solo desactivan esa función.
  const core = status.corePending;
  if (core.length > 0 && status.blocked.some((review) => core.includes(review.file))) {
    return "La base de datos necesita una actualización que se detuvo para proteger los datos. Un administrador debe revisarla en Sistema > Base de datos.";
  }
  if (core.length > 0) {
    return `La base de datos necesita actualizarse (${core.length} ${core.length === 1 ? "cambio pendiente" : "cambios pendientes"}).`;
  }
  return null;
}

/** Funciones desactivadas mientras falte su actualización de la base. */
export function unavailableFeatures() {
  return status.features;
}

/** Función desactivada a la que pertenece una ruta de la API (/banks/...), o null. */
export function unavailableFeatureForPath(apiPath: string) {
  return status.features.find((feature) => feature.routes.some((route) => apiPath === route || apiPath.startsWith(`${route}/`))) ?? null;
}
