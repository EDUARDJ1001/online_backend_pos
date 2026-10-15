import type { RowDataPacket } from "mysql2";

import { dbPool } from "../../config/db";
import { AppError } from "../../utils/http-error";

/**
 * Validaciones al desactivar o restaurar registros que otros usan (llaves foráneas).
 *
 * Desactivar solo cambia el estado (is_active): nada se borra y los documentos ya
 * emitidos conservan sus datos. Lo que se valida es que no queden operaciones
 * abiertas usando el registro (existencias, saldos, documentos pendientes), y
 * que al restaurar no dependa de algo que sigue desactivado.
 */

type Row = RowDataPacket & { n: number | null; total: number | null };

async function stat(sql: string, params: unknown[]) {
  const [rows] = await dbPool.query<Row[]>(sql, params);
  return { n: Number(rows[0]?.n ?? 0), total: Number(rows[0]?.total ?? 0) };
}

function money(value: number) {
  return `L ${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`;
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

/** Junta los motivos y lanza un solo mensaje claro. */
function assertNone(name: string, action: "desactivar" | "restaurar", reasons: string[]) {
  if (reasons.length > 0) {
    throw new AppError(`No se puede ${action} ${name}: ${reasons.join("; ")}.`, 409);
  }
}

/** Proformas y cotizaciones aún abiertas (borrador, enviada o aprobada). */
const OPEN_DOCS = "('BORRADOR', 'ENVIADA', 'APROBADA')";

async function openDocumentsWith(companyId: number, column: "product_id" | "customer_id" | "warehouse_id", id: number) {
  const onItems = column === "product_id";
  const proformas = await stat(
    onItems
      ? `SELECT COUNT(DISTINCT pf.id) AS n, 0 AS total FROM proforma_items pi INNER JOIN proformas pf ON pf.id = pi.proforma_id
         WHERE pf.company_id = ? AND pi.product_id = ? AND pf.status IN ${OPEN_DOCS}`
      : `SELECT COUNT(*) AS n, 0 AS total FROM proformas WHERE company_id = ? AND ${column} = ? AND status IN ${OPEN_DOCS}`,
    [companyId, id]
  );
  const quotes = await stat(
    onItems
      ? `SELECT COUNT(DISTINCT q.id) AS n, 0 AS total FROM quote_items qi INNER JOIN quotes q ON q.id = qi.quote_id
         WHERE q.company_id = ? AND qi.product_id = ? AND q.status IN ${OPEN_DOCS}`
      : `SELECT COUNT(*) AS n, 0 AS total FROM quotes WHERE company_id = ? AND ${column} = ? AND status IN ${OPEN_DOCS}`,
    [companyId, id]
  );
  const reasons: string[] = [];
  if (proformas.n > 0) reasons.push(`está en ${plural(proformas.n, "proforma pendiente", "proformas pendientes")}`);
  if (quotes.n > 0) reasons.push(`está en ${plural(quotes.n, "cotización pendiente", "cotizaciones pendientes")}`);
  return reasons;
}

export const deactivationRules = {
  async product(companyId: number, product: { id: number; name: string; unitMeasure: string }) {
    const stock = await stat(
      "SELECT COUNT(*) AS n, COALESCE(SUM(stock_quantity), 0) AS total FROM product_stocks WHERE company_id = ? AND product_id = ? AND stock_quantity <> 0",
      [companyId, product.id]
    );
    const reasons: string[] = [];
    if (stock.total !== 0) reasons.push(`tiene ${stock.total} ${product.unitMeasure} en existencia (ajústala a 0 primero)`);
    reasons.push(...(await openDocumentsWith(companyId, "product_id", product.id)));
    assertNone(product.name, "desactivar", reasons);
  },

  async productRestore(companyId: number, product: { name: string; categoryId: number | null }) {
    if (!product.categoryId) return;
    const [rows] = await dbPool.query<Array<RowDataPacket & { name: string; isActive: number }>>(
      "SELECT name, is_active AS isActive FROM product_categories WHERE company_id = ? AND id = ?",
      [companyId, product.categoryId]
    );
    if (rows[0] && !Number(rows[0].isActive)) {
      assertNone(product.name, "restaurar", [`su categoría ${rows[0].name} está desactivada (restáurala primero)`]);
    }
  },

  async category(companyId: number, category: { id: number; name: string }) {
    const products = await stat("SELECT COUNT(*) AS n, 0 AS total FROM products WHERE company_id = ? AND category_id = ? AND is_active = 1", [
      companyId,
      category.id
    ]);
    assertNone(category.name, "desactivar", products.n > 0 ? [`tiene ${plural(products.n, "producto activo", "productos activos")} (cámbialos de categoría o desactívalos primero)`] : []);
  },

  async client(companyId: number, client: { id: number; name: string; isGeneric: number | boolean }) {
    const reasons: string[] = [];
    if (Number(client.isGeneric)) reasons.push("es el cliente genérico que se usa para ventas sin cliente");
    const pending = await stat(
      "SELECT COUNT(*) AS n, COALESCE(SUM(balance), 0) AS total FROM invoices WHERE company_id = ? AND customer_id = ? AND status = 'EMITIDA' AND balance > 0",
      [companyId, client.id]
    );
    if (pending.n > 0) reasons.push(`tiene saldo pendiente de ${money(pending.total)} en ${plural(pending.n, "factura", "facturas")}`);
    reasons.push(...(await openDocumentsWith(companyId, "customer_id", client.id)));
    assertNone(client.name, "desactivar", reasons);
  },

  async supplier(companyId: number, supplier: { id: number; name: string }) {
    const pending = await stat(
      "SELECT COUNT(*) AS n, COALESCE(SUM(balance), 0) AS total FROM payable_documents WHERE company_id = ? AND supplier_id = ? AND status IN ('PENDIENTE', 'PARCIAL') AND balance > 0",
      [companyId, supplier.id]
    );
    assertNone(
      supplier.name,
      "desactivar",
      pending.n > 0 ? [`se le deben ${money(pending.total)} en ${plural(pending.n, "documento", "documentos")} por pagar`] : []
    );
  },

  async warehouse(companyId: number, warehouse: { id: number; name: string; isDefault: number | boolean }) {
    const reasons: string[] = [];
    if (Number(warehouse.isDefault)) reasons.push("es la bodega predeterminada (marca otra como predeterminada primero)");
    const stock = await stat(
      "SELECT COUNT(*) AS n, 0 AS total FROM product_stocks WHERE company_id = ? AND warehouse_id = ? AND stock_quantity <> 0",
      [companyId, warehouse.id]
    );
    if (stock.n > 0) reasons.push(`tiene existencia de ${plural(stock.n, "producto", "productos")} (trasládala o ajústala a 0 primero)`);
    reasons.push(...(await openDocumentsWith(companyId, "warehouse_id", warehouse.id)));
    assertNone(warehouse.name, "desactivar", reasons);
  },

  async user(user: { id: number; fullName: string }) {
    const open = await stat("SELECT COUNT(*) AS n, 0 AS total FROM cash_sessions WHERE opened_by = ? AND status = 'ABIERTA'", [user.id]);
    assertNone(user.fullName, "desactivar", open.n > 0 ? ["tiene una caja abierta (ciérrala primero)"] : []);
  }
};
