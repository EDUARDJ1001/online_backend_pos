/**
 * Opciones de los comandos (npm run ... -- --opcion). En PowerShell, npm se queda con el
 * "--": las opciones no llegan al script sino como variables npm_config_* ("true"), y los
 * valores llegan sueltos. Estas funciones aceptan las dos formas, así los comandos
 * funcionan igual en PowerShell, CMD y Git Bash.
 */

const args = process.argv.slice(2);
const envName = (name: string) => `npm_config_${name.replace(/-/g, "_")}`;

/** ¿Se indicó la opción --nombre? */
export function hasFlag(name: string) {
  return args.includes(`--${name}`) || process.env[envName(name)] === "true";
}

/** Valor de --nombre valor (o --nombre=valor). */
export function flagValue(name: string) {
  const index = args.indexOf(`--${name}`);
  if (index >= 0 && args[index + 1] && !args[index + 1]!.startsWith("--")) return args[index + 1];
  const inline = args.find((arg) => arg.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const fromEnv = process.env[envName(name)];
  return fromEnv && fromEnv !== "true" ? fromEnv : undefined;
}

/** Valores sueltos (lo que en PowerShell queda de "--nombre valor"). */
export function positionalArgs() {
  return args.filter((arg, index) => !arg.startsWith("--") && !(index > 0 && args[index - 1]!.startsWith("--") && !args[index - 1]!.includes("=")));
}

/** --nombre valor, o el primer valor suelto (PowerShell). */
export function valueOrPositional(name: string) {
  return flagValue(name) ?? (hasFlag(name) || positionalArgs().length ? positionalArgs()[0] : undefined);
}
