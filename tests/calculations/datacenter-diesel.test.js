/* Standby diesel generators (power.js 'standby-diesel'): fuel data derived from the cited
   datasheets and EIA/EPA factors, CO2 at the diesel factor, last-resort dispatch, and the EPA
   emergency-engine run-hour warning (40 CFR 60.4211(f) / 63.6640(f)). */
import assert from 'node:assert/strict';
import test from 'node:test';

import { DIESEL_DEFAULTS, GAS_GENSET_TYPES, getGensetFuel } from '../../js/data/datacenter/power.js';
import { calculateDatacenterScenario, DATACENTER_DEFAULT_STATE } from '../../js/model/datacenter/index.js';

const diesel = GAS_GENSET_TYPES['standby-diesel'];
const run = (state, options = { fastMode: true }) => calculateDatacenterScenario(state, options);
const warningKeys = r => r.warnings.map(warning => warning.key);

test('diesel data: heat rates from the datasheets, the price from EIA, the CO2 factor from 40 CFR 98', () => {
  // Datasheet fuel at 100% standby load x 0.138 MMBtu/gal / rating.
  const cat3516c = (175.3 * 0.138) / 2.5; // 9.68
  const mtuDs3000 = (207 * 0.138) / 3.0; // 9.52
  const qsk95 = ((725 / 3.785411784) * 0.138) / 2.8; // 9.44
  assert.ok(Math.abs(diesel.heatRateMMBtuPerMWh.high - cat3516c) < 0.005);
  assert.ok(Math.abs(diesel.heatRateMMBtuPerMWh.low - qsk95) < 0.005);
  assert.ok(Math.abs(diesel.heatRateMMBtuPerMWh.default - (cat3516c + mtuDs3000 + qsk95) / 3) < 0.01);
  // Default price: STEO 2026 retail $5.19/gal less 59.9 c/gal road taxes, per 0.138 MMBtu.
  const perMMBtu = (5.19 - 0.244 - 0.355) / 0.138;
  assert.ok(Math.abs(DIESEL_DEFAULTS.fuelPricePerMMBtu - perMMBtu) < 0.5, `${perMMBtu}`);
  assert.equal(DIESEL_DEFAULTS.co2KgPerMMBtu, 73.96);
  assert.equal(getGensetFuel(diesel), DIESEL_DEFAULTS);
  assert.equal(getGensetFuel(GAS_GENSET_TYPES.recip).co2KgPerMMBtu, 52.91);
  // Default state: standby diesel at the diesel price.
  assert.equal(DATACENTER_DEFAULT_STATE.gasType, 'standby-diesel');
  assert.equal(DATACENTER_DEFAULT_STATE.gasFuelPricePerMMBtu, DIESEL_DEFAULTS.fuelPricePerMMBtu);
});

test('diesel CO2 = fuel MMBtu x 73.96 kg, plus grid imports x grid intensity', () => {
  for (const overrides of [{}, { gridConnection: 'flexible' }, { architecture: 'islanded', gasType: 'standby-diesel' }]) {
    const r = run(overrides);
    const a = r.dispatch.annual;
    assert.ok(a.fuelMMBtu > 0, 'diesel burns fuel');
    assert.ok(Math.abs(r.emissions.gasT - (a.fuelMMBtu * 73.96) / 1000) < 1e-9 * Math.max(1, r.emissions.gasT));
    assert.ok(Math.abs(r.emissions.totalT - (a.fuelMMBtu * 73.96 + a.gridMWh * r.state.gridCo2KgPerMWh) / 1000) < 1e-6);
    assert.equal(r.emissions.gasCo2KgPerMMBtu, 73.96);
    // Fuel at least the full-load heat rate per MWh generated.
    assert.ok(a.fuelMMBtu >= a.gasMWh * r.state.gasHeatRateMMBtuPerMWh - 1e-6);
    // The fuel bill is at the diesel price.
    const line = r.economics.opexLines.find(entry => entry.key === 'gasFuel');
    assert.equal(line.label, 'Diesel fuel');
    assert.ok(Math.abs(line.annual - a.fuelMMBtu * r.state.gasFuelPricePerMMBtu) < 1e-6);
  }
});

test('standby diesel is never dispatched on cost against an available grid', () => {
  // Even at a zero fuel price and VOM (marginal cost $0 < grid) the hybrid keeps the grid first,
  // so the diesel runs only in hours the grid is out (utility outages, curtailments).
  const r = run({ architecture: 'hybrid', gridConnection: 'flexible', gasFuelPricePerMMBtu: 0, gasVariableOmPerMWh: 0 });
  assert.equal(r.firm.marginalCostPerMWh, 0);
  assert.equal(r.dispatch.order, 'grid-first');
  assert.ok(r.dispatch.annual.gasRunHours <= r.grid.unavailableHours);
  // An engine type at the same costs would run first.
  const engines = run({ architecture: 'hybrid', gridConnection: 'flexible', gasType: 'recip', gasFuelPricePerMMBtu: 0, gasVariableOmPerMWh: 0 });
  assert.equal(engines.dispatch.order, 'firm-first');
});

test('EPA emergency-engine limit: the warning fires when non-emergency run hours exceed it', () => {
  // Default grid: diesel runs only through the 3 utility-outage hours (emergency use).
  const grid = run({});
  assert.equal(grid.firm.emergencyEngine.emergencyRunHours, 3);
  assert.equal(grid.firm.emergencyEngine.nonEmergencyRunHours, 0);
  assert.ok(!warningKeys(grid).includes('standby-run-hours'));
  // Flexible connection without a battery: diesel carries every curtailment hour. 40 h of
  // curtailment + 20 h assumed testing = 60 h <= 100 and 40 <= 50: allowed. 60 h: over the 50 h
  // non-emergency allowance.
  const within = run({ gridConnection: 'flexible', gridUnavailableHoursPerYear: 40 });
  assert.equal(within.firm.emergencyEngine.nonEmergencyRunHours, 40);
  assert.ok(!warningKeys(within).includes('standby-run-hours'));
  const over = run({ gridConnection: 'flexible', gridUnavailableHoursPerYear: 60 });
  assert.equal(over.firm.emergencyEngine.nonEmergencyRunHours, 60);
  assert.ok(warningKeys(over).includes('standby-run-hours'));
  // Islanded diesel is prime power: every hour is non-emergency.
  const islanded = run({ architecture: 'islanded', gasType: 'standby-diesel' });
  assert.equal(islanded.firm.emergencyEngine.nonEmergencyRunHours, 8760);
  assert.ok(warningKeys(islanded).includes('standby-run-hours'));
  // Gas engines are not emergency engines: no such limit.
  const engines = run({ architecture: 'islanded', gasType: 'recip' });
  assert.equal(engines.firm.emergencyEngine, null);
  assert.ok(!warningKeys(engines).includes('standby-run-hours'));
});
