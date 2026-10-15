/**
 * Piezas de compilación de la versión de escritorio, compartidas por build-exe.ts
 * (instalador) y publicar-version.ts (actualización por internet).
 */
import { execFileSync, spawnSync } from "child_process";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

import { build } from "esbuild";

import { LAUNCHER_VERSION } from "../../src/updates/runtime";
import { signVersionDir } from "../../src/updates/version-files";
import { privateKeyFile } from "./key-paths";
import { readProtectedKey } from "./protected-key";

export const backendDir = path.resolve(__dirname, "../..");
export const rootDir = path.resolve(backendDir, "../..");
const frontendOut = path.join(rootDir, "apps", "frontend", "out");

export function step(text: string) {
  console.log(`\n== ${text}`);
}

export { privateKeyFile };

/** Huella de la clave de técnico (fuera del repositorio; npm run tecnico:clave). */
export function technicianHashFile() {
  return process.env.FACTURACION_CLAVE_TECNICO_ARCHIVO ?? path.join(os.homedir(), ".facturacion", "clave-tecnico.txt");
}

function readTechnicianHash() {
  const file = technicianHashFile();
  if (!fs.existsSync(file)) {
    console.warn(`\n  AVISO: no hay clave de técnico (${file}). El acceso con Ctrl + Shift + F9 no estará disponible.`);
    console.warn("  Créala con: npm run tecnico:clave --workspace backend\n");
    return "";
  }
  return fs.readFileSync(file, "utf8").trim();
}

let openedKey: crypto.KeyObject | null = null;

/** Clave para firmar versiones (pide la contraseña una sola vez por ejecución). */
export async function readPrivateKey() {
  if (openedKey) return openedKey;
  const file = privateKeyFile();
  if (!fs.existsSync(file)) {
    throw new Error(`Falta la clave para firmar versiones (${file}). Créala una vez con: npm run gestor (Crear clave)`);
  }
  openedKey = await readProtectedKey(file, "actualizaciones");
  return openedKey;
}

function rootPackage() {
  return JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8")) as { version?: string; facturacion?: { updatesUrl?: string } };
}

/** Versión del programa: package.json de la raíz. */
export function appVersion() {
  return rootPackage().version ?? "1.0.0";
}

function copyDir(from: string, to: string, filter: (source: string) => boolean = () => true) {
  fs.cpSync(from, to, { recursive: true, filter: (source) => fs.statSync(source).isDirectory() || filter(source) });
}

/** Exporta las pantallas (apps/frontend/out), salvo que se reutilicen las ya exportadas. */
export function exportScreens(skip: boolean) {
  if (!skip) {
    step("Exportando las pantallas (puede tardar unos minutos)...");
    const result = spawnSync("npm", ["run", "build:desktop", "--workspace", "frontend"], { cwd: rootDir, stdio: "inherit", shell: true });
    if (result.status !== 0) {
      throw new Error("No se pudieron exportar las pantallas.");
    }
  }
  if (!fs.existsSync(path.join(frontendOut, "index.html"))) {
    throw new Error(`No están las pantallas exportadas en ${frontendOut}. Ejecuta sin --sin-pantallas.`);
  }
}

/**
 * Carpeta firmada de una versión: <versionsDir>/<versión>/ con el programa, pantallas,
 * migraciones y recursos.
 */
export async function buildVersionDir(versionsDir: string, version: string, notes: string) {
  // Sin la clave pública de licencias, ningún equipo podría activarse.
  const licenseKey = fs.readFileSync(path.join(backendDir, "src", "license", "public-key.ts"), "utf8");
  if (!/BEGIN PUBLIC KEY/.test(licenseKey)) {
    throw new Error("Falta la clave de licencias. Créala una vez con: npm run gestor (Crear clave)");
  }
  const dir = path.join(versionsDir, version);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  step(`Empaquetando el programa ${version}...`);
  await bundleProgram(path.join(dir, "facturacion.cjs"), version);

  step("Copiando pantallas, migraciones y recursos...");
  copyDir(frontendOut, path.join(dir, "pantallas"));
  for (const folder of ["migrations", "migrations-mssql"]) {
    // Migraciones y la estructura esperada (esquema.json) para revisar la base.
    copyDir(path.join(rootDir, folder), path.join(dir, folder), (source) => source.endsWith(".sql") || path.basename(source) === "esquema.json");
  }
  copyDir(path.join(backendDir, "assets", "invoices"), path.join(dir, "assets", "invoices"));
  copyDir(path.join(path.dirname(require.resolve("pdfkit/package.json")), "js", "data"), path.join(dir, "data"));

  step("Firmando la versión...");
  signVersionDir(dir, { version, date: new Date().toISOString(), notes, minLauncher: LAUNCHER_VERSION }, await readPrivateKey());
  return dir;
}

/**
 * Minificado (nombres internos cortos, sin espacios): leerlo o modificarlo para saltarse
 * la licencia cuesta mucho más. keepNames conserva los nombres de clases y funciones que
 * algunas librerías usan (errores, controladores de la base).
 */
const MINIFY = { minify: true, keepNames: true, legalComments: "none" } as const;

/** El programa completo (src/desktop.ts) en un solo archivo, minificado. */
export async function bundleProgram(outfile: string, version: string) {
  await build({
    entryPoints: [path.join(backendDir, "src", "desktop.ts")],
    bundle: true,
    platform: "node",
    target: "node22",
    format: "cjs",
    outfile,
    logLevel: "warning",
    ...MINIFY,
    // Drivers opcionales de impresora con módulo nativo: si no están, el programa sigue sin ellos.
    external: ["@thiagoelg/node-printer", "printer"],
    define: {
      // Las pantallas se recargan solas cuando cambia.
      "process.env.FACTURACION_VERSION": JSON.stringify(version),
      // Dónde buscar versiones nuevas (config.env puede cambiarlo con UPDATES_URL).
      "process.env.FACTURACION_UPDATES_URL": JSON.stringify(rootPackage().facturacion?.updatesUrl ?? ""),
      // Acceso de técnico: solo la huella de la clave (la versión va firmada).
      "process.env.FACTURACION_TECNICO_HASH": JSON.stringify(readTechnicianHash())
    }
  });
}

/** Facturacion.exe: el lanzador (Node con src/launcher.ts), que abre la versión en uso. */
export async function buildLauncherExe(exe: string) {
  step("Creando Facturacion.exe...");
  // Ninguna versión más vieja que la de este instalador se podrá abrir.
  await buildSeaExe(path.join(backendDir, "src", "launcher.ts"), exe, { "process.env.FACTURACION_VERSION_MINIMA": JSON.stringify(appVersion()) });
}

/** Un .exe autónomo (Node empaquetado con el script): no necesita Node instalado. */
export async function buildSeaExe(entry: string, exe: string, define: Record<string, string> = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "facturacion-exe-"));
  try {
    const bundle = path.join(tmpDir, "programa.cjs");
    await build({
      entryPoints: [entry],
      bundle: true,
      platform: "node",
      target: "node22",
      format: "cjs",
      outfile: bundle,
      logLevel: "warning",
      ...MINIFY,
      define
    });
    const blob = path.join(tmpDir, "sea-prep.blob");
    const seaConfig = path.join(tmpDir, "sea-config.json");
    fs.writeFileSync(seaConfig, JSON.stringify({ main: bundle, output: blob, disableExperimentalSEAWarning: true, useCodeCache: false }, null, 2));
    execFileSync(process.execPath, ["--experimental-sea-config", seaConfig], { stdio: "inherit" });
    fs.mkdirSync(path.dirname(exe), { recursive: true });
    fs.copyFileSync(process.execPath, exe);
    const postject = path.join(path.dirname(require.resolve("postject/package.json")), "dist", "cli.js");
    execFileSync(process.execPath, [postject, exe, "NODE_SEA_BLOB", blob, "--sentinel-fuse", "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"], {
      stdio: "inherit"
    });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
