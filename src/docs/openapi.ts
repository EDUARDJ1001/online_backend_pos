import type { Express, RequestHandler } from "express";
import type { ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

/**
 * Documentación OpenAPI generada de las rutas reales de Express: recorre los routers,
 * toma los esquemas de zod de validateRequest() y el permiso de requirePermission().
 * Así no hay que mantener un archivo aparte: una ruta nueva aparece sola.
 */

type JsonSchema = Record<string, unknown> & { properties?: Record<string, JsonSchema>; required?: string[]; description?: string };

interface Tagged {
  openapi?: { schema?: ZodTypeAny; source?: "body" | "query" | "params"; permission?: string };
}

interface Layer {
  name: string;
  handle: RequestHandler & Tagged & { stack?: Layer[] };
  regexp: RegExp & { fast_slash?: boolean };
  route?: { path: string | string[]; methods: Record<string, boolean>; stack: Layer[] };
}

interface Middleware {
  path: string;
  name: string;
}

const METHODS = ["get", "post", "put", "patch", "delete"] as const;

/** Rutas por las que pasan los terminales de caja (x-cash-terminal). */
const CASH_TERMINAL_PREFIXES = ["/api/caja", "/api/invoices"];

/** "/^\/api\/clients\/?(?=\/|$)/i" -> "/api/clients" (express 4 no guarda el texto del montaje). */
function mountPath(layer: Layer) {
  if (layer.regexp.fast_slash) return "";
  return layer.regexp.source
    .replace(/^\^/, "")
    .replace(/\\\/\?\(\?=\\\/\|\$\)$/, "")
    .replace(/\\\//g, "/");
}

function toJsonSchema(schema: ZodTypeAny) {
  // Sin el tipo genérico: con los esquemas del proyecto TypeScript no termina de inferirlo.
  const convert = zodToJsonSchema as (schema: unknown, options: object) => unknown;
  const json = convert(schema, { target: "openApi3", $refStrategy: "none" }) as JsonSchema;
  delete json.$schema;
  return json;
}

function parametersFrom(schema: ZodTypeAny, location: "query" | "path") {
  const json = toJsonSchema(schema);
  const required = new Set(json.required ?? []);
  return Object.entries(json.properties ?? {}).map(([name, property]) => ({
    name,
    in: location,
    required: location === "path" || required.has(name),
    description: property.description,
    schema: property
  }));
}

function tagFor(path: string) {
  const segment = path.replace(/^\/api\//, "").split("/")[0];
  return segment && !segment.startsWith("{") ? segment : "general";
}

export function buildOpenApi(app: Express, serverUrl?: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  const seen: Middleware[] = [];

  const applies = (route: string, name: string) =>
    seen.some((middleware) => middleware.name === name && (route === middleware.path || route.startsWith(`${middleware.path}/`)));

  const addRoute = (prefix: string, layer: Layer) => {
    const route = layer.route!;
    const handles = route.stack.map((item) => item.handle);
    const routePaths = Array.isArray(route.path) ? route.path : [route.path];

    for (const routePath of routePaths) {
      const fullPath = `${prefix}${routePath === "/" ? "" : routePath}` || "/";
      if (fullPath.startsWith("/docs")) continue;
      const openApiPath = fullPath.replace(/:(\w+)/g, "{$1}");
      const auth = applies(fullPath, "requireAuth") || handles.some((handle) => handle.name === "requireAuth");
      const company = applies(fullPath, "requireActiveCompany");
      const permission = handles.find((handle) => handle.openapi?.permission)?.openapi?.permission;

      const parameters: unknown[] = [];
      let requestBody: unknown;
      for (const handle of handles) {
        const { schema, source } = handle.openapi ?? {};
        if (!schema || !source) continue;
        if (source === "body") {
          requestBody = { required: true, content: { "application/json": { schema: toJsonSchema(schema) } } };
        } else {
          parameters.push(...parametersFrom(schema, source === "params" ? "path" : "query"));
        }
      }
      // Parámetros de ruta sin esquema de validación.
      for (const [, name] of openApiPath.matchAll(/\{(\w+)\}/g)) {
        if (!parameters.some((parameter) => (parameter as { name: string; in: string }).in === "path" && (parameter as { name: string }).name === name)) {
          parameters.push({ name, in: "path", required: true, schema: { type: "string" } });
        }
      }
      if (company) {
        parameters.push({ $ref: "#/components/parameters/CompanyId" });
      }
      if (CASH_TERMINAL_PREFIXES.some((cashPrefix) => fullPath.startsWith(cashPrefix))) {
        parameters.push({ $ref: "#/components/parameters/CashTerminal" });
      }

      for (const method of METHODS) {
        if (!route.methods[method]) continue;
        paths[openApiPath] ??= {};
        paths[openApiPath]![method] = {
          tags: [tagFor(fullPath)],
          description: permission ? `Permiso requerido: \`${permission}\`` : undefined,
          security: auth ? [{ bearerAuth: [] }] : [],
          parameters: parameters.length ? parameters : undefined,
          requestBody: method === "get" ? undefined : requestBody,
          responses: {
            "200": { description: "Correcto" },
            "400": { $ref: "#/components/responses/Error" },
            ...(auth ? { "401": { $ref: "#/components/responses/Error" }, "403": { $ref: "#/components/responses/Error" } } : {})
          }
        };
      }
    }
  };

  const walk = (stack: Layer[], prefix: string) => {
    for (const layer of stack) {
      if (layer.route) {
        addRoute(prefix, layer);
      } else if (layer.handle.stack) {
        walk(layer.handle.stack, `${prefix}${mountPath(layer)}`);
      } else {
        seen.push({ path: `${prefix}${mountPath(layer)}`, name: layer.handle.name || layer.name });
      }
    }
  };

  walk((app as unknown as { _router: { stack: Layer[] } })._router.stack, "");

  return {
    openapi: "3.0.3",
    info: {
      title: "Facturación POS - API",
      version: process.env.FACTURACION_VERSION ?? "dev",
      description:
        "API del backend de facturación para las terminales POS independientes.\n\n" +
        "1. `POST /api/auth/login` con usuario y contraseña.\n" +
        "2. Copia el `accessToken` en **Authorize** (sin escribir `Bearer`).\n" +
        "3. Las rutas de una empresa piden el encabezado `x-company-id` (ver `GET /api/companies`)."
    },
    servers: serverUrl ? [{ url: serverUrl }] : undefined,
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" }
      },
      parameters: {
        CompanyId: { name: "x-company-id", in: "header", required: true, description: "Empresa activa.", schema: { type: "integer" } },
        CashTerminal: {
          name: "x-cash-terminal",
          in: "header",
          required: false,
          description: "Token del equipo de caja vinculado (lo entrega el canje del código de vinculación).",
          schema: { type: "string" }
        }
      },
      responses: {
        Error: {
          description: "Error con mensaje en español.",
          content: {
            "application/json": {
              schema: { type: "object", properties: { message: { type: "string" }, details: {} } }
            }
          }
        }
      }
    },
    paths
  };
}
