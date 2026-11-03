/* Battery capex = MWh x energy $/kWh + MW x power $/kW (MW = MWh / duration), power.js
   BATTERY_COSTS. Hand-derived golden values, the duration effect, the source arithmetic and the
   uptime sizing that must not depend on the cost split. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { BATTERY_COSTS } from '../../js/data/datacenter/power.js';
import { calculateDatacenterScenario, DATACENTER_DEFAULT_STATE } from '../../js/model/datacenter/index.js';

const run = state => calculateDatacenterScenario(state, { fastMode: true });
const batteryItem = r => r.economics.capexItems.find(item => item.key === 'battery');

test('defaults: $250/kWh at 4 h in NREL\'s 2024 energy/power split', () => {
  const scale = 250 / BATTERY_COSTS.nrel2024.fourHourPerKWh;
  assert.ok(Math.abs(BATTERY_COSTS.energyPerKWh - BATTERY_COSTS.nrel2024.energyPerKWh * scale) < 2);
  assert.ok(Math.abs(BATTERY_COSTS.powerPerKW - BATTERY_COSTS.nrel2024.powerPerKW * scale) < 2);
  // NREL's own check: 241 + 372 / 4 = 334 $/kWh at 4 h.
  assert.equal(BATTERY_COSTS.nrel2024.energyPerKWh + BATTERY_COSTS.nrel2024.powerPerKW / 4, 334);
  const fourHour = BATTERY_COSTS.energyPerKWh + BATTERY_COSTS.powerPerKW / 4;
  assert.equal(fourHour, 250);
  // Above the US turnkey price (which leaves out the grid connection), below NREL's 2026 low case.
  assert.ok(fourHour > BATTERY_COSTS.bnef2025UsTurnkeyPerKWh && fourHour < BATTERY_COSTS.nrel2026LowFourHourPerKWh);
  // The global basis keeps the former $150/kWh at 4 h.
  assert.equal(BATTERY_COSTS.globalBasis.energyPerKWh + BATTERY_COSTS.globalBasis.powerPerKW / 4, 150);
  assert.equal(DATACENTER_DEFAULT_STATE.batteryCostPerKWh, 180);
  assert.equal(DATACENTER_DEFAULT_STATE.batteryPowerCostPerKW, 280);
});

test('battery capex golden: 400 MWh / 4 h = 400,000 kWh x $180 + 100,000 kW x $280 = $100M', () => {
  const r = run({ batteryCapacityMWh: 400, batteryDurationHours: 4 });
  const item = batteryItem(r);
  assert.ok(Math.abs(item.capex - 100e6) < 1);
  assert.deepEqual(item.parts.map(part => Math.round(part.capex)), [72e6, 28e6]);
  assert.ok(Math.abs(r.dispatch.battery.costPerKWh - 250) < 1e-9);
  // Fixed O&M is a share of the total.
  const om = r.economics.assets.find(asset => asset.key === 'battery').annualFixedOm;
  assert.ok(Math.abs(om - 100e6 * r.state.batteryOmPercent / 100) < 1e-6);
});

test('a 1-hour battery costs more per kWh than a 4-hour one of the same MWh', () => {
  const perKWh = hours => run({ batteryCapacityMWh: 100, batteryDurationHours: hours }).dispatch.battery.costPerKWh;
  // 180 + 280 / h: 1 h 460, 2 h 320, 4 h 250, 8 h 215.
  [[1, 460], [2, 320], [4, 250], [8, 215]].forEach(([hours, expected]) => {
    assert.ok(Math.abs(perKWh(hours) - expected) < 1e-9, `${hours} h`);
  });
  assert.ok(perKWh(1) > perKWh(4));
  // Same MWh, 4x the power: the power part is 4x, the energy part unchanged.
  const one = batteryItem(run({ batteryCapacityMWh: 100, batteryDurationHours: 1 })).parts;
  const four = batteryItem(run({ batteryCapacityMWh: 100, batteryDurationHours: 4 })).parts;
  assert.ok(Math.abs(one[0].capex - four[0].capex) < 1e-6);
  assert.ok(Math.abs(one[1].capex - 4 * four[1].capex) < 1e-6);
});

test('auto-sized backup stays monotone in battery MWh at 1-hour and 4-hour durations', () => {
  for (const hours of [1, 4]) {
    let previous = Infinity;
    for (let battery = 0; battery <= 400; battery += 25) {
      const n = run({ batteryCapacityMWh: battery, batteryDurationHours: hours }).firm.sizingBasis.minUnits;
      assert.ok(n <= previous, `${hours} h, ${battery} MWh: ${n} > ${previous}`);
      previous = n;
    }
  }
  // The split changes capex only, never the sizing.
  const a = run({ batteryCapacityMWh: 150 });
  const b = run({ batteryCapacityMWh: 150, batteryPowerCostPerKW: 0 });
  assert.equal(a.firm.units, b.firm.units);
  assert.ok(batteryItem(a).capex > batteryItem(b).capex);
});
