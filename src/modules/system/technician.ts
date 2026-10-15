import crypto from "crypto";

import type { Request } from "express";

/**
 * Acceso de técnico: abre la pantalla de conexión a la base aunque la base responda y
 * sin iniciar sesión (Ctrl + Shift + F9 en cualquier pantalla).
 *
 * La clave la crea el desarrollador en su PC (npm run tecnico:clave --workspace backend)
 * y va dentro del programa como huella scrypt (FACTURACION_TECNICO_HASH, fijada al
 * compilar; la versión está firmada, así que no se puede cambiar en una caja). No se
 * guarda en ninguna caja ni en la base. Sin huella, el acceso no existe.
 */

const TOKEN_TTL_MS = 15 * 60_000;
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60_000;
export const TECHNICIAN_HEADER = "x-tecnico";

const tokens = new Map<string, number>();
let failures = 0;
let lockedUntil = 0;

/** Huella "scrypt$N$r$p$sal$hash" (base64). */
function storedHash() {
  return (process.env.FACTURACION_TECNICO_HASH ?? "").trim();
}

export function technicianEnabled() {
  return storedHash().startsWith("scrypt$");
}

export function hashTechnicianPassword(password: string) {
  const N = 2 ** 15;
  const r = 8;
  const p = 1;
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password.normalize("NFC"), salt, 32, { N, r, p, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

function matches(password: string) {
  const [kind, N, r, p, salt, hash] = storedHash().split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = crypto.scryptSync(password.normalize("NFC"), Buffer.from(salt, "base64"), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
    maxmem: 64 * 1024 * 1024
  });
  return crypto.timingSafeEqual(actual, expected);
}

export type TechnicianLogin = { ok: true; token: string } | { ok: false; reason: "disabled" | "locked" | "wrong"; minutes?: number };

/** Comprueba la clave; 5 errores seguidos bloquean el acceso 15 minutos. */
export function technicianLogin(password: string): TechnicianLogin {
  if (!technicianEnabled()) return { ok: false, reason: "disabled" };
  const now = Date.now();
  if (now < lockedUntil) return { ok: false, reason: "locked", minutes: Math.ceil((lockedUntil - now) / 60_000) };
  if (!matches(password)) {
    failures += 1;
    if (failures >= MAX_FAILURES) {
      failures = 0;
      lockedUntil = now + LOCK_MS;
      console.warn("[técnico] Demasiadas claves incorrectas: acceso bloqueado 15 minutos.");
    }
    return { ok: false, reason: "wrong" };
  }
  failures = 0;
  for (const [token, expires] of tokens) if (expires < now) tokens.delete(token);
  const token = crypto.randomBytes(32).toString("base64url");
  tokens.set(token, now + TOKEN_TTL_MS);
  console.log("[técnico] Acceso de técnico concedido en esta PC.");
  return { ok: true, token };
}

/** ¿La petición trae un permiso de técnico vigente? */
export function isTechnician(req: Request) {
  const token = req.get(TECHNICIAN_HEADER);
  const expires = token ? tokens.get(token) : undefined;
  return Boolean(expires && expires > Date.now());
}
