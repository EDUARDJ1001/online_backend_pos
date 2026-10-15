/**
 * Catálogo canónico de permisos. Cada permiso es "recurso.accion" y está atado
 * a una vista/acción real del sistema. Las asignaciones por rol se guardan en
 * `role_permissions` (editables en la UI); este catálogo define qué existe.
 */

export interface PermissionDef {
  key: string;
  resource: string;
  action: string;
  label: string;
}

interface ResourceDef {
  resource: string;
  label: string;
  actions: Array<{ action: string; label: string }>;
}

const VIEW = { action: "view", label: "Ver" };
const CREATE = { action: "create", label: "Crear" };
const EDIT = { action: "edit", label: "Editar" };

const RESOURCES: ResourceDef[] = [
  { resource: "dashboard", label: "Inicio", actions: [VIEW] },
  { resource: "invoices", label: "Facturas", actions: [VIEW, CREATE, { action: "void", label: "Anular / corregir" }] },
  { resource: "proformas", label: "Proformas", actions: [VIEW, CREATE] },
  { resource: "quotes", label: "Cotizaciones", actions: [VIEW, CREATE] },
  { resource: "clients", label: "Clientes", actions: [VIEW, CREATE, EDIT] },
  { resource: "products", label: "Productos", actions: [VIEW, CREATE, EDIT] },
  { resource: "categories", label: "Categorías", actions: [VIEW, CREATE, EDIT] },
  { resource: "warehouses", label: "Bodegas", actions: [VIEW, CREATE, EDIT] },
  { resource: "inventory", label: "Inventario", actions: [VIEW, { action: "adjust", label: "Ajustar" }] },
  { resource: "receivables", label: "Cuentas por cobrar", actions: [VIEW, { action: "pay", label: "Registrar abono" }] },
  {
    resource: "payables",
    label: "Cuentas por pagar",
    actions: [VIEW, CREATE, { action: "pay", label: "Registrar pago" }, { action: "void", label: "Anular" }]
  },
  { resource: "suppliers", label: "Proveedores", actions: [VIEW, CREATE, EDIT] },
  {
    resource: "caja",
    label: "Caja",
    actions: [
      VIEW,
      { action: "open", label: "Abrir" },
      { action: "close", label: "Cerrar / arqueo" },
      { action: "move", label: "Ingresos / egresos" },
      { action: "manage", label: "Gestionar cajas y equipos" }
    ]
  },
  { resource: "reports", label: "Reportes", actions: [VIEW] },
  { resource: "users", label: "Usuarios", actions: [VIEW, CREATE, EDIT] },
  { resource: "company", label: "Empresa", actions: [VIEW, EDIT] },
  { resource: "settings", label: "Configuración fiscal", actions: [VIEW, { action: "configure", label: "Configurar" }] },
  { resource: "roles", label: "Roles y permisos", actions: [VIEW, EDIT] }
];

export const PERMISSION_CATALOG: PermissionDef[] = RESOURCES.flatMap((resource) =>
  resource.actions.map((action) => ({
    key: `${resource.resource}.${action.action}`,
    resource: resource.resource,
    action: action.action,
    label: `${resource.label}: ${action.label}`
  }))
);

export const CATALOG_BY_RESOURCE = RESOURCES.map((resource) => ({
  resource: resource.resource,
  label: resource.label,
  permissions: resource.actions.map((action) => ({
    key: `${resource.resource}.${action.action}`,
    action: action.action,
    label: action.label
  }))
}));

export const ALL_PERMISSION_KEYS = PERMISSION_CATALOG.map((permission) => permission.key);

const PERMISSION_KEY_SET = new Set(ALL_PERMISSION_KEYS);

export function isValidPermissionKey(key: string) {
  return PERMISSION_KEY_SET.has(key);
}

export const SUPERADMIN_ROLE = "SUPERADMIN";

/** Matriz por defecto para sembrar. SUPERADMIN no se guarda (tiene todo). */
export const DEFAULT_ROLE_MATRIX: Record<string, string[]> = {
  ADMIN: ALL_PERMISSION_KEYS.filter((key) => key !== "roles.edit"),
  CAJERO: [
    "dashboard.view",
    "invoices.view",
    "invoices.create",
    "proformas.view",
    "proformas.create",
    "quotes.view",
    "quotes.create",
    "clients.view",
    "clients.create",
    "products.view",
    "inventory.view",
    "receivables.view",
    "receivables.pay",
    "caja.view",
    "caja.open",
    "caja.close",
    "caja.move"
  ]
};
