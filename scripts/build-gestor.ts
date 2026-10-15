/**
 * Crea GestorLicencias.exe (el gestor de licencias para llevar en una USB; no necesita
 * Node instalado).
 *
 *   npm run build:gestor                              → instaladores/gestor/
 *   npm run build:gestor -- --destino E:\Gestor        → en la USB
 *   npm run build:gestor -- --destino E:\Gestor --con-clave
 *
 * --con-clave copia la clave de licencias (cifrada) y el registro de licencias emitidas de
 * %USERPROFILE%\.facturacion\ junto al .exe. Si la clave del destino es otra, queda aparte
 * como clave-licencias.anterior-….pem; del registro solo agrega lo que falta.
 * Hay que volver a crearlo si cambia la clave de licencias o su contraseña.
 */
import fs from "fs";
import path from "path";

import { backendDir, buildSeaExe, rootDir, step } from "./lib/build-version";
import { hasFlag, valueOrPositional } from "./lib/cli-args";
import { licensePrivateKeyFile } from "./lib/key-paths";

async function main() {
  const publicKey = fs.readFileSync(path.join(backendDir, "src", "license", "public-key.ts"), "utf8");
  if (!/BEGIN PUBLIC KEY/.test(publicKey)) {
    throw new Error("Falta la clave de licencias. Créala primero con: npm run gestor (Crear clave)");
  }
  const destination = path.resolve(valueOrPositional("destino") ?? path.join(rootDir, "instaladores", "gestor"));
  const exe = path.join(destination, "GestorLicencias.exe");

  step(`Creando ${exe}...`);
  await buildSeaExe(path.join(backendDir, "scripts", "gestor.ts"), exe);

  fs.writeFileSync(
    path.join(destination, "LEEME.txt"),
    [
      "GESTOR DE LICENCIAS",
      "",
      "Abre GestorLicencias.exe en la PC donde está instalado el programa para ver su",
      "licencia, activarla o cambiarla. Si no deja guardar: clic derecho > Ejecutar como",
      "administrador.",
      "",
      "Junto al .exe van clave-licencias.pem (la clave, cifrada: sin su número no sirve) y",
      "la carpeta licencias (registro de las licencias emitidas).",
      ""
    ].join("\r\n")
  );

  if (hasFlag("con-clave")) {
    step("Copiando la clave y el registro de licencias...");
    const keyFile = licensePrivateKeyFile();
    const target = path.join(destination, "clave-licencias.pem");
    if (!fs.existsSync(keyFile)) throw new Error(`No existe la clave de licencias en ${keyFile}.`);
    if (fs.existsSync(target) && fs.readFileSync(target, "utf8") === fs.readFileSync(keyFile, "utf8")) {
      console.log("  La clave ya estaba en el destino.");
    } else {
      if (fs.existsSync(target)) {
        // Clave distinta (claves nuevas o contraseña cambiada): la anterior queda aparte.
        const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
        fs.renameSync(target, path.join(destination, `clave-licencias.anterior-${stamp}.pem`));
        console.log("  La clave del destino era otra: quedó como clave-licencias.anterior-….pem y se puso la actual.");
      }
      fs.copyFileSync(keyFile, target);
    }
    const history = path.join(path.dirname(keyFile), "licencias");
    let copied = 0;
    if (fs.existsSync(history)) {
      fs.mkdirSync(path.join(destination, "licencias"), { recursive: true });
      for (const name of fs.readdirSync(history)) {
        const to = path.join(destination, "licencias", name);
        if (!fs.existsSync(to)) {
          fs.copyFileSync(path.join(history, name), to);
          copied += 1;
        }
      }
    }
    console.log(`  Licencias copiadas al registro: ${copied}.`);
  }
  console.log(`\nListo: ${destination}`);
}

main().catch((error) => {
  console.error(`No se creó el gestor: ${(error as Error).message}`);
  process.exitCode = 1;
});
