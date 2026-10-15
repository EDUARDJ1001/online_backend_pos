/**
 * Gestor de claves y licencias (menú en consola). Es la única forma de instalar o
 * cambiar la licencia de un equipo: el programa solo la lee.
 *
 *   npm run gestor                       (PC del proveedor)
 *   GestorLicencias.exe en una USB       (npm run build:gestor; no necesita Node)
 *
 * - Este equipo: su código, la licencia que tiene, y activarla o cambiarla aquí mismo
 *   (se escribe en la carpeta del programa, C:\Facturacion\equipo.dat).
 * - Generar licencias para otro equipo y ver las emitidas.
 * - Cambiar la contraseña tipo tarjeta de una clave (también vencida).
 * - Crear una clave que falta (solo en la PC del proveedor).
 *
 * La copia de la USB lleva solo la clave de licencias y su registro, junto al .exe.
 * La contraseña de la clave se pide una vez por sesión.
 */
import { execFileSync } from "child_process";
import crypto from "crypto";
import fs from "fs";
import path from "path";

import dotenv from "dotenv";

import {
  evaluateLicense,
  formatMachineCode,
  installLicense,
  machineCode,
  normalizeMachineCode,
  readLicenseStatus,
  readRevocation,
  removeLicense,
  type LicenseStatus,
  type RevocationPayload
} from "../src/license/license";
import { LICENSE_PUBLIC_KEY } from "../src/license/public-key";
import { availableKeys, KEYS, keyState, type KeyName } from "./lib/key-files";
import { isPortable, licensePrivateKeyFile, savedDatabasesFile } from "./lib/key-paths";
import { checkLicenseRequest, issueLicense, issueMultiLicense, issueRevocation, MAX_MULTI, issuedLicensesDir, listIssuedLicenses, readLicensePrivateKey, type IssuedLicense } from "./lib/license-keys";
import { askLine, askSecret, changePassword as changeKeysPassword, createKeysTogether, ensureProtectedKey, openWithPassword, sealWithPassword, expiryFromArgs, formatExpiry } from "./lib/protected-key";

const tty = Boolean(process.stdout.isTTY);
const paint = (code: number) => (text: string) => (tty ? `\x1b[${code}m${text}\x1b[0m` : text);
const red = paint(31);
const green = paint(32);
const yellow = paint(33);
const bold = paint(1);
const dim = paint(2);

const INSTALL_KEYS = [
  "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{AEE80931-C1F9-41F5-A730-9CB00EBF8C4F}_is1",
  "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Facturacion"
];

let licenseKey: crypto.KeyObject | null = null;

function today() {
  return new Date().toISOString().slice(0, 10);
}

const formatDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

// ---------- Este equipo ----------

/** Archivo de la licencia del programa instalado en esta PC (null si no está instalado). */
function installedLicenseFile() {
  if (process.env.FACTURACION_LICENCIA_ARCHIVO) return process.env.FACTURACION_LICENCIA_ARCHIVO;
  const dirs: string[] = [];
  if (process.platform === "win32") {
    for (const key of INSTALL_KEYS) {
      try {
        const output = execFileSync("reg", ["query", key, "/v", "InstallLocation"], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
        const location = /InstallLocation\s+REG_SZ\s+(.+)/.exec(output)?.[1]?.trim();
        if (location) dirs.push(location);
      } catch {
        // Sin esa instalación.
      }
    }
  }
  dirs.push("C:\\Facturacion");
  const dir = dirs.find((candidate) => fs.existsSync(path.join(candidate, "Facturacion.exe")));
  return dir ? path.join(dir, "equipo.dat") : null;
}

/** Clave pública para revisar licencias: la del programa, o la de la clave ya abierta. */
function publicPem() {
  if (process.env.FACTURACION_LICENCIA_CLAVE_PUBLICA) return process.env.FACTURACION_LICENCIA_CLAVE_PUBLICA;
  if (LICENSE_PUBLIC_KEY) return LICENSE_PUBLIC_KEY;
  return licenseKey ? crypto.createPublicKey(licenseKey).export({ type: "spki", format: "pem" }).toString() : "";
}

function describeLicense(status: LicenseStatus) {
  if (status.valid) {
    const owner = `${status.empresa ? `${status.empresa}, ` : ""}${status.tipo === "varios" ? `compartida por ${status.equipos} equipos, ` : ""}`;
    if (!status.vence) return green(`${owner}permanente`);
    const text = `${owner}vence el ${formatDate(status.vence)} (en ${status.daysLeft} días)`;
    return (status.daysLeft ?? 0) <= 30 ? yellow(text) : green(text);
  }
  switch (status.problem) {
    case "missing":
      return yellow("Sin licencia");
    case "expired":
      return red(`Vencida el ${formatDate(status.vence!)}${status.empresa ? ` (${status.empresa})` : ""}`);
    case "other-machine":
      return red("Tiene la licencia de otro equipo");
    case "clock":
      return red("La fecha de esta PC está atrasada");
    default:
      return publicPem() ? red("No válida") : yellow("No se puede revisar todavía (escribe el número de la clave en la opción de activar)");
  }
}

// ---------- Utilidades ----------

function describeKey(name: KeyName) {
  if (keyState(name).state !== "missing") return green("Creada");
  return yellow(isPortable() ? "No está en la USB (copia clave-licencias.pem junto al gestor)" : "No existe todavía (Crear clave)");
}

/** Estado de la contraseña única de las claves. */
function describePassword() {
  const states = availableKeys().map((name) => keyState(name)).filter((state) => state.state !== "missing");
  if (states.length === 0) return dim("Se crea junto con la primera clave");
  if (states.some((state) => state.state === "plain")) return red("Hay una clave sin contraseña. Protégela (Cambiar contraseña).");
  const cards = states.filter((state): state is Extract<typeof state, { state: "card" }> => state.state === "card");
  if (cards.length !== states.length || new Set(cards.map((state) => state.expiry)).size > 1) {
    return yellow("Las claves tienen contraseñas distintas. Unifícalas en una sola (Cambiar contraseña).");
  }
  const state = cards[0]!;
  if (state.expired) return red(`VENCIDA el ${formatExpiry(state.expiry)}. Cámbiala (Cambiar contraseña).`);
  if (state.daysLeft <= 30) return yellow(`Vence el ${formatExpiry(state.expiry)} (en ${state.daysLeft} días). Cámbiala pronto.`);
  return green(`Una sola para todas las claves. Vence el ${formatExpiry(state.expiry)} (en ${state.daysLeft} días).`);
}

function copyToClipboard(text: string) {
  // Solo en Windows y con la terminal a la vista (no en pruebas ni con la salida redirigida).
  if (process.platform !== "win32" || !tty) return false;
  try {
    execFileSync("clip", { input: text, windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

async function pause(text = "Enter para volver al menú...") {
  await askLine(dim(`\n${text}`));
}

async function confirm(question: string, defaultYes: boolean) {
  const answer = (await askLine(`${question} ${defaultYes ? "(S/n)" : "(s/N)"}: `)).trim().toLowerCase();
  return answer === "" ? defaultYes : answer === "s" || answer === "si" || answer === "sí";
}

/** Enter = 12 meses; un número = meses; MM/AA = mes de vencimiento. */
async function askKeyExpiry() {
  for (;;) {
    const value = (await askLine("Vencimiento de la contraseña (Enter = 12 meses, número de meses o MM/AA): ")).trim();
    try {
      return expiryFromArgs(value === "" ? [] : /^\d+$/.test(value) ? ["--meses", value] : ["--vence", value]);
    } catch (error) {
      console.log(red((error as Error).message));
    }
  }
}

/** Fecha de vencimiento de una licencia: DD/MM/AAAA, AAAA-MM-DD o un número de meses. */
function parseLicenseExpiry(text: string) {
  const value = text.trim();
  if (/^\d{1,2}$/.test(value)) {
    const months = Number(value);
    if (months < 1 || months > 60) return null;
    const date = new Date();
    date.setMonth(date.getMonth() + months);
    return date.toISOString().slice(0, 10);
  }
  const local = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  const iso = local ? `${local[3]}-${local[2]!.padStart(2, "0")}-${local[1]!.padStart(2, "0")}` : value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const date = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : null;
}

/** Empresa y vencimiento de una licencia nueva. */
async function askLicenseTerms(current: { empresa: string | null } = { empresa: null }) {
  const typed = (await askLine(current.empresa ? `Empresa (Enter = ${current.empresa}): ` : "Empresa (opcional): ")).trim();
  const empresa = typed || current.empresa;
  return { empresa, vence: await askLicenseExpiry() };
}

/** Permanente (null) o fecha de vencimiento. */
async function askLicenseExpiry() {
  for (;;) {
    const type = (await askLine("Tipo: 1 Permanente, 2 Con vencimiento: ")).trim();
    if (type === "1") return null;
    if (type === "2") {
      for (;;) {
        const vence = parseLicenseExpiry(await askLine("Vence (DD/MM/AAAA, o número de meses): "));
        if (vence && vence > today()) return vence;
        console.log(red("Fecha no válida o pasada. Ejemplos: 31/12/2027, o 12 para doce meses."));
      }
    }
  }
}

function printTerms(equipo: string, empresa: string | null, vence: string | null) {
  console.log(`\n  Equipo:   ${formatMachineCode(equipo)}`);
  console.log(`  Empresa:  ${empresa ?? "(sin nombre)"}`);
  console.log(`  Vence:    ${vence ? formatDate(vence) : "Permanente"}\n`);
}

async function getLicenseKey() {
  if (keyState("licencias").state === "missing") {
    throw new Error(isPortable() ? "Falta la clave de licencias: copia clave-licencias.pem junto al gestor." : "Primero crea la clave de licencias (Crear clave).");
  }
  if (!licenseKey) licenseKey = await readLicensePrivateKey();
  return licenseKey;
}

function normalizeSearch(text: string) {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^0-9A-Z]/g, "");
}

// ---------- Opciones ----------

async function activateHere(file: string) {
  const machine = machineCode();
  console.log(bold("\nActivar este equipo sin base\n"));
  const key = await getLicenseKey();
  const current = readLicenseStatus(file, { publicPem: publicPem() });
  console.log(`Equipo ${formatMachineCode(machine)}. Licencia actual: ${describeLicense(current)}${current.emitida ? dim(`, emitida el ${formatDate(current.emitida)}`) : ""}\n`);

  // La más reciente generada para este equipo (por ejemplo, desde la PC del proveedor), vigente
  // y distinta de la que ya tiene.
  const installed = fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim() : "";
  const newest = listIssuedLicenses().find((item) => item.equipos.includes(machine));
  const ready = newest && newest.license !== installed && (!newest.vence || newest.vence >= today()) ? newest : null;
  let license: string | null = null;
  const kind = ready?.tipo === "varios" ? `de ${ready.equipos.length} equipos, ` : "";
  if (ready && (await confirm(`Hay una licencia ${kind}generada el ${formatDate(ready.emitida)} que incluye este equipo (${ready.empresa}, ${ready.vence ? `vence ${formatDate(ready.vence)}` : "permanente"}). ¿Usarla?`, false))) {
    license = ready.license;
  } else {
    const { empresa, vence } = await askLicenseTerms({ empresa: current.empresa });
    printTerms(machine, empresa, vence);
    if (!(await confirm("¿Activar este equipo con esta licencia?", true))) return;
    license = issueLicense({ equipo: machine, empresa, vence }, key).license;
  }
  installOnThisPC(file, license, key);
}

/** Escribe la licencia en esta PC (equipo.dat) y muestra cómo quedó. */
function installOnThisPC(file: string, license: string, key: crypto.KeyObject) {
  let result: ReturnType<typeof installLicense>;
  try {
    result = installLicense(license, file, crypto.createPublicKey(key).export({ type: "spki", format: "pem" }).toString());
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    throw new Error(code === "EPERM" || code === "EACCES"
      ? `No se pudo guardar en ${path.dirname(file)}. Cierra el gestor y ábrelo como administrador (clic derecho > Ejecutar como administrador).`
      : `No se pudo guardar la licencia: ${(error as Error).message}`);
  }
  if (!result.status.valid) throw new Error(result.status.message ?? "La licencia no es válida para este equipo.");
  console.log(green(`\nEquipo activado: ${describeLicense(result.status)}.`));
  console.log("Si el programa está abierto, entra solo en unos segundos.");
}

async function removeHere(file: string) {
  console.log(bold("\nQuitar la licencia de este equipo\n"));
  const current = readLicenseStatus(file, { publicPem: publicPem() });
  console.log(`Equipo ${formatMachineCode(machineCode())}. Licencia actual: ${describeLicense(current)}${current.emitida ? dim(`, emitida el ${formatDate(current.emitida)}`) : ""}`);
  console.log(yellow("\nEl programa en esta PC se bloquea (muestra \"Equipo sin activar\") hasta activarlo de nuevo."));
  console.log("Los datos no se tocan. La copia de la licencia sigue en el registro por si quieres volver a instalarla.\n");
  // Pide el número de la clave: solo quien la tiene puede quitar licencias.
  await getLicenseKey();
  if ((await askLine('Escribe QUITAR para confirmar (Enter = cancelar): ')).trim().toUpperCase() !== "QUITAR") {
    console.log("Cancelado. No se cambió nada.");
    return;
  }
  try {
    removeLicense(file);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    throw new Error(code === "EPERM" || code === "EACCES"
      ? `No se pudo quitar de ${path.dirname(file)}. Cierra el gestor y ábrelo como administrador (clic derecho > Ejecutar como administrador).`
      : `No se pudo quitar la licencia: ${(error as Error).message}`);
  }
  console.log(green("\nLicencia quitada de este equipo."));
  console.log("Si el programa está abierto, se bloquea en menos de un minuto.");
}

async function generateLicense() {
  console.log(bold("\nGenerar licencia para otro equipo\n"));
  let equipo = "";
  for (;;) {
    const value = await askLine("Código de equipo (Enter = cancelar): ");
    if (!value.trim()) return;
    if (normalizeMachineCode(value).length === 12) {
      equipo = normalizeMachineCode(value);
      break;
    }
    console.log(red("El código tiene 12 caracteres, como lo muestra el programa en esa PC (por ejemplo 7KQ2 M9XA 4PT1)."));
  }
  const { empresa, vence } = await askLicenseTerms();
  checkLicenseRequest({ equipo, vence });
  printTerms(equipo, empresa, vence);
  if (!(await confirm("¿Generar la licencia?", true))) return;

  const { license, file } = issueLicense({ equipo, empresa, vence }, await getLicenseKey());
  console.log(green("\nLicencia generada y guardada en el registro."));
  console.log(dim(license));
  console.log("Para instalarla, abre el gestor en esa PC (Activar este equipo sin base): la ofrece al encontrarla.");
  console.log(dim(`Copia guardada en ${file}`));
}

async function showLicenses() {
  console.log(bold("\nLicencias emitidas\n"));
  const all = listIssuedLicenses();
  if (all.length === 0) {
    console.log("Todavía no hay licencias emitidas.");
    return;
  }
  const search = normalizeSearch(await askLine("Buscar por empresa o código (Enter = todas): "));
  const found = all.filter((item) => !search || normalizeSearch(`${item.empresa} ${item.equipos.join(" ")}`).includes(search));
  const shown = found.slice(0, 30);
  if (shown.length === 0) {
    console.log("No hay licencias que coincidan.");
    return;
  }
  console.log("");
  shown.forEach((item, index) => {
    const state = !item.vence ? green("Permanente") : item.vence < today() ? red(`Vencida ${formatDate(item.vence)}`) : `Vence ${formatDate(item.vence)}`;
    const target = item.tipo === "varios" ? `Varios (${item.equipos.length})` : item.equipo;
    console.log(`  ${String(index + 1).padStart(2)}  ${formatDate(item.emitida)}  ${target.padEnd(16)}  ${item.empresa.slice(0, 28).padEnd(28)}  ${state}`);
  });
  if (found.length > shown.length) console.log(dim(`\n  Se muestran las ${shown.length} más recientes de ${found.length}. Busca para ver otras.`));
  console.log(dim(`  Carpeta: ${issuedLicensesDir()}`));

  const pick = (await askLine("\nNúmero para copiar su licencia (Enter = volver): ")).trim();
  const item = shown[Number(pick) - 1];
  if (!pick || !item) return;
  console.log(`\n${item.license}`);
  console.log(copyToClipboard(item.license) ? green("\nCopiada al portapapeles.") : "");
}

async function chooseKey(question: string, filter: (name: KeyName) => boolean) {
  const names = availableKeys().filter(filter);
  if (names.length === 0) return null;
  if (names.length === 1) return names[0]!;
  const value = (await askLine(`${question} ${names.map((name, index) => `${index + 1} ${name[0]!.toUpperCase()}${name.slice(1)}`).join(", ")} (Enter = cancelar): `)).trim();
  return names[Number(value) - 1] ?? null;
}

async function changePassword() {
  console.log(bold("\nCambiar contraseña\n"));
  const names = availableKeys().filter((key) => keyState(key).state !== "missing");
  if (names.length === 0) {
    console.log(yellow("No hay claves."));
    return;
  }
  console.log(`Se cambia la contraseña de: ${names.map((name) => `clave de ${name}`).join(" y ")}. Queda una sola para todas.`);
  console.log("Las claves no cambian: licencias emitidas, equipos activados y versiones siguen igual.\n");
  const expiry = await askKeyExpiry();
  await changeKeysPassword(names.map((name) => ({ file: KEYS[name].file(), label: name })), expiry);
  licenseKey = null;
  console.log(green(`Contraseña cambiada. Vence el ${formatExpiry(expiry)}.`));
  console.log(yellow("Si tienes otras copias de los archivos .pem (USB o PC), reemplázalas: una copia anterior solo abre con la contraseña anterior."));
}

/**
 * Empezar de nuevo: guarda aparte las claves y el registro actuales (no borra nada) y crea
 * claves nuevas con una sola contraseña. Para cuando se perdió una contraseña.
 */
async function restartKeys() {
  console.log(bold("\nEmpezar de nuevo con las claves\n"));
  console.log("Se crean claves NUEVAS de licencias y de actualizaciones, con una sola contraseña.");
  console.log("Las actuales y el registro de licencias se guardan aparte (no se borran).\n");
  console.log(yellow("Después de esto:"));
  console.log(yellow("  - Las licencias emitidas con la clave anterior dejan de servir en el programa nuevo."));
  console.log(yellow("  - Las cajas instaladas no aceptan actualizaciones por internet: se reinstalan con el instalador nuevo."));
  console.log(yellow("  - Hay que generar el instalador y la USB otra vez.\n"));
  if ((await askLine('Escribe NUEVAS para continuar (Enter = cancelar): ')).trim().toUpperCase() !== "NUEVAS") {
    console.log("Cancelado. No se cambió nada.");
    return;
  }
  const expiry = await askKeyExpiry();
  const names = availableKeys();
  const entries = names.map((name) => ({ file: KEYS[name].file(), label: name }));

  // Primero la contraseña nueva (si no se confirma, no se toca nada); después se guarda lo anterior.
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  const backup = path.join(path.dirname(entries[0]!.file), "anteriores", stamp);
  const pending = entries.map((entry) => ({ entry, temp: `${entry.file}.reinicio` }));
  const created = await createKeysTogether(pending.map(({ entry, temp }) => ({ file: temp, label: entry.label })), expiry);
  fs.mkdirSync(backup, { recursive: true });
  for (const { entry, temp } of pending) {
    if (fs.existsSync(entry.file)) fs.renameSync(entry.file, path.join(backup, path.basename(entry.file)));
    fs.renameSync(temp, entry.file);
  }
  const history = issuedLicensesDir();
  if (fs.existsSync(history)) fs.renameSync(history, path.join(backup, "licencias"));
  for (const item of created) KEYS[item.label as KeyName].writePublic(item.key);
  licenseKey = created.find((item) => item.label === "licencias")?.key ?? null;

  console.log(green("Claves nuevas creadas, con una sola contraseña."));
  console.log(dim(`Las anteriores quedaron en ${backup}`));
  console.log("\nAhora:");
  console.log("  1. npm run verificar");
  console.log("  2. npm run build:instaladores");
  console.log("  3. npm run build:gestor -- --destino E:\\Gestor --con-clave   (reemplaza la clave de la USB)");
  console.log(yellow("Guarda una copia de los archivos .pem nuevos (USB) y la contraseña en tu gestor de contraseñas."));
}

async function createKey() {
  console.log(bold("\nCrear clave\n"));
  const name = await chooseKey("¿Qué clave?", (key) => keyState(key).state === "missing");
  if (!name) return;
  const entry = KEYS[name];
  const hadPublic = /BEGIN PUBLIC KEY/.test(fs.existsSync(entry.publicFile) ? fs.readFileSync(entry.publicFile, "utf8") : "");
  if (hadPublic) {
    console.log(red(`El proyecto ya tiene una clave pública de ${name}, pero falta la privada en esta PC.`));
    console.log(red(name === "licencias"
      ? "Si creas otra, las licencias emitidas dejan de servir en el programa nuevo y hay que activar de nuevo todos los equipos."
      : "Si creas otra, las cajas instaladas no aceptarán actualizaciones hasta reinstalarlas con un instalador nuevo."));
    console.log("Si tienes la copia del archivo .pem, cópiala a la carpeta en lugar de crear otra.");
    if (!(await confirm("¿Crear una clave nueva de todos modos?", false))) return;
  }
  const others = availableKeys().filter((key) => key !== name && keyState(key).state !== "missing").map((key) => ({ file: KEYS[key].file(), label: key }));
  // Con otra clave ya creada se usa su misma contraseña; si no, se crea la contraseña.
  const shareable = others.some((other) => keyState(other.label as KeyName).state === "card");
  const expiry = shareable ? "" : await askKeyExpiry();
  const { key, sharedPassword } = await ensureProtectedKey(entry.file(), name, expiry, others);
  entry.writePublic(key);
  if (name === "licencias") licenseKey = key;
  console.log(green(`Clave de ${name} creada${sharedPassword ? " con la misma contraseña de las otras claves" : ""}.`));
  console.log(`  Privada: ${entry.file()} (cifrada)`);
  console.log(`  Pública: ${entry.publicFile}`);
  console.log(yellow("Guarda una copia del archivo (USB) y el número con su vencimiento en tu gestor de contraseñas."));
  console.log("Genera el instalador nuevo (npm run build:instaladores) y el gestor de la USB (npm run build:gestor) para que usen esta clave.");
}

// ---------- Licencia de varios equipos ----------

function printCodes(codes: string[]) {
  codes.forEach((code, index) => console.log(`  ${String(index + 1).padStart(3)}  ${formatMachineCode(code)}${code === machineCode() ? dim("  (esta PC)") : ""}`));
}

/** Agrega códigos de equipo, uno por línea (Enter vacío para terminar). */
async function askMachineCodes(current: string[]) {
  const codes = [...current];
  console.log("\nEscribe los códigos a agregar, uno por línea (Enter vacío para terminar).");
  for (;;) {
    const value = (await askLine(`Código ${codes.length + 1}: `)).trim();
    if (!value) return codes;
    const code = normalizeMachineCode(value);
    if (code.length !== 12) console.log(red("El código tiene 12 caracteres, como lo muestra el programa en esa PC (por ejemplo 7KQ2 M9XA 4PT1)."));
    else if (codes.includes(code)) console.log(yellow("Ese código ya está en la lista."));
    else if (codes.length >= MAX_MULTI) console.log(red(`Una licencia puede tener hasta ${MAX_MULTI} equipos.`));
    else codes.push(code);
  }
}

async function multiLicense(file: string | null) {
  console.log(bold("\nLicencia de varios equipos\n"));
  console.log("La misma licencia sirve en cada PC de la lista. Para agregar una PC, se genera de nuevo con un código más.");

  const previous = listIssuedLicenses().filter((item) => item.tipo === "varios").slice(0, 15);
  let base: (typeof previous)[number] | null = null;
  if (previous.length) {
    console.log("\nPartir de una ya emitida (para agregar o quitar equipos):");
    previous.forEach((item, index) =>
      console.log(`  ${String(index + 1).padStart(2)}  ${formatDate(item.emitida)}  ${item.empresa}  ${dim(`${item.equipos.length} equipos, ${item.vence ? `vence ${formatDate(item.vence)}` : "permanente"}`)}`)
    );
    base = previous[Number((await askLine("Número (Enter = nueva): ")).trim()) - 1] ?? null;
  }

  let codes = base ? [...base.equipos] : [];
  if (!base && file && (await confirm(`¿Incluir este equipo (${formatMachineCode(machineCode())})?`, true))) codes.push(machineCode());
  if (codes.length) {
    console.log("\nEquipos en la lista:");
    printCodes(codes);
  }
  codes = await askMachineCodes(codes);
  while (codes.length > 0) {
    const remove = (await askLine("Número de un equipo a quitar de la lista (Enter = ninguno): ")).trim();
    if (!remove) break;
    const index = Number(remove) - 1;
    if (!codes[index]) continue;
    console.log(dim(`Quitado ${formatMachineCode(codes[index]!)}.`));
    codes.splice(index, 1);
    printCodes(codes);
  }
  if (codes.length === 0) {
    console.log("Sin equipos: no se generó nada.");
    return;
  }

  const { empresa, vence } = await askLicenseTerms({ empresa: base && base.empresa !== "(sin nombre)" ? base.empresa : null });
  console.log(`\n  Empresa:  ${empresa ?? "(sin nombre)"}`);
  console.log(`  Vence:    ${vence ? formatDate(vence) : "Permanente"}`);
  console.log(`  Equipos:  ${codes.length}`);
  printCodes(codes);
  console.log("");
  if (!(await confirm("¿Generar la licencia?", true))) return;

  const key = await getLicenseKey();
  const { license, file: saved } = issueMultiLicense({ equipos: codes, empresa, vence }, key);
  console.log(green("\nLicencia de varios equipos generada y guardada en el registro."));
  console.log(dim(`Copia guardada en ${saved}`));
  const removed = base ? base.equipos.filter((code) => !codes.includes(code)) : [];
  if (removed.length) {
    console.log(yellow(`Los equipos quitados (${removed.map(formatMachineCode).join(", ")}) siguen funcionando con la licencia anterior hasta que se la quites en esa PC (Quitar la licencia de este equipo).`));
  }
  if (file && codes.includes(machineCode()) && (await confirm("¿Instalarla ahora en este equipo?", true))) installOnThisPC(file, license, key);
  console.log('En cada PC de la lista: abre el gestor y usa "Activar este equipo sin base": la ofrece al encontrarla.');
}

// ---------- Base de datos de esta empresa ----------

interface DbModules {
  db: typeof import("../src/config/db");
  migrations: typeof import("../src/modules/system/migrations.service");
}

let dbModules: DbModules | null = null;
const LICENSE_TABLES = ["system_licenses", "license_devices", "license_revocations"];

/**
 * Conecta con la base del programa instalado (config.env), con el usuario administrador
 * de la base si se indica (el de la caja suele ser limitado y no puede escribir licencias).
 */
type DbSettingsInput = { client: "mysql" | "mssql"; host: string; port: number; database: string; user: string; password: string; sslMode: "REQUIRED" | "DISABLED"; sslCaPath: string | null };

interface SavedDatabase {
  name: string;
  client: "mysql" | "mssql";
  host: string;
  port: number;
  database: string;
  user: string;
  /** Contraseña de la base, cifrada con la contraseña de las claves. */
  password: string;
  sslMode: "REQUIRED" | "DISABLED";
  sslCaPath: string | null;
}

function readSavedDatabases(): SavedDatabase[] {
  try {
    const list = JSON.parse(fs.readFileSync(savedDatabasesFile(), "utf8")) as SavedDatabase[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

async function saveDatabase(name: string, settings: DbSettingsInput) {
  const list = readSavedDatabases().filter((item) => item.name.toLowerCase() !== name.toLowerCase());
  const password = await sealWithPassword(settings.password, licensePrivateKeyFile(), "licencias");
  list.push({ ...settings, name, password });
  list.sort((a, b) => a.name.localeCompare(b.name));
  fs.mkdirSync(path.dirname(savedDatabasesFile()), { recursive: true });
  fs.writeFileSync(savedDatabasesFile(), JSON.stringify(list, null, 2));
}

/** Conexión del proyecto (.env de la PC del proveedor), si la hay. */
function projectDbSettings(): DbSettingsInput | null {
  if (isPortable()) return null;
  const root = path.resolve(__dirname, "../../..");
  const file = [path.join(root, ".env"), path.join(root, "apps", "backend", ".env")].find((candidate) => fs.existsSync(candidate));
  return file ? envDbSettings(file, root) : null;
}

/** Conexión escrita en un archivo .env o config.env (rutas relativas desde `root`). */
function envDbSettings(file: string, root: string): DbSettingsInput | null {
  const values = dotenv.parse(fs.readFileSync(file));
  if (!values.DB_HOST || !values.DB_USER) return null;
  const ca = values.DB_SSL_CA_PATH ? (path.isAbsolute(values.DB_SSL_CA_PATH) ? values.DB_SSL_CA_PATH : path.join(root, values.DB_SSL_CA_PATH)) : null;
  return {
    client: values.DB_CLIENT === "mssql" ? "mssql" : "mysql",
    host: values.DB_HOST,
    port: Number(values.DB_PORT || (values.DB_CLIENT === "mssql" ? 1433 : 3306)),
    database: values.DB_NAME ?? "",
    user: values.DB_USER,
    password: values.DB_PASSWORD ?? "",
    sslMode: values.DB_SSL_MODE === "REQUIRED" ? "REQUIRED" : "DISABLED",
    sslCaPath: ca
  };
}

/** Usa las migraciones del programa instalado en esta PC, si lo hay. */
function useInstalledMigrations(file: string | null) {
  if (!file || process.env.MIGRATIONS_DIR) return;
  const dir = path.dirname(file);
  const actual = path.join(dir, "versiones", "actual.txt");
  if (!fs.existsSync(actual)) return;
  const migrations = path.join(dir, "versiones", fs.readFileSync(actual, "utf8").trim(), "migrations");
  if (fs.existsSync(migrations)) process.env.MIGRATIONS_DIR = migrations;
}

/** Datos de otra base, escritos a mano. */
async function askDbSettings(): Promise<DbSettingsInput> {
  const engine = (await askLine("Motor: 1 MySQL / MariaDB, 2 SQL Server: ")).trim() === "2" ? "mssql" : "mysql";
  const host = (await askLine("Servidor (dirección o nombre): ")).trim();
  if (!host) throw new Error("Falta la dirección del servidor.");
  const defaultPort = engine === "mssql" ? 1433 : 3306;
  const port = Number((await askLine(`Puerto (Enter = ${defaultPort}): `)).trim() || defaultPort);
  const database = (await askLine("Nombre de la base: ")).trim();
  const user = (await askLine("Usuario administrador de la base: ")).trim();
  if (!database || !user) throw new Error("Faltan el nombre de la base o el usuario.");
  const password = await askSecret(`Contraseña de ${user}: `);
  const ssl = await confirm("¿Conexión segura (SSL)? Necesaria en la nube (Aiven, Azure)", false);
  const sslCaPath = ssl ? (await askLine("Certificado CA (ruta del archivo .pem, Enter = ninguno): ")).trim().replace(/^"|"$/g, "") || null : null;
  return { client: engine, host, port, database, user, password, sslMode: ssl ? "REQUIRED" : "DISABLED", sslCaPath };
}

/**
 * Conecta con una base: la del programa instalado en esta PC, la del proyecto (.env), una
 * guardada, u otra escrita a mano (y se puede guardar para la próxima vez).
 */
async function connectDb(file: string | null): Promise<DbModules | null> {
  const config = file ? path.join(path.dirname(file), "config.env") : null;
  const program = config && fs.existsSync(config) ? envDbSettings(config, path.dirname(config)) : null;
  const project = projectDbSettings();
  const saved = readSavedDatabases();

  const options: Array<{ label: string; kind: "program" | "project" | "saved" | "other"; saved?: SavedDatabase }> = [];
  for (const item of saved) options.push({ label: `${item.name}  ${dim(`(${item.database} en ${item.host})`)}`, kind: "saved", saved: item });
  if (program) options.push({ label: `La del programa de esta PC  ${dim(`(${program.database} en ${program.host})`)}`, kind: "program" });
  if (project) options.push({ label: `La del proyecto (.env)  ${dim(`(${project.database} en ${project.host})`)}`, kind: "project" });
  options.push({ label: "Otra empresa (escribir los datos de su base)", kind: "other" });

  let choice = options[0]!;
  if (options.length > 1) {
    console.log("¿Qué empresa?");
    options.forEach((option, index) => console.log(`  ${index + 1}  ${option.label}`));
    const picked = options[Number((await askLine("Número (Enter = cancelar): ")).trim()) - 1];
    if (!picked) return null;
    choice = picked;
  }

  useInstalledMigrations(file);
  let settings: DbSettingsInput;
  let offerSave = false;
  let name: string;
  if (choice.kind === "program") {
    // La caja suele usar el usuario limitado: para escribir licencias hace falta el administrador.
    const user = (await askLine("Usuario administrador de la base (Enter = el del programa): ")).trim();
    settings = user ? { ...program!, user, password: await askSecret(`Contraseña de ${user}: `) } : program!;
    name = program!.database;
  } else if (choice.kind === "project") {
    const database = (await askLine(`Nombre de la base (Enter = ${project!.database}): `)).trim() || project!.database;
    settings = { ...project!, database };
    name = database;
  } else if (choice.kind === "saved") {
    const item = choice.saved!;
    const password = await openWithPassword(item.password, licensePrivateKeyFile(), "licencias");
    if (password === null) throw new Error('No se pudo abrir la contraseña guardada de esa base (otra contraseña de las claves). Vuelve a escribir sus datos con "Otra empresa".');
    settings = { client: item.client, host: item.host, port: item.port, database: item.database, user: item.user, password, sslMode: item.sslMode, sslCaPath: item.sslCaPath };
    name = item.name;
  } else {
    settings = await askDbSettings();
    offerSave = true;
    name = settings.database;
  }
  // Valores internos mínimos para cargar el acceso a la base (no se usan para nada más).
  process.env.JWT_ACCESS_SECRET ??= crypto.randomBytes(24).toString("hex");
  process.env.JWT_REFRESH_SECRET ??= crypto.randomBytes(24).toString("hex");

  /* eslint-disable @typescript-eslint/no-require-imports */
  const modules: DbModules = dbModules ?? { db: require("../src/config/db"), migrations: require("../src/modules/system/migrations.service") };
  /* eslint-enable @typescript-eslint/no-require-imports */
  dbModules = modules;
  await modules.db.switchDatabase(settings);
  if (offerSave && (await confirm("¿Guardar esta empresa para la próxima vez? (la contraseña queda cifrada con la de las claves)", true))) {
    name = (await askLine(`Nombre de la empresa (Enter = ${settings.database}): `)).trim() || settings.database;
    await saveDatabase(name, settings);
    console.log(green(`Guardada como "${name}".`));
  }
  connectedName = name;
  return modules;
}

/** Nombre de la empresa (base) conectada: el guardado, o el nombre de la base. */
let connectedName = "";

/** Si faltan las tablas de licencias, ofrece aplicar las actualizaciones pendientes (solo estructura). */
async function ensureLicenseTables(modules: DbModules) {
  const tables = await modules.db.listTables(modules.db.dbPool);
  if (LICENSE_TABLES.every((table) => tables.has(table))) return true;
  return applyDbUpdates(modules, "La base necesita actualizarse para guardar licencias.");
}

async function applyDbUpdates(modules: DbModules, reason?: string) {
  if (modules.migrations.migrationFiles().length === 0) {
    throw new Error("Desde aquí no se pueden aplicar actualizaciones de la base: usa el gestor en una PC con el programa instalado, o npm run db:actualizar.");
  }
  const status = await modules.migrations.checkSchema(false);
  if (status.empty) throw new Error("La base no tiene el sistema instalado. Ábrela primero con el programa.");
  if (status.unknown.length) throw new Error("La base es más nueva que el programa de esta PC. Actualiza primero el programa.");
  if (status.pending.length === 0) {
    console.log("La base está al día.");
    return true;
  }
  if (reason) console.log(yellow(reason));
  console.log(`Actualizaciones pendientes: ${status.pending.length}. Solo agregan estructura (tablas y columnas): no modifican ni borran datos.`);
  console.log("Haz un respaldo de la base antes.");
  if (!(await confirm("¿Aplicarlas ahora?", false))) return false;
  const applied = await modules.migrations.checkSchema(true);
  if (applied.blocked.length) throw new Error(`No se aplicaron para proteger los datos: ${applied.blocked.map((review) => `${review.file}: ${review.problems.join("; ")}`).join(" | ")}`);
  console.log(green("Base actualizada."));
  return true;
}

function sqlDate(modules: DbModules, column: string) {
  return modules.db.dbClient() === "mssql" ? `CONVERT(VARCHAR(10), ${column}, 23)` : `DATE_FORMAT(${column}, '%Y-%m-%d')`;
}

function sqlAgo(modules: DbModules, column: string) {
  return modules.db.dbClient() === "mssql" ? `DATEDIFF(SECOND, ${column}, SYSUTCDATETIME())` : `TIMESTAMPDIFF(SECOND, ${column}, UTC_TIMESTAMP())`;
}

function describeAgo(seconds: number | null) {
  if (seconds === null || seconds === undefined) return "nunca";
  const value = Math.max(0, Number(seconds));
  if (value < 120) return "hace un momento";
  if (value < 7200) return `hace ${Math.round(value / 60)} min`;
  if (value < 172_800) return `hace ${Math.round(value / 3600)} h`;
  return `hace ${Math.round(value / 86_400)} días`;
}

async function dbSaveLicense(modules: DbModules) {
  console.log(bold("\nGuardar una licencia en la base\n"));
  console.log("Las PCs que estén en la licencia entran sin instalar nada en cada una.");
  const issued = listIssuedLicenses().filter((item) => item.id).slice(0, 20);
  if (issued.length === 0) {
    console.log(yellow('No hay licencias emitidas para guardar. Lo más fácil: "Activar equipos de una empresa" en el menú principal (genera y guarda en un paso).'));
    return;
  }
  issued.forEach((item, index) =>
    console.log(`  ${String(index + 1).padStart(2)}  ${formatDate(item.emitida)}  ${(item.tipo === "varios" ? `Varios (${item.equipos.length})` : item.equipo).padEnd(16)}  ${item.empresa.slice(0, 28).padEnd(28)}  ${item.vence ? `vence ${formatDate(item.vence)}` : "permanente"}`)
  );
  const item = issued[Number((await askLine("\nNúmero de la licencia a guardar (Enter = cancelar): ")).trim()) - 1];
  if (!item) return;
  await getLicenseKey();
  const [exists] = await modules.db.dbPool.query<Array<{ id: number }>>("SELECT id FROM system_licenses WHERE license_id = ?", [item.id]);
  if (exists.length) {
    console.log(yellow("Esa licencia ya está guardada en la base."));
    return;
  }
  await modules.db.dbPool.query("INSERT INTO system_licenses (license_text, license_id, empresa, equipos, vence, emitida) VALUES (?, ?, ?, ?, ?, ?)", [
    item.license,
    item.id,
    item.empresa === "(sin nombre)" ? null : item.empresa.slice(0, 150),
    item.equipos.length,
    item.vence,
    item.emitida
  ]);
  console.log(green("\nLicencia guardada en la base."));
  console.log(`Las PCs de la lista (${item.equipos.map(formatMachineCode).join(", ")}) entran solas en menos de un minuto.`);
}

async function dbLicenses(modules: DbModules) {
  console.log(bold("\nLicencias guardadas en la base\n"));
  const [rows] = await modules.db.dbPool.query<Array<{ id: number; license_id: string; empresa: string | null; equipos: number; vence: string | null; emitida: string }>>(
    `SELECT id, license_id, empresa, equipos, ${sqlDate(modules, "vence")} AS vence, ${sqlDate(modules, "emitida")} AS emitida FROM system_licenses ORDER BY id DESC`
  );
  if (rows.length === 0) {
    console.log("No hay licencias guardadas en la base.");
    return;
  }
  rows.forEach((row, index) =>
    console.log(`  ${String(index + 1).padStart(2)}  ${formatDate(row.emitida)}  ${`${row.equipos} ${row.equipos === 1 ? "equipo" : "equipos"}`.padEnd(12)}  ${(row.empresa ?? "(sin nombre)").slice(0, 28).padEnd(28)}  ${row.vence ? `vence ${formatDate(row.vence)}` : "permanente"}`)
  );
  const row = rows[Number((await askLine("\nNúmero de una licencia para quitarla de la base (Enter = volver): ")).trim()) - 1];
  if (!row) return;
  console.log(yellow("Las PCs que entran por esa licencia se bloquean, salvo que tengan otra (también una más vieja en la PC, si ya usaron esta: hará falta una nueva)."));
  await getLicenseKey();
  if (!(await confirm("¿Quitarla de la base?", false))) return;
  await modules.db.dbPool.query("DELETE FROM system_licenses WHERE id = ?", [row.id]);
  console.log(green("Licencia quitada de la base."));
}

async function dbDevices(modules: DbModules) {
  console.log(bold("\nEquipos que usan el sistema\n"));
  const [rows] = await modules.db.dbPool.query<Array<{ machine_code: string; machine_name: string | null; app_version: string | null; ip_address: string | null; first_seen: string; ago: number | null; conflict_name: string | null; conflict_ago: number | null }>>(
    `SELECT machine_code, machine_name, app_version, ip_address, ${sqlDate(modules, "first_seen")} AS first_seen, ${sqlAgo(modules, "last_seen")} AS ago, conflict_name, ${sqlAgo(modules, "conflict_at")} AS conflict_ago FROM license_devices ORDER BY last_seen DESC`
  );
  if (rows.length === 0) {
    console.log("Todavía ninguna PC con la versión actual abrió el programa con esta base.");
    return;
  }
  rows.forEach((row, index) => {
    const clone = row.conflict_name && row.conflict_ago !== null && Number(row.conflict_ago) < 7 * 86_400 ? red(`  POSIBLE COPIA: el mismo código desde "${row.conflict_name}" ${describeAgo(row.conflict_ago)}`) : "";
    console.log(`  ${String(index + 1).padStart(2)}  ${formatMachineCode(row.machine_code)}  ${(row.machine_name ?? "").slice(0, 20).padEnd(20)}  ${dim(`${row.ip_address ?? ""}  v${row.app_version ?? "?"}  desde ${formatDate(row.first_seen)}, ${describeAgo(row.ago)}`)}${clone}`);
  });
  console.log(dim("\n  POSIBLE COPIA: dos PCs distintas usan el mismo código (código de equipo copiado). Anula ese equipo y dale una licencia nueva a la PC real."));
  const row = rows[Number((await askLine("\nNúmero de un equipo para anular sus licencias (Enter = volver): ")).trim()) - 1];
  if (!row) return;
  await revokeMachine(modules, row.machine_code, row.machine_name);
}

async function revokeMachine(modules: DbModules, code: string, name: string | null) {
  console.log(yellow(`\nSe anulan todas las licencias emitidas hasta hoy para ${formatMachineCode(code)}${name ? ` (${name})` : ""}, también las que tenga instaladas en la PC.`));
  console.log("Para volver a activarla, dale una licencia nueva (generada después de anularla).");
  const motivo = (await askLine("Motivo (opcional): ")).trim() || null;
  const key = await getLicenseKey();
  if (!(await confirm("¿Anular?", false))) return;
  const { text } = issueRevocation({ equipo: code, motivo }, key);
  await modules.db.dbPool.query("INSERT INTO license_revocations (revocation_text, descripcion) VALUES (?, ?)", [text, `Equipo ${formatMachineCode(code)}${name ? ` (${name})` : ""}${motivo ? `: ${motivo}` : ""}`.slice(0, 200)]);
  console.log(green("Equipo anulado. Se bloquea en menos de un minuto."));
}

async function dbRevoke(modules: DbModules) {
  console.log(bold("\nAnular una licencia o un equipo\n"));
  const type = (await askLine("1 Una licencia emitida, 2 Un equipo (por su código) (Enter = cancelar): ")).trim();
  if (type === "2") {
    const value = await askLine("Código de equipo: ");
    if (normalizeMachineCode(value).length !== 12) throw new Error("El código tiene 12 caracteres (por ejemplo 7KQ2 M9XA 4PT1).");
    await revokeMachine(modules, normalizeMachineCode(value), null);
    return;
  }
  if (type !== "1") return;
  const issued = listIssuedLicenses().filter((item) => item.id).slice(0, 20);
  if (issued.length === 0) {
    console.log("No hay licencias emitidas en el registro.");
    return;
  }
  issued.forEach((item, index) =>
    console.log(`  ${String(index + 1).padStart(2)}  ${formatDate(item.emitida)}  ${(item.tipo === "varios" ? `Varios (${item.equipos.length})` : item.equipo).padEnd(16)}  ${item.empresa.slice(0, 28).padEnd(28)}  ${item.vence ? `vence ${formatDate(item.vence)}` : "permanente"}`)
  );
  const item = issued[Number((await askLine("\nNúmero de la licencia a anular (Enter = cancelar): ")).trim()) - 1];
  if (!item) return;
  console.log(yellow("La licencia deja de servir en todas las PCs donde esté (instalada o en la base)."));
  const motivo = (await askLine("Motivo (opcional): ")).trim() || null;
  const key = await getLicenseKey();
  if (!(await confirm("¿Anularla?", false))) return;
  const { text } = issueRevocation({ licencia: item.id, motivo }, key);
  const target = `Licencia del ${formatDate(item.emitida)} (${item.empresa}, ${item.tipo === "varios" ? `${item.equipos.length} equipos` : formatMachineCode(item.equipo)})`;
  await modules.db.dbPool.query("INSERT INTO license_revocations (revocation_text, descripcion) VALUES (?, ?)", [text, `${target}${motivo ? `: ${motivo}` : ""}`.slice(0, 200)]);
  console.log(green("Licencia anulada. Las PCs que la usan se bloquean en menos de un minuto."));
}

async function dbRevocations(modules: DbModules) {
  console.log(bold("\nAnulaciones\n"));
  const [rows] = await modules.db.dbPool.query<Array<{ id: number; descripcion: string | null; created_at: string }>>(
    `SELECT id, descripcion, ${sqlDate(modules, "created_at")} AS created_at FROM license_revocations ORDER BY id DESC`
  );
  if (rows.length === 0) {
    console.log("No hay anulaciones.");
    return;
  }
  rows.forEach((row, index) => console.log(`  ${String(index + 1).padStart(2)}  ${formatDate(row.created_at)}  ${row.descripcion ?? ""}`));
  const row = rows[Number((await askLine("\nNúmero de una anulación para deshacerla (Enter = volver): ")).trim()) - 1];
  if (!row) return;
  await getLicenseKey();
  if (!(await confirm("¿Deshacer esa anulación? Lo anulado vuelve a funcionar", false))) return;
  await modules.db.dbPool.query("DELETE FROM license_revocations WHERE id = ?", [row.id]);
  console.log(green("Anulación deshecha."));
}

// ---------- Equipos de una empresa (todo en un paso) ----------

type CodeState = "activo" | "vencido" | "anulado" | "sin licencia";

interface CompanyState {
  /** Licencias de la base que salen del registro (se sabe a qué equipos cubren). */
  known: Array<{ rowId: number; license: IssuedLicense }>;
  /** Licencias de la base que no están en el registro (emitidas en otra PC o USB). */
  unknown: number;
  latest: IssuedLicense | null;
  devices: Array<{ code: string; name: string | null; ago: number | null }>;
  /** Estado de cada código conocido (equipos registrados y códigos de las licencias). */
  states: Map<string, CodeState>;
}

/**
 * Estado de la empresa conectada: cada código se revisa contra cada licencia de su base
 * (igual que lo hace el programa), con sus anulaciones. Así también cuentan las licencias
 * emitidas desde otra PC o USB para los equipos que ya abrieron el programa.
 */
async function readCompany(modules: DbModules): Promise<CompanyState> {
  const pool = modules.db.dbPool;
  const [rows] = await pool.query<Array<{ id: number; license_id: string; license_text: string }>>("SELECT id, license_id, license_text FROM system_licenses ORDER BY id DESC");
  const [deviceRows] = await pool.query<Array<{ machine_code: string; machine_name: string | null; ago: number | null }>>(
    `SELECT machine_code, machine_name, ${sqlAgo(modules, "last_seen")} AS ago FROM license_devices ORDER BY last_seen DESC`
  );
  const [revocationRows] = await pool.query<Array<{ revocation_text: string }>>("SELECT revocation_text FROM license_revocations");
  const pem = publicPem();
  const revocations = revocationRows.map((row) => readRevocation(String(row.revocation_text), pem)).filter((value): value is RevocationPayload => value !== null);

  const issued = new Map(listIssuedLicenses().filter((item) => item.id).map((item) => [item.id, item]));
  const known: CompanyState["known"] = [];
  let unknown = 0;
  for (const row of rows) {
    const license = issued.get(row.license_id);
    if (license) known.push({ rowId: row.id, license });
    else unknown += 1;
  }
  const devices = deviceRows.map((row) => ({ code: row.machine_code, name: row.machine_name, ago: row.ago }));
  const codes = new Set([...devices.map((device) => device.code), ...known.flatMap((item) => item.license.equipos)]);
  const rank: Record<CodeState, number> = { activo: 3, vencido: 2, anulado: 1, "sin licencia": 0 };
  const revokedMachines = new Set(revocations.map((revocation) => revocation.equipo).filter(Boolean));
  const states = new Map<string, CodeState>();
  for (const code of codes) {
    // Un equipo quitado ya no está en ninguna licencia: se muestra como anulado.
    let best: CodeState = revokedMachines.has(code) ? "anulado" : "sin licencia";
    for (const row of rows) {
      const status = evaluateLicense(String(row.license_text), { machine: code, today: today(), revocations, publicPem: pem, required: true, origen: "base" });
      const state: CodeState = status.valid ? "activo" : status.problem === "expired" ? "vencido" : status.problem === "revoked" ? "anulado" : "sin licencia";
      if (rank[state] > rank[best]) best = state;
    }
    states.set(code, best);
  }
  return { known, unknown, latest: known[0]?.license ?? null, devices, states };
}

const STATE_LABEL: Record<CodeState, (text: string) => string> = { activo: green, vencido: red, anulado: red, "sin licencia": yellow };

/** Lista de equipos de la empresa con su estado; devuelve los códigos en el orden mostrado. */
function printCompany(company: CompanyState) {
  const listed: string[] = [];
  const line = (code: string, name: string, extra: string) => {
    listed.push(code);
    const state = company.states.get(code) ?? "sin licencia";
    console.log(`  ${String(listed.length).padStart(3)}  ${formatMachineCode(code)}  ${name.slice(0, 20).padEnd(20)}  ${STATE_LABEL[state](state.toUpperCase().padEnd(12))}  ${dim(extra)}`);
  };
  if (company.devices.length) console.log("Equipos que abrieron el programa con esta base:");
  for (const device of company.devices) line(device.code, device.name ?? "", describeAgo(device.ago));
  const waiting = [...company.states.keys()].filter((code) => !company.devices.some((device) => device.code === code));
  if (waiting.length) console.log(dim("En la licencia, sin abrir el programa todavía:"));
  for (const code of waiting) line(code, "", "");
  if (listed.length === 0) console.log(yellow("Ninguna PC abrió todavía el programa con esta base. Escribe sus códigos a mano."));
  return listed;
}

/** "2,3" o "T" (todos los sin licencia) sobre la lista mostrada. */
function pickCodes(answer: string, listed: string[], all: string[]) {
  if (answer.trim().toUpperCase() === "T") return all;
  return answer
    .split(/[\s,]+/)
    .map((part) => listed[Number(part) - 1])
    .filter((code): code is string => Boolean(code));
}

/** Vencimiento de la licencia nueva; Enter mantiene el actual (si sigue vigente). */
async function askExpiryKeeping(current: IssuedLicense | null) {
  const keep = current && (!current.vence || current.vence >= today()) ? current.vence : undefined;
  if (keep === undefined) return askLicenseExpiry();
  for (;;) {
    const type = (await askLine(`Tipo: 1 Permanente, 2 Con vencimiento (Enter = igual que ahora: ${keep ? `vence ${formatDate(keep)}` : "permanente"}): `)).trim();
    if (type === "") return keep;
    if (type === "1") return null;
    if (type === "2") {
      for (;;) {
        const vence = parseLicenseExpiry(await askLine("Vence (DD/MM/AAAA, o número de meses): "));
        if (vence && vence > today()) return vence;
        console.log(red("Fecha no válida o pasada. Ejemplos: 31/12/2027, o 12 para doce meses."));
      }
    }
  }
}

/**
 * Genera la licencia de la empresa con esos equipos, la guarda en su base y quita de la base
 * las licencias anteriores que quedan reemplazadas (todos sus equipos están en la nueva o se
 * sacaron a propósito).
 */
async function replaceCompanyLicense(modules: DbModules, company: CompanyState, input: { equipos: string[]; empresa: string | null; vence: string | null }, dropped: string[] = []) {
  const key = await getLicenseKey();
  const pool = modules.db.dbPool;
  let saved: IssuedLicense | null = null;
  if (input.equipos.length) {
    const { file } = issueMultiLicense(input, key);
    saved = listIssuedLicenses().find((item) => item.file === file) ?? null;
    if (!saved?.id) throw new Error("No se pudo leer la licencia recién generada del registro.");
    await pool.query("INSERT INTO system_licenses (license_text, license_id, empresa, equipos, vence, emitida) VALUES (?, ?, ?, ?, ?, ?)", [
      saved.license,
      saved.id,
      input.empresa?.slice(0, 150) ?? null,
      saved.equipos.length,
      saved.vence,
      saved.emitida
    ]);
  }
  const covered = new Set([...input.equipos, ...dropped]);
  const replaced = company.known.filter((item) => item.license.equipos.every((code) => covered.has(code)));
  for (const item of replaced) await pool.query("DELETE FROM system_licenses WHERE id = ?", [item.rowId]);
  return saved;
}

async function activateCompany(file: string | null) {
  console.log(bold("\nActivar equipos de una empresa\n"));
  const modules = await connectDb(file).catch((error: unknown) => {
    throw new Error(dbErrorMessage(error));
  });
  if (!modules || !(await ensureLicenseTables(modules))) return;
  const company = await readCompany(modules);
  const current = company.latest;

  console.log(bold(`\n${connectedName}`));
  console.log(`Licencia actual: ${current ? `${current.empresa}, ${current.equipos.length} ${current.equipos.length === 1 ? "equipo" : "equipos"}, ${current.vence ? `${current.vence < today() ? red("venció") : "vence"} el ${formatDate(current.vence)}` : "permanente"}` : yellow("ninguna")}\n`);
  const listed = printCompany(company);
  const without = listed.filter((code) => company.states.get(code) !== "activo");

  let added: string[] = [];
  if (without.length) {
    const answer = await askLine(`\nEquipos a activar (números separados por coma, T = todos los que no están activos, Enter = ninguno): `);
    added = pickCodes(answer, listed, without).filter((code) => company.states.get(code) !== "activo");
  }
  console.log(dim("PCs que todavía no abrieron el programa con esta base: escribe sus códigos (Enter vacío para terminar)."));
  for (;;) {
    const value = (await askLine("Código de otra PC: ")).trim();
    if (!value) break;
    const code = normalizeMachineCode(value);
    if (code.length !== 12) console.log(red("El código tiene 12 caracteres, como lo muestra el programa en esa PC (por ejemplo 7KQ2 M9XA 4PT1)."));
    else if (company.states.get(code) === "activo" || added.includes(code)) console.log(yellow("Ese equipo ya está en la lista."));
    else added.push(code);
  }

  // Se mantienen los que ya tienen licencia (activa o vencida, para renovar); los anulados solo si se eligen de nuevo.
  const kept = [...company.states].filter(([, state]) => state === "activo" || state === "vencido").map(([code]) => code);
  const equipos = [...new Set([...kept, ...added])];
  if (equipos.length === 0) {
    console.log("No hay equipos para activar.");
    return;
  }
  if (equipos.length > MAX_MULTI) throw new Error(`Una licencia puede tener hasta ${MAX_MULTI} equipos.`);

  const suggested = current && current.empresa !== "(sin nombre)" ? current.empresa : connectedName;
  const empresa = (await askLine(`Empresa (Enter = ${suggested}): `)).trim() || suggested;
  const vence = await askExpiryKeeping(current);
  if (added.length === 0 && current && vence === current.vence && empresa === current.empresa) {
    console.log("No cambió nada: no se generó otra licencia.");
    return;
  }

  console.log(`\n  Empresa:  ${empresa}`);
  console.log(`  Vence:    ${vence ? formatDate(vence) : "Permanente"}`);
  console.log(`  Equipos:  ${equipos.length}${added.length ? green(`  (${added.length} ${added.length === 1 ? "nuevo" : "nuevos"})`) : ""}`);
  printCodes(equipos);
  if (company.unknown) console.log(yellow(`\nLa base tiene ${company.unknown} licencia(s) generadas en otra PC o USB: se dejan como están.`));
  if (!(await confirm("\n¿Activar?", true))) return;

  await replaceCompanyLicense(modules, company, { equipos, empresa, vence });
  console.log(green(`\nListo: ${equipos.length} ${equipos.length === 1 ? "equipo activo" : "equipos activos"} en ${connectedName}.`));
  console.log("Las PCs entran solas en menos de un minuto (con el programa abierto o al abrirlo).");
}

async function removeFromCompany(file: string | null) {
  console.log(bold("\nQuitar un equipo de una empresa\n"));
  const modules = await connectDb(file).catch((error: unknown) => {
    throw new Error(dbErrorMessage(error));
  });
  if (!modules || !(await ensureLicenseTables(modules))) return;
  const company = await readCompany(modules);
  console.log(bold(`\n${connectedName}\n`));
  const listed = printCompany(company);
  if (listed.length === 0) return;
  const removed = pickCodes(await askLine("\nEquipos a quitar (números separados por coma, Enter = cancelar): "), listed, []);
  if (removed.length === 0) return;

  console.log(yellow(`\nSe bloquean en menos de un minuto: ${removed.map(formatMachineCode).join(", ")}.`));
  console.log("También si tienen una licencia instalada en la PC. Los datos no se tocan; para volver a activarlos, usa Activar equipos.");
  const motivo = (await askLine("Motivo (opcional): ")).trim() || null;
  const key = await getLicenseKey();
  if (!(await confirm("¿Quitar?", false))) return;

  for (const code of removed) {
    const name = company.devices.find((device) => device.code === code)?.name ?? null;
    const { text } = issueRevocation({ equipo: code, motivo }, key);
    await modules.db.dbPool.query("INSERT INTO license_revocations (revocation_text, descripcion) VALUES (?, ?)", [text, `Equipo ${formatMachineCode(code)}${name ? ` (${name})` : ""}${motivo ? `: ${motivo}` : ""}`.slice(0, 200)]);
  }
  // Licencia nueva con los que quedan (mismas condiciones), para que la lista quede limpia.
  // Con la licencia vencida no se genera otra: la anulación ya basta.
  const current = company.latest;
  const remaining = [...company.states].filter(([code, state]) => (state === "activo" || state === "vencido") && !removed.includes(code)).map(([code]) => code);
  if (current && (!current.vence || current.vence >= today())) {
    await replaceCompanyLicense(modules, company, { equipos: remaining, empresa: current.empresa === "(sin nombre)" ? null : current.empresa, vence: current.vence }, removed);
  }
  console.log(green(`\nListo. ${remaining.length ? `Siguen activos ${remaining.length} ${remaining.length === 1 ? "equipo" : "equipos"}.` : "La empresa ya no tiene equipos activos."}`));
}

// ---------- Resumen de todas las empresas ----------

/**
 * Recorre las bases guardadas (y la del proyecto): por cada empresa, sus licencias, las
 * PCs registradas, cuáles no tienen licencia y las posibles copias. Los códigos que cubre
 * cada licencia salen del registro de licencias emitidas (en la base van cifrados).
 */
async function companiesSummary() {
  console.log(bold("\nResumen de todas las empresas\n"));
  const project = projectDbSettings();
  const targets: Array<{ name: string; settings: () => Promise<DbSettingsInput> }> = [];
  if (project) targets.push({ name: `Proyecto (.env): ${project.database}`, settings: async () => project });
  for (const item of readSavedDatabases()) {
    targets.push({
      name: item.name,
      settings: async () => {
        const password = await openWithPassword(item.password, licensePrivateKeyFile(), "licencias");
        if (password === null) throw new Error("no se pudo abrir su contraseña guardada (otra contraseña de las claves)");
        return { client: item.client, host: item.host, port: item.port, database: item.database, user: item.user, password, sslMode: item.sslMode, sslCaPath: item.sslCaPath };
      }
    });
  }
  if (targets.length === 0) {
    console.log(yellow('No hay bases guardadas. Usa "Activar equipos de una empresa" > "Otra empresa" y guárdala.'));
    return;
  }

  process.env.JWT_ACCESS_SECRET ??= crypto.randomBytes(24).toString("hex");
  process.env.JWT_REFRESH_SECRET ??= crypto.randomBytes(24).toString("hex");
  /* eslint-disable @typescript-eslint/no-require-imports */
  const db = require("../src/config/db") as typeof import("../src/config/db");
  /* eslint-enable @typescript-eslint/no-require-imports */
  const issued = new Map(listIssuedLicenses().filter((item) => item.id).map((item) => [item.id, item]));
  const totals = { companies: 0, devices: 0, unlicensed: 0, copies: 0 };

  for (const target of targets) {
    let connection: Awaited<ReturnType<typeof db.openTestConnection>> | null = null;
    try {
      const settings = await target.settings();
      connection = await db.openTestConnection(settings);
      const tables = await db.listTables(connection, settings.client);
      const header = `${target.name}  ${dim(`(${settings.database} en ${settings.host})`)}`;
      if (!tables.has("system_licenses")) {
        console.log(`${bold(header)}\n  ${yellow("La base no tiene las tablas de licencias: aplica las actualizaciones (Activar equipos de una empresa las ofrece al conectarse).")}\n`);
        continue;
      }
      const date = (column: string) => (settings.client === "mssql" ? `CONVERT(VARCHAR(10), ${column}, 23)` : `DATE_FORMAT(${column}, '%Y-%m-%d')`);
      const ago = (column: string) => (settings.client === "mssql" ? `DATEDIFF(SECOND, ${column}, SYSUTCDATETIME())` : `TIMESTAMPDIFF(SECOND, ${column}, UTC_TIMESTAMP())`);
      const [licenses] = await connection.query<Array<{ license_id: string; empresa: string | null; equipos: number; vence: string | null }>>(
        `SELECT license_id, empresa, equipos, ${date("vence")} AS vence FROM system_licenses ORDER BY id DESC`
      );
      const [devices] = await connection.query<Array<{ machine_code: string; machine_name: string | null; ago: number | null; conflict_name: string | null; conflict_ago: number | null }>>(
        `SELECT machine_code, machine_name, ${ago("last_seen")} AS ago, conflict_name, ${ago("conflict_at")} AS conflict_ago FROM license_devices ORDER BY last_seen DESC`
      );
      const [revoked] = await connection.query<Array<{ total: number }>>("SELECT COUNT(*) AS total FROM license_revocations");

      // Códigos cubiertos por las licencias de esta base (según el registro de licencias emitidas).
      const covered = new Set<string>();
      let unknown = 0;
      for (const license of licenses) {
        const known = issued.get(license.license_id);
        if (known) known.equipos.forEach((code) => covered.add(code));
        else unknown += 1;
      }
      const copies = devices.filter((device) => device.conflict_name && device.conflict_ago !== null && Number(device.conflict_ago) < 7 * 86_400);
      const unlicensed = unknown ? [] : devices.filter((device) => !covered.has(device.machine_code));

      totals.companies += 1;
      totals.devices += devices.length;
      totals.unlicensed += unlicensed.length;
      totals.copies += copies.length;

      console.log(bold(header));
      if (licenses.length === 0) console.log(`  Licencias:  ${yellow("ninguna guardada en la base")}`);
      licenses.forEach((license, index) =>
        console.log(`  ${index === 0 ? "Licencias: " : "           "} ${license.empresa ?? "(sin nombre)"}, ${license.equipos} ${license.equipos === 1 ? "equipo" : "equipos"}, ${license.vence ? `vence ${formatDate(license.vence)}` : "permanente"}`)
      );
      console.log(`  Equipos:    ${devices.length} registrados${unknown ? "" : `, ${devices.length - unlicensed.length} con licencia`}${unlicensed.length ? red(`, ${unlicensed.length} sin licencia en la base`) : ""}${copies.length ? red(`, ${copies.length} posible copia`) : ""}${Number(revoked[0]?.total) ? dim(`, ${revoked[0]!.total} anulaciones`) : ""}`);
      for (const device of unlicensed) console.log(`    ${red("sin licencia en la base")}  ${formatMachineCode(device.machine_code)}  ${device.machine_name ?? ""}  ${dim(describeAgo(device.ago))}`);
      for (const device of copies) console.log(`    ${red("posible copia")}  ${formatMachineCode(device.machine_code)}  ${device.machine_name ?? ""} y "${device.conflict_name}"`);
      if (unknown) console.log(dim(`    ${unknown} licencia(s) generadas en otra PC o USB: no se puede saber qué equipos cubren desde aquí.`));
      console.log("");
    } catch (error) {
      console.log(`${bold(target.name)}\n  ${red(`No se pudo revisar: ${dbErrorMessage(error)}`)}\n`);
    } finally {
      await connection?.end().catch(() => undefined);
    }
  }
  console.log(dim(`Total: ${totals.companies} empresas revisadas, ${totals.devices} equipos, ${totals.unlicensed} sin licencia en la base, ${totals.copies} posibles copias.`));
  console.log(dim("Una PC sin licencia en la base puede tener una instalada en la propia PC (con la USB)."));
  if (totals.unlicensed) console.log("Para activar un equipo sin licencia: agrega su código a la licencia de esa empresa (Licencia de varios equipos) y guárdala en su base.");
}

async function dbMenu(file: string | null) {
  console.log(bold("\nBase de datos de una empresa\n"));
  const modules = await connectDb(file).catch((error: unknown) => {
    throw new Error(dbErrorMessage(error));
  });
  if (!modules || !(await ensureLicenseTables(modules))) return;
  const settings = modules.db.currentDbSettings();
  for (;;) {
    const count = async (table: string) => Number((await modules.db.dbPool.query<Array<{ total: number }>>(`SELECT COUNT(*) AS total FROM ${table}`))[0][0]?.total ?? 0);
    const [clones] = await modules.db.dbPool.query<Array<{ total: number }>>(`SELECT COUNT(*) AS total FROM license_devices WHERE conflict_at IS NOT NULL AND ${sqlAgo(modules, "conflict_at")} < ${7 * 86_400}`);
    if (tty) console.clear();
    console.log(bold(`\n  BASE DE DATOS: ${settings.database}`) + dim(`  (${settings.host})\n`));
    console.log(`  Licencias guardadas:  ${await count("system_licenses")}`);
    console.log(`  Equipos registrados:  ${await count("license_devices")}${Number(clones[0]?.total) ? red(`  (${clones[0]!.total} con posible copia)`) : ""}`);
    console.log(`  Anulaciones:          ${await count("license_revocations")}\n`);
    const items: { label: string; action: () => Promise<unknown> }[] = [
      { label: "Guardar una licencia en la base", action: () => dbSaveLicense(modules) },
      { label: "Licencias guardadas en la base (ver o quitar)", action: () => dbLicenses(modules) },
      { label: "Equipos que usan el sistema (ver o anular)", action: () => dbDevices(modules) },
      { label: "Anular una licencia o un equipo", action: () => dbRevoke(modules) },
      { label: "Anulaciones (ver o deshacer)", action: () => dbRevocations(modules) },
      { label: "Aplicar actualizaciones pendientes de la base", action: () => applyDbUpdates(modules) }
    ];
    items.forEach((item, index) => console.log(`  ${index + 1}  ${item.label}`));
    console.log("  0  Volver\n");
    const option = (await askLine("Opción: ")).trim();
    if (option === "0" || option === "") return;
    const item = items[Number(option) - 1];
    if (!item) continue;
    try {
      await item.action();
    } catch (error) {
      if ((error as Error).message === "Cancelado.") throw error;
      console.log(red(`\n${dbErrorMessage(error)}`));
    }
    await pause("Enter para volver...");
  }
}

/** Sin permiso para escribir (usuario de la caja): se explica qué hacer. */
function dbErrorMessage(error: unknown) {
  const text = (error as Error).message;
  if (/Access denied for user|Login failed/i.test(text)) return "Usuario o contraseña de la base incorrectos.";
  if (/denied|permission|permiso/i.test(text)) return "El usuario de la base no tiene permiso para esto. Entra con el usuario administrador de la base.";
  if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH|Failed to connect|getaddrinfo/i.test(text)) {
    return "No se pudo conectar con la base de datos: el servidor no responde (apagado, sin red o dirección incorrecta en config.env).";
  }
  return text;
}

// ---------- Menú ----------

async function menu() {
  const file = installedLicenseFile();
  for (;;) {
    if (tty) console.clear();
    const keys = availableKeys();
    const missing = !isPortable() && keys.some((name) => keyState(name).state === "missing");
    console.log(bold(`\n  GESTOR DE LICENCIAS${isPortable() ? " (USB)" : ""}\n`));
    console.log(`  Este equipo:    ${formatMachineCode(machineCode())}${file ? dim(`  (programa en ${path.dirname(file)})`) : dim("  (el programa no está instalado aquí)")}`);
    if (file) {
      const status = readLicenseStatus(file, { publicPem: publicPem() });
      console.log(`  Licencia:       ${describeLicense(status)}`);
      if (status.emitida) console.log(`  Emitida:        ${formatDate(status.emitida)}`);
    }
    console.log("");
    for (const name of keys) console.log(`  Clave de ${name}:${" ".repeat(Math.max(1, 17 - name.length))}${describeKey(name)}`);
    console.log(`  Contraseña:                ${describePassword()}`);
    console.log(`  Licencias emitidas: ${listIssuedLicenses().length}\n`);

    if (missing) console.log(yellow("  Falta una clave: créala en Más opciones > Crear clave.\n"));

    const items: { label: string; action: () => Promise<void> }[] = [
      { label: "Activar equipos de una empresa (agregar PCs, renovar o cambiar vencimiento)", action: () => activateCompany(file) },
      { label: "Quitar un equipo de una empresa", action: () => removeFromCompany(file) },
      { label: "Resumen de todas las empresas", action: companiesSummary }
    ];
    if (file) items.push({ label: "Activar este equipo sin base (licencia guardada en esta PC)", action: () => activateHere(file) });
    items.push({ label: "Más opciones", action: () => moreMenu(file, missing) });
    if (await runMenuChoice(items, "Salir")) return;
  }
}

/** Opciones que casi no se usan: licencias a mano, la base en detalle y las claves. */
async function moreMenu(file: string | null, missing: boolean) {
  for (;;) {
    if (tty) console.clear();
    console.log(bold("\n  MÁS OPCIONES\n"));
    const items: { label: string; action: () => Promise<void> }[] = [];
    if (file && fs.existsSync(file)) items.push({ label: "Quitar la licencia de este equipo", action: () => removeHere(file) });
    items.push({ label: "Generar licencia para otro equipo (sin base)", action: generateLicense });
    items.push({ label: "Licencia de varios equipos a mano (sin base)", action: () => multiLicense(file) });
    items.push({ label: "Ver licencias emitidas", action: showLicenses });
    items.push({ label: "Base de datos de una empresa en detalle (licencias, anulaciones, actualizaciones)", action: () => dbMenu(file) });
    items.push({ label: "Cambiar contraseña", action: changePassword });
    if (missing) items.push({ label: "Crear clave", action: createKey });
    if (!isPortable()) items.push({ label: "Empezar de nuevo con las claves (si perdiste la contraseña)", action: restartKeys });
    if (await runMenuChoice(items, "Volver")) return;
  }
}

/** Muestra las opciones y ejecuta la elegida; true si se eligió salir o volver. */
async function runMenuChoice(items: { label: string; action: () => Promise<void> }[], exitLabel: string) {
  items.forEach((item, index) => console.log(`  ${index + 1}  ${item.label}`));
  console.log(`  0  ${exitLabel}\n`);
  const option = (await askLine("Opción: ")).trim();
  if (option === "0" || option.toLowerCase() === exitLabel.toLowerCase()) return true;
  const item = items[Number(option) - 1];
  if (!item) return false;
  try {
    await item.action();
  } catch (error) {
    if ((error as Error).message === "Cancelado.") throw error;
    console.log(red(`\n${(error as Error).message}`));
  }
  // Los submenús tienen su propio "Volver".
  if (item.label !== "Más opciones") await pause();
  return false;
}

menu()
  .catch(async (error) => {
    if ((error as Error).message === "Cancelado.") return;
    console.error(red((error as Error).message));
    process.exitCode = 1;
    // Abierto con doble clic: que se alcance a leer antes de cerrar la ventana.
    if (isPortable()) await pause("Enter para cerrar...").catch(() => undefined);
  })
  .finally(async () => {
    process.stdin.pause();
    await dbModules?.db.dbPool.end().catch(() => undefined);
  });
