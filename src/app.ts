// Mensajes de validación en español (debe cargarse antes que los esquemas).
import "./config/zod-es";
import cors, { type CorsOptions } from "cors";
import express from "express";
import helmet from "helmet";

import { env } from "./config/env";
import { requireAuth } from "./middlewares/auth.middleware";
import { requireActiveCompany } from "./middlewares/company.middleware";
import { errorHandler, notFoundHandler } from "./middlewares/error.middleware";
import { schemaGuard } from "./middlewares/schema-guard.middleware";
import { isDbConfigured, pingDatabase } from "./config/db";
import { setupRouter } from "./modules/system/setup.routes";
import { recoverSchemaStatus, schemaStatus } from "./modules/system/migrations.service";
import { mountFrontend } from "./frontend-static";
import { AppError } from "./utils/http-error";
import { isLocalNetworkOrigin, isSameOrigin } from "./utils/local-origin";
import { licenseGuard, licenseRouter } from "./license/license.routes";
import { authRouter } from "./modules/auth/auth.routes";
import { banksRouter } from "./modules/banks/banks.routes";
import { cajaRouter } from "./modules/caja/caja.routes";
import { clientsRouter } from "./modules/clients/clients.routes";
import { companiesRouter } from "./modules/companies/companies.routes";
import { inventoryRouter } from "./modules/inventory/inventory.routes";
import { settingsRouter } from "./modules/settings/settings.routes";
import { invoicesRouter } from "./modules/invoices/invoices.routes";
import { payablesRouter } from "./modules/payables/payables.routes";
import { rolesRouter } from "./modules/permissions/permissions.routes";
import { systemRouter } from "./modules/system/system.routes";
import { updatesRouter } from "./modules/system/updates.routes";
import { updatesService } from "./modules/system/updates.service";
import { printRouter } from "./modules/print/print.routes";
import { proformasRouter } from "./modules/proformas/proformas.routes";
import { productsRouter } from "./modules/products/products.routes";
import { quotesRouter } from "./modules/quotes/quotes.routes";
import { receivablesRouter } from "./modules/receivables/receivables.routes";
import { reportsRouter } from "./modules/reports/reports.routes";
import { suppliersRouter } from "./modules/suppliers/suppliers.routes";
import { usersRouter } from "./modules/users/users.routes";
import { warehousesRouter } from "./modules/warehouses/warehouses.routes";

const allowedOrigins = Array.from(
  new Set(
    [env.FRONTEND_URL, ...env.FRONTEND_ALLOWED_ORIGINS.split(",")]
      .map((origin) => origin.trim())
      .filter(Boolean)
  )
);

export const app = express();

// IP real del cliente detrás de un proxy (redes autorizadas de caja, auditoría).
if (env.TRUST_PROXY > 0) {
  app.set("trust proxy", env.TRUST_PROXY);
}

const corsOptions: CorsOptions = {
  credentials: false,
  methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
  allowedHeaders: ["Accept", "Authorization", "Content-Type", "x-company-id", "x-cash-terminal", "x-tecnico"],
  // Permite al frontend leer el nombre del PDF que define el backend.
  exposedHeaders: ["Content-Disposition"]
};

// Pantallas servidas por este mismo backend (por IP o por nombre del servidor), red local
// y los orígenes configurados. Cualquier otro origen se rechaza.
app.use(
  cors((req, callback) => {
    const origin = req.headers.origin;
    if (!origin || isSameOrigin(origin, req.headers.host) || allowedOrigins.includes(origin) || isLocalNetworkOrigin(origin)) {
      callback(null, { ...corsOptions, origin: true });
      return;
    }
    callback(new AppError("Origen no permitido.", 403), { ...corsOptions, origin: false });
  })
);
app.use(helmet());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

app.get("/health", (_req, res) => {
  res.json({
    ok: true
  });
});

// Estado de la conexión con la base (el frontend muestra un aviso si no responde).
// Público y sin datos: solo dice si hay conexión.
// Versión del programa (en el .exe la fija la compilación; en desarrollo, "dev").
const APP_VERSION = process.env.FACTURACION_VERSION ?? "dev";

app.get("/api/health", async (_req, res) => {
  if (!isDbConfigured()) {
    res.status(503).json({ ok: false, database: false, configured: false, version: APP_VERSION });
    return;
  }
  const database = await pingDatabase();
  if (database) {
    recoverSchemaStatus();
  }
  res.status(database ? 200 : 503).json({
    ok: database,
    database,
    configured: true,
    version: APP_VERSION,
    // Caja con versión anterior a la base (bloqueada) y versión nueva publicada, si hay.
    outdated: schemaStatus().unknown.length > 0,
    // Funciones desactivadas porque falta su actualización de la base (el resto funciona).
    pendingFeatures: schemaStatus().features.map((feature) => ({ name: feature.name, screens: feature.screens })),
    updateAvailable: updatesService.availableVersion()
  });
});

// Licencia de este equipo: estado y activación; sin licencia válida no responde lo demás.
app.use("/api/licencia", licenseRouter);
app.use("/api", licenseGuard);

// Configuración inicial de la base (sin sesión; solo sin base configurada y desde esta PC).
app.use("/api/setup", setupRouter);

// Programa y base de datos en la misma versión (varias cajas con su propio programa).
app.use("/api", schemaGuard);

app.use("/api/auth", authRouter);
app.use("/api/companies", requireAuth, companiesRouter);
app.use("/api/clients", requireAuth, requireActiveCompany, clientsRouter);
app.use("/api/products", requireAuth, requireActiveCompany, productsRouter);
app.use("/api/warehouses", requireAuth, requireActiveCompany, warehousesRouter);
app.use("/api/inventory", requireAuth, requireActiveCompany, inventoryRouter);
app.use("/api/settings", requireAuth, requireActiveCompany, settingsRouter);
app.use("/api/invoices", requireAuth, requireActiveCompany, invoicesRouter);
app.use("/api/proformas", requireAuth, requireActiveCompany, proformasRouter);
app.use("/api/quotes", requireAuth, requireActiveCompany, quotesRouter);
app.use("/api/suppliers", requireAuth, requireActiveCompany, suppliersRouter);
app.use("/api/receivables", requireAuth, requireActiveCompany, receivablesRouter);
app.use("/api/payables", requireAuth, requireActiveCompany, payablesRouter);
app.use("/api/caja", requireAuth, requireActiveCompany, cajaRouter);
app.use("/api/banks", requireAuth, requireActiveCompany, banksRouter);
app.use("/api/reports", requireAuth, requireActiveCompany, reportsRouter);
app.use("/api/print", requireAuth, requireActiveCompany, printRouter);
app.use("/api/users", requireAuth, requireActiveCompany, usersRouter);
app.use("/api/roles", requireAuth, requireActiveCompany, rolesRouter);
app.use("/api/system/updates", updatesRouter);
app.use("/api/system", requireAuth, systemRouter);

// Versión de escritorio: pantallas exportadas del frontend en el mismo origen.
mountFrontend(app, env.FRONTEND_DIST);

app.use(notFoundHandler);
app.use(errorHandler);
