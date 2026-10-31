/* ============================================
   Yearly cash-flow table
   ============================================
   The project cash flows behind NPV, one row per year 0..N, as signed
   amounts (outflows negative), plus a CSV export of the same rows. Year 0
   is net CAPEX at close (gross CAPEX less any upfront policy support);
   later years come from economics.yearlyCashFlows, so the last cumulative
   discounted cash flow is the NPV. */

/* Columns in display / CSV order. `financedOnly` columns exist only with
   debt financing; `policyOnly` only when the scheme pays operating credits;
   `drawOnly` only when loans are drawn after close (yearlyCashFlows
   debtDraw, the datacenter's construction and GPU loans). */
export const CASH_FLOW_COLUMNS = Object.freeze([
  { key: 'year', label: 'Year', csvLabel: 'Year' },
  { key: 'marketRevenue', label: 'Product revenue', csvLabel: 'Product revenue ($)', money: true },
  { key: 'policyCredits', label: 'Policy credits', csvLabel: 'Operating policy credits ($)', money: true, policyOnly: true },
  { key: 'operatingCost', label: 'O&M', csvLabel: 'O&M ($)', money: true },
  { key: 'replacementCapex', label: 'Replacement CAPEX', csvLabel: 'Replacement CAPEX ($)', money: true },
  { key: 'salvage', label: 'Salvage', csvLabel: 'Salvage value ($)', money: true },
  { key: 'netCashFlow', label: 'Net cash flow', csvLabel: 'Project net cash flow ($)', money: true },
  { key: 'discountFactor', label: 'Discount factor', csvLabel: 'Discount factor' },
  { key: 'discountedCashFlow', label: 'Discounted', csvLabel: 'Discounted cash flow ($)', money: true },
  { key: 'cumulativeDiscountedCashFlow', label: 'Cumulative discounted', csvLabel: 'Cumulative discounted cash flow ($)', money: true },
  { key: 'debtDraw', label: 'Debt drawn', csvLabel: 'Debt drawn ($)', money: true, financedOnly: true, drawOnly: true },
  { key: 'debtInterest', label: 'Interest paid', csvLabel: 'Debt interest paid ($)', money: true, financedOnly: true, drawOnly: true },
  { key: 'debtPrincipal', label: 'Principal repaid', csvLabel: 'Debt principal repaid incl. balloon ($)', money: true, financedOnly: true, drawOnly: true },
  { key: 'debtService', label: 'Debt service', csvLabel: 'Debt service ($)', money: true, financedOnly: true },
  { key: 'equityCashFlow', label: 'Equity cash flow', csvLabel: 'Equity cash flow ($)', money: true, financedOnly: true },
]);

/**
 * Rows of the yearly cash-flow table for computed economics.
 * Returns { rows, columns, financed, hasPolicyCredits, discountRatePercent,
 * npv, paybackYear }. paybackYear is the year in which the simple payback
 * (cash earned excluding salvage, as economics.paybackYears) is reached, or
 * null when it is not reached within the horizon or nothing was invested.
 */
// Outflow as a negative amount, without producing -0 for "no outflow".
const outflow = value => (value ? -value : 0);

export function buildCashFlowTable(economics) {
  const rate = (economics.discountRatePercent || 0) / 100;
  const financed = Boolean(economics.financing?.enabled);
  const yearly = economics.yearlyCashFlows || [];
  const netCapexAtClose = economics.netCapexAtClose || 0;

  const yearZero = {
    year: 0,
    marketRevenue: 0,
    policyCredits: 0,
    operatingCost: 0,
    replacementCapex: 0,
    salvage: 0,
    netCashFlow: outflow(netCapexAtClose),
    discountFactor: 1,
    discountedCashFlow: outflow(netCapexAtClose),
    cumulativeDiscountedCashFlow: outflow(netCapexAtClose),
    debtService: 0,
    debtDraw: economics.financing?.drawsAtClose || 0,
    debtInterest: 0,
    debtPrincipal: 0,
    equityCashFlow: outflow(economics.financing?.equityUpfront),
  };
  const rows = [yearZero];
  let cumulative = -netCapexAtClose;
  yearly.forEach(entry => {
    const policyCredits = entry.revenue?.policyCredits || 0;
    // Same discounting as the NPV sum in economics.js.
    const discountedCashFlow = entry.netCashFlow / Math.pow(1 + rate, entry.year);
    cumulative += discountedCashFlow;
    rows.push({
      year: entry.year,
      marketRevenue: entry.totalRevenue - policyCredits,
      policyCredits,
      operatingCost: outflow(entry.totalRevenue - entry.operatingCashFlow),
      replacementCapex: outflow(entry.replacementOutflow),
      salvage: entry.salvageValue || 0,
      netCashFlow: entry.netCashFlow,
      discountFactor: 1 / Math.pow(1 + rate, entry.year),
      discountedCashFlow,
      cumulativeDiscountedCashFlow: cumulative,
      debtService: outflow(entry.debtService),
      debtDraw: entry.debtDraw || 0,
      debtInterest: outflow(entry.debtInterest),
      debtPrincipal: outflow((entry.debtPrincipal || 0) + (entry.balloonPayment || 0)),
      equityCashFlow: entry.equityCashFlow,
    });
  });

  const hasPolicyCredits = rows.some(row => Math.abs(row.policyCredits) > 1e-9);
  const hasDebtDraws = financed && rows.some(row => row.year > 0 && row.debtDraw > 1e-9);
  const columns = CASH_FLOW_COLUMNS.filter(column =>
    (!column.financedOnly || financed) && (!column.policyOnly || hasPolicyCredits) && (!column.drawOnly || hasDebtDraws));
  const payback = economics.paybackYears;
  const paybackYear = !economics.noNetInvestment && Number.isFinite(payback) && payback > 0
    ? Math.ceil(payback - 1e-9)
    : null;

  return {
    rows,
    columns,
    financed,
    hasPolicyCredits,
    discountRatePercent: economics.discountRatePercent,
    npv: economics.npv,
    paybackYear,
  };
}

function csvField(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  const text = String(value ?? '');
  // Quote anything a spreadsheet could split or read as a formula.
  return /[",\r\n]|^[=+\-@\t]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * CSV text of the table: a key/value header block (e.g. the scenario's
 * inputs and share link), a blank line, then one header row and one row per
 * year with full-precision numbers. Lines end in CRLF (RFC 4180).
 * @param {{ rows: object[], columns: object[] }} table from buildCashFlowTable
 * @param {Array<[string, string|number]>} headerEntries
 */
export function buildCashFlowCsv(table, headerEntries = []) {
  const lines = headerEntries.map(([key, value]) => `${csvField(key)},${csvField(value)}`);
  if (lines.length) lines.push('');
  lines.push(table.columns.map(column => csvField(column.csvLabel)).join(','));
  table.rows.forEach(row => {
    lines.push(table.columns.map(column => csvField(row[column.key])).join(','));
  });
  return `${lines.join('\r\n')}\r\n`;
}
