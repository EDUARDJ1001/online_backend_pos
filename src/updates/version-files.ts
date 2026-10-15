/**
 * Versiones del programa de escritorio: carpeta firmada, paquete para publicar y
 * comprobación. Lo usan el lanzador (Facturacion.exe), el sistema al actualizarse
 * y los scripts que generan y publican versiones. Solo módulos de Node.
 *
 * Carpeta de una versión (C:\Facturacion\versiones\<versión>\):
 *   facturacion.cjs, pantallas/, migrations/, migrations-mssql/, assets/, data/
 *   archivos.json   lista de archivos con tamaño y SHA-256
 *   version.json    { version, date, notes, minLauncher, filesSha256 }
 *   version.sig     firma Ed25519 de version.json (clave privada solo en la PC que publica)
 *
 * Paquete publicado (facturacion-<versión>.paquete): gzip de
 *   [4 bytes: largo del encabezado][encabezado JSON { files: [{ path, size }] }][contenidos]
 * con TODOS los archivos de la carpeta (incluidos los tres de arriba).
 *
 * Manifiesto publicado (manifest.json): { contenido: "<JSON>", firma: "<base64>" }, donde
 * contenido = { version, date, notes, minLauncher, package, size, sha256 }.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import zlib from "zlib";

export const FILES_LIST = "archivos.json";
export const VERSION_FILE = "version.json";
export const SIGNATURE_FILE = "version.sig";
const META_FILES = new Set([FILES_LIST, VERSION_FILE, SIGNATURE_FILE]);

export interface VersionInfo {
  version: string;
  /** Fecha de publicación (ISO). */
  date: string;
  /** Novedades para mostrar antes de actualizar. */
  notes: string;
  /** Versión mínima del lanzador (Facturacion.exe) que puede abrir esta versión. */
  minLauncher: number;
  /** SHA-256 de archivos.json. */
  filesSha256: string;
}

export interface FileEntry {
  path: string;
  size: number;
  sha256: string;
}

export interface UpdateManifest {
  version: string;
  date: string;
  notes: string;
  minLauncher: number;
  /** Nombre del paquete, relativo a la dirección del manifiesto. */
  package: string;
  size: number;
  sha256: string;
}

export function sha256(data: Buffer | string) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

/** "1.2.10" > "1.2.9". Partes no numéricas cuentan como 0. */
export function compareVersions(a: string, b: string) {
  const left = a.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const right = b.split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

/** Nombre de versión válido para usarlo como carpeta. */
export function isVersionName(value: string) {
  return /^\d+\.\d+\.\d+$/.test(value);
}

/** Archivos de la carpeta (rutas con "/"), sin los de firma. */
function walk(dir: string, prefix = ""): string[] {
  const result: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      result.push(...walk(path.join(dir, entry.name), relative));
    } else if (!META_FILES.has(relative)) {
      result.push(relative);
    }
  }
  return result.sort();
}

// ------------------------------------------------------------------ Publicar (PC del desarrollador)

/** Escribe archivos.json, version.json y version.sig en una carpeta de versión. */
export function signVersionDir(dir: string, info: Omit<VersionInfo, "filesSha256">, privateKey: crypto.KeyLike) {
  const files: FileEntry[] = walk(dir).map((relative) => {
    const data = fs.readFileSync(path.join(dir, relative));
    return { path: relative, size: data.length, sha256: sha256(data) };
  });
  const list = Buffer.from(JSON.stringify(files, null, 1));
  fs.writeFileSync(path.join(dir, FILES_LIST), list);
  const version = Buffer.from(JSON.stringify({ ...info, filesSha256: sha256(list) } satisfies VersionInfo, null, 2));
  fs.writeFileSync(path.join(dir, VERSION_FILE), version);
  fs.writeFileSync(path.join(dir, SIGNATURE_FILE), crypto.sign(null, version, privateKey).toString("base64"));
}

/** Paquete con toda la carpeta de la versión (ya firmada). */
export function packVersionDir(dir: string) {
  const files = [...walk(dir), ...META_FILES].map((relative) => ({ path: relative, data: fs.readFileSync(path.join(dir, relative)) }));
  const header = Buffer.from(JSON.stringify({ files: files.map((file) => ({ path: file.path, size: file.data.length })) }));
  const length = Buffer.alloc(4);
  length.writeUInt32BE(header.length);
  return zlib.gzipSync(Buffer.concat([length, header, ...files.map((file) => file.data)]), { level: 9 });
}

export function signManifest(manifest: UpdateManifest, privateKey: crypto.KeyLike) {
  const contenido = JSON.stringify(manifest);
  return { contenido, firma: crypto.sign(null, Buffer.from(contenido), privateKey).toString("base64") };
}

// ------------------------------------------------------------------ Comprobar (cajas)

/** Lee y comprueba la firma del manifiesto publicado. */
export function readSignedManifest(raw: unknown, publicKeyPem: string): UpdateManifest {
  const value = raw as { contenido?: unknown; firma?: unknown };
  if (typeof value?.contenido !== "string" || typeof value?.firma !== "string") {
    throw new Error("La información de la versión publicada no es válida.");
  }
  if (!crypto.verify(null, Buffer.from(value.contenido), publicKeyPem, Buffer.from(value.firma, "base64"))) {
    throw new Error("La versión publicada no tiene una firma válida.");
  }
  const manifest = JSON.parse(value.contenido) as UpdateManifest;
  if (!isVersionName(manifest.version) || !/^[\w.-]+$/.test(manifest.package)) {
    throw new Error("La información de la versión publicada no es válida.");
  }
  return manifest;
}

/**
 * Comprueba una carpeta de versión: firma de version.json, lista de archivos y que
 * cada archivo coincida (sin archivos de más ni de menos). Devuelve su version.json.
 *
 * `removeExtra`: los archivos que NO están en la lista firmada (restos de una instalación
 * anterior de la misma versión, archivos que agrega Windows) se borran en vez de fallar;
 * se informan con `onRemoved`. Faltantes o alterados siempre fallan.
 */
export function verifyVersionDir(
  dir: string,
  publicKeyPem: string,
  options: { removeExtra?: boolean; onRemoved?: (files: string[]) => void } = {}
): VersionInfo {
  const versionRaw = fs.readFileSync(path.join(dir, VERSION_FILE));
  const signature = Buffer.from(fs.readFileSync(path.join(dir, SIGNATURE_FILE), "utf8").trim(), "base64");
  if (!crypto.verify(null, versionRaw, publicKeyPem, signature)) {
    throw new Error("firma no válida");
  }
  const info = JSON.parse(versionRaw.toString("utf8")) as VersionInfo;
  if (info.version !== path.basename(dir)) {
    throw new Error(`la carpeta no corresponde a la versión ${info.version}`);
  }
  const listRaw = fs.readFileSync(path.join(dir, FILES_LIST));
  if (sha256(listRaw) !== info.filesSha256) {
    throw new Error("lista de archivos alterada");
  }
  const expected = JSON.parse(listRaw.toString("utf8")) as FileEntry[];
  const listed = new Set(expected.map((entry) => entry.path));
  const present = walk(dir);
  const presentSet = new Set(present);
  const missing = expected.filter((entry) => !presentSet.has(entry.path));
  if (missing.length > 0) {
    throw new Error(`faltan ${missing.length} ${missing.length === 1 ? "archivo" : "archivos"} (${missing[0]!.path})`);
  }
  const extra = present.filter((file) => !listed.has(file));
  if (extra.length > 0) {
    if (!options.removeExtra) {
      throw new Error(`hay ${extra.length} ${extra.length === 1 ? "archivo" : "archivos"} de más (${extra[0]})`);
    }
    // Lo que no está firmado nunca se usa: se quita y la versión queda tal como se publicó.
    for (const file of extra) {
      fs.rmSync(path.join(dir, file), { force: true });
    }
    options.onRemoved?.(extra);
  }
  for (const entry of expected) {
    const data = fs.readFileSync(path.join(dir, entry.path));
    if (data.length !== entry.size || sha256(data) !== entry.sha256) {
      throw new Error(`archivo alterado: ${entry.path}`);
    }
  }
  return info;
}

/** Extrae un paquete en `targetDir` (que no debe existir). No comprueba firmas: después, verifyVersionDir. */
export function unpackVersion(packageData: Buffer, targetDir: string) {
  const raw = zlib.gunzipSync(packageData, { maxOutputLength: 512 * 1024 * 1024 });
  const headerLength = raw.readUInt32BE(0);
  const header = JSON.parse(raw.subarray(4, 4 + headerLength).toString("utf8")) as { files: Array<{ path: string; size: number }> };
  let offset = 4 + headerLength;
  const root = path.resolve(targetDir);
  fs.mkdirSync(root, { recursive: true });
  for (const file of header.files) {
    const target = path.resolve(root, file.path);
    if (!target.startsWith(root + path.sep) || file.path.includes("\\")) {
      throw new Error("El paquete tiene rutas no válidas.");
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, raw.subarray(offset, offset + file.size));
    offset += file.size;
  }
  if (offset !== raw.length) {
    throw new Error("El paquete está incompleto o dañado.");
  }
}
