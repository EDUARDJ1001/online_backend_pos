import { execFileSync } from "child_process";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

import { LICENSE_PUBLIC_KEY } from "./public-key";

/**
 * Licencias (sin base de datos: lo usan el programa y el gestor de licencias).
 *
 * Cada PC tiene un código de equipo (MachineGuid de Windows + UUID de la placa). La
 * licencia lleva empresa, vencimiento y los códigos que incluye; va cifrada (solo esas
 * PCs la abren) y firmada con la clave privada del proveedor (Ed25519): nadie puede
 * fabricarla ni modificarla. Se verifica en la PC con la clave pública, sin internet.
 *
 * - De un equipo (FACT1) o de varios (FACT2: la misma licencia en cada PC de la lista).
 * - Cada licencia lleva un número de orden (`seq`): la PC recuerda el más alto que tuvo
 *   y rechaza las más viejas (restaurar una copia anterior no sirve).
 * - Revocaciones (FACTR, firmadas): anulan una licencia o las de un equipo emitidas
 *   antes de cierta fecha. Las guarda el gestor en la base (license-runtime las lee).
 * - La fecha más alta vista se guarda aparte (cifrada): atrasar el reloj no extiende
 *   la licencia.
 */

export interface LicensePayload {
  v: 1;
  /** Código de equipo sin separadores (12 caracteres). */
  equipo: string;
  empresa: string | null;
  /** YYYY-MM-DD, o null si es permanente. */
  vence: string | null;
  emitida: string;
  id: string;
  /** Orden de emisión (milisegundos): una licencia más vieja que la última instalada se rechaza. */
  seq?: number;
}

/**
 * Licencia de varios equipos: la misma licencia sirve en cada PC de la lista (por su
 * código). Se instala en cada una (equipo.dat) o se guarda una vez en la base.
 */
export interface MultiLicensePayload {
  v: 1;
  tipo: "varios";
  /** Códigos de equipo sin separadores. */
  equipos: string[];
  empresa: string | null;
  vence: string | null;
  emitida: string;
  id: string;
  seq?: number;
}

/** Revocación firmada: anula una licencia (por su id) o las de un equipo emitidas antes de `antes`. */
export interface RevocationPayload {
  v: 1;
  tipo: "revocacion";
  licencia?: string;
  equipo?: string;
  /** seq: se anulan las licencias de ese equipo emitidas antes. */
  antes?: number;
  motivo: string | null;
  emitida: string;
  seq: number;
}

export type LicenseProblem = "missing" | "invalid" | "other-machine" | "expired" | "clock" | "replaced" | "revoked";

export interface LicenseStatus {
  required: boolean;
  valid: boolean;
  problem: LicenseProblem | null;
  message: string | null;
  /** Código de este equipo, en grupos de 4 (para mostrar y enviar). */
  machineCode: string;
  empresa: string | null;
  vence: string | null;
  /** Días que faltan para vencer (null si es permanente o no hay licencia). */
  daysLeft: number | null;
  /** YYYY-MM-DD en que se generó la licencia (null si no hay licencia legible). */
  emitida: string | null;
  /** De un solo equipo, o de varios (la misma licencia en cada PC de la lista). */
  tipo?: "equipo" | "varios" | null;
  /** Licencia de varios equipos: cuántos equipos incluye. */
  equipos?: number | null;
  /** Dónde está: en esta PC (equipo.dat) o en la base de datos. */
  origen?: "equipo" | "base" | null;
  /** Orden de emisión de la licencia. */
  seq?: number | null;
  /** Id de la licencia (para revocarla). */
  licenseId?: string | null;
}

const PREFIX = "FACT1";
const MULTI_PREFIX = "FACT2";
const REVOCATION_PREFIX = "FACTR";
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford: sin I, L, O, U.
const SALT = Buffer.from([246, 50, 249, 72, 93, 55, 106, 249, 239, 72, 30, 248, 25, 168, 173, 53, 158, 118, 218, 103, 54, 149, 50, 120]);

const b64url = (data: Buffer | string) => Buffer.from(data).toString("base64url");
const isDate = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

/** Código de equipo canónico (sin espacios ni guiones, en mayúsculas). */
export function normalizeMachineCode(code: string) {
  return code.toUpperCase().replace(/[^0-9A-Z]/g, "");
}

export function formatMachineCode(code: string) {
  return normalizeMachineCode(code).replace(/(.{4})(?=.)/g, "$1 ");
}

// ---------- Código de equipo ----------

let cachedMachine: string | null = null;

function readRegistry(key: string, value: string) {
  try {
    const output = execFileSync("reg", ["query", key, "/v", value], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    return new RegExp(`${value}\\s+REG_SZ\\s+(\\S+)`).exec(output)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** UUID de la placa (SMBIOS) si es real: algunos fabricantes dejan ceros o valores de fábrica. */
function boardUuid() {
  const uuid = readRegistry("HKLM\\SYSTEM\\HardwareConfig", "LastConfig")?.replace(/[{}]/g, "").toLowerCase();
  if (!uuid || !/^[0-9a-f-]{36}$/.test(uuid)) return "";
  const digits = uuid.replace(/-/g, "");
  if (/^(0+|f+)$/.test(digits) || digits === "03000200040005000006000700080009") return "";
  return uuid;
}

/**
 * Identificador estable de esta PC: MachineGuid de Windows + UUID de la placa. Cambiar
 * solo el MachineGuid (editable en el registro) no basta para copiar el código de otra PC.
 * En otros sistemas, el nombre del equipo.
 */
function machineIdentifier() {
  if (process.platform === "win32") {
    const guid = readRegistry("HKLM\\SOFTWARE\\Microsoft\\Cryptography", "MachineGuid");
    if (guid && /^[0-9a-fA-F-]+$/.test(guid)) return `${guid.toLowerCase()}|${boardUuid()}`;
  }
  return `${os.hostname()}|${os.platform()}`;
}

/** Código de este equipo (12 caracteres). */
export function machineCode() {
  if (!cachedMachine) {
    const hash = crypto.createHash("sha256").update(`facturacion-licencia|${machineIdentifier()}`).digest();
    cachedMachine = Array.from(hash.subarray(0, 12), (byte) => ALPHABET[byte % 32]).join("");
  }
  return cachedMachine;
}

// ---------- Cifrado ----------

function machineKey(machine: string, purpose: string) {
  return crypto.createHash("sha256").update(SALT).update(`${purpose}|${normalizeMachineCode(machine)}`).digest();
}

function sealWithKey(key: Buffer, text: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return b64url(Buffer.concat([iv, data, cipher.getAuthTag()]));
}

/** null si no se puede abrir (otra clave, texto alterado o dañado). */
function unsealWithKey(key: Buffer, sealed: string) {
  try {
    const raw = Buffer.from(sealed, "base64url");
    if (raw.length < 29) return null;
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(raw.length - 16));
    return Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

const seal = (machine: string, purpose: string, text: string) => sealWithKey(machineKey(machine, purpose), text);
const unseal = (machine: string, purpose: string, sealed: string) => unsealWithKey(machineKey(machine, purpose), sealed);

/** Lo que la PC recuerda (equipo.idx, cifrado para su equipo): fecha más alta vista y última licencia. */
export interface SeenState {
  fecha: string | null;
  ultima: number;
}

export function sealSeen(machine: string, state: SeenState) {
  return seal(machine, "fecha", JSON.stringify(state));
}

export function unsealSeen(machine: string, text: string | null): SeenState {
  const raw = text ? unseal(machine, "fecha", text.trim()) : null;
  if (!raw) return { fecha: null, ultima: 0 };
  if (isDate(raw)) return { fecha: raw, ultima: 0 }; // Formato anterior: solo la fecha.
  try {
    const parsed = JSON.parse(raw) as Partial<SeenState>;
    return { fecha: isDate(parsed.fecha) ? parsed.fecha : null, ultima: Number.isFinite(parsed.ultima) ? Number(parsed.ultima) : 0 };
  } catch {
    return { fecha: null, ultima: 0 };
  }
}

export function sealSeenDate(machine: string, date: string) {
  return sealSeen(machine, { fecha: date, ultima: 0 });
}

export function unsealSeenDate(machine: string, text: string | null) {
  return unsealSeen(machine, text).fecha;
}

// ---------- Firmar y verificar ----------

/**
 * Clave pública con la que se verifican las licencias. FACTURACION_LICENCIA_CLAVE_PUBLICA
 * solo sirve para pruebas: el programa instalado la borra al arrancar (desktop.ts).
 */
function verificationKey() {
  return process.env.FACTURACION_LICENCIA_CLAVE_PUBLICA ?? LICENSE_PUBLIC_KEY;
}

function sign(prefix: string, body: string, privateKey: crypto.KeyLike) {
  const key = typeof privateKey === "string" ? crypto.createPrivateKey(privateKey) : privateKey;
  return `${prefix}.${body}.${b64url(crypto.sign(null, Buffer.from(`${prefix}.${body}`), key as crypto.KeyObject))}`;
}

/** Cuerpo de un texto firmado con ese prefijo, o null si la firma no es válida. */
function verifiedBody(text: string, prefix: string, publicPem: string) {
  const parts = text.replace(/\s+/g, "").split(".");
  if (parts.length !== 3 || parts[0] !== prefix || !publicPem) return null;
  try {
    return crypto.verify(null, Buffer.from(`${parts[0]}.${parts[1]}`), crypto.createPublicKey(publicPem), Buffer.from(parts[2]!, "base64url")) ? parts[1]! : null;
  } catch {
    return null;
  }
}

export function signLicense(payload: LicensePayload, privateKey: crypto.KeyLike) {
  return sign(PREFIX, seal(payload.equipo, "licencia", JSON.stringify(payload)), privateKey);
}

/**
 * Firma una licencia de varios equipos. Los datos van cifrados con una clave al azar, y
 * esa clave va cifrada una vez por cada equipo de la lista: solo esas PCs pueden abrirla.
 */
export function signMultiLicense(payload: MultiLicensePayload, privateKey: crypto.KeyLike) {
  const equipos = [...new Set(payload.equipos.map(normalizeMachineCode))];
  const dataKey = crypto.randomBytes(32);
  const keys = equipos.map((machine) => seal(machine, "varios", dataKey.toString("base64url")));
  // En otro orden que la lista, para no dejar ver cuál es cuál.
  for (let i = keys.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [keys[i], keys[j]] = [keys[j]!, keys[i]!];
  }
  return sign(MULTI_PREFIX, b64url(JSON.stringify({ k: keys, d: sealWithKey(dataKey, JSON.stringify({ ...payload, equipos })) })), privateKey);
}

export function signRevocation(payload: RevocationPayload, privateKey: crypto.KeyLike) {
  return sign(REVOCATION_PREFIX, b64url(JSON.stringify(payload)), privateKey);
}

export function isMultiLicenseText(text: string) {
  return text.replace(/\s+/g, "").startsWith(`${MULTI_PREFIX}.`);
}

type ReadResult<T> = { payload: T; problem: null } | { payload: null; problem: "invalid" | "other-machine" };

/** Verifica la firma y abre los datos con el código de este equipo. */
function readSingleLicense(text: string, machine: string, publicPem: string): ReadResult<LicensePayload> {
  const invalid = { payload: null, problem: "invalid" as const };
  const body = verifiedBody(text, PREFIX, publicPem);
  if (!body) return invalid;
  const json = unseal(machine, "licencia", body);
  // Firma válida pero no abre con este código: licencia auténtica de otro equipo.
  if (json === null) return { payload: null, problem: "other-machine" };
  try {
    const payload = JSON.parse(json) as LicensePayload;
    if (payload.v !== 1 || typeof payload.equipo !== "string" || !isDate(payload.emitida)) return invalid;
    if (normalizeMachineCode(payload.equipo) !== normalizeMachineCode(machine)) return { payload: null, problem: "other-machine" };
    return { payload, problem: null };
  } catch {
    return invalid;
  }
}

/** Verifica la firma y abre los datos si este equipo está en la lista. */
export function readMultiLicense(text: string, machine: string, publicPem: string = verificationKey()): ReadResult<MultiLicensePayload> {
  const invalid = { payload: null, problem: "invalid" as const };
  const raw = verifiedBody(text, MULTI_PREFIX, publicPem);
  if (!raw) return invalid;
  try {
    const body = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as { k: string[]; d: string };
    if (!Array.isArray(body.k) || typeof body.d !== "string") return invalid;
    const dataKey = body.k.map((wrapped) => unseal(machine, "varios", wrapped)).find((value) => value !== null);
    if (!dataKey) return { payload: null, problem: "other-machine" };
    const json = unsealWithKey(Buffer.from(dataKey, "base64url"), body.d);
    if (json === null) return invalid;
    const payload = JSON.parse(json) as MultiLicensePayload;
    if (payload.v !== 1 || payload.tipo !== "varios" || !Array.isArray(payload.equipos) || !isDate(payload.emitida)) return invalid;
    if (!payload.equipos.includes(normalizeMachineCode(machine))) return { payload: null, problem: "other-machine" };
    return { payload, problem: null };
  } catch {
    return invalid;
  }
}

/** Revocación auténtica, o null. */
export function readRevocation(text: string, publicPem: string = verificationKey()): RevocationPayload | null {
  const raw = verifiedBody(text, REVOCATION_PREFIX, publicPem);
  if (!raw) return null;
  try {
    const payload = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as RevocationPayload;
    return payload.v === 1 && payload.tipo === "revocacion" && (payload.licencia || payload.equipo) ? payload : null;
  } catch {
    return null;
  }
}

// ---------- Evaluar ----------

function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Reloj y vencimiento (iguales para los dos tipos de licencia). */
export function checkTerms(terms: { vence: string | null; emitida: string }, today: string, lastSeen?: string | null) {
  const seen = [lastSeen, terms.emitida].filter(isDate).sort().pop()!;
  if (daysBetween(today, seen) > 1) return { problem: "clock" as const, daysLeft: null };
  const effectiveToday = seen > today ? seen : today;
  if (!terms.vence) return { problem: null, daysLeft: null };
  const daysLeft = daysBetween(effectiveToday, terms.vence);
  return { problem: daysLeft < 0 ? ("expired" as const) : null, daysLeft };
}

/** ¿Alguna revocación anula esta licencia en este equipo? */
function isRevoked(license: { id: string; seq?: number }, machine: string, revocations: RevocationPayload[]) {
  const code = normalizeMachineCode(machine);
  return revocations.some(
    (revocation) =>
      (revocation.licencia && revocation.licencia === license.id) ||
      (revocation.equipo && normalizeMachineCode(revocation.equipo) === code && (license.seq ?? 0) < (revocation.antes ?? Number.MAX_SAFE_INTEGER))
  );
}

const MESSAGES: Record<LicenseProblem, string> = {
  missing: "Este equipo no tiene licencia. Tu proveedor del sistema debe activarlo.",
  invalid: "La licencia de este equipo no es válida. Tu proveedor del sistema debe activarlo de nuevo.",
  "other-machine": "La licencia es de otro equipo. Cada licencia sirve solo en la PC para la que se generó.",
  expired: "La licencia venció. Pide la renovación a tu proveedor del sistema.",
  clock: "La fecha de esta PC está atrasada. Corrige la fecha y la hora de Windows.",
  replaced: "Esta licencia fue reemplazada por una más nueva. Tu proveedor del sistema debe activarlo de nuevo.",
  revoked: "La licencia de este equipo fue anulada. Tu proveedor del sistema debe activarlo de nuevo."
};

export interface EvaluateOptions {
  machine: string;
  today: string;
  /** Fecha más alta vista (por la PC o por el servidor de la base). */
  lastSeen?: string | null;
  /** Orden de la última licencia que tuvo la PC: las más viejas se rechazan. */
  minSeq?: number;
  revocations?: RevocationPayload[];
  publicPem?: string;
  required?: boolean;
  origen?: "equipo" | "base";
}

/**
 * Evalúa una licencia para un equipo y una fecha. La fecha de emisión cuenta como vista
 * (aunque se borre lo guardado); si el reloj marca una anterior (más de un día), se
 * considera atrasado.
 */
export function evaluateLicense(text: string | null, options: EvaluateOptions): LicenseStatus {
  const base = { required: options.required ?? true, machineCode: formatMachineCode(options.machine), empresa: null, vence: null, daysLeft: null, emitida: null, origen: options.origen ?? null };
  const fail = (problem: LicenseProblem, extra: Partial<LicenseStatus> = {}): LicenseStatus => ({ ...base, ...extra, valid: false, problem, message: MESSAGES[problem] });

  if (!text || !text.trim()) return fail("missing");
  const publicPem = options.publicPem ?? verificationKey();
  const read = isMultiLicenseText(text) ? readMultiLicense(text, options.machine, publicPem) : readSingleLicense(text, options.machine, publicPem);
  if (!read.payload) return fail(read.problem);
  const payload = read.payload;
  const multi = "tipo" in payload && payload.tipo === "varios";
  const info = {
    empresa: payload.empresa,
    vence: payload.vence,
    emitida: payload.emitida,
    tipo: multi ? ("varios" as const) : ("equipo" as const),
    equipos: multi ? payload.equipos.length : null,
    seq: payload.seq ?? 0,
    licenseId: payload.id
  };
  if (isRevoked(payload, options.machine, options.revocations ?? [])) return fail("revoked", info);
  if ((payload.seq ?? 0) < (options.minSeq ?? 0)) return fail("replaced", info);
  const terms = checkTerms(payload, options.today, options.lastSeen);
  if (terms.problem) return fail(terms.problem, { ...info, daysLeft: terms.daysLeft });
  return { ...base, ...info, valid: true, problem: null, message: null, daysLeft: terms.daysLeft };
}

// ---------- En el equipo ----------

export function isLicenseRequired() {
  return process.env.FACTURACION_LICENCIA_REQUERIDA === "true";
}

function licenseFile() {
  return process.env.FACTURACION_LICENCIA_ARCHIVO ?? path.join(process.cwd(), "equipo.dat");
}

/** Lo que recuerda esta PC (junto a la licencia, cifrado). */
function seenFile(file = licenseFile()) {
  return path.join(path.dirname(file), `${path.basename(file, path.extname(file))}.idx`);
}

function readText(file: string) {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim() : null;
}

/** Escribe y deja el archivo oculto (Windows no deja recrear un archivo oculto: se reescribe). */
function writeHidden(file: string, text: string) {
  if (fs.existsSync(file)) {
    const fd = fs.openSync(file, "r+");
    try {
      fs.ftruncateSync(fd, 0);
      fs.writeSync(fd, text, 0, "utf8");
    } finally {
      fs.closeSync(fd);
    }
    return;
  }
  fs.writeFileSync(file, text, "utf8");
  if (process.platform === "win32") {
    try {
      execFileSync("attrib", ["+h", file], { windowsHide: true, stdio: "ignore" });
    } catch {
      // Sin ocultar: el contenido igual va cifrado.
    }
  }
}

/** Fecha de hoy en Honduras (AAAA-MM-DD), según el reloj de esta PC. */
export function licenseToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Tegucigalpa" }).format(new Date());
}

/** Licencia de esta PC (equipo.dat) y lo que recuerda (equipo.idx). */
export function readLocalLicense(file = licenseFile()) {
  return { text: readText(file), seen: unsealSeen(machineCode(), readText(seenFile(file))) };
}

/** Guarda lo recordado: la fecha y la última licencia solo avanzan, nunca retroceden. */
export function rememberSeen(next: SeenState, file = licenseFile()) {
  const current = unsealSeen(machineCode(), readText(seenFile(file)));
  const fecha = [current.fecha, next.fecha].filter(isDate).sort().pop() ?? null;
  const ultima = Math.max(current.ultima, next.ultima);
  if (fecha === current.fecha && ultima === current.ultima) return;
  try {
    writeHidden(seenFile(file), sealSeen(machineCode(), { fecha, ultima }));
  } catch {
    // Sin permiso de escritura: se revisa igual, sin guardar.
  }
}

/** Estado de la licencia guardada en un archivo, para este equipo (solo lee; sin la base). */
export function readLicenseStatus(file = licenseFile(), options: { required?: boolean; publicPem?: string; revocations?: RevocationPayload[] } = {}) {
  const { text, seen } = readLocalLicense(file);
  return evaluateLicense(text, { machine: machineCode(), today: licenseToday(), lastSeen: seen.fecha, minSeq: seen.ultima, required: options.required ?? true, publicPem: options.publicPem, revocations: options.revocations, origen: "equipo" });
}

/**
 * Instala una licencia en este equipo (solo se guarda si es válida para él y no es más
 * vieja que la que tuvo). La usa el gestor de licencias, desde fuera del programa: el
 * programa no tiene cómo cambiarla.
 */
export function installLicense(text: string, file = licenseFile(), publicPem?: string) {
  const previous = readLicenseStatus(file, { publicPem });
  const { seen } = readLocalLicense(file);
  const status = evaluateLicense(text, { machine: machineCode(), today: licenseToday(), lastSeen: seen.fecha, minSeq: seen.ultima, publicPem, origen: "equipo" });
  if (status.valid) {
    writeHidden(file, `${text.replace(/\s+/g, "")}\n`);
    rememberSeen({ fecha: licenseToday(), ultima: status.seq ?? 0 }, file);
  }
  return { previous, status };
}

/**
 * Quita la licencia de este equipo (también desde el gestor). Lo recordado (equipo.idx)
 * se conserva: quitar y volver a poner una licencia vieja o atrasar el reloj no sirve.
 */
export function removeLicense(file = licenseFile()) {
  if (!fs.existsSync(file)) return false;
  fs.rmSync(file, { force: true });
  return true;
}
