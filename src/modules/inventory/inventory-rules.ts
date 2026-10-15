/**
 * Reglas de validación de inventario compartidas por esquemas y servicio.
 * (El frontend replica las mismas reglas en src/lib/inventory-rules.ts.)
 */

/** Unidades que se cuentan por piezas: solo admiten cantidades enteras. */
const COUNTABLE_UNITS = new Set([
  "UND",
  "UNI",
  "UNIDAD",
  "UNIDADES",
  "U",
  "PCS",
  "PC",
  "PZA",
  "PZ",
  "PIEZA",
  "PIEZAS",
  "CAJA",
  "CAJAS",
  "CJ",
  "PAQ",
  "PAQUETE",
  "PAR",
  "PARES",
  "DOC",
  "DOCENA",
  "BOLSA",
  "BOTELLA",
  "LATA",
  "ROLLO",
  "JUEGO",
  "KIT",
  "SET"
]);

export const MAX_QUANTITY = 1_000_000;
export const MAX_UNIT_COST = 99_999_999;

/** Unidades de servicios (tiempo o servicio); los productos no las usan. */
const SERVICE_UNITS = new Set(["SERV", "SRV", "SERVICIO", "HORA", "HR", "HRS", "DIA", "MES", "VISITA"]);

export function isServiceUnit(unit: string | null | undefined) {
  return SERVICE_UNITS.has((unit ?? "").trim().toUpperCase());
}

/** Motivo si la unidad no corresponde al tipo (servicio: por servicio o tiempo; producto: el resto), o null. */
export function unitTypeProblem(type: "PRODUCTO" | "SERVICIO", unit: string | null | undefined) {
  if (type === "SERVICIO" && !isServiceUnit(unit)) {
    return "Un servicio se vende por servicio, hora, día, mes o visita, no por unidades, peso ni medida.";
  }
  if (type === "PRODUCTO" && isServiceUnit(unit)) {
    return "Un producto no se vende por servicio ni por tiempo: elige unidad, peso o medida, o regístralo como servicio.";
  }
  return null;
}

export function isCountableUnit(unit: string | null | undefined) {
  return COUNTABLE_UNITS.has((unit ?? "").trim().toUpperCase());
}

/** Máximo 2 decimales (las columnas son DECIMAL(14,2)). */
export function hasAtMostTwoDecimals(value: number) {
  return Math.abs(Math.round(value * 100) - value * 100) < 1e-6;
}

/** Fecha de hoy en Honduras (YYYY-MM-DD), para no aceptar fechas futuras. */
export function todayInHonduras() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Tegucigalpa" }).format(new Date());
}
