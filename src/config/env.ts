import fs from "fs";
import path from "path";

import dotenv from "dotenv";
import { z } from "zod";

// FACTURACION_ENV_FILE: archivo de configuración explícito (la versión de escritorio
// usa uno por caja, en la carpeta del usuario).
const envCandidates = [
  ...(process.env.FACTURACION_ENV_FILE ? [path.resolve(process.env.FACTURACION_ENV_FILE)] : []),
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "apps/backend/.env"),
  path.resolve(__dirname, "../../../.env"),
  path.resolve(__dirname, "../../../../.env"),
  path.resolve(__dirname, "../../../../../.env")
];

/** Archivo .env en uso (la vista "Base de datos" lo actualiza). Si no existe, se crea en la raíz. */
export let ENV_FILE = process.env.FACTURACION_ENV_FILE
  ? path.resolve(process.env.FACTURACION_ENV_FILE)
  : path.resolve(__dirname, "../../../../.env");

for (const candidate of envCandidates) {
  if (fs.existsSync(candidate)) {
    dotenv.config({ path: candidate, override: false });
    ENV_FILE = candidate;
    break;
  }
}

const envSchema = z.object({
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  FRONTEND_URL: z.string().url().default("http://localhost:3000"),
  FRONTEND_ALLOWED_ORIGINS: z.string().default("http://localhost:3000,http://127.0.0.1:3000"),
  // Motor de base de datos: mysql (MySQL/MariaDB) o mssql (SQL Server / Azure SQL).
  DB_CLIENT: z.enum(["mysql", "mssql"]).default("mysql"),
  // Vacíos = sin base configurada: el sistema arranca y pide conectarla (pantalla inicial).
  DB_HOST: z.string().default(""),
  DB_PORT: z.coerce.number().default(3306),
  DB_USER: z.string().default(""),
  DB_PASSWORD: z.string().default(""),
  DB_NAME: z.string().default(""),
  DB_SSL_MODE: z.enum(["DISABLED", "REQUIRED"]).default("DISABLED"),
  DB_SSL_CA_PATH: z.string().optional(),
  // Detrás de un proxy (nginx, balanceador): cuántos saltos confiar para leer la IP
  // real del cliente (X-Forwarded-For). 0 = conexión directa. Afecta las redes
  // autorizadas de caja y la IP de auditoría.
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  // Carpeta con las pantallas exportadas (versión de escritorio): el backend las sirve.
  FRONTEND_DIST: z.string().optional(),
  // Carpeta de migraciones (por defecto la del proyecto).
  MIGRATIONS_DIR: z.string().optional(),
  // Aplica las migraciones pendientes al iniciar (una sola caja a la vez).
  DB_AUTO_MIGRATE: z.enum(["true", "false"]).default("false"),
  // Programa de escritorio: dirección del manifest.json de versiones nuevas (vacío = la de fábrica).
  UPDATES_URL: z.string().optional(),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  ACCESS_TOKEN_TTL: z.string().default("15m"),
  REFRESH_TOKEN_TTL: z.string().default("7d"),
  // Documentación Swagger UI en /docs (false = no se publica).
  SWAGGER_ENABLED: z.enum(["true", "false"]).default("true"),
  // Impresora térmica de tickets (ESC/POS). El backend debe correr en el PC con la impresora.
  // Vacío = sin impresora (la factura cae al diálogo del navegador + PDF).
  // USB Windows (recomendado, sin módulo nativo): comparte la impresora y usa windows:NombreCompartido
  // Red: tcp://IP:9100. Serial: \\.\COM3. Driver nativo: printer:auto (requiere compilar node-printer).
  PRINTER_INTERFACE: z.string().default(""),
  PRINTER_TYPE: z.enum(["EPSON", "STAR", "TANCA", "DARUMA", "BROTHER", "CUSTOM"]).default("EPSON"),
  PRINTER_WIDTH: z.coerce.number().default(48),
  // Interlineado del ticket en puntos (ESC 3 n). 0 = el de la impresora (más papel).
  PRINTER_LINE_SPACING: z.coerce.number().int().min(0).max(255).default(26),
  PRINTER_CHARACTER_SET: z.string().default("PC852_LATIN2"),
  PRINTER_TIMEOUT: z.coerce.number().default(5000),
  PRINTER_BAUD_RATE: z.coerce.number().default(9600),
  PRINTER_REMOVE_ACCENTS: z.enum(["true", "false"]).default("false"),
  PRINTER_LOGO: z.enum(["true", "false"]).default("true"),
  PRINTER_LOGO_WIDTH: z.coerce.number().default(320),
  PRINTER_LOGO_MAX_HEIGHT: z.coerce.number().default(140),
  PRINTER_LOGO_THRESHOLD: z.coerce.number().default(180),
  PRINTER_LOGO_INVERT: z.enum(["auto", "true", "false"]).default("auto"),
  PRINTER_LOGO_DITHER: z.enum(["true", "false"]).default("true")
});

function loadEnv() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const describe = (issue: z.ZodIssue) => {
      if (issue.code === "too_small" && issue.type === "string") {
        return issue.minimum === 1 ? "falta completarlo" : `debe tener al menos ${issue.minimum} caracteres`;
      }
      if (issue.code === "invalid_type" && issue.received === "undefined") {
        return "falta completarlo";
      }
      if (issue.code === "invalid_enum_value") {
        return `valor no válido (usa: ${issue.options.join(", ")})`;
      }
      return "valor no válido";
    };
    const problems = result.error.issues.map((issue) => `  - ${issue.path.join(".")}: ${describe(issue)}`).join("\n");
    throw new Error(`Revisa el archivo de configuración ${ENV_FILE}:\n${problems}`);
  }
  return result.data;
}

export const env = loadEnv();
