import fs from "fs";
import path from "path";

import mssql from "mssql";
import mysql from "mysql2/promise";

import { env } from "./env";
import { statementKind, toMssql } from "./sql-dialect";

/**
 * Acceso a la base de datos con dos motores: MySQL/MariaDB y SQL Server (local o
 * Azure SQL). Los servicios escriben SQL de MySQL con parámetros `?`; en SQL
 * Server se traduce al vuelo (config/sql-dialect.ts). Lo que no se puede traducir
 * se escribe por motor con `isMssql()`.
 *
 * La forma es la de mysql2: `query/execute` devuelven `[filas, extra]` y, para
 * INSERT/UPDATE/DELETE, `[{ insertId, affectedRows }, extra]`.
 */

export type DbClient = "mysql" | "mssql";

export interface DbExecutor {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query<T = any>(sql: string, params?: unknown[]): Promise<[T, unknown]>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  execute<T = any>(sql: string, params?: unknown[]): Promise<[T, unknown]>;
}

export interface DbConnection extends DbExecutor {
  beginTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  release(): void;
}

export interface DbPool extends DbExecutor {
  getConnection(): Promise<DbConnection>;
  end(): Promise<void>;
}

/** Conexión suelta (pruebas, migraciones): como DbConnection más `end()`. */
export interface DbStandaloneConnection extends DbConnection {
  end(): Promise<void>;
}

export interface DbResultHeader {
  insertId: number;
  affectedRows: number;
}

function resolveCaPath(inputPath?: string) {
  if (!inputPath) {
    return null;
  }

  const candidates = [
    inputPath,
    path.resolve(process.cwd(), inputPath),
    path.resolve(__dirname, "../../../", inputPath),
    path.resolve(__dirname, "../../../../", inputPath),
    path.resolve(__dirname, "../../../../../", inputPath)
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

/** Datos de conexión (los del .env, o los que se cambian desde la vista "Base de datos"). */
export interface DbSettings {
  client: DbClient;
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  sslMode: "DISABLED" | "REQUIRED";
  /** Certificado CA (PEM). Sin CA, con SSL se validan los certificados públicos del sistema. */
  sslCaPath?: string | null;
}

// ------------------------------------------------------------------ Medición

/**
 * Solo pruebas (scripts/medir.ts): recibe cada viaje a la base (consulta, inicio,
 * confirmación o reversión de transacción). Sin observador no hace nada.
 */
let queryObserver: ((sql: string) => void) | null = null;

export function observeQueries(observer: ((sql: string) => void) | null) {
  queryObserver = observer;
}

function noteQuery(sql: string) {
  queryObserver?.(sql);
}

// ------------------------------------------------------------------ MySQL

function mysqlOptions(settings: DbSettings): mysql.PoolOptions {
  const caPath = settings.sslMode === "REQUIRED" ? resolveCaPath(settings.sslCaPath ?? undefined) : null;

  if (settings.sslMode === "REQUIRED" && settings.sslCaPath && !caPath) {
    throw new Error(`DB_SSL_MODE=REQUIRED pero no se encontró el certificado CA en la ruta configurada: ${settings.sslCaPath}`);
  }

  return {
    host: settings.host,
    port: settings.port,
    user: settings.user,
    password: settings.password,
    database: settings.database,
    connectionLimit: 10,
    connectTimeout: 8000,
    decimalNumbers: true,
    namedPlaceholders: false,
    ssl:
      settings.sslMode === "REQUIRED"
        ? caPath
          ? { ca: fs.readFileSync(caPath, "utf8"), rejectUnauthorized: true }
          : { rejectUnauthorized: true }
        : undefined
  };
}

type MysqlLike = { query: (sql: string, params?: unknown[]) => Promise<unknown>; execute: (sql: string, params?: unknown[]) => Promise<unknown> };

function mysqlExecutor(target: MysqlLike): DbExecutor {
  return {
    query: (sql, params) => (noteQuery(sql), target.query(sql, params as never)) as never,
    execute: (sql, params) => (noteQuery(sql), target.execute(sql, params as never)) as never
  };
}

function mysqlConnection(connection: mysql.PoolConnection | mysql.Connection, onRelease: () => void): DbStandaloneConnection {
  return {
    ...mysqlExecutor(connection as unknown as MysqlLike),
    beginTransaction: () => (noteQuery("BEGIN"), connection.beginTransaction()),
    commit: () => (noteQuery("COMMIT"), connection.commit()),
    rollback: () => (noteQuery("ROLLBACK"), connection.rollback()),
    release: onRelease,
    end: () => connection.end()
  };
}

function createMysqlPool(settings: DbSettings): DbPool {
  const pool = mysql.createPool(mysqlOptions(settings));
  return {
    ...mysqlExecutor(pool as unknown as MysqlLike),
    getConnection: async () => {
      const connection = await pool.getConnection();
      return mysqlConnection(connection, () => connection.release());
    },
    end: () => pool.end()
  };
}

// ------------------------------------------------------------------ SQL Server

/** "servidor\\INSTANCIA" -> instancia con nombre (requiere SQL Browser o puerto fijo). */
function mssqlConfig(settings: DbSettings, poolMax = 20): mssql.config {
  const [server, instanceName] = settings.host.split("\\");
  const encrypt = settings.sslMode === "REQUIRED";
  return {
    server: server!,
    port: instanceName ? undefined : settings.port,
    user: settings.user,
    password: settings.password,
    database: settings.database,
    connectionTimeout: 8000,
    requestTimeout: 60000,
    pool: { max: poolMax, min: 0, idleTimeoutMillis: 30000 },
    options: {
      instanceName: instanceName || undefined,
      encrypt,
      // En red local sin SSL se acepta el certificado propio del servidor.
      trustServerCertificate: !encrypt,
      useUTC: true,
      enableArithAbort: true
    }
  };
}

/** Códigos de error de SQL Server -> los de MySQL que ya maneja el programa. */
function normalizeMssqlError(error: unknown) {
  const err = error as { number?: number; code?: string; originalError?: { info?: { number?: number } } };
  const number = err.number ?? err.originalError?.info?.number;
  if (number === 2627 || number === 2601) {
    err.code = "ER_DUP_ENTRY";
  } else if (number === 1205) {
    err.code = "ER_LOCK_DEADLOCK";
  } else if (number === 1222) {
    err.code = "ER_LOCK_WAIT_TIMEOUT";
  }
  return error;
}

function bindParam(request: mssql.Request, name: string, value: unknown) {
  if (value === undefined || value === null) {
    request.input(name, mssql.NVarChar, null);
  } else if (typeof value === "boolean") {
    request.input(name, mssql.TinyInt, value ? 1 : 0);
  } else if (typeof value === "number") {
    if (Number.isInteger(value)) {
      request.input(name, Math.abs(value) > 2147483647 ? mssql.BigInt : mssql.Int, value);
    } else {
      request.input(name, mssql.Decimal(28, 8), value);
    }
  } else if (typeof value === "bigint") {
    request.input(name, mssql.BigInt, value.toString());
  } else if (value instanceof Date) {
    request.input(name, mssql.DateTime2(3), value);
  } else if (Buffer.isBuffer(value)) {
    request.input(name, mssql.VarBinary(mssql.MAX), value);
  } else {
    const text = String(value);
    request.input(name, text.length > 4000 ? mssql.NVarChar(mssql.MAX) : mssql.NVarChar(Math.max(text.length, 1)), text);
  }
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

/**
 * Deja las filas como las entrega mysql2: BIGINT como número (mssql los da como
 * texto) y DATE como "AAAA-MM-DD" (sin corrimiento de zona horaria).
 */
function normalizeRows(recordset: mssql.IRecordSet<Record<string, unknown>>) {
  const columns = recordset.columns as unknown as Record<string, { type: unknown }>;
  const bigints: string[] = [];
  const dates: string[] = [];
  for (const [name, column] of Object.entries(columns ?? {})) {
    if (column.type === mssql.BigInt) bigints.push(name);
    else if (column.type === mssql.Date) dates.push(name);
  }
  if (bigints.length === 0 && dates.length === 0) {
    return recordset as unknown as Record<string, unknown>[];
  }
  for (const row of recordset) {
    for (const name of bigints) {
      if (row[name] !== null && row[name] !== undefined) row[name] = Number(row[name]);
    }
    for (const name of dates) {
      const value = row[name];
      if (value instanceof Date) row[name] = `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
    }
  }
  return recordset as unknown as Record<string, unknown>[];
}

async function runMssql(target: mssql.ConnectionPool | mssql.Transaction, sqlText: string, params: unknown[] = []): Promise<[unknown, unknown]> {
  const { sql, paramCount } = toMssql(sqlText);
  if (paramCount !== params.length) {
    throw new Error(`La consulta espera ${paramCount} parámetros y recibió ${params.length}.`);
  }

  const request = new mssql.Request(target as never);
  params.forEach((value, index) => bindParam(request, `p${index}`, value));

  noteQuery(sqlText);
  const kind = statementKind(sql);
  const text = kind === "INSERT" ? `${sql};\nSELECT CAST(SCOPE_IDENTITY() AS BIGINT) AS insertId;` : sql;

  try {
    const result = await request.query(text);
    if (kind === "INSERT") {
      const recordsets = (result.recordsets ?? []) as unknown as Array<Array<{ insertId?: string | number | null }>>;
      const identity = recordsets[recordsets.length - 1]?.[0];
      const header: DbResultHeader = { insertId: Number(identity?.insertId ?? 0), affectedRows: result.rowsAffected[0] ?? 0 };
      return [header, undefined];
    }
    if (result.recordset) {
      return [normalizeRows(result.recordset), result.recordset.columns];
    }
    const header: DbResultHeader = { insertId: 0, affectedRows: result.rowsAffected.reduce((total, value) => total + value, 0) };
    return [header, undefined];
  } catch (error) {
    throw normalizeMssqlError(error);
  }
}

/**
 * Conexión fija de SQL Server. mssql no expone conexiones sueltas: la transacción
 * es la conexión. Sin transacción, las consultas van al pool. Las consultas se
 * ejecutan de a una (una transacción no admite consultas en paralelo).
 */
class MssqlConnection implements DbStandaloneConnection {
  private transaction: mssql.Transaction | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly pool: mssql.ConnectionPool, private readonly ownsPool = false) {}

  get inTransaction() {
    return this.transaction !== null;
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => undefined);
    return next;
  }

  query<T>(sql: string, params?: unknown[]) {
    return this.enqueue(() => runMssql(this.transaction ?? this.pool, sql, params)) as Promise<[T, unknown]>;
  }

  execute<T>(sql: string, params?: unknown[]) {
    return this.query<T>(sql, params);
  }

  beginTransaction() {
    return this.enqueue(async () => {
      const transaction = new mssql.Transaction(this.pool);
      noteQuery("BEGIN");
      await transaction.begin(mssql.ISOLATION_LEVEL.READ_COMMITTED);
      this.transaction = transaction;
      // Igual que MySQL: esperar un bloqueo como máximo 50 s y luego fallar.
      noteQuery("SET LOCK_TIMEOUT");
      await new mssql.Request(transaction).batch("SET LOCK_TIMEOUT 50000;");
    });
  }

  commit() {
    return this.enqueue(async () => {
      const transaction = this.transaction;
      this.transaction = null;
      if (transaction) noteQuery("COMMIT");
      await transaction?.commit();
    });
  }

  rollback() {
    return this.enqueue(async () => {
      const transaction = this.transaction;
      this.transaction = null;
      // Si SQL Server ya la revirtió (p. ej. bloqueo mutuo), no hay nada que hacer.
      if (transaction) noteQuery("ROLLBACK");
      await transaction?.rollback().catch(() => undefined);
    });
  }

  release() {
    if (this.transaction) {
      void this.rollback();
    }
  }

  async end() {
    await this.queue.catch(() => undefined);
    if (this.transaction) {
      await this.rollback();
    }
    if (this.ownsPool) {
      await this.pool.close();
    }
  }
}

function createMssqlPool(settings: DbSettings): DbPool {
  const pool = new mssql.ConnectionPool(mssqlConfig(settings));
  // Si la conexión falla (servidor apagado, sin red), la siguiente consulta vuelve a
  // intentarlo: el sistema se recupera solo cuando la base vuelve a estar disponible.
  let ready: Promise<mssql.ConnectionPool> | null = null;
  const connected = () => {
    if (pool.connected) {
      return Promise.resolve(pool);
    }
    if (!ready) {
      ready = pool.connect().catch((error: unknown) => {
        ready = null;
        throw error;
      });
    }
    return ready;
  };
  connected().catch(() => undefined);
  return {
    query: async (sql, params) => runMssql(await connected(), sql, params) as never,
    execute: async (sql, params) => runMssql(await connected(), sql, params) as never,
    getConnection: async () => new MssqlConnection(await connected()),
    end: async () => {
      await pool.close();
    }
  };
}

// ------------------------------------------------------------------ Pool activo

/** Sin servidor, usuario o base: el sistema espera la configuración inicial. */
function settingsComplete(settings: DbSettings) {
  return Boolean(settings.host && settings.user && settings.database);
}

/** Error de toda consulta mientras no hay base configurada (el frontend muestra la pantalla inicial). */
function notConfiguredError() {
  return Object.assign(new Error("La base de datos no está configurada."), { code: "DB_NOT_CONFIGURED" });
}

function createUnconfiguredPool(): DbPool {
  const fail = async () => {
    throw notConfiguredError();
  };
  return { query: fail as never, execute: fail as never, getConnection: fail as never, end: async () => undefined };
}

function createPool(settings: DbSettings) {
  if (!settingsComplete(settings)) {
    return createUnconfiguredPool();
  }
  return settings.client === "mssql" ? createMssqlPool(settings) : createMysqlPool(settings);
}

let currentSettings: DbSettings = {
  client: env.DB_CLIENT,
  host: env.DB_HOST,
  port: env.DB_PORT,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
  sslMode: env.DB_SSL_MODE,
  sslCaPath: env.DB_SSL_CA_PATH ?? null
};

let currentPool = createPool(currentSettings);

/**
 * Pool de la aplicación. Es un proxy al pool activo para poder cambiar de base
 * de datos en caliente (vista "Base de datos") sin reiniciar el backend.
 */
export const dbPool: DbPool = new Proxy({} as DbPool, {
  get(_target, property) {
    const value = Reflect.get(currentPool, property, currentPool);
    return typeof value === "function" ? value.bind(currentPool) : value;
  }
});

export function currentDbSettings(): DbSettings {
  return { ...currentSettings };
}

const CONNECTION_ERROR_CODES = new Set([
  // Red / servidor (ambos motores)
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EAI_AGAIN",
  "EPIPE",
  // MySQL / MariaDB
  "PROTOCOL_CONNECTION_LOST",
  "PROTOCOL_SEQUENCE_TIMEOUT",
  "ER_ACCESS_DENIED_ERROR",
  "ER_BAD_DB_ERROR",
  "ER_CON_COUNT_ERROR",
  "ER_SERVER_SHUTDOWN",
  // SQL Server (mssql / tedious)
  "ESOCKET",
  "ELOGIN",
  "ECONNCLOSED",
  "ENOTOPEN",
  "ENOCONN",
  "EINSTLOOKUP"
]);

/**
 * true si el error es por no poder comunicarse con la base de datos (servidor
 * apagado, sin red, credenciales o base inexistente), no por la consulta en sí.
 */
export function isDbConnectionError(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current = error as { code?: unknown; name?: string; originalError?: unknown; cause?: unknown } | undefined;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    if (typeof current.code === "string" && CONNECTION_ERROR_CODES.has(current.code)) {
      return true;
    }
    // Conexión de SQL Server que no se pudo abrir (incluye el tiempo de espera al conectar).
    if (current.name === "ConnectionError") {
      return true;
    }
    current = (current.originalError ?? current.cause) as typeof current;
  }
  return false;
}

/** Comprueba que la base responde (con tiempo máximo para no dejar esperando). */
export async function pingDatabase(timeoutMs = 5000): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      dbPool.query("SELECT 1").then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      })
    ]);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** ¿Hay una base configurada? (si no, el sistema pide conectarla). */
export function isDbConfigured() {
  return settingsComplete(currentSettings);
}

/** Motor de la base activa. */
export function dbClient(): DbClient {
  return currentSettings.client;
}

export function isMssql() {
  return currentSettings.client === "mssql";
}

/** Abre una conexión de prueba con esos datos (no toca el pool activo). */
export async function openTestConnection(settings: DbSettings, extra: { multipleStatements?: boolean } = {}): Promise<DbStandaloneConnection> {
  if (settings.client === "mssql") {
    const pool = new mssql.ConnectionPool(mssqlConfig(settings, 1));
    await pool.connect();
    return new MssqlConnection(pool, true);
  }
  const { connectionLimit: _limit, ...options } = mysqlOptions(settings);
  const connection = await mysql.createConnection({ ...options, connectTimeout: 8000, ...extra });
  return mysqlConnection(connection, () => undefined);
}

/**
 * Ejecuta un archivo SQL completo (migración o instalación). En SQL Server se
 * separa por líneas "GO", como hacen SSMS y sqlcmd.
 */
export async function runSqlScript(connection: DbStandaloneConnection, script: string, client: DbClient) {
  // Un texto solo con comentarios no tiene nada que ejecutar (MySQL lo rechaza como consulta vacía).
  const hasStatements = (sql: string) => Boolean(sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "").trim());
  if (client === "mssql") {
    for (const batch of script.split(/^\s*GO\s*;?\s*$/gim)) {
      if (hasStatements(batch)) {
        await connection.query(batch);
      }
    }
    return;
  }
  if (!hasStatements(script)) return;
  await connection.query(script);
}

/** Cambia el pool activo por uno nuevo con esos datos; el anterior se cierra. */
export async function switchDatabase(settings: DbSettings) {
  const nextPool = createPool(settings);

  try {
    await nextPool.query("SELECT 1");
  } catch (error) {
    await nextPool.end().catch(() => undefined);
    throw error;
  }

  const previous = currentPool;
  currentPool = nextPool;
  currentSettings = { ...settings };
  // Deja terminar las consultas en curso antes de cerrar el pool anterior.
  setTimeout(() => void previous.end().catch(() => undefined), 5000);
}

export async function withTransaction<T>(handler: (connection: DbConnection) => Promise<T>) {
  const connection = await dbPool.getConnection();

  try {
    await connection.beginTransaction();
    const result = await handler(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/** Errores que se pueden resolver reintentando la transacción (SQL Server se normaliza a estos). */
const RETRYABLE_DB_ERRORS = new Set(["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"]);

/**
 * Reintenta `fn` cuando la base aborta la transacción por bloqueo mutuo o espera
 * agotada (esperado bajo emisión concurrente desde varias PCs). Cada intento debe
 * abrir su propia transacción, ya que la anterior quedó revertida.
 */
export async function withDeadlockRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      const code = (error as { code?: string }).code;

      if (code && RETRYABLE_DB_ERRORS.has(code) && attempt < attempts) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 40 * attempt));
        continue;
      }

      throw error;
    }
  }

  throw lastError;
}

/**
 * Bloqueo con nombre entre cajas (una sola a la vez hace la tarea). Usa una
 * conexión propia que se debe mantener hasta `releaseNamedLock`.
 *   MySQL: GET_LOCK / RELEASE_LOCK.
 *   SQL Server: sp_getapplock dentro de una transacción de esa conexión.
 */
export async function acquireNamedLock(connection: DbConnection, name: string, timeoutSeconds: number, client: DbClient = dbClient()) {
  if (client === "mssql") {
    if (!(connection as MssqlConnection).inTransaction) {
      await connection.beginTransaction();
    }
    const [rows] = await connection.query<Array<{ result: number }>>(
      "DECLARE @r INT; EXEC @r = sp_getapplock @Resource = ?, @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = ?; SELECT @r AS result;",
      [name, timeoutSeconds * 1000]
    );
    return Number(rows[0]?.result ?? -1) >= 0;
  }
  const [rows] = await connection.query<Array<{ acquired: number | null }>>("SELECT GET_LOCK(?, ?) AS acquired", [name, timeoutSeconds]);
  return rows[0]?.acquired === 1;
}

export async function releaseNamedLock(connection: DbConnection, name: string, client: DbClient = dbClient()) {
  if (client === "mssql") {
    if ((connection as MssqlConnection).inTransaction) {
      await connection.query("EXEC sp_releaseapplock @Resource = ?, @LockOwner = 'Transaction';", [name]).catch(() => undefined);
      await connection.commit();
    }
    return;
  }
  await connection.query("SELECT RELEASE_LOCK(?)", [name]);
}

/** Nombres de las tablas de la base de la conexión (en minúsculas). */
export async function listTables(connection: DbExecutor, client: DbClient = dbClient()) {
  const [rows] = await connection.query<Array<{ name: string }>>(
    client === "mssql"
      ? "SELECT name FROM sys.tables WHERE is_ms_shipped = 0"
      : "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE()"
  );
  return new Set(rows.map((row) => String(row.name).toLowerCase()));
}

/** Versión del motor, para mostrar en la vista "Base de datos". */
export async function serverVersion(connection: DbExecutor, client: DbClient = dbClient()) {
  const [rows] = await connection.query<Array<{ version: string }>>(
    client === "mssql" ? "SELECT CAST(SERVERPROPERTY('ProductVersion') AS NVARCHAR(50)) AS version" : "SELECT VERSION() AS version"
  );
  return rows[0]?.version ?? "desconocida";
}

/** Próximo id autoincremental de una tabla (vista previa de códigos al crear). */
export async function nextIdentityValue(table: string, client: DbClient = dbClient()) {
  const [rows] = await dbPool.query<Array<{ nextId: number | null }>>(
    client === "mssql"
      ? `SELECT CAST(ISNULL(CAST(last_value AS BIGINT), CAST(seed_value AS BIGINT) - 1) + 1 AS BIGINT) AS nextId
         FROM sys.identity_columns WHERE object_id = OBJECT_ID(?)`
      : "SELECT AUTO_INCREMENT AS nextId FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1",
    [table]
  );
  return Number(rows[0]?.nextId ?? 1);
}
