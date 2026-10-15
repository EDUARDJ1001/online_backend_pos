/**
 * Las dos claves del proveedor (licencias y actualizaciones): dónde están, cómo se
 * escribe su pública en el proyecto y en qué estado está su contraseña.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";

import { isPortable, licensePrivateKeyFile, privateKeyFile } from "./key-paths";
import { daysUntilExpiry, isExpired, isProtectedPem, pemExpiry } from "./protected-key";

export type KeyName = "licencias" | "actualizaciones";

function writePublicFile(file: string, lines: string[]) {
  fs.writeFileSync(file, [...lines, ""].join("\n"));
}

const publicPemOf = (key: crypto.KeyObject) => crypto.createPublicKey(key).export({ type: "spki", format: "pem" }).toString();

export const KEYS: Record<KeyName, { file: () => string; publicFile: string; writePublic: (key: crypto.KeyObject) => void }> = {
  licencias: {
    file: licensePrivateKeyFile,
    publicFile: path.resolve(__dirname, "../../src/license/public-key.ts"),
    writePublic(key) {
      writePublicFile(this.publicFile, [
        "/**",
        " * Clave pública de las licencias (la privada solo está en la PC del proveedor).",
        " * Generada con: npm run gestor (Crear clave).",
        " * Vacía = todavía no se creó: el instalador no se puede generar sin ella.",
        " */",
        `export const LICENSE_PUBLIC_KEY = ${JSON.stringify(publicPemOf(key))};`
      ]);
    }
  },
  actualizaciones: {
    file: privateKeyFile,
    publicFile: path.resolve(__dirname, "../../src/updates/public-key.ts"),
    writePublic(key) {
      writePublicFile(this.publicFile, [
        "/**",
        " * Clave pública de las actualizaciones (la privada solo está en la PC que publica).",
        " * Generada con: npm run gestor (Crear clave).",
        " */",
        `export const UPDATES_PUBLIC_KEY = ${JSON.stringify(publicPemOf(key))};`
      ]);
    }
  }
};

/** Claves que maneja esta copia: la portátil (USB) solo lleva la de licencias. */
export function availableKeys(): KeyName[] {
  return isPortable() ? ["licencias"] : ["licencias", "actualizaciones"];
}

export type KeyState =
  | { state: "missing" }
  | { state: "plain" }
  | { state: "passphrase" }
  | { state: "card"; expiry: string; expired: boolean; daysLeft: number };

/** Estado de la contraseña de una clave (sin abrirla). */
export function keyState(name: KeyName, now = new Date()): KeyState {
  const file = KEYS[name].file();
  if (!fs.existsSync(file)) return { state: "missing" };
  const pem = fs.readFileSync(file, "utf8");
  if (!isProtectedPem(pem)) return { state: "plain" };
  const expiry = pemExpiry(pem);
  if (!expiry) return { state: "passphrase" };
  return { state: "card", expiry, expired: isExpired(expiry, now), daysLeft: daysUntilExpiry(expiry, now) };
}
