/**
 * Crea o cambia la clave de técnico (acceso escondido a la conexión de la base,
 * Ctrl + Shift + F9). Se pide dos veces (cada carácter se ve como "*") y se guarda SOLO su huella en
 * %USERPROFILE%\.facturacion\clave-tecnico.txt (fuera del repositorio).
 *
 * La huella entra en el programa al compilar: después de crearla o cambiarla, genera
 * el instalador o publica una versión para que llegue a las cajas.
 *
 * Uso: npm run tecnico:clave --workspace backend
 */
import fs from "fs";
import path from "path";

import { hashTechnicianPassword } from "../src/modules/system/technician";
import { askHidden } from "./lib/ask-hidden";
import { technicianHashFile } from "./lib/build-version";

const MIN_LENGTH = 10;

async function main() {
  // Sin consola (pruebas automáticas): la clave puede venir en una variable de entorno.
  let password = process.env.FACTURACION_CLAVE_TECNICO_NUEVA ?? "";
  if (!password) {
    console.log(`Escribe la clave (mínimo ${MIN_LENGTH} caracteres; cada uno se ve como *) y pulsa Enter.`);
    password = await askHidden("Nueva clave de técnico: ");
    if (!password) {
      throw new Error("No se recibió ninguna clave. No se cambió nada.");
    }
    if (password.length < MIN_LENGTH) {
      throw new Error(`La clave tiene ${password.length} caracteres; debe tener al menos ${MIN_LENGTH}. No se cambió nada.`);
    }
    if ((await askHidden("Repite la clave: ")) !== password) {
      throw new Error("Las claves no coinciden. No se cambió nada.");
    }
  }
  if (password.length < MIN_LENGTH) {
    throw new Error(`La clave tiene ${password.length} caracteres; debe tener al menos ${MIN_LENGTH}. No se cambió nada.`);
  }

  const file = technicianHashFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${hashTechnicianPassword(password)}\n`, { mode: 0o600 });
  console.log(`Clave de técnico guardada (solo su huella) en ${file}.\nGenera el instalador o publica una versión para que llegue a las cajas.`);
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exit(1);
});
