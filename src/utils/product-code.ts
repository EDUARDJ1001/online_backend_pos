/**
 * Códigos de producto simétricos: los numéricos cortos se muestran con ceros a la
 * izquierda hasta 7 dígitos (212 → 0000212). Los productos nuevos se crean así; los ya
 * guardados con menos dígitos se muestran igual sin cambiar lo guardado. Códigos con
 * letras, más largos o de barras no se tocan.
 */
export const PRODUCT_CODE_DIGITS = 7;

export function padProductCode<T extends string | null | undefined>(code: T): T {
  if (typeof code !== "string") return code;
  return (/^\d{1,6}$/.test(code) ? code.padStart(PRODUCT_CODE_DIGITS, "0") : code) as T;
}

/** Aplica el formato a una propiedad de cada fila (por defecto productCode). */
export function padProductCodes<T extends object>(rows: T[], key = "productCode"): T[] {
  for (const row of rows as Array<Record<string, unknown>>) {
    if (key in row) row[key] = padProductCode(row[key] as string | null);
  }
  return rows;
}

/**
 * Términos para buscar por código: lo escrito y, si son dígitos con ceros a la izquierda,
 * también sin ellos (0000212 encuentra el 212 guardado antes).
 */
export function productCodeSearchTerm(search: string) {
  const term = search.trim();
  return /^0+\d+$/.test(term) ? term.replace(/^0+(?=\d)/, "") : term;
}
