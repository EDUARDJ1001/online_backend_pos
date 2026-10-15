import { z, ZodIssueCode, type ZodError, type ZodErrorMap } from "zod";

/**
 * Mensajes de validación en español para los casos genéricos (los esquemas que
 * definen su propio mensaje lo conservan).
 */
const errorMap: ZodErrorMap = (issue, ctx) => {
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      if (issue.received === "undefined" || issue.received === "null") return { message: "Es obligatorio." };
      if (issue.expected === "number") return { message: "Debe ser un número." };
      if (issue.expected === "string") return { message: "Debe ser un texto." };
      if (issue.expected === "boolean") return { message: "Debe ser sí o no." };
      return { message: "Tiene un formato no válido." };
    case ZodIssueCode.invalid_union:
    case ZodIssueCode.invalid_literal:
      return { message: "Tiene un valor no válido." };
    case ZodIssueCode.invalid_enum_value:
      return { message: "Elige una opción de la lista." };
    case ZodIssueCode.invalid_string:
      if (issue.validation === "email") return { message: "Correo no válido." };
      if (issue.validation === "url") return { message: "Dirección web no válida." };
      if (issue.validation === "date") return { message: "Fecha no válida." };
      return { message: "Tiene un formato no válido." };
    case ZodIssueCode.invalid_date:
      return { message: "Fecha no válida." };
    case ZodIssueCode.too_small:
      if (issue.type === "string") return { message: issue.minimum === 1 ? "Es obligatorio." : `Debe tener al menos ${issue.minimum} caracteres.` };
      if (issue.type === "number") return { message: issue.inclusive ? `Debe ser mayor o igual a ${issue.minimum}.` : `Debe ser mayor que ${issue.minimum}.` };
      if (issue.type === "array") return { message: `Agrega al menos ${issue.minimum}.` };
      return { message: "Es demasiado pequeño." };
    case ZodIssueCode.too_big:
      if (issue.type === "string") return { message: `Máximo ${issue.maximum} caracteres.` };
      if (issue.type === "number") return { message: `Debe ser menor o igual a ${issue.maximum}.` };
      if (issue.type === "array") return { message: `Máximo ${issue.maximum} elementos.` };
      return { message: "Es demasiado grande." };
    case ZodIssueCode.not_multiple_of:
      return { message: "Tiene demasiados decimales." };
    default:
      return { message: ctx.defaultError };
  }
};

z.setErrorMap(errorMap);

/** Nombre claro de los campos más comunes (el resto se muestra sin nombre). */
const FIELD_LABELS: Record<string, string> = {
  name: "Nombre",
  code: "Código",
  barcode: "Modelo",
  description: "Descripción",
  imageUrl: "Imagen",
  unitMeasure: "Unidad de medida",
  salePrice: "Precio de venta",
  costPrice: "Costo",
  taxRate: "Impuesto",
  minStock: "Existencia mínima",
  initialStock: "Existencia inicial",
  initialWarehouseId: "Bodega",
  warehouseId: "Bodega",
  categoryId: "Categoría",
  productId: "Producto",
  customerId: "Cliente",
  supplierId: "Proveedor",
  rtn: "RTN",
  email: "Correo",
  phone: "Teléfono",
  address: "Dirección",
  notes: "Notas",
  quantity: "Cantidad",
  unitPrice: "Precio",
  unitCost: "Costo",
  lineDiscount: "Descuento",
  amount: "Monto",
  total: "Total",
  documentNumber: "Número de documento",
  documentDate: "Fecha",
  dueDate: "Vencimiento",
  entryDate: "Fecha",
  invoiceDate: "Fecha",
  paymentDate: "Fecha",
  reference: "Referencia",
  reason: "Motivo",
  username: "Usuario",
  fullName: "Nombre completo",
  password: "Contraseña",
  roleId: "Rol",
  commercialName: "Nombre comercial",
  legalName: "Razón social",
  cai: "CAI",
  issueDeadline: "Fecha límite de emisión",
  rangeStart: "Número inicial",
  rangeEnd: "Número final",
  currentNumber: "Próximo correlativo"
};

/** "Modelo: Máximo 60 caracteres." a partir del primer problema de validación. */
export function describeValidationError(error: ZodError) {
  const issue = error.issues[0];
  if (!issue) {
    return "Hay datos inválidos en la solicitud.";
  }
  const field = [...issue.path].reverse().find((part) => typeof part === "string") as string | undefined;
  const lineIndex = issue.path.find((part) => typeof part === "number") as number | undefined;
  const label = field ? FIELD_LABELS[field] : undefined;
  const where = label ? `${label}${lineIndex !== undefined ? ` (línea ${lineIndex + 1})` : ""}: ` : "";
  return `${where}${issue.message}`;
}
