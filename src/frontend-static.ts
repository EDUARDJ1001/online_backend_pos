import fs from "fs";
import path from "path";

import express, { type Express } from "express";
import helmet from "helmet";

/**
 * Versión de escritorio: el backend sirve las pantallas exportadas del frontend
 * (FRONTEND_DIST) en el mismo origen que la API.
 */
export function mountFrontend(app: Express, distDir: string | undefined) {
  const dir = distDir ? path.resolve(distDir) : null;

  if (!dir || !fs.existsSync(path.join(dir, "index.html"))) {
    return false;
  }

  // Next exporta scripts en línea; se permite el programa de impresión local (127.0.0.1:17777),
  // imágenes externas (logos/productos) y PDFs en blob para imprimir.
  const contentSecurityPolicy = helmet.contentSecurityPolicy({
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https:"],
      fontSrc: ["'self'", "data:", "https:"],
      imgSrc: ["'self'", "data:", "blob:", "https:", "http:"],
      connectSrc: ["'self'", "http://127.0.0.1:17777", "https://api.cloudinary.com"],
      frameSrc: ["'self'", "blob:"],
      objectSrc: ["'self'", "blob:"],
      workerSrc: ["'self'", "blob:"],
      upgradeInsecureRequests: null
    }
  });

  const notFoundPage = path.join(dir, "404.html");

  // Ruta de una pantalla (/invoices, /invoices/): su .html exportado. Va antes de los
  // archivos estáticos porque /invoices también es carpeta (invoices/new.html...) y se
  // respondía como carpeta sin index: "no encontrada" al recargar o al actualizarse.
  app.use((req, res, next) => {
    if ((req.method !== "GET" && req.method !== "HEAD") || req.path.startsWith("/api")) {
      return next();
    }
    let route: string;
    try {
      route = decodeURIComponent(req.path).replace(/\/+$/, "");
    } catch {
      return next();
    }
    if (!route || path.extname(route)) {
      return next();
    }
    const file = path.resolve(dir, `.${route}.html`);
    if (!file.startsWith(dir + path.sep) || !fs.existsSync(file)) {
      return next();
    }
    contentSecurityPolicy(req, res, () => res.sendFile(file));
  });
  app.use(contentSecurityPolicy, express.static(dir, { extensions: ["html"], index: "index.html", redirect: false }));
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api")) {
      return next();
    }
    res.status(404);
    contentSecurityPolicy(req, res, () => res.sendFile(notFoundPage));
  });

  return true;
}
