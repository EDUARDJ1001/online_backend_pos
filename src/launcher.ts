/**
 * Facturacion.exe: lanzador del programa de escritorio.
 *
 * El ejecutable solo trae Node y este archivo. El programa vive en
 * C:\Facturacion\versiones\<versión>\ y se cambia sin reinstalar (Sistema > Actualizaciones).
 *
 * Al abrir:
 *   1. Lee la versión en uso (versiones\actual.txt).
 *   2. Comprueba su firma y cada archivo; si algo no coincide, prueba con otra versión
 *      instalada, nunca más vieja que la del instalador (no se puede volver a versiones
 *      anteriores, por ejemplo sin licencias).
 *   3. Carga el programa (desktop.ts) con los mismos argumentos (--escritorio, --segundo-plano...).
 *
 * --cambiar-version <pid> <nueva> <anterior> <puerto> <args JSON>
 *   Lo lanza el sistema después de instalar una versión: espera a que se cierre el
 *   proceso <pid>, abre el sistema con la versión nueva y, si no responde, vuelve a la anterior.
 *   Si la nueva arranca bien, borra las versiones anteriores.
 */
import { spawn, spawnSync } from "child_process";
import fs from "fs";
import http from "http";
import { createRequire } from "module";
import path from "path";

import { UPDATES_PUBLIC_KEY } from "./updates/public-key";
import { CURRENT_FILE, LAUNCHER_VERSION, setDesktopRuntime } from "./updates/runtime";
import { compareVersions, isVersionName, verifyVersionDir } from "./updates/version-files";

process.removeAllListeners("warning");
process.noDeprecation = true;

const baseDir = path.dirname(process.execPath);
const versionsDir = path.join(baseDir, "versiones");
const args = process.argv.slice(2);
const APP_TITLE = "Facturación";
/** Versión del instalador (se fija al compilar): ninguna versión más vieja se abre. */
const MINIMUM_VERSION = process.env.FACTURACION_VERSION_MINIMA || "0.0.0";

function log(text: string) {
  console.log(`[${new Date().toISOString()}] [lanzador] ${text}`);
}

/** Aviso de Windows cuando no hay consola donde mostrar el problema. */
function showMessage(text: string) {
  const script = `Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show(@'\n${text.replace(/'@/g, "' @")}\n'@, '${APP_TITLE}') | Out-Null`;
  spawnSync("powershell.exe", ["-NoProfile", "-WindowStyle", "Hidden", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], {
    windowsHide: true
  });
}

function currentVersion() {
  try {
    const value = fs.readFileSync(path.join(versionsDir, CURRENT_FILE), "utf8").trim();
    return isVersionName(value) ? value : null;
  } catch {
    return null;
  }
}

function installedVersions() {
  return fs.existsSync(versionsDir)
    ? fs.readdirSync(versionsDir).filter((name) => isVersionName(name) && fs.statSync(path.join(versionsDir, name)).isDirectory())
    : [];
}

/** Borra las versiones instaladas más viejas que `version` (no se usan más). */
function removeOlderThan(version: string) {
  for (const name of installedVersions().filter((item) => compareVersions(item, version) < 0)) {
    try {
      fs.rmSync(path.join(versionsDir, name), { recursive: true, force: true });
      log(`Se quitó la versión anterior ${name}.`);
    } catch {
      // En uso o sin permiso: se intenta la próxima vez.
    }
  }
}

/**
 * Versiones que se pueden abrir: primero la en uso, después las demás de la más nueva a
 * la más vieja, nunca más viejas que la del instalador.
 */
function candidates() {
  const installed = installedVersions().filter((name) => compareVersions(name, MINIMUM_VERSION) >= 0);
  installed.sort((a, b) => compareVersions(b, a));
  const current = currentVersion();
  return current && installed.includes(current) ? [current, ...installed.filter((name) => name !== current)] : installed;
}

function openVersion() {
  // Las más viejas que el instalador no se pueden usar: se quitan.
  removeOlderThan(MINIMUM_VERSION);
  const problems: string[] = [];
  for (const version of candidates()) {
    const appDir = path.join(versionsDir, version);
    try {
      const info = verifyVersionDir(appDir, UPDATES_PUBLIC_KEY, {
        removeExtra: true,
        onRemoved: (files) => log(`Versión ${version}: se quitaron ${files.length} archivos que no son de la versión (${files.slice(0, 3).join(", ")}${files.length > 3 ? "..." : ""}).`)
      });
      if (info.minLauncher > LAUNCHER_VERSION) {
        throw new Error("necesita un Facturacion.exe más nuevo (instalador)");
      }
      if (problems.length) {
        log(`Se abre la versión ${version}. No se pudo usar: ${problems.join("; ")}`);
      }
      setDesktopRuntime({ launcherVersion: LAUNCHER_VERSION, baseDir, versionsDir, appDir, version, publicKeyPem: UPDATES_PUBLIC_KEY });
      const entry = path.join(appDir, "facturacion.cjs");
      createRequire(entry)(entry);
      return;
    } catch (error) {
      problems.push(`${version}: ${(error as Error).message}`);
    }
  }

  const detail = problems.length ? problems.join("\n") : "No hay ninguna versión instalada.";
  log(`No se pudo abrir el programa. ${detail}`);
  if (args.includes("--escritorio") || args.length === 0) {
    showMessage(`${APP_TITLE} no pudo iniciar: la instalación está incompleta o dañada.\n\nVuelve a instalarlo con InstalarCaja.\n\n${detail}`);
  }
  process.exit(1);
}

// ------------------------------------------------------------ Cambio de versión

function logFilePath() {
  const beside = path.join(baseDir, "facturacion.log");
  try {
    fs.closeSync(fs.openSync(beside, "a"));
    return beside;
  } catch {
    const dir = path.join(process.env.LOCALAPPDATA ?? baseDir, "Facturacion");
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, "facturacion.log");
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function healthVersion(port: number) {
  return new Promise<string | null>((resolve) => {
    const request = http.get({ host: "127.0.0.1", port, path: "/api/health", timeout: 2000 }, (response) => {
      let body = "";
      response.on("data", (chunk) => (body += chunk));
      response.on("end", () => {
        try {
          resolve((JSON.parse(body) as { version?: string }).version ?? null);
        } catch {
          resolve(null);
        }
      });
    });
    request.on("error", () => resolve(null));
    request.on("timeout", () => {
      request.destroy();
      resolve(null);
    });
  });
}

function startSystem(relaunchArgs: string[]) {
  const log = fs.openSync(logFilePath(), "a");
  const child = spawn(process.execPath, relaunchArgs, { cwd: baseDir, detached: true, windowsHide: true, stdio: ["ignore", log, log] });
  child.unref();
  return child;
}

async function switchVersion() {
  // Este proceso corre sin consola: lo que pasa queda en el registro del sistema.
  const logFile = logFilePath();
  const note = (text: string) => fs.appendFileSync(logFile, `[${new Date().toISOString()}] [actualización] ${text}\r\n`);
  const [pidText, next, previous, portText, argsJson] = args.slice(1);
  const pid = Number(pidText);
  const port = Number(portText);
  const relaunchArgs = JSON.parse(argsJson ?? "[]") as string[];
  note(`Cambio de versión ${previous} -> ${next}`);

  for (let attempt = 0; attempt < 60 && isAlive(pid); attempt++) {
    await sleep(500);
  }
  if (isAlive(pid)) {
    spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true });
    await sleep(1000);
  }

  let child = startSystem(relaunchArgs);
  for (let attempt = 0; attempt < 120; attempt++) {
    if ((await healthVersion(port)) === next) {
      note(`Versión ${next} en uso.`);
      // La nueva funciona: las anteriores se borran (no se puede volver a ellas).
      if (isVersionName(next ?? "")) removeOlderThan(next!);
      process.exit(0);
    }
    if (child.exitCode !== null) break;
    await sleep(1000);
  }

  // La versión nueva no arrancó: se vuelve a la anterior.
  note(`La versión ${next} no respondió. Se vuelve a la ${previous}.`);
  if (child.pid && child.exitCode === null) {
    spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
  }
  if (isVersionName(previous ?? "")) {
    fs.writeFileSync(path.join(versionsDir, CURRENT_FILE), previous!);
  }
  await sleep(1000);
  child = startSystem(relaunchArgs);
  process.exit(0);
}

if (args[0] === "--cambiar-version") {
  void switchVersion();
} else {
  openVersion();
}
