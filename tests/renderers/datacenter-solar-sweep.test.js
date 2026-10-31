/*
 * Hidden price sweeps: solar is priced as panel + BOS and the battery as a 4-hour $/kWh (energy +
 * power), each with its split kept; each point is the best design across architectures at both
 * prices; both sweeps chart one matching line per site, and share points they have in common.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DATACENTER_SITES } from '../../js/data/datacenter/sites.js';
import { BATTERY_SWEEP_PRICES_PER_KWH, DATACENTER_DEFAULT_STATE, priceSweepPoint, SOLAR_SWEEP_PRICES_PER_W } from '../../js/model/datacenter/index.js';
import { batteryPricePerKWh, withBatteryPrice, withSolarPrice } from '../../js/model/datacenter/site-survey.js';
import { buildSweepDatasets, describePoint, excessGWh, heldPriceOptions, listSweepPoints, pointKey } from '../../js/ui/datacenter/solar-sweep-page.js';

test('solar and battery prices are set as totals, keeping their splits', () => {
  const base = DATACENTER_DEFAULT_STATE;
  const solarShare = base.panelCostPerW / (base.panelCostPerW + base.bosCostPerW);
  const solar = withSolarPrice(base, 0.4);
  assert.ok(Math.abs(solar.panelCostPerW + solar.bosCostPerW - 0.4) < 1e-12);
  assert.ok(Math.abs(solar.panelCostPerW / 0.4 - solarShare) < 1e-12);
  // US 2026 default: $222/kWh + $343/kW / 4 h = ~$308/kWh.
  assert.ok(Math.abs(batteryPricePerKWh(base) - (222 + 343 / 4)) < 1e-9);
  const battery = withBatteryPrice(base, 150);
  assert.ok(Math.abs(batteryPricePerKWh(battery) - 150) < 1e-9);
  assert.ok(Math.abs(battery.batteryCostPerKWh / battery.batteryPowerCostPerKW - base.batteryCostPerKWh / base.batteryPowerCostPerKW) < 1e-12);
});

test('cheaper solar or batteries never lower the best NPV; the point reports its prices and design', () => {
  const at = (solar, battery) => priceSweepPoint(DATACENTER_DEFAULT_STATE, { kind: 'site', id: 'abilene-tx', solarPricePerW: solar, batteryPricePerKWh: battery }, { budget: 300 });
  const cheapSolar = at(0.2, 308);
  const dearSolar = at(1.2, 308);
  assert.ok(cheapSolar.npv >= dearSolar.npv - 1e-6 * Math.abs(dearSolar.npv));
  assert.ok(cheapSolar.solarMWdc >= dearSolar.solarMWdc);
  const cheapBattery = at(0.7, 75);
  const dearBattery = at(0.7, 400);
  assert.ok(cheapBattery.npv >= dearBattery.npv - 1e-6 * Math.abs(dearBattery.npv));
  assert.ok(cheapBattery.batteryMWh >= dearBattery.batteryMWh);
  assert.ok(Math.abs(cheapBattery.batteryPricePerKWh - 75) < 1e-9 && Math.abs(cheapBattery.solarPricePerW - 0.7) < 1e-9);
  assert.ok(cheapSolar.co2eT > 0 && cheapSolar.feasible);
  // Excess electricity = curtailed + exported, from the point's dispatch; more solar never leaves less.
  assert.ok(cheapSolar.curtailedMWh >= 0 && cheapSolar.exportMWh >= 0);
  assert.ok(excessGWh(cheapSolar) >= excessGWh(dearSolar) - 1e-9);
  assert.equal(excessGWh({ curtailedMWh: 1500, exportMWh: 500 }), 2);
  assert.match(describePoint(cheapSolar), /solar/);
});

test('both sweeps cover every site at every price, with matching lines, and share common points', () => {
  const solar = listSweepPoints('solar', 308);
  const battery = listSweepPoints('battery', 0.69);
  assert.equal(solar.length, DATACENTER_SITES.length * SOLAR_SWEEP_PRICES_PER_W.length);
  assert.equal(battery.length, DATACENTER_SITES.length * BATTERY_SWEEP_PRICES_PER_KWH.length);
  assert.equal(new Set(solar.map(pointKey)).size, solar.length);
  // A solar point at $0.30/W with the battery at $300/kWh is the battery point at $300 with solar at $0.30.
  const shared = listSweepPoints('battery', 0.3).map(pointKey);
  assert.ok(listSweepPoints('solar', 300).map(pointKey).some(key => shared.includes(key)));
  const results = Object.fromEntries([...solar, ...battery].map(point => [pointKey(point), { ...point, npv: 1, co2eT: 2 }]));
  const solarSets = buildSweepDatasets(results, 'solar', 308, result => result.npv);
  const batterySets = buildSweepDatasets(results, 'battery', 0.69, result => result.co2eT);
  assert.equal(solarSets.length, DATACENTER_SITES.length);
  assert.deepEqual(solarSets.map(set => set.borderColor), batterySets.map(set => set.borderColor));
  solarSets.forEach(set => assert.deepEqual(set.data.map(point => point.x), [...SOLAR_SWEEP_PRICES_PER_W]));
  batterySets.forEach(set => assert.deepEqual(set.data.map(point => point.x), [...BATTERY_SWEEP_PRICES_PER_KWH]));
  // The held-price options start with the settings' own price.
  const options = heldPriceOptions('solar', 307.75);
  assert.equal(options[0].value, 307.75);
  assert.match(options[0].label, /your setting/);
});

test('the 2D grid covers every solar x battery price for one site, sharing the sweeps\' points', async () => {
  const { listGridPoints } = await import('../../js/ui/datacenter/solar-sweep-page.js');
  const grid = listGridPoints('phoenix-az');
  assert.equal(grid.length, SOLAR_SWEEP_PRICES_PER_W.length * BATTERY_SWEEP_PRICES_PER_KWH.length);
  assert.ok(grid.every(point => point.id === 'phoenix-az'));
  // The solar sweep with the battery held at a grid price is one row of the grid.
  const row = new Set(listSweepPoints('solar', 150).filter(point => point.id === 'phoenix-az').map(pointKey));
  assert.equal(grid.filter(point => row.has(pointKey(point))).length, SOLAR_SWEEP_PRICES_PER_W.length);
});

test('the heatmap draws one cell per price pair, coloured on the scale, pending cells grey', async () => {
  const { renderHeatmapSvg, scaleColor } = await import('../../js/ui/datacenter/sweep-heatmap.js');
  const xs = [0.2, 0.5, 1.0];
  const ys = [100, 300];
  const value = result => result.v;
  const html = renderHeatmapSvg({
    xs, ys, value, format: v => String(v), xLabel: String, yLabel: String, xTitle: 'Solar', yTitle: 'Battery', better: 'low',
    cell: (x, y) => (x === 1.0 && y === 300 ? null : { v: x * y }), describe: () => 'design',
  });
  assert.equal((html.match(/class="hm-cell"/g) || []).length, 5);
  assert.equal((html.match(/class="hm-pending"/g) || []).length, 1);
  // 'low' is better: the lowest value (0.2 x 100 = 20) gets the bright end of the scale.
  const low = html.match(/data-x="0.2" data-y="100"><rect[^>]*fill="([^"]+)"/)[1];
  assert.equal(low, scaleColor(1).fill);
  assert.doesNotMatch(html, /NaN|undefined|\sstyle=/);
  assert.equal(scaleColor(0).text, '#eef2f6');
});

test('a grid cell rebuilds the simulator state: site, both prices and the optimized design', async () => {
  const { sweepPointState, batteryPricePerKWh: batteryPrice, solarPricePerW: solarPrice } = await import('../../js/model/datacenter/site-survey.js');
  const { calculateDatacenterScenario } = await import('../../js/model/datacenter/index.js');
  const point = { kind: 'site', id: 'phoenix-az', solarPricePerW: 0.3, batteryPricePerKWh: 125 };
  const result = priceSweepPoint(DATACENTER_DEFAULT_STATE, point, { budget: 300 });
  const state = sweepPointState(DATACENTER_DEFAULT_STATE, { ...point, patch: result.patch });
  assert.equal(state.siteId, 'phoenix-az');
  assert.ok(Math.abs(solarPrice(state) - 0.3) < 1e-9 && Math.abs(batteryPrice(state) - 125) < 1e-9);
  assert.equal(state.architecture, result.architecture);
  assert.equal(state.solarSizeMWdc, result.solarMWdc);
  // The rebuilt state is the point's design: same NPV.
  assert.ok(Math.abs(calculateDatacenterScenario(state, { fastMode: true }).economics.npv - result.npv) < 1);
  const { renderHeatmapSvg } = await import('../../js/ui/datacenter/sweep-heatmap.js');
  const html = renderHeatmapSvg({ xs: [0.3], ys: [125], cell: () => result, value: r => r.npv, format: String, xLabel: String, yLabel: String, xTitle: '', yTitle: '', link: () => 'datacenter.html#s=abc' });
  assert.match(html, /<g class="hm-cell hm-link"[^>]* data-href="datacenter\.html#s=abc" role="link" tabindex="0"/);
  // The page navigates on click and on Enter, through the cell's data-href.
  const { bindHeatmapLinks } = await import('../../js/ui/datacenter/sweep-heatmap.js');
  const listeners = {};
  const cellEl = { getAttribute: () => 'datacenter.html#s=abc' };
  const container = { addEventListener: (type, fn) => { listeners[type] = fn; }, contains: () => true };
  const visited = [];
  bindHeatmapLinks(container, href => visited.push(href));
  listeners.click({ type: 'click', target: { closest: () => cellEl }, preventDefault() {} });
  listeners.keydown({ type: 'keydown', key: 'Tab', target: { closest: () => cellEl }, preventDefault() {} });
  listeners.keydown({ type: 'keydown', key: 'Enter', target: { closest: () => cellEl }, preventDefault() {} });
  assert.deepEqual(visited, ['datacenter.html#s=abc', 'datacenter.html#s=abc']);
});
