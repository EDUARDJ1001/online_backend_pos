/**
 * Prepara una actualización para publicar en internet (las cajas la instalan desde
 * Sistema > Actualizaciones, sin el instalador).
 *
 * Genera instaladores/actualizaciones/<versión>/:
 *   manifest.json                 versión, novedades, tamaño y huella del paquete (firmado)
 *   facturacion-<versión>.paquete el programa completo de esa versión (firmado)
 *
 * Después se suben los dos archivos a una publicación ("release") nueva del repositorio
 * público de versiones (ver docs/actualizaciones.md).
 *
 * Antes: subir "version" en el package.json de la raíz.
 * Uso: npm run publicar:version -- --notas "Qué cambió en esta versión"
 *      --sin-pantallas  reutiliza las pantallas ya exportadas
 */
import fs from "fs";
import path from "path";

import { UPDATES_PUBLIC_KEY } from "../src/updates/public-key";
import { LAUNCHER_VERSION } from "../src/updates/runtime";
import { packVersionDir, sha256, signManifest, verifyVersionDir, type UpdateManifest } from "../src/updates/version-files";
import { appVersion, backendDir, buildVersionDir, exportScreens, readPrivateKey, rootDir } from "./lib/build-version";
import { hasFlag, valueOrPositional } from "./lib/cli-args";

async function main() {
  const privateKey = await readPrivateKey();
  const notes = (valueOrPositional("notas") ?? "").trim();
  if (!notes) {
    throw new Error('Escribe las novedades de la versión: npm run publicar:version -- --notas "Qué cambió"');
  }
  const version = appVersion();
  const outDir = path.join(rootDir, "instaladores", "actualizaciones", version);
  if (fs.existsSync(path.join(outDir, "manifest.json")) && !hasFlag("reemplazar")) {
    throw new Error(`La versión ${version} ya se preparó (${outDir}). Sube "version" en package.json, o usa --reemplazar.`);
  }

  exportScreens(hasFlag("sin-pantallas"));
  const workDir = path.join(backendDir, "dist-exe", "publicar");
  fs.rmSync(workDir, { recursive: true, force: true });
  const dir = await buildVersionDir(workDir, version, notes);
  // La clave privada debe ser la pareja de la pública que llevan las cajas.
  verifyVersionDir(dir, UPDATES_PUBLIC_KEY);

  const packageName = `facturacion-${version}.paquete`;
  const packageData = packVersionDir(dir);
  const manifest: UpdateManifest = {
    version,
    date: new Date().toISOString(),
    notes,
    minLauncher: LAUNCHER_VERSION,
    package: packageName,
    size: packageData.length,
    sha256: sha256(packageData)
  };

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, packageName), packageData);
  fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(signManifest(manifest, privateKey), null, 2));
  fs.rmSync(workDir, { recursive: true, force: true });

  console.log(
    [
      "",
      `Versión ${version} lista para publicar en ${outDir}`,
      `  manifest.json`,
      `  ${packageName} (${(packageData.length / 1024 / 1024).toFixed(1)} MB)`,
      "",
      `Sube los dos archivos a una publicación nueva llamada v${version} del repositorio de versiones.`,
      "Las cajas la verán en Sistema > Actualizaciones en unos minutos."
    ].join("\n")
  );
}

main().catch((error: Error) => {
  console.error(`\n${error.message}`);
  process.exit(1);
});
