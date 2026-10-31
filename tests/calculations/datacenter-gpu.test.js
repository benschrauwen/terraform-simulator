/*
 * GPU cloud rental (the default datacenter business model): GPU count,
 * occupancy-driven IT draw, revenue golden values with the rental-price
 * decline, fleet replacement and break-even, derived by hand from the
 * data in js/data/datacenter/gpu.js.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { GPU_PLATFORMS, GPU_RENTAL_DEFAULTS } from '../../js/data/datacenter/gpu.js';
import {
  applyDatacenterPresetDefaults,
  calculateDatacenterBreakEven,
  calculateDatacenterScenario,
  DATACENTER_DEFAULT_STATE,
  runDatacenterTornado,
} from '../../js/model/datacenter/index.js';

const close = (a, b, rel = 1e-9) => Math.abs(a - b) <= rel * Math.max(1, Math.abs(a), Math.abs(b));

test('defaults: GPU rental on GB300 NVL72', () => {
  assert.equal(DATACENTER_DEFAULT_STATE.revenueBasis, 'gpu-rental');
  assert.equal(DATACENTER_DEFAULT_STATE.gpuPlatform, 'gb300-nvl72');
  const gb300 = GPU_PLATFORMS['gb300-nvl72'];
  assert.equal(DATACENTER_DEFAULT_STATE.gpuRentalPricePerHour, gb300.rentalPricePerGpuHour);
  // Rated 132 kW per 72-GPU rack x 1.1 for scale-out network and storage.
  assert.equal(gb300.itKWPerGpu, Math.round((132 / 72) * 1.1 * 100) / 100);
  const b200 = applyDatacenterPresetDefaults({ ...DATACENTER_DEFAULT_STATE, gpuPlatform: 'b200' }, 'gpuPlatform');
  assert.equal(b200.gpuRentalPricePerHour, 4.0);
  assert.equal(b200.gpuItKWPerGpu, 1.97); // DGX B200 14.3 kW / 8 x 1.1
  assert.equal(b200.gpuCapexPerGpu, 54000);
});

test('GPU count, IT capex and occupancy-driven IT draw', () => {
  const r = calculateDatacenterScenario({}, { fastMode: true });
  const count = 100000 / 2.02;
  assert.ok(close(r.gpu.count, count));
  assert.ok(close(r.economics.capex.it, count * 76000));
  // 85% rented at 80% of rated power + 15% idle at 20% (LBNL) = 71% of nameplate.
  assert.ok(close(r.load.itLoadFraction, 0.85 * 0.8 + 0.15 * 0.2));
  assert.ok(close(r.load.itLoadMW, 71));
  assert.equal(GPU_RENTAL_DEFAULTS.rentedLoadFraction, 0.8);
  // Occupancy, not itUtilizationPercent, sets the draw in this mode.
  const ignored = calculateDatacenterScenario({ itUtilizationPercent: 30 }, { fastMode: true });
  assert.equal(ignored.load.itLoadMW, r.load.itLoadMW);
});

// integral_a^b 0.85^age d(age) = (0.85^a - 0.85^b) / -ln 0.85 (in years).
const LN = -Math.log(0.85);
const priceIntegral = (a, b) => (Math.pow(0.85, a) - Math.pow(0.85, b)) / LN;

// These goldens used to take each year at the fleet's mid-year age, which
// made revenue jump by a year's decline when first power moved; they now
// integrate the price over the operating time of each year.
test('rental revenue: GPUs x occupancy x price x integral of (1 - decline)^age over operating time', () => {
  const r = calculateDatacenterScenario({});
  const e = r.economics;
  const fullYear = (100000 / 2.02) * 8760 * 0.85 * 5.0; // every hour served
  assert.equal(r.reliability.servedEnergyPercent, 100);
  assert.ok(close(e.revenue.gpuRental, fullYear));
  // Energization at 54 months (t0 = 4.5 yr). Year 5 runs from 4.5 to 5: ages
  // 0 to 0.5; year 6 ages 0.5 to 1.5; year 9 ages 3.5 to 4.5.
  const y = n => e.yearlyCashFlows[n - 1];
  assert.equal(Object.values(y(4).earnedRevenue).reduce((a, b) => a + b, 0), 0);
  assert.ok(close(y(5).earnedRevenue.gpuRental, fullYear * priceIntegral(0, 0.5)));
  assert.ok(close(y(6).earnedRevenue.gpuRental, fullYear * priceIntegral(0.5, 1.5)));
  assert.ok(close(y(9).earnedRevenue.gpuRental, fullYear * priceIntegral(3.5, 4.5)));
  // The first fleet is replaced at exactly 4.5 + 5 = 9.5 yr by the
  // then-current generation: year 10 is the old fleet at ages 4.5-5 for half
  // a year, then the new one at ages 0-0.5 (price reset).
  assert.ok(close(y(10).earnedRevenue.gpuRental, fullYear * (priceIntegral(4.5, 5) + priceIntegral(0, 0.5))));
  assert.ok(close(y(11).earnedRevenue.gpuRental, fullYear * priceIntegral(0.5, 1.5)));
  // The replacement at 9.5 yr is booked half at the end of year 9, half at
  // the end of year 10 (mean booking time 9.5 yr).
  const itIn = n => y(n).replacementItems.filter(item => item.key === 'it').reduce((s, item) => s + item.cost, 0);
  assert.ok(close(itIn(9), 0.5 * e.capex.it));
  assert.ok(close(itIn(10), 0.5 * e.capex.it));
  // The reported price factor is the average over the operating time.
  assert.ok(close(y(5).rentalPriceFactor, priceIntegral(0, 0.5) / 0.5));
});

test('rental revenue golden values for first power at 40.5 months (t0 = 3.375 yr)', () => {
  // 75% of the default 54-month critical path = 40.5 months.
  const r = calculateDatacenterScenario({ scheduleScalePercent: 75 });
  const e = r.economics;
  assert.ok(close(r.schedule.energizationMonth, 40.5));
  const fullYear = (100000 / 2.02) * 8760 * 0.85 * 5.0;
  const y = n => e.yearlyCashFlows[n - 1];
  // Year 4 = (3, 4]: operating from 3.375, 0.625 yr at ages 0-0.625.
  assert.ok(close(y(4).operatingFraction, 0.625));
  assert.ok(close(y(4).earnedRevenue.gpuRental, fullYear * priceIntegral(0, 0.625)));
  // Every other line runs for the same 0.625 yr: opex and fixed O&M pro rata.
  assert.ok(close(y(4).earnedOperatingCost, 0.625 * e.annualOM));
  // Year 9 = (8, 9]: first fleet at ages 4.625-5 until the replacement at
  // 8.375, then the new fleet at ages 0-0.625.
  assert.ok(close(y(9).earnedRevenue.gpuRental, fullYear * (priceIntegral(4.625, 5) + priceIntegral(0, 0.625))));
  // GPUs bought at 3.375 yr: 62.5% booked at the end of year 3, 37.5% at year 4 (the rest of
  // the year's deferred capex is construction spread over the build).
  const initialIt = entry => entry.replacementItems.filter(item => item.key === 'it' && item.initial).reduce((sum, item) => sum + item.cost, 0);
  assert.ok(close(initialIt(y(3)), 0.625 * e.capex.it));
  assert.ok(close(initialIt(y(4)), 0.375 * e.capex.it));
  // Brute-force check of the whole horizon: midpoint rule on a 1/1000-yr grid.
  let numeric = 0;
  const step = 1e-3;
  for (let t = 3.375 + step / 2; t < 20; t += step) {
    const age = (t - 3.375) % 5;
    numeric += Math.pow(0.85, age) * step;
  }
  const modeled = e.yearlyCashFlows.reduce((s, entry) => s + entry.revenue.gpuRental, 0) / fullYear;
  assert.ok(Math.abs(modeled - numeric) < 1e-5, `${modeled} vs ${numeric}`);
});

test('GPU-hours sold over the horizon = GPUs x occupancy x hours actually operating', () => {
  for (const scale of [60, 75, 100, 137]) {
    const r = calculateDatacenterScenario({ scheduleScalePercent: scale }, { fastMode: true });
    const e = r.economics;
    assert.equal(r.reliability.servedEnergyPercent, 100);
    const operatingHours = (20 - r.schedule.energizationMonth / 12) * 8760;
    assert.ok(close(e.totalGpuHoursSold, (100000 / 2.02) * 0.85 * operatingHours, 1e-12));
  }
});

test('GPUs bought at notice-to-proceed age while the site is built', () => {
  const e = calculateDatacenterScenario({ itCapexTiming: 'ntp' }).economics;
  const fullYear = (100000 / 2.02) * 8760 * 0.85 * 5.0;
  // Year 6 = (5, 6]: GPUs bought at close are 5 to 6 years old.
  assert.ok(close(e.yearlyCashFlows[5].earnedRevenue.gpuRental, fullYear * priceIntegral(5, 6)));
});

test('without decline every full year earns the same; unserved hours earn nothing', () => {
  const flat = calculateDatacenterScenario({ gpuPriceDeclinePercentPerYear: 0 }).economics;
  flat.yearlyCashFlows.filter(entry => entry.operatingFraction === 1)
    .forEach(entry => assert.ok(close(entry.earnedRevenue.gpuRental, flat.revenue.gpuRental)));
  // 5 x 10 MW engines islanded: revenue scales with the served share of IT energy.
  const short = calculateDatacenterScenario({ architecture: 'islanded', firmSizingMode: 'manual', firmUnits: 5 }, { fastMode: true });
  const share = short.energy.itServedMWh / short.energy.itDemandMWh;
  assert.ok(share < 1);
  assert.ok(close(short.economics.revenue.gpuRental, (100000 / 2.02) * 8760 * 0.85 * 5.0 * share));
});

test('break-even rental price round trip and tornado inputs', () => {
  const base = calculateDatacenterScenario({}, { fastMode: true });
  const be = calculateDatacenterBreakEven({}, { baseResult: base });
  assert.equal(be.paramKey, 'gpuRentalPricePerHour');
  assert.equal(be.unit, '$/GPU-hour');
  assert.ok(close(be.breakEvenPrice, base.economics.breakEven.breakEvenPrice));
  const atRoot = calculateDatacenterScenario({ gpuRentalPricePerHour: be.breakEvenPrice }, { fastMode: true });
  assert.ok(Math.abs(atRoot.economics.npv) < 1e-6 * base.economics.totalCapex);
  const ids = runDatacenterTornado({}).bars.map(bar => bar.id);
  ['gpuRentalPrice', 'gpuPriceDecline', 'gpuOccupancy', 'gpuCapex', 'schedule'].forEach(id => assert.ok(ids.includes(id), id));
  assert.ok(!ids.includes('utilization'));
});
