/* Yearly cash-flow table under "Economics Over Time", plus its CSV download */

import { buildCashFlowCsv, buildCashFlowTable } from '../../model/cash-flow-table.js';
import { FormatNumbers } from '../format-numbers.js';
import { escapeAttribute, escapeHtml, tooltipLabel } from './markup.js';

const COLUMN_TOOLTIPS = {
  marketRevenue: 'Product and AI token sales; each stream follows its delivered energy as the array degrades.',
  policyCredits: 'Operating policy credits paid that year (they stop after the support period). Upfront support at close is netted out of year 0.',
  operatingCost: 'Fixed O&M on installed CAPEX.',
  replacementCapex: 'Scheduled equipment replacements (repowering, battery swaps, process blocks) inside the horizon.',
  salvage: 'Straight-line residual value of every asset (land at cost), returned in the final year.',
  netCashFlow: 'Project cash flow before financing. Year 0 is net CAPEX at close: gross CAPEX less any upfront policy support.',
  discountFactor: '1 / (1 + discount rate)^year.',
  discountedCashFlow: 'Net cash flow x discount factor.',
  cumulativeDiscountedCashFlow: 'Running sum of discounted cash flow; the final-year value is the project NPV.',
  debtService: 'Interest plus principal (and any balloon) on the project debt.',
  equityCashFlow: 'Net cash flow after debt service. Year 0 is the sponsor cash at close (equity share plus financing fee).',
};

/** Money with negatives in parentheses; exact zero as an em dash. */
export function formatCashFlowMoney(value) {
  if (!Number.isFinite(value) || Math.abs(value) < 0.005) return '—';
  const text = FormatNumbers.formatMoney(Math.abs(value));
  return value < 0 ? `(${text})` : text;
}

function formatCell(column, row) {
  const value = row[column.key];
  if (column.key === 'year') return String(value);
  if (column.key === 'discountFactor') return FormatNumbers.fixed(value, 4);
  return formatCashFlowMoney(value);
}

/** Table markup for buildCashFlowTable output; every text value is escaped. */
export function renderCashFlowTable(table) {
  const lastIndex = table.rows.length - 1;
  const head = table.columns.map(column => (
    `<th scope="col">${tooltipLabel(column.label, COLUMN_TOOLTIPS[column.key] || '')}</th>`
  )).join('');
  const body = table.rows.map((row, index) => {
    const classes = [];
    if (row.year === table.paybackYear) classes.push('cash-flow-payback');
    if (index === lastIndex) classes.push('cash-flow-final');
    const cells = table.columns.map(column => {
      const text = formatCell(column, row);
      const value = row[column.key];
      const cellClasses = [column.key === 'year' ? 'cash-flow-year' : 'cash-flow-num'];
      if (column.money && value < -0.005) cellClasses.push('cash-flow-negative');
      let content = escapeHtml(text);
      if (column.key === 'year' && row.year === table.paybackYear) {
        content += ' <span class="cash-flow-tag">payback</span>';
      }
      if (column.key === 'cumulativeDiscountedCashFlow' && index === lastIndex) {
        content = `<span class="cash-flow-tag">NPV</span> ${content}`;
      }
      const classAttr = `class="${escapeAttribute(cellClasses.join(' '))}"`;
      return column.key === 'year'
        ? `<th scope="row" ${classAttr}>${content}</th>`
        : `<td ${classAttr}>${content}</td>`;
    }).join('');
    const classAttr = classes.length ? ` class="${escapeAttribute(classes.join(' '))}"` : '';
    return `<tr${classAttr}>${cells}</tr>`;
  }).join('');
  return `<table class="cash-flow-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function describeTable(table) {
  const parts = [
    `Project cash flows before financing, discounted at ${FormatNumbers.fixed(table.discountRatePercent, 1)}%; outflows in parentheses.`,
    'The final cumulative discounted value is the NPV.',
  ];
  parts.push(table.paybackYear
    ? `Highlighted: year ${table.paybackYear}, when cumulative cash (without salvage) recovers net CAPEX at close.`
    : 'Cumulative cash (without salvage) does not recover net CAPEX at close within the horizon.');
  if (table.financed) parts.push('Debt service and equity cash flow are after financing.');
  return parts.join(' ');
}

/* Key/value rows that head the CSV: the scenario's main inputs and a link
   that reopens it. */
function buildCsvHeader(r, shareUrl) {
  const state = r.state || {};
  const e = r.economics;
  const entries = [
    ['Solar Chemical/AI Plant Builder', 'Yearly project cash flows'],
    ['Generated', new Date().toISOString()],
    ['Scenario link', shareUrl],
    ['Latitude', state.latitude],
    ['Longitude', state.longitude],
    ['Solar array (MWdc)', state.systemSizeMW],
    ['Battery (MWh)', state.batteryCapacityMWh],
    ['Discount rate (%)', e.discountRatePercent],
    ['Analysis horizon (years)', e.yearlyCashFlows.length],
    ['Incentive scheme', e.policy?.label || state.policyMode],
  ];
  if (r.sabatier?.enabled) entries.push(['Methane price ($/MCF)', state.methanePrice]);
  if (r.methanol?.enabled) entries.push(['Methanol price ($/t)', state.methanolPrice]);
  if (r.ai?.enabled) entries.push(['AI token price ($/1M tokens)', state.aiTokenPricePerM]);
  (e.exploratoryDetails || []).forEach(module => {
    entries.push([`${module.label} price ($/${module.outputUnit})`, module.unitPrice]);
  });
  entries.push(
    ['Debt financing', e.financing.enabled ? `${e.financing.debtSharePercent}% debt` : 'off'],
    ['Total CAPEX ($)', e.totalCapex],
    ['Net CAPEX at close ($)', e.netCapexAtClose],
    ['Project NPV ($)', e.npv],
    ['Sign convention', 'outflows negative; year 0 = net CAPEX at close'],
  );
  return entries;
}

/** Save text as a file: a Blob object URL on a temporary <a download>. */
function downloadText(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const cashFlowTableMethods = {
  bindCashFlowControls() {
    document.getElementById('cashFlowCsvButton')?.addEventListener('click', () => this.downloadCashFlowCsv());
  },

  updateCashFlowTable(r) {
    const container = document.getElementById('cashFlowTableScroll');
    if (!container) return;
    const table = buildCashFlowTable(r.economics);
    container.innerHTML = renderCashFlowTable(table);
    const note = document.getElementById('cashFlowNote');
    if (note) note.textContent = describeTable(table);
    const summary = document.getElementById('cashFlowSummary');
    if (summary) {
      summary.textContent = `NPV ${FormatNumbers.formatMoney(table.npv)}${table.paybackYear ? ` · payback year ${table.paybackYear}` : ''}`;
    }
  },

  downloadCashFlowCsv(r = this.lastResults) {
    if (!r?.economics) return;
    // Bring the address bar up to date so the link reopens this scenario.
    this.syncShareStateUrl?.();
    const shareUrl = `${window.location.origin}${window.location.pathname}${window.location.hash}`;
    const csv = buildCashFlowCsv(buildCashFlowTable(r.economics), buildCsvHeader(r, shareUrl));
    const date = new Date().toISOString().slice(0, 10);
    downloadText(`plant-cash-flows-${date}.csv`, csv, 'text/csv;charset=utf-8');
  },
};
