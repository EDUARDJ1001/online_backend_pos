/**
 * ¿El origen (http://host:puerto) es de la red local? Acepta:
 *   - localhost y 127.x.x.x
 *   - IPs privadas: 10.x.x.x, 172.16.x.x a 172.31.x.x, 192.168.x.x
 *   - nombres de equipo sin dominio (http://servidor-factura:4000)
 *   - dominios locales: .local, .lan, .home, .internal, .home.arpa, .localdomain
 * Un sitio de internet no puede usar ninguno de estos orígenes.
 * (El agente de impresión tiene la misma regla en apps/print-agent/src/agent.ts.)
 */
const PRIVATE_IPV4 = /^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})$/;
const LOCAL_SUFFIXES = [".local", ".lan", ".home", ".internal", ".home.arpa", ".localdomain"];

export function isLocalNetworkOrigin(origin: string) {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return false;
  }

  const host = url.hostname.toLowerCase();
  return (
    host === "localhost" ||
    host === "[::1]" ||
    PRIVATE_IPV4.test(host) ||
    /^[a-z0-9-]+$/.test(host) ||
    LOCAL_SUFFIXES.some((suffix) => host.endsWith(suffix))
  );
}

/** ¿La página se abrió desde este mismo servidor (mismo host y puerto)? */
export function isSameOrigin(origin: string, host: string | undefined) {
  try {
    return Boolean(host) && new URL(origin).host.toLowerCase() === host!.toLowerCase();
  } catch {
    return false;
  }
}
