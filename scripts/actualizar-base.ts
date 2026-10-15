/**
 * Actualiza la base configurada (.env, o FACTURACION_ENV_FILE) con las migraciones
 * pendientes, MySQL/MariaDB o SQL Server, local o en la nube.
 *
 * Solo cambia la estructura: no modifica ni borra datos que ya existen (solo llena
 * columnas y tablas nuevas). Si alguna pendiente no cumple, no aplica NINGUNA.
 * Haz un respaldo de la base antes de aplicar.
 *
 * Uso: npm run db:actualizar              revisa y muestra qué haría (no cambia nada)
 *      npm run db:actualizar -- --aplicar aplica si es seguro
 */
import { currentDbSettings, dbPool } from "../src/config/db";
import { reviewPending } from "../src/modules/system/migration-safety";
import { checkSchema, migrationsDir } from "../src/modules/system/migrations.service";
import { hasFlag } from "./lib/cli-args";

async function main() {
  const settings = currentDbSettings();
  console.log(`Base: ${settings.database} en ${settings.host}:${settings.port} (${settings.client === "mssql" ? "SQL Server" : "MySQL / MariaDB"})\n`);

  const status = await checkSchema(false);
  if (status.empty) {
    console.log("La base no tiene el sistema instalado. Para prepararla, ábrela desde el programa (pantalla Conectar base de datos).");
    return;
  }
  if (status.unknown.length > 0) {
    console.log(`La base es MÁS NUEVA que este programa (${status.unknown.join(", ")}). Actualiza el programa, no la base.`);
    process.exitCode = 1;
    return;
  }
  if (status.pending.length === 0) {
    console.log("La base está al día. No hay nada que aplicar.");
    return;
  }

  const reviews = await reviewPending(dbPool, settings.client, migrationsDir(settings.client)!, status.pending);
  console.log(`Actualizaciones pendientes: ${reviews.length}`);
  for (const review of reviews) {
    console.log(`\n  ${review.problems.length ? "NO SE PUEDE" : "OK"}  ${review.file}`);
    console.log(`      ${review.title}`);
    if (review.dataChange) console.log(`      Completa: ${review.dataChange}`);
    for (const problem of review.problems) console.log(`      Motivo: ${problem}`);
  }

  const blocked = reviews.filter((review) => review.problems.length > 0);
  if (blocked.length > 0) {
    console.log("\nNo se aplica ninguna: hay actualizaciones que cambiarían o perderían datos. Revisa los motivos de arriba.");
    process.exitCode = 1;
    return;
  }
  if (!hasFlag("aplicar")) {
    console.log("\nTodo se puede aplicar: solo cambia la estructura. Haz un respaldo y ejecuta con --aplicar:\n  npm run db:actualizar -- --aplicar");
    return;
  }

  const after = await checkSchema(true);
  const applied = status.pending.filter((file) => !after.pending.includes(file));
  console.log(`\nAplicadas: ${applied.length ? applied.join(", ") : "ninguna"}`);
  if (after.blocked.length > 0) {
    console.log("Detenidas por seguridad:", after.blocked.map((review) => `${review.file}: ${review.problems.join("; ")}`).join(" | "));
    process.exitCode = 1;
  } else if (after.pending.length === 0) {
    console.log("La base quedó al día.");
  }
}

main()
  .catch((error: Error) => {
    console.error(`\nNo se pudo actualizar la base: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => dbPool.end().catch(() => undefined));
