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
  assert.equal(b200.gpuRentalPricePerHour, 3.7);
  assert.equal(b200.gpuItKWPerGpu, 1.97); // DGX B200 14.3 kW / 8 x 1.1
  assert.equal(b200.gpuCapexPerGpu, 47000);
});

test('GPU count, IT capex and occupancy-driven IT draw', () => {
  const r = calculateDatacenterScenario({}, { fastMode: true });
  const count = 100000 / 2.02;
  assert.ok(close(r.gpu.count, count));
  assert.ok(close(r.economics.capex.it, count * 75000));
  // 85% rented at 80% of rated power + 15% idle at 20% (LBNL) = 71% of nameplate.
  assert.ok(close(r.load.itLoadFraction, 0.85 * 0.8 + 0.15 * 0.2));
  assert.ok(close(r.load.itLoadMW, 71));
  assert.equal(GPU_RENTAL_DEFAULTS.rentedLoadFraction, 0.8);
  // Occupancy, not itUtilizationPercent, sets the draw in this mode.
  const ignored = calculateDatacenterScenario({ itUtilizationPercent: 30 }, { fastMode: true });
  assert.equal(ignored.load.itLoadMW, r.load.itLoadMW);
});

test('rental revenue: GPUs x 8760 x occupancy x price x (1 - decline)^age, from energization', () => {
  const r = calculateDatacenterScenario({});
  const e = r.economics;
  const fullYear = (100000 / 2.02) * 8760 * 0.85 * 5.0; // every hour served
  assert.equal(r.reliability.servedEnergyPercent, 100);
  assert.ok(close(e.revenue.gpuRental, fullYear));
  // Energization at 54 months (t0 = 4.5 yr). Year 5 runs from 4.5 to 5: half
  // a year at mid-age 0.25 yr; year 6 a full year at mid-age 1 yr.
  const y = n => e.yearlyCashFlows[n - 1];
  assert.equal(y(4).totalRevenue, 0);
  assert.ok(close(y(5).revenue.gpuRental, 0.5 * fullYear * Math.pow(0.85, 0.25)));
  assert.ok(close(y(6).revenue.gpuRental, fullYear * 0.85));
  assert.ok(close(y(9).revenue.gpuRental, fullYear * Math.pow(0.85, 4)));
  // The first fleet is replaced 5 years after energization (9.5 -> paid in
  // year 10) by the then-current generation: its age, and the price, reset.
  assert.ok(y(10).replacementItems.some(item => item.key === 'it'));
  assert.ok(close(y(10).revenue.gpuRental, fullYear));
  assert.ok(close(y(11).revenue.gpuRental, fullYear * 0.85));
});

test('GPUs bought at notice-to-proceed age while the site is built', () => {
  const e = calculateDatacenterScenario({ itCapexTiming: 'ntp' }).economics;
  const fullYear = (100000 / 2.02) * 8760 * 0.85 * 5.0;
  assert.ok(close(e.yearlyCashFlows[5].revenue.gpuRental, fullYear * Math.pow(0.85, 5.5)));
});

test('without decline every full year earns the same; unserved hours earn nothing', () => {
  const flat = calculateDatacenterScenario({ gpuPriceDeclinePercentPerYear: 0 }).economics;
  flat.yearlyCashFlows.filter(entry => entry.operatingFraction === 1)
    .forEach(entry => assert.ok(close(entry.revenue.gpuRental, flat.revenue.gpuRental)));
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
