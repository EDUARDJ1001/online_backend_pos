/**
 * Prueba de flujo completo contra la base configurada (DB_CLIENT / DB_*).
 * ESCRIBE DATOS: usar solo en una base de prueba (p. ej. recién instalada).
 *
 * Empresa nueva -> CAI -> producto con existencia inicial -> caja -> facturas
 * (contado, crédito, simultáneas) -> cobro -> entrada -> ajuste -> proforma y
 * cotización convertidas -> proveedor y pago -> listas, kardex, reportes -> cierre.
 *
 * Uso: npm run db:flow-test --workspace backend -- --confirm
 *      --instalar: la base debe estar vacía; se prepara como lo hace el programa
 *      (instalación completa + migraciones pendientes). Lo usa `npm run verificar`.
 */
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

import { currentDbSettings, dbPool } from "../src/config/db";
import { machineCode, signMultiLicense, signRevocation } from "../src/license/license";
import { licenseStatus } from "../src/license/license-runtime";
import { banksService } from "../src/modules/banks/banks.service";
import { NO_CASH_CONTEXT, cajaService, type CashContext } from "../src/modules/caja/caja.service";
import { companiesService } from "../src/modules/companies/companies.service";
import { inventoryService } from "../src/modules/inventory/inventory.service";
import { writeInvoicePdf, writeInvoiceTicketPdf } from "../src/modules/invoices/invoice-pdf";
import { renderInvoiceHtml } from "../src/modules/invoices/invoice-renderer";
import { invoicesService } from "../src/modules/invoices/invoices.service";
import { payablesService } from "../src/modules/payables/payables.service";
import { productsController } from "../src/modules/products/products.controller";
import { productsService } from "../src/modules/products/products.service";
import { proformasService } from "../src/modules/proformas/proformas.service";
import { quotesService } from "../src/modules/quotes/quotes.service";
import { receivablesService } from "../src/modules/receivables/receivables.service";
import { reportsService } from "../src/modules/reports/reports.service";
import { settingsService } from "../src/modules/settings/settings.service";
import { suppliersService } from "../src/modules/suppliers/suppliers.service";
import { checkSchema } from "../src/modules/system/migrations.service";
import { clientsService } from "../src/modules/clients/clients.service";
import { usersService } from "../src/modules/users/users.service";
import { warehousesService } from "../src/modules/warehouses/warehouses.service";

let failures = 0;

async function step<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    const value = await fn();
    const text = JSON.stringify(value) ?? "";
    console.log(`OK   ${name}${text && text !== "{}" ? `: ${text.length > 120 ? `${text.slice(0, 120)}...` : text}` : ""}`);
    return value;
  } catch (error) {
    failures += 1;
    console.log(`FAIL ${name}: ${(error as Error).message}`);
    return null;
  }
}

function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Tegucigalpa" }).format(new Date());
}

async function main() {
  if (!process.argv.includes("--confirm")) {
    throw new Error("Esta prueba escribe datos. Úsala solo en una base de prueba y ejecútala con --confirm.");
  }
  const settings = currentDbSettings();
  console.log(`Motor: ${settings.client} · base ${settings.database}\n`);

  if (process.argv.includes("--instalar")) {
    const ready = await step("instalar base nueva y migraciones", async () => {
      const status = await checkSchema(true);
      if (status.empty || status.pending.length || status.unknown.length) {
        throw new Error(`vacía ${status.empty}, pendientes ${status.pending.join(", ") || "0"}, desconocidas ${status.unknown.join(", ") || "0"}`);
      }
      return "al día";
    });
    if (!ready) return;
  }

  const [users] = await dbPool.query<Array<{ id: number }>>("SELECT id FROM users WHERE username = 'superadmin'");
  const userId = users[0]!.id;
  const context: CashContext = { ...NO_CASH_CONTEXT, canManage: true };
  const date = today();

  const company = await step("crear empresa", () =>
    companiesService.createCompany(userId, { commercialName: `Prueba ${Date.now() % 100000}`, legalName: "Prueba S. de R.L.", rtn: String(Date.now()).padStart(14, "0").slice(-14) })
  );
  if (!company) return;
  const companyId = company.id;

  await step("registrar CAI", () =>
    settingsService.createBillingSeries(companyId, {
      documentType: "FACTURA",
      establishmentCode: "000",
      pointCode: "001",
      documentCode: "01",
      // Formato real (37 caracteres): el PDF debe mostrarlo completo sin encimarse.
      cai: `410C90-31E6A5-2E66E0-63BE03-${String(companyId).padStart(6, "0")}-E9`,
      issueDeadline: "2027-12-31",
      rangeStart: 1,
      rangeEnd: 500
    } as never).then(() => "ok")
  );

  const [warehouses] = await dbPool.query<Array<{ id: number }>>("SELECT id FROM warehouses WHERE company_id = ?", [companyId]);
  const warehouseId = warehouses[0]!.id;
  const [clients] = await dbPool.query<Array<{ id: number }>>("SELECT id FROM clients WHERE company_id = ? AND is_generic = 1", [companyId]);
  const clientId = clients[0]!.id;
  const [registers] = await dbPool.query<Array<{ id: number }>>("SELECT id FROM cash_registers WHERE company_id = ?", [companyId]);
  const registerId = registers[0]!.id;

  await step("Consumidor final es el cliente 1", async () => {
    const generic = await clientsService.findOrFail(companyId, clientId);
    if (String(generic.code) !== "1") throw new Error(`código ${generic.code}`);
    return generic.code;
  });
  await step("clientes nuevos siguen 2 y 3", async () => {
    const a = await clientsService.create(companyId, userId, { name: "Cliente Dos" } as never);
    const b = await clientsService.create(companyId, userId, { name: "Cliente Tres" } as never);
    if (String(a.code) !== "2" || String(b.code) !== "3") throw new Error(`códigos ${a.code}, ${b.code}`);
    return [a.code, b.code];
  });

  const product = await step("crear producto con existencia inicial", async () => {
    let payload: { item?: { id: number; stockQuantity: number; code: string } } = {};
    const req = {
      activeCompany: { id: companyId },
      auth: { sub: userId, role: "SUPERADMIN" },
      body: {
        code: "TMP", name: "Cámara IP Ñandú", type: "PRODUCTO", unitMeasure: "UND", salePrice: 1500, costPrice: 900,
        taxable: true, taxRate: 15, controlsStock: true, minStock: 2, isActive: true, codes: [{ code: "7501234567890", codeType: "BARRA" }],
        initialStock: 50, initialWarehouseId: warehouseId
      },
      headers: {}, ip: "127.0.0.1", get: () => ""
    } as never;
    const res = { status: () => res, json: (value: never) => (payload = value) } as never;
    await productsController.create(req, res);
    return { id: payload.item!.id, code: payload.item!.code, stock: payload.item!.stockQuantity };
  });
  const service = await step("crear servicio", () =>
    productsService.create(companyId, userId, { code: "TMP", name: "Instalación", type: "SERVICIO", unitMeasure: "HORA", salePrice: 500, costPrice: 0, taxable: true, taxRate: 15, controlsStock: false, minStock: 0, isActive: true, codes: [] } as never).then((p) => ({ id: p.id, code: p.code }))
  );
  if (!product || !service) return;

  await step("rechaza un servicio por unidades y un producto por horas", async () => {
    const base = { code: "TMP", salePrice: 10, costPrice: 0, taxable: true, taxRate: 15, minStock: 0, isActive: true, codes: [] };
    const rejected = async (payload: Record<string, unknown>) =>
      productsService.create(companyId, userId, { ...base, ...payload } as never).then(
        () => false,
        (error: Error) => /no se vende|se vende por servicio/.test(error.message)
      );
    const service = await rejected({ name: "Servicio en libras", type: "SERVICIO", unitMeasure: "LB", controlsStock: false });
    const product = await rejected({ name: "Producto por hora", type: "PRODUCTO", unitMeasure: "HORA", controlsStock: true });
    if (!service || !product) throw new Error("se aceptó una unidad que no corresponde al tipo");
    return "ok";
  });

  await step("bloqueo: cambiar unidad con kardex", async () => {
    const current = await productsService.findOrFail(companyId, product.id);
    try {
      await productsService.update(companyId, product.id, { ...current, codes: current.codes, unitMeasure: "KG", taxable: true, controlsStock: true, isActive: true } as never);
      throw new Error("se aceptó el cambio (no debía)");
    } catch (error) {
      if ((error as Error).message.includes("no debía")) throw error;
      return (error as Error).message.slice(0, 60);
    }
  });
  await step("buscar por código de barras", () => productsService.list(companyId, { search: "7501234567890", page: 1, pageSize: 5, status: "all", type: "all" } as never).then((r: { items: unknown[] }) => r.items.length));
  await step("buscar sin tilde (camara)", () => productsService.list(companyId, { search: "camara", page: 1, pageSize: 5, status: "all", type: "all" } as never).then((r: { items: unknown[] }) => r.items.length));

  const session = await step("abrir caja", () => cajaService.open(companyId, userId, context, { cashRegisterId: registerId, openingAmount: 500 }).then((detail) => ({ id: detail.session.id })));
  await step("rechaza segunda apertura", async () => {
    try {
      await cajaService.open(companyId, userId, context, { cashRegisterId: registerId, openingAmount: 1 });
      throw new Error("se abrió dos veces (no debía)");
    } catch (error) {
      if ((error as Error).message.includes("no debía")) throw error;
      return (error as Error).message;
    }
  });

  const invoice = await step("factura contado", () =>
    invoicesService.create(companyId, userId, "SUPERADMIN", {
      customerId: clientId, warehouseId, invoiceDate: date, saleType: "CONTADO", tenderMethod: "EFECTIVO",
      items: [{ productId: product.id, quantity: 2, unitPrice: 1500, lineDiscount: 0 }, { productId: service.id, quantity: 1.5, unitPrice: 500, lineDiscount: 0 }]
    } as never, context).then((r: { id: number; invoiceNumber: string }) => ({ id: r.id, number: r.invoiceNumber }))
  );
  await step("venta a Consumidor final queda con el cliente 1", async () => {
    const r = (await invoicesService.create(companyId, userId, "SUPERADMIN", {
      customer: { name: "Consumidor final" }, warehouseId, invoiceDate: date, saleType: "CONTADO", tenderMethod: "EFECTIVO",
      items: [{ productId: service.id, quantity: 1, unitPrice: 500, lineDiscount: 0 }]
    } as never, context)) as { id: number };
    const [rows] = await dbPool.query<Array<{ customerId: number | null }>>("SELECT customer_id AS customerId FROM invoices WHERE id = ?", [r.id]);
    if (Number(rows[0]?.customerId) !== clientId) throw new Error(`customer_id ${rows[0]?.customerId}`);
    return "vinculada";
  });
  const credit = await step("factura crédito", () =>
    invoicesService.create(companyId, userId, "SUPERADMIN", {
      customer: { name: "José Pérez", rtn: "08011990123456" }, warehouseId, invoiceDate: date, saleType: "CREDITO", dueDate: "2027-01-31",
      items: [{ productId: product.id, quantity: 1, unitPrice: 1500, lineDiscount: 100 }]
    } as never, context).then((r: { id: number; invoiceNumber: string }) => ({ id: r.id, number: r.invoiceNumber }))
  );
  const expectRejected = (name: string, fn: () => Promise<unknown>) =>
    step(name, async () => {
      try {
        await fn();
      } catch (error) {
        return (error as Error).message.slice(0, 80);
      }
      throw new Error("se aceptó (no debía)");
    });
  await expectRejected("rechaza crédito a Consumidor final escrito", () =>
    invoicesService.create(companyId, userId, "SUPERADMIN", {
      customer: { name: "Consumidor final" }, warehouseId, saleType: "CREDITO", dueDate: "2027-01-31",
      items: [{ productId: service.id, quantity: 1, unitPrice: 500, lineDiscount: 0 }]
    } as never, context)
  );
  await expectRejected("rechaza crédito al cliente genérico del catálogo", () =>
    invoicesService.create(companyId, userId, "SUPERADMIN", {
      customerId: clientId, warehouseId, saleType: "CREDITO", dueDate: "2027-01-31",
      items: [{ productId: service.id, quantity: 1, unitPrice: 500, lineDiscount: 0 }]
    } as never, context)
  );
  await step("la factura lleva la fecha de hoy aunque se envíe otra", async () => {
    const r = (await invoicesService.create(companyId, userId, "SUPERADMIN", {
      customerId: clientId, warehouseId, invoiceDate: "2020-01-01", saleType: "CONTADO", tenderMethod: "EFECTIVO",
      items: [{ productId: service.id, quantity: 1, unitPrice: 500, lineDiscount: 0 }]
    } as never, context)) as { originalInvoiceDate: string };
    if (r.originalInvoiceDate !== date) throw new Error(`fecha ${r.originalInvoiceDate}`);
    return r.originalInvoiceDate;
  });
  if (credit) {
    await expectRejected("rechaza abono con fecha anterior a la factura", () =>
      receivablesService.registerPayment(companyId, userId, credit.id, { amount: 10, paymentDate: "2020-01-01", method: "EFECTIVO" }, context)
    );
  }
  await step("rechaza vender sin existencia", async () => {
    try {
      await invoicesService.create(companyId, userId, "SUPERADMIN", { customerId: clientId, warehouseId, invoiceDate: date, saleType: "CONTADO", tenderMethod: "EFECTIVO", items: [{ productId: product.id, quantity: 9999, unitPrice: 1, lineDiscount: 0 }] } as never, context);
      throw new Error("se vendió sin existencia (no debía)");
    } catch (error) {
      if ((error as Error).message.includes("no debía")) throw error;
      return (error as Error).message.slice(0, 70);
    }
  });
  await step("rechaza 1.5 unidades de un producto por pieza", async () => {
    try {
      await invoicesService.create(companyId, userId, "SUPERADMIN", { customerId: clientId, warehouseId, invoiceDate: date, saleType: "CONTADO", tenderMethod: "EFECTIVO", items: [{ productId: product.id, quantity: 1.5, unitPrice: 1500, lineDiscount: 0 }] } as never, context);
      throw new Error("se aceptó (no debía)");
    } catch (error) {
      if ((error as Error).message.includes("no debía")) throw error;
      return (error as Error).message;
    }
  });
  await step("25 facturas simultáneas (números únicos)", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 25 }, () =>
        invoicesService.create(companyId, userId, "SUPERADMIN", { customerId: clientId, warehouseId, invoiceDate: date, saleType: "CONTADO", tenderMethod: "EFECTIVO", items: [{ productId: product.id, quantity: 1, unitPrice: 1500, lineDiscount: 0 }] } as never, context)
      )
    );
    const numbers = results.filter((r) => r.status === "fulfilled").map((r) => (r as PromiseFulfilledResult<{ invoiceNumber: string }>).value.invoiceNumber);
    const errors = results.filter((r) => r.status === "rejected").map((r) => ((r as PromiseRejectedResult).reason as Error).message);
    if (new Set(numbers).size !== numbers.length) throw new Error("números repetidos");
    if (errors.length) throw new Error(`${errors.length} fallaron: ${errors[0]}`);
    return `${numbers.length} emitidas, sin repetir`;
  });
  if (credit) {
    await step("cobro con recibo REC", () =>
      receivablesService.registerPayment(companyId, userId, credit.id, { amount: 500, paymentDate: date, method: "EFECTIVO" }, context).then((r: { receiptNumber?: string; payment?: { receiptNumber: string } }) => r.payment?.receiptNumber ?? r.receiptNumber ?? r)
    );
  }
  await step("entrada de mercadería (costo)", () =>
    inventoryService.createEntry(companyId, userId, { warehouseId, entryDate: date, supplierName: "Proveedor X", documentNumber: "F-001", items: [{ productId: product.id, quantity: 20, unitCost: 950 }] }).then((r: { id: number }) => ({ id: r.id }))
  );
  await step("ajuste de disminución", () =>
    inventoryService.createAdjustment(companyId, userId, { warehouseId, productId: product.id, adjustmentType: "AJUSTE_NEGATIVO", quantity: 1, notes: "Dañado en bodega" }).then((m: { stockAfter: number }) => ({ queda: m.stockAfter }))
  );

  const proforma = await step("proforma", () =>
    proformasService.create(companyId, userId, { customerId: clientId, warehouseId, proformaDate: date, items: [{ productId: product.id, quantity: 1, unitPrice: 1500, lineDiscount: 0 }] } as never).then((p: { id: number; proformaNumber: string }) => ({ id: p.id, number: p.proformaNumber }))
  );
  if (proforma) {
    await step("proforma a factura (bloqueo con nombre)", () => proformasService.convertToInvoice(companyId, userId, "SUPERADMIN", proforma.id, context).then((r: { invoice: { invoiceNumber: string } }) => r.invoice.invoiceNumber));
  }
  const quote = await step("cotización", () =>
    quotesService.create(companyId, userId, { customerId: clientId, warehouseId, quoteDate: date, items: [{ productId: service.id, quantity: 2, unitPrice: 500, lineDiscount: 0 }] } as never).then((q: { id: number; quoteNumber: string }) => ({ id: q.id, number: q.quoteNumber }))
  );
  if (quote) {
    await step("cotización a factura", () => quotesService.convertToInvoice(companyId, userId, "SUPERADMIN", quote.id, context).then((r: { invoice: { invoiceNumber: string } }) => r.invoice.invoiceNumber));
  }

  const supplier = await step("proveedor", () => suppliersService.create(companyId, userId, { name: "Distribuidora Ñ" }).then((row) => ({ id: Number(row.id), code: String(row.code) })));
  if (supplier) {
    await step("entrada con proveedor del catálogo -> kardex", async () => {
      await inventoryService.createEntry(companyId, userId, { warehouseId, entryDate: date, supplierId: supplier.id, documentNumber: "F-002", items: [{ productId: product.id, quantity: 3, unitCost: 960 }] });
      const movements = await inventoryService.listMovements(companyId, { productId: product.id, page: 1, pageSize: 50, movementType: "all", sourceType: "all" } as never);
      const entry = movements.items.find((m: { entryDocumentNumber: string | null }) => m.entryDocumentNumber === "F-002") as { supplierName: string | null } | undefined;
      const sale = movements.items.find((m: { movementType: string }) => m.movementType === "VENTA") as { customerName: string | null } | undefined;
      if (entry?.supplierName !== "Distribuidora Ñ") throw new Error(`proveedor en kardex: ${entry?.supplierName}`);
      if (!sale?.customerName) throw new Error("cliente en kardex vacío");
      return { entrada: entry.supplierName, venta: sale.customerName };
    });
    const doc = await step("documento por pagar", () =>
      payablesService.create(companyId, userId, { supplierId: supplier.id, documentNumber: "FAC-99", documentDate: date, dueDate: "2027-01-01", total: 3000 }).then((d: { id: number }) => ({ id: d.id }))
    );
    if (doc) {
      await step("pago con recibo PG", () => payablesService.registerPayment(companyId, userId, doc.id, { amount: 1000, paymentDate: date, method: "EFECTIVO" } as never, context).then((r: unknown) => typeof r));
    }
  }

  // Bancos: saldos, cheques, transferencias, anulación y bloqueos.
  const bankA = await step("bancos: cuenta con saldo inicial", () =>
    banksService.createAccount(companyId, userId, { bankName: "Banco Uno", accountType: "CORRIENTE", currency: "HNL", accountNumber: "200-123456-7", openingBalance: 10000, openingDate: date })
  );
  const bankB = await step("bancos: segunda cuenta", () =>
    banksService.createAccount(companyId, userId, { bankName: "Banco Dos", accountType: "AHORRO", currency: "HNL", accountNumber: "300-765432-1", openingBalance: 0, openingDate: date })
  );
  if (bankA && bankB) {
    const balance = async (id: number) => (await banksService.findAccountOrFail(companyId, id)).balance;
    const rejects = async (fn: () => Promise<unknown>, pattern: RegExp) =>
      fn().then(
        () => false,
        (error: Error) => pattern.test(error.message)
      );
    await step("bancos: depósito suma al saldo", async () => {
      await banksService.createMovement(companyId, userId, { bankAccountId: bankA.id, movementType: "DEPOSITO", movementDate: date, amount: 5000, reference: "BOL-1" });
      const value = await balance(bankA.id);
      if (value !== 15000) throw new Error(`saldo ${value}`);
      return value;
    });
    const check = await step("bancos: cheque emitido resta y queda en circulación", async () => {
      const { movement } = await banksService.createCheck(companyId, userId, { bankAccountId: bankA.id, movementDate: date, amount: 2000, checkNumber: "0001", beneficiary: "Proveedor Uno" });
      const account = await banksService.findAccountOrFail(companyId, bankA.id);
      if (account.balance !== 13000 || account.pendingChecks !== 1) throw new Error(JSON.stringify(account));
      return { id: movement.id };
    });
    await step("bancos: rechaza número de cheque repetido", async () => {
      const ok = await rejects(() => banksService.createCheck(companyId, userId, { bankAccountId: bankA.id, movementDate: date, amount: 10, checkNumber: "0001", beneficiary: "X" }), /ya está registrado/);
      if (!ok) throw new Error("aceptó un cheque repetido");
      return "ok";
    });
    const transfer = await step("bancos: transferencia entre cuentas", async () => {
      const { movement } = await banksService.createTransfer(companyId, userId, { fromAccountId: bankA.id, toAccountId: bankB.id, movementDate: date, amount: 3000 });
      const [a, b] = [await balance(bankA.id), await balance(bankB.id)];
      if (a !== 10000 || b !== 3000) throw new Error(`saldos ${a} y ${b}`);
      return { id: movement.id };
    });
    await step("bancos: rechaza transferir a otra moneda", async () => {
      const usd = await banksService.createAccount(companyId, userId, { bankName: "Banco Uno", accountType: "AHORRO", currency: "USD", accountNumber: "400-111111-1", openingBalance: 0, openingDate: date });
      const ok = await rejects(() => banksService.createTransfer(companyId, userId, { fromAccountId: bankA.id, toAccountId: usd.id, movementDate: date, amount: 1 }), /misma moneda/);
      if (!ok) throw new Error("aceptó otra moneda");
      return "ok";
    });
    if (transfer) {
      await step("bancos: anular transferencia anula las dos partes", async () => {
        await banksService.voidMovement(companyId, userId, transfer.id, "Prueba de anulación");
        const [a, b] = [await balance(bankA.id), await balance(bankB.id)];
        if (a !== 13000 || b !== 0) throw new Error(`saldos ${a} y ${b}`);
        return { a, b };
      });
    }
    if (check) {
      await step("bancos: cheque cobrado no se anula", async () => {
        await banksService.setCheckStatus(companyId, check.id, "COBRADO");
        const ok = await rejects(() => banksService.voidMovement(companyId, userId, check.id, "Prueba"), /ya fue cobrado/);
        const account = await banksService.findAccountOrFail(companyId, bankA.id);
        if (!ok || account.pendingChecks !== 0) throw new Error("se pudo anular o sigue en circulación");
        return "ok";
      });
    }
    await step("bancos: con movimientos no cambia moneda ni saldo inicial", async () => {
      const ok = await rejects(
        () => banksService.updateAccount(companyId, bankA.id, { bankName: "Banco Uno", accountType: "CORRIENTE", currency: "USD", accountNumber: "200-123456-7", openingBalance: 10000, openingDate: date }),
        /no se puede cambiar la moneda/
      );
      if (!ok) throw new Error("cambió la moneda");
      return "ok";
    });
    await step("bancos: lista de movimientos", () =>
      banksService.listMovements(companyId, bankA.id, { type: "all", status: "all", page: 1, pageSize: 50 }).then((r) => r.pagination.total)
    );
  }

  await step("lista facturas", () => invoicesService.list(companyId, { page: 1, pageSize: 50 }).then((r: { items: unknown[]; pagination: { total: number } }) => r.pagination.total));
  if (invoice) await step("detalle factura", () => invoicesService.getInvoiceDetail(companyId, invoice.id).then((d) => ({ total: d.grandTotal, fecha: d.printInvoiceDate, items: d.items.length })));
  if (invoice) {
    // Pie de factura con un dibujo de caracteres: se guarda tal cual (espacios al inicio
    // incluidos) y la factura sale en HTML, PDF carta y ticket.
    const art = ["   /\\_/\\", "  ( o.o )   Gracias", "   > ^ <    por su compra", "=".repeat(40)].join("\n");
    await step("pie de factura con dibujo de caracteres", async () => {
      const current = await settingsService.getBillingSettings(companyId);
      await settingsService.updateBillingSettings(companyId, { ...(current as never as Record<string, never>), footerText: `\n${art}   \n\n` } as never);
      const saved = (await settingsService.getBillingSettings(companyId)).footerText;
      if (saved !== art) throw new Error(`no se guardó igual: ${JSON.stringify(saved)}`);
      const detail = await invoicesService.getInvoiceDetail(companyId, invoice.id);
      const html = renderInvoiceHtml(detail as never);
      if (!html.includes("<pre") || !html.includes("   /\\_/\\")) throw new Error("la vista no conserva el dibujo");
      const pdfBytes = async (write: (res: never) => void) => {
        const { PassThrough } = await import("stream");
        const res = Object.assign(new PassThrough(), { setHeader: () => undefined });
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        await new Promise<void>((resolve, reject) => {
          res.on("end", resolve);
          res.on("error", reject);
          write(res as never);
        });
        const pdf = Buffer.concat(chunks);
        if (process.env.FLOW_PDF_DIR) fs.writeFileSync(path.join(process.env.FLOW_PDF_DIR, `pie-${chunks.length}-${pdf.length}.pdf`), pdf);
        return pdf.length;
      };
      return {
        carta: await pdfBytes((res) => writeInvoicePdf(detail as never, res)),
        ticket: await pdfBytes((res) => writeInvoiceTicketPdf(detail as never, res))
      };
    });
  }
  await step("existencias", () => inventoryService.listStocks(companyId, { page: 1, pageSize: 10 }).then((r: { items: Array<{ stockQuantity: number }> }) => r.items.map((i) => i.stockQuantity)));
  await step("existencia por bodega", () => inventoryService.productStockByWarehouse(companyId, product.id));
  await step("kardex del producto", () => inventoryService.listMovements(companyId, { productId: product.id, page: 1, pageSize: 50, movementType: "all", sourceType: "all" } as never).then((r: { items: Array<{ movementType: string; stockAfter: number }> }) => r.items.map((m) => `${m.movementType}:${m.stockAfter}`)));
  await step("costo tras entrada", () => productsService.findOrFail(companyId, product.id).then((p) => p.costPrice));
  await step("cuentas por cobrar", () => receivablesService.list(companyId, { page: 1, pageSize: 10 } as never).then((r: { items: unknown[] }) => r.items.length));
  await step("cuentas vencidas", () => receivablesService.list(companyId, { page: 1, pageSize: 10, overdue: true } as never).then((r: { items: unknown[] }) => r.items.length));
  await step("cuentas por pagar", () => payablesService.list(companyId, { page: 1, pageSize: 10 } as never).then((r: { items: unknown[] }) => r.items.length));
  await step("reporte de ventas", () => reportsService.salesReport(companyId, { dateFrom: date, dateTo: date, status: "all", saleType: "all" } as never).then((r: { summary: { documents: number; grandTotal: number }; byPaymentMethod: unknown[]; byProduct: unknown[] }) => ({ documentos: r.summary.documents, total: r.summary.grandTotal, metodos: r.byPaymentMethod.length, productos: r.byProduct.length })));
  await step("clientes", () => clientsService.list(companyId, { status: "all", page: 1, pageSize: 10 }).then((r: { items: unknown[] }) => r.items.length));
  await step("usuarios", () => usersService.list({ id: userId, role: "SUPERADMIN" }, companyId, { status: "all", page: 1, pageSize: 5 }).then((r: { items: unknown[] }) => r.items.length));
  await step("caja (resumen)", () => cajaService.overview(companyId, context).then((r: unknown) => Object.keys(r as object).length));
  if (session) {
    await step("cierre de caja", () => cajaService.close(companyId, userId, context, { cashSessionId: session.id, countedAmount: 1000 }).then((detail) => ({ esperado: detail.session.expectedAmount, diferencia: detail.session.difference })));
    await step("sesiones de caja", () => cajaService.listSessions(companyId, { page: 1, pageSize: 5, dateFrom: date, dateTo: date } as never).then((r: { items: unknown[] }) => r.items.length));
  }

  // ---- Una caja, un solo equipo
  {
    const pc1 = await step("registrar PC en la caja", () =>
      cajaService.registerTerminal(companyId, userId, { cashRegisterId: registerId, name: "PC Mostrador" }, "127.0.0.1").then((r) => ({ id: r.terminal.id }))
    );
    await expectRejected("rechaza una segunda PC en la misma caja", () =>
      cajaService.registerTerminal(companyId, userId, { cashRegisterId: registerId, name: "PC Bodega" }, "127.0.0.1")
    );
    await expectRejected("rechaza generar código para una caja con equipo", () => cajaService.createPairingCode(companyId, userId, registerId));
    await expectRejected("rechaza asignar otra PC por IP a esa caja", () =>
      cajaService.registerTerminalByIp(companyId, userId, { cashRegisterId: registerId, name: "PC IP", ip: "192.168.50.20" })
    );
    await step("PC sin registrar no usa la caja que ya tiene equipo", async () => {
      try {
        await invoicesService.create(companyId, userId, "CAJERO", {
          customerId: clientId, warehouseId, saleType: "CONTADO", tenderMethod: "EFECTIVO",
          items: [{ productId: service.id, quantity: 1, unitPrice: 500, lineDiscount: 0 }]
        } as never, { ...NO_CASH_CONTEXT });
      } catch (error) {
        const message = (error as Error).message;
        if (!/no está registrado/.test(message)) throw new Error(`motivo inesperado: ${message}`);
        return message.slice(0, 60);
      }
      throw new Error("se aceptó (no debía)");
    });
    const register2 = await step("segunda caja", () => cajaService.createRegister(companyId, "Caja 2").then((r: { id: number }) => ({ id: r.id })));
    if (pc1 && register2) {
      const pc2 = await step("PC en la segunda caja", () =>
        cajaService.registerTerminal(companyId, userId, { cashRegisterId: register2.id, name: "PC Caja 2" }, "127.0.0.1").then((r) => ({ id: r.terminal.id }))
      );
      await expectRejected("rechaza mover una PC a una caja ocupada", () => cajaService.updateTerminal(companyId, pc1.id, { cashRegisterId: register2.id }));
      if (pc2) {
        await step("quitar registro libera la caja y se puede mover", async () => {
          await cajaService.updateTerminal(companyId, pc2.id, { isActive: false });
          await cajaService.updateTerminal(companyId, pc1.id, { cashRegisterId: register2.id });
          return "ok";
        });
        await expectRejected("rechaza reactivar una PC en una caja ocupada", () => cajaService.updateTerminal(companyId, pc2.id, { isActive: true }));
      }
    }
  }

  // ---- Desactivar con relaciones (debe rechazar lo que está en uso)
  const expectBlocked = (name: string, fn: () => Promise<unknown>) =>
    step(`rechaza desactivar: ${name}`, async () => {
      try {
        await fn();
        throw new Error("se desactivó (no debía)");
      } catch (error) {
        if ((error as Error).message.includes("no debía")) throw error;
        return (error as Error).message;
      }
    });
  await expectBlocked("producto con existencia", () => productsService.updateStatus(companyId, product.id, false));
  await expectBlocked("cliente genérico", () => clientsService.updateStatus(companyId, clientId, false));
  await expectBlocked("bodega predeterminada con existencia", () => warehousesService.updateStatus(companyId, warehouseId, false));
  if (supplier) await expectBlocked("proveedor con saldo por pagar", () => suppliersService.updateStatus(companyId, supplier.id, false));
  const category = await step("categoría con producto", async () => {
    const created = await productsService.createCategory(companyId, { name: "Accesorios", isActive: true } as never);
    const current = await productsService.findOrFail(companyId, service.id);
    await productsService.update(companyId, service.id, { ...current, codes: current.codes, categoryId: created.id, taxable: true, controlsStock: false, isActive: true } as never);
    return { id: created.id };
  });
  if (category) await expectBlocked("categoría con productos activos", () => productsService.updateCategoryStatus(companyId, category.id, false));
  await step("desactivar servicio sin pendientes", () => productsService.updateStatus(companyId, service.id, false).then((p) => ({ activo: p.isActive })));
  if (category) {
    await step("desactivar categoría (ya sin productos activos)", () => productsService.updateCategoryStatus(companyId, category.id, false).then(() => "ok"));
    await step("rechaza restaurar producto con categoría desactivada", async () => {
      try {
        await productsService.updateStatus(companyId, service.id, true);
        throw new Error("se restauró (no debía)");
      } catch (error) {
        if ((error as Error).message.includes("no debía")) throw error;
        return (error as Error).message;
      }
    });
    await step("restaurar categoría y luego el servicio", async () => {
      await productsService.updateCategoryStatus(companyId, category.id, true);
      const restored = await productsService.updateStatus(companyId, service.id, true);
      return { activo: restored.isActive };
    });
  }

  await licenseRegistrySteps();

  console.log(failures === 0 ? "\nTodo el flujo funcionó." : `\n${failures} pasos fallaron.`);
}

/** Licencias guardadas en la base, anulaciones y registro de equipos, con una clave temporal. */
async function licenseRegistrySteps() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "licencia-flujo-"));
  const keys = crypto.generateKeyPairSync("ed25519");
  const names = ["FACTURACION_LICENCIA_ARCHIVO", "FACTURACION_LICENCIA_CLAVE_PUBLICA", "FACTURACION_LICENCIA_REQUERIDA"] as const;
  const saved = names.map((name) => process.env[name]);
  process.env.FACTURACION_LICENCIA_ARCHIVO = path.join(tmp, "equipo.dat");
  process.env.FACTURACION_LICENCIA_CLAVE_PUBLICA = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
  process.env.FACTURACION_LICENCIA_REQUERIDA = "true";
  const machine = machineCode();
  let seq = Date.now();
  const multi = (equipos: string[]) => {
    seq += 1;
    const payload = { v: 1 as const, tipo: "varios" as const, equipos, empresa: "Empresa de prueba", vence: null, emitida: "2026-10-01", id: `l${seq}`, seq };
    return { id: payload.id, seq, text: signMultiLicense(payload, keys.privateKey) };
  };
  const store = (license: { id: string; text: string }) =>
    dbPool.query("INSERT INTO system_licenses (license_text, license_id, equipos, emitida) VALUES (?, ?, ?, ?)", [license.text, license.id, 2, "2026-10-01"]);
  const revoke = (payload: { licencia?: string; equipo?: string; antes?: number }) =>
    dbPool.query("INSERT INTO license_revocations (revocation_text) VALUES (?)", [
      signRevocation({ v: 1, tipo: "revocacion", motivo: null, emitida: "2026-10-05", seq: Date.now(), ...payload }, keys.privateKey)
    ]);
  const expect = (name: string, check: (status: Awaited<ReturnType<typeof licenseStatus>>) => boolean) =>
    step(name, async () => {
      const status = await licenseStatus(true);
      if (!check(status)) throw new Error(`estado inesperado: ${JSON.stringify({ valid: status.valid, problem: status.problem, origen: status.origen })}`);
      return { valido: status.valid, problema: status.problem, origen: status.origen };
    });
  try {
    await expect("licencia: sin la suya ni en la base, no entra", (s) => !s.valid && s.problem === "missing");
    await store(multi(["AAAABBBBCCCC", "ZZZZYYYYXXXX"]));
    await expect("licencia en la base que no incluye esta PC: no entra", (s) => !s.valid && s.problem === "missing");
    const first = multi(["AAAABBBBCCCC", machine]);
    await store(first);
    await expect("licencia en la base que incluye esta PC: entra sin instalar nada", (s) => s.valid && s.origen === "base" && s.tipo === "varios");
    await step("esta PC queda en el registro de equipos", async () => {
      const [rows] = await dbPool.query<Array<{ machine_name: string }>>("SELECT machine_name FROM license_devices WHERE machine_code = ?", [machine]);
      if (rows.length !== 1) throw new Error(`${rows.length} filas`);
      return rows[0]!.machine_name;
    });
    await revoke({ licencia: first.id });
    await expect("anular esa licencia: se bloquea", (s) => !s.valid && s.problem === "revoked");
    await dbPool.query("DELETE FROM license_revocations");
    await expect("deshacer la anulación: vuelve a entrar", (s) => s.valid);
    await revoke({ equipo: machine, antes: seq + 1 });
    await expect("anular el equipo: sus licencias anteriores dejan de servir", (s) => !s.valid && s.problem === "revoked");
    await store(multi(["AAAABBBBCCCC", machine]));
    await expect("una licencia nueva (después de anular el equipo): entra", (s) => s.valid);
    await step("mismo código desde otra PC: queda marcado como posible copia", async () => {
      await dbPool.query("UPDATE license_devices SET machine_name = ? WHERE machine_code = ?", ["OTRA-PC", machine]);
      await licenseStatus(true);
      const [rows] = await dbPool.query<Array<{ conflict_name: string | null }>>("SELECT conflict_name FROM license_devices WHERE machine_code = ?", [machine]);
      if (rows[0]?.conflict_name !== "OTRA-PC") throw new Error(String(rows[0]?.conflict_name));
      return rows[0].conflict_name;
    });
  } finally {
    await dbPool.query("DELETE FROM license_revocations").catch(() => undefined);
    await dbPool.query("DELETE FROM system_licenses").catch(() => undefined);
    await dbPool.query("DELETE FROM license_devices").catch(() => undefined);
    fs.rmSync(tmp, { recursive: true, force: true });
    names.forEach((name, index) => {
      if (saved[index] === undefined) delete process.env[name];
      else process.env[name] = saved[index];
    });
  }
}

main()
  .catch((error) => {
    failures += 1;
    console.error(error);
  })
  .finally(async () => {
    await dbPool.end().catch(() => undefined);
    process.exit(failures === 0 ? 0 : 1);
  });
