/**
 * Programa de escritorio. Lo abre Facturacion.exe (src/launcher.ts) desde la carpeta
 * de la versión en uso.
 *
 * Junto al .exe (C:\Facturacion):
 *   config.env        configuración de esta PC (conexión a la base, puerto, claves de sesión)
 *   versiones/        una carpeta por versión instalada y actual.txt con la que está en uso
 *   facturacion.log   registro cuando corre en segundo plano
 * En la carpeta de la versión (versiones\<versión>):
 *   pantallas/        pantallas del sistema (frontend exportado)
 *   migrations/ y migrations-mssql/   estructura y actualizaciones de la base
 *   assets/, data/    imágenes de documentos y fuentes de los PDF
 *
 * Modos:
 *   (sin argumentos)   servidor con ventana de consola; abre el navegador (PC servidor)
 *   --sin-navegador    igual, sin abrir el navegador
 *   --escritorio       programa de escritorio (caja): levanta el sistema oculto si hace
 *                      falta y lo abre en su propia ventana (Edge/Chrome en modo aplicación)
 *   --segundo-plano    el sistema sin ventana (lo usa --escritorio); escribe en facturacion.log
 *   --crear-config     crea config.env de caja con claves propias, si no existe (lo usa el instalador)
 *   --conexion         prueba la conexión con los datos de FACT_DB_* (variables de entorno,
 *                      para que la contraseña no quede a la vista); con --guardar la escribe en config.env
 */
import { execFile, spawn } from "child_process";
import crypto from "crypto";
import fs from "fs";
import http from "http";
import path from "path";
import readline from "readline";

import dotenv from "dotenv";

import { describeDbConnectionError } from "./config/db-errors";
import { desktopRuntime } from "./updates/runtime";

// Ventana limpia para el usuario: sin advertencias técnicas de Node.
process.removeAllListeners("warning");
process.noDeprecation = true;

const args = process.argv.slice(2);
const baseDir = path.dirname(process.execPath);
/** Carpeta de la versión en uso (sin lanzador, la del .exe). */
const appDir = desktopRuntime()?.appDir ?? baseDir;
const configFile = process.env.FACTURACION_ENV_FILE ? path.resolve(process.env.FACTURACION_ENV_FILE) : path.join(baseDir, "config.env");
/**
 * Registro del modo segundo plano: junto al .exe si se puede escribir ahí; si no
 * (instalación para todos los usuarios en C:\Facturacion), en la carpeta del usuario.
 */
function resolveLogFile() {
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
const logFile = resolveLogFile();
/** Agente de impresión incluido en la instalación de caja (C:\Facturacion\agente). */
const agentExe = path.join(baseDir, "agente", "AgenteImpresion.exe");
const AGENT_PORT = 17777;
const APP_TITLE = "Facturación";
/** Puerto local de una caja (programa de escritorio); lejos del 3000/4000 de desarrollo. */
const DESKTOP_PORT = 4780;

/** Deja la ventana abierta para que se pueda leer el mensaje antes de cerrar. */
function pauseAndExit(code: number): never {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question("\nPresiona Enter para cerrar...", () => process.exit(code));
  // Sin consola interactiva, se cierra igual.
  setTimeout(() => process.exit(code), 10 * 60_000).unref();
  return undefined as never;
}

/** Aviso de Windows (para los modos sin consola). */
function showMessage(text: string) {
  const script = `Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show(@'\n${text.replace(/'@/g, "' @")}\n'@, '${APP_TITLE}') | Out-Null`;
  spawn("powershell.exe", ["-NoProfile", "-WindowStyle", "Hidden", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], {
    detached: true,
    stdio: "ignore",
    windowsHide: true
  }).unref();
}

function secret() {
  return crypto.randomBytes(48).toString("base64url");
}

/** Valor seguro para una línea KEY=valor (mismo criterio que la vista "Base de datos"). */
function envValue(value: string) {
  if (/^[A-Za-z0-9._\-:/@\\]*$/.test(value)) {
    return value;
  }
  if (!value.includes("'")) {
    return `'${value}'`;
  }
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function readConfig(): Record<string, string> {
  return fs.existsSync(configFile) ? dotenv.parse(fs.readFileSync(configFile)) : {};
}

function readPort() {
  return Number(process.env.PORT ?? readConfig().PORT ?? 4000);
}

function isRunning(port: number, urlPath = "/health") {
  return new Promise<boolean>((resolve) => {
    const request = http.get({ host: "127.0.0.1", port, path: urlPath, timeout: 1500 }, (response) => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    request.on("error", () => resolve(false));
    request.on("timeout", () => {
      request.destroy();
      resolve(false);
    });
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ------------------------------------------------------------ Servidor (con o sin ventana)

/**
 * Primer uso en la PC servidor: crea config.env con claves propias y sin base. El sistema
 * arranca igual y pide los datos de la base en la pantalla "Conectar base de datos".
 */
function ensureServerConfig() {
  if (fs.existsSync(configFile)) {
    return;
  }

  fs.writeFileSync(
    configFile,
    [
      "# Configuración de Facturación en esta PC. La conexión a la base se completa desde",
      '# el sistema (pantalla "Conectar base de datos" al abrirlo la primera vez).',
      "# No compartas este archivo: tiene la contraseña de la base y las claves de sesión.",
      "",
      "# Puerto del sistema. Desde otras PCs se entra con http://IP-DE-ESTA-PC:PUERTO",
      "PORT=4000",
      "HOST=0.0.0.0",
      "NODE_ENV=production",
      "",
      "# mssql = SQL Server / Azure SQL (puerto 1433) | mysql = MySQL / MariaDB (puerto 3306)",
      "DB_CLIENT=mssql",
      "DB_HOST=",
      "DB_PORT=1433",
      "DB_USER=",
      "DB_PASSWORD=",
      "DB_NAME=",
      "# REQUIRED para bases en la nube que exigen conexión cifrada.",
      "DB_SSL_MODE=DISABLED",
      "# La caja no cambia la base: las actualizaciones se aplican en Sistema > Base de datos.",
      "DB_AUTO_MIGRATE=false",
      "",
      "# Claves de sesión generadas para esta instalación (no las cambies sin motivo).",
      `JWT_ACCESS_SECRET=${secret()}`,
      `JWT_REFRESH_SECRET=${secret()}`,
      ""
    ].join("\r\n"),
    "utf8"
  );

  console.log("Primer uso: el sistema pedirá los datos de la base de datos en el navegador.");
}

/** Carga el backend (lee la configuración al importarse). */
function startServer(port: number, onFatal: (message: string) => void) {
  process.env.FACTURACION_ENV_FILE = configFile;
  process.env.FRONTEND_DIST ??= path.join(appDir, "pantallas");
  process.env.MIGRATIONS_DIR ??= path.join(appDir, "migrations");
  // La caja nunca cambia la base por su cuenta: solo la revisa. Las actualizaciones
  // las aplica un administrador en Sistema > Base de datos (también en instalaciones
  // anteriores que tenían DB_AUTO_MIGRATE=true en config.env).
  process.env.DB_AUTO_MIGRATE = "false";
  // El programa instalado exige licencia por equipo (equipo.dat, oculto, junto a config.env).
  process.env.FACTURACION_LICENCIA_REQUERIDA = "true";
  // Solo para pruebas: en el programa instalado no se puede cambiar la clave de verificación.
  delete process.env.FACTURACION_LICENCIA_CLAVE_PUBLICA;
  process.env.FACTURACION_LICENCIA_ARCHIVO = path.join(baseDir, "equipo.dat");

  process.on("uncaughtException", (error: NodeJS.ErrnoException) => {
    onFatal(error.code === "EADDRINUSE" ? `El puerto ${port} ya lo usa otro programa. Cambia PORT en config.env.` : error.message);
  });

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("./server");
}

function launchBrowser(port: number) {
  spawn("cmd.exe", ["/c", "start", "", `http://localhost:${port}/`], { detached: true, stdio: "ignore", windowsHide: true }).unref();
}

async function serverMode() {
  const openBrowser = !args.includes("--sin-navegador") && process.env.FACTURACION_NO_BROWSER !== "1";
  ensureServerConfig();

  const port = readPort();
  if (await isRunning(port)) {
    console.log(`El sistema ya está abierto en esta PC (puerto ${port}).${openBrowser ? " Abriendo el navegador..." : ""}`);
    if (openBrowser) launchBrowser(port);
    setTimeout(() => process.exit(0), 1500);
    return;
  }

  console.log("Iniciando Facturación... (no cierres esta ventana mientras se usa el sistema)");
  startServer(port, (message) => {
    console.error(`\nNo se pudo iniciar el sistema:\n  ${message}`);
    pauseAndExit(1);
  });

  if (openBrowser) {
    for (let attempt = 0; attempt < 120; attempt++) {
      if (await isRunning(port)) {
        launchBrowser(port);
        return;
      }
      await sleep(500);
    }
  }
}

/** Sin ventana: todo va a facturacion.log (lo abre --escritorio). */
function backgroundMode() {
  const port = readPort();
  console.log(`\n[${new Date().toISOString()}] Iniciando Facturación en el puerto ${port}...`);
  startServer(port, (message) => {
    console.error(`No se pudo iniciar el sistema: ${message}`);
    process.exit(1);
  });
}

// ------------------------------------------------------------ Programa de escritorio (caja)

function findBrowser() {
  const programFiles = [process.env["ProgramFiles(x86)"], process.env.ProgramW6432, process.env.ProgramFiles].filter(Boolean) as string[];
  const candidates = [
    ...programFiles.map((dir) => path.join(dir, "Microsoft", "Edge", "Application", "msedge.exe")),
    ...programFiles.map((dir) => path.join(dir, "Google", "Chrome", "Application", "chrome.exe")),
    ...(process.env.LOCALAPPDATA ? [path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe")] : [])
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

/**
 * Perfil propio de Edge/Chrome para la ventana del sistema: separa sus procesos de los
 * del navegador del usuario, así el instalador puede cerrar solo esta ventana al actualizar.
 */
const WINDOW_PROFILE = path.join(process.env.LOCALAPPDATA ?? baseDir, "Facturacion", "ventana");

function runPowerShell(script: string, timeoutMs = 8000) {
  return new Promise<string>((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
      { windowsHide: true, timeout: timeoutMs },
      (_error, stdout) => resolve(String(stdout ?? "").trim())
    );
  });
}

/** Si la ventana del sistema ya está abierta, la trae al frente (true) en vez de abrir otra. */
async function focusExistingWindow() {
  const profile = WINDOW_PROFILE.replace(/'/g, "''");
  const result = await runPowerShell(
    `$p = Get-CimInstance Win32_Process -Filter "Name='msedge.exe' OR Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*${profile}*' -and $_.CommandLine -like '*--app=*' } | Select-Object -First 1
if ($p) { (New-Object -ComObject WScript.Shell).AppActivate('${APP_TITLE}') | Out-Null; 'abierta' }`
  );
  return result.includes("abierta");
}

/** Ventana propia del sistema (sin barra de direcciones ni pestañas). */
async function openAppWindow(port: number) {
  if (await focusExistingWindow()) {
    return;
  }
  const url = `http://localhost:${port}/`;
  const browser = findBrowser();
  if (browser) {
    spawn(browser, [`--app=${url}`, `--user-data-dir=${WINDOW_PROFILE}`, "--no-first-run", "--no-default-browser-check"], {
      detached: true,
      stdio: "ignore"
    }).unref();
  } else {
    launchBrowser(port);
  }
}

/** Último motivo de error del registro, para mostrarlo en el aviso. */
function lastLogError() {
  try {
    const lines = fs.readFileSync(logFile, "utf8").trim().split(/\r?\n/).slice(-40);
    const start = lines.map((line) => line.includes("No se pudo iniciar")).lastIndexOf(true);
    return start >= 0 ? lines.slice(start, start + 6).join("\n") : "";
  } catch {
    return "";
  }
}

/** Si el agente de impresión de la instalación no está corriendo (p. ej. otro usuario), lo inicia. */
async function ensurePrintAgent() {
  if (!fs.existsSync(agentExe) || (await isRunning(AGENT_PORT, "/status"))) {
    return;
  }
  spawn(agentExe, ["--run"], { cwd: path.dirname(agentExe), detached: true, stdio: "ignore", windowsHide: true }).unref();
}

async function desktopMode() {
  // Sin base configurada el sistema abre igual y muestra "Conectar base de datos".
  await ensurePrintAgent();
  const port = readPort();
  if (await isRunning(port)) {
    await openAppWindow(port);
    await sleep(500);
    process.exit(0);
  }

  // Registro nuevo en cada arranque (se guarda el anterior).
  try {
    if (fs.existsSync(logFile)) fs.renameSync(logFile, `${logFile}.anterior`);
  } catch {
    // Otro proceso lo tiene abierto: se agrega al final.
  }
  const log = fs.openSync(logFile, "a");
  const child = spawn(process.execPath, ["--segundo-plano"], { cwd: baseDir, detached: true, windowsHide: true, stdio: ["ignore", log, log] });
  let exited = false;
  child.on("exit", () => {
    exited = true;
  });

  for (let attempt = 0; attempt < 120 && !exited; attempt++) {
    if (await isRunning(port)) {
      child.unref();
      await openAppWindow(port);
      await sleep(500);
      process.exit(0);
    }
    await sleep(500);
  }

  const reason = lastLogError();
  showMessage(
    `${APP_TITLE} no pudo iniciar.\n\n${reason || "El sistema tardó demasiado en arrancar."}\n\nSi el problema es la configuración, revísala en el menú Inicio > Facturación > "Editar configuración de Facturación".`
  );
  await sleep(1500);
  process.exit(1);
}

// ------------------------------------------------------------ Conexión a la base (instalador de caja)

async function connectionMode() {
  const existing = readConfig();
  const value = (key: string, fallback = "") => (process.env[`FACT_${key}`] ?? "").trim() || existing[key] || fallback;
  const client = value("DB_CLIENT", "mssql") === "mysql" ? "mysql" : "mssql";
  const settings = {
    client: client as "mysql" | "mssql",
    host: value("DB_HOST", "localhost"),
    port: Number(value("DB_PORT", client === "mssql" ? "1433" : "3306")),
    user: value("DB_USER"),
    // Contraseña vacía = conservar la guardada.
    password: process.env.FACT_DB_PASSWORD ? process.env.FACT_DB_PASSWORD : (existing.DB_PASSWORD ?? ""),
    database: value("DB_NAME", "facturacion"),
    sslMode: (value("DB_SSL_MODE", "DISABLED") === "REQUIRED" ? "REQUIRED" : "DISABLED") as "REQUIRED" | "DISABLED",
    sslCaPath: existing.DB_SSL_CA_PATH || null
  };

  if (!settings.user) {
    console.log("Falta el usuario de la base de datos.");
    process.exit(1);
  }

  // El módulo de base de datos valida la configuración al cargarse: se le dan estos datos.
  Object.assign(process.env, {
    DB_CLIENT: settings.client,
    DB_HOST: settings.host,
    DB_PORT: String(settings.port),
    DB_USER: settings.user,
    DB_PASSWORD: settings.password,
    DB_NAME: settings.database,
    DB_SSL_MODE: settings.sslMode,
    JWT_ACCESS_SECRET: existing.JWT_ACCESS_SECRET || secret(),
    JWT_REFRESH_SECRET: existing.JWT_REFRESH_SECRET || secret()
  });
  process.env.FACTURACION_ENV_FILE = path.join(baseDir, "__sin_config__.env");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const db = require("./config/db") as typeof import("./config/db");

  let empty = false;
  let connection: Awaited<ReturnType<typeof db.openTestConnection>> | null = null;
  try {
    connection = await db.openTestConnection(settings);
    const tables = await db.listTables(connection, settings.client);
    const hasSchema = tables.has("users") && tables.has("companies");
    empty = tables.size === 0;
    if (!hasSchema && !empty) {
      console.log(`La base "${settings.database}" tiene otras tablas y no es del sistema. Usa una base vacía o la que ya usa Facturación.`);
      process.exit(1);
    }
  } catch (error) {
    console.log(describeDbConnectionError(error, settings));
    console.log(`(Detalle: ${(error as Error).message})`);
    process.exit(1);
  } finally {
    await connection?.end().catch(() => undefined);
  }

  console.log(
    empty
      ? `Conexión correcta. La base "${settings.database}" está vacía: al abrir el sistema se pedirá confirmar antes de prepararla (usuario inicial superadmin / Admin123!).`
      : `Conexión correcta con la base "${settings.database}".`
  );

  if (args.includes("--guardar")) {
    const lines = [
      "# Configuración de Facturación en esta PC (programa de escritorio).",
      '# Para cambiar la conexión: menú Inicio > Facturación > "Editar configuración de Facturación".',
      "# No compartas este archivo: tiene la contraseña de la base y las claves de sesión.",
      "",
      `PORT=${existing.PORT || DESKTOP_PORT}`,
      "# Solo esta PC usa este sistema (no se abre a la red).",
      `HOST=${existing.HOST || "127.0.0.1"}`,
      "NODE_ENV=production",
      "",
      `DB_CLIENT=${settings.client}`,
      `DB_HOST=${envValue(settings.host)}`,
      `DB_PORT=${settings.port}`,
      `DB_USER=${envValue(settings.user)}`,
      `DB_PASSWORD=${envValue(settings.password)}`,
      `DB_NAME=${envValue(settings.database)}`,
      `DB_SSL_MODE=${settings.sslMode}`,
      ...(settings.sslCaPath ? [`DB_SSL_CA_PATH=${envValue(settings.sslCaPath)}`] : []),
      "# La caja no cambia la base: las actualizaciones se aplican en Sistema > Base de datos.",
      "DB_AUTO_MIGRATE=false",
      "",
      "# Claves de sesión de esta instalación (no las cambies sin motivo).",
      `JWT_ACCESS_SECRET=${process.env.JWT_ACCESS_SECRET}`,
      `JWT_REFRESH_SECRET=${process.env.JWT_REFRESH_SECRET}`,
      ""
    ];
    fs.writeFileSync(configFile, lines.join("\r\n"), "utf8");
    console.log("Conexión guardada.");
  }
  process.exit(0);
}

// ------------------------------------------------------------

/**
 * Instalación de caja: crea config.env (si no existe) con claves de sesión propias y sin
 * base; la conexión se completa en la pantalla "Conectar base de datos".
 */
function createDesktopConfig() {
  if (!fs.existsSync(configFile)) {
    fs.writeFileSync(
      configFile,
      [
        "# Configuración de Facturación en esta caja.",
        '# La conexión a la base se completa al abrir el programa (pantalla "Conectar base de datos").',
        "# No compartas este archivo: tiene la contraseña de la base y las claves de sesión.",
        "",
        "# Puerto local del sistema (solo lo usa esta PC).",
        `PORT=${DESKTOP_PORT}`,
        "HOST=127.0.0.1",
        "NODE_ENV=production",
        "",
        "DB_CLIENT=mssql",
        "DB_HOST=",
        "DB_PORT=1433",
        "DB_NAME=",
        "DB_USER=",
        "DB_PASSWORD=",
        "DB_SSL_MODE=DISABLED",
        "# La caja no cambia la base: las actualizaciones se aplican en Sistema > Base de datos.",
        "DB_AUTO_MIGRATE=false",
        "",
        "# Claves de sesión de esta instalación (generadas automáticamente, no las cambies).",
        `JWT_ACCESS_SECRET=${secret()}`,
        `JWT_REFRESH_SECRET=${secret()}`,
        ""
      ].join("\r\n"),
      "utf8"
    );
  }
  process.exit(0);
}

async function main() {
  process.title = APP_TITLE;
  // Recursos (imágenes de documentos, fuentes de los PDF) relativos a la versión.
  process.chdir(appDir);

  if (args.includes("--crear-config")) return createDesktopConfig();
  if (args.includes("--conexion")) return connectionMode();
  if (args.includes("--escritorio")) return desktopMode();
  if (args.includes("--segundo-plano")) return backgroundMode();
  return serverMode();
}

void main().catch((error: Error) => {
  const message = `No se pudo iniciar el sistema:\n  ${error.message}`;
  if (args.includes("--escritorio")) {
    showMessage(message);
    setTimeout(() => process.exit(1), 1500);
  } else if (args.includes("--segundo-plano") || args.includes("--conexion")) {
    console.error(message);
    process.exit(1);
  } else {
    console.error(`\n${message}`);
    pauseAndExit(1);
  }
});
