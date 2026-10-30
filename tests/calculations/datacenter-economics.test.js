/*
 * Datacenter economics, state and sensitivity: finance identities, scale
 * homogeneity, schedule timing, break-even round trip, normalization.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyDatacenterPresetDefaults,
  buildCashFlowTable,
  calculateDatacenterBreakEven,
  calculateDatacenterScenario,
  DATACENTER_DEFAULT_STATE,
  DATACENTER_DERIVED_KEYS,
  getDatacenterFieldRange,
  normalizeDatacenterState,
  runDatacenterTornado,
} from '../../js/model/datacenter/index.js';
import { DATACENTER_SENSITIVITY_VARIABLES } from '../../js/data/datacenter/sensitivity-variables.js';
import { npvAtRate } from '../../js/model/finance.js';

const close = (a, b, rel = 1e-9, abs = 1e-6) => Math.abs(a - b) <= Math.max(abs, rel * Math.max(Math.abs(a), Math.abs(b)));

const SCENARIOS = {
  default: {},
  tokens: { revenueBasis: 'tokens' },
  colocation: { revenueBasis: 'colocation' },
  hybrid: { architecture: 'hybrid', solarSizeMWdc: 200, batteryCapacityMWh: 400 },
  financed: { financingEnabled: true },
  islandedGas: { architecture: 'islanded' },
  itAtNtp: { itCapexTiming: 'ntp' },
  constructionAtNtp: { constructionCapexTiming: 'ntp' },
};

for (const [name, overrides] of Object.entries(SCENARIOS)) {
  test(`${name}: last cumulative discounted cash flow = NPV = PV of the cash-flow series`, () => {
    const e = calculateDatacenterScenario(overrides).economics;
    const table = buildCashFlowTable(e);
    assert.ok(close(table.rows.at(-1).cumulativeDiscountedCashFlow, e.npv));
    const series = [-e.netCapexAtClose, ...e.yearlyCashFlows.map(entry => entry.netCashFlow)];
    assert.ok(close(npvAtRate(series, e.discountRatePercent / 100), e.npv));
    // Levelized profit is the NPV annuity.
    assert.ok(close(e.levelizedAnnualProfit, e.npv * e.horizonCrf));
    // The timeline starts from the same close outlay.
    assert.ok(close(e.cashFlowTimeline.projectCashFlow[0], -e.netCapexAtClose));
    // All capex is paid once: at close, or (deferred IT) in its year.
    const paid = e.netCapexAtClose + e.yearlyCashFlows.reduce((s, entry) => s + entry.deferredCapexOutflow, 0);
    assert.ok(close(paid, e.totalCapex));
    assert.ok(close(e.capexItems.reduce((s, item) => s + item.capex, 0), e.totalCapex));
  });
}

test('operations and revenue start at energization; capex at notice-to-proceed (ntp timing)', () => {
  // Token revenue has no price decline, so year 5 is exactly half a year.
  const r = calculateDatacenterScenario({ revenueBasis: 'tokens', constructionCapexTiming: 'ntp' });
  const e = r.economics;
  // 54 months to first power: years 1-4 earn nothing, year 5 half, year 6 on full.
  assert.equal(r.schedule.energizationMonth, 54);
  assert.deepEqual(e.yearlyCashFlows.slice(0, 6).map(entry => entry.operatingFraction), [0, 0, 0, 0, 0.5, 1]);
  e.yearlyCashFlows.slice(0, 4).forEach(entry => {
    assert.equal(entry.totalRevenue, 0);
    assert.equal(entry.operatingCashFlow, 0);
  });
  assert.ok(close(e.yearlyCashFlows[4].totalRevenue, 0.5 * e.totalAnnualRevenue));
  // IT hardware bought for first power at 4.5 yr: booked half at the end of
  // year 4, half at the end of year 5 (mean booking time = 4.5 yr; it used
  // to be paid wholly in year floor(t0), a step when t0 crossed a year).
  assert.equal(e.deferredCapex.atYears, 4.5);
  assert.ok(close(e.yearlyCashFlows[3].deferredCapexOutflow, 0.5 * e.capex.it));
  assert.ok(close(e.yearlyCashFlows[4].deferredCapexOutflow, 0.5 * e.capex.it));
  // First IT replacement 5 years after energization: 4.5 + 5 = 9.5, split
  // between the ends of years 9 and 10.
  [8, 9].forEach(i => assert.ok(e.yearlyCashFlows[i].replacementItems.some(item => item.key === 'it' && item.scheduledAtYear === 9.5)));
});

/* NPV vs first-power date: sweep scheduleScalePercent 50-150% in 0.25%
   steps (~0.14 months of the 54-month default path each). A lump that
   jumped a year-end, or a rental-price step, used to move NPV by hundreds
   of $M between neighbouring steps. */
function scheduleSweep(overrides) {
  const points = [];
  for (let scale = 50; scale <= 150; scale += 0.25) {
    const r = calculateDatacenterScenario({ ...overrides, scheduleScalePercent: scale }, { fastMode: true });
    points.push({ scale, npv: r.economics.npv, capex: r.economics.totalCapex });
  }
  return points;
}

test('NPV is continuous in the first-power date (no jumps between neighbouring schedules)', () => {
  for (const overrides of [{}, { gpuRentalPricePerHour: 6 }, { itCapexTiming: 'ntp' }, { revenueBasis: 'tokens' }, { revenueBasis: 'colocation' }]) {
    const points = scheduleSweep(overrides);
    for (let i = 1; i < points.length; i++) {
      const step = Math.abs(points[i].npv - points[i - 1].npv);
      // A smooth NPV moves at most ~(r x capex + annual cash) x dt per step;
      // 0.5% of capex per 0.14 months is far above that and far below a jump.
      assert.ok(step < 0.005 * points[i].capex, `${JSON.stringify(overrides)} ${points[i].scale}%: step ${step}`);
    }
  }
});

test('NPV falls monotonically with a later first power for a profitable design, rises for a loss-making one', () => {
  const profitable = scheduleSweep({ gpuRentalPricePerHour: 6 });
  assert.ok(profitable[0].npv > 0 && profitable.at(-1).npv > 0);
  for (let i = 1; i < profitable.length; i++) assert.ok(profitable[i].npv <= profitable[i - 1].npv, `${profitable[i].scale}%`);
  const tokens = scheduleSweep({ revenueBasis: 'tokens', tokenPricePerM: 0.6 });
  for (let i = 1; i < tokens.length; i++) assert.ok(tokens[i].npv <= tokens[i - 1].npv, `tokens ${tokens[i].scale}%`);
  // At $3/GPU-hour every GPU fleet loses money (rent < its capex + opex), so
  // a later start (GPUs bought later, fewer fleets in the horizon) loses
  // less. (Near break-even, e.g. $4, the slope is ~0 and the annual
  // end-of-year grid leaves sub-$0.1M wiggles, so no sign is asserted there.)
  const lossMaking = scheduleSweep({ gpuRentalPricePerHour: 3 });
  assert.ok(lossMaking[0].npv < 0);
  for (let i = 1; i < lossMaking.length; i++) assert.ok(lossMaking[i].npv >= lossMaking[i - 1].npv, `loss ${lossMaking[i].scale}%`);
});

test('a longer schedule delays revenue and lowers NPV (profitable design)', () => {
  // Token revenue: this test predates GPU rental becoming the default basis.
  const base = { revenueBasis: 'tokens', tokenPricePerM: 0.6 };
  const onTime = calculateDatacenterScenario(base, { fastMode: true });
  const late = calculateDatacenterScenario({ ...base, scheduleScalePercent: 150 }, { fastMode: true });
  assert.ok(onTime.economics.npv > 0);
  assert.ok(late.schedule.energizationMonth > onTime.schedule.energizationMonth);
  assert.ok(late.economics.npv < onTime.economics.npv);
  // Same plant, same dispatch: only timing differs.
  assert.equal(late.economics.totalAnnualRevenue, onTime.economics.totalAnnualRevenue);
  assert.equal(late.economics.totalCapex, onTime.economics.totalCapex);
});

test('scale homogeneity: 2x IT and 2x every capacity -> 2x capex, revenue and NPV, same IRR', () => {
  const one = {
    architecture: 'hybrid', solarSizeMWdc: 200, batteryCapacityMWh: 400, firmSizingMode: 'manual', firmUnits: 15, gasUnitSizeMW: 10,
    tokenPricePerM: 0.5,
  };
  // Doubling the unit size (not the count) keeps the part-load heat rate identical.
  const two = { ...one, itCapacityMW: 200, solarSizeMWdc: 400, batteryCapacityMWh: 800, gasUnitSizeMW: 20 };
  const a = calculateDatacenterScenario(one, { fastMode: true }).economics;
  const b = calculateDatacenterScenario(two, { fastMode: true }).economics;
  assert.ok(close(b.totalCapex, 2 * a.totalCapex, 1e-9));
  assert.ok(close(b.totalAnnualRevenue, 2 * a.totalAnnualRevenue, 1e-9));
  assert.ok(close(b.annualOM, 2 * a.annualOM, 1e-9));
  assert.ok(close(b.npv, 2 * a.npv, 1e-9));
  assert.ok(Number.isFinite(a.irr));
  assert.ok(Math.abs(b.irr - a.irr) < 1e-6);
});

test('break-even revenue price: two runs agree with the analytic root, and NPV is 0 there', () => {
  for (const overrides of [{}, SCENARIOS.tokens, { revenueBasis: 'colocation' }, SCENARIOS.hybrid]) {
    const base = calculateDatacenterScenario(overrides, { fastMode: true });
    const twoRun = calculateDatacenterBreakEven(overrides, { baseResult: base });
    assert.ok(close(twoRun.breakEvenPrice, base.economics.breakEven.breakEvenPrice, 1e-9));
    const atRoot = calculateDatacenterScenario({ ...overrides, [twoRun.paramKey]: twoRun.breakEvenPrice }, { fastMode: true });
    assert.ok(Math.abs(atRoot.economics.npv) < 1e-6 * base.economics.totalCapex, `NPV at root ${atRoot.economics.npv}`);
  }
});

test('colocation excludes IT capex and passes energy costs through to the tenant', () => {
  const tokens = calculateDatacenterScenario({ revenueBasis: 'tokens' }, { fastMode: true }).economics;
  const colo = calculateDatacenterScenario({ revenueBasis: 'colocation' }, { fastMode: true }).economics;
  assert.ok(!colo.capexItems.some(item => item.key === 'it'));
  assert.ok(close(tokens.totalCapex - colo.totalCapex, tokens.capex.it));
  // $175/kW-month x 100,000 kW x 12, every hour served.
  assert.ok(close(colo.revenue.colocation, 175 * 100000 * 12));
  const energyOpex = colo.opexLines.filter(line => line.energy).reduce((s, line) => s + line.annual, 0);
  assert.ok(close(colo.revenue.powerPassThrough, energyOpex));
});

test('opex lines follow the dispatch: grid energy, demand charges, fuel', () => {
  const r = calculateDatacenterScenario({ architecture: 'hybrid', gridDemandChargePerKWMonth: 12, gridEnergyPricePerMWh: 75, gridConnection: 'flexible' }, { fastMode: true });
  const line = key => r.economics.opexLines.find(entry => entry.key === key).annual;
  assert.ok(close(line('gridEnergy'), r.dispatch.annual.gridMWh * 75));
  assert.ok(close(line('gridDemand'), r.dispatch.annual.monthlyPeakGridMW.reduce((s, mw) => s + mw * 1000, 0) * 12));
  assert.ok(close(line('gasFuel'), r.dispatch.annual.fuelMMBtu * r.state.gasFuelPricePerMMBtu));
  assert.ok(r.dispatch.annual.fuelMMBtu > 0);
});

test('normalization: unknown keys dropped, values clamped, enums and booleans checked', () => {
  const s = normalizeDatacenterState({ foo: 1, itCapacityMW: -5, architecture: 'mars', gridExportEnabled: 'yes', firmUnits: 3.6 });
  assert.equal('foo' in s, false);
  assert.equal(s.itCapacityMW, 0.1);
  assert.equal(s.architecture, 'grid');
  assert.equal(s.gridExportEnabled, false);
  assert.equal(s.firmUnits, 4);
  assert.deepEqual(Object.keys(normalizeDatacenterState({})).sort(), Object.keys(DATACENTER_DEFAULT_STATE).sort());
  assert.ok(Object.isFrozen(DATACENTER_DEFAULT_STATE));
});

test('preset-derived defaults follow their selection unless given', () => {
  const phoenix = normalizeDatacenterState({ siteId: 'phoenix-az' });
  assert.equal(phoenix.gridEnergyPricePerMWh, 79.4); // EIA AZ YTD 7.94 c/kWh
  assert.equal(phoenix.gridCo2KgPerMWh, 319.2);
  assert.equal(normalizeDatacenterState({ siteId: 'phoenix-az', gridEnergyPricePerMWh: 50 }).gridEnergyPricePerMWh, 50);
  const diesel = applyDatacenterPresetDefaults({ ...DATACENTER_DEFAULT_STATE, gasCapexPerKW: 999, gasFuelPricePerMMBtu: 6 }, 'gasType');
  assert.equal(diesel.gasCapexPerKW, 1000); // standby-diesel default restored
  // The fuel price follows the type's fuel (was a plain field before diesel was added).
  assert.equal(diesel.gasFuelPricePerMMBtu, 33);
  // (Gas engines and turbines are hybrid or islanded generation.)
  assert.equal(normalizeDatacenterState({ architecture: 'hybrid', gasType: 'recip' }).gasFuelPricePerMMBtu, 4);
  assert.equal(normalizeDatacenterState({ architecture: 'hybrid', gasType: 'recip', gasFuelPricePerMMBtu: 6 }).gasFuelPricePerMMBtu, 6);
  const switched = applyDatacenterPresetDefaults({ ...DATACENTER_DEFAULT_STATE, architecture: 'hybrid', gasType: 'aero' }, 'gasType');
  assert.equal(switched.gasCapexPerKW, 2275);
  assert.equal(switched.gasUnitSizeMW, 50);
  DATACENTER_DERIVED_KEYS.forEach(key => assert.ok(Number.isFinite(DATACENTER_DEFAULT_STATE[key]), key));
});

test('tornado variables resolve to numeric fields and the runner returns sorted bars', () => {
  DATACENTER_SENSITIVITY_VARIABLES.forEach(variable => {
    assert.ok(getDatacenterFieldRange(variable.stateKey), `${variable.id}: ${variable.stateKey} is not a numeric field`);
  });
  const tornado = runDatacenterTornado({ architecture: 'hybrid', solarSizeMWdc: 200, batteryCapacityMWh: 400 });
  assert.ok(tornado.bars.length >= 10);
  tornado.bars.forEach((bar, i) => {
    if (i) assert.ok(bar.swing <= tornado.bars[i - 1].swing);
    // Integer fields (asset life, outage hours) take the swung value rounded to a whole number.
    assert.ok(close(bar.lowValue, bar.baseValue * 0.8) || Math.abs(bar.lowValue - bar.baseValue * 0.8) <= 0.5, bar.id);
  });
  assert.ok(tornado.bars.some(bar => bar.id === 'schedule'));
  // Fast-path NPV = full-run NPV.
  const full = calculateDatacenterScenario({ architecture: 'hybrid', solarSizeMWdc: 200, batteryCapacityMWh: 400 });
  assert.ok(close(tornado.baseNpv, full.economics.npv));
});
