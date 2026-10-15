import { BlockList, isIP } from "net";
import os from "os";

import { AppError } from "../../utils/http-error";

/** IP del cliente en forma canónica ("::ffff:192.168.1.5" -> "192.168.1.5", "::1" -> "127.0.0.1"). */
export function normalizeIp(ip?: string | null) {
  if (!ip) {
    return null;
  }

  const trimmed = ip.trim();

  if (trimmed === "::1") {
    return "127.0.0.1";
  }

  return trimmed.startsWith("::ffff:") && isIP(trimmed.slice(7)) === 4 ? trimmed.slice(7) : trimmed;
}

/**
 * Valida y normaliza una regla: IP suelta ("192.168.1.20") o red CIDR
 * ("192.168.1.0/24", "2001:db8::/48"). Devuelve la forma canónica "ip/prefijo".
 */
export function parseCidr(input: string) {
  const [rawAddress, rawPrefix] = input.trim().split("/");
  const address = normalizeIp(rawAddress) ?? "";
  const family = isIP(address);

  if (!family) {
    throw new AppError("Escribe una IP o red válida, por ejemplo 192.168.1.0/24.", 400);
  }

  const maxPrefix = family === 4 ? 32 : 128;
  const prefix = rawPrefix === undefined ? maxPrefix : Number(rawPrefix);

  if (!Number.isInteger(prefix) || prefix < 0 || prefix > maxPrefix) {
    throw new AppError(`El prefijo de red debe estar entre 0 y ${maxPrefix}.`, 400);
  }

  return { cidr: `${address}/${prefix}`, address, prefix, family: family === 4 ? ("ipv4" as const) : ("ipv6" as const) };
}

/** ¿La IP está dentro de alguna de las reglas? Sin reglas no hay restricción. */
export function ipAllowed(ip: string | null, rules: string[]) {
  if (rules.length === 0) {
    return true;
  }

  const normalized = normalizeIp(ip);
  const family = normalized ? isIP(normalized) : 0;

  if (!normalized || !family) {
    return false;
  }

  const list = new BlockList();

  for (const rule of rules) {
    try {
      const parsed = parseCidr(rule);
      list.addSubnet(parsed.address, parsed.prefix, parsed.family);
    } catch {
      // Regla inválida guardada a mano: se ignora.
    }
  }

  return list.check(normalized, family === 4 ? "ipv4" : "ipv6");
}

/** IP de las interfaces de red de esta PC (donde corre el backend), más loopback. */
export function ownIps() {
  return [
    "127.0.0.1",
    ...Object.values(os.networkInterfaces())
      .flat()
      .filter((item): item is os.NetworkInterfaceInfo => Boolean(item))
      .map((item) => normalizeIp(item.address))
      .filter((ip): ip is string => Boolean(ip))
  ];
}

/**
 * IP con las que se identifica al cliente. Si la petición viene de la misma PC del
 * backend (p. ej. entra por localhost), vale cualquiera de sus IP: así un equipo
 * asignado a 192.168.1.24 se reconoce aunque abra el sistema en localhost.
 */
export function clientIpCandidates(clientIp: string | null) {
  const ip = normalizeIp(clientIp);

  if (!ip) {
    return [];
  }

  const own = ownIps();
  return own.includes(ip) ? Array.from(new Set([ip, ...own])) : [ip];
}
