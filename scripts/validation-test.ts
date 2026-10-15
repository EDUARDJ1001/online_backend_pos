/**
 * Prueba de las validaciones vigentes (esquemas del backend). No usa base de datos.
 * Cada caso dice si los datos se aceptan o se rechazan y, al rechazar, en qué campo.
 * Si una regla cambia a propósito, se actualiza el caso aquí.
 *
 * Uso: npm run test:validaciones --workspace backend
 */
import type { ZodTypeAny } from "zod";

import { closeSessionSchema, manualMovementSchema, openSessionSchema } from "../src/modules/caja/caja.schemas";
import { createAccountSchema, createCheckSchema, createMovementSchema, createTransferSchema, voidMovementSchema } from "../src/modules/banks/banks.schemas";
import { createClientSchema } from "../src/modules/clients/clients.schemas";
import { createCompanySchema, updateCompanySchema } from "../src/modules/companies/companies.schemas";
import { hasAtMostTwoDecimals, isCountableUnit, todayInHonduras } from "../src/modules/inventory/inventory-rules";
import { createInventoryEntrySchema, createStockAdjustmentSchema } from "../src/modules/inventory/inventory.schemas";
import { createCorrectionSchema, createInvoiceSchema, listInvoicesSchema } from "../src/modules/invoices/invoices.schemas";
import { createPayableDocumentSchema, registerPayablePaymentSchema } from "../src/modules/payables/payables.schemas";
import { createProductWithStockSchema } from "../src/modules/products/products.schemas";
import { createProformaSchema } from "../src/modules/proformas/proformas.schemas";
import { createQuoteSchema } from "../src/modules/quotes/quotes.schemas";
import { registerPaymentSchema } from "../src/modules/receivables/receivables.schemas";
import { salesReportSchema } from "../src/modules/reports/reports.schemas";
import { createBillingSeriesSchema, updateBillingSettingsSchema } from "../src/modules/settings/settings.schemas";
import { createSupplierSchema } from "../src/modules/suppliers/suppliers.schemas";
import { databaseSchema } from "../src/modules/system/database.schemas";
import { createUserSchema } from "../src/modules/users/users.schemas";
import { createWarehouseSchema } from "../src/modules/warehouses/warehouses.schemas";

let passed = 0;
let failures = 0;

function report(ok: boolean, name: string, detail = "") {
  if (ok) {
    passed += 1;
  } else {
    failures += 1;
    console.log(`FAIL ${name}${detail ? `: ${detail}` : ""}`);
  }
}

/** Se acepta; `expect` revisa el valor ya transformado. */
function accepts(name: string, schema: ZodTypeAny, input: unknown, expect?: (value: never) => boolean) {
  const result = schema.safeParse(input);
  if (!result.success) {
    report(false, name, `rechazado en ${result.error.issues.map((issue) => issue.path.join(".") || "(raíz)").join(", ")}`);
    return;
  }
  report(!expect || expect(result.data as never), name, "valor transformado distinto");
}

/** Se rechaza y el error queda en `path` (p. ej. "items.0.quantity"). */
function rejects(name: string, schema: ZodTypeAny, input: unknown, path: string) {
  const result = schema.safeParse(input);
  if (result.success) {
    report(false, name, "se aceptó");
    return;
  }
  const paths = result.error.issues.map((issue) => issue.path.join("."));
  report(paths.includes(path), name, `error en ${paths.join(", ")} (esperado ${path})`);
}

const CAI = "A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-4D";
const TODAY = todayInHonduras();
const FUTURE = "2999-01-01";
const PAST = "2020-01-01";
const line = { productId: 1, quantity: 2, unitPrice: 100, lineDiscount: 0 };
const many = (count: number) => Array.from({ length: count }, (_, index) => ({ ...line, productId: index + 1 }));

// ---------------------------------------------------------------- Empresa
const company = { commercialName: "Tienda", legalName: "Tienda S. de R.L.", rtn: "08011990123456" };
accepts("empresa: RTN con guiones queda en 14 dígitos", createCompanySchema, { ...company, rtn: "0801-1990-123456" }, (v: { rtn: string }) => v.rtn === "08011990123456");
rejects("empresa: RTN de 13 dígitos", createCompanySchema, { ...company, rtn: "0801199012345" }, "rtn");
rejects("empresa: sin nombre comercial", createCompanySchema, { ...company, commercialName: " " }, "commercialName");
rejects("empresa: color no válido", createCompanySchema, { ...company, primaryColor: "rojo" }, "primaryColor");
rejects("empresa: logo que no es imagen", updateCompanySchema, { ...company, logo: "data:text/plain;base64,AAAA" }, "logo");
rejects("empresa: marca de pie en SVG", updateCompanySchema, { ...company, footerBrands: ["data:image/svg+xml;base64,AAAA"] }, "footerBrands.0");

// ---------------------------------------------------------------- Usuarios
const user = { username: "cajero.1", email: "cajero@correo.com", fullName: "Cajero Uno", password: "clave1234", roleId: 2 };
accepts("usuario: válido", createUserSchema, user);
rejects("usuario: contraseña corta", createUserSchema, { ...user, password: "ab12" }, "password");
rejects("usuario: contraseña sin número", createUserSchema, { ...user, password: "abcdefgh" }, "password");
rejects("usuario: contraseña sin letra", createUserSchema, { ...user, password: "12345678" }, "password");
rejects("usuario: nombre de usuario con espacio", createUserSchema, { ...user, username: "cajero uno" }, "username");
rejects("usuario: correo no válido", createUserSchema, { ...user, email: "cajero" }, "email");

// ---------------------------------------------------------------- Clientes, proveedores, bodegas
accepts("cliente: solo nombre", createClientSchema, { name: "Ana" });
accepts("cliente: correo vacío", createClientSchema, { name: "Ana", email: "" });
rejects("cliente: nombre de 1 letra", createClientSchema, { name: "A" }, "name");
rejects("cliente: correo no válido", createClientSchema, { name: "Ana", email: "ana@" }, "email");
accepts("cliente: RTN con guiones queda en dígitos", createClientSchema, { name: "Ana", rtn: "0801-1990-123456" }, (v: { rtn: string }) => v.rtn === "08011990123456");
accepts("cliente: DNI de 13 dígitos", createClientSchema, { name: "Ana", rtn: "0801199012345" });
rejects("cliente: RTN de 10 dígitos", createClientSchema, { name: "Ana", rtn: "0801199012" }, "rtn");
rejects("cliente: RTN con letras", createClientSchema, { name: "Ana", rtn: "0801199012345A" }, "rtn");
rejects("cliente: RTN de un departamento que no existe", createClientSchema, { name: "Ana", rtn: "9901199012345" }, "rtn");
rejects("cliente: RTN con municipio 00", createClientSchema, { name: "Ana", rtn: "0800199012345" }, "rtn");
rejects("cliente: nombre sin letras", createClientSchema, { name: "12345" }, "name");
accepts("cliente: espacios repetidos fuera del nombre", createClientSchema, { name: "  Ana   María  " }, (v: { name: string }) => v.name === "Ana María");
accepts("cliente: correo en minúsculas", createClientSchema, { name: "Ana", email: "Ana@Correo.COM" }, (v: { email: string }) => v.email === "ana@correo.com");
accepts("cliente: celular queda 9999-9999", createClientSchema, { name: "Ana", phone: "99 88 77 66" }, (v: { phone: string }) => v.phone === "9988-7766");
accepts("cliente: celular con +504", createClientSchema, { name: "Ana", phone: "+504 9988-7766" }, (v: { phone: string }) => v.phone === "9988-7766");
accepts("cliente: teléfono de otro país", createClientSchema, { name: "Ana", phone: "+1 305 555 1234" });
accepts("cliente: sin teléfono", createClientSchema, { name: "Ana", phone: "" });
rejects("cliente: teléfono incompleto", createClientSchema, { name: "Ana", phone: "9988-77" }, "phone");
rejects("cliente: teléfono que no empieza como en Honduras", createClientSchema, { name: "Ana", phone: "1234-5678" }, "phone");
rejects("cliente: teléfono con letras", createClientSchema, { name: "Ana", phone: "9988-77AB" }, "phone");

const bankAccount = { bankName: "Banco Uno", accountType: "CORRIENTE", currency: "HNL", accountNumber: "200-123456-7", openingBalance: 0, openingDate: "2026-01-01" };
accepts("banco: cuenta válida", createAccountSchema, bankAccount);
rejects("banco: número de cuenta con letras", createAccountSchema, { ...bankAccount, accountNumber: "200-ABC" }, "accountNumber");
rejects("banco: saldo inicial con 3 decimales", createAccountSchema, { ...bankAccount, openingBalance: 10.555 }, "openingBalance");
rejects("banco: fecha inicial futura", createAccountSchema, { ...bankAccount, openingDate: "2099-01-01" }, "openingDate");
accepts("banco: depósito", createMovementSchema, { bankAccountId: 1, movementType: "DEPOSITO", movementDate: "2026-01-02", amount: 100 });
rejects("banco: monto cero", createMovementSchema, { bankAccountId: 1, movementType: "DEPOSITO", movementDate: "2026-01-02", amount: 0 }, "amount");
rejects("banco: cheque por la vía de movimientos", createMovementSchema, { bankAccountId: 1, movementType: "CHEQUE", movementDate: "2026-01-02", amount: 10 }, "movementType");
rejects("banco: cheque sin beneficiario", createCheckSchema, { bankAccountId: 1, movementDate: "2026-01-02", amount: 10, checkNumber: "001", beneficiary: "" }, "beneficiary");
rejects("banco: transferir a la misma cuenta", createTransferSchema, { fromAccountId: 1, toAccountId: 1, movementDate: "2026-01-02", amount: 10 }, "toAccountId");
rejects("banco: anular sin motivo", voidMovementSchema, { reason: "x" }, "reason");
accepts("proveedor: solo nombre", createSupplierSchema, { name: "Distribuidora" });
rejects("proveedor: nombre de 1 letra", createSupplierSchema, { name: "D" }, "name");
rejects("proveedor: RTN de 10 dígitos", createSupplierSchema, { name: "Distribuidora", rtn: "0801199012" }, "rtn");
rejects("bodega: sin código", createWarehouseSchema, { code: "", name: "Central" }, "code");

// ---------------------------------------------------------------- Productos
const product = { code: "P1", name: "Cable", salePrice: 100, costPrice: 60 };
accepts("producto: unidad en minúsculas pasa a mayúsculas", createProductWithStockSchema, { ...product, unitMeasure: "kg" }, (v: { unitMeasure: string }) => v.unitMeasure === "KG");
rejects("producto: precio negativo", createProductWithStockSchema, { ...product, salePrice: -1 }, "salePrice");
rejects("producto: precio con 3 decimales", createProductWithStockSchema, { ...product, salePrice: 1.005 }, "salePrice");
rejects("producto: precio sobre el tope", createProductWithStockSchema, { ...product, salePrice: 100_000_000 }, "salePrice");
rejects("producto: costo sobre el tope", createProductWithStockSchema, { ...product, costPrice: 100_000_000 }, "costPrice");
rejects("producto: existencia mínima con 3 decimales", createProductWithStockSchema, { ...product, minStock: 1.005 }, "minStock");
rejects("producto: ISV mayor que 100", createProductWithStockSchema, { ...product, taxRate: 150 }, "taxRate");
rejects("producto: existencia inicial en un servicio", createProductWithStockSchema, { ...product, type: "SERVICIO", initialStock: 5, initialWarehouseId: 1 }, "initialStock");
rejects("producto: existencia inicial sin bodega", createProductWithStockSchema, { ...product, initialStock: 5 }, "initialWarehouseId");
rejects("producto: existencia inicial sin costo", createProductWithStockSchema, { ...product, costPrice: 0, initialStock: 5, initialWarehouseId: 1 }, "costPrice");
accepts("producto: existencia inicial completa", createProductWithStockSchema, { ...product, initialStock: 5, initialWarehouseId: 1 });

// ---------------------------------------------------------------- Factura
const invoice = { customerId: 1, invoiceDate: TODAY, items: [line] };
accepts("factura: contado con cliente", createInvoiceSchema, invoice);
accepts("factura: cliente escrito a mano", createInvoiceSchema, { ...invoice, customerId: undefined, customer: { name: "Consumidor final" } });
rejects("factura: sin cliente", createInvoiceSchema, { ...invoice, customerId: undefined }, "customerId");
rejects("factura: sin líneas", createInvoiceSchema, { ...invoice, items: [] }, "items");
rejects("factura: crédito sin vencimiento", createInvoiceSchema, { ...invoice, saleType: "CREDITO" }, "dueDate");
rejects("factura: vencimiento antes de la fecha", createInvoiceSchema, { ...invoice, saleType: "CREDITO", dueDate: PAST }, "dueDate");
accepts("factura: sin fecha (se emite hoy)", createInvoiceSchema, { ...invoice, invoiceDate: undefined });
rejects("factura: fecha pasada", createInvoiceSchema, { ...invoice, invoiceDate: PAST }, "invoiceDate");
rejects("factura: fecha futura", createInvoiceSchema, { ...invoice, invoiceDate: FUTURE }, "invoiceDate");
rejects("factura: vencimiento antes de hoy sin fecha", createInvoiceSchema, { ...invoice, invoiceDate: undefined, saleType: "CREDITO", dueDate: PAST }, "dueDate");
rejects("factura: más de 60 líneas", createInvoiceSchema, { ...invoice, items: many(61) }, "items");
accepts("factura: 60 líneas", createInvoiceSchema, { ...invoice, items: many(60) });
rejects("factura: RTN escrito de 10 dígitos", createInvoiceSchema, { ...invoice, customerId: undefined, customer: { name: "Ana", rtn: "0801199012" } }, "customer.rtn");
accepts("factura: RTN escrito con guiones", createInvoiceSchema, { ...invoice, customerId: undefined, customer: { name: "Ana", rtn: "0801-1990-123456" } });
rejects("factura: fecha no válida", createInvoiceSchema, { ...invoice, invoiceDate: "30/09/2026" }, "invoiceDate");
rejects("lista de facturas: rango invertido", listInvoicesSchema, { dateFrom: "2026-09-30", dateTo: "2026-09-01" }, "dateTo");
rejects("factura: cantidad 0", createInvoiceSchema, { ...invoice, items: [{ ...line, quantity: 0 }] }, "items.0.quantity");
rejects("factura: cantidad con 3 decimales", createInvoiceSchema, { ...invoice, items: [{ ...line, quantity: 1.234 }] }, "items.0.quantity");
rejects("factura: cantidad mayor a 1.000.000", createInvoiceSchema, { ...invoice, items: [{ ...line, quantity: 1_000_001 }] }, "items.0.quantity");
rejects("factura: descuento negativo", createInvoiceSchema, { ...invoice, items: [{ ...line, lineDiscount: -5 }] }, "items.0.lineDiscount");
rejects("factura: línea manual sin precio", createInvoiceSchema, { ...invoice, items: [{ description: "Servicio", quantity: 1 }] }, "items.0.unitPrice");
rejects("factura: línea sin producto ni descripción", createInvoiceSchema, { ...invoice, items: [{ quantity: 1, unitPrice: 5 }] }, "items.0.description");
rejects("factura: forma de pago desconocida", createInvoiceSchema, { ...invoice, tenderMethod: "BITCOIN" }, "tenderMethod");
rejects("corrección: sin cambios", createCorrectionSchema, { reason: "Error de digitación" }, "newCustomerName");
rejects("corrección: motivo corto", createCorrectionSchema, { newCustomerName: "Ana", reason: "x" }, "reason");

// ---------------------------------------------------------------- Proforma y cotización
const proforma = { customerId: 1, proformaDate: "2026-09-30", items: [line] };
accepts("proforma: validez vacía", createProformaSchema, { ...proforma, validUntil: "" });
rejects("proforma: validez antes de la fecha", createProformaSchema, { ...proforma, validUntil: "2026-09-01" }, "validUntil");
rejects("proforma: más de 60 líneas", createProformaSchema, { ...proforma, items: many(61) }, "items");
rejects("proforma: RTN escrito de 10 dígitos", createProformaSchema, { ...proforma, customerId: undefined, customer: { name: "Ana", rtn: "0801199012" } }, "customer.rtn");
const quote = { customerId: 1, quoteDate: "2026-09-30", items: [line] };
accepts("cotización: válida", createQuoteSchema, quote);
rejects("cotización: validez antes de la fecha", createQuoteSchema, { ...quote, validUntil: "2026-09-01" }, "validUntil");
rejects("cotización: RTN escrito de 10 dígitos", createQuoteSchema, { ...quote, customerId: undefined, customer: { name: "Ana", rtn: "0801199012" } }, "customer.rtn");
rejects("cotización: correo del cliente no válido", createQuoteSchema, { ...quote, customerId: undefined, customer: { name: "Ana", email: "ana@" } }, "customer.email");

// ---------------------------------------------------------------- Inventario
const entry = { warehouseId: 1, entryDate: "2026-09-30", items: [{ productId: 1, quantity: 3, unitCost: 50 }] };
accepts("entrada: válida", createInventoryEntrySchema, entry);
rejects("entrada: costo 0", createInventoryEntrySchema, { ...entry, items: [{ productId: 1, quantity: 3, unitCost: 0 }] }, "items.0.unitCost");
rejects("entrada: producto repetido", createInventoryEntrySchema, { ...entry, items: [entry.items[0], entry.items[0]] }, "items.1.productId");
rejects("entrada: sin bodega", createInventoryEntrySchema, { ...entry, warehouseId: undefined }, "warehouseId");
rejects("entrada: más de 200 líneas", createInventoryEntrySchema, { ...entry, items: Array.from({ length: 201 }, (_, i) => ({ productId: i + 1, quantity: 1, unitCost: 1 })) }, "items");
const adjustment = { warehouseId: 1, productId: 1, adjustmentType: "AJUSTE_NEGATIVO", quantity: 1, notes: "Dañado en bodega" };
accepts("ajuste: válido", createStockAdjustmentSchema, adjustment);
rejects("ajuste: motivo corto", createStockAdjustmentSchema, { ...adjustment, notes: "roto" }, "notes");
rejects("ajuste: stock inicial sin costo", createStockAdjustmentSchema, { ...adjustment, adjustmentType: "STOCK_INICIAL" }, "unitCost");
report(isCountableUnit("und") && isCountableUnit(" Caja ") && !isCountableUnit("KG") && !isCountableUnit(null), "unidades por pieza (UND sí, KG no)");
report(hasAtMostTwoDecimals(0.1 + 0.2) && hasAtMostTwoDecimals(1500) && !hasAtMostTwoDecimals(1.005), "máximo 2 decimales (tolera 0.1 + 0.2)");

// ---------------------------------------------------------------- Caja
accepts("caja: apertura sin monto queda en 0", openSessionSchema, { cashRegisterId: 1 }, (v: { openingAmount: number }) => v.openingAmount === 0);
rejects("caja: apertura negativa", openSessionSchema, { cashRegisterId: 1, openingAmount: -1 }, "openingAmount");
rejects("caja: cierre sin conteo", closeSessionSchema, { cashSessionId: 1 }, "countedAmount");
accepts("caja: cierre por denominaciones", closeSessionSchema, { cashSessionId: 1, countedBreakdown: { "500": 2, "100": 3 } });
rejects("caja: denominación con cantidad negativa", closeSessionSchema, { cashSessionId: 1, countedBreakdown: { "500": -1 } }, "countedBreakdown.500");
rejects("caja: retiro de 0", manualMovementSchema, { cashSessionId: 1, type: "RETIRO", amount: 0 }, "amount");

// ---------------------------------------------------------------- Facturación (SAR)
const series = { establishmentCode: "000", pointCode: "001", documentCode: "01", cai: CAI, issueDeadline: "2027-12-31", rangeStart: 1, rangeEnd: 500 };
accepts("CAI: minúsculas pasan a mayúsculas", createBillingSeriesSchema, { ...series, cai: CAI.toLowerCase() }, (v: { cai: string }) => v.cai === CAI);
rejects("CAI: formato incompleto", createBillingSeriesSchema, { ...series, cai: "A1B2C3-D4E5F6" }, "cai");
rejects("CAI: establecimiento de 2 dígitos", createBillingSeriesSchema, { ...series, establishmentCode: "01" }, "establishmentCode");
rejects("CAI: rango invertido", createBillingSeriesSchema, { ...series, rangeStart: 500, rangeEnd: 1 }, "rangeEnd");
rejects("CAI: correlativo fuera del rango", createBillingSeriesSchema, { ...series, currentNumber: 900 }, "currentNumber");
accepts("CAI: correlativo agotado (fin + 1)", createBillingSeriesSchema, { ...series, currentNumber: 501 });
rejects("CAI: sin fecha límite", createBillingSeriesSchema, { ...series, issueDeadline: "" }, "issueDeadline");
const legal = { defaultTaxRate: 15, invoiceTitle: "Factura", legendOriginal: "Original", legendCopy: "Copia", sarNotice: "La factura es beneficio de todos", allowClientNameCorrection: true, allowInvoiceDateReissue: false };
accepts("ISV general entero", updateBillingSettingsSchema, legal);
rejects("ISV general con decimales", updateBillingSettingsSchema, { ...legal, defaultTaxRate: 15.5 }, "defaultTaxRate");

// ---------------------------------------------------------------- Cobros, pagos, reportes, base de datos
rejects("cobro: monto negativo", registerPaymentSchema, { amount: -10, paymentDate: TODAY }, "amount");
rejects("cobro: monto con 3 decimales", registerPaymentSchema, { amount: 10.001, paymentDate: TODAY }, "amount");
rejects("cobro: fecha futura", registerPaymentSchema, { amount: 10, paymentDate: FUTURE }, "paymentDate");
accepts("cobro: fecha de hoy", registerPaymentSchema, { amount: 10, paymentDate: TODAY });
const payable = { supplierId: 1, documentNumber: "F-1", documentDate: TODAY, total: 100 };
accepts("cuenta por pagar: válida", createPayableDocumentSchema, payable);
rejects("cuenta por pagar: total 0", createPayableDocumentSchema, { ...payable, total: 0 }, "total");
rejects("cuenta por pagar: fecha futura", createPayableDocumentSchema, { ...payable, documentDate: FUTURE }, "documentDate");
rejects("cuenta por pagar: vencimiento antes del documento", createPayableDocumentSchema, { ...payable, dueDate: PAST }, "dueDate");
rejects("pago a proveedor: fecha futura", registerPayablePaymentSchema, { amount: 10, paymentDate: FUTURE }, "paymentDate");
rejects("reporte: sin fecha final", salesReportSchema, { dateFrom: "2026-09-01" }, "dateTo");
rejects("reporte: rango invertido", salesReportSchema, { dateFrom: "2026-09-30", dateTo: "2026-09-01" }, "dateTo");
rejects("base de datos: puerto fuera de rango", databaseSchema, { host: "localhost", database: "f", user: "u", port: 70000 }, "port");

console.log(failures === 0 ? `Validaciones: ${passed} casos correctos.` : `\nValidaciones: ${failures} de ${passed + failures} casos fallaron.`);
process.exit(failures === 0 ? 0 : 1);
