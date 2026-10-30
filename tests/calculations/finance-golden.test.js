/*
 * Finance primitives and identities against hand-derived golden values.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  analyzeIRR,
  approximateIRR,
  buildDebtSchedule,
  calculateMIRR,
  crf,
} from '../../js/model/finance.js';
import { Calc, createState, runScenario } from './harness.js';

const close = (actual, expected, tolerance, message) => assert.ok(
  Math.abs(actual - expected) <= tolerance,
  `${message || ''} expected ${expected}, got ${actual}`
);

test('capital recovery factor golden values', () => {
  // 0.08 * 1.08^30 / (1.08^30 - 1) = 0.08 * 10.0627 / 9.0627
  close(crf(0.08, 30), 0.0888274, 5e-8);
  close(crf(0, 10), 0.1, 1e-15);
});

test('IRR golden values for conventional cash flows', () => {
  // 300 x annuity factor(15.2382%, 5) = 1000.
  close(approximateIRR([-1000, 300, 300, 300, 300, 300]), 15.2382, 5e-5);
  close(approximateIRR([-100, 110]), 10, 1e-9);
  close(approximateIRR([-100, 0, 121]), 10, 1e-9);
  assert.equal(analyzeIRR([-100, 110]).status, 'ok');
});

test('IRR is flagged ambiguous for [-100, 230, -132] (roots 10% and 20%)', () => {
  // -100 + 230/(1+r) - 132/(1+r)^2 = 0  ->  100x^2 - 230x + 132 = 0, x = 1+r
  //   x = (230 +- sqrt(52900 - 52800)) / 200 = 1.1 or 1.2
  const analysis = analyzeIRR([-100, 230, -132]);
  assert.ok(Number.isNaN(analysis.irr));
  assert.equal(analysis.status, 'ambiguous');
  assert.match(analysis.label, /ambiguous/);
  close(analysis.roots[0], 0.10, 1e-9);
  close(analysis.roots[1], 0.20, 1e-9);
});

test('IRR is n/a with a reason when there is no net investment', () => {
  const analysis = analyzeIRR([0, 50, 50]);
  assert.ok(Number.isNaN(analysis.irr));
  assert.equal(analysis.status, 'no-investment');
  assert.match(analysis.label, /no net investment/);

  // 100% capex grant: no net investment at close, NPV still positive.
  const economics = runScenario({ policyMode: 'custom', customCapexGrantShare: 1 }).economics;
  assert.equal(economics.netCapexAtClose, 0);
  assert.equal(economics.projectIrrAnalysis.status, 'no-investment');
  assert.ok(Number.isNaN(economics.irr));
  assert.ok(economics.noNetInvestment);
  assert.ok(Number.isNaN(economics.roi));
  assert.ok(economics.npv > 0);
});

test('a lone root created by late outflows on a loss-making project is not reported as IRR', () => {
  // Undiscounted sum is negative (-60): the project never recovers its
  // investment, yet the final -100 makes NPV -> -inf as r -> -100%, so a
  // spurious root appears at a deeply negative rate.
  const cashFlows = [-100, 30, 30, 30, -50, 30, -50];
  const analysis = analyzeIRR(cashFlows);
  assert.ok(Number.isNaN(analysis.irr));
  assert.equal(analysis.status, 'no-meaningful-root');
  // Conventional flows that do not recover the investment keep their
  // (negative) unique IRR: -100 + 40 + 40 -> r = -21.92%.
  const conventional = analyzeIRR([-100, 40, 40]);
  assert.equal(conventional.status, 'ok');
  // 40x^2 + 40x - 100 = 0 with x = 1/(1+r): x = (-40 + sqrt(1600 + 16000)) / 80
  const x = (-40 + Math.sqrt(17600)) / 80;
  close(conventional.irr, (1 / x - 1) * 100, 1e-6);
});

test('non-conventional cash flows that recover the investment report their single positive root', () => {
  // Replacement in year 3; undiscounted sum +40.
  const cashFlows = [-100, 60, 60, -20, 60, -20];
  const analysis = analyzeIRR(cashFlows);
  assert.equal(analysis.status, 'ok');
  const npv = cashFlows.reduce((sum, value, year) => sum + value / Math.pow(1 + analysis.irr / 100, year), 0);
  close(npv, 0, 1e-6);
});

test('MIRR golden value and NPV sign consistency', () => {
  // [-1000, 300 x 5] at 10%: FV(inflows) = 300 x (1.1^4 + 1.1^3 + 1.1^2 + 1.1 + 1) = 1831.53
  //   MIRR = (1831.53 / 1000)^(1/5) - 1 = 12.8659%
  close(calculateMIRR([-1000, 300, 300, 300, 300, 300], 0.1, 0.1), 12.8659, 5e-5);
  // MIRR is unique where IRR is ambiguous: [-100, 230, -132] at 15%:
  //   PV(out) = 100 + 132/1.15^2 = 199.811; FV(in) = 230 x 1.15 = 264.5
  //   MIRR = (264.5 / 199.811)^(1/2) - 1 = 15.054%
  close(calculateMIRR([-100, 230, -132], 0.15, 0.15), 15.054, 5e-4);
  // MIRR is above the discount rate exactly when NPV is positive.
  [{}, { electrolyzerCapex: 1300 }, { batteryEnabled: true, batteryCapacityMWh: 4 }].forEach(overrides => {
    const economics = runScenario(overrides).economics;
    assert.equal(economics.mirr > economics.discountRatePercent, economics.npv > 0, JSON.stringify(overrides));
  });
});

test('level-payment debt: P = 1e6 at 6.5% over 15 years', () => {
  // 1e6 x 0.065 x 1.065^15 / (1.065^15 - 1) = 106,352.78 per year.
  const schedule = buildDebtSchedule(1e6, 0.065, 15, 30);
  close(schedule.annualDebtService, 106352.78, 0.01);
  close(schedule.endingBalance, 0, 1e-6);
  close(schedule.totalPrincipal, 1e6, 1e-6);
  assert.equal(schedule.byYear[16].debtService, 0);
});

test('NPV identities: zero discount sums cash flows; independent recomputation matches; NPV(IRR) = 0', () => {
  const zeroRate = runScenario({ discountRate: 0 }).economics;
  const undiscounted = -zeroRate.netCapexAtClose + zeroRate.yearlyCashFlows.reduce((sum, entry) => sum + entry.netCashFlow, 0);
  close(zeroRate.npv, undiscounted, 1e-6);

  const economics = runScenario().economics;
  const rate = createState().discountRate / 100;
  const cashFlows = [-economics.netCapexAtClose, ...economics.yearlyCashFlows.map(entry => entry.netCashFlow)];
  const recomputed = cashFlows.reduce((sum, value, year) => sum + value / Math.pow(1 + rate, year), 0);
  close(economics.npv, recomputed, 1e-6);
  assert.ok(Number.isFinite(economics.irr));
  const atIrr = cashFlows.reduce((sum, value, year) => sum + value / Math.pow(1 + economics.irr / 100, year), 0);
  close(atIrr, 0, 1e-6);
});

test('optimizer ranks by MIRR when IRR is undefined somewhere in the range', () => {
  // A capex grant share sweep that includes 100% (no net investment, IRR n/a).
  const result = Calc.findBestRangeValueForIrr(createState({ policyMode: 'custom' }), {
    stateKey: 'customCapexGrantShare',
    min: 0.9,
    max: 1,
    step: 0.05,
    currentValue: 0.9,
  });
  assert.ok(result);
  assert.equal(result.metric, 'mirr');
  assert.equal(result.bestValue, 1);
});
