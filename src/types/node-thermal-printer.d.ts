declare module "node-thermal-printer" {
  export const PrinterTypes: {
    EPSON: "epson";
    STAR: "star";
    TANCA: "tanca";
    DARUMA: "daruma";
    BROTHER: "brother";
    CUSTOM: "custom";
  };

  export const CharacterSet: Record<string, string>;
  export const BreakLine: Record<string, string>;

  export interface PrinterConfig {
    type: string;
    interface: string;
    width?: number;
    characterSet?: string;
    removeSpecialCharacters?: boolean;
    lineCharacter?: string;
    breakLine?: string;
    options?: Record<string, unknown>;
    driver?: unknown;
  }

  export class printer {
    constructor(config: PrinterConfig);
    isPrinterConnected(): Promise<boolean>;
    execute(): Promise<unknown>;
    getBuffer(): Buffer;
    printImage(path: string): Promise<unknown>;
    printImageBuffer(buffer: Buffer): Promise<unknown>;
    alignCenter(): void;
    alignLeft(): void;
    alignRight(): void;
    bold(enabled: boolean): void;
    invert(enabled: boolean): void;
    underline(enabled: boolean): void;
    setTextSize(width: number, height: number): void;
    setTextNormal(): void;
    println(text: string): void;
    print(text: string): void;
    newLine(): void;
    drawLine(): void;
    leftRight(left: string, right: string): void;
    table(data: string[]): void;
    tableCustom(data: Array<{ text: string; align?: string; width?: number; cols?: number; bold?: boolean }>): void;
    cut(options?: { verticalTabAmount?: number }): void;
    /** Agrega bytes ESC/POS tal cual al ticket. */
    add(buffer: Buffer): void;
    clear(): void;
  }

  export const ThermalPrinter: typeof printer;
}
