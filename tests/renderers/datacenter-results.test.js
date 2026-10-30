/* Datacenter right column and cash-flow export: what the panels print matches the result. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCashFlowCsv, buildCashFlowTable, calculateDatacenterScenario } from '../../js/model/datacenter/index.js';
import { buildDatacenterCsvHeader, DATACENTER_CASH_FLOW_LABELS } from '../../js/ui/datacenter/cash-flow.js';
import { renderEconomicsGroups, renderKeyMetrics, renderWarnings } from '../../js/ui/datacenter/results.js';
import { formatYearMonth, money } from '../../js/ui/datacenter/format.js';
import { cashFlowTableMethods } from '../../js/ui/renderers/cash-flow-table.js';

const r = calculateDatacenterScenario({ architecture: 'hybrid', solarSizeMWdc: 300, batteryCapacityMWh: 400 });

test('key metrics print the result\'s PUE, uptime, first power, CAPEX and NPV', () => {
  const html = renderKeyMetrics(r);
  assert.match(html, new RegExp(r.cooling.annualPue.toFixed(3).replace('.', '\\.')));
  assert.ok(html.includes(formatYearMonth(r.schedule.energizationDate)));
  assert.ok(html.includes(money(r.economics.totalCapex)));
  assert.ok(html.includes(money(r.economics.npv)));
  assert.match(html, /Uptime achieved/);
  assert.doesNotMatch(html, /\sstyle=/);
});

test('the capital-cost group lists every non-zero capex item and the total equals their sum', () => {
  const html = renderEconomicsGroups(r);
  const items = r.economics.capexItems.filter(item => item.capex > 0);
  items.forEach(item => assert.ok(html.includes(item.label.replace('&', '&amp;')), item.label));
  const sum = items.reduce((total, item) => total + item.capex, 0);
  assert.ok(Math.abs(sum - r.economics.totalCapex) <= 1e-6 * sum, 'capex items sum to total CAPEX');
});

test('warnings are listed, escaped, and absent when there are none', () => {
  assert.equal(renderWarnings([]), '');
  const html = renderWarnings([{ key: 'x', message: 'Unserved <b>88 h</b> & more' }]);
  assert.match(html, /Unserved &lt;b&gt;88 h&lt;\/b&gt; &amp; more/);
});

test('the cash-flow CSV carries datacenter headers and column labels and its NPV matches', () => {
  const app = { cashFlowColumnLabels: DATACENTER_CASH_FLOW_LABELS };
  const table = cashFlowTableMethods.relabelCashFlowTable.call(app, buildCashFlowTable(r.economics));
  const csv = buildCashFlowCsv(table, buildDatacenterCsvHeader(r, 'https://example.test/#s=x'));
  assert.match(csv, /^Abundance Stack datacenter power & cooling,/);
  assert.match(csv, /Revenue \(\$\),O&M and energy \(\$\),Deferred and replacement CAPEX \(\$\)/);
  assert.doesNotMatch(csv, /Product revenue|Terraform/);
  // The final cumulative discounted cash flow is the NPV.
  const lastRow = csv.trim().split('\n').at(-1).split(',');
  assert.ok(Math.abs(Number(lastRow.at(-1)) - r.economics.npv) <= 1e-6 * Math.abs(r.economics.npv));
  // Without overrides (the plant builder) the table is untouched.
  const plain = buildCashFlowTable(r.economics);
  assert.equal(cashFlowTableMethods.relabelCashFlowTable.call({}, plain), plain);
});
