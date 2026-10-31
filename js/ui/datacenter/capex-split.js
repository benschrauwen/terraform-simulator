/* "Where the capex goes" card: the initial capex split by item (economics.capexItems) as a 100%
   bar and a table grouped into IT, facility and power, with each item's share, when it is paid
   and what its replacements cost over the horizon (the GPU refreshes dominate). Pure markup
   (renderCapexSplit) plus the method that fills #capexSplit. */

import { escapeAttribute as attr, escapeHtml as esc } from '../renderers/markup.js';
import { fixed, formatPercent, money } from './format.js';

export const CAPEX_GROUPS = Object.freeze([
  { key: 'it', label: 'GPUs & IT' },
  { key: 'facility', label: 'Facility' },
  { key: 'power', label: 'Power' },
]);

// Fill per item (data colours of the plant layout and dispatch where they exist; judgment otherwise).
const ITEM_COLORS = {
  it: '#5f7fb8',
  facility: '#3f5f8f',
  cooling: '#3f8f9b',
  land: '#6b7480',
  substation: '#7f8a99',
  gridInterconnection: '#a8b2c0',
  solar: '#c6923a',
  solarLand: '#8a6d2a',
  battery: '#2f8a74',
  gas: '#c56f3c',
  nuclear: '#9b7fd1',
};
const FALLBACK_COLOR = '#8d99a8';

const colorOf = key => ITEM_COLORS[key] || FALLBACK_COLOR;

/** "at close", "at first power (4.5 yr)" or "over 2.8–4.5 yr" from an item's payment window. */
export function paidText(item, firstPowerYears) {
  if (item.paidToYear <= 0) return 'at notice-to-proceed';
  if (Math.abs(item.paidFromYear - item.paidToYear) < 0.01) {
    return Math.abs(item.paidToYear - firstPowerYears) < 0.01 ? `at first power (${fixed(item.paidToYear, 1)} yr)` : `at ${fixed(item.paidToYear, 1)} yr`;
  }
  return `over ${fixed(item.paidFromYear, 1)}–${fixed(item.paidToYear, 1)} yr`;
}

/** Replacement capex per asset key over the horizon (booked items, initial purchases excluded). */
export function replacementsByKey(economics) {
  const totals = {};
  (economics.yearlyCashFlows || []).forEach(entry => (entry.replacementItems || []).forEach(item => {
    if (item.initial) return;
    totals[item.key] = (totals[item.key] || 0) + item.cost;
  }));
  return totals;
}

/** Card body markup for a scenario result. */
export function renderCapexSplit(r) {
  const e = r.economics;
  const items = (e.capexItems || []).filter(item => item.capex > 0);
  const total = items.reduce((sum, item) => sum + item.capex, 0);
  if (!(total > 0)) return '<p class="field-note">No capital cost.</p>';
  const replacements = replacementsByKey(e);
  const firstPower = e.energizationYears ?? r.schedule.energizationMonth / 12;
  const sorted = [...items].sort((a, b) => b.capex - a.capex);

  let x = 0;
  const segments = sorted.map(item => {
    const width = (item.capex / total) * 100;
    const rect = `<rect x="${fixed(x, 3)}" y="0" width="${fixed(width, 3)}" height="10" fill="${attr(colorOf(item.key))}"><title>${esc(`${item.label}: ${money(item.capex)} (${formatPercent(width, 1)})`)}</title></rect>`;
    x += width;
    return rect;
  }).join('');

  const rows = CAPEX_GROUPS.map(group => {
    const groupItems = sorted.filter(item => item.group === group.key);
    if (!groupItems.length) return '';
    const groupTotal = groupItems.reduce((sum, item) => sum + item.capex, 0);
    const groupReplacements = groupItems.reduce((sum, item) => sum + (replacements[item.key] || 0), 0);
    const head = `<tr class="cs-group" data-group="${attr(group.key)}"><th scope="rowgroup">${esc(group.label)}</th><td>${esc(money(groupTotal))}</td><td>${esc(formatPercent((groupTotal / total) * 100, 1))}</td><td></td><td>${groupReplacements > 0 ? esc(money(groupReplacements)) : '—'}</td></tr>`;
    const body = groupItems.map(item => `<tr class="cs-item" data-key="${attr(item.key)}">
        <th scope="row"><svg class="cs-swatch" viewBox="0 0 10 10" aria-hidden="true"><rect width="10" height="10" rx="2" fill="${attr(colorOf(item.key))}"></rect></svg>${esc(item.label)}</th>
        <td>${esc(money(item.capex))}</td>
        <td>${esc(formatPercent((item.capex / total) * 100, 1))}</td>
        <td class="cs-paid">${esc(paidText(item, firstPower))}</td>
        <td>${replacements[item.key] > 0 ? esc(money(replacements[item.key])) : '—'}</td>
      </tr>`).join('');
    return head + body;
  }).join('');
  const totalReplacements = Object.values(replacements).reduce((sum, value) => sum + value, 0);

  return `<svg class="capex-split-bar" viewBox="0 0 100 10" preserveAspectRatio="none" role="img" aria-label="Initial capex by item">${segments}</svg>
    <div class="capex-split-scroll">
      <table class="capex-split-table">
        <thead><tr><th scope="col">Item</th><th scope="col">Initial capex</th><th scope="col">Share</th><th scope="col">Paid</th><th scope="col">Replacements, ${esc(fixed(e.analysisHorizonYears, 0))} yr</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><th scope="row">Total</th><td>${esc(money(total))}</td><td>100%</td><td></td><td>${totalReplacements > 0 ? esc(money(totalReplacements)) : '—'}</td></tr></tfoot>
      </table>
    </div>`;
}

export const capexSplitMethods = {
  updateCapexSplit(r) {
    const target = document.getElementById('capexSplit');
    if (target) target.innerHTML = renderCapexSplit(r);
    const meta = document.getElementById('capexSplitMeta');
    if (meta) meta.textContent = money(r.economics.totalCapex);
  },
};
