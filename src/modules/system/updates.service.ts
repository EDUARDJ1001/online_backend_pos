import { spawn } from "child_process";
import fs from "fs";
import path from "path";

import { env } from "../../config/env";
import { CURRENT_FILE, desktopRuntime } from "../../updates/runtime";
import {
  compareVersions,
  isVersionName,
  readSignedManifest,
  sha256,
  unpackVersion,
  verifyVersionDir,
  VERSION_FILE,
  type UpdateManifest,
  type VersionInfo
} from "../../updates/version-files";
import { AppError } from "../../utils/http-error";

/**
 * Actualizaciones del programa de escritorio (cajas), sin el instalador.
 *
 * Cada caja revisa la dirección UPDATES_URL (un manifest.json firmado, ver
 * scripts/publicar-version.ts). Si hay una versión más nueva, un administrador la
 * instala desde Sistema > Actualizaciones: se descarga el paquete, se comprueba su
 * firma y cada archivo, se deja en versiones\<versión> y el lanzador reinicia el
 * sistema con ella (si no arranca, vuelve solo a la anterior).
 */

const FIRST_CHECK_MS = 20_000;
const CHECK_EVERY_MS = 6 * 60 * 60_000;
const DOWNLOAD_TIMEOUT_MS = 5 * 60_000;
const MAX_PACKAGE_BYTES = 200 * 1024 * 1024;
/** Versiones anteriores que se conservan para poder volver. */
const KEEP_PREVIOUS = 2;

type Busy = "descargando" | "instalando" | "reiniciando" | null;

let available: UpdateManifest | null = null;
let checkedAt: string | null = null;
let checkError: string | null = null;
let busy: Busy = null;

function updatesUrl() {
  return (env.UPDATES_URL || process.env.FACTURACION_UPDATES_URL || "").trim();
}

function requireRuntime() {
  const runtime = desktopRuntime();
  if (!runtime) {
    throw new AppError("Las actualizaciones se instalan en la versión de escritorio (caja).", 400);
  }
  return runtime;
}

async function download(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { "Cache-Control": "no-cache" } });
    if (!response.ok) {
      throw new Error(`respuesta ${response.status}`);
    }
    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > MAX_PACKAGE_BYTES) {
      throw new Error("archivo demasiado grande");
    }
    return Buffer.from(await response.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

/** Versiones instaladas (carpetas de versiones\), de la más nueva a la más vieja. */
function installedVersions() {
  const runtime = desktopRuntime();
  if (!runtime || !fs.existsSync(runtime.versionsDir)) {
    return [];
  }
  return fs
    .readdirSync(runtime.versionsDir)
    .filter((name) => isVersionName(name) && fs.existsSync(path.join(runtime.versionsDir, name, VERSION_FILE)))
    .sort((a, b) => compareVersions(b, a))
    .map((version) => {
      let info: Partial<VersionInfo> = {};
      try {
        info = JSON.parse(fs.readFileSync(path.join(runtime.versionsDir, version, VERSION_FILE), "utf8")) as VersionInfo;
      } catch {
        // Carpeta dañada: se lista igual; al usarla se comprueba.
      }
      return { version, date: info.date ?? null, notes: info.notes ?? "", current: version === runtime.version };
    });
}

/** Borra versiones viejas: se conservan la en uso y las KEEP_PREVIOUS más recientes. */
function cleanup() {
  const runtime = desktopRuntime();
  if (!runtime || !fs.existsSync(runtime.versionsDir)) return;
  const others = installedVersions().filter((item) => !item.current);
  for (const old of others.slice(KEEP_PREVIOUS)) {
    fs.rmSync(path.join(runtime.versionsDir, old.version), { recursive: true, force: true });
  }
  // Restos de descargas interrumpidas.
  for (const name of fs.readdirSync(runtime.versionsDir)) {
    if (name.endsWith(".nueva")) fs.rmSync(path.join(runtime.versionsDir, name), { recursive: true, force: true });
  }
}

/**
 * Deja `version` como la versión en uso y pide al lanzador reiniciar el sistema con
 * ella. Este proceso se cierra en un momento (las pantallas se recargan solas).
 */
function switchTo(version: string) {
  const runtime = requireRuntime();
  fs.writeFileSync(path.join(runtime.versionsDir, CURRENT_FILE), version);
  spawn(
    process.execPath,
    ["--cambiar-version", String(process.pid), version, runtime.version, String(env.PORT), JSON.stringify(process.argv.slice(2))],
    { cwd: runtime.baseDir, detached: true, stdio: "ignore", windowsHide: true }
  ).unref();
  busy = "reiniciando";
  console.log(`[actualizaciones] Cambiando a la versión ${version}...`);
  setTimeout(() => process.exit(0), 1500);
}

export const updatesService = {
  /** Revisión automática al iniciar y cada 6 horas (solo en la versión de escritorio). */
  start() {
    if (!desktopRuntime()) return;
    try {
      cleanup();
    } catch (error) {
      console.warn("[actualizaciones] No se pudieron borrar versiones viejas:", (error as Error).message);
    }
    setTimeout(() => void this.check().catch(() => undefined), FIRST_CHECK_MS).unref();
    setInterval(() => void this.check().catch(() => undefined), CHECK_EVERY_MS).unref();
  },

  /** Consulta si hay una versión más nueva publicada. */
  async check() {
    const runtime = desktopRuntime();
    const url = updatesUrl();
    if (!runtime || !url) return this.status();
    try {
      const raw = JSON.parse((await download(url, 15_000)).toString("utf8")) as unknown;
      const manifest = readSignedManifest(raw, runtime.publicKeyPem);
      available = compareVersions(manifest.version, runtime.version) > 0 ? manifest : null;
      checkError = null;
    } catch (error) {
      checkError = "No se pudo consultar si hay versiones nuevas. Revisa la conexión a internet.";
      console.warn("[actualizaciones] Revisión fallida:", (error as Error).message);
    }
    checkedAt = new Date().toISOString();
    return this.status();
  },

  /** Versión nueva disponible (para el aviso en pantalla), o null. */
  availableVersion() {
    return available?.version ?? null;
  },

  status() {
    const runtime = desktopRuntime();
    return {
      supported: Boolean(runtime),
      configured: Boolean(updatesUrl()),
      current: runtime?.version ?? process.env.FACTURACION_VERSION ?? "dev",
      available: available
        ? {
            version: available.version,
            date: available.date,
            notes: available.notes,
            size: available.size,
            needsInstaller: Boolean(runtime && available.minLauncher > runtime.launcherVersion)
          }
        : null,
      checkedAt,
      error: checkError,
      busy,
      installed: installedVersions()
    };
  },

  /** Descarga, comprueba e instala la versión disponible; después reinicia el sistema. */
  async apply() {
    const runtime = requireRuntime();
    if (busy) {
      throw new AppError("Ya se está instalando una actualización.", 409);
    }
    const manifest = available;
    if (!manifest) {
      throw new AppError("No hay una versión nueva para instalar.", 400);
    }
    if (manifest.minLauncher > runtime.launcherVersion) {
      throw new AppError("Esta versión necesita el instalador nuevo (InstalarCaja). No se puede instalar desde aquí.", 400);
    }

    const target = path.join(runtime.versionsDir, manifest.version);
    const temporary = `${target}.nueva`;
    try {
      busy = "descargando";
      console.log(`[actualizaciones] Descargando la versión ${manifest.version}...`);
      const data = await download(new URL(manifest.package, updatesUrl()).href, DOWNLOAD_TIMEOUT_MS);
      if (data.length !== manifest.size || sha256(data) !== manifest.sha256) {
        throw new AppError("La descarga llegó incompleta o alterada. Intenta de nuevo.", 502);
      }

      busy = "instalando";
      fs.rmSync(temporary, { recursive: true, force: true });
      unpackVersion(data, temporary);
      fs.rmSync(target, { recursive: true, force: true });
      fs.renameSync(temporary, target);
      try {
        verifyVersionDir(target, runtime.publicKeyPem);
      } catch (error) {
        fs.rmSync(target, { recursive: true, force: true });
        throw new AppError(`La versión descargada no pasó la comprobación de seguridad (${(error as Error).message}).`, 502);
      }
    } catch (error) {
      busy = null;
      fs.rmSync(temporary, { recursive: true, force: true });
      if (error instanceof AppError) throw error;
      console.warn("[actualizaciones] Instalación fallida:", (error as Error).message);
      throw new AppError("No se pudo descargar la actualización. Revisa la conexión a internet e intenta de nuevo.", 502);
    }

    switchTo(manifest.version);
    return { version: manifest.version };
  }
};
