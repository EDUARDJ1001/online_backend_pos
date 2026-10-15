/**
 * Pie de factura: texto libre de la empresa. Puede ser una frase o un dibujo hecho
 * con caracteres (varias líneas). Los espacios se respetan: en un dibujo, quitar los
 * del inicio de una línea lo deforma.
 */

/** Largo máximo del pie (cabe en la columna de la base en cualquier motor). */
export const FOOTER_TEXT_MAX = 16000;

/** Líneas del pie: sin espacios al final de cada una ni líneas vacías al inicio o al final. */
export function footerLines(text: string | null | undefined): string[] {
  const lines = (text ?? "").replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n").map((line) => line.trimEnd());
  while (lines.length > 0 && !lines[0]) lines.shift();
  while (lines.length > 0 && !lines[lines.length - 1]) lines.pop();
  return lines;
}

/** Texto a guardar (null si está vacío). */
export function cleanFooterText(text: string | null | undefined) {
  const lines = footerLines(text);
  return lines.length > 0 ? lines.join("\n") : null;
}

/** ¿Es un dibujo o texto de varias líneas? Se muestra con letra de ancho fijo. */
export function isFooterArt(text: string | null | undefined) {
  return footerLines(text).length > 1;
}
