/**
 * Motivo claro de un error al conectar a la base de datos (para pantallas e instaladores).
 */
export function describeDbConnectionError(error: unknown, target: { host: string; port: number; database: string }) {
  const codes: string[] = [];
  let current = error as { code?: string; originalError?: unknown; cause?: unknown } | undefined;
  while (current && typeof current === "object" && codes.length < 5) {
    if (current.code) codes.push(current.code);
    current = (current.originalError ?? current.cause) as typeof current;
  }
  const has = (...list: string[]) => codes.some((code) => list.includes(code));

  if (has("ELOGIN", "ER_ACCESS_DENIED_ERROR")) {
    return `No se pudo entrar a la base "${target.database}": el usuario o la contraseña no son correctos, o ese usuario no tiene acceso a esa base.`;
  }
  if (has("ER_BAD_DB_ERROR")) {
    return `La base "${target.database}" no existe en el servidor.`;
  }
  if (has("ESOCKET", "ECONNREFUSED", "ENOTFOUND", "EINSTLOOKUP", "ETIMEOUT", "ETIMEDOUT", "EHOSTUNREACH", "EAI_AGAIN")) {
    return `No se encontró el servidor de base de datos en ${target.host}:${target.port}. Revisa el nombre o IP y el puerto, que esté encendido y que acepte conexiones de red (TCP/IP y firewall).`;
  }
  return "No se pudo conectar a la base de datos. Revisa los datos e intenta de nuevo.";
}
