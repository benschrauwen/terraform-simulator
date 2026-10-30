/* Carbon price on on-site combustion (carbonPricePerTonne) and a battery standing in for spare
   generator units (batteryReplacesSpares, batteryReserveHours). */
import assert from 'node:assert/strict';
import test from 'node:test';

import { CARBON_PRICE_SCHEMES, USD_PER_EUR } from '../../js/data/datacenter/carbon.js';
import { DATACENTER_SENSITIVITY_VARIABLES } from '../../js/data/datacenter/sensitivity-variables.js';
import {
  applyDatacenterPresetDefaults,
  calculateDatacenterScenario,
  DATACENTER_DEFAULT_STATE,
  normalizeDatacenterState,
} from '../../js/model/datacenter/index.js';
import { getBatteryReserve } from '../../js/model/datacenter/scenario.js';
import { DATACENTER_DERIVED_KEYS } from '../../js/state/datacenter-schema.js';

const close = (a, b, rel = 1e-9, abs = 1e-6) => Math.abs(a - b) <= Math.max(abs, rel * Math.max(Math.abs(a), Math.abs(b)));
const ISLANDED = applyDatacenterPresetDefaults({ ...DATACENTER_DEFAULT_STATE, architecture: 'islanded', gasType: 'recip', firmSpareUnits: 2 }, 'gasType');
const carbonLine = r => r.economics.opexLines.find(line => line.key === 'carbonPrice').annual;

/* ---------- Carbon price ---------- */

test('the default carbon price follows the site\'s scheme and travels in share links', () => {
  const price = siteId => normalizeDatacenterState({ siteId }).carbonPricePerTonne;
  // EU ETS: EEX October 2026 average EUR 85.97/t x 1.1202 $/EUR = $96.30/t.
  assert.equal(CARBON_PRICE_SCHEMES['eu-ets'].usdPerTonne, Math.round(85.97 * USD_PER_EUR * 100) / 100);
  ['frankfurt-de', 'lulea-se', 'dublin-ie', 'amsterdam-nl'].forEach(siteId => assert.equal(price(siteId), 96.3, siteId));
  assert.equal(price('kern-ca'), 32.48); // CARB auction Aug 2026
  assert.equal(price('quincy-wa'), 39.5); // Ecology auction Sep 2026
  // No scheme on on-site plants: Texas, Louisiana, Ohio, Arizona, ...; Virginia's RGGI covers
  // only units of 25 MWe and more.
  ['abilene-tx', 'richland-la', 'new-albany-oh', 'phoenix-az', 'reno-nv', 'ashburn-va', 'dona-ana-nm'].forEach(siteId => assert.equal(price(siteId), 0, siteId));
  assert.equal(DATACENTER_DEFAULT_STATE.carbonPricePerTonne, 0);
  assert.ok(DATACENTER_DERIVED_KEYS.includes('carbonPricePerTonne'));
  // A site change resets it; a given value is kept.
  const moved = applyDatacenterPresetDefaults({ ...DATACENTER_DEFAULT_STATE, carbonPricePerTonne: 10, siteId: 'frankfurt-de' }, 'siteId');
  assert.equal(moved.carbonPricePerTonne, 96.3);
  assert.equal(normalizeDatacenterState({ siteId: 'frankfurt-de', carbonPricePerTonne: 10 }).carbonPricePerTonne, 10);
});

test('carbon is charged on on-site combustion CO2 only, as its own opex line', () => {
  // Islanded gas engines: fuel x 52.91 kg/MMBtu x $/t.
  const zero = calculateDatacenterScenario(ISLANDED, { fastMode: true });
  const priced = calculateDatacenterScenario({ ...ISLANDED, carbonPricePerTonne: 50 }, { fastMode: true });
  assert.equal(carbonLine(zero), 0);
  assert.ok(close(carbonLine(priced), priced.dispatch.annual.fuelMMBtu * 52.91 / 1000 * 50));
  assert.ok(close(carbonLine(priced), priced.emissions.gasT * 50));
  assert.ok(priced.economics.npv < zero.economics.npv);
  // Grid design: only the standby diesel (73.96 kg/MMBtu) is charged, not the grid imports.
  const grid = calculateDatacenterScenario({ carbonPricePerTonne: 100 }, { fastMode: true });
  assert.ok(grid.emissions.gridT > 1000 * grid.emissions.gasT);
  assert.ok(close(carbonLine(grid), grid.dispatch.annual.fuelMMBtu * 73.96 / 1000 * 100));
  const base = calculateDatacenterScenario({}, { fastMode: true });
  assert.ok(close(grid.economics.opexLines.find(line => line.key === 'gridEnergy').annual, base.economics.opexLines.find(line => line.key === 'gridEnergy').annual));
  // It shows in the yearly cash flows through the operating cost.
  assert.ok(close(priced.economics.annualOM - zero.economics.annualOM, carbonLine(priced)));
});

test('the carbon price enters the hybrid merit order', () => {
  const hybrid = { ...ISLANDED, architecture: 'hybrid', gridConnection: 'firm' };
  // $4/MMBtu engines: 7.8 x 4 + 7.4 = $38.6/MWh < grid $67.7 -> gas first.
  const cheap = calculateDatacenterScenario(hybrid, { fastMode: true });
  assert.equal(cheap.firm.marginalCostPerMWh, 38.6);
  assert.equal(cheap.dispatch.order, 'firm-first');
  // At $100/t: 7.8 x (4 + 100 x 0.05291) + 7.4 = $79.87/MWh > $67.7 -> grid first.
  const priced = calculateDatacenterScenario({ ...hybrid, carbonPricePerTonne: 100 }, { fastMode: true });
  assert.ok(close(priced.firm.marginalCostPerMWh, 7.8 * (4 + 100 * 0.05291) + 7.4));
  assert.equal(priced.dispatch.order, 'grid-first');
  assert.ok(priced.dispatch.annual.gasMWh < 0.01 * cheap.dispatch.annual.gasMWh);
});

test('the carbon price is a tornado input where gas burns and a price is set', () => {
  const variable = DATACENTER_SENSITIVITY_VARIABLES.find(entry => entry.id === 'carbonPrice');
  assert.equal(variable.stateKey, 'carbonPricePerTonne');
  const priced = { ...ISLANDED, carbonPricePerTonne: 96.3 };
  assert.ok(variable.appliesTo(priced, calculateDatacenterScenario(priced, { fastMode: true })));
  assert.ok(!variable.appliesTo(ISLANDED, calculateDatacenterScenario(ISLANDED, { fastMode: true })));
});

/* ---------- Battery as reserve ---------- */

test('spares replaced: the battery\'s power and reserve energy each cap the count', () => {
  const at = overrides => getBatteryReserve(normalizeDatacenterState({ ...ISLANDED, ...overrides })).units;
  // N+2 of 10 MW engines, 4 h reserve each: 200 MWh / 50 MW covers both (80 MWh held).
  assert.equal(at({ batteryCapacityMWh: 200, batteryDurationHours: 4 }), 2);
  assert.equal(getBatteryReserve(normalizeDatacenterState({ ...ISLANDED, batteryCapacityMWh: 200 })).floorKWh, 80000);
  // 60 MWh / 15 MW: power covers 1, energy 1.
  assert.equal(at({ batteryCapacityMWh: 60, batteryDurationHours: 4 }), 1);
  // 30 MWh at 1 h (30 MW): power covers 3 but 30 MWh < 40 MWh for one unit.
  assert.equal(at({ batteryCapacityMWh: 30, batteryDurationHours: 1 }), 0);
  // 400 MWh at 24 h (16.7 MW): energy covers 10, power 1.
  assert.equal(at({ batteryCapacityMWh: 400, batteryDurationHours: 24 }), 1);
  // Off, manual sizing (no spares to replace), or no battery: none.
  assert.equal(at({ batteryCapacityMWh: 200, batteryReplacesSpares: false }), 0);
  assert.equal(at({ batteryCapacityMWh: 200, firmSizingMode: 'manual' }), 0);
  assert.equal(at({}), 0);
});

test('a battery standing in for spares: fewer engines, the same base, a floor used only to avoid unserved load', () => {
  // Islanded engines + solar + a 4 h battery: shifting solar, with 2 x 4 h x 10 MW = 80 MWh held.
  const state = { ...ISLANDED, solarSizeMWdc: 200, batteryCapacityMWh: 200, batteryDurationHours: 4 };
  const on = calculateDatacenterScenario(state);
  const off = calculateDatacenterScenario({ ...state, batteryReplacesSpares: false });
  assert.equal(on.dispatch.batteryRole, 'shift');
  assert.equal(on.firm.sparesReplacedByBattery, 2);
  assert.equal(on.firm.batteryReserveMWh, 80);
  // The base units are sized without the floor: as with a 120 MWh battery of the same 50 MW.
  const reduced = calculateDatacenterScenario({ ...state, batteryReplacesSpares: false, batteryCapacityMWh: 120, batteryDurationHours: 120 / 50 }, { fastMode: true });
  assert.equal(on.firm.sizingBasis.minUnits, reduced.firm.sizingBasis.minUnits);
  assert.ok(on.firm.sizingBasis.minUnits >= off.firm.sizingBasis.minUnits);
  assert.equal(on.firm.units, on.firm.sizingBasis.minUnits);
  assert.equal(off.firm.units, off.firm.sizingBasis.minUnits + 2);
  assert.ok(on.reliability.meetsTarget);
  assert.ok(on.economics.capex.gas < off.economics.capex.gas);
  // The floor is kept: after every hour the battery holds at least 80 MWh, except after an hour
  // it had to discharge into to avoid unserved load (none here) or could not be topped up.
  const soc = on.dispatch.hourly.batterySocMWh;
  const unserved = on.dispatch.hourly.unservedMW;
  let below = 0;
  for (let h = 1; h < soc.length; h++) if (soc[h] < 80 - 1e-6 && unserved[h] === 0) below += 1;
  assert.ok(below <= 2, `${below} hours below the floor`);
  // Hourly energy balance with the floor.
  const H = on.dispatch.hourly;
  for (let h = 0; h < soc.length; h++) {
    const supply = H.solarMW[h] + H.nuclearMW[h] + H.gridMW[h] + H.gasMW[h] + H.batteryDischargeMW[h] + H.unservedMW[h];
    const uses = H.loadMW[h] + H.batteryChargeMW[h] + H.exportMW[h] + H.curtailedMW[h];
    assert.ok(Math.abs(supply - uses) < 1e-6, `hour ${h}`);
  }
});

test('the hybrid starting design keeps its spare as battery reserve; off restores the engine', () => {
  const start = calculateDatacenterScenario(normalizeDatacenterState({ ...DATACENTER_DEFAULT_STATE, architecture: 'hybrid', gridConnection: 'flexible', solarSizeMWdc: 200, batteryCapacityMWh: 400, gasType: 'recip' }), { fastMode: true });
  const off = calculateDatacenterScenario({ ...start.state, batteryReplacesSpares: false }, { fastMode: true });
  assert.equal(start.firm.sparesReplacedByBattery, 1);
  assert.equal(off.firm.units, start.firm.units + 1);
  assert.ok(start.reliability.meetsTarget && off.reliability.meetsTarget);
});
