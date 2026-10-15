/**
 * Genera dist-exe/Facturacion/ (lo que copia el instalador de caja):
 *
 *   Facturacion.exe              lanzador (src/launcher.ts)
 *   versiones/<versión>/         programa, pantallas, migraciones y recursos, firmados
 *   versiones/actual.txt         versión en uso
 *   LEEME.txt
 *
 * La configuración (config.env) NO se incluye: el .exe la crea en el primer uso.
 * Requiere la clave de firma (npm run gestor > Crear clave).
 *
 * Uso: npm run build:exe   (desde la raíz)
 *      --sin-pantallas  reutiliza las pantallas ya exportadas (más rápido)
 */
import fs from "fs";
import path from "path";

import { UPDATES_PUBLIC_KEY } from "../src/updates/public-key";
import { CURRENT_FILE } from "../src/updates/runtime";
import { verifyVersionDir } from "../src/updates/version-files";
import { appVersion, backendDir, buildLauncherExe, buildVersionDir, exportScreens, readPrivateKey } from "./lib/build-version";
import { hasFlag } from "./lib/cli-args";

async function main() {
  await readPrivateKey();
  const outDir = path.join(backendDir, "dist-exe", "Facturacion");
  const versionsDir = path.join(outDir, "versiones");
  const version = appVersion();

  exportScreens(hasFlag("sin-pantallas"));
  fs.rmSync(path.join(backendDir, "dist-exe"), { recursive: true, force: true });

  const dir = await buildVersionDir(versionsDir, version, "");
  verifyVersionDir(dir, UPDATES_PUBLIC_KEY);
  fs.writeFileSync(path.join(versionsDir, CURRENT_FILE), version);

  const exe = path.join(outDir, "Facturacion.exe");
  await buildLauncherExe(exe);

  fs.writeFileSync(
    path.join(outDir, "LEEME.txt"),
    [
      "FACTURACION",
      "",
      "Se instala con InstalarCaja. Facturacion.exe abre la versión indicada en",
      "versiones\\actual.txt; las versiones nuevas se instalan desde el sistema",
      "(Sistema > Actualizaciones), sin volver a usar el instalador.",
      "",
      "No compartas config.env: tiene la contraseña de la base de datos.",
      ""
    ].join("\r\n")
  );

  const size = (fs.statSync(exe).size / 1024 / 1024).toFixed(1);
  console.log(`\nListo: ${outDir}\n  Facturacion.exe (${size} MB) con la versión ${version}`);
}

main().catch((error: Error) => {
  console.error(`\n${error.message}`);
  process.exit(1);
});
