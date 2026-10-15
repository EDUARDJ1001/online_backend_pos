import { isDbConfigured, pingDatabase } from "./config/db";
import { env } from "./config/env";
import { app } from "./app";
import { checkSchema, recoverSchemaStatus, schemaBlockMessage, schemaStatus } from "./modules/system/migrations.service";
import { updatesService } from "./modules/system/updates.service";

/** Cada cuánto se revisa si otra caja actualizó la base (programa desactualizado). */
const SCHEMA_CHECK_MS = 60_000;

async function start() {
  if (!isDbConfigured()) {
    // Sin base configurada: arranca igual y las pantallas piden conectarla.
    console.warn("[base de datos] No hay base de datos configurada. Ábrelo y completa la pantalla \"Conectar base de datos\".");
    listen();
    setInterval(() => {
      if (isDbConfigured() && !recoverSchemaStatus()) {
        void checkSchema(false).catch(() => undefined);
      }
    }, SCHEMA_CHECK_MS).unref();
    return;
  }

  // Sin base de datos el programa arranca igual: las pantallas muestran el aviso
  // de "sin conexión" y se recupera solo cuando la base vuelve a responder.
  if (!(await pingDatabase(10_000))) {
    console.warn("[base de datos] No hay conexión con la base de datos. El sistema lo seguirá intentando.");
  }

  // Versión del programa contra la base; con DB_AUTO_MIGRATE aplica las pendientes.
  const status = await checkSchema().catch((error: Error) => {
    console.error("[migraciones]", error.message);
    return schemaStatus();
  });
  const blocked = schemaBlockMessage();
  if (blocked) {
    console.warn(`[migraciones] ${blocked}`, status.unknown.length ? status.unknown : status.pending);
  }

  setInterval(() => {
    // Tras una caída de la base, la revisión completa (con migraciones si están habilitadas).
    if (!recoverSchemaStatus()) {
      void checkSchema(false).catch(() => undefined);
    }
  }, SCHEMA_CHECK_MS).unref();

  listen();
}

function listen() {
  app.listen(env.PORT, env.HOST, () => {
    console.log(`Backend listo en http://${env.HOST}:${env.PORT}${env.FRONTEND_DIST ? " (con pantallas)" : ""}`);
    updatesService.start();
  });
}

start().catch((error) => {
  console.error("No se pudo iniciar el backend:", error);
  process.exit(1);
});
