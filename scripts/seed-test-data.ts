import type { ResultSetHeader, RowDataPacket } from "mysql2";

import { dbPool } from "../src/config/db";
import { amountToSpanishWords } from "../src/utils/number-to-words-es";

// Marcador usado para poder limpiar y regenerar los movimientos e ingresos
// de inventario que crea este seed sin tocar los que crea la aplicación.
const SEED_TAG = "[SEED]";
const SEED_DOC_PREFIX = "SEED-ENT-";

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function daysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function daysAhead(days: number) {
  return daysAgo(-days);
}

interface IdRow extends RowDataPacket {
  id: number;
}

/** Devuelve la primera fila o falla con un mensaje claro en vez de un undefined silencioso. */
function requireRow<T extends RowDataPacket>(rows: T[], what: string): T {
  const row = rows[0];

  if (!row) {
    throw new Error(`No se pudo recuperar ${what} recien insertado.`);
  }

  return row;
}

interface CompanyRow extends RowDataPacket {
  id: number;
  code: string;
  legal_name: string;
  commercial_name: string;
  rtn: string;
  email: string | null;
  phone: string | null;
  address: string | null;
}

interface SeriesRow extends RowDataPacket {
  id: number;
  establishment_code: string;
  point_code: string;
  document_code: string;
  cai: string;
  issue_deadline: string | Date;
  range_start: number;
  range_end: number;
}

interface ProformaSeriesRow extends RowDataPacket {
  id: number;
  prefix: string;
}

/* ------------------------------------------------------------------ */
/* Definición de los datos de prueba                                    */
/* ------------------------------------------------------------------ */

interface ProductSeed {
  code: string;
  name: string;
  description: string;
  category: string;
  type: "PRODUCTO" | "SERVICIO";
  unitMeasure: string;
  salePrice: number;
  costPrice: number;
  taxable: boolean;
  taxRate: number;
  controlsStock: boolean;
  minStock: number;
}

interface EntrySeed {
  warehouseCode: string;
  daysAgo: number;
  documentSuffix: string;
  lines: Array<{ productCode: string; quantity: number }>;
}

interface ClientSeed {
  code: string;
  name: string;
  rtn: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  isGeneric: boolean;
}

interface WarehouseSeed {
  code: string;
  name: string;
  address: string;
  isDefault: boolean;
}

interface DocumentLineSeed {
  productCode: string;
  quantity: number;
  discount?: number;
}

interface InvoiceSeed {
  clientCode: string;
  warehouseCode: string;
  daysAgo: number;
  notes: string;
  lines: DocumentLineSeed[];
}

interface ProformaSeed {
  clientCode: string;
  warehouseCode: string;
  daysAgo: number;
  validDays: number;
  status: "BORRADOR" | "ENVIADA" | "APROBADA" | "RECHAZADA";
  notes: string;
  lines: DocumentLineSeed[];
}

interface CompanySeed {
  code: string;
  categories: Array<{ name: string; description: string }>;
  warehouses: WarehouseSeed[];
  clients: ClientSeed[];
  products: ProductSeed[];
  entries: EntrySeed[];
  invoices: InvoiceSeed[];
  proformas: ProformaSeed[];
  supplier: string;
}

const DATASET: CompanySeed[] = [
  {
    code: "EKKO",
    supplier: "Distribuidora Centroamericana S.A.",
    categories: [
      { name: "Electrónica", description: "Equipos de cómputo y periféricos" },
      { name: "Accesorios", description: "Cables, adaptadores y complementos" },
      { name: "Servicios", description: "Instalación, soporte y mantenimiento" }
    ],
    warehouses: [
      { code: "ALM-01", name: "Almacén Principal", address: "Barrio La Laguna, Bodega 1", isDefault: true },
      { code: "ALM-02", name: "Bodega Sucursal", address: "Colonia Palmira, Local 4", isDefault: false }
    ],
    clients: [
      { code: "CF", name: "Consumidor Final", rtn: null, email: null, phone: null, address: null, isGeneric: true },
      {
        code: "CLI-001",
        name: "Inversiones Morazán S. de R.L.",
        rtn: "08011999123456",
        email: "compras@morazan.test",
        phone: "2234-5566",
        address: "Boulevard Morazán, Torre Empresarial, Piso 5"
      , isGeneric: false },
      {
        code: "CLI-002",
        name: "Comercial Las Américas",
        rtn: "05019988654321",
        email: "admin@lasamericas.test",
        phone: "2299-1122",
        address: "Avenida Los Próceres, Edificio Centro"
      , isGeneric: false },
      {
        code: "CLI-003",
        name: "María Fernanda Reyes",
        rtn: "0801199512345",
        email: "mf.reyes@correo.test",
        phone: "9988-7766",
        address: "Residencial El Trapiche, Bloque C"
      , isGeneric: false },
      {
        code: "CLI-004",
        name: "Constructora del Valle S.A.",
        rtn: "01019977112233",
        email: "facturacion@delvalle.test",
        phone: "2255-8899",
        address: "Zona Industrial, Km 5 Carretera al Norte"
      , isGeneric: false }
    ],
    products: [
      {
        code: "EK-001",
        name: 'Laptop 14" Core i5 16GB',
        description: "Equipo portátil para oficina",
        category: "Electrónica",
        type: "PRODUCTO",
        unitMeasure: "UND",
        salePrice: 18500,
        costPrice: 14200,
        taxable: true,
        taxRate: 15,
        controlsStock: true,
        minStock: 2,
      },
      {
        code: "EK-002",
        name: "Mouse inalámbrico",
        description: "Mouse óptico 2.4 GHz",
        category: "Accesorios",
        type: "PRODUCTO",
        unitMeasure: "UND",
        salePrice: 450,
        costPrice: 260,
        taxable: true,
        taxRate: 15,
        controlsStock: true,
        minStock: 10,
      },
      {
        code: "EK-003",
        name: "Teclado mecánico retroiluminado",
        description: "Switches azules, layout español",
        category: "Accesorios",
        type: "PRODUCTO",
        unitMeasure: "UND",
        salePrice: 1250,
        costPrice: 820,
        taxable: true,
        taxRate: 15,
        controlsStock: true,
        minStock: 5,
      },
      {
        code: "EK-004",
        name: 'Monitor 24" Full HD',
        description: "Panel IPS 75 Hz",
        category: "Electrónica",
        type: "PRODUCTO",
        unitMeasure: "UND",
        salePrice: 4800,
        costPrice: 3600,
        taxable: true,
        taxRate: 15,
        controlsStock: true,
        minStock: 3,
      },
      {
        code: "EK-005",
        name: "Cable HDMI 2 m",
        description: "Cable HDMI 2.0 alta velocidad",
        category: "Accesorios",
        type: "PRODUCTO",
        unitMeasure: "UND",
        salePrice: 180,
        costPrice: 95,
        taxable: true,
        taxRate: 15,
        controlsStock: true,
        minStock: 15,
      },
      {
        code: "EK-006",
        name: "Instalación y configuración de equipo",
        description: "Servicio en sitio por equipo",
        category: "Servicios",
        type: "SERVICIO",
        unitMeasure: "SRV",
        salePrice: 800,
        costPrice: 0,
        taxable: true,
        taxRate: 15,
        controlsStock: false,
        minStock: 0,
      },
      {
        code: "EK-007",
        name: "Soporte técnico mensual",
        description: "Plan de soporte remoto, 20 horas",
        category: "Servicios",
        type: "SERVICIO",
        unitMeasure: "MES",
        salePrice: 2500,
        costPrice: 0,
        taxable: true,
        taxRate: 15,
        controlsStock: false,
        minStock: 0,
      },
      {
        code: "EK-008",
        name: "Capacitación básica de ofimática",
        description: "Servicio exento de ISV",
        category: "Servicios",
        type: "SERVICIO",
        unitMeasure: "SRV",
        salePrice: 3200,
        costPrice: 0,
        taxable: false,
        taxRate: 0,
        controlsStock: false,
        minStock: 0,
      }
    ],
    entries: [
      {
        warehouseCode: "ALM-01",
        daysAgo: 30,
        documentSuffix: "ALM01",
        lines: [
          { productCode: "EK-001", quantity: 12 },
          { productCode: "EK-002", quantity: 60 },
          { productCode: "EK-003", quantity: 25 },
          { productCode: "EK-004", quantity: 18 },
          { productCode: "EK-005", quantity: 80 }
        ]
      },
      {
        warehouseCode: "ALM-02",
        daysAgo: 20,
        documentSuffix: "ALM02",
        lines: [
          { productCode: "EK-002", quantity: 15 },
          { productCode: "EK-005", quantity: 25 }
        ]
      }
    ],
    invoices: [
      {
        clientCode: "CLI-001",
        warehouseCode: "ALM-01",
        daysAgo: 12,
        notes: "Venta de equipo para oficina administrativa.",
        lines: [
          { productCode: "EK-001", quantity: 2 },
          { productCode: "EK-004", quantity: 2 },
          { productCode: "EK-006", quantity: 2 }
        ]
      },
      {
        clientCode: "CLI-002",
        warehouseCode: "ALM-01",
        daysAgo: 6,
        notes: "Pedido de accesorios con descuento por volumen.",
        lines: [
          { productCode: "EK-002", quantity: 10, discount: 200 },
          { productCode: "EK-003", quantity: 4 },
          { productCode: "EK-005", quantity: 12, discount: 100 }
        ]
      },
      {
        clientCode: "CF",
        warehouseCode: "ALM-02",
        daysAgo: 2,
        notes: "Venta de mostrador.",
        lines: [
          { productCode: "EK-005", quantity: 3 },
          { productCode: "EK-002", quantity: 1 }
        ]
      },
      {
        clientCode: "CLI-004",
        warehouseCode: "ALM-01",
        daysAgo: 1,
        notes: "Incluye una línea exenta para probar el desglose fiscal.",
        lines: [
          { productCode: "EK-007", quantity: 1 },
          { productCode: "EK-008", quantity: 1 }
        ]
      }
    ],
    proformas: [
      {
        clientCode: "CLI-003",
        warehouseCode: "ALM-01",
        daysAgo: 5,
        validDays: 15,
        status: "ENVIADA",
        notes: "Cotización para equipamiento de home office.",
        lines: [
          { productCode: "EK-001", quantity: 1 },
          { productCode: "EK-002", quantity: 1 },
          { productCode: "EK-005", quantity: 2 }
        ]
      },
      {
        clientCode: "CLI-004",
        warehouseCode: "ALM-01",
        daysAgo: 3,
        validDays: 30,
        status: "APROBADA",
        notes: "Aprobada por el cliente, pendiente de facturar.",
        lines: [
          { productCode: "EK-004", quantity: 5 },
          { productCode: "EK-003", quantity: 5 },
          { productCode: "EK-006", quantity: 5 }
        ]
      },
      {
        clientCode: "CLI-002",
        warehouseCode: "ALM-02",
        daysAgo: 1,
        validDays: 10,
        status: "BORRADOR",
        notes: "Borrador en revisión interna.",
        lines: [{ productCode: "EK-007", quantity: 3 }]
      }
    ]
  },
  {
    code: "VISTUDIO",
    supplier: "Suministros Gráficos del Norte",
    categories: [
      { name: "Producción audiovisual", description: "Fotografía y video" },
      { name: "Diseño", description: "Identidad visual y piezas gráficas" },
      { name: "Insumos", description: "Materiales e impresión" }
    ],
    warehouses: [
      { code: "ALM-01", name: "Estudio Central", address: "Col. Lomas del Guijarro, Casa 12", isDefault: true }
    ],
    clients: [
      { code: "CF", name: "Consumidor Final", rtn: null, email: null, phone: null, address: null, isGeneric: true },
      {
        code: "CLI-001",
        name: "Agencia Creativa Norte",
        rtn: "05019966334455",
        email: "hola@creativanorte.test",
        phone: "2244-7788",
        address: "Barrio Guamilito, Calle 10"
      , isGeneric: false },
      {
        code: "CLI-002",
        name: "Restaurante La Terraza",
        rtn: "08011988776655",
        email: "gerencia@laterraza.test",
        phone: "9911-2233",
        address: "Zona Viva, Local 8"
      , isGeneric: false },
      {
        code: "CLI-003",
        name: "Carlos Adrián Ponce",
        rtn: null,
        email: "c.ponce@correo.test",
        phone: "3344-5566",
        address: "Residencial Las Uvas, Bloque B"
      , isGeneric: false }
    ],
    products: [
      {
        code: "VS-001",
        name: "Sesión fotográfica de producto",
        description: "Hasta 20 tomas editadas",
        category: "Producción audiovisual",
        type: "SERVICIO",
        unitMeasure: "SRV",
        salePrice: 3500,
        costPrice: 0,
        taxable: true,
        taxRate: 15,
        controlsStock: false,
        minStock: 0,
      },
      {
        code: "VS-002",
        name: "Edición de video promocional",
        description: "Pieza de hasta 90 segundos",
        category: "Producción audiovisual",
        type: "SERVICIO",
        unitMeasure: "SRV",
        salePrice: 4200,
        costPrice: 0,
        taxable: true,
        taxRate: 15,
        controlsStock: false,
        minStock: 0,
      },
      {
        code: "VS-003",
        name: "Diseño de identidad de marca",
        description: "Logotipo, paleta y manual básico",
        category: "Diseño",
        type: "SERVICIO",
        unitMeasure: "SRV",
        salePrice: 6500,
        costPrice: 0,
        taxable: true,
        taxRate: 15,
        controlsStock: false,
        minStock: 0,
      },
      {
        code: "VS-004",
        name: "Impresión de lona 1x2 m",
        description: "Lona banner con ojetes",
        category: "Insumos",
        type: "PRODUCTO",
        unitMeasure: "UND",
        salePrice: 950,
        costPrice: 520,
        taxable: true,
        taxRate: 15,
        controlsStock: true,
        minStock: 5,
      },
      {
        code: "VS-005",
        name: "Marco de madera A3",
        description: "Marco para impresión fotográfica",
        category: "Insumos",
        type: "PRODUCTO",
        unitMeasure: "UND",
        salePrice: 380,
        costPrice: 210,
        taxable: true,
        taxRate: 15,
        controlsStock: true,
        minStock: 8,
      }
    ],
    entries: [
      {
        warehouseCode: "ALM-01",
        daysAgo: 30,
        documentSuffix: "ALM01",
        lines: [
          { productCode: "VS-004", quantity: 40 },
          { productCode: "VS-005", quantity: 55 }
        ]
      }
    ],
    invoices: [
      {
        clientCode: "CLI-001",
        warehouseCode: "ALM-01",
        daysAgo: 9,
        notes: "Campaña de lanzamiento trimestral.",
        lines: [
          { productCode: "VS-001", quantity: 2 },
          { productCode: "VS-002", quantity: 1 }
        ]
      },
      {
        clientCode: "CLI-002",
        warehouseCode: "ALM-01",
        daysAgo: 4,
        notes: "Material impreso para apertura de sucursal.",
        lines: [
          { productCode: "VS-004", quantity: 6 },
          { productCode: "VS-005", quantity: 10, discount: 300 }
        ]
      },
      {
        clientCode: "CF",
        warehouseCode: "ALM-01",
        daysAgo: 1,
        notes: "Venta directa en estudio.",
        lines: [{ productCode: "VS-005", quantity: 2 }]
      }
    ],
    proformas: [
      {
        clientCode: "CLI-003",
        warehouseCode: "ALM-01",
        daysAgo: 7,
        validDays: 20,
        status: "ENVIADA",
        notes: "Propuesta de identidad para emprendimiento.",
        lines: [
          { productCode: "VS-003", quantity: 1 },
          { productCode: "VS-001", quantity: 1 }
        ]
      },
      {
        clientCode: "CLI-001",
        warehouseCode: "ALM-01",
        daysAgo: 2,
        validDays: 15,
        status: "APROBADA",
        notes: "Aprobada, pendiente de agendar producción.",
        lines: [
          { productCode: "VS-002", quantity: 2 },
          { productCode: "VS-004", quantity: 4 }
        ]
      }
    ]
  }
];

/* ------------------------------------------------------------------ */
/* Cálculo de líneas y totales (mismas reglas que invoices.service)     */
/* ------------------------------------------------------------------ */

interface ComputedLine {
  lineNumber: number;
  productId: number;
  description: string;
  quantity: number;
  unitPrice: number;
  unitCostSnapshot: number;
  taxRate: number;
  lineDiscount: number;
  gross: number;
  lineSubtotal: number;
  lineTax: number;
  lineTotal: number;
  affectsInventory: boolean;
  productCode: string;
}

interface ComputedTotals {
  subtotal: number;
  discountTotal: number;
  taxableAmount15: number;
  exemptAmount: number;
  isv15: number;
  grandTotal: number;
  totalInWords: string;
}

function computeLines(lines: DocumentLineSeed[], products: Map<string, ProductSeed & { id: number }>) {
  return lines.map((line, index): ComputedLine => {
    const product = products.get(line.productCode);

    if (!product) {
      throw new Error(`Producto no encontrado en el dataset: ${line.productCode}`);
    }

    const taxRate = product.taxable ? product.taxRate : 0;
    const gross = round2(line.quantity * product.salePrice);
    const lineDiscount = round2(line.discount ?? 0);
    const lineSubtotal = round2(gross - lineDiscount);
    const lineTax = round2((lineSubtotal * taxRate) / 100);

    return {
      lineNumber: index + 1,
      productId: product.id,
      productCode: product.code,
      description: product.name,
      quantity: round2(line.quantity),
      unitPrice: round2(product.salePrice),
      unitCostSnapshot: round2(product.costPrice),
      taxRate: round2(taxRate),
      lineDiscount,
      gross,
      lineSubtotal,
      lineTax,
      lineTotal: round2(lineSubtotal + lineTax),
      affectsInventory: product.controlsStock
    };
  });
}

function computeTotals(lines: ComputedLine[]): ComputedTotals {
  const subtotal = round2(lines.reduce((sum, line) => sum + line.gross, 0));
  const discountTotal = round2(lines.reduce((sum, line) => sum + line.lineDiscount, 0));
  const taxableAmount15 = round2(lines.filter((line) => line.taxRate > 0).reduce((sum, line) => sum + line.lineSubtotal, 0));
  const exemptAmount = round2(lines.filter((line) => line.taxRate <= 0).reduce((sum, line) => sum + line.lineSubtotal, 0));
  const isv15 = round2(lines.reduce((sum, line) => sum + line.lineTax, 0));
  const grandTotal = round2(lines.reduce((sum, line) => sum + line.lineTotal, 0));

  return {
    subtotal,
    discountTotal,
    taxableAmount15,
    exemptAmount,
    isv15,
    grandTotal,
    totalInWords: amountToSpanishWords(grandTotal)
  };
}

/* ------------------------------------------------------------------ */
/* Inserciones                                                          */
/* ------------------------------------------------------------------ */

async function getUserId(username: string) {
  const [rows] = await dbPool.query<IdRow[]>("SELECT id FROM users WHERE username = ? LIMIT 1", [username]);
  const user = rows[0];

  if (!user) {
    throw new Error(`Usuario "${username}" no existe. Ejecuta primero: npm run seed`);
  }

  return user.id;
}

async function clearPreviousSeed(companyId: number) {
  await dbPool.execute("DELETE FROM inventory_movements WHERE company_id = ? AND notes LIKE ?", [companyId, `${SEED_TAG}%`]);
  await dbPool.execute(
    `DELETE ii FROM inventory_entry_items ii
     INNER JOIN inventory_entries e ON e.id = ii.entry_id
     WHERE e.company_id = ? AND e.document_number LIKE ?`,
    [companyId, `${SEED_DOC_PREFIX}%`]
  );
  await dbPool.execute("DELETE FROM inventory_entries WHERE company_id = ? AND document_number LIKE ?", [
    companyId,
    `${SEED_DOC_PREFIX}%`
  ]);
}

async function seedCategories(companyId: number, categories: CompanySeed["categories"]) {
  const map = new Map<string, number>();

  for (const category of categories) {
    await dbPool.execute(
      `INSERT INTO product_categories (company_id, name, description, is_active)
       VALUES (?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE description = VALUES(description), is_active = 1`,
      [companyId, category.name, category.description]
    );

    const [rows] = await dbPool.query<IdRow[]>(
      "SELECT id FROM product_categories WHERE company_id = ? AND name = ? LIMIT 1",
      [companyId, category.name]
    );
    map.set(category.name, requireRow(rows, `la categoría ${category.name}`).id);
  }

  return map;
}

async function seedWarehouses(companyId: number, warehouses: WarehouseSeed[]) {
  const map = new Map<string, number>();

  for (const warehouse of warehouses) {
    await dbPool.execute(
      `INSERT INTO warehouses (company_id, code, name, address, is_default, is_active)
       VALUES (?, ?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         address = VALUES(address),
         is_default = VALUES(is_default),
         is_active = 1`,
      [companyId, warehouse.code, warehouse.name, warehouse.address, warehouse.isDefault ? 1 : 0]
    );

    const [rows] = await dbPool.query<IdRow[]>("SELECT id FROM warehouses WHERE company_id = ? AND code = ? LIMIT 1", [
      companyId,
      warehouse.code
    ]);
    map.set(warehouse.code, requireRow(rows, `la bodega ${warehouse.code}`).id);
  }

  return map;
}

async function seedClients(companyId: number, clients: ClientSeed[], createdBy: number) {
  const map = new Map<string, ClientSeed & { id: number }>();

  for (const client of clients) {
    await dbPool.execute(
      `INSERT INTO clients (company_id, code, name, rtn, email, phone, address, is_generic, is_active, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         rtn = VALUES(rtn),
         email = VALUES(email),
         phone = VALUES(phone),
         address = VALUES(address),
         is_generic = VALUES(is_generic),
         is_active = 1`,
      [
        companyId,
        client.code,
        client.name,
        client.rtn,
        client.email,
        client.phone,
        client.address,
        client.isGeneric ? 1 : 0,
        createdBy
      ]
    );

    const [rows] = await dbPool.query<IdRow[]>("SELECT id FROM clients WHERE company_id = ? AND code = ? LIMIT 1", [
      companyId,
      client.code
    ]);
    map.set(client.code, { ...client, id: requireRow(rows, `el cliente ${client.code}`).id });
  }

  return map;
}

async function seedProducts(
  companyId: number,
  products: ProductSeed[],
  categoryMap: Map<string, number>,
  createdBy: number
) {
  const map = new Map<string, ProductSeed & { id: number }>();

  for (const product of products) {
    await dbPool.execute(
      `INSERT INTO products (
         company_id, category_id, code, name, description, type, unit_measure,
         sale_price, cost_price, taxable, tax_rate, controls_stock, min_stock, is_active, created_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
       ON DUPLICATE KEY UPDATE
         category_id = VALUES(category_id),
         name = VALUES(name),
         description = VALUES(description),
         type = VALUES(type),
         unit_measure = VALUES(unit_measure),
         sale_price = VALUES(sale_price),
         cost_price = VALUES(cost_price),
         taxable = VALUES(taxable),
         tax_rate = VALUES(tax_rate),
         controls_stock = VALUES(controls_stock),
         min_stock = VALUES(min_stock),
         is_active = 1`,
      [
        companyId,
        categoryMap.get(product.category) ?? null,
        product.code,
        product.name,
        product.description,
        product.type,
        product.unitMeasure,
        product.salePrice,
        product.costPrice,
        product.taxable ? 1 : 0,
        product.taxRate,
        product.controlsStock ? 1 : 0,
        product.minStock,
        createdBy
      ]
    );

    const [rows] = await dbPool.query<IdRow[]>("SELECT id FROM products WHERE company_id = ? AND code = ? LIMIT 1", [
      companyId,
      product.code
    ]);
    map.set(product.code, { ...product, id: requireRow(rows, `el producto ${product.code}`).id });
  }

  return map;
}

interface MovementDraft {
  productId: number;
  warehouseId: number;
  movementType: "ENTRADA" | "VENTA";
  sourceType: "ENTRADA" | "FACTURA";
  invoiceId: number | null;
  invoiceItemId: number | null;
  entryId: number | null;
  entryItemId: number | null;
  quantity: number;
  unitCost: number;
  unitPrice: number;
  notes: string;
  /** Días de antigüedad del documento; se usa para ordenar cronológicamente. */
  sortKey: number;
}

async function seedInventoryEntries(
  company: CompanySeed,
  companyId: number,
  warehouses: Map<string, number>,
  products: Map<string, ProductSeed & { id: number }>,
  createdBy: number
) {
  const movements: MovementDraft[] = [];

  for (const entry of company.entries) {
    const warehouseId = warehouses.get(entry.warehouseCode);

    if (!warehouseId) {
      throw new Error(`Bodega ${entry.warehouseCode} no existe en el dataset de ${company.code}.`);
    }

    const [entryResult] = await dbPool.execute<ResultSetHeader>(
      `INSERT INTO inventory_entries (company_id, warehouse_id, entry_date, supplier_name, document_number, notes, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, 'APLICADA', ?)`,
      [
        companyId,
        warehouseId,
        daysAgo(entry.daysAgo),
        company.supplier,
        `${SEED_DOC_PREFIX}${company.code}-${entry.documentSuffix}`,
        `Carga de inventario a ${entry.warehouseCode} generada por el seed de datos de prueba.`,
        createdBy
      ]
    );

    const entryId = entryResult.insertId;

    for (const line of entry.lines) {
      const product = products.get(line.productCode);

      if (!product) {
        throw new Error(`Producto ${line.productCode} no existe en el dataset de ${company.code}.`);
      }

      const totalCost = round2(line.quantity * product.costPrice);

      const [itemResult] = await dbPool.execute<ResultSetHeader>(
        `INSERT INTO inventory_entry_items (entry_id, product_id, quantity, unit_cost, total_cost)
         VALUES (?, ?, ?, ?, ?)`,
        [entryId, product.id, line.quantity, product.costPrice, totalCost]
      );

      movements.push({
        productId: product.id,
        warehouseId,
        movementType: "ENTRADA",
        sourceType: "ENTRADA",
        invoiceId: null,
        invoiceItemId: null,
        entryId,
        entryItemId: itemResult.insertId,
        quantity: line.quantity,
        unitCost: product.costPrice,
        unitPrice: 0,
        notes: `${SEED_TAG} Entrada ${entry.warehouseCode} ${line.productCode}`,
        sortKey: entry.daysAgo
      });
    }
  }

  return { movements };
}

async function seedInvoices(
  company: CompanySeed,
  companyRow: CompanyRow,
  series: SeriesRow,
  products: Map<string, ProductSeed & { id: number }>,
  clients: Map<string, ClientSeed & { id: number }>,
  warehouses: Map<string, number>,
  createdBy: number
) {
  const movements: MovementDraft[] = [];
  const issueDeadline =
    series.issue_deadline instanceof Date ? series.issue_deadline.toISOString().slice(0, 10) : String(series.issue_deadline).slice(0, 10);

  let sequence = series.range_start;

  for (const invoice of company.invoices) {
    if (sequence > series.range_end) {
      throw new Error(`La serie de ${company.code} no tiene correlativos suficientes para el seed.`);
    }

    const lines = computeLines(invoice.lines, products);
    const totals = computeTotals(lines);
    const client = clients.get(invoice.clientCode)!;
    const warehouseId = warehouses.get(invoice.warehouseCode)!;
    const invoiceNumber = `${series.establishment_code}-${series.point_code}-${series.document_code}-${String(sequence).padStart(8, "0")}`;
    const invoiceDate = daysAgo(invoice.daysAgo);

    await dbPool.execute(
      `INSERT INTO invoices (
         company_id, billing_series_id, customer_id, warehouse_id, invoice_number, sequence_number,
         invoice_date, issued_at, customer_name_snapshot, customer_rtn_snapshot, customer_phone_snapshot,
         customer_address_snapshot, company_legal_name_snapshot, company_commercial_name_snapshot,
         company_rtn_snapshot, company_email_snapshot, company_phone_snapshot, company_address_snapshot,
         cai_snapshot, issue_deadline_snapshot, range_start_snapshot, range_end_snapshot,
         subtotal, discount_total, taxable_amount_15, exempt_amount, exonerated_amount,
         isv_15, tax_total, grand_total, total_in_words, status, notes, created_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 'EMITIDA', ?, ?)
       ON DUPLICATE KEY UPDATE
         customer_id = VALUES(customer_id),
         warehouse_id = VALUES(warehouse_id),
         invoice_date = VALUES(invoice_date),
         subtotal = VALUES(subtotal),
         discount_total = VALUES(discount_total),
         taxable_amount_15 = VALUES(taxable_amount_15),
         exempt_amount = VALUES(exempt_amount),
         isv_15 = VALUES(isv_15),
         tax_total = VALUES(tax_total),
         grand_total = VALUES(grand_total),
         total_in_words = VALUES(total_in_words),
         notes = VALUES(notes)`,
      [
        companyRow.id,
        series.id,
        client.id,
        warehouseId,
        invoiceNumber,
        sequence,
        invoiceDate,
        `${invoiceDate} 10:30:00`,
        client.name,
        client.rtn,
        client.phone,
        client.address,
        companyRow.legal_name,
        companyRow.commercial_name,
        companyRow.rtn,
        companyRow.email,
        companyRow.phone,
        companyRow.address,
        series.cai,
        issueDeadline,
        series.range_start,
        series.range_end,
        totals.subtotal,
        totals.discountTotal,
        totals.taxableAmount15,
        totals.exemptAmount,
        totals.isv15,
        totals.isv15,
        totals.grandTotal,
        totals.totalInWords,
        invoice.notes,
        createdBy
      ]
    );

    const [invoiceRows] = await dbPool.query<IdRow[]>(
      "SELECT id FROM invoices WHERE company_id = ? AND invoice_number = ? LIMIT 1",
      [companyRow.id, invoiceNumber]
    );
    const invoiceId = requireRow(invoiceRows, `la factura ${invoiceNumber}`).id;

    for (const line of lines) {
      await dbPool.execute(
        `INSERT INTO invoice_items (
           invoice_id, product_id, line_number, quantity, description, unit_price, unit_cost_snapshot,
           tax_rate, line_discount, line_subtotal, line_tax, line_total, affects_inventory
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           product_id = VALUES(product_id),
           quantity = VALUES(quantity),
           description = VALUES(description),
           unit_price = VALUES(unit_price),
           unit_cost_snapshot = VALUES(unit_cost_snapshot),
           tax_rate = VALUES(tax_rate),
           line_discount = VALUES(line_discount),
           line_subtotal = VALUES(line_subtotal),
           line_tax = VALUES(line_tax),
           line_total = VALUES(line_total),
           affects_inventory = VALUES(affects_inventory)`,
        [
          invoiceId,
          line.productId,
          line.lineNumber,
          line.quantity,
          line.description,
          line.unitPrice,
          line.unitCostSnapshot,
          line.taxRate,
          line.lineDiscount,
          line.lineSubtotal,
          line.lineTax,
          line.lineTotal,
          line.affectsInventory ? 1 : 0
        ]
      );

      if (!line.affectsInventory) {
        continue;
      }

      const [itemRows] = await dbPool.query<IdRow[]>(
        "SELECT id FROM invoice_items WHERE invoice_id = ? AND line_number = ? LIMIT 1",
        [invoiceId, line.lineNumber]
      );

      movements.push({
        productId: line.productId,
        warehouseId,
        movementType: "VENTA",
        sourceType: "FACTURA",
        invoiceId,
        invoiceItemId: requireRow(itemRows, `la línea ${line.lineNumber} de ${invoiceNumber}`).id,
        entryId: null,
        entryItemId: null,
        quantity: line.quantity,
        unitCost: line.unitCostSnapshot,
        unitPrice: line.unitPrice,
        notes: `${SEED_TAG} Venta ${invoiceNumber} línea ${line.lineNumber}`,
        sortKey: invoice.daysAgo
      });
    }

    sequence += 1;
  }

  await dbPool.execute("UPDATE billing_series SET current_number = ? WHERE id = ?", [sequence, series.id]);

  return { movements, nextSequence: sequence };
}

async function seedProformas(
  company: CompanySeed,
  companyId: number,
  proformaSeries: ProformaSeriesRow,
  products: Map<string, ProductSeed & { id: number }>,
  clients: Map<string, ClientSeed & { id: number }>,
  warehouses: Map<string, number>,
  createdBy: number
) {
  let sequence = 1;

  for (const proforma of company.proformas) {
    const lines = computeLines(proforma.lines, products);
    const totals = computeTotals(lines);
    const client = clients.get(proforma.clientCode)!;
    const warehouseId = warehouses.get(proforma.warehouseCode)!;
    const proformaNumber = `${proformaSeries.prefix}${String(sequence).padStart(8, "0")}`;
    const proformaDate = daysAgo(proforma.daysAgo);
    const approved = proforma.status === "APROBADA";

    await dbPool.execute(
      `INSERT INTO proformas (
         company_id, proforma_series_id, customer_id, warehouse_id, sequence_number, proforma_number,
         proforma_date, valid_until, customer_name_snapshot, customer_rtn_snapshot, customer_phone_snapshot,
         customer_address_snapshot, subtotal, discount_total, taxable_amount_15, exempt_amount,
         exonerated_amount, isv_15, tax_total, grand_total, total_in_words, status, approved_at,
         approved_by, notes, created_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         customer_id = VALUES(customer_id),
         warehouse_id = VALUES(warehouse_id),
         proforma_date = VALUES(proforma_date),
         valid_until = VALUES(valid_until),
         subtotal = VALUES(subtotal),
         discount_total = VALUES(discount_total),
         taxable_amount_15 = VALUES(taxable_amount_15),
         exempt_amount = VALUES(exempt_amount),
         isv_15 = VALUES(isv_15),
         tax_total = VALUES(tax_total),
         grand_total = VALUES(grand_total),
         total_in_words = VALUES(total_in_words),
         status = VALUES(status),
         approved_at = VALUES(approved_at),
         approved_by = VALUES(approved_by),
         notes = VALUES(notes)`,
      [
        companyId,
        proformaSeries.id,
        client.id,
        warehouseId,
        sequence,
        proformaNumber,
        proformaDate,
        daysAhead(proforma.validDays - proforma.daysAgo),
        client.name,
        client.rtn,
        client.phone,
        client.address,
        totals.subtotal,
        totals.discountTotal,
        totals.taxableAmount15,
        totals.exemptAmount,
        totals.isv15,
        totals.isv15,
        totals.grandTotal,
        totals.totalInWords,
        proforma.status,
        approved ? `${proformaDate} 15:00:00` : null,
        approved ? createdBy : null,
        proforma.notes,
        createdBy
      ]
    );

    const [proformaRows] = await dbPool.query<IdRow[]>(
      "SELECT id FROM proformas WHERE company_id = ? AND proforma_number = ? LIMIT 1",
      [companyId, proformaNumber]
    );
    const proformaId = requireRow(proformaRows, `la proforma ${proformaNumber}`).id;

    for (const line of lines) {
      await dbPool.execute(
        `INSERT INTO proforma_items (
           proforma_id, product_id, line_number, quantity, description, unit_price, unit_cost_snapshot,
           tax_rate, line_discount, line_subtotal, line_tax, line_total, affects_inventory
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           product_id = VALUES(product_id),
           quantity = VALUES(quantity),
           description = VALUES(description),
           unit_price = VALUES(unit_price),
           unit_cost_snapshot = VALUES(unit_cost_snapshot),
           tax_rate = VALUES(tax_rate),
           line_discount = VALUES(line_discount),
           line_subtotal = VALUES(line_subtotal),
           line_tax = VALUES(line_tax),
           line_total = VALUES(line_total),
           affects_inventory = VALUES(affects_inventory)`,
        [
          proformaId,
          line.productId,
          line.lineNumber,
          line.quantity,
          line.description,
          line.unitPrice,
          line.unitCostSnapshot,
          line.taxRate,
          line.lineDiscount,
          line.lineSubtotal,
          line.lineTax,
          line.lineTotal,
          line.affectsInventory ? 1 : 0
        ]
      );
    }

    sequence += 1;
  }

  await dbPool.execute("UPDATE proforma_series SET current_number = ? WHERE id = ?", [sequence, proformaSeries.id]);
}

/**
 * Inserta los movimientos en orden cronológico manteniendo coherentes
 * stock_before / stock_after, y deja product_stocks con el saldo final.
 */
async function applyMovements(companyId: number, movements: MovementDraft[], createdBy: number) {
  const balances = new Map<string, { productId: number; warehouseId: number; quantity: number }>();
  // Mayor sortKey = documento más antiguo, va primero.
  const ordered = [...movements].sort((a, b) => b.sortKey - a.sortKey);

  for (const movement of ordered) {
    const key = `${movement.productId}:${movement.warehouseId}`;
    const before = balances.get(key)?.quantity ?? 0;
    const delta = movement.movementType === "ENTRADA" ? movement.quantity : -movement.quantity;
    const after = round2(before + delta);

    await dbPool.execute(
      `INSERT INTO inventory_movements (
         company_id, product_id, warehouse_id, movement_type, source_type,
         invoice_id, invoice_item_id, entry_id, entry_item_id,
         quantity, unit_cost, unit_price, stock_before, stock_after, notes, created_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        companyId,
        movement.productId,
        movement.warehouseId,
        movement.movementType,
        movement.sourceType,
        movement.invoiceId,
        movement.invoiceItemId,
        movement.entryId,
        movement.entryItemId,
        movement.quantity,
        movement.unitCost,
        movement.unitPrice,
        before,
        after,
        movement.notes,
        createdBy
      ]
    );

    balances.set(key, { productId: movement.productId, warehouseId: movement.warehouseId, quantity: after });
  }

  for (const { productId, warehouseId, quantity } of balances.values()) {
    await dbPool.execute(
      `INSERT INTO product_stocks (company_id, product_id, warehouse_id, stock_quantity)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE stock_quantity = VALUES(stock_quantity)`,
      [companyId, productId, warehouseId, quantity]
    );
  }

  return balances;
}

/* ------------------------------------------------------------------ */
/* Orquestación                                                         */
/* ------------------------------------------------------------------ */

async function main() {
  const createdBy = await getUserId("superadmin");
  const [companyRows] = await dbPool.query<CompanyRow[]>(
    "SELECT id, code, legal_name, commercial_name, rtn, email, phone, address FROM companies"
  );
  const companiesByCode = new Map(companyRows.map((company) => [company.code, company]));

  for (const company of DATASET) {
    const companyRow = companiesByCode.get(company.code);

    if (!companyRow) {
      console.warn(`- Empresa ${company.code} no existe en la base. Se omite.`);
      continue;
    }

    const [seriesRows] = await dbPool.query<SeriesRow[]>(
      `SELECT id, establishment_code, point_code, document_code, cai, issue_deadline, range_start, range_end
       FROM billing_series WHERE company_id = ? AND is_active = 1 LIMIT 1`,
      [companyRow.id]
    );

    if (!seriesRows[0]) {
      throw new Error(`La empresa ${company.code} no tiene serie de facturación activa.`);
    }

    const [proformaSeriesRows] = await dbPool.query<ProformaSeriesRow[]>(
      "SELECT id, prefix FROM proforma_series WHERE company_id = ? LIMIT 1",
      [companyRow.id]
    );

    if (!proformaSeriesRows[0]) {
      throw new Error(`La empresa ${company.code} no tiene serie de proformas. Ejecuta primero: npm run seed`);
    }

    await clearPreviousSeed(companyRow.id);

    const categoryMap = await seedCategories(companyRow.id, company.categories);
    const warehouseMap = await seedWarehouses(companyRow.id, company.warehouses);
    const clientMap = await seedClients(companyRow.id, company.clients, createdBy);
    const productMap = await seedProducts(companyRow.id, company.products, categoryMap, createdBy);

    const entry = await seedInventoryEntries(company, companyRow.id, warehouseMap, productMap, createdBy);

    const invoices = await seedInvoices(
      company,
      companyRow,
      seriesRows[0],
      productMap,
      clientMap,
      warehouseMap,
      createdBy
    );

    await seedProformas(company, companyRow.id, proformaSeriesRows[0], productMap, clientMap, warehouseMap, createdBy);

    const balances = await applyMovements(companyRow.id, [...entry.movements, ...invoices.movements], createdBy);

    const negative = [...balances.values()].filter((balance) => balance.quantity < 0).length;

    console.log(`\n${company.code}`);
    console.log(`  categorías .......... ${company.categories.length}`);
    console.log(`  bodegas ............. ${company.warehouses.length}`);
    console.log(`  clientes ............ ${company.clients.length}`);
    console.log(`  productos ........... ${company.products.length}`);
    console.log(`  facturas ............ ${company.invoices.length} (correlativo siguiente: ${invoices.nextSequence})`);
    console.log(`  proformas ........... ${company.proformas.length}`);
    console.log(`  movimientos inv. .... ${entry.movements.length + invoices.movements.length}`);

    if (negative > 0) {
      console.warn(`  ATENCIÓN: ${negative} combinaciones producto/bodega quedaron con stock negativo.`);
    }
  }

  console.log("\nDatos de prueba generados. El script es idempotente: puedes volver a ejecutarlo.");
  await dbPool.end();
}

main().catch(async (error) => {
  console.error("No se pudo generar los datos de prueba:", error);
  await dbPool.end();
  process.exit(1);
});
