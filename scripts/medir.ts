/**
 * Mide las operaciones frecuentes: viajes a la base (consultas, inicio y fin de
 * transacción) y tiempo. Crea su propia empresa de prueba.
 * ESCRIBE DATOS: usar solo en una base de prueba (lo usa `npm run verificar -- --medir`).
 *
 * Uso: npm run db:medir --workspace backend -- --confirm [--json]
 */
import { currentDbSettings, dbPool, observeQueries } from "../src/config/db";
import { NO_CASH_CONTEXT, cajaService, type CashContext } from "../src/modules/caja/caja.service";
import { companiesService } from "../src/modules/companies/companies.service";
import { inventoryService } from "../src/modules/inventory/inventory.service";
import { invoicesService } from "../src/modules/invoices/invoices.service";
import { productsService } from "../src/modules/products/products.service";
import { proformasService } from "../src/modules/proformas/proformas.service";
import { quotesService } from "../src/modules/quotes/quotes.service";
import { reportsService } from "../src/modules/reports/reports.service";
import { settingsService } from "../src/modules/settings/settings.service";

const RUNS = 3;

export interface Measure {
  operation: string;
  queries: number;
  ms: number;
}

function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Tegucigalpa" }).format(new Date());
}

/** Ejecuta `fn` RUNS veces: viajes de la última vuelta y la mediana del tiempo. */
async function measure(operation: string, fn: () => Promise<unknown>): Promise<Measure> {
  const times: number[] = [];
  let queries = 0;
  for (let run = 0; run < RUNS; run += 1) {
    let count = 0;
    observeQueries(() => {
      count += 1;
    });
    const started = performance.now();
    try {
      await fn();
    } finally {
      observeQueries(null);
    }
    times.push(performance.now() - started);
    queries = count;
  }
  times.sort((a, b) => a - b);
  return { operation, queries, ms: Math.round(times[Math.floor(times.length / 2)]!) };
}

async function main() {
  if (!process.argv.includes("--confirm")) {
    throw new Error("Esta medición escribe datos. Úsala solo en una base de prueba y ejecútala con --confirm.");
  }
  const settings = currentDbSettings();
  const date = today();
  const context: CashContext = { ...NO_CASH_CONTEXT, canManage: true };

  // ---- Preparación (no se mide)
  const [users] = await dbPool.query<Array<{ id: number }>>("SELECT id FROM users WHERE username = 'superadmin'");
  const userId = users[0]!.id;
  const company = await companiesService.createCompany(userId, {
    commercialName: `Medición ${Date.now() % 100000}`,
    legalName: "Medición S. de R.L.",
    rtn: String(Date.now() + 7).padStart(14, "0").slice(-14)
  });
  const companyId = company.id;
  await settingsService.createBillingSeries(companyId, {
    documentType: "FACTURA", establishmentCode: "000", pointCode: "001", documentCode: "01",
    cai: `MEDIR-${companyId}`, issueDeadline: "2027-12-31", rangeStart: 1, rangeEnd: 5000
  } as never);
  const [warehouses] = await dbPool.query<Array<{ id: number }>>("SELECT id FROM warehouses WHERE company_id = ?", [companyId]);
  const warehouseId = warehouses[0]!.id;
  const [clients] = await dbPool.query<Array<{ id: number }>>("SELECT id FROM clients WHERE company_id = ? AND is_generic = 1", [companyId]);
  const customerId = clients[0]!.id;
  const [registers] = await dbPool.query<Array<{ id: number }>>("SELECT id FROM cash_registers WHERE company_id = ?", [companyId]);

  const productIds: number[] = [];
  for (let index = 1; index <= 10; index += 1) {
    const created = await productsService.create(companyId, userId, {
      code: "TMP", name: `Producto ${index}`, type: "PRODUCTO", unitMeasure: "UND", salePrice: 100 + index, costPrice: 50,
      taxable: true, taxRate: 15, controlsStock: true, minStock: 0, isActive: true, codes: []
    } as never);
    productIds.push(created.id);
  }
  await inventoryService.createEntry(companyId, userId, {
    warehouseId, entryDate: date, supplierName: "Inicial", documentNumber: "INI",
    items: productIds.map((productId) => ({ productId, quantity: 1000, unitCost: 50 }))
  });
  const session = await cajaService.open(companyId, userId, context, { cashRegisterId: registers[0]!.id, openingAmount: 500 });

  const lines = (count: number) => productIds.slice(0, count).map((productId) => ({ productId, quantity: 1, unitPrice: 150, lineDiscount: 0 }));
  const sale = (count: number) => ({ customerId, warehouseId, invoiceDate: date, saleType: "CONTADO", tenderMethod: "EFECTIVO", items: lines(count) });

  // ---- Mediciones
  const results: Measure[] = [];
  let lastInvoiceId = 0;
  results.push(await measure("Factura de 1 línea", async () => {
    lastInvoiceId = ((await invoicesService.create(companyId, userId, "SUPERADMIN", sale(1) as never, context)) as { id: number }).id;
  }));
  results.push(await measure("Factura de 10 líneas", () => invoicesService.create(companyId, userId, "SUPERADMIN", sale(10) as never, context)));
  results.push(await measure("Proforma de 10 líneas", () => proformasService.create(companyId, userId, { customerId, warehouseId, proformaDate: date, items: lines(10) } as never)));
  results.push(await measure("Cotización de 10 líneas", () => quotesService.create(companyId, userId, { customerId, warehouseId, quoteDate: date, items: lines(10) } as never)));
  results.push(await measure("Entrada de inventario de 10 líneas", () =>
    inventoryService.createEntry(companyId, userId, { warehouseId, entryDate: date, supplierName: "Proveedor", documentNumber: "F-1", items: productIds.map((productId) => ({ productId, quantity: 5, unitCost: 55 })) })
  ));
  results.push(await measure("Detalle de factura", () => invoicesService.getInvoiceDetail(companyId, lastInvoiceId)));
  results.push(await measure("Lista de facturas", () => invoicesService.list(companyId, { page: 1, pageSize: 10 })));
  results.push(await measure("Lista de productos", () => productsService.list(companyId, { page: 1, pageSize: 50, status: "active", type: "all" } as never)));
  results.push(await measure("Existencias", () => inventoryService.listStocks(companyId, { page: 1, pageSize: 50 } as never)));
  results.push(await measure("Caja (resumen)", () => cajaService.overview(companyId, context)));
  results.push(await measure("Reporte de ventas", () => reportsService.salesReport(companyId, { dateFrom: date, dateTo: date, status: "EMITIDA", saleType: "all" } as never)));
  // El cierre solo se puede hacer una vez: se mide una sola vuelta.
  {
    let count = 0;
    observeQueries(() => {
      count += 1;
    });
    const started = performance.now();
    await cajaService.close(companyId, userId, context, { cashSessionId: session.session.id, countedAmount: 1000 });
    observeQueries(null);
    results.push({ operation: "Cierre de caja", queries: count, ms: Math.round(performance.now() - started) });
  }

  if (process.argv.includes("--json")) {
    console.log(`MEDICION ${JSON.stringify({ client: settings.client, database: settings.database, results })}`);
  } else {
    console.log(`Motor: ${settings.client} · base ${settings.database}\n`);
    for (const row of results) {
      console.log(`${row.operation.padEnd(36)} ${String(row.queries).padStart(4)} viajes ${String(row.ms).padStart(7)} ms`);
    }
  }
}

main()
  .then(() => dbPool.end())
  .catch(async (error) => {
    console.error(`FAIL medición: ${(error as Error).message}`);
    await dbPool.end().catch(() => undefined);
    process.exit(1);
  });
