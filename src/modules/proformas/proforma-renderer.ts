import { footerBrandsHtml, footerTextHtml } from "../invoices/document-footer";
import { companyLogoSrc, documentAccentColor, parseFooterBrands } from "../invoices/invoice-assets";

type PrintableProformaDetail = {
  proformaNumber: string;
  proformaDate: string;
  validUntil: string | null;
  customerNameSnapshot: string;
  customerRtnSnapshot: string | null;
  customerPhoneSnapshot: string | null;
  customerAddressSnapshot: string | null;
  subtotal: number;
  discountTotal: number;
  taxableAmount15: number;
  taxableAmount18: number;
  exemptAmount: number;
  exoneratedAmount: number;
  isv15: number;
  isv18: number;
  grandTotal: number;
  totalInWords: string | null;
  status: string;
  notes: string | null;
  company: {
    commercialName: string;
    legalName: string;
    rtn: string;
    email: string | null;
    phone: string | null;
    address: string | null;
    primaryColor: string | null;
    headerColor: string | null;
    sidebarColor: string | null;
    logoUrl?: string | null;
    documentColor?: string | null;
    footerBrands?: string | null;
  };
  settings: {
    footerText: string | null;
    payableTo: string | null;
    defaultTaxRate: number;
  };
  items: Array<{
    lineNumber: number;
    productCode: string | null;
    description: string;
    quantity: number;
    unitPrice: number;
    lineDiscount: number;
    lineSubtotal?: number;
    lineTax: number;
    lineTotal: number;
  }>;
};

const brandBlue = "#416986";
const lightBlue = "#d7e1ea";
const totalBlue = "#c3d0d8";

function accentColor(detail: PrintableProformaDetail) {
  return documentAccentColor(detail.company);
}

function money(value: number, emptyWhenZero = false) {
  if (emptyWhenZero && Math.abs(value) < 0.005) {
    return "";
  }

  return `L${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number(value))}`;
}

function quantity(value: number) {
  return Number.isInteger(Number(value)) ? String(value) : Number(value).toFixed(2);
}

function printDate(value: string | null) {
  if (!value) {
    return "Sin fecha";
  }

  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);

  if (match) {
    const [, year, month, day] = match;
    return new Date(Number(year), Number(month) - 1, Number(day)).toLocaleDateString("es-HN", {
      day: "numeric",
      month: "long",
      year: "numeric"
    });
  }

  return new Date(value).toLocaleDateString("es-HN", {
    day: "numeric",
    month: "long",
    year: "numeric"
  });
}

function escapeHtml(value: string | number | null | undefined) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function logoMarkup(detail: PrintableProformaDetail) {
  const logo = companyLogoSrc(detail.company.logoUrl);

  // El logo es opcional: si la empresa no tiene ninguno, no se dibuja placeholder.
  return logo ? `<img class="logo" src="${logo}" alt="${escapeHtml(detail.company.commercialName)}" />` : "";
}

function footerBrandsMarkup(detail: PrintableProformaDetail) {
  return footerBrandsHtml(parseFooterBrands(detail.company.footerBrands));
}

function lineAmount(item: PrintableProformaDetail["items"][number]) {
  return item.lineSubtotal ?? item.lineTotal - item.lineTax;
}

export function renderProformaHtml(detail: PrintableProformaDetail) {
  const accent = accentColor(detail);
  const minimumRows = Math.max(12, detail.items.length);
  const rows = Array.from({ length: minimumRows })
    .map((_, index) => {
      const item = detail.items[index];
      const rowClass = index % 2 === 0 ? "" : " class=\"alt\"";

      if (!item) {
        return `
          <tr${rowClass}>
            <td>&nbsp;</td>
            <td></td>
            <td></td>
            <td></td>
          </tr>`;
      }

      return `
        <tr${rowClass}>
          <td class="qty">${quantity(Number(item.quantity))}</td>
          <td class="description">${escapeHtml(item.description)}${item.productCode ? `<small>${escapeHtml(item.productCode)}</small>` : ""}</td>
          <td class="number">${money(Number(item.unitPrice))}</td>
          <td class="number">${money(Number(lineAmount(item)))}</td>
        </tr>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Proforma ${escapeHtml(detail.proformaNumber)}</title>
  <style>
    @page { size: letter; margin: 0; }
    :root {
      color-scheme: light;
      --brand: ${brandBlue};
      --accent: ${accent};
      --stripe: ${lightBlue};
      --total: ${totalBlue};
      --ink: #1e293b;
      --muted: #5d6672;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #e5e7eb;
      color: var(--ink);
      font-family: "Century Gothic", "Aptos", "Segoe UI", Arial, sans-serif;
      font-size: 13px;
    }
    .invoice-page {
      position: relative;
      width: 8.5in;
      min-height: 11in;
      margin: 24px auto;
      background: #fff;
      border: 2px solid #001eff;
      padding: 12px 12px 90px;
      overflow: visible;
    }
    .top {
      display: grid;
      grid-template-columns: 1fr 1fr;
      align-items: center;
      min-height: 88px;
      border-bottom: 1.5px solid var(--accent);
      padding: 0 4px 8px;
    }
    .logo {
      width: 78px;
      height: 78px;
      object-fit: contain;
    }
    .logo-fallback {
      width: 78px;
      height: 78px;
      border: 2px solid #9aa6af;
      border-radius: 50%;
      display: grid;
      place-items: center;
      color: var(--brand);
      font-size: 26px;
      font-weight: 700;
    }
    .title {
      color: var(--brand);
      font-size: 44px;
      font-weight: 700;
      line-height: 1;
      text-align: right;
    }
    .company {
      display: grid;
      grid-template-columns: 1.2fr 1fr;
      gap: 16px;
      border-bottom: 1.5px solid var(--accent);
      padding: 14px 4px 10px;
    }
    .company-name {
      color: var(--brand);
      font-size: 15px;
      font-weight: 700;
    }
    .company p,
    .customer p,
    .footer p {
      margin: 2px 0;
    }
    .company-meta {
      display: grid;
      grid-template-columns: 72px minmax(0, 1fr);
      column-gap: 8px;
      align-content: center;
      color: var(--brand);
      font-weight: 700;
      text-align: right;
      font-size: 12px;
    }
    .company-meta .value {
      color: var(--brand);
      font-weight: 700;
      overflow-wrap: anywhere;
      line-height: 1.15;
      align-self: start;
    }
    .email {
      color: #00a1cf;
      text-decoration: underline;
    }
    .customer {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
      min-height: 88px;
      padding: 9px 4px;
      font-size: 12px;
    }
    .field-row {
      display: grid;
      grid-template-columns: 72px 1fr;
      align-items: baseline;
      min-height: 19px;
    }
    .field-row.wide-label {
      grid-template-columns: 132px minmax(0, 1fr);
      font-size: 12px;
      column-gap: 6px;
      line-height: 1.2;
    }
    .label {
      color: var(--brand);
      font-weight: 700;
      white-space: nowrap;
    }
    .document-number {
      color: #ff0000;
      font-size: 13px;
      font-weight: 700;
      text-align: right;
      white-space: nowrap;
    }
    .company-meta .small-value {
      font-size: 10px;
    }
    .right-value {
      min-width: 0;
      overflow-wrap: anywhere;
      text-align: right;
    }
    .highlight {
      background: #d9d9d9;
      padding-left: 4px;
    }
    .details {
      position: relative;
      border-top: 1.5px solid var(--accent);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }
    .items th {
      background: var(--accent);
      border-right: 2px solid #fff;
      color: #fff;
      font-size: 12px;
      font-weight: 700;
      padding: 4px 6px;
      text-align: center;
    }
    .items th:last-child {
      border-right: 0;
    }
    .items td {
      height: 20px;
      border-right: 2px solid #fff;
      border-bottom: 2px solid #fff;
      padding: 2px 6px;
      vertical-align: middle;
    }
    .items td:last-child {
      border-right: 0;
    }
    .items tr.alt td {
      background: var(--stripe);
    }
    .items .qty {
      width: 8%;
      text-align: center;
    }
    .items .description {
      width: 42%;
      color: #000;
      overflow-wrap: anywhere;
    }
    .items .description small {
      display: block;
      color: #4b5563;
      font-size: 9px;
    }
    .items .number {
      width: 25%;
      text-align: right;
      white-space: nowrap;
    }
    .summary-zone {
      display: grid;
      grid-template-columns: 1fr 0.76fr;
      gap: 8px;
      margin-top: 8px;
      align-items: start;
    }
    .exonerated {
      padding: 28px 4px 0;
      min-height: 128px;
      font-size: 14px;
    }
    .totals td {
      height: 20px;
      padding: 2px 6px;
      border-bottom: 2px solid #fff;
    }
    .totals .name {
      width: 60%;
      color: var(--brand);
      font-size: 12px;
      font-weight: 700;
      text-align: right;
      line-height: 1.1;
    }
    .totals .amount {
      width: 40%;
      background: var(--total);
      text-align: right;
      white-space: nowrap;
      font-size: 12px;
    }
    .totals .grand .amount {
      background: var(--stripe);
      font-weight: 700;
    }
    .letters {
      margin-top: 12px;
      text-align: center;
      font-size: 13px;
    }
    .letters strong {
      font-weight: 700;
    }
    .footer {
      margin-top: 22px;
      text-align: center;
      font-size: 13px;
      padding-bottom: 6px;
    }
    .footer strong {
      font-weight: 700;
    }
    .thanks {
      margin-top: 18px !important;
      font-weight: 700;
    }
    .brand-strip {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 22px;
      height: 58px;
      border-top: 12px solid var(--accent);
      padding: 8px 16px 6px;
      background: #fff;
    }
    .brand-strip img {
      max-height: 34px;
      max-width: 142px;
      object-fit: contain;
    }
    @media print {
      body { background: #fff; }
      .invoice-page {
        width: 8.5in;
        min-height: 11in;
        margin: 0;
        padding-bottom: 90px;
        border-color: #001eff;
        box-shadow: none;
      }
    }
  </style>
</head>
<body>
  <main class="invoice-page">
    <section class="top">
      <div>${logoMarkup(detail)}</div>
      <div class="title">Proforma</div>
    </section>

    <section class="company">
      <div>
        <p class="company-name">${escapeHtml(detail.company.legalName)}</p>
        <p>${escapeHtml(detail.company.address ?? "Dirección no disponible")}</p>
        <p>Telefono: ${escapeHtml(detail.company.phone ?? "Sin teléfono")}</p>
        <p class="email">${escapeHtml(detail.company.email ?? "")}</p>
      </div>
      <div class="company-meta">
        <span>Fecha:</span><span class="value">${printDate(detail.proformaDate)}</span>
        <span>R.T.N.:</span><span class="value">${escapeHtml(detail.company.rtn)}</span>
        <span>Validez:</span><span class="value">${printDate(detail.validUntil)}</span>
      </div>
    </section>

    <section class="customer">
      <div>
        <div class="field-row"><span class="label">Nombre</span><span>${escapeHtml(detail.customerNameSnapshot)}</span></div>
        <div class="field-row"><span class="label">Dirección</span><span>${escapeHtml(detail.customerAddressSnapshot ?? "Sin dirección")}</span></div>
        <div class="field-row"><span class="label">Telefono</span><span>${escapeHtml(detail.customerPhoneSnapshot ?? "Sin teléfono")}</span></div>
        <div class="field-row"><span class="label">RTN Cliente:</span><span class="highlight">${escapeHtml(detail.customerRtnSnapshot ?? "Consumidor final")}</span></div>
      </div>
      <div>
        <div class="field-row wide-label"><span>No. Proforma</span><span class="document-number">${escapeHtml(detail.proformaNumber)}</span></div>
        <div class="field-row wide-label"><span>Fecha de Validez:</span><span class="right-value">${printDate(detail.validUntil)}</span></div>
        <div class="field-row wide-label"><span>Estado:</span><span class="right-value">${escapeHtml(detail.status)}</span></div>
      </div>
    </section>

    <section class="details">
      <table class="items">
        <thead>
          <tr>
            <th style="width:8%">Cant.</th>
            <th style="width:42%">Descripción</th>
            <th style="width:25%">Precio por unidad</th>
            <th style="width:25%">Total</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>

    <section class="summary-zone">
      <div class="exonerated">
        <p>Datos del Adquiriente Exonerado:</p>
        <p>No. Orden Compra Excenta:</p>
        <p>No. Constancia Registro Exonerado:</p>
        <p>No. Registro SAG:</p>
      </div>
      <table class="totals">
        <tbody>
          <tr><td class="name">Subtotal</td><td class="amount">${money(detail.subtotal)}</td></tr>
          <tr><td class="name">Descuentos y Rebajas</td><td class="amount">${money(detail.discountTotal, true)}</td></tr>
          <tr><td class="name">Importe Exonerado</td><td class="amount">${money(detail.exoneratedAmount, true)}</td></tr>
          <tr><td class="name">Importe Excento</td><td class="amount">${money(detail.exemptAmount, true)}</td></tr>
          <tr><td class="name">Importe Gravado 15%</td><td class="amount">${money(detail.taxableAmount15, true)}</td></tr>
          <tr><td class="name">Importe Gravado 18%</td><td class="amount">${money(detail.taxableAmount18, true)}</td></tr>
          <tr><td class="name">ISV 15%</td><td class="amount">${money(detail.isv15, true)}</td></tr>
          <tr><td class="name">ISV 18%</td><td class="amount">${money(detail.isv18, true)}</td></tr>
          <tr><td class="name">Total Impuesto</td><td class="amount">${money(detail.isv15 + detail.isv18, true)}</td></tr>
          <tr class="grand"><td class="name">Total a Pagar</td><td class="amount">${money(detail.grandTotal)}</td></tr>
        </tbody>
      </table>
    </section>

    <section class="letters">
      Valor en Letras: <strong>${escapeHtml(detail.totalInWords ?? "No disponible")}</strong>
    </section>

    <section class="footer">
      <p>Todos los cheques se extenderán a nombre de <strong>${escapeHtml(detail.settings.payableTo ?? detail.company.legalName)}</strong></p>
      ${footerTextHtml(detail.settings.footerText ?? "Gracias por su confianza.", "thanks")}
      ${detail.notes ? `<p>${escapeHtml(detail.notes)}</p>` : ""}
    </section>

    ${footerBrandsMarkup(detail)}
  </main>
  <script>window.onload = () => window.print();</script>
</body>
</html>`;
}
