/*
 * Project finance mechanics: the IRR reporting policy on real non-conventional
 * cash flows, level-payment debt, the financing split, debt coverage and
 * sponsor support, balloon repayment, the cash-flow timeline and payback.
 * Finance primitives against hand-derived numbers live in
 * finance-golden.test.js; NPV / IRR identities over many scenarios in
 * invariants.test.js.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { Calc, createState, formatMoney } from './harness.js';

function npvAt(cashFlows, rate) {
  return cashFlows.reduce(
    (sum, cashFlow, year) => sum + (cashFlow / Math.pow(1 + rate, year)),
    0
  );
}

const SABATIER_POSITIVE_ROOT_CAPEX = 100;
// Replacement- and debt-heavy cases that produce non-conventional cash flows
// (several sign changes), used to exercise the IRR reporting policy.
const IRR_REGRESSION_45V_PER_KG = 3.00;
const SABATIER_UPPER_BRANCH_METHANE_PRICE = 24;

// The tests below used to pin one branch of a multi-root IRR. IRR is now
// reported only when a single meaningful root exists (finance.analyzeIRR), so
// they assert that policy and the monotone MIRR / NPV instead.
test('headline IRR, when reported, zeroes NPV and falls with Sabatier conversion; MIRR always falls', () => {
  const higher = Calc.calculateAll(createState({ sabatierCapex: SABATIER_POSITIVE_ROOT_CAPEX, us45vHydrogenCreditPerKg: IRR_REGRESSION_45V_PER_KG, sabatierConversion: 85 })).economics;
  const lowerState = createState({ sabatierCapex: SABATIER_POSITIVE_ROOT_CAPEX, us45vHydrogenCreditPerKg: IRR_REGRESSION_45V_PER_KG, sabatierConversion: 84 });
  const lower = Calc.calculateAll(lowerState).economics;

  assert.ok(lower.npv < higher.npv, 'Lower conversion should lower NPV.');
  assert.ok(lower.mirr < higher.mirr, 'Lower conversion should lower MIRR.');
  [higher, lower].forEach(economics => {
    const cashFlows = [-economics.netCapexAtClose, ...economics.yearlyCashFlows.map(entry => entry.netCashFlow)];
    if (Number.isFinite(economics.irr)) {
      assert.equal(economics.projectIrrAnalysis.status, 'ok');
      assert.ok(Math.abs(npvAt(cashFlows, economics.irr / 100)) <= 1e-6);
    } else {
      assert.notEqual(economics.projectIrrAnalysis.status, 'ok');
      assert.ok(economics.projectIrrAnalysis.reason.length > 0);
    }
  });
  if (Number.isFinite(higher.irr) && Number.isFinite(lower.irr)) assert.ok(lower.irr < higher.irr);
  const leanIrr = Calc.calculateIrr(lowerState);
  assert.ok(Number.isFinite(lower.irr) ? Math.abs(lower.irr - leanIrr) <= 1e-9 : Number.isNaN(leanIrr));
});

test('longer debt tenor raises equity NPV and equity MIRR; a reported equity IRR is a root', () => {
  const base = {
    sabatierCapex: SABATIER_POSITIVE_ROOT_CAPEX,
    us45vHydrogenCreditPerKg: IRR_REGRESSION_45V_PER_KG,
    financingEnabled: true,
  };
  const twenty = Calc.calculateAll(createState({ ...base, debtTermYears: 20 })).economics;
  const twentyOne = Calc.calculateAll(createState({ ...base, debtTermYears: 21 })).economics;

  assert.ok(twentyOne.equityNpv > twenty.equityNpv);
  assert.ok(twentyOne.equityMirr > twenty.equityMirr);
  [twenty, twentyOne].forEach(economics => {
    if (!Number.isFinite(economics.equityIrr)) return;
    const cashFlows = [-economics.financing.equityUpfront, ...economics.yearlyCashFlows.map(entry => entry.equityCashFlow)];
    assert.ok(Math.abs(npvAt(cashFlows, economics.equityIrr / 100)) <= 1e-6);
  });
});

test('approximateIRR withholds the IRR when several positive roots exist', () => {
  // Was: report the largest root. (1 + r) roots at 9% and 24% by construction.
  const lowerDiscountFactor = 1 / 1.09;
  const upperDiscountFactor = 1 / 1.24;
  const cashFlows = [
    -(lowerDiscountFactor * upperDiscountFactor),
    lowerDiscountFactor + upperDiscountFactor,
    -1,
  ];
  const analysis = Calc.analyzeIRR(cashFlows);
  assert.ok(Number.isNaN(Calc.approximateIRR(cashFlows)));
  assert.equal(analysis.status, 'ambiguous');
  assert.equal(analysis.roots.length, 2);
  assert.ok(Math.abs(analysis.roots[0] - 0.09) < 1e-9 && Math.abs(analysis.roots[1] - 0.24) < 1e-9);
});

test('rising debt interest lowers equity MIRR monotonically even where equity IRR is undefined', () => {
  const rates = [9.5, 9.75, 10.5, 12.5];
  const results = rates.map(debtInterestRate => Calc.calculateAll(createState({
    sabatierCapex: SABATIER_POSITIVE_ROOT_CAPEX,
    us45vHydrogenCreditPerKg: IRR_REGRESSION_45V_PER_KG,
    methanePrice: SABATIER_UPPER_BRANCH_METHANE_PRICE,
    financingEnabled: true,
    debtTermYears: 30,
    debtInterestRate,
  })).economics);
  for (let i = 1; i < results.length; i++) {
    assert.ok(results[i].equityMirr < results[i - 1].equityMirr, `MIRR at ${rates[i]}%`);
    assert.ok(results[i].equityNpv < results[i - 1].equityNpv, `NPV at ${rates[i]}%`);
  }
  results.forEach(economics => {
    assert.equal(Number.isFinite(economics.equityIrr), economics.equityIrrAnalysis.status === 'ok');
  });
});

test('amortizing debt schedule matches standard level-payment loan math', () => {
  const principal = 100000;
  const annualRate = 0.065;
  const termYears = 15;
  const horizonYears = 30;
  const schedule = Calc.buildDebtSchedule(principal, annualRate, termYears, horizonYears);
  const growth = Math.pow(1 + annualRate, termYears);
  const expectedAnnualDebtService = principal * ((annualRate * growth) / (growth - 1));
  const firstYear = schedule.schedule[0];
  const lastDebtYear = schedule.schedule[termYears - 1];
  const yearAfterDebt = schedule.schedule[termYears];

  assert.ok(
    Math.abs(schedule.annualDebtService - expectedAnnualDebtService) <= 1e-9,
    [
      'Expected annual debt service to follow the standard level-payment amortization formula.',
      `Observed ${schedule.annualDebtService.toFixed(12)} vs expected ${expectedAnnualDebtService.toFixed(12)}.`,
    ].join(' ')
  );
  assert.ok(
    Math.abs(firstYear.interest - (principal * annualRate)) <= 1e-9,
    [
      'Expected first-year interest to accrue on the starting balance at the configured annual rate.',
      `Observed ${firstYear.interest.toFixed(12)} vs expected ${(principal * annualRate).toFixed(12)}.`,
    ].join(' ')
  );
  assert.ok(
    Math.abs(firstYear.principalPaid - (expectedAnnualDebtService - firstYear.interest)) <= 1e-9,
    [
      'Expected first-year principal to be the level payment minus that year’s interest.',
      `Observed ${firstYear.principalPaid.toFixed(12)} vs expected ${(expectedAnnualDebtService - firstYear.interest).toFixed(12)}.`,
    ].join(' ')
  );
  assert.ok(
    Math.abs(schedule.totalPrincipal - principal) <= 1e-6,
    `Expected total principal repaid to equal the original ${formatMoney(principal)} loan balance, got ${formatMoney(schedule.totalPrincipal)}.`
  );
  assert.ok(
    Math.abs(lastDebtYear.endingBalance) <= 1e-9,
    `Expected the last amortizing year to retire the balance, got ending balance ${lastDebtYear.endingBalance}.`
  );
  assert.equal(yearAfterDebt.debtService, 0, 'Expected debt service to stop immediately after the modeled term ends.');
});

test('zero-interest debt schedule repays principal evenly and then stops', () => {
  const principal = 120000;
  const termYears = 6;
  const schedule = Calc.buildDebtSchedule(principal, 0, termYears, 10);
  const expectedAnnualDebtService = principal / termYears;
  const debtYears = schedule.schedule.slice(0, termYears);
  const yearsAfterDebt = schedule.schedule.slice(termYears);

  assert.equal(
    schedule.annualDebtService,
    expectedAnnualDebtService,
    `Expected a zero-rate loan to repay ${formatMoney(expectedAnnualDebtService)} of principal each year.`
  );
  assert.ok(
    debtYears.every(entry => entry.interest === 0),
    'Expected zero-interest debt to accrue no interest in any amortizing year.'
  );
  assert.ok(
    debtYears.every(entry => Math.abs(entry.principalPaid - expectedAnnualDebtService) <= 1e-9),
    'Expected each zero-interest debt payment to repay an equal slice of principal.'
  );
  assert.equal(schedule.totalInterest, 0, 'Expected the zero-interest debt case to accumulate no interest.');
  assert.equal(schedule.totalPrincipal, principal, 'Expected the zero-interest debt case to repay the full principal balance.');
  assert.ok(
    yearsAfterDebt.every(entry => entry.debtService === 0 && entry.endingBalance === 0),
    'Expected debt service and balances to stay at zero after the modeled term.'
  );
});

test('financing model funds only the debt share and leaves zero-debt cases unlevered', () => {
  const financedResult = Calc.calculateAll(createState({
    financingEnabled: true,
    debtSharePercent: 70,
    debtInterestRate: 6.5,
    debtTermYears: 15,
    debtFeePercent: 1.5,
  }));
  const financedEconomics = financedResult.economics;
  const financedModel = financedEconomics.financing;
  const expectedDebtAmount = financedEconomics.totalCapex * 0.70;
  const expectedFee = expectedDebtAmount * 0.015;
  const expectedEquityUpfront = financedEconomics.totalCapex - expectedDebtAmount + expectedFee;
  const zeroDebtEconomics = Calc.calculateAll(createState({
    financingEnabled: true,
    debtSharePercent: 0,
    debtFeePercent: 5,
    debtTermYears: 25,
  })).economics;

  assert.ok(
    Math.abs(financedModel.debtAmount - expectedDebtAmount) <= 1e-6,
    [
      'Expected the debt amount to fund only the configured share of upfront CAPEX.',
      `Observed ${formatMoney(financedModel.debtAmount)} vs expected ${formatMoney(expectedDebtAmount)}.`,
    ].join(' ')
  );
  assert.ok(
    Math.abs(financedModel.upfrontFee - expectedFee) <= 1e-6,
    [
      'Expected the upfront fee to be calculated as a percentage of the gross debt amount.',
      `Observed ${formatMoney(financedModel.upfrontFee)} vs expected ${formatMoney(expectedFee)}.`,
    ].join(' ')
  );
  assert.ok(
    Math.abs(financedModel.equityUpfront - expectedEquityUpfront) <= 1e-6,
    [
      'Expected sponsor cash at close to equal uncovered CAPEX plus the financing fee.',
      `Observed ${formatMoney(financedModel.equityUpfront)} vs expected ${formatMoney(expectedEquityUpfront)}.`,
    ].join(' ')
  );
  assert.ok(
    Math.abs(zeroDebtEconomics.equityIrr - zeroDebtEconomics.projectIrr) <= 1e-12,
    [
      'Expected a 0% debt share to leave equity IRR identical to the unlevered project IRR.',
      `Observed project ${zeroDebtEconomics.projectIrr.toFixed(12)}% vs equity ${zeroDebtEconomics.equityIrr.toFixed(12)}%.`,
    ].join(' ')
  );
  assert.ok(
    Math.abs(zeroDebtEconomics.equityNpv - zeroDebtEconomics.npv) <= 1e-9,
    [
      'Expected a 0% debt share to leave equity NPV identical to project NPV.',
      `Observed project ${zeroDebtEconomics.npv.toFixed(12)} vs equity ${zeroDebtEconomics.equityNpv.toFixed(12)}.`,
    ].join(' ')
  );
});

test('financing coverage metrics flag sponsor support when debt service exceeds operating cash flow', () => {
  const economics = Calc.calculateAll(createState({
    financingEnabled: true,
    debtTermYears: 1,
  })).economics;
  const financedModel = economics.financing;
  const yearOne = economics.yearlyCashFlows[0];
  const expectedSupport = Math.max(0, yearOne.debtService - yearOne.operatingCashFlow);

  assert.equal(financedModel.canFullyCoverDebtService, false);
  assert.ok(expectedSupport > 0, 'A one-year term should outrun year-one operating cash flow.');
  assert.equal(financedModel.firstUncoveredDebtServiceYear, 1);
  assert.ok(Math.abs(yearOne.sponsorSupportNeeded - expectedSupport) <= 1e-6);
  assert.ok(Math.abs(financedModel.peakSponsorSupport - expectedSupport) <= 1e-6);
  assert.equal(financedModel.peakSponsorSupportYear, 1);
  // Sponsor support is every negative equity year after close (debt service
  // or replacements), and the summary adds them up.
  economics.yearlyCashFlows.forEach(entry => {
    assert.ok(Math.abs(entry.sponsorSupportNeeded - Math.max(0, -entry.equityCashFlow)) <= 1e-9, `year ${entry.year}`);
  });
  const total = economics.yearlyCashFlows.reduce((sum, entry) => sum + entry.sponsorSupportNeeded, 0);
  assert.ok(Math.abs(financedModel.sponsorSupportTotal - total) <= 1e-6);
  assert.deepEqual(
    financedModel.uncoveredDebtServiceYears,
    economics.yearlyCashFlows.filter(entry => entry.equityCashFlow < -1e-9).map(entry => entry.year)
  );
  // DSCR = (operating cash - replacements) / scheduled debt service.
  assert.ok(Math.abs(yearOne.dscr - (yearOne.operatingCashFlow - yearOne.replacementOutflow) / yearOne.debtService) <= 1e-12);
  assert.ok(financedModel.minDscr < 1);
  assert.deepEqual(financedModel.dscrBelowOneYears, [1]);
});

// Was: "coverage stays clear" with $0 support although year 7's replacement
// made equity cash negative. Replacement-year shortfalls now count.
test('sponsor support includes replacement-year shortfalls when debt service alone is covered', () => {
  const economics = Calc.calculateAll(createState({
    financingEnabled: true,
    debtTermYears: 10,
  })).economics;
  const financedModel = economics.financing;
  const debtYears = economics.yearlyCashFlows.filter(entry => entry.debtService > 0);
  assert.ok(debtYears.every(entry => entry.operatingCashFlow >= entry.debtService), 'operations cover scheduled debt service');

  const yearSeven = economics.yearlyCashFlows[6];
  assert.ok(yearSeven.replacementOutflow > 0);
  assert.ok(yearSeven.equityCashFlow < 0);
  assert.ok(Math.abs(yearSeven.sponsorSupportNeeded + yearSeven.equityCashFlow) <= 1e-9);
  assert.ok(financedModel.uncoveredDebtServiceYears.includes(7));
  assert.equal(financedModel.canFullyCoverDebtService, false);
  assert.ok(yearSeven.dscr < 1);
  assert.ok(financedModel.minDscr <= yearSeven.dscr);
  const meanDscr = debtYears.reduce((sum, entry) => sum + entry.dscr, 0) / debtYears.length;
  assert.ok(Math.abs(financedModel.averageDscr - meanDscr) <= 1e-12);
});

test('a debt term past the horizon amortizes on its own schedule and ends in a balloon', () => {
  // P at 6.5% over 25 years, horizon 20: the year-20 balloon is the balance
  // after 20 level payments = PV of the remaining 5 payments.
  const economics = Calc.calculateAll(createState({
    financingEnabled: true,
    debtTermYears: 25,
    analysisHorizonYears: 20,
  })).economics;
  const financing = economics.financing;
  assert.equal(financing.debtTermYears, 25);
  assert.equal(financing.termExceedsHorizon, true);
  const payment = financing.debtAmount * Calc.crf(0.065, 25);
  assert.ok(Math.abs(financing.annualDebtService - payment) <= 1e-6);
  const remaining = payment * (1 - Math.pow(1.065, -5)) / 0.065;
  assert.ok(Math.abs(financing.balloonPayment - remaining) <= 1e-6);
  assert.equal(financing.balloonYear, 20);
  const last = economics.yearlyCashFlows.at(-1);
  assert.ok(Math.abs(last.debtService - (payment + remaining)) <= 1e-6);
  assert.ok(Math.abs(last.debtEndingBalance) <= 1e-6);
});

test('cash-flow timeline starts at close and follows unlevered project cash', () => {
  const economics = Calc.calculateAll(createState({ analysisHorizonYears: 5 })).economics;
  const timeline = economics.cashFlowTimeline;
  const expectedLabels = ['Close', ...economics.yearlyCashFlows.map(entry => `Year ${entry.year}`)];

  assert.ok(timeline, 'Expected economics results to include a chart-ready cash-flow timeline.');
  assert.equal(timeline.financed, false, 'Expected the default timeline to stay unlevered.');
  assert.deepEqual(
    timeline.labels,
    expectedLabels,
    'Expected cash-flow timeline labels to cover close plus each modeled year.'
  );
  assert.equal(
    timeline.projectCashFlow[0],
    -economics.totalCapex,
    `Expected the close entry to start at upfront CAPEX ${formatMoney(economics.totalCapex)}.`
  );
  assert.equal(
    timeline.cumulativeProjectCash[0],
    -economics.totalCapex,
    `Expected cumulative project cash to start at upfront CAPEX ${formatMoney(economics.totalCapex)}.`
  );
  assert.deepEqual(
    timeline.projectCashFlow.slice(1),
    economics.yearlyCashFlows.map(entry => entry.netCashFlow),
    'Expected the unlevered timeline to use yearly project net cash after O&M and replacements.'
  );
  assert.deepEqual(
    timeline.annualRevenue.slice(1),
    economics.yearlyCashFlows.map(entry => entry.totalRevenue),
    'Expected timeline revenue bars to stay aligned with total yearly revenue.'
  );
  assert.deepEqual(
    timeline.annualMarketRevenue.slice(1),
    economics.yearlyCashFlows.map(entry => entry.totalRevenue - (entry.revenue.policyCredits || 0)),
    'Expected timeline market-revenue bars to exclude policy credits from the yearly revenue total.'
  );
  assert.deepEqual(
    timeline.annualPolicyCredits.slice(1),
    economics.yearlyCashFlows.map(entry => entry.revenue.policyCredits || 0),
    'Expected timeline policy-credit bars to align with the yearly policy revenue component.'
  );
  assert.deepEqual(
    timeline.cumulativeProjectCash.slice(1),
    economics.yearlyCashFlows.map(entry => entry.cumulativeNetCash),
    'Expected cumulative project cash to stay aligned with the yearly economics table.'
  );
  assert.ok(
    timeline.annualDebtService.every(value => value === 0),
    'Expected the unlevered timeline to exclude debt service entirely.'
  );
  assert.equal(timeline.hasPolicyCredits, true, 'Expected the default timeline to surface active policy credits.');
});

test('cash-flow timeline collapses cleanly when policy credits are disabled', () => {
  const economics = Calc.calculateAll(createState({
    analysisHorizonYears: 5,
    policyMode: 'none',
  })).economics;
  const timeline = economics.cashFlowTimeline;

  assert.ok(timeline, 'Expected the no-policy case to still include a cash-flow timeline.');
  assert.equal(timeline.hasPolicyCredits, false, 'Expected the no-policy timeline to hide the policy-credit series.');
  assert.ok(
    timeline.annualPolicyCredits.every(value => value === 0),
    'Expected policy-credit bars to stay at zero when no policy credits are selected.'
  );
  assert.deepEqual(
    timeline.annualMarketRevenue,
    timeline.annualRevenue,
    'Expected market revenue to equal total revenue when policy credits are disabled.'
  );
});

test('cash-flow timeline adds debt service and sponsor equity tracking for financed cases', () => {
  const economics = Calc.calculateAll(createState({
    financingEnabled: true,
    debtTermYears: 1,
    analysisHorizonYears: 5,
  })).economics;
  const timeline = economics.cashFlowTimeline;

  assert.ok(timeline, 'Expected financed economics results to include a cash-flow timeline.');
  assert.equal(timeline.financed, true, 'Expected the financed timeline to flag that financing is enabled.');
  assert.equal(
    timeline.equityCashFlow[0],
    -economics.financing.equityUpfront,
    `Expected close equity cash to start at sponsor cash at close ${formatMoney(economics.financing.equityUpfront)}.`
  );
  assert.equal(
    timeline.cumulativeEquityCash[0],
    -economics.financing.equityUpfront,
    `Expected cumulative equity cash to start at sponsor cash at close ${formatMoney(economics.financing.equityUpfront)}.`
  );
  assert.deepEqual(
    timeline.annualDebtService.slice(1),
    economics.yearlyCashFlows.map(entry => entry.debtService),
    'Expected financed timeline debt-service bars to align with the modeled amortization schedule.'
  );
  assert.deepEqual(
    timeline.cumulativeEquityCash.slice(1),
    economics.yearlyCashFlows.map(entry => entry.cumulativeEquityCash),
    'Expected financed cumulative equity cash to stay aligned with the yearly sponsor cash path.'
  );
  assert.equal(timeline.hasDebtService, true, 'Expected financed timelines to expose debt service when debt is modeled.');
  assert.equal(timeline.hasSponsorSupport, true, 'Expected the one-year debt stress case to surface sponsor support in the timeline.');
  assert.ok(
    Math.abs(timeline.sponsorSupportNeeded[1] - economics.yearlyCashFlows[0].sponsorSupportNeeded) <= 1e-6,
    'Expected sponsor support in year 1 to match the yearly financed cash-flow view.'
  );
  assert.ok(
    Math.abs(timeline.debtEndingBalance[1] - economics.yearlyCashFlows[0].debtEndingBalance) <= 1e-6,
    'Expected timeline debt balances to stay aligned with the yearly financing schedule.'
  );
});

test('simple payback reports first recovery even if later years dip negative', () => {
  const simplePaybackYears = Calc.calculateSimplePaybackYears(100, [120, -30]);
  const sustainedPaybackYears = Calc.calculateSustainedPaybackYears(100, [120, -30]);

  assert.ok(
    Math.abs(simplePaybackYears - (100 / 120)) <= 1e-9,
    `Expected first-crossover payback at ${(100 / 120).toFixed(6)} years, got ${simplePaybackYears}.`
  );
  assert.equal(
    sustainedPaybackYears,
    Infinity,
    'The sustained-payback helper should still reject paths that dip negative again later.'
  );
});
