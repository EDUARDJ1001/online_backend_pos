/**
 * Dónde están las claves del proveedor.
 *
 * - En la PC del proveedor: %USERPROFILE%\.facturacion\
 * - Gestor portátil (GestorLicencias.exe en una USB): la carpeta del propio .exe.
 */
import os from "os";
import path from "path";

/** true cuando corre como GestorLicencias.exe (Node empaquetado), no con npm run. */
export function isPortable() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require("node:sea") as { isSea: () => boolean }).isSea();
  } catch {
    return false;
  }
}

/** Carpeta de las claves y del registro de licencias emitidas. */
export function keysDir() {
  return isPortable() ? path.dirname(process.execPath) : path.join(os.homedir(), ".facturacion");
}

/** Clave privada de licencias (fuera del repositorio, protegida con contraseña). */
export function licensePrivateKeyFile() {
  return process.env.FACTURACION_CLAVE_LICENCIAS ?? path.join(keysDir(), "clave-licencias.pem");
}

/** Clave privada para firmar versiones (solo en la PC del proveedor). */
export function privateKeyFile() {
  return process.env.FACTURACION_CLAVE_ACTUALIZACIONES ?? path.join(os.homedir(), ".facturacion", "clave-actualizaciones.pem");
}

/** Bases de datos guardadas en el gestor, junto a la clave de licencias (la contraseña de cada una va cifrada). */
export function savedDatabasesFile() {
  return path.join(path.dirname(licensePrivateKeyFile()), "bases.json");
}
