/* Construction capex timing (constructionCapexTiming 'spread' vs 'ntp') and the payback metrics
   (project payback from notice-to-proceed and from first power, GPU payback). */
import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateDatacenterScenario, DATACENTER_DEFAULT_STATE } from '../../js/model/datacenter/index.js';
import { getCapexWindowMonths, gpuPayback, splitSpreadAcrossYears } from '../../js/model/datacenter/economics.js';
import { compareArchitectures } from '../../js/model/datacenter/optimizer.js';

const close = (a, b, rel = 1e-9, abs = 1e-6) => Math.abs(a - b) <= Math.max(abs, rel * Math.max(Math.abs(a), Math.abs(b)));
const spread = calculateDatacenterScenario({});
const ntp = calculateDatacenterScenario({ constructionCapexTiming: 'ntp' });

test('a spread payment is booked like a lump at every instant: shares sum to 1, mean time = midpoint', () => {
  for (const [a, b] of [[0, 1], [2.83, 4.5], [3.5, 4.5], [1.25, 1.75], [0, 7.3]]) {
    const shares = splitSpreadAcrossYears(a, b);
    assert.ok(close(shares.reduce((sum, entry) => sum + entry.share, 0), 1));
    assert.ok(close(shares.reduce((sum, entry) => sum + entry.share * entry.year, 0), (a + b) / 2));
  }
  // Within one year [1.25, 1.75]: as a lump at 1.5, half at year 1 and half at year 2.
  assert.deepEqual(splitSpreadAcrossYears(1.25, 1.75).map(entry => entry.year), [1, 2]);
  assert.ok(close(splitSpreadAcrossYears(1.25, 1.75)[0].share, 0.5));
  // A zero-length window is a lump.
  assert.deepEqual(splitSpreadAcrossYears(4.5, 4.5), [{ year: 4, share: 0.5 }, { year: 5, share: 0.5 }]);
});

test('spread vs ntp: same undiscounted capex, all of it paid by first power, a higher NPV', () => {
  const s = spread.economics;
  const n = ntp.economics;
  assert.equal(spread.state.constructionCapexTiming, 'spread');
  assert.ok(close(s.totalCapex, n.totalCapex));
  // Every capex dollar is paid once: at close or in a year's deferred outflow.
  [s, n].forEach(e => {
    const paid = e.capexAtClose + e.yearlyCashFlows.reduce((sum, entry) => sum + entry.deferredCapexOutflow, 0);
    assert.ok(close(paid, e.totalCapex));
  });
  // ntp: everything but the GPUs at close; spread: only the land at close.
  assert.ok(close(n.capexAtClose, n.totalCapex - n.capex.it));
  assert.ok(close(s.capexAtClose, s.capex.land));
  // Every construction item's window ends at first power (4.5 yr): all paid by then. Booked on
  // the year-end grid, the payments fall in years <= ceil(4.5) = 5 with mean time <= 4.5.
  const t0 = s.energizationYears;
  assert.equal(t0, 4.5);
  s.capexItems.filter(item => item.key !== 'land').forEach(item => assert.ok(item.paidToYear <= t0 + 1e-9, `${item.key} paid by ${item.paidToYear}`));
  assert.ok(s.deferredCapex.byYear.every(entry => entry.year <= 5));
  // NPV: later payment is worth more (the default loses money with ntp, earns with spread).
  assert.ok(s.npv >= n.npv);
  assert.ok(n.npv < 0 && s.npv > 0, `${n.npv} / ${s.npv}`);
});

test('spread capex follows each component\'s schedule path (hand-derived at the default)', () => {
  const e = spread.economics;
  const { schedule } = spread;
  const item = key => e.capexItems.find(entry => entry.key === key);
  const path = id => schedule.paths.find(entry => entry.id === id);
  // Firm grid path 12 + 30 + 12 months: the interconnection is paid over its last 12 months
  // (construction only), 42-54 months = years 3.5-4.5.
  assert.deepEqual(path('grid-firm').phases, { permittingMonths: 12, procurementMonths: 30, constructionMonths: 12 });
  assert.deepEqual([item('gridInterconnection').paidFromYear, item('gridInterconnection').paidToYear], [3.5, 4.5]);
  // Every other item: procurement + construction, ending at first power (using its slack).
  const round2 = value => Math.round(value * 100) / 100;
  Object.entries({ facility: 'shell-fitout', cooling: 'cooling', substation: 'substation', gas: 'diesel-standby' }).forEach(([key, id]) => {
    const { procurementMonths, constructionMonths } = path(id).phases;
    assert.ok(path(id).slackMonths >= 0, key);
    assert.equal(item(key).paidToYear, 4.5, key);
    assert.equal(item(key).paidFromYear, round2((54 - procurementMonths - constructionMonths) / 12), key);
  });
  // The yearly cash flows carry it in the right years: the substation (24 + 6 months: years
  // 2-4.5) booked with the year-end weights max(0, 1 - |t - k|) integrated over the window / 2.5:
  // year 2: 0.5 / 2.5, year 3: 1 / 2.5, year 4: (0.5 + 0.375) / 2.5, year 5: 0.125 / 2.5.
  assert.equal(item('substation').paidFromYear, 2);
  const substation = year => e.yearlyCashFlows[year - 1].replacementItems.filter(entry => entry.key === 'substation' && entry.initial).reduce((sum, entry) => sum + entry.cost, 0);
  const total = e.capex.substation;
  const expected = { 1: 0, 2: 0.2, 3: 0.4, 4: 0.35, 5: 0.05, 6: 0 };
  Object.entries(expected).forEach(([year, share]) => assert.ok(close(substation(Number(year)), share * total), `year ${year}`));
  assert.equal(e.yearlyCashFlows[0].deferredCapexOutflow, 0);
});

test('an optional component that finishes after first power is paid until it finishes', () => {
  // On a firm hybrid connection solar is optional and finishes early (positive slack): paid up to
  // first power. A new large reactor is optional too but waits for its earliest COD year
  // (negative slack): paid up to its own finish.
  const r = calculateDatacenterScenario({
    architecture: 'hybrid', gridConnection: 'firm', solarSizeMWdc: 100, firmFamily: 'nuclear', nuclearType: 'large-lwr', firmSizingMode: 'manual', firmUnits: 1,
  });
  const e = r.economics;
  const path = id => r.schedule.paths.find(entry => entry.id === id);
  const item = key => e.capexItems.find(entry => entry.key === key);
  assert.ok(path('solar').slackMonths > 0);
  assert.equal(item('solar').paidToYear, e.energizationYears);
  const reactor = path('nuclear-large-lwr');
  assert.ok(reactor.slackMonths < 0);
  assert.equal(item('nuclear').paidToYear, Math.round(reactor.durationMonths / 12 * 100) / 100);
  // The solar land is land: at close.
  assert.equal(item('solarLand').paidToYear, 0);
  // Payments past the horizon fall in its last year: the capex total is the same as with ntp.
  const late = calculateDatacenterScenario({ architecture: 'hybrid', gridConnection: 'firm', firmFamily: 'nuclear', nuclearType: 'large-lwr', firmSizingMode: 'manual', firmUnits: 1, analysisHorizonYears: 8 }, { fastMode: true }).economics;
  const paid = late.capexAtClose + late.yearlyCashFlows.reduce((sum, entry) => sum + entry.deferredCapexOutflow, 0);
  assert.ok(close(paid, late.totalCapex));
});

test('project payback from start and from first power', () => {
  [spread, ntp].forEach(({ economics: e }) => {
    assert.ok(Number.isFinite(e.paybackYears) && e.paybackYears > e.energizationYears);
    assert.ok(close(e.paybackAfterFirstPowerYears, e.paybackYears - e.energizationYears));
    // The cumulative project cash (salvage excluded) crosses zero at the payback year.
    let cumulative = -e.capexAtClose;
    const year = Math.ceil(e.paybackYears);
    e.yearlyCashFlows.slice(0, year).forEach(entry => { cumulative += entry.netCashFlow - entry.salvageValue; });
    assert.ok(cumulative >= -1e-6);
    assert.ok(cumulative - (e.yearlyCashFlows[year - 1].netCashFlow - e.yearlyCashFlows[year - 1].salvageValue) < 0);
  });
  // Undiscounted, the timing of the build capex does not move the payback (all paid before it).
  assert.ok(close(spread.economics.paybackYears, ntp.economics.paybackYears));
  // Never: payback Infinity, nothing after first power.
  const loss = calculateDatacenterScenario({ gpuRentalPricePerHour: 1 }, { fastMode: true }).economics;
  assert.equal(loss.paybackYears, Infinity);
  assert.equal(loss.paybackAfterFirstPowerYears, null);
});

test('GPU payback golden value at the default (one GB300 GPU)', () => {
  const e = spread.economics;
  // Per GPU: $75,000; revenue 8760 h x 85% x $5.00 (uptime 100%) = $37,230/yr at age 0, falling
  // 15%/yr; cost = 3% IT O&M ($2,250) + energy and water opex / GPUs (~$981) per year.
  const fleet = e.gpuFleet;
  assert.equal(fleet.capexPerGpu, 75000);
  const revenue = 8760 * 0.85 * 5;
  assert.ok(close(e.revenue.gpuRental / fleet.count, revenue));
  const cost = 75000 * 0.03 + e.opexLines.reduce((sum, line) => sum + line.annual, 0) / fleet.count;
  assert.ok(cost > 3200 && cost < 3300, `${cost}`);
  // margin(T) = R (1 - 0.85^T) / -ln 0.85 - c T reaches 75,000 at T:
  const margin = years => revenue * (1 - 0.85 ** years) / -Math.log(0.85) - cost * years;
  const T = e.gpuPaybackYears;
  assert.ok(Math.abs(T - 2.815) < 0.005, `${T}`);
  assert.ok(Math.abs(margin(T) - 75000) < 0.01);
  assert.ok(margin(T - 0.01) < 75000);
  // Without decline it is the simple 75,000 / (37,230 - c).
  const flat = calculateDatacenterScenario({ gpuPriceDeclinePercentPerYear: 0 }, { fastMode: true }).economics;
  assert.ok(close(flat.gpuPaybackYears, 75000 / (revenue - cost), 1e-6));
});

test('GPU payback is null when the GPU never repays itself within its life, or without GPU rental', () => {
  assert.equal(calculateDatacenterScenario({ gpuRentalPricePerHour: 1.5 }, { fastMode: true }).economics.gpuPaybackYears, null);
  assert.equal(gpuPayback({ capexPerGpu: 75000, revenuePerYear: 20000, costPerYear: 3000, decline: 0.15, lifeYears: 5 }), null);
  assert.equal(calculateDatacenterScenario({ revenueBasis: 'tokens' }, { fastMode: true }).economics.gpuPaybackYears, null);
  // The margin can peak and fall as the price declines: the first crossing is the payback.
  assert.ok(close(gpuPayback({ capexPerGpu: 10, revenuePerYear: 10, costPerYear: 0, decline: 0, lifeYears: 5 }), 1, 1e-9));
});

test('the optimizer and architecture comparison still run with spread capex', () => {
  const result = compareArchitectures(DATACENTER_DEFAULT_STATE, { budget: 120 });
  result.rows.forEach(({ architecture, result: row }) => {
    assert.ok(row.best.feasible, architecture);
    const applied = calculateDatacenterScenario({ ...DATACENTER_DEFAULT_STATE, ...row.best.patch }, { fastMode: true });
    assert.equal(applied.economics.npv, row.best.npv);
  });
});
