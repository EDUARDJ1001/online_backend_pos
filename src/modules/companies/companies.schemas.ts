import { z } from "zod";

export const selectCompanySchema = z.object({
  companyId: z.coerce.number().int().positive()
});

/** El logo se guarda como data URI; se acota para no llenar la columna ni el JSON. */
const LOGO_MAX_BYTES = 800 * 1024;
const FAVICON_MAX_BYTES = 300 * 1024;
const FOOTER_BRAND_MAX_BYTES = 300 * 1024;
const FOOTER_BRANDS_MAX = 8;

const DATA_IMAGE = /^data:image\/(png|jpe?g|webp|gif|svg\+xml);base64,[A-Za-z0-9+/=]+$/;

/** Tamaño real del binario a partir de la cadena base64. */
function base64Bytes(dataUri: string) {
  const base64 = dataUri.slice(dataUri.indexOf(",") + 1);
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/** Acepta URL http(s), data URI de imagen, o cadena vacía (para limpiar). */
function imageField(maxBytes: number, label: string) {
  return z
    .string()
    .trim()
    .max(maxBytes * 2, `${label} es demasiado grande.`)
    .refine((value) => value === "" || /^https?:\/\//i.test(value) || DATA_IMAGE.test(value), {
      message: `${label} debe ser una imagen (PNG, JPG, WEBP, GIF, SVG) o una URL válida.`
    })
    .refine((value) => !value.startsWith("data:") || base64Bytes(value) <= maxBytes, {
      message: `${label} supera el tamaño máximo (${Math.round(maxBytes / 1024)} KB).`
    })
    .optional();
}

const rtnSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/\D/g, ""))
  .refine((value) => /^\d{14}$/.test(value), {
    message: "El RTN debe tener 14 dígitos."
  });

/** Nueva empresa (solo SUPERADMIN): lo mínimo para empezar; el resto se completa en "Empresa". */
export const createCompanySchema = z.object({
  commercialName: z.string().trim().min(1, "El nombre comercial es obligatorio.").max(150),
  legalName: z.string().trim().min(1, "La razón social es obligatoria.").max(180),
  rtn: rtnSchema,
  email: z.string().trim().max(150).email("Correo inválido.").nullish().or(z.literal("")),
  phone: z.string().trim().max(40).nullish().or(z.literal("")),
  address: z.string().trim().max(255).nullish().or(z.literal("")),
  primaryColor: z
    .string()
    .trim()
    .refine((value) => value === "" || /^#[0-9a-f]{6}$/i.test(value), "Color no válido.")
    .optional()
});

export const updateCompanySchema = z.object({
  commercialName: z.string().trim().min(1, "El nombre comercial es obligatorio.").max(150),
  legalName: z.string().trim().min(1, "La razón social es obligatoria.").max(180),
  rtn: rtnSchema,
  email: z.string().trim().max(150).email("Correo inválido.").nullish().or(z.literal("")),
  phone: z.string().trim().max(40).nullish().or(z.literal("")),
  address: z.string().trim().max(255).nullish().or(z.literal("")),
  logo: imageField(LOGO_MAX_BYTES, "El logo"),
  favicon: imageField(FAVICON_MAX_BYTES, "El favicon"),
  documentColor: z
    .string()
    .trim()
    .refine((value) => value === "" || /^#[0-9a-f]{6}$/i.test(value), "El color de los documentos no es válido.")
    .optional(),
  footerBrands: z
    .array(
      z
        .string()
        // Solo PNG/JPG: son los formatos que se pueden dibujar en el PDF.
        .regex(/^data:image\/(png|jpe?g);base64,[A-Za-z0-9+/=]+$/, "Cada marca debe ser una imagen PNG o JPG.")
        .refine((value) => base64Bytes(value) <= FOOTER_BRAND_MAX_BYTES, {
          message: `Cada imagen de marca debe pesar como máximo ${Math.round(FOOTER_BRAND_MAX_BYTES / 1024)} KB.`
        })
    )
    .max(FOOTER_BRANDS_MAX, `Se permiten como máximo ${FOOTER_BRANDS_MAX} marcas.`)
    .optional(),
  themeMode: z.enum(["light", "dark"]).default("light")
});
