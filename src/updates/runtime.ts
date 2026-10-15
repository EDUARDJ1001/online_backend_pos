/**
 * Datos que deja el lanzador (Facturacion.exe) al abrir una versión del programa.
 * En desarrollo (npm run dev) no hay lanzador: desktopRuntime() devuelve null.
 */

/** Versión del lanzador. Subirla solo si cambia lo que el lanzador hace (exige reinstalar). */
export const LAUNCHER_VERSION = 1;

export interface DesktopRuntime {
  launcherVersion: number;
  /** Carpeta de Facturacion.exe y config.env (C:\Facturacion). */
  baseDir: string;
  /** C:\Facturacion\versiones */
  versionsDir: string;
  /** Carpeta de la versión en uso. */
  appDir: string;
  version: string;
  /** Clave pública con la que el lanzador comprobó esta versión. */
  publicKeyPem: string;
}

const GLOBAL_KEY = "__facturacionRuntime";

export function setDesktopRuntime(runtime: DesktopRuntime) {
  (globalThis as Record<string, unknown>)[GLOBAL_KEY] = runtime;
}

export function desktopRuntime(): DesktopRuntime | null {
  return ((globalThis as Record<string, unknown>)[GLOBAL_KEY] as DesktopRuntime | undefined) ?? null;
}

/** Versión en uso: actual.txt dentro de la carpeta de versiones. */
export const CURRENT_FILE = "actual.txt";
