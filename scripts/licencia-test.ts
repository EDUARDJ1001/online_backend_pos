/**
 * Prueba de las licencias con una clave temporal (no usa ni toca la clave real).
 * Uso: npx tsx scripts/licencia-test.ts
 */
import crypto from "crypto";

import fs from "fs";
import os from "os";
import path from "path";

import {
  checkTerms,
  isMultiLicenseText,
  readMultiLicense,
  signMultiLicense,
  evaluateLicense, installLicense, machineCode, readLicenseStatus, removeLicense, sealSeenDate, signLicense, unsealSeenDate, type LicensePayload,
  readRevocation,
  sealSeen,
  signRevocation,
  unsealSeen,
  type RevocationPayload
} from "../src/license/license";
import {
  buildCardPem,
  daysUntilExpiry,
  expiryFromArgs,
  formatCardNumber,
  formatExpiry,
  generateCardNumber,
  isExpired,
  isProtectedPem,
  isValidCardNumber,
  normalizeCardNumber,
  openCardPem,
  pemExpiry
} from "./lib/protected-key";

let failures = 0;
let passed = 0;
function ok(name: string, condition: boolean) {
  if (condition) passed += 1;
  else {
    failures += 1;
    console.log(`FAIL ${name}`);
  }
}

const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
const machine = "7KQ2M9XA4PT1";
const base: LicensePayload = { v: 1, equipo: machine, empresa: "Empresa de prueba", vence: null, emitida: "2026-10-01", id: "x" };
const check = (license: string | null, extra: Partial<Parameters<typeof evaluateLicense>[1]> = {}) =>
  evaluateLicense(license, { machine, today: "2026-10-05", publicPem, ...extra });

const permanent = signLicense(base, privatePem);
const expiring = signLicense({ ...base, vence: "2026-12-31" }, privatePem);

ok("sin licencia: no válida (falta)", check(null).problem === "missing");
ok("permanente válida y sin días restantes", check(permanent).valid && check(permanent).daysLeft === null && check(permanent).empresa === "Empresa de prueba");
ok("con vencimiento: válida y cuenta los días", check(expiring).valid && check(expiring).daysLeft === 87);
ok("se acepta pegada con espacios y saltos de línea", check(expiring.replace(/(.{20})/g, "$1\n  ")).valid);
ok("el código de equipo se acepta con espacios", check(permanent, { machine: "7KQ2 M9XA 4PT1" }).valid);
ok("vencida: no válida", check(expiring, { today: "2027-01-01" }).problem === "expired");
ok("el último día todavía es válida", check(expiring, { today: "2026-12-31" }).valid);
ok("licencia de otro equipo: rechazada", check(permanent, { machine: "AAAABBBBCCCC" }).problem === "other-machine");
const parts = permanent.split(".");
const body = parts[1]!;
const tampered = `${body.slice(0, 20)}${body[20] === "A" ? "B" : "A"}${body.slice(21)}`;
ok("licencia alterada (un carácter cambiado): inválida", check(`${parts[0]}.${tampered}.${parts[2]}`).problem === "invalid");
const stolen = signLicense({ ...base, equipo: "AAAABBBBCCCC" }, privatePem).split(".");
ok("datos de otro equipo con la firma de esta: inválida", check(`${parts[0]}.${stolen[1]}.${parts[2]}`).problem === "invalid");
ok("el texto no deja leer los datos (van cifrados)", !Buffer.from(body, "base64url").toString("latin1").includes("Empresa") && !permanent.includes(Buffer.from("Empresa").toString("base64url").slice(0, 8)));
ok("dos licencias con los mismos datos se ven distintas", signLicense(base, privatePem) !== permanent);
const other = crypto.generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString();
ok("firmada con otra clave: inválida", check(signLicense(base, other)).problem === "invalid");
ok("texto cualquiera: inválida", check("hola").problem === "invalid");
ok("reloj atrasado respecto a la fecha ya vista: rechazada", check(permanent, { lastSeen: "2026-10-20" }).problem === "clock");
ok("atrasar el reloj no extiende el vencimiento", check(expiring, { today: "2026-12-30", lastSeen: "2027-01-02" }).problem !== null);
ok("un día de diferencia (zona horaria) se tolera", check(permanent, { lastSeen: "2026-10-06" }).valid);
ok("borrar la fecha guardada no permite atrasar el reloj antes de la emisión", check(permanent, { today: "2026-09-20", lastSeen: null }).problem === "clock");
const sealed = sealSeenDate(machine, "2026-10-20");
ok("fecha guardada: se lee en su equipo", unsealSeenDate(machine, sealed) === "2026-10-20" && !sealed.includes("2026"));
ok("fecha guardada: no se lee en otro equipo", unsealSeenDate("AAAABBBBCCCC", sealed) === null);
ok("fecha guardada editada: se descarta", unsealSeenDate(machine, `${sealed.slice(0, 5)}${sealed[5] === "A" ? "B" : "A"}${sealed.slice(6)}`) === null && unsealSeenDate(machine, "2026-01-01") === null);
// Contraseña tipo tarjeta de la clave privada.
const number = generateCardNumber();
ok("número de clave: 16 caracteres válidos", number.length === 16 && isValidCardNumber(number) && /^.{4} .{4} .{4} .{4}$/.test(formatCardNumber(number)));
ok("número de clave: se acepta con espacios, minúsculas, O por 0 e I/L por 1", isValidCardNumber(formatCardNumber(number).toLowerCase()) && normalizeCardNumber("o1l-i") === "0111");
const typo = `${number.slice(0, 7)}${number[7] === "A" ? "B" : "A"}${number.slice(8)}`;
const swapped = `${number.slice(0, 3)}${number[4]}${number[3]}${number.slice(5)}`;
ok("número de clave: un carácter mal escrito se detecta", !isValidCardNumber(typo));
// Como en las tarjetas (09 ↔ 90), el único par que Luhn no detecta es 0 ↔ Z.
ok("número de clave: dos caracteres cambiados de lugar se detectan", number[3] === number[4] || `${number[3]}${number[4]}`.replace("Z", "0") === "00" || !isValidCardNumber(swapped));
{
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  const complete = (payload: string) => payload + [...alphabet].find((char) => isValidCardNumber(payload + char))!;
  const missed: string[] = [];
  for (const a of alphabet) {
    for (const b of alphabet) {
      if (a !== b && isValidCardNumber(`${b}${a}${complete(`${a}${b}K7Q2M9XA4PT1R`).slice(2)}`)) missed.push(`${a}${b}`);
    }
  }
  ok("número de clave: todos los cambios de lugar se detectan salvo 0 ↔ Z", missed.sort().join(",") === "0Z,Z0");
}
ok("número de clave: dos generados son distintos", generateCardNumber() !== number);
const october = new Date(2026, 9, 5);
ok("vencimiento: 12 meses por defecto (10/27)", expiryFromArgs([], october) === "2027-10" && formatExpiry("2027-10") === "10/27");
ok("vencimiento: --meses y --vence", expiryFromArgs(["--meses", "24"], october) === "2028-10" && expiryFromArgs(["--vence", "03/27"], october) === "2027-03");
const rejects = (fn: () => unknown) => {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
};
ok("vencimiento: fechas inválidas o pasadas rechazadas", rejects(() => expiryFromArgs(["--vence", "13/27"], october)) && rejects(() => expiryFromArgs(["--vence", "09/26"], october)) && rejects(() => expiryFromArgs(["--meses", "0"], october)));
ok("vencimiento: vale hasta el último día del mes", !isExpired("2026-10", new Date(2026, 9, 31, 23)) && isExpired("2026-10", new Date(2026, 10, 1)));
ok("vencimiento: días que faltan", daysUntilExpiry("2026-10", october) === 27);
const cardPem = buildCardPem(privateKey, "licencias", number, "2027-10");
ok("clave guardada cifrada, con el vencimiento a la vista", isProtectedPem(cardPem) && pemExpiry(cardPem) === "2027-10" && !cardPem.includes(privatePem.split(/\r?\n/)[1]!));
const opened = openCardPem(cardPem, formatCardNumber(number));
ok("clave cifrada: abre con el número y firma licencias válidas", opened !== null && check(signLicense(base, opened)).valid);
ok("clave cifrada: número incorrecto rechazado", openCardPem(cardPem, generateCardNumber()) === null);
ok("clave cifrada: editar el vencimiento para alargarlo la deja inservible", openCardPem(cardPem.replace("Vence: 10/27", "Vence: 10/29"), number) === null);
ok("sin clave pública en el programa: ninguna licencia es válida", check(permanent, { publicPem: "" }).problem === "invalid");

// Licencia de varios equipos (la misma licencia en cada PC de la lista).
const multiPayload = { v: 1 as const, tipo: "varios" as const, equipos: [machine, "AAAA BBBB CCCC", "ZZZZYYYYXXXX"], empresa: "Ferretería Prueba", vence: "2026-12-31", emitida: "2026-10-01", id: "m" };
const multi = signMultiLicense(multiPayload, privatePem);
{
  const here = check(multi);
  ok("varios equipos: vale en una PC de la lista", here.valid && here.tipo === "varios" && here.equipos === 3 && here.empresa === "Ferretería Prueba" && isMultiLicenseText(multi));
  ok("varios equipos: vale en otra PC de la lista (código con espacios al generar)", check(multi, { machine: "AAAABBBBCCCC" }).valid && check(multi, { machine: "ZZZZYYYYXXXX" }).valid);
  ok("varios equipos: en una PC que no está en la lista se rechaza", check(multi, { machine: "QQQQRRRRSSSS" }).problem === "other-machine");
  const body = Buffer.from(multi.split(".")[1]!, "base64url").toString("utf8");
  ok("varios equipos: el texto no deja leer los datos ni los códigos", !body.includes("Ferreter") && !body.includes("AAAABBBBCCCC") && !body.includes(machine));
  const [prefix, rawBody, signature] = multi.split(".");
  const altered = `${prefix}.${rawBody!.slice(0, 30)}${rawBody![30] === "A" ? "B" : "A"}${rawBody!.slice(31)}.${signature}`;
  ok("varios equipos alterada: inválida", check(altered).problem === "invalid");
  ok("varios equipos firmada con otra clave: inválida", readMultiLicense(signMultiLicense(multiPayload, other), machine, publicPem).problem === "invalid");
  ok("varios equipos: vence y reloj igual que la de un equipo", check(multi, { today: "2027-01-01" }).problem === "expired" && check(multi, { lastSeen: "2026-10-20" }).problem === "clock");
  ok("dos licencias con la misma lista se ven distintas", signMultiLicense(multiPayload, privatePem) !== multi);
  ok("vencimiento y reloj: misma regla para los dos tipos", checkTerms(multiPayload, "2026-12-31").daysLeft === 0);
}

// Licencias reemplazadas (orden de emisión) y revocaciones.
{
  const withSeq = (seq: number | undefined) => signLicense({ ...base, seq, id: `l${seq}` }, privatePem);
  ok("una licencia más vieja que la última que tuvo la PC: rechazada", check(withSeq(100), { minSeq: 200 }).problem === "replaced");
  ok("la misma o una más nueva: válida", check(withSeq(200), { minSeq: 200 }).valid && check(withSeq(300), { minSeq: 200 }).valid);
  ok("una licencia sin orden (anterior) frente a una con orden: rechazada", check(withSeq(undefined), { minSeq: 1 }).problem === "replaced");
  const revocation = (payload: Partial<RevocationPayload>, key = privatePem) =>
    readRevocation(signRevocation({ v: 1, tipo: "revocacion", motivo: null, emitida: "2026-10-05", seq: 500, ...payload }, key), publicPem);
  const byId = revocation({ licencia: "l300" })!;
  ok("revocar una licencia por su id: queda anulada", check(withSeq(300), { revocations: [byId] }).problem === "revoked" && check(withSeq(600), { revocations: [byId] }).valid);
  const byMachine = revocation({ equipo: machine, antes: 500 })!;
  ok("revocar un equipo: anula sus licencias anteriores, no las nuevas", check(withSeq(400), { revocations: [byMachine] }).problem === "revoked" && check(withSeq(600), { revocations: [byMachine] }).valid);
  ok("revocar un equipo no afecta a los demás de una licencia de varios", check(multi, { machine: "AAAABBBBCCCC", revocations: [byMachine] }).valid && check(multi, { revocations: [revocation({ equipo: machine, antes: Number.MAX_SAFE_INTEGER })!] }).problem === "revoked");
  ok("revocación firmada con otra clave: no se acepta", revocation({ licencia: "l300" }, other) === null);
  const revText = signRevocation({ v: 1, tipo: "revocacion", licencia: "l300", motivo: null, emitida: "2026-10-05", seq: 1 }, privatePem);
  const [rp, rb, rs] = revText.split(".");
  const forgedBody = Buffer.from(JSON.stringify({ v: 1, tipo: "revocacion", licencia: "otra", motivo: null, emitida: "2026-10-05", seq: 1 })).toString("base64url");
  ok("revocación alterada: no se acepta", readRevocation(`${rp}.${forgedBody}.${rs}`, publicPem) === null && readRevocation(`${rp}.${rb}.${rs}`, publicPem)?.licencia === "l300");
  const state = sealSeen(machine, { fecha: "2026-10-20", ultima: 777 });
  ok("lo recordado (fecha y última licencia) se lee en su equipo y no en otro", unsealSeen(machine, state).ultima === 777 && unsealSeen(machine, state).fecha === "2026-10-20" && unsealSeen("AAAABBBBCCCC", state).ultima === 0);
  ok("lo recordado en el formato anterior (solo fecha) se sigue leyendo", unsealSeen(machine, sealSeenDate(machine, "2026-10-03")).fecha === "2026-10-03");
}

// Instalar en este equipo (lo que hace el gestor), en una carpeta temporal.
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "licencia-test-"));
  try {
    const file = path.join(dir, "equipo.dat");
    const here = signLicense({ ...base, equipo: machineCode(), vence: "2099-12-31" }, privatePem);
    ok("sin archivo: este equipo no tiene licencia", readLicenseStatus(file, { publicPem }).problem === "missing");
    const wrong = installLicense(permanent, file, publicPem);
    ok("instalar la licencia de otro equipo: rechazada y no se guarda", !wrong.status.valid && !fs.existsSync(file));
    const done = installLicense(here, file, publicPem);
    ok("instalar la licencia de este equipo: se guarda y queda válida", done.status.valid && readLicenseStatus(file, { publicPem }).vence === "2099-12-31");
    ok("el archivo guardado no deja leer los datos", !fs.readFileSync(file, "utf8").includes("Empresa") && !fs.readFileSync(file, "utf8").includes("2099"));
    const changed = installLicense(signLicense({ ...base, equipo: machineCode(), empresa: "Otra", vence: null }, privatePem), file, publicPem);
    ok("cambiar la licencia (archivo oculto ya existente): reemplaza la anterior", changed.previous.vence === "2099-12-31" && readLicenseStatus(file, { publicPem }).empresa === "Otra");
    ok("el estado incluye la fecha de emisión", readLicenseStatus(file, { publicPem }).emitida === base.emitida);
    const shared = installLicense(signMultiLicense({ ...multiPayload, equipos: ["AAAABBBBCCCC", machineCode()] }, privatePem), file, publicPem);
    ok("instalar una licencia de varios equipos que incluye esta PC: queda válida", shared.status.valid && readLicenseStatus(file, { publicPem }).tipo === "varios");
    const notHere = installLicense(signMultiLicense({ ...multiPayload, equipos: ["AAAABBBBCCCC"] }, privatePem), file, publicPem);
    ok("instalar una de varios equipos sin esta PC: rechazada y queda la anterior", !notHere.status.valid && readLicenseStatus(file, { publicPem }).tipo === "varios");
    const idx = path.join(dir, "equipo.idx");
    ok("quitar la licencia: borra el archivo y queda sin licencia", removeLicense(file) && !fs.existsSync(file) && readLicenseStatus(file, { publicPem }).problem === "missing");
    ok("quitar la licencia conserva lo recordado (no permite atrasar el reloj ni volver a una vieja)", fs.existsSync(idx));
    ok("quitar sin licencia instalada: no hace nada", removeLicense(file) === false);
    const older = signLicense({ ...base, equipo: machineCode(), seq: 4000, id: "vieja" }, privatePem);
    const newer = signLicense({ ...base, equipo: machineCode(), seq: 5000, id: "nueva" }, privatePem);
    ok("instalar una licencia con orden: válida", installLicense(newer, file, publicPem).status.valid);
    ok("instalar después una más vieja: rechazada", installLicense(older, file, publicPem).status.problem === "replaced" && readLicenseStatus(file, { publicPem }).licenseId === "nueva");
    removeLicense(file);
    fs.writeFileSync(file, older);
    ok("restaurar a mano una copia vieja de equipo.dat: rechazada", readLicenseStatus(file, { publicPem }).problem === "replaced");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

console.log(failures === 0 ? `Licencias: ${passed} casos correctos.` : `${failures} casos de licencia fallaron.`);
process.exit(failures === 0 ? 0 : 1);
