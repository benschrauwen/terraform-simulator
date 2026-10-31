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
