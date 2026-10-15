import net from "net";
import os from "os";

import { currentDbSettings, dbClient, dbPool, isDbConfigured, listTables } from "../config/db";
import { AppError } from "../utils/http-error";
import {
  evaluateLicense,
  isLicenseRequired,
  licenseToday,
  machineCode,
  readLocalLicense,
  readRevocation,
  rememberSeen,
  type LicenseStatus,
  type RevocationPayload
} from "./license";

/**
 * Licencia de este equipo en el programa: la suya (equipo.dat) o una guardada en la base
 * (system_licenses) que lo incluya, sin revocar (license_revocations) y con la fecha del
 * servidor de la base como referencia del reloj. Cada revisión registra el equipo
 * (license_devices) y marca si el mismo código aparece desde otra PC (código clonado).
 *
 * El programa solo lee las licencias y revocaciones (con el usuario limitado de la caja
 * ni siquiera puede escribirlas): las instala y revoca el gestor de licencias.
 */

interface DbLicenseInfo {
  at: number;
  /** Fecha de hoy según el servidor de la base (no depende del reloj de la PC). */
  today: string | null;
  licenses: string[];
  revocations: RevocationPayload[];
}

/** Sin conexión con la base, se sigue con lo último leído de ella hasta 3 días. */
const DB_INFO_MAX_AGE_MS = 3 * 86_400_000;
/** Mismo código desde otro nombre de PC en menos de 10 minutos: posible código clonado. */
const CLONE_WINDOW_SECONDS = 600;

let dbInfo: DbLicenseInfo | null = null;

function hondurasDate(utc: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Tegucigalpa" }).format(utc);
}

/** Tarjetas virtuales (VMware, VirtualBox, Hyper-V, VPN...): no son la red real de la PC. */
const VIRTUAL_ADAPTER = /vmware|virtualbox|vbox|vethernet|hyper-v|wsl|docker|radmin|hamachi|zerotier|tailscale|wireguard|openvpn|tap-|loopback|bluetooth/i;

let cachedIp: { at: number; ip: string | null } | null = null;

/**
 * IP de esta PC en su red: la que usa para llegar al servidor de la base (la real, sin
 * confundirla con tarjetas virtuales). Si no se puede saber así, la primera tarjeta real.
 */
async function localIp() {
  if (cachedIp && Date.now() - cachedIp.at < 3_600_000) return cachedIp.ip;
  const { host, port } = currentDbSettings();
  const viaServer = await new Promise<string | null>((resolve) => {
    const socket = net.connect({ host, port, timeout: 3000 });
    const done = (ip: string | null) => {
      socket.destroy();
      resolve(ip);
    };
    socket.once("connect", () => done(socket.localAddress?.replace(/^::ffff:/, "") ?? null));
    socket.once("timeout", () => done(null));
    socket.once("error", () => done(null));
  });
  let ip = viaServer && viaServer !== "127.0.0.1" && viaServer !== "::1" ? viaServer : null;
  if (!ip) {
    for (const [name, addresses] of Object.entries(os.networkInterfaces())) {
      if (VIRTUAL_ADAPTER.test(name)) continue;
      const ipv4 = addresses?.find((address) => address.family === "IPv4" && !address.internal && !address.address.startsWith("169.254."));
      if (ipv4) {
        ip = ipv4.address;
        break;
      }
    }
  }
  cachedIp = { at: Date.now(), ip };
  return ip;
}

/** Registra este equipo (o actualiza su última vez) y marca si su código llega desde otra PC. */
async function heartbeat(machine: string) {
  const now = dbClient() === "mssql" ? "SYSUTCDATETIME()" : "UTC_TIMESTAMP()";
  const name = os.hostname().slice(0, 120);
  const version = (process.env.FACTURACION_VERSION ?? "dev").slice(0, 30);
  const ip = await localIp();
  const [rows] = await dbPool.query<Array<{ id: number; machine_name: string | null; ago: number | null }>>(
    dbClient() === "mssql"
      ? `SELECT id, machine_name, DATEDIFF(SECOND, last_seen, ${now}) AS ago FROM license_devices WHERE machine_code = ?`
      : `SELECT id, machine_name, TIMESTAMPDIFF(SECOND, last_seen, ${now}) AS ago FROM license_devices WHERE machine_code = ?`,
    [machine]
  );
  const row = rows[0];
  if (!row) {
    await dbPool.query(`INSERT INTO license_devices (machine_code, machine_name, app_version, ip_address, first_seen, last_seen) VALUES (?, ?, ?, ?, ${now}, ${now})`, [machine, name, version, ip]);
    return;
  }
  const clone = row.machine_name && row.machine_name !== name && row.ago !== null && Number(row.ago) < CLONE_WINDOW_SECONDS;
  await dbPool.query(
    clone
      ? `UPDATE license_devices SET machine_name = ?, app_version = ?, ip_address = ?, last_seen = ${now}, conflict_name = ?, conflict_at = ${now} WHERE id = ?`
      : `UPDATE license_devices SET machine_name = ?, app_version = ?, ip_address = ?, last_seen = ${now} WHERE id = ?`,
    clone ? [name, version, ip, row.machine_name, row.id] : [name, version, ip, row.id]
  );
}

/** Lee de la base la fecha del servidor, las licencias y las revocaciones (y registra el equipo). */
async function loadDbInfo(machine: string): Promise<DbLicenseInfo | null> {
  if (!isDbConfigured()) return null;
  try {
    const [clock] = await dbPool.query<Array<{ now: string }>>(
      dbClient() === "mssql" ? "SELECT CONVERT(VARCHAR(19), SYSUTCDATETIME(), 120) AS now" : "SELECT DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:%i:%s') AS now"
    );
    const utc = new Date(`${String(clock[0]?.now).replace(" ", "T")}Z`);
    const info: DbLicenseInfo = { at: Date.now(), today: Number.isNaN(utc.getTime()) ? null : hondurasDate(utc), licenses: [], revocations: [] };
    const tables = await listTables(dbPool);
    if (tables.has("system_licenses")) {
      const [rows] = await dbPool.query<Array<{ license_text: string }>>("SELECT license_text FROM system_licenses ORDER BY id DESC");
      info.licenses = rows.map((row) => String(row.license_text));
    }
    if (tables.has("license_revocations")) {
      const [rows] = await dbPool.query<Array<{ revocation_text: string }>>("SELECT revocation_text FROM license_revocations");
      info.revocations = rows.map((row) => readRevocation(String(row.revocation_text))).filter((value): value is RevocationPayload => value !== null);
    }
    if (tables.has("license_devices")) {
      await heartbeat(machine).catch(() => undefined);
    }
    dbInfo = info;
    return info;
  } catch {
    // Sin conexión (o sin permiso): lo último leído, si no es muy viejo.
    return dbInfo && Date.now() - dbInfo.at < DB_INFO_MAX_AGE_MS ? dbInfo : null;
  }
}

const laterDate = (...dates: Array<string | null | undefined>) => dates.filter((date): date is string => Boolean(date)).sort().pop() ?? null;

let cache: { at: number; status: LicenseStatus } | null = null;
/** Válida: se vuelve a revisar cada minuto. Sin licencia: cada pocos segundos (para notar enseguida la que instale el gestor). */
const CACHE_VALID_MS = 60_000;
const CACHE_INVALID_MS = 5_000;

/** Estado de la licencia de este equipo (con caché). */
export async function licenseStatus(force = false): Promise<LicenseStatus> {
  if (!force && cache && Date.now() - cache.at < (cache.status.valid ? CACHE_VALID_MS : CACHE_INVALID_MS)) return cache.status;
  const machine = machineCode();
  const pcToday = licenseToday();
  const local = readLocalLicense();
  const db = await loadDbInfo(machine);
  const options = {
    machine,
    today: pcToday,
    // El servidor de la base también cuenta como fecha vista: atrasar el reloj de la PC no sirve.
    lastSeen: laterDate(local.seen.fecha, db?.today),
    minSeq: local.seen.ultima,
    revocations: db?.revocations ?? [],
    required: isLicenseRequired()
  };

  let status = evaluateLicense(local.text, { ...options, origen: "equipo" });
  if (!status.valid && db) {
    let fallback: LicenseStatus | null = null;
    for (const text of db.licenses) {
      const candidate = evaluateLicense(text, { ...options, origen: "base" });
      if (candidate.valid) {
        fallback = candidate;
        break;
      }
      if (!fallback && candidate.problem !== "other-machine") fallback = candidate;
    }
    // La de la base decide si es válida, o si este equipo no tiene la suya.
    if (fallback && (fallback.valid || status.problem === "missing")) status = fallback;
  }

  if (status.problem !== "clock") rememberSeen({ fecha: laterDate(pcToday, db?.today), ultima: status.valid ? (status.seq ?? 0) : 0 });
  cache = { at: Date.now(), status };
  return status;
}

/**
 * Revisión adicional en operaciones clave (entrar, facturar): quitar el bloqueo general
 * no alcanza para usar el programa sin licencia.
 */
export async function assertLicense() {
  const status = await licenseStatus();
  if (status.required && !status.valid) {
    throw new AppError(status.message ?? "Este equipo no tiene una licencia válida.", 403, { code: "LICENSE_REQUIRED" });
  }
}
