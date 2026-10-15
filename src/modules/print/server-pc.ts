import type { Request } from "express";

import { normalizeIp, ownIps } from "../caja/caja-network";

/**
 * ¿La petición viene de la misma PC donde corre el backend? Se compara la IP del
 * cliente con loopback y con las IP de las interfaces de red de este equipo.
 * La impresora del servidor (PRINTER_INTERFACE) solo se usa desde esa PC: así
 * ninguna otra caja termina imprimiendo en la impresora del servidor.
 */
export function isRequestFromServerPc(req: Request) {
  const ip = normalizeIp(req.ip);
  return ip ? ownIps().includes(ip) : false;
}
