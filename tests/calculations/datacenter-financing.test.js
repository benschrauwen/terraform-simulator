/* Datacenter financing (js/model/datacenter/financing.js): a construction loan drawn with the
   non-GPU capex and converted to a term loan at first power, and a loan per GPU purchase. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { GPU_FINANCING } from '../../js/data/datacenter/gpu.js';
import { calculateDatacenterScenario, DATACENTER_DEFAULT_STATE } from '../../js/model/datacenter/index.js';
import { buildTranche, levelPayment } from '../../js/model/datacenter/financing.js';

const close = (a, b, rel = 1e-9, abs = 1e-6) => Math.abs(a - b) <= Math.max(abs, rel * Math.max(Math.abs(a), Math.abs(b)));
const FINANCED = { ...DATACENTER_DEFAULT_STATE, financingEnabled: true };
const off = calculateDatacenterScenario(DATACENTER_DEFAULT_STATE).economics;
const on = calculateDatacenterScenario(FINANCED).economics;

test('a tranche capitalizes interest until conversion, then pays level instalments', () => {
  // 100 drawn at year 1 and 100 at year 2, 10%, converts at year 3, 2-year term.
  const t = buildTranche({ draws: { 1: 100, 2: 100 }, rate: 0.1, termYears: 2, conversionYear: 3, horizonYears: 10, feeRate: 0.01 });
  // Balance: 100 -> 110 + 100 = 210 -> 231 at year 3.
  assert.ok(close(t.balanceAtConversion, 231));
  assert.ok(close(t.capitalizedInterest, 31));
  assert.ok(t.balanceAtConversion > t.drawn);
  const payment = levelPayment(231, 0.1, 2);
  assert.ok(close(t.byYear[4].service, payment) && close(t.byYear[5].service, payment));
  assert.ok(close(t.byYear[5].endBalance, 0));
  [1, 2, 3].forEach(year => assert.equal(t.byYear[year].service, 0));
  assert.ok(close(t.fee, 2) && close(t.byYear[1].fee, 2));
  assert.equal(levelPayment(100, 0, 4), 25);
});

test('draws follow the construction capex timing; no debt service before first power', () => {
  const f = on.financing;
  const t0 = on.energizationYears;
  // Construction tranche: debt share (70%) of every non-GPU capex payment, in its year.
  const share = FINANCED.debtSharePercent / 100;
  for (let year = 1; year <= 5; year++) {
    const entry = on.yearlyCashFlows[year - 1];
    const nonGpuCapex = entry.deferredCapexOutflow - entry.replacementItems.filter(item => item.key === 'it' && item.initial).reduce((sum, item) => sum + item.cost, 0);
    assert.ok(close(f.construction.byYear[year]?.draw || 0, share * nonGpuCapex, 1e-9, 1e-3), `year ${year}`);
  }
  assert.ok(close(f.construction.drawn, share * (on.totalCapex - on.capex.it)));
  // Interest during construction is capitalized: the balance at first power exceeds the draws.
  assert.ok(f.construction.balanceAtConversion > f.construction.drawn);
  assert.equal(f.construction.conversionYear, Math.ceil(t0));
  // No debt service in any year before first power (t0 = 4.5: years 1-5).
  on.yearlyCashFlows.filter(entry => entry.year <= Math.ceil(t0)).forEach(entry => assert.equal(entry.debtService, 0, `year ${entry.year}`));
  // With 'ntp' timing the construction tranche is drawn at close.
  const ntp = calculateDatacenterScenario({ ...FINANCED, constructionCapexTiming: 'ntp' }).economics;
  assert.ok(close(ntp.financing.construction.byYear[0].draw, ntp.financing.construction.drawn));
  assert.ok(ntp.financing.construction.capitalizedInterest > f.construction.capitalizedInterest);
});

test('each GPU purchase is financed at the GPU share and amortizes over the GPU life', () => {
  const f = on.financing;
  const life = on.gpuFleet.lifeYears;
  // GPUs at 4.5, 9.5, 14.5 and 19.5 years: four tranches of 70% of $3.71B each.
  assert.equal(GPU_FINANCING.advanceRatePercent, 70);
  assert.equal(f.gpu.length, 4);
  f.gpu.forEach(tranche => assert.ok(close(tranche.drawn, 0.7 * on.capex.it)));
  assert.deepEqual(f.gpu.map(tranche => tranche.atYears), [4.5, 9.5, 14.5, 19.5]);
  // The first converts at year 5 and pays level instalments in years 6-10 at 9%.
  const first = f.gpu[0];
  const payment = levelPayment(first.balanceAtConversion, 0.09, life);
  for (let year = 6; year <= 10; year++) assert.ok(close(first.byYear[year].service, payment), `year ${year}`);
  assert.ok(close(first.byYear[10].endBalance, 0, 1e-9, 1e-3));
  // The last one is still owed at the horizon: repaid as a balloon.
  assert.ok(f.gpu[3].balloon > 0 && f.balloonYear === 20);
});

test('with the debt rates equal to the discount rate and no fees, equity NPV = project NPV', () => {
  const r = calculateDatacenterScenario({ ...FINANCED, debtInterestRate: 8, gpuDebtInterestRate: 8, debtFeePercent: 0 }).economics;
  assert.equal(r.discountRatePercent, 8);
  assert.ok(close(r.equityNpv, r.npv, 1e-9, 1e-2), `${r.equityNpv} vs ${r.npv}`);
  // Equity cash = project cash + draws - debt service - fees, year by year.
  r.yearlyCashFlows.forEach(entry => assert.ok(close(entry.equityCashFlow, entry.netCashFlow + entry.debtDraw - entry.debtService - entry.debtFees)));
});

test('financing on changes the equity view materially; the project view and paybacks do not move', () => {
  assert.equal(on.npv, off.npv);
  assert.equal(on.paybackYears, off.paybackYears);
  assert.ok(Math.abs(on.equityIrr - off.projectIrr) > 1, `${on.equityIrr} vs ${off.projectIrr}`);
  assert.ok(on.financing.drawn > 0.5 * on.totalCapex);
  // DSCR and sponsor support are measured from first power.
  assert.ok(Number.isFinite(on.financing.minDscr));
  on.yearlyCashFlows.filter(entry => entry.year <= on.energizationYears).forEach(entry => {
    assert.equal(entry.dscr, null);
    assert.equal(entry.sponsorSupportNeeded, 0);
  });
  // The timeline carries the draws.
  assert.equal(on.cashFlowTimeline.debtDraws.length, on.yearlyCashFlows.length + 1);
  assert.ok(on.cashFlowTimeline.hasDebtDraws);
});
