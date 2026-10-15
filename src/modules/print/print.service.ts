import { exec } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

import Jimp from "jimp";
import { CharacterSet, printer as ThermalPrinter, PrinterTypes } from "node-thermal-printer";

import { env } from "../../config/env";
import { footerLines } from "../../utils/footer-text";
import { AppError } from "../../utils/http-error";
import { invoiceAssetDataUri } from "../invoices/invoice-assets";
import { invoicesService } from "../invoices/invoices.service";
import { settingsService } from "../settings/settings.service";
import { writeEnv } from "../system/database.service";
import { sendRawToWindowsPrinter, windowsPrinterStatus } from "./local-printers";

type TicketDetail = Awaited<ReturnType<typeof invoicesService.getInvoiceDetail>>;
type BillingSettings = Awaited<ReturnType<typeof settingsService.getBillingSettings>>;

type PrinterMode =
  | { kind: "unset" }
  | { kind: "direct"; iface: string } // tcp://, \\.\COM# (node-thermal-printer execute)
  | { kind: "share"; target: string } // impresora compartida de Windows (copy /b, sin driver nativo)
  | { kind: "raw"; printer: string } // windows-raw:Nombre (cola de Windows en crudo, sin compartir)
  | { kind: "driver"; iface: string }; // printer:auto / printer:Nombre (requiere módulo nativo)

function money(value: number) {
  return `L ${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value) || 0)}`;
}

function quantity(value: number) {
  return Number.isInteger(Number(value)) ? String(value) : Number(value).toFixed(2);
}

/**
 * Fecha "AAAA-MM-DD" como "DD/MM/AAAA", sin pasar por Date: una fecha sin hora
 * interpretada como medianoche UTC salía como las 6:00 p. m. del día anterior.
 */
function ticketDate(value: string | Date) {
  if (value instanceof Date) {
    return `${String(value.getDate()).padStart(2, "0")}/${String(value.getMonth() + 1).padStart(2, "0")}/${value.getFullYear()}`;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  return match ? `${match[3]}/${match[2]}/${match[1]}` : String(value).slice(0, 10);
}

/** Hora real de emisión en hora de Honduras (p. ej. "3:45 p. m."). */
function ticketTime(value: string | Date | null | undefined) {
  const parsed = value ? new Date(value) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) {
    return "";
  }
  return parsed.toLocaleTimeString("es-HN", { timeZone: "America/Tegucigalpa", hour: "numeric", minute: "2-digit" });
}

/** Evita que un puerto COM/impresora sin respuesta cuelgue el request para siempre. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      setTimeout(() => reject(new Error(`${label}: sin respuesta en ${ms}ms (¿impresora encendida y en línea?)`)), ms);
    })
  ]);
}

/** Impresora de tickets en uso (PRINTER_INTERFACE); se cambia desde Sistema > Impresoras. */
let currentInterface = env.PRINTER_INTERFACE.trim();

class PrintService {
  /** Interpreta PRINTER_INTERFACE en un modo de impresión. */
  private mode(): PrinterMode {
    const iface = currentInterface;
    if (!iface) {
      return { kind: "unset" };
    }
    if (iface.startsWith("windows-raw:")) {
      return { kind: "raw", printer: iface.slice("windows-raw:".length).trim() };
    }
    if (iface.startsWith("windows:")) {
      const name = iface.slice("windows:".length).trim();
      return { kind: "share", target: name.startsWith("\\\\") ? name : `\\\\localhost\\${name}` };
    }
    // UNC de recurso compartido (\\host\share), pero NO el dispositivo \\.\COM#
    if (iface.startsWith("\\\\") && !iface.startsWith("\\\\.\\")) {
      return { kind: "share", target: iface };
    }
    if (iface.startsWith("printer:")) {
      return { kind: "driver", iface };
    }
    return { kind: "direct", iface };
  }

  /** Carga (opcional) el driver nativo solo para el interface "printer:". */
  private resolveDriver(): unknown {
    for (const moduleName of ["@thiagoelg/node-printer", "printer"]) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        return require(moduleName);
      } catch {
        // Driver no instalado.
      }
    }
    return undefined;
  }

  private buildPrinter(iface: string, driver?: unknown) {
    return new ThermalPrinter({
      type: PrinterTypes[env.PRINTER_TYPE] ?? PrinterTypes.EPSON,
      interface: iface || "tcp://127.0.0.1:9100",
      width: env.PRINTER_WIDTH,
      characterSet: CharacterSet[env.PRINTER_CHARACTER_SET] ?? env.PRINTER_CHARACTER_SET,
      removeSpecialCharacters: env.PRINTER_REMOVE_ACCENTS === "true",
      // baudRate solo aplica a puertos serial/COM (ej. EPSON TM Virtual Port).
      options: { timeout: env.PRINTER_TIMEOUT, baudRate: env.PRINTER_BAUD_RATE },
      ...(driver ? { driver } : {})
    });
  }

  /**
   * ¿El puerto COM existe y está libre? Se abre y se cierra de inmediato (no envía
   * datos). Un puerto serial no informa si la impresora está encendida: "conectado"
   * significa que el puerto responde.
   */
  private async serialPortStatus(port: string): Promise<{ connected: boolean; error?: string }> {
    try {
      const handle = await withTimeout(fs.promises.open(port, "r+"), 3000, "Chequeo del puerto");
      await handle.close();
      return { connected: true };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return { connected: false, error: `El puerto ${port} no existe en este equipo.` };
      }
      if (code === "EBUSY" || code === "EACCES" || code === "EPERM") {
        return { connected: false, error: `El puerto ${port} está en uso por otro programa.` };
      }
      return { connected: false, error: (error as Error).message };
    }
  }

  /** Manda el buffer ESC/POS crudo a una impresora compartida de Windows (sin driver nativo). */
  private spoolToShare(buffer: Buffer, target: string) {
    const tmp = path.join(os.tmpdir(), `ticket-${Date.now()}-${Math.random().toString(36).slice(2)}.bin`);
    fs.writeFileSync(tmp, buffer);
    return new Promise<void>((resolve, reject) => {
      exec(`copy /b "${tmp}" "${target}"`, (error, _stdout, stderr) => {
        fs.promises.unlink(tmp).catch(() => undefined);
        if (error) {
          reject(new Error((stderr && stderr.trim()) || error.message));
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Cambia la impresora de tickets de esta PC y la guarda en config.env.
   * Valores: \\.\COM#, windows-raw:Nombre, tcp://IP:9100, windows:Compartida o vacío.
   */
  setInterface(value: string) {
    const iface = value.trim();
    if (iface && !/^(\\\\\.\\COM\d+|windows-raw:.+|windows:.+|tcp:\/\/[\w.-]+(:\d+)?|\\\\[^\\]+\\.+)$/i.test(iface)) {
      throw new AppError("La impresora elegida no es válida.", 400);
    }
    writeEnv({ PRINTER_INTERFACE: iface });
    currentInterface = iface;
    console.log(`[impresión] Impresora de tickets: ${iface || "ninguna"}`);
  }

  async status() {
    const mode = this.mode();
    const base = { interface: currentInterface, type: env.PRINTER_TYPE, mode: mode.kind };

    if (mode.kind === "unset") {
      return { ...base, configured: false, connected: false };
    }
    if (mode.kind === "raw") {
      return { ...base, configured: true, ...(await windowsPrinterStatus(mode.printer)) };
    }
    if (mode.kind === "share") {
      return { ...base, configured: true, connected: true };
    }
    if (mode.kind === "driver") {
      const driver = this.resolveDriver();
      if (!driver) {
        return { ...base, configured: true, connected: false, error: "El interface printer: requiere un driver nativo no instalado." };
      }
    }
    // Puerto serial (\\.\COM#): node-thermal-printer usa fs.existsSync, que en Windows
    // siempre da false para rutas de dispositivo. Se verifica abriendo el puerto.
    if (mode.kind === "direct" && /^\\\\\.\\COM\d+$/i.test(mode.iface)) {
      return { ...base, configured: true, ...(await this.serialPortStatus(mode.iface)) };
    }
    try {
      const printer = this.buildPrinter(mode.iface, mode.kind === "driver" ? this.resolveDriver() : undefined);
      const connected = await withTimeout(printer.isPrinterConnected(), 3000, "Chequeo de impresora");
      return { ...base, configured: true, connected };
    } catch (error) {
      return { ...base, configured: true, connected: false, error: (error as Error).message };
    }
  }

  /** Obtiene los bytes de la imagen del logo (data URI, URL http o asset embebido). */
  private async loadImageBytes(logoUrl: string): Promise<Buffer | null> {
    if (logoUrl.startsWith("data:")) {
      return Buffer.from(logoUrl.replace(/^data:image\/\w+;base64,/, ""), "base64");
    }
    if (/^https?:\/\//i.test(logoUrl)) {
      const res = await fetch(logoUrl);
      if (!res.ok) {
        return null;
      }
      return Buffer.from(await res.arrayBuffer());
    }
    const embedded = invoiceAssetDataUri(logoUrl);
    if (embedded?.startsWith("data:")) {
      return Buffer.from(embedded.replace(/^data:image\/\w+;base64,/, ""), "base64");
    }
    return null;
  }

  /** Prepara el logo como PNG monocromo del ancho de la impresora. null si no aplica/falla. */
  private async buildLogoBuffer(logoUrl: string | null): Promise<Buffer | null> {
    if (env.PRINTER_LOGO !== "true" || !logoUrl) {
      return null;
    }
    try {
      const source = await this.loadImageBytes(logoUrl.trim());
      if (!source) {
        return null;
      }

      const original = await Jimp.read(source);
      // Aplana la transparencia sobre blanco (si no, lo transparente sale negro).
      const image = new Jimp(original.bitmap.width, original.bitmap.height, 0xffffffff);
      image.composite(original, 0, 0);
      // scaleToFit respeta la proporción y limita ANCHO y ALTO: así un logo cuadrado
      // o vertical no ocupa medio ticket (antes: ancho fijo con alto sin tope).
      image.scaleToFit(env.PRINTER_LOGO_WIDTH, env.PRINTER_LOGO_MAX_HEIGHT).greyscale();

      const data = image.bitmap.data;
      const width = image.bitmap.width;
      const height = image.bitmap.height;
      const pixelCount = width * height;

      // Luminancia media: si la imagen es mayormente oscura (logo claro sobre fondo
      // oscuro), se invierte para que el papel blanco no salga todo negro.
      let sum = 0;
      for (let i = 0; i < data.length; i += 4) {
        sum += data[i] ?? 0;
      }
      const mean = pixelCount ? sum / pixelCount : 255;
      const invert = env.PRINTER_LOGO_INVERT === "true" || (env.PRINTER_LOGO_INVERT === "auto" && mean < 128);

      // Luminancia normalizada (aplicando la inversión).
      const lum = new Float32Array(pixelCount);
      for (let p = 0, i = 0; i < data.length; i += 4, p += 1) {
        lum[p] = invert ? 255 - (data[i] ?? 0) : data[i] ?? 0;
      }

      if (env.PRINTER_LOGO_DITHER === "true") {
        // Floyd–Steinberg: mejor para fotos/degradados en 1 bit.
        for (let y = 0; y < height; y += 1) {
          for (let x = 0; x < width; x += 1) {
            const p = y * width + x;
            const oldValue = lum[p] ?? 0;
            const newValue = oldValue < 128 ? 0 : 255;
            const error = oldValue - newValue;
            lum[p] = newValue;
            if (x + 1 < width) lum[p + 1] = (lum[p + 1] ?? 0) + (error * 7) / 16;
            if (y + 1 < height) {
              if (x > 0) lum[p + width - 1] = (lum[p + width - 1] ?? 0) + (error * 3) / 16;
              lum[p + width] = (lum[p + width] ?? 0) + (error * 5) / 16;
              if (x + 1 < width) lum[p + width + 1] = (lum[p + width + 1] ?? 0) + error / 16;
            }
          }
        }
      } else {
        // Umbral duro: mejor para logos planos de alto contraste.
        const threshold = env.PRINTER_LOGO_THRESHOLD;
        for (let p = 0; p < pixelCount; p += 1) {
          lum[p] = (lum[p] ?? 0) < threshold ? 0 : 255;
        }
      }

      for (let p = 0, i = 0; i < data.length; i += 4, p += 1) {
        const value = (lum[p] ?? 0) < 128 ? 0 : 255;
        data[i] = value;
        data[i + 1] = value;
        data[i + 2] = value;
        data[i + 3] = 255;
      }

      return await image.getBufferAsync(Jimp.MIME_PNG);
    } catch {
      // Un logo inválido nunca debe romper el ticket.
      return null;
    }
  }

  /**
   * Interlineado (impresoras compatibles con Epson): `dots` puntos entre líneas, o el
   * de la impresora con null. Líneas más juntas = menos papel.
   */
  private lineSpacing(printer: InstanceType<typeof ThermalPrinter>, dots: number | null) {
    if (env.PRINTER_TYPE !== "EPSON" || env.PRINTER_LINE_SPACING === 0) return;
    printer.add(dots === null ? Buffer.from([0x1b, 0x32]) : Buffer.from([0x1b, 0x33, dots]));
  }

  /** Texto en doble tamaño con el interlineado de la impresora (así no se encima). */
  private large(printer: InstanceType<typeof ThermalPrinter>, write: () => void) {
    this.lineSpacing(printer, null);
    printer.bold(true);
    printer.setTextSize(1, 1);
    write();
    printer.setTextNormal();
    printer.bold(false);
    this.lineSpacing(printer, env.PRINTER_LINE_SPACING);
  }

  /**
   * Avanza solo hasta la cuchilla y corta. En Epson y compatibles con GS V 65 0 (la
   * impresora sabe cuánto falta); en otras, una sola pausa antes de cortar.
   */
  private feedAndCut(printer: InstanceType<typeof ThermalPrinter>) {
    if (env.PRINTER_TYPE === "EPSON") {
      printer.add(Buffer.from([0x1d, 0x56, 0x41, 0x00]));
      printer.add(Buffer.from([0x1b, 0x40])); // ESC @: impresora como al inicio.
    } else {
      printer.cut({ verticalTabAmount: 1 });
    }
  }

  private formatTicket(printer: InstanceType<typeof ThermalPrinter>, detail: TicketDetail, billing: BillingSettings, logoPrinted = false) {
    this.lineSpacing(printer, env.PRINTER_LINE_SPACING);
    printer.alignCenter();
    if (logoPrinted) {
      // Con logo no se imprime el nombre comercial (el logo ya lo representa).
      printer.bold(true);
      printer.println(detail.companyLegalNameSnapshot || detail.companyCommercialNameSnapshot);
      printer.bold(false);
    } else {
      this.large(printer, () => printer.println(detail.companyCommercialNameSnapshot || detail.companyLegalNameSnapshot));
      if (detail.companyLegalNameSnapshot && detail.companyLegalNameSnapshot !== detail.companyCommercialNameSnapshot) {
        printer.println(detail.companyLegalNameSnapshot);
      }
    }
    printer.println(`RTN: ${detail.companyRtnSnapshot}`);
    if (detail.companyAddressSnapshot) {
      printer.println(detail.companyAddressSnapshot);
    }
    if (detail.companyPhoneSnapshot) {
      printer.println(`Tel: ${detail.companyPhoneSnapshot}`);
    }

    printer.drawLine();

    printer.alignLeft();
    printer.bold(true);
    printer.println(`${detail.settings.invoiceTitle} ${detail.invoiceNumber}`);
    printer.bold(false);
    printer.println(`Fecha: ${ticketDate(detail.printInvoiceDate)} ${ticketTime(detail.issuedAt)}`.trim());
    // Cajero y tipo de venta en la misma línea.
    printer.leftRight(`Cajero: ${detail.createdByName ?? "N/D"}`, detail.saleType === "CREDITO" ? "CREDITO" : "CONTADO");
    printer.println(`Cliente: ${detail.printCustomerName}`);
    printer.println(`RTN: ${detail.customerRtnSnapshot?.trim() ? detail.customerRtnSnapshot : "Consumidor final"}`);

    printer.drawLine();

    for (const item of detail.items) {
      const total = money(Number(item.lineTotal));
      // Una unidad: descripción e importe en una sola línea si caben.
      if (Number(item.quantity) === 1 && item.description.length + total.length + 1 <= env.PRINTER_WIDTH) {
        printer.leftRight(item.description, total);
        continue;
      }
      printer.println(item.description);
      printer.leftRight(`  ${quantity(Number(item.quantity))} x ${money(Number(item.unitPrice))}`, total);
    }

    printer.drawLine();

    printer.leftRight("Subtotal", money(Number(detail.subtotal)));
    if (Number(detail.discountTotal) > 0) {
      printer.leftRight("Descuento", money(Number(detail.discountTotal)));
    }
    if (Number(detail.exoneratedAmount) > 0) {
      printer.leftRight("Exonerado", money(Number(detail.exoneratedAmount)));
    }
    if (Number(detail.exemptAmount) > 0) {
      printer.leftRight("Exento", money(Number(detail.exemptAmount)));
    }
    if (Number(detail.taxableAmount15) > 0) {
      printer.leftRight("Gravado 15%", money(Number(detail.taxableAmount15)));
    }
    if (Number(detail.taxableAmount18) > 0) {
      printer.leftRight("Gravado 18%", money(Number(detail.taxableAmount18)));
    }
    if (Number(detail.isv15) > 0) {
      printer.leftRight("ISV 15%", money(Number(detail.isv15)));
    }
    if (Number(detail.isv18) > 0) {
      printer.leftRight("ISV 18%", money(Number(detail.isv18)));
    }
    this.large(printer, () => printer.leftRight("TOTAL", money(Number(detail.grandTotal))));
    if (detail.totalInWords) {
      printer.println(detail.totalInWords);
    }

    printer.drawLine();

    printer.alignCenter();
    printer.println(`CAI: ${detail.caiSnapshot}`);
    printer.println(`Fecha limite de emision: ${ticketDate(detail.issueDeadlineSnapshot)}`);
    printer.println(`Rango autorizado: ${detail.rangeStartSnapshot} - ${detail.rangeEndSnapshot}`);
    if (billing.sarNotice) {
      printer.println(billing.sarNotice);
    }
    const footer = footerLines(detail.settings.footerText ?? billing.footerText);
    if (footer.length === 1) {
      printer.println(footer[0]!);
    } else if (footer.length > 1) {
      // Dibujo con caracteres: alineado a la izquierda y centrado como bloque, así cada
      // carácter queda en su columna; líneas pegadas (sin espacio entre ellas). Las
      // líneas más anchas que el papel se cortan solas.
      printer.alignLeft();
      this.lineSpacing(printer, 24);
      const longest = Math.max(...footer.map((line) => line.length));
      const indent = " ".repeat(Math.max(0, Math.floor((env.PRINTER_WIDTH - longest) / 2)));
      for (const line of footer) {
        printer.println(indent + line);
      }
      printer.alignCenter();
    }

    this.feedAndCut(printer);
  }

  /** Impresora lista para armar un ticket (y su modo), o error claro si no hay. */
  private prepare() {
    const mode = this.mode();

    if (mode.kind === "unset") {
      throw new AppError("No hay impresora de tickets en esta PC. Elígela en Sistema > Impresoras.", 503);
    }

    let driver: unknown;
    if (mode.kind === "driver") {
      driver = this.resolveDriver();
      if (!driver) {
        throw new AppError("Esa impresora necesita un componente que no está instalado. Elige otra en Sistema > Impresoras.", 500);
      }
    }

    const printer = this.buildPrinter(mode.kind === "direct" || mode.kind === "driver" ? mode.iface : "", driver);
    return { mode, printer };
  }

  /** Envía lo armado a la impresora según el modo. */
  private async send(mode: PrinterMode, printer: InstanceType<typeof ThermalPrinter>) {
    const guardMs = Math.max(env.PRINTER_TIMEOUT + 3000, 6000);
    try {
      if (mode.kind === "share") {
        await withTimeout(this.spoolToShare(printer.getBuffer(), mode.target), guardMs, "Impresión");
      } else if (mode.kind === "raw") {
        await withTimeout(sendRawToWindowsPrinter(printer.getBuffer(), mode.printer), Math.max(guardMs, 30000), "Impresión");
      } else {
        await withTimeout(printer.execute(), guardMs, "Impresión");
      }
    } catch (error) {
      throw new AppError(`No se pudo imprimir el ticket: ${(error as Error).message}`, 502);
    }
  }

  /** Ticket corto de prueba con el mismo formato que las facturas. */
  async printTestTicket(companyName: string) {
    const { mode, printer } = this.prepare();
    this.lineSpacing(printer, env.PRINTER_LINE_SPACING);
    printer.alignCenter();
    printer.bold(true);
    printer.println(companyName);
    printer.bold(false);
    printer.println("Prueba de impresora de tickets");
    printer.drawLine();
    printer.alignLeft();
    printer.leftRight("Fecha", new Date().toLocaleString("es-HN", { timeZone: "America/Tegucigalpa" }));
    printer.leftRight("Acentos", "áéíóú ñ Ñ ¿?");
    printer.leftRight("Total", money(1234.5));
    printer.drawLine();
    printer.alignCenter();
    printer.println("Si lees esto bien, la impresora esta lista.");
    this.feedAndCut(printer);
    await this.send(mode, printer);
    return { ok: true };
  }

  async printInvoiceTicket(companyId: number, invoiceId: number) {
    const { mode, printer } = this.prepare();

    const [detail, billing] = await Promise.all([
      invoicesService.getInvoiceDetail(companyId, invoiceId),
      settingsService.getBillingSettings(companyId)
    ]);

    // Logo de la empresa (raster ESC/POS), si hay y se pudo preparar.
    const logo = await this.buildLogoBuffer(detail.companyLogoUrl);
    let logoPrinted = false;
    if (logo) {
      try {
        printer.alignCenter();
        await printer.printImageBuffer(logo);
        logoPrinted = true;
      } catch {
        // Sin logo si el raster falla; el ticket sigue.
      }
    }

    this.formatTicket(printer, detail, billing, logoPrinted);
    await this.send(mode, printer);

    return { ok: true, invoiceNumber: detail.invoiceNumber };
  }
}

export const printService = new PrintService();
