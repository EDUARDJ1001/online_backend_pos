/**
 * Prueba rápida de la capa de datos contra la base configurada (DB_CLIENT).
 * Todo lo que escribe se hace dentro de transacciones que se revierten.
 */
import { dbClient, dbPool, withTransaction } from "../src/config/db";
import { companiesService } from "../src/modules/companies/companies.service";
import { invoicesService } from "../src/modules/invoices/invoices.service";
import { productsService } from "../src/modules/products/products.service";
import { clientsService } from "../src/modules/clients/clients.service";
import { receivablesService } from "../src/modules/receivables/receivables.service";
import { payablesService } from "../src/modules/payables/payables.service";
import { cajaService, NO_CASH_CONTEXT } from "../src/modules/caja/caja.service";
import { reportsService } from "../src/modules/reports/reports.service";
import { inventoryService } from "../src/modules/inventory/inventory.service";
import { usersService } from "../src/modules/users/users.service";
import { nextDocumentNumber } from "../src/utils/document-counter";

const ROLLBACK = new Error("rollback");

async function step(name: string, fn: () => Promise<unknown>) {
  try {
    const value = await fn();
    const text = JSON.stringify(value) ?? "";
    console.log(`OK   ${name}: ${text.length > 110 ? `${text.slice(0, 110)}...` : text}`);
  } catch (error) {
    console.log(`FAIL ${name}: ${(error as Error).message}`);
  }
}

async function main() {
  console.log(`Motor: ${dbClient()}`);
  const companyId = Number(process.argv[2] ?? 1);
  await step("empresas del usuario 1", () => companiesService.getUserCompanies(1).then((r) => r.map((c) => c.code)));
  await step("facturas (lista)", () => invoicesService.list(companyId, { page: 1, pageSize: 5 } as never).then((r: { items?: unknown[] }) => r.items?.length));
  await step("productos (lista)", () => productsService.list(companyId, { page: 1, pageSize: 5, status: "all", type: "all" } as never).then((r: { items?: unknown[] }) => r.items?.length));
  await step("próximo código producto", () => productsService.getNextCode(companyId));
  await step("clientes (búsqueda)", () => clientsService.list(companyId, { search: "a", status: "all", page: 1, pageSize: 5 }).then((r: { items?: unknown[] }) => r.items?.length));
  await step("cuentas por cobrar (vencidas)", () => receivablesService.list(companyId, { page: 1, pageSize: 5, overdue: true } as never).then((r: { items?: unknown[] }) => r.items?.length));
  await step("cuentas por pagar", () => payablesService.list(companyId, { page: 1, pageSize: 5 } as never).then((r: { items?: unknown[] }) => r.items?.length));
  await step("caja (resumen)", () => cajaService.overview(companyId, NO_CASH_CONTEXT).then((r: unknown) => Object.keys(r as object).length));
  await step("inventario movimientos", () => inventoryService.listMovements(companyId, { page: 1, pageSize: 5, movementType: "all", sourceType: "all" } as never).then((r: { items?: unknown[] }) => r.items?.length));
  await step("usuarios", () => usersService.list({ id: 1, role: "SUPERADMIN" }, companyId, { status: "all", page: 1, pageSize: 5 }).then((r: { items?: unknown[] }) => r.items?.length));
  await step("reporte ventas", () => reportsService.salesReport(companyId, { dateFrom: "2026-01-01", dateTo: "2026-12-31", status: "all" } as never).then((r: unknown) => Object.keys(r as object)));
  await step("recibo REC (revertido)", () =>
    withTransaction(async (connection) => {
      const number = await nextDocumentNumber(connection, companyId, "REC-", { table: "invoice_payments", column: "receipt_number" });
      console.log(`     -> ${number}`);
      throw ROLLBACK;
    }).catch((error) => (error === ROLLBACK ? "revertido" : Promise.reject(error)))
  );
  await dbPool.end();
}

main().catch(async (error) => {
  console.error(error);
  await dbPool.end().catch(() => undefined);
  process.exit(1);
});
