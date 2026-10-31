/*
 * "Where the capex goes": the bar and table split the initial capex by item, the groups and
 * shares add up, payment windows read from capexItems and replacements from the booked items.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateDatacenterScenario } from '../../js/model/datacenter/index.js';
import { paidText, renderCapexSplit, replacementsByKey } from '../../js/ui/datacenter/capex-split.js';

test('the capex split covers every item once and its shares add to 100%', () => {
  const r = calculateDatacenterScenario({ architecture: 'hybrid', solarSizeMWdc: 200, batteryCapacityMWh: 400, firmFamily: 'gas' });
  const e = r.economics;
  const html = renderCapexSplit(r);
  const items = e.capexItems.filter(item => item.capex > 0);
  assert.equal((html.match(/class="cs-item"/g) || []).length, items.length);
  assert.equal((html.match(/<rect x="/g) || []).length, items.length); // one bar segment per item
  const widths = [...html.matchAll(/<rect x="[\d.]+" y="0" width="([\d.]+)"/g)].map(match => Number(match[1]));
  assert.ok(Math.abs(widths.reduce((a, b) => a + b, 0) - 100) < 0.01);
  ['GPUs &amp; IT', 'Facility', 'Power', 'Total'].forEach(label => assert.match(html, new RegExp(label)));
  assert.doesNotMatch(html, /NaN|undefined|\sstyle=/);
});

test('payment windows and replacements read from the economics', () => {
  const r = calculateDatacenterScenario({});
  const e = r.economics;
  const item = key => e.capexItems.find(entry => entry.key === key);
  assert.equal(paidText(item('land'), e.energizationYears), 'at notice-to-proceed');
  assert.equal(paidText(item('it'), e.energizationYears), 'at first power (4.5 yr)');
  assert.match(paidText(item('facility'), e.energizationYears), /^over 2\.8–4\.5 yr$/);
  const replacements = replacementsByKey(e);
  // GPU refreshes every 5 years from first power within 20 years: 9.5, 14.5 and 19.5 yr.
  assert.ok(Math.abs(replacements.it - 3 * e.capex.it) < 1);
  assert.ok(Math.abs(Object.values(replacements).reduce((a, b) => a + b, 0) - e.totalReplacementOutflows) < 1);
});
