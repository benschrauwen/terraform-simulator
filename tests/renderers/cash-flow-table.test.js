import assert from 'node:assert/strict';
import test from 'node:test';

import { Calc } from '../../js/model/index.js';
import { buildCashFlowTable } from '../../js/model/cash-flow-table.js';
import { DEFAULT_STATE } from '../../js/state/schema.js';
import { formatCashFlowMoney, renderCashFlowTable } from '../../js/ui/renderers/cash-flow-table.js';

test('cash amounts: negatives in parentheses, zero as a dash', () => {
  assert.equal(formatCashFlowMoney(-1234567), '($1.23M)');
  assert.equal(formatCashFlowMoney(2500), '$2.5K');
  assert.equal(formatCashFlowMoney(0), '—');
});

test('the table has a row per year, marks the payback year and labels the final cumulative value as NPV', () => {
  const { economics } = Calc.calculateAll({ ...DEFAULT_STATE, analysisHorizonYears: 40 });
  const table = buildCashFlowTable(economics);
  const html = renderCashFlowTable(table);
  const bodyRows = html.split('<tbody>')[1].match(/<tr\b/g);
  assert.equal(bodyRows.length, 41);
  assert.ok(Number.isInteger(table.paybackYear), 'the 40-year default pays back');
  assert.match(html, new RegExp(`<tr class="cash-flow-payback"><th scope="row" class="cash-flow-year">${table.paybackYear} <span class="cash-flow-tag">payback</span>`));
  assert.equal((html.match(/cash-flow-payback/g) || []).length, 1);
  const npvText = formatCashFlowMoney(economics.npv).replace(/[$()]/g, '\\$&');
  assert.match(html, new RegExp(`<tr class="cash-flow-final">.*<span class="cash-flow-tag">NPV</span> ${npvText}</td>`));
  // Year 0 is the net CAPEX at close, an outflow.
  assert.match(html, new RegExp(`>0</th>.*?${formatCashFlowMoney(-economics.netCapexAtClose).replace(/[$()]/g, '\\$&')}`));
});

test('table text is escaped', () => {
  const html = renderCashFlowTable({
    columns: [{ key: 'year', label: '<img src=x>' }],
    rows: [{ year: 0 }],
    paybackYear: null,
  });
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img src=x&gt;/);
});
