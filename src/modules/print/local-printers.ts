import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * Impresoras de tickets de la PC donde corre el sistema (en una caja, la misma PC
 * de la impresora). El ticket térmico (ESC/POS) puede salir por:
 *   - Puerto COM: \\.\COM1 (EPSON TM Virtual Port, serial, Bluetooth).
 *   - Impresora de Windows en crudo: windows-raw:Nombre (driver Epson, Generic / Text
 *     Only, POS-80...). Se usa el administrador de impresión de Windows sin compartirla.
 *   - Red: tcp://IP:9100.
 */

export interface LocalTicketTarget {
  /** Valor de PRINTER_INTERFACE. */
  interface: string;
  label: string;
  kind: "com" | "windows";
  detail: string | null;
  /** Parece impresora de tickets (térmica / ESC/POS); las demás se listan aparte. */
  thermal: boolean;
}

/** Drivers de tickets conocidos: Epson TM, "Receipt", POS, térmicas genéricas, Generic / Text Only. */
const THERMAL = /\bTM[-\s]|RECEIPT|\bPOS\b|POS-?\d|THERMAL|TERMIC|GENERIC\s*\/\s*TEXT|XPRINTER|BIXOLON|STAR\s|CITIZEN|SEWOO|RONGTA|\b80\s?MM\b|\b58\s?MM\b/i;

function runPowerShell(script: string, timeoutMs = 20000) {
  return new Promise<string>((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
      { windowsHide: true, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const detail = String(stderr ?? "")
            .split(/\r?\n/)
            .find((line) => line.trim() && !line.startsWith("En ") && !line.startsWith("At ") && !line.trim().startsWith("+"));
          reject(new Error(detail?.trim() || error.message));
          return;
        }
        resolve(String(stdout ?? "").trim());
      }
    );
  });
}

const LIST_SCRIPT = `
$ports = @()
$map = Get-ItemProperty 'HKLM:\\HARDWARE\\DEVICEMAP\\SERIALCOMM' -ErrorAction SilentlyContinue
if ($map) { foreach ($p in $map.PSObject.Properties) { if ($p.Name -notlike 'PS*') { $ports += [pscustomobject]@{ Port = [string]$p.Value; Device = [string]$p.Name } } } }
$pnp = @(Get-CimInstance Win32_PnPEntity -Filter "Name LIKE '%(COM%'" -ErrorAction SilentlyContinue | ForEach-Object { [string]$_.Name })
$printers = @(Get-CimInstance Win32_Printer | Select-Object Name,PortName,DriverName)
[pscustomobject]@{ ports = @($ports); pnp = $pnp; printers = $printers } | ConvertTo-Json -Depth 4 -Compress
`;

/** Puertos COM y colas de Windows que pueden recibir un ticket ESC/POS. */
export async function listLocalTicketTargets(): Promise<LocalTicketTarget[]> {
  if (process.platform !== "win32") return [];
  const raw = await runPowerShell(LIST_SCRIPT);
  const data = JSON.parse(raw || "{}") as {
    ports?: Array<{ Port: string; Device: string }>;
    pnp?: string[];
    printers?: Array<{ Name: string; PortName: string | null; DriverName: string | null }>;
  };

  const coms: LocalTicketTarget[] = (data.ports ?? [])
    .filter((port) => /^COM\d+$/i.test(port.Port))
    .sort((a, b) => Number(a.Port.slice(3)) - Number(b.Port.slice(3)))
    .map((port) => {
      const friendly = (data.pnp ?? []).find((name) => name.toUpperCase().includes(`(${port.Port.toUpperCase()})`));
      return {
        interface: `\\\\.\\${port.Port.toUpperCase()}`,
        label: port.Port.toUpperCase(),
        kind: "com" as const,
        detail: friendly ? friendly.replace(/\s*\(COM\d+\)\s*$/i, "") : "Puerto serial o virtual (p. ej. EPSON TM Virtual Port)",
        thermal: true
      };
    });

  // Impresoras virtuales (PDF, OneNote, fax) no imprimen tickets.
  const virtual = /PORTPROMPT|^NUL|^FILE|SHRFAX|ONENOTE/i;
  const queues: LocalTicketTarget[] = (data.printers ?? [])
    // El driver genérico de Microsoft (IPP) no acepta datos directos.
    .filter((printer) => printer.Name && !virtual.test(printer.PortName ?? "") && !/PDF|OneNote|XPS|Fax|IPP Class/i.test(printer.DriverName ?? ""))
    .sort((a, b) => a.Name.localeCompare(b.Name))
    .map((printer) => ({
      interface: `windows-raw:${printer.Name}`,
      label: printer.Name,
      kind: "windows" as const,
      detail: [printer.DriverName, printer.PortName].filter(Boolean).join(" · ") || null,
      thermal: THERMAL.test(`${printer.Name} ${printer.DriverName ?? ""}`)
    }));

  return [...coms, ...queues];
}

const RAW_SCRIPT = `
param([string]$Printer, [string]$File)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class FacturacionRawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DocInfo { public string pDocName; public string pOutputFile; public string pDataType; }
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool ClosePrinter(IntPtr handle);
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern int StartDocPrinter(IntPtr handle, int level, [In] DocInfo info);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndDocPrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool StartPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool WritePrinter(IntPtr handle, byte[] data, int length, out int written);
  public static void Send(string printer, byte[] data) {
    IntPtr handle;
    if (!OpenPrinter(printer, out handle, IntPtr.Zero)) throw new Exception("No se encontró la impresora '" + printer + "' en esta PC.");
    try {
      if (StartDocPrinter(handle, 1, new DocInfo { pDocName = "Ticket Facturacion", pDataType = "RAW" }) == 0)
        throw new Exception("El driver de esa impresora no acepta el formato térmico. Elige su puerto COM o el formato PDF.");
      try {
        StartPagePrinter(handle);
        int written;
        if (!WritePrinter(handle, data, data.Length, out written) || written != data.Length)
          throw new Exception("No se pudo enviar el ticket a la impresora. Revisa que esté encendida y conectada.");
        EndPagePrinter(handle);
      } finally { EndDocPrinter(handle); }
    } finally { ClosePrinter(handle); }
  }
}
'@
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
try { [FacturacionRawPrinter]::Send($Printer, [System.IO.File]::ReadAllBytes($File)) }
catch {
  # Solo el mensaje (sin el envoltorio de PowerShell), en UTF-8 para conservar los acentos.
  $e = $_.Exception
  while ($e.InnerException) { $e = $e.InnerException }
  [Console]::Error.WriteLine($e.Message)
  exit 1
}
`;

const RAW_SCRIPT_FILE = path.join(os.tmpdir(), "facturacion-ticket-crudo.ps1");

/** Manda bytes ESC/POS a una impresora de Windows en crudo (sin compartirla). */
export async function sendRawToWindowsPrinter(buffer: Buffer, printer: string) {
  // BOM: Windows PowerShell 5 lee UTF-8 sin BOM como ANSI.
  const content = `\uFEFF${RAW_SCRIPT.trim()}\r\n`;
  if (!fs.existsSync(RAW_SCRIPT_FILE) || fs.readFileSync(RAW_SCRIPT_FILE, "utf8") !== content) {
    fs.writeFileSync(RAW_SCRIPT_FILE, content, "utf8");
  }
  const data = path.join(os.tmpdir(), `ticket-${Date.now()}-${Math.random().toString(36).slice(2)}.bin`);
  fs.writeFileSync(data, buffer);
  try {
    await new Promise<void>((resolve, reject) => {
      execFile(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", RAW_SCRIPT_FILE, "-Printer", printer, "-File", data],
        { windowsHide: true, timeout: 30000, encoding: "utf8" },
        (error, _stdout, stderr) => {
          if (error) {
            const detail = String(stderr ?? "")
              .split(/\r?\n/)
              .find((line) => line.trim());
            reject(new Error(detail?.trim() || "No se pudo enviar el ticket a la impresora."));
            return;
          }
          resolve();
        }
      );
    });
  } finally {
    fs.promises.unlink(data).catch(() => undefined);
  }
}

/** ¿La cola existe en Windows? (para el estado en pantalla). */
export async function windowsPrinterStatus(printer: string): Promise<{ connected: boolean; error?: string }> {
  try {
    const raw = await runPowerShell(
      `$name = '${printer.replace(/'/g, "''")}'; $p = Get-CimInstance Win32_Printer | Where-Object { $_.Name -eq $name } | Select-Object -First 1; if ($p) { [pscustomobject]@{ found = $true; offline = [bool]($p.WorkOffline -or $p.PrinterStatus -eq 7) } | ConvertTo-Json -Compress } else { '{"found":false}' }`,
      10000
    );
    const result = JSON.parse(raw || "{}") as { found?: boolean; offline?: boolean };
    if (!result.found) return { connected: false, error: "La impresora ya no está instalada en esta PC." };
    if (result.offline) return { connected: false, error: "Windows la marca como desconectada." };
    return { connected: true };
  } catch (error) {
    return { connected: false, error: (error as Error).message };
  }
}
