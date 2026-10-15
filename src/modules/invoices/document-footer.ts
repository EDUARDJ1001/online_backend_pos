import { footerLines } from "../../utils/footer-text";

/**
 * Franja de marcas al pie de los documentos carta (factura, proforma,
 * cotización). Las imágenes son las que cada empresa configura; sin imágenes no
 * se dibuja nada.
 */
export function drawFooterBrands(doc: PDFKit.PDFDocument, images: Buffer[], top: number, accent: string) {
  if (images.length === 0) {
    return;
  }

  const left = 20;
  const width = 572;
  const bandTop = top + 10;
  const bandHeight = 40;
  const slot = width / images.length;
  const gap = 8;

  doc.rect(14, top, 584, 3).fillColor(accent).fill();

  images.forEach((image, index) => {
    try {
      doc.image(image, left + index * slot + gap / 2, bandTop, {
        fit: [slot - gap, bandHeight],
        align: "center",
        valign: "center"
      });
    } catch (_error) {
      // Una imagen inválida no rompe el documento.
    }
  });
}

/** Franja de marcas en HTML (vista imprimible). */
export function footerBrandsHtml(images: string[]) {
  if (images.length === 0) {
    return "";
  }

  return `<div class="brand-strip">${images.map((src) => `<img src="${src}" alt="" />`).join("")}</div>`;
}

/** Ancho de un carácter de Courier respecto a su tamaño (fuente de ancho fijo). */
const COURIER_WIDTH = 0.6;

interface FooterTextBox {
  x: number;
  y: number;
  width: number;
  /** Alto disponible para un dibujo de varias líneas (se achica para caber). */
  maxHeight?: number;
  /** Tamaño de la frase de una línea y tamaño máximo del dibujo. */
  size: number;
  bold?: boolean;
  color?: string;
}

/**
 * Pie de documento en PDF. Una línea: frase centrada (como siempre). Varias líneas
 * (dibujo con caracteres): letra de ancho fijo, cada carácter en su columna, bloque
 * centrado y achicado para caber en el ancho y el alto. Devuelve dónde termina.
 */
export function drawFooterText(doc: PDFKit.PDFDocument, text: string, box: FooterTextBox) {
  const lines = footerLines(text);
  if (lines.length === 0) {
    return box.y;
  }
  if (lines.length === 1) {
    doc
      .font(box.bold === false ? "Helvetica" : "Helvetica-Bold")
      .fontSize(box.size)
      .fillColor(box.color ?? "#0f172a")
      .text(lines[0]!, box.x, box.y, { width: box.width, align: "center" });
    return doc.y;
  }

  const size = footerArtSize(lines, box.width, box.size, box.maxHeight);
  const charWidth = size * COURIER_WIDTH;
  const longest = Math.max(...lines.map((line) => line.length));
  const left = box.x + Math.max(0, (box.width - longest * charWidth) / 2);
  doc.font("Courier").fontSize(size).fillColor(box.color ?? "#0f172a");
  lines.forEach((line, row) => {
    // Cada tramo sin espacios en su columna exacta: los espacios no se pierden ni se encogen.
    for (const run of line.matchAll(/\S+/g)) {
      doc.text(run[0], left + run.index! * charWidth, box.y + row * size, { lineBreak: false });
    }
  });
  return box.y + lines.length * size;
}

/** Tamaño de letra del dibujo para caber en el ancho (y en el alto, si se indica). */
export function footerArtSize(lines: string[], width: number, maxSize: number, maxHeight?: number) {
  const longest = Math.max(1, ...lines.map((line) => line.length));
  let size = Math.min(maxSize, width / (longest * COURIER_WIDTH));
  if (maxHeight !== undefined) size = Math.min(size, maxHeight / lines.length);
  return Math.max(2.5, size);
}

function escapeFooterHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Pie de documento en HTML. Una línea: párrafo con la clase indicada. Varias líneas:
 * bloque de ancho fijo centrado que respeta los espacios.
 */
export function footerTextHtml(text: string, className: string, maxWidthPx = 680) {
  const lines = footerLines(text);
  if (lines.length <= 1) {
    return `<p class="${className}">${escapeFooterHtml(lines[0] ?? "")}</p>`;
  }
  const size = Math.min(13, maxWidthPx / (Math.max(...lines.map((line) => line.length)) * COURIER_WIDTH));
  return `<div style="text-align:center;margin-top:14px"><pre style="display:inline-block;margin:0;text-align:left;font-family:'Courier New',Consolas,monospace;font-weight:400;line-height:1;white-space:pre;font-size:${size.toFixed(2)}px">${escapeFooterHtml(lines.join("\n"))}</pre></div>`;
}
