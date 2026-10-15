import crypto from "crypto";
import fs from "fs";
import path from "path";

import { formatMachineCode, normalizeMachineCode, signLicense, signMultiLicense, signRevocation, type LicensePayload, type MultiLicensePayload, type RevocationPayload } from "../../src/license/license";
import { licensePrivateKeyFile } from "./key-paths";
import { readProtectedKey } from "./protected-key";

export { licensePrivateKeyFile };

export async function readLicensePrivateKey() {
  const file = licensePrivateKeyFile();
  if (!fs.existsSync(file)) {
    throw new Error(`Falta la clave de licencias (${file}). Créala una vez con: npm run gestor (Crear clave)`);
  }
  return readProtectedKey(file, "licencias");
}

/** Licencias emitidas (registro para consulta): %USERPROFILE%\.facturacion\licencias\ */
export function issuedLicensesDir() {
  return path.join(path.dirname(licensePrivateKeyFile()), "licencias");
}

/** Revisa los datos de una licencia nueva. Devuelve el código de equipo normalizado. */
export function checkLicenseRequest(input: { equipo: string; vence: string | null }) {
  const equipo = normalizeMachineCode(input.equipo);
  if (equipo.length !== 12) {
    throw new Error('El código de equipo tiene 12 caracteres, como lo muestra la pantalla de activación (por ejemplo "7KQ2 M9XA 4PT1").');
  }
  if (input.vence !== null) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.vence) || Number.isNaN(Date.parse(input.vence))) {
      throw new Error("La fecha de vencimiento debe ser AAAA-MM-DD, por ejemplo 2027-12-31.");
    }
    if (input.vence <= new Date().toISOString().slice(0, 10)) throw new Error("La fecha de vencimiento debe ser futura.");
  }
  return equipo;
}

/** Firma una licencia y guarda la copia legible en el registro de licencias emitidas. */
export function issueLicense(input: { equipo: string; empresa: string | null; vence: string | null }, key: crypto.KeyObject) {
  const equipo = checkLicenseRequest(input);
  const payload: LicensePayload = {
    v: 1,
    equipo,
    empresa: input.empresa?.trim() || null,
    vence: input.vence,
    emitida: new Date().toISOString().slice(0, 10),
    id: crypto.randomUUID(),
    seq: Date.now()
  };
  const license = signLicense(payload, key);
  const dir = issuedLicensesDir();
  fs.mkdirSync(dir, { recursive: true });
  // Varias el mismo día para el mismo equipo: no se pisa la copia anterior.
  let file = path.join(dir, `${payload.emitida}_${equipo}.txt`);
  for (let n = 2; fs.existsSync(file); n += 1) file = path.join(dir, `${payload.emitida}_${equipo}_${n}.txt`);
  fs.writeFileSync(
    file,
    [`Equipo: ${formatMachineCode(equipo)}`, `Empresa: ${payload.empresa ?? "(sin nombre)"}`, `Vence: ${payload.vence ?? "permanente"}`, `Emitida: ${payload.emitida}`, `Id: ${payload.id}`, "", license, ""].join("\n"),
    "utf8"
  );
  return { license, file, payload };
}

/** Máximo de equipos en una licencia de varios equipos. */
export const MAX_MULTI = 100;

/**
 * Firma una licencia de varios equipos (la misma para cada PC de la lista) y guarda la
 * copia legible en el registro.
 */
export function issueMultiLicense(input: { equipos: string[]; empresa: string | null; vence: string | null }, key: crypto.KeyObject) {
  const equipos = [...new Set(input.equipos.map((code) => checkLicenseRequest({ equipo: code, vence: input.vence })))];
  if (equipos.length === 0) throw new Error("Agrega al menos un código de equipo.");
  if (equipos.length > MAX_MULTI) throw new Error(`Una licencia puede tener hasta ${MAX_MULTI} equipos.`);
  const payload: MultiLicensePayload = {
    v: 1,
    tipo: "varios",
    equipos,
    empresa: input.empresa?.trim() || null,
    vence: input.vence,
    emitida: new Date().toISOString().slice(0, 10),
    id: crypto.randomUUID(),
    seq: Date.now()
  };
  const license = signMultiLicense(payload, key);
  const dir = issuedLicensesDir();
  fs.mkdirSync(dir, { recursive: true });
  const name = (payload.empresa ?? "varios").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^0-9A-Za-z]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "varios";
  let file = path.join(dir, `${payload.emitida}_VARIOS_${name}.txt`);
  for (let n = 2; fs.existsSync(file); n += 1) file = path.join(dir, `${payload.emitida}_VARIOS_${name}_${n}.txt`);
  fs.writeFileSync(
    file,
    [
      "Tipo: varios",
      `Empresa: ${payload.empresa ?? "(sin nombre)"}`,
      `Equipos: ${equipos.map(formatMachineCode).join(", ")}`,
      `Vence: ${payload.vence ?? "permanente"}`,
      `Emitida: ${payload.emitida}`,
      `Id: ${payload.id}`,
      "",
      license,
      ""
    ].join("\n"),
    "utf8"
  );
  return { license, file, payload };
}

export interface IssuedLicense {
  file: string;
  /** De un equipo o de varios (la misma licencia en cada PC de la lista). */
  tipo: "equipo" | "varios";
  /** Código de equipo (licencia de un equipo; "" en la de varios). */
  equipo: string;
  /** Códigos de los equipos que incluye (uno en la de un equipo). */
  equipos: string[];
  empresa: string;
  vence: string | null;
  emitida: string;
  /** Id de la licencia (para revocarla); vacío en copias anteriores. */
  id: string;
  license: string;
}

/** Licencias emitidas, la más reciente primero. */
export function listIssuedLicenses(): IssuedLicense[] {
  const dir = issuedLicensesDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".txt"))
    .map((name) => {
      const file = path.join(dir, name);
      const text = fs.readFileSync(file, "utf8");
      const field = (label: string) => new RegExp(`^${label}:\\s*(.*)$`, "m").exec(text)?.[1]?.trim() ?? "";
      const vence = field("Vence");
      const multi = field("Tipo") === "varios";
      return {
        file,
        tipo: multi ? ("varios" as const) : ("equipo" as const),
        equipo: multi ? "" : field("Equipo"),
        equipos: (multi ? field("Equipos").split(",") : [field("Equipo")]).map(normalizeMachineCode).filter((code) => code.length === 12),
        empresa: field("Empresa"),
        vence: /^\d{4}-\d{2}-\d{2}$/.test(vence) ? vence : null,
        emitida: field("Emitida"),
        id: field("Id"),
        license: /^FACT[12]\.\S+$/m.exec(text)?.[0] ?? ""
      };
    })
    .filter((item) => item.license)
    // Varias el mismo día: la guardada más tarde primero.
    .map((item) => ({ item, saved: fs.statSync(item.file).mtimeMs }))
    .sort((a, b) => b.item.emitida.localeCompare(a.item.emitida) || b.saved - a.saved)
    .map(({ item }) => item);
}

/** Revocación firmada: anula una licencia (por su id) o las de un equipo emitidas hasta ahora. */
export function issueRevocation(input: { licencia?: string; equipo?: string; motivo: string | null }, key: crypto.KeyObject) {
  if (!input.licencia && !input.equipo) throw new Error("Indica la licencia o el equipo a anular.");
  const seq = Date.now();
  const payload: RevocationPayload = {
    v: 1,
    tipo: "revocacion",
    ...(input.licencia ? { licencia: input.licencia } : {}),
    ...(input.equipo ? { equipo: checkLicenseRequest({ equipo: input.equipo, vence: null }), antes: seq } : {}),
    motivo: input.motivo?.trim() || null,
    emitida: new Date().toISOString().slice(0, 10),
    seq
  };
  return { text: signRevocation(payload, key), payload };
}
