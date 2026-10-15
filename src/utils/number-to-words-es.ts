const UNIDADES = [
  "cero",
  "uno",
  "dos",
  "tres",
  "cuatro",
  "cinco",
  "seis",
  "siete",
  "ocho",
  "nueve"
];

const DIEZ_DIECINUEVE = [
  "diez",
  "once",
  "doce",
  "trece",
  "catorce",
  "quince",
  "dieciseis",
  "diecisiete",
  "dieciocho",
  "diecinueve"
];

const DECENAS = [
  "",
  "",
  "veinte",
  "treinta",
  "cuarenta",
  "cincuenta",
  "sesenta",
  "setenta",
  "ochenta",
  "noventa"
];

const CENTENAS = [
  "",
  "ciento",
  "doscientos",
  "trescientos",
  "cuatrocientos",
  "quinientos",
  "seiscientos",
  "setecientos",
  "ochocientos",
  "novecientos"
];

function convertirDecenas(numero: number): string {
  if (numero < 10) {
    return UNIDADES[numero] ?? "";
  }

  if (numero < 20) {
    return DIEZ_DIECINUEVE[numero - 10] ?? "";
  }

  if (numero < 30) {
    if (numero === 20) {
      return "veinte";
    }

    return `veinti${convertirDecenas(numero - 20)}`;
  }

  const decena = Math.floor(numero / 10);
  const unidad = numero % 10;

  if (unidad === 0) {
    return DECENAS[decena] ?? "";
  }

  return `${DECENAS[decena]} y ${UNIDADES[unidad]}`;
}

function convertirCentenas(numero: number): string {
  if (numero < 100) {
    return convertirDecenas(numero);
  }

  if (numero === 100) {
    return "cien";
  }

  const centena = Math.floor(numero / 100);
  const resto = numero % 100;
  const restoTexto = resto > 0 ? ` ${convertirDecenas(resto)}` : "";

  return `${CENTENAS[centena]}${restoTexto}`.trim();
}

function convertirMiles(numero: number): string {
  if (numero < 1000) {
    return convertirCentenas(numero);
  }

  const miles = Math.floor(numero / 1000);
  const resto = numero % 1000;
  const milesTexto = miles === 1 ? "mil" : `${convertirCentenas(miles)} mil`;
  const restoTexto = resto > 0 ? ` ${convertirCentenas(resto)}` : "";

  return `${milesTexto}${restoTexto}`.trim();
}

function convertirMillones(numero: number): string {
  if (numero < 1000000) {
    return convertirMiles(numero);
  }

  const millones = Math.floor(numero / 1000000);
  const resto = numero % 1000000;
  const millonesTexto = millones === 1 ? "un millon" : `${convertirMiles(millones)} millones`;
  const restoTexto = resto > 0 ? ` ${convertirMiles(resto)}` : "";

  return `${millonesTexto}${restoTexto}`.trim();
}

export function amountToSpanishWords(value: number) {
  const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
  const integerPart = Math.floor(safeValue);
  const decimals = Math.round((safeValue - integerPart) * 100);
  const integerWords = convertirMillones(integerPart);

  return `${integerWords} lempiras con ${decimals.toString().padStart(2, "0")}/100`.toUpperCase();
}
