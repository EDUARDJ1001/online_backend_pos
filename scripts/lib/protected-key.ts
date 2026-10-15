/**
 * Claves privadas protegidas con contraseña (licencias y actualizaciones), en la PC del
 * proveedor. El archivo .pem va cifrado (AES-256): sin la contraseña no sirve.
 *
 * La contraseña tiene forma de tarjeta: un número de 16 caracteres en grupos de 4
 * (el último es dígito de control: detecta errores al escribirlo) y un vencimiento MM/AA.
 * El vencimiento va escrito en el archivo y forma parte del cifrado: si alguien lo edita
 * para alargarlo, la clave ya no abre. Al vencer, la clave no se usa hasta cambiar la
 * contraseña (la clave en sí no cambia: las cajas no notan nada).
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";

/** Crockford: sin I, L, O, U (no se confunden al escribir). */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const DEFAULT_MONTHS = 12;
const WARN_DAYS = 30;

/** Lo ya leído sin terminal interactiva que sobra de la línea anterior. */
let pendingInput = "";

/** Pide un dato sin mostrarlo en pantalla (si la terminal lo permite). */
export function askSecret(question: string): Promise<string> {
  return ask(question, false);
}

/** Pide un dato a la vista. */
export function askLine(question: string): Promise<string> {
  return ask(question, true);
}

function ask(question: string, visible: boolean): Promise<string> {
  const input = process.stdin;
  process.stdout.write(question);
  if (!input.isTTY) {
    // Sin terminal interactiva (por ejemplo, Git Bash): se lee la línea tal cual.
    // Mientras espera, la entrada mantiene vivo el proceso; al terminar, ya no.
    const handle = input as unknown as { ref?: () => void; unref?: () => void };
    handle.ref?.();
    return new Promise((resolve) => {
      const takeLine = () => {
        const end = pendingInput.indexOf("\n");
        if (end < 0) return false;
        const line = pendingInput.slice(0, end).replace(/\r$/, "");
        pendingInput = pendingInput.slice(end + 1);
        handle.unref?.();
        resolve(line);
        return true;
      };
      if (takeLine()) return;
      const onData = (chunk: Buffer) => {
        pendingInput += chunk.toString("utf8");
        if (takeLine()) {
          input.off("data", onData);
          input.pause();
        }
      };
      input.on("data", onData);
      input.resume();
    });
  }
  return new Promise((resolve, reject) => {
    let value = "";
    input.setRawMode(true);
    input.resume();
    const onData = (chunk: Buffer) => {
      // Sin las secuencias de control de la terminal: al pegar (VS Code y otras envuelven
      // lo pegado en ESC[200~ ... ESC[201~) y teclas como las flechas.
      const text = chunk.toString("utf8").replace(/\x1b\[[0-9;?]*[~A-Za-z]/g, "").replace(/\x1b./g, "");
      for (const char of text) {
        if (char === "\r" || char === "\n") {
          input.off("data", onData);
          input.setRawMode(false);
          input.pause();
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (char === "\u0003") {
          input.off("data", onData);
          input.setRawMode(false);
          input.pause();
          process.stdout.write("\n");
          reject(new Error("Cancelado."));
          return;
        }
        if (char === "\u0008" || char === "\u007f") {
          if (visible && value) process.stdout.write("\b \b");
          value = value.slice(0, -1);
        } else if (char >= " ") {
          value += char;
          if (visible) process.stdout.write(char);
        }
      }
    };
    input.on("data", onData);
  });
}

// ---------- Contraseña tipo tarjeta ----------

/** Dígito de control Luhn mod 32 (como el de las tarjetas, sobre el alfabeto Crockford). */
function checkChar(payload: string) {
  let factor = 2;
  let sum = 0;
  for (let i = payload.length - 1; i >= 0; i -= 1) {
    let addend = factor * ALPHABET.indexOf(payload[i]!);
    factor = factor === 2 ? 1 : 2;
    addend = Math.floor(addend / 32) + (addend % 32);
    sum += addend;
  }
  return ALPHABET[(32 - (sum % 32)) % 32]!;
}

/** Como se escriba: sin espacios ni guiones, en mayúsculas; O = 0, I y L = 1. */
export function normalizeCardNumber(text: string) {
  return text.toUpperCase().replace(/O/g, "0").replace(/[IL]/g, "1").replace(/[^0-9A-Z]/g, "");
}

export function isValidCardNumber(text: string) {
  const value = normalizeCardNumber(text);
  return value.length === 16 && [...value].every((char) => ALPHABET.includes(char)) && checkChar(value.slice(0, 15)) === value[15];
}

export function formatCardNumber(text: string) {
  return normalizeCardNumber(text).replace(/(.{4})(?=.)/g, "$1 ");
}

/** 15 caracteres al azar (75 bits) + dígito de control. */
export function generateCardNumber() {
  const payload = Array.from({ length: 15 }, () => ALPHABET[crypto.randomInt(32)]).join("");
  return payload + checkChar(payload);
}

// ---------- Vencimiento ----------

function currentMonth(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/** Vence al final del mes que resulta de sumar `months` al actual. YYYY-MM. */
function expiryAfterMonths(months: number, now = new Date()) {
  const date = new Date(now.getFullYear(), now.getMonth() + months, 1);
  return currentMonth(date);
}

/** "10/27" → "2027-10". */
function parseExpiry(text: string) {
  const match = /^(\d{2})\/(\d{2})$/.exec(text.trim());
  if (!match || Number(match[1]) < 1 || Number(match[1]) > 12) return null;
  return `20${match[2]}-${match[1]}`;
}

export function formatExpiry(expiry: string) {
  return `${expiry.slice(5, 7)}/${expiry.slice(2, 4)}`;
}

/** Vencida cuando ya pasó el mes indicado (vale hasta el último día de ese mes). */
export function isExpired(expiry: string, now = new Date()) {
  return currentMonth(now) > expiry;
}

/** Días que faltan hasta el último día del mes de vencimiento. */
export function daysUntilExpiry(expiry: string, now = new Date()) {
  const end = new Date(Number(expiry.slice(0, 4)), Number(expiry.slice(5, 7)), 0, 23, 59, 59);
  return Math.ceil((end.getTime() - now.getTime()) / 86_400_000);
}

/** --meses N o --vence MM/AA (por defecto, 12 meses). */
export function expiryFromArgs(argv: string[], now = new Date()) {
  const value = (name: string) => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const vence = value("--vence");
  if (vence) {
    const expiry = parseExpiry(vence);
    if (!expiry) throw new Error("El vencimiento debe ser MM/AA, por ejemplo --vence 10/27.");
    if (isExpired(expiry, now) || expiry === currentMonth(now)) throw new Error("El vencimiento debe ser un mes futuro.");
    if (expiry > expiryAfterMonths(60, now)) throw new Error("El vencimiento puede ser de 5 años como máximo.");
    return expiry;
  }
  const months = Number(value("--meses") ?? DEFAULT_MONTHS);
  if (!Number.isInteger(months) || months < 1 || months > 60) throw new Error("--meses debe ser un número entre 1 y 60.");
  return expiryAfterMonths(months, now);
}

// ---------- Archivo de la clave ----------

const passphraseOf = (number: string, expiry: string) => `${normalizeCardNumber(number)}|${expiry}`;

export function isProtectedPem(pem: string) {
  return pem.includes("ENCRYPTED PRIVATE KEY");
}

/** Vencimiento escrito en el archivo (null = clave sin contraseña tipo tarjeta). */
export function pemExpiry(pem: string) {
  const header = pem.slice(0, Math.max(0, pem.indexOf("-----BEGIN")));
  const match = /^Vence:\s*(\d{2}\/\d{2})\s*$/m.exec(header);
  return match ? parseExpiry(match[1]!) : null;
}

/** Archivo .pem cifrado con número + vencimiento (el vencimiento queda a la vista arriba). */
export function buildCardPem(key: crypto.KeyObject, label: string, number: string, expiry: string) {
  const pem = key.export({ type: "pkcs8", format: "pem", cipher: "aes-256-cbc", passphrase: passphraseOf(number, expiry) }).toString();
  return `Clave de ${label} (Facturación)\nVence: ${formatExpiry(expiry)}\n\n${pem}`;
}

/** Abre un .pem con contraseña tipo tarjeta. null si el número no corresponde. */
export function openCardPem(pem: string, number: string) {
  const expiry = pemExpiry(pem);
  if (!expiry) return null;
  try {
    return crypto.createPrivateKey({ key: pem, format: "pem", passphrase: passphraseOf(number, expiry) });
  } catch {
    return null;
  }
}

// ---------- Una sola contraseña para todas las claves ----------
//
// Las claves (licencias y actualizaciones) usan el mismo número tipo tarjeta y el mismo
// vencimiento. Se pide una vez por sesión; cambiarla cambia todas juntas.

const CHANGE_HINT = "npm run gestor > Cambiar contraseña";
const publicPemOf = (key: crypto.KeyObject) => crypto.createPublicKey(key).export({ type: "spki", format: "pem" }).toString();

/** Número ya escrito en esta sesión (sirve para todas las claves). */
let sessionNumber: string | null = null;

export interface KeyEntry {
  file: string;
  label: string;
}

/**
 * Abre una clave. Con contraseña tipo tarjeta usa el número de la sesión (o lo pide una
 * vez). Vencida: no se usa (salvo para cambiarla). Claves anteriores (sin contraseña o con
 * una contraseña propia) se abren con un aviso para unificarlas.
 */
async function openProtectedKey(file: string, label: string, options: { allowExpired?: boolean } = {}) {
  const pem = fs.readFileSync(file, "utf8");
  const changing = options.allowExpired === true;
  if (!isProtectedPem(pem)) {
    if (!changing) console.warn(`\n  AVISO: la clave de ${label} no tiene contraseña. Protégela con: ${CHANGE_HINT}\n`);
    return crypto.createPrivateKey(pem);
  }
  const expiry = pemExpiry(pem);
  if (!expiry) {
    if (!changing) console.warn(`\n  AVISO: la clave de ${label} tiene una contraseña anterior. Pásala a la contraseña única con: ${CHANGE_HINT}\n`);
    const passphrase = await askSecret(`Contraseña ANTERIOR de la clave de ${label}: `);
    try {
      return crypto.createPrivateKey({ key: pem, format: "pem", passphrase });
    } catch {
      throw new Error(`La contraseña anterior de la clave de ${label} no es correcta.`);
    }
  }
  if (isExpired(expiry)) {
    if (!changing) throw new Error(`La contraseña de las claves venció el ${formatExpiry(expiry)}. Cámbiala con: ${CHANGE_HINT}`);
  } else if (!changing && daysUntilExpiry(expiry) <= WARN_DAYS) {
    console.warn(`\n  AVISO: la contraseña de las claves vence el ${formatExpiry(expiry)} (en ${daysUntilExpiry(expiry)} días). Cámbiala con: ${CHANGE_HINT}\n`);
  }
  if (sessionNumber) {
    const key = openCardPem(pem, sessionNumber);
    if (key) return key;
  }
  const number = await askSecret(`Contraseña de las claves (vence ${formatExpiry(expiry)}): `);
  if (!isValidCardNumber(number)) throw new Error("Esa contraseña no es válida: revisa que escribiste los 16 caracteres sin errores.");
  const key = openCardPem(pem, number);
  if (!key) throw new Error(`La contraseña no corresponde a la clave de ${label}.`);
  sessionNumber = normalizeCardNumber(number);
  return key;
}

/** Lee la clave para usarla (vencida no se usa). */
export function readProtectedKey(file: string, label: string) {
  return openProtectedKey(file, label);
}

/** Genera la contraseña nueva, la muestra una vez y pide escribirla para confirmar. */
async function newPassword(expiry: string) {
  const number = generateCardNumber();
  console.log("\n  Contraseña de las claves (una sola para todas)\n");
  console.log(`    Número:  ${formatCardNumber(number)}`);
  console.log(`    Vence:   ${formatExpiry(expiry)}\n`);
  console.log("  Guárdala ahora en tu gestor de contraseñas. No se vuelve a mostrar.\n");
  const typed = await askSecret("Escríbela para confirmar que la guardaste: ");
  if (normalizeCardNumber(typed) !== number) throw new Error("No coincide. No se cambió nada: vuelve a intentarlo.");
  if (process.stdout.isTTY) process.stdout.write("\x1b[2J\x1b[3J\x1b[H"); // Quita el número de la pantalla.
  return number;
}

/** Guarda las claves cifradas con esa contraseña (comprueba cada una antes de escribir). */
function writeCardKeys(entries: Array<KeyEntry & { key: crypto.KeyObject }>, number: string, expiry: string) {
  const files = entries.map((entry) => {
    const pem = buildCardPem(entry.key, entry.label, number, expiry);
    const reopened = openCardPem(pem, number);
    if (!reopened || publicPemOf(reopened) !== publicPemOf(entry.key)) throw new Error("No se pudo comprobar la clave cifrada; no se cambió nada.");
    return { file: entry.file, pem };
  });
  for (const { file, pem } of files) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.nueva`;
    fs.writeFileSync(temp, pem, { mode: 0o600 });
    fs.renameSync(temp, file);
  }
  sessionNumber = number;
}

/** Contraseña ya en uso por alguna de las otras claves (para crear una nueva con la misma). */
async function existingPassword(others: KeyEntry[]) {
  for (const other of others) {
    if (!fs.existsSync(other.file)) continue;
    const expiry = pemExpiry(fs.readFileSync(other.file, "utf8"));
    if (!expiry) continue;
    await openProtectedKey(other.file, other.label, { allowExpired: true });
    return { number: sessionNumber!, expiry };
  }
  return null;
}

/**
 * Crea la clave si no existe, o protege una sin contraseña (es la misma clave: la pública
 * no cambia), con la contraseña de las otras claves si ya hay una (si no, una nueva con ese
 * vencimiento). Si ya está protegida, la abre. Devuelve la clave abierta.
 */
export async function ensureProtectedKey(file: string, label: string, expiry: string, others: KeyEntry[] = []) {
  const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  if (existing && isProtectedPem(existing)) return { key: await openProtectedKey(file, label), status: "existing" as const };
  const key = existing ? crypto.createPrivateKey(existing) : crypto.generateKeyPairSync("ed25519").privateKey;
  const shared = await existingPassword(others);
  const number = shared?.number ?? (await newPassword(expiry));
  writeCardKeys([{ file, label, key }], number, shared?.expiry ?? expiry);
  return { key, status: existing ? ("protected" as const) : ("created" as const), sharedPassword: Boolean(shared) };
}

/**
 * Cambia la contraseña de todas las claves juntas (también si ya venció, y une claves que
 * tenían contraseñas distintas). Las claves no cambian: licencias y versiones siguen igual.
 */
export async function changePassword(entries: KeyEntry[], expiry: string) {
  const opened = [];
  for (const entry of entries.filter((item) => fs.existsSync(item.file))) {
    opened.push({ ...entry, key: await openProtectedKey(entry.file, entry.label, { allowExpired: true }) });
  }
  if (opened.length === 0) throw new Error("No hay claves.");
  writeCardKeys(opened, await newPassword(expiry), expiry);
  return opened.map((entry) => entry.label);
}

/** Claves nuevas para todas a la vez, con una sola contraseña nueva. */
export async function createKeysTogether(entries: KeyEntry[], expiry: string) {
  const created = entries.map((entry) => ({ ...entry, key: crypto.generateKeyPairSync("ed25519").privateKey }));
  writeCardKeys(created, await newPassword(expiry), expiry);
  return created;
}

// ---------- Datos cifrados con la contraseña de las claves ----------

function passwordKey() {
  if (!sessionNumber) throw new Error("Primero pasa las claves a la contraseña única (Cambiar contraseña).");
  return crypto.createHash("sha256").update(`facturacion-bases|${sessionNumber}`).digest();
}

/** Cifra un texto con la contraseña de las claves (la pide si no se escribió en esta sesión). */
export async function sealWithPassword(text: string, keyFile: string, label: string) {
  await openProtectedKey(keyFile, label);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", passwordKey(), iv);
  const data = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return Buffer.concat([iv, data, cipher.getAuthTag()]).toString("base64url");
}

/** Abre un texto cifrado con la contraseña de las claves (null si no corresponde). */
export async function openWithPassword(sealed: string, keyFile: string, label: string) {
  await openProtectedKey(keyFile, label);
  try {
    const raw = Buffer.from(sealed, "base64url");
    const decipher = crypto.createDecipheriv("aes-256-gcm", passwordKey(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(raw.length - 16));
    return Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
