const assert = require('node:assert/strict');
const test = require('node:test');

const {
  Calc,
  ModuleCatalog,
  createState,
  formatMoney,
  runBatterySweep,
  runScenario,
} = require('./harness');

function npvAt(cashFlows, rate) {
  return cashFlows.reduce(
    (sum, cashFlow, year) => sum + (cashFlow / Math.pow(1 + rate, year)),
    0
  );
}

test('default scenario stays numerically sane', () => {
  const state = createState();
  const result = runScenario();

  assert.equal(state.batteryCapacityMWh, 0, 'This regression suite assumes the current defaults start with no battery.');
  assert.equal(result.storage.enabled, false, 'Battery should stay disabled in the zero-capacity default case.');
  assert.ok(Number.isFinite(result.economics.totalCapex), 'Total CAPEX should be finite.');
  assert.ok(Number.isFinite(result.economics.totalAnnualRevenue), 'Annual revenue should be finite.');
  assert.ok(Number.isFinite(result.economics.npv), 'NPV should be finite.');
  assert.ok(Number.isFinite(result.economics.irr), 'IRR should be finite.');
  assert.ok(Number.isFinite(result.electrolyzer.h2AnnualKg), 'Hydrogen output should be finite.');
  assert.ok(Number.isFinite(result.dac.co2AnnualTons), 'DAC output should be finite.');
});

test('module catalog keeps exploratory routes and markets in one definition', () => {
  const mtg = ModuleCatalog.getById('mtg');
  const fluidBedRoute = ModuleCatalog.getRouteConfig('mtg', 'fluid-bed');
  const marketConfig = ModuleCatalog.getMarketConfig('mtg');

  assert.ok(mtg, 'Expected MTG to be present in the unified module catalog.');
  assert.equal(mtg.exploratory, true, 'Expected MTG to be marked as exploratory on the module definition itself.');
  assert.equal(ModuleCatalog.getDefaultRoute('mtg'), 'fixed-bed', 'Expected the first MTG route to be used as the default route.');
  assert.equal(fluidBedRoute.capexPerAnnualUnit, 450, 'Expected route metadata to be resolved directly from the unified catalog.');
  assert.equal(marketConfig.defaultValue, 900, 'Expected module sale-price defaults to live alongside the module definition.');
  assert.ok(
    ModuleCatalog.getSupportedModules().some(module => module.id === 'electrolyzer'),
    'Expected supported modules to be queryable from the same catalog.'
  );
});

test('capex breakdown still adds up to the reported total', () => {
  const result = runScenario();
  const capex = result.economics.capex;
  const sumOfComponents = Object.values(capex).reduce((sum, value) => sum + value, 0);

  assert.ok(
    Math.abs(sumOfComponents - result.economics.totalCapex) <= 1e-6,
    `Expected CAPEX components to sum to ${formatMoney(result.economics.totalCapex)}, got ${formatMoney(sumOfComponents)}.`
  );
});

test('solar land use stays physically larger than panel area while preserving denser east-west packing', () => {
  const baseOverrides = {
    systemSizeMW: 1,
    panelEfficiency: 20,
    batteryCapacityMWh: 0,
    electrolyzerEnabled: false,
    dacEnabled: false,
    sabatierEnabled: false,
    methanolEnabled: false,
  };
  const fixed = runScenario({ ...baseOverrides, mountingType: 'fixed' });
  const eastWest = runScenario({ ...baseOverrides, mountingType: 'ew' });
  const singleAxis = runScenario({ ...baseOverrides, mountingType: 'single' });

  for (const [label, result] of [
    ['fixed tilt', fixed],
    ['east-west', eastWest],
    ['single-axis', singleAxis],
  ]) {
    assert.ok(
      result.solar.landAreaM2 > result.solar.panelAreaM2,
      `Expected ${label} land area ${result.solar.landAreaM2.toFixed(3)} m2 to exceed panel area ${result.solar.panelAreaM2.toFixed(3)} m2.`
    );
  }

  const densityRatio = singleAxis.solar.landAreaM2 / eastWest.solar.landAreaM2;
  assert.ok(
    densityRatio > 2.45 && densityRatio < 2.55,
    `Expected east-west to stay about 2.5x denser than single-axis tracking, observed ${densityRatio.toFixed(3)}x.`
  );
});

test('solar acreage and BOS respond to location while keeping installed MW fixed', () => {
  function solarAt({ latitude, longitude, mountingType, bosCostPerW }) {
    return Calc.calculateSolar(createState({
      latitude,
      longitude,
      mountingType,
      systemSizeMW: 1,
      panelEfficiency: 21.5,
      panelCostPerW: 0.20,
      bosCostPerW,
      landCostPerAcre: 5000,
      sitePrepCostPerAcre: 15000,
      siteYieldMwhPerMwdcYear: 0,
    }));
  }

  const mojaveEw = solarAt({ latitude: 35.05, longitude: -117.60, mountingType: 'ew', bosCostPerW: 0.12 });
  const houstonEw = solarAt({ latitude: 29.7604, longitude: -95.3698, mountingType: 'ew', bosCostPerW: 0.12 });
  const buffaloEw = solarAt({ latitude: 42.8864, longitude: -78.8784, mountingType: 'ew', bosCostPerW: 0.12 });
  const mojaveSingle = solarAt({ latitude: 35.05, longitude: -117.60, mountingType: 'single', bosCostPerW: 0.35 });
  const houstonSingle = solarAt({ latitude: 29.7604, longitude: -95.3698, mountingType: 'single', bosCostPerW: 0.35 });
  const buffaloSingle = solarAt({ latitude: 42.8864, longitude: -78.8784, mountingType: 'single', bosCostPerW: 0.35 });

  assert.ok(
    Math.abs(mojaveEw.groundCoverageRatio - mojaveEw.baseGroundCoverageRatio) <= 1e-12,
    'Expected the Mojave east-west reference case to preserve the baseline ground coverage ratio.'
  );
  assert.ok(
    Math.abs(mojaveSingle.bosCostPerW - mojaveSingle.baseBosCostPerW) <= 1e-12,
    'Expected the Mojave single-axis reference case to preserve the baseline BOS cost per watt.'
  );
  assert.ok(
    houstonSingle.acres < mojaveSingle.acres && buffaloSingle.acres > mojaveSingle.acres,
    [
      'Expected the same installed single-axis MWdc to use less land in Houston and more land in Buffalo than the Mojave reference.',
      `Observed Houston ${houstonSingle.acres.toFixed(3)}, Mojave ${mojaveSingle.acres.toFixed(3)}, Buffalo ${buffaloSingle.acres.toFixed(3)} acres.`,
    ].join(' ')
  );
  assert.ok(
    houstonSingle.bosCapex < mojaveSingle.bosCapex && buffaloSingle.bosCapex > mojaveSingle.bosCapex,
    [
      'Expected single-axis BOS to fall slightly at lower-latitude Houston and rise at higher-latitude Buffalo.',
      `Observed Houston ${houstonSingle.bosCapex.toFixed(0)}, Mojave ${mojaveSingle.bosCapex.toFixed(0)}, Buffalo ${buffaloSingle.bosCapex.toFixed(0)} USD.`,
    ].join(' ')
  );
  assert.ok(
    Math.abs(buffaloSingle.acres - houstonSingle.acres) > Math.abs(buffaloEw.acres - houstonEw.acres),
    [
      'Expected tracker acreage to react more strongly to location than east-west acreage at fixed installed MWdc.',
      `Observed EW swing ${Math.abs(buffaloEw.acres - houstonEw.acres).toFixed(3)} vs tracker swing ${Math.abs(buffaloSingle.acres - houstonSingle.acres).toFixed(3)} acres.`,
    ].join(' ')
  );
});

test('dac capex is sized from allocated DAC power', () => {
  const allocation = { dac: 0.4 };
  const lessEfficient = Calc.calculateDAC(
    createState({ dacEnabled: true, dacCapex: 450, dacEnergy: 4000 }),
    125,
    3000,
    allocation
  );
  const moreEfficient = Calc.calculateDAC(
    createState({ dacEnabled: true, dacCapex: 450, dacEnergy: 2000 }),
    125,
    3000,
    allocation
  );

  assert.ok(Math.abs(lessEfficient.allocKW - 50) <= 1e-9, `Expected 50 kW of DAC allocation, got ${lessEfficient.allocKW}.`);
  assert.ok(Math.abs(lessEfficient.capex - 22500) <= 1e-9, `Expected DAC CAPEX of $22,500, got ${lessEfficient.capex}.`);
  assert.ok(
    moreEfficient.co2AnnualTons > lessEfficient.co2AnnualTons,
    'Expected a lower DAC energy intensity to increase annual CO2 capture at the same allocated power.'
  );
  assert.ok(
    Math.abs(moreEfficient.capex - lessEfficient.capex) <= 1e-9,
    'Expected DAC CAPEX to stay tied to allocated kW rather than annual capture.'
  );
});

test('exploratory capex controls spell out annual output capacity units', () => {
  const mtgControl = Calc.getExploratoryCapexControlConfig('mtg', 'fixed-bed');
  const desalinationControl = Calc.getExploratoryCapexControlConfig('desalination', 'reverse-osmosis');

  assert.equal(
    mtgControl.unitLabel,
    '$/ton/yr capacity',
    'Expected solid exploratory routes to show ton/yr capacity instead of the tpa shorthand.'
  );
  assert.equal(
    desalinationControl.unitLabel,
    '$/m3/day',
    'Expected desalination to keep its volumetric capacity basis.'
  );
});

test('lean IRR path matches the full default scenario calculation', () => {
  const state = createState();
  const fullResult = Calc.calculateAll(state);
  const leanIrr = Calc.calculateIrr(state);

  assert.ok(
    Math.abs(fullResult.economics.irr - leanIrr) <= 1e-9,
    `Expected lean IRR ${leanIrr} to match full IRR ${fullResult.economics.irr}.`
  );
});

test('lean IRR path matches the full AI-enabled scenario calculation', () => {
  const state = createState({ aiComputeEnabled: true, batteryCapacityMWh: 24, aiReliabilityTarget: 95 });
  const fullResult = Calc.calculateAll(state);
  const leanIrr = Calc.calculateIrr(state);

  assert.ok(
    Math.abs(fullResult.economics.irr - leanIrr) <= 1e-9,
    `Expected lean AI IRR ${leanIrr} to match full IRR ${fullResult.economics.irr}.`
  );
});

test('lean IRR path matches the full undersized-chemistry scenario calculation', () => {
  const state = createState({ systemSizeMW: 100, batteryCapacityMWh: 24, chemicalSizingPercent: 70 });
  const fullResult = Calc.calculateAll(state);
  const leanIrr = Calc.calculateIrr(state);

  assert.ok(
    Math.abs(fullResult.economics.irr - leanIrr) <= 1e-9,
    `Expected lean undersized-chemistry IRR ${leanIrr} to match full IRR ${fullResult.economics.irr}.`
  );
});

test('lean IRR path matches the full exploratory-enabled scenario calculation', () => {
  const state = createState({
    systemSizeMW: 100,
    batteryCapacityMWh: 24,
    limeEnabled: true,
    limePrice: 1000,
  });
  const fullResult = Calc.calculateAll(state);
  const leanIrr = Calc.calculateIrr(state);

  assert.ok(Number.isFinite(fullResult.economics.irr), 'Expected the full exploratory regression case to produce a finite IRR.');
  assert.ok(Number.isFinite(leanIrr), 'Expected the lean exploratory regression case to produce a finite IRR.');
  assert.ok(
    Math.abs(fullResult.economics.irr - leanIrr) <= 1e-9,
    `Expected lean exploratory IRR ${leanIrr} to match full IRR ${fullResult.economics.irr}.`
  );
});

test('headline IRR stays on the discount-rate root when replacement cycles create multiple roots', () => {
  const higherConversionState = createState({ sabatierConversion: 85 });
  const lowerConversionState = createState({ sabatierConversion: 84 });
  const higherConversionResult = Calc.calculateAll(higherConversionState);
  const lowerConversionResult = Calc.calculateAll(lowerConversionState);
  const leanLowerConversionIrr = Calc.calculateIrr(lowerConversionState);

  assert.ok(
    higherConversionResult.economics.irr > 0,
    `Expected the 85% Sabatier case to keep a positive headline IRR, got ${higherConversionResult.economics.irr}.`
  );
  assert.ok(
    lowerConversionResult.economics.irr > 0,
    `Expected the 84% Sabatier case to stay on the positive IRR root instead of flipping negative, got ${lowerConversionResult.economics.irr}.`
  );
  assert.ok(
    lowerConversionResult.economics.irr < higherConversionResult.economics.irr,
    [
      'Expected a lower Sabatier conversion to reduce the positive IRR root without jumping to a different branch.',
      `Observed 85% -> ${higherConversionResult.economics.irr.toFixed(6)}% and 84% -> ${lowerConversionResult.economics.irr.toFixed(6)}%.`,
    ].join(' ')
  );
  assert.ok(
    Math.abs(higherConversionResult.economics.irr - 7.925879719420551) <= 1e-6,
    `Expected the 85% Sabatier regression case to stay near a 7.925880% headline IRR, got ${higherConversionResult.economics.irr}.`
  );
  assert.ok(
    Math.abs(lowerConversionResult.economics.irr - 7.722987106999568) <= 1e-6,
    `Expected the 84% Sabatier regression case to stay near a 7.722987% headline IRR, got ${lowerConversionResult.economics.irr}.`
  );
  assert.ok(
    Math.abs(lowerConversionResult.economics.irr - leanLowerConversionIrr) <= 1e-9,
    `Expected lean IRR ${leanLowerConversionIrr} to match full IRR ${lowerConversionResult.economics.irr}.`
  );
});

test('equity IRR stays on the positive branch when longer debt terms add another debt-service year', () => {
  const twentyYearDebtState = createState({ financingEnabled: true, debtTermYears: 20 });
  const twentyOneYearDebtState = createState({ financingEnabled: true, debtTermYears: 21 });
  const twentyYearDebtResult = Calc.calculateAll(twentyYearDebtState);
  const twentyOneYearDebtResult = Calc.calculateAll(twentyOneYearDebtState);
  const leanTwentyOneYearEquityIrr = Calc.calculateIrr(twentyOneYearDebtState);

  assert.ok(
    twentyYearDebtResult.economics.equityIrr > 0,
    `Expected the 20-year debt case to keep a positive equity IRR, got ${twentyYearDebtResult.economics.equityIrr}.`
  );
  assert.ok(
    twentyOneYearDebtResult.economics.equityIrr > 0,
    `Expected the 21-year debt case to stay on the positive equity IRR branch instead of flipping negative, got ${twentyOneYearDebtResult.economics.equityIrr}.`
  );
  assert.ok(
    twentyOneYearDebtResult.economics.equityNpv > twentyYearDebtResult.economics.equityNpv,
    [
      'Expected stretching the debt tenor from 20 to 21 years to slightly improve equity NPV at the configured hurdle rate.',
      `Observed 20-year ${twentyYearDebtResult.economics.equityNpv.toFixed(6)} vs 21-year ${twentyOneYearDebtResult.economics.equityNpv.toFixed(6)}.`,
    ].join(' ')
  );
  assert.ok(
    twentyOneYearDebtResult.economics.equityIrr > twentyYearDebtResult.economics.equityIrr,
    [
      'Expected the 21-year debt term to keep a slightly higher positive equity IRR rather than jumping to a negative branch.',
      `Observed 20-year ${twentyYearDebtResult.economics.equityIrr.toFixed(6)}% vs 21-year ${twentyOneYearDebtResult.economics.equityIrr.toFixed(6)}%.`,
    ].join(' ')
  );
  assert.ok(
    Math.abs(twentyYearDebtResult.economics.equityIrr - 29.794783415880932) <= 1e-6,
    `Expected the 20-year debt regression case to stay near a 29.794783% equity IRR, got ${twentyYearDebtResult.economics.equityIrr}.`
  );
  assert.ok(
    Math.abs(twentyOneYearDebtResult.economics.equityIrr - 30.521265100441365) <= 1e-6,
    `Expected the 21-year debt regression case to stay near a 30.521265% equity IRR, got ${twentyOneYearDebtResult.economics.equityIrr}.`
  );
  assert.ok(
    Math.abs(twentyOneYearDebtResult.economics.equityIrr - leanTwentyOneYearEquityIrr) <= 1e-9,
    `Expected lean IRR ${leanTwentyOneYearEquityIrr} to match full IRR ${twentyOneYearDebtResult.economics.equityIrr}.`
  );
});

test('reported project and equity IRRs zero their respective cash-flow NPVs', () => {
  const projectResult = Calc.calculateAll(createState({ sabatierConversion: 84 }));
  const projectCashFlows = [
    -projectResult.economics.totalCapex,
    ...projectResult.economics.yearlyCashFlows.map(entry => entry.netCashFlow),
  ];
  const projectIrrRate = projectResult.economics.projectIrr / 100;
  const equityResult = Calc.calculateAll(createState({ financingEnabled: true, debtTermYears: 21 }));
  const equityCashFlows = [
    -equityResult.economics.financing.equityUpfront,
    ...equityResult.economics.yearlyCashFlows.map(entry => entry.equityCashFlow),
  ];
  const equityIrrRate = equityResult.economics.equityIrr / 100;

  assert.ok(
    Math.abs(npvAt(projectCashFlows, projectIrrRate)) <= 1e-6,
    [
      'Expected the reported project IRR to zero the corresponding unlevered project cash flows.',
      `Observed NPV ${npvAt(projectCashFlows, projectIrrRate)} at ${projectResult.economics.projectIrr.toFixed(12)}%.`,
    ].join(' ')
  );
  assert.ok(
    Math.abs(npvAt(equityCashFlows, equityIrrRate)) <= 1e-6,
    [
      'Expected the reported equity IRR to zero the corresponding levered sponsor equity cash flows.',
      `Observed NPV ${npvAt(equityCashFlows, equityIrrRate)} at ${equityResult.economics.equityIrr.toFixed(12)}%.`,
    ].join(' ')
  );
});

test('approximateIRR keeps the largest positive root when multiple positive roots exist', () => {
  const lowerRootRate = 0.09;
  const upperRootRate = 0.24;
  const lowerDiscountFactor = 1 / (1 + lowerRootRate);
  const upperDiscountFactor = 1 / (1 + upperRootRate);
  const cashFlows = [
    -(lowerDiscountFactor * upperDiscountFactor),
    lowerDiscountFactor + upperDiscountFactor,
    -1,
  ];
  const reportedIrr = Calc.approximateIRR(cashFlows, 0.08);

  assert.ok(
    Math.abs(reportedIrr - (upperRootRate * 100)) <= 1e-9,
    [
      'Expected multi-root cash flows to report the largest positive IRR root for stability.',
      `Observed ${reportedIrr.toFixed(12)}% instead of ${(upperRootRate * 100).toFixed(12)}%.`,
    ].join(' ')
  );
});

test('30-year financed equity IRR stays on the upper branch until no real root remains', () => {
  const ninePointFivePercent = Calc.calculateAll(createState({
    financingEnabled: true,
    debtTermYears: 30,
    debtInterestRate: 9.5,
  })).economics;
  const ninePointSeventyFivePercent = Calc.calculateAll(createState({
    financingEnabled: true,
    debtTermYears: 30,
    debtInterestRate: 9.75,
  })).economics;
  const tenPointFivePercent = Calc.calculateAll(createState({
    financingEnabled: true,
    debtTermYears: 30,
    debtInterestRate: 10.5,
  })).economics;
  const tenPointSeventyFivePercent = Calc.calculateAll(createState({
    financingEnabled: true,
    debtTermYears: 30,
    debtInterestRate: 10.75,
  })).economics;

  assert.ok(
    ninePointSeventyFivePercent.equityIrr < ninePointFivePercent.equityIrr,
    [
      'Expected the upper positive equity IRR branch to keep decreasing as debt interest rises.',
      `Observed 9.5% -> ${ninePointFivePercent.equityIrr.toFixed(6)}% vs 9.75% -> ${ninePointSeventyFivePercent.equityIrr.toFixed(6)}%.`,
    ].join(' ')
  );
  assert.ok(
    tenPointFivePercent.equityIrr < ninePointSeventyFivePercent.equityIrr,
    [
      'Expected the financed 30-year case to keep following the same declining positive IRR branch at 10.5% debt interest.',
      `Observed 9.75% -> ${ninePointSeventyFivePercent.equityIrr.toFixed(6)}% vs 10.5% -> ${tenPointFivePercent.equityIrr.toFixed(6)}%.`,
    ].join(' ')
  );
  assert.ok(
    Math.abs(ninePointFivePercent.equityIrr - 25.0781235266443) <= 1e-6,
    `Expected the 9.5% debt-interest regression case to stay near a 25.078124% equity IRR, got ${ninePointFivePercent.equityIrr}.`
  );
  assert.ok(
    Math.abs(ninePointSeventyFivePercent.equityIrr - 23.98580764526344) <= 1e-6,
    `Expected the 9.75% debt-interest regression case to stay near a 23.985808% equity IRR, got ${ninePointSeventyFivePercent.equityIrr}.`
  );
  assert.ok(
    Math.abs(tenPointFivePercent.equityIrr - 19.570495416597528) <= 1e-6,
    `Expected the 10.5% debt-interest regression case to stay near a 19.570495% equity IRR, got ${tenPointFivePercent.equityIrr}.`
  );
  assert.ok(
    !Number.isFinite(tenPointSeventyFivePercent.equityIrr),
    `Expected the 10.75% debt-interest case to lose all real equity IRR roots, got ${tenPointSeventyFivePercent.equityIrr}.`
  );
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

  assert.equal(
    financedModel.canFullyCoverDebtService,
    false,
    'Expected a one-year debt term to outrun year-one operating cash flow and require sponsor support.'
  );
  assert.deepEqual(
    Array.from(financedModel.uncoveredDebtServiceYears),
    [1],
    `Expected only year 1 to need sponsor debt-service support, got ${JSON.stringify(financedModel.uncoveredDebtServiceYears)}.`
  );
  assert.equal(
    financedModel.firstUncoveredDebtServiceYear,
    1,
    `Expected year 1 to be the first uncovered debt-service year, got ${financedModel.firstUncoveredDebtServiceYear}.`
  );
  assert.equal(
    financedModel.uncoveredDebtServiceYearCount,
    1,
    `Expected exactly one uncovered debt-service year, got ${financedModel.uncoveredDebtServiceYearCount}.`
  );
  assert.ok(
    Math.abs(financedModel.sponsorSupportTotal - expectedSupport) <= 1e-6,
    [
      'Expected total modeled sponsor support to match the year-one debt-service shortfall.',
      `Observed ${formatMoney(financedModel.sponsorSupportTotal)} vs expected ${formatMoney(expectedSupport)}.`,
    ].join(' ')
  );
  assert.ok(
    Math.abs(financedModel.peakSponsorSupport - expectedSupport) <= 1e-6,
    [
      'Expected peak sponsor support to match the one uncovered year in the one-year debt case.',
      `Observed ${formatMoney(financedModel.peakSponsorSupport)} vs expected ${formatMoney(expectedSupport)}.`,
    ].join(' ')
  );
  assert.equal(
    financedModel.peakSponsorSupportYear,
    1,
    `Expected peak sponsor support in year 1, got ${financedModel.peakSponsorSupportYear}.`
  );
  assert.ok(
    Math.abs(yearOne.sponsorSupportNeeded - expectedSupport) <= 1e-6,
    [
      'Expected the yearly cash-flow view to expose the same sponsor support amount as the financing summary.',
      `Observed ${formatMoney(yearOne.sponsorSupportNeeded)} vs expected ${formatMoney(expectedSupport)}.`,
    ].join(' ')
  );
});

test('financing coverage metrics stay clear when operating cash flow covers debt service', () => {
  const economics = Calc.calculateAll(createState({
    financingEnabled: true,
    debtTermYears: 10,
  })).economics;
  const financedModel = economics.financing;

  assert.equal(
    financedModel.canFullyCoverDebtService,
    true,
    'Expected the 10-year debt case to keep scheduled debt service within operating cash flow in every debt year.'
  );
  assert.deepEqual(
    Array.from(financedModel.uncoveredDebtServiceYears),
    [],
    `Expected no uncovered debt-service years, got ${JSON.stringify(financedModel.uncoveredDebtServiceYears)}.`
  );
  assert.equal(
    financedModel.firstUncoveredDebtServiceYear,
    null,
    `Expected no first uncovered debt-service year, got ${financedModel.firstUncoveredDebtServiceYear}.`
  );
  assert.equal(
    financedModel.uncoveredDebtServiceYearCount,
    0,
    `Expected zero uncovered debt-service years, got ${financedModel.uncoveredDebtServiceYearCount}.`
  );
  assert.equal(financedModel.sponsorSupportTotal, 0, 'Expected no additional sponsor support when debt service stays covered.');
  assert.equal(financedModel.peakSponsorSupport, 0, 'Expected no peak sponsor support when debt service stays covered.');
  assert.equal(financedModel.peakSponsorSupportYear, null, 'Expected no peak sponsor support year when debt service stays covered.');
  assert.ok(
    economics.yearlyCashFlows.every(entry => entry.sponsorSupportNeeded === 0),
    'Expected every yearly cash-flow entry to report zero sponsor support when debt service stays covered.'
  );
});

test('cash-flow timeline starts at close and follows unlevered project cash', () => {
  const economics = Calc.calculateAll(createState({ analysisHorizonYears: 5 })).economics;
  const timeline = economics.cashFlowTimeline;
  const expectedLabels = ['Close', ...economics.yearlyCashFlows.map(entry => `Year ${entry.year}`)];

  assert.ok(timeline, 'Expected economics results to include a chart-ready cash-flow timeline.');
  assert.equal(timeline.financed, false, 'Expected the default timeline to stay unlevered.');
  assert.deepEqual(
    Array.from(timeline.labels),
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

test('legacy policy modes normalize to the consolidated incentive schemes', () => {
  const legacy45v = Calc.normalizeState({ policyMode: 'us_45v_tier2' });
  const legacy45q = Calc.normalizeState({ policyMode: 'us_45q_utilization' });
  const legacyEhb = Calc.normalizeState({
    policyMode: 'eu_hydrogen_bank',
    customH2Credit: 0.55,
  });

  assert.equal(legacy45v.policyMode, 'us_45v_h2', 'Expected legacy 45V modes to map onto the consolidated 45V scheme.');
  assert.ok(
    Math.abs(legacy45v.us45vHydrogenCreditPerKg - 0.75) <= 1e-9,
    `Expected legacy 45V tier 2 to seed $0.75/kg, got ${legacy45v.us45vHydrogenCreditPerKg}.`
  );
  assert.equal(legacy45q.policyMode, 'us_45q_dac', 'Expected legacy 45Q modes to map onto the consolidated 45Q DAC scheme.');
  assert.ok(
    Math.abs(legacy45q.us45qDacCreditPerTon - 130) <= 1e-9,
    `Expected legacy 45Q utilization to seed $130/tCO2, got ${legacy45q.us45qDacCreditPerTon}.`
  );
  assert.equal(legacyEhb.policyMode, 'eu_ehb_rfnbo', 'Expected the legacy Hydrogen Bank mode to map onto the new EU Hydrogen Bank scheme.');
  assert.ok(
    Math.abs(legacyEhb.euHydrogenBankPremiumPerKg - 0.55) <= 1e-9,
    `Expected the legacy Hydrogen Bank mode to preserve the prior custom H2 premium, got ${legacyEhb.euHydrogenBankPremiumPerKg}.`
  );
});

test('48E solar support reduces net capex at close and appears in the close bucket', () => {
  const economics = Calc.calculateAll(createState({
    policyMode: 'us_48e_solar',
    us48eSolarRate: 0.30,
  })).economics;
  const expectedSupport = economics.capex.solar * 0.30;

  assert.ok(
    Math.abs(economics.policy.upfrontSupport - expectedSupport) <= 1e-6,
    [
      'Expected 48E support to equal the configured share of solar CAPEX.',
      `Observed ${formatMoney(economics.policy.upfrontSupport)} vs expected ${formatMoney(expectedSupport)}.`,
    ].join(' ')
  );
  assert.ok(
    Math.abs(economics.netCapexAtClose - (economics.totalCapex - expectedSupport)) <= 1e-6,
    [
      'Expected close-date net CAPEX to equal gross CAPEX minus the 48E support.',
      `Observed ${formatMoney(economics.netCapexAtClose)} vs expected ${formatMoney(economics.totalCapex - expectedSupport)}.`,
    ].join(' ')
  );
  assert.equal(economics.revenue.policyCredits, 0, 'Expected 48E to stay a close-date capex support rather than annual operating revenue.');
  assert.ok(
    Math.abs(economics.cashFlowTimeline.annualPolicyCredits[0] - expectedSupport) <= 1e-6,
    'Expected the cash-flow timeline close bucket to show the upfront 48E support.'
  );
  assert.ok(
    Math.abs(economics.cashFlowTimeline.projectCashFlow[0] + economics.netCapexAtClose) <= 1e-6,
    'Expected project cash at close to start from the net CAPEX after 48E support.'
  );
});

test('45Y solar support scales directly with modeled annual solar output', () => {
  const economics = Calc.calculateAll(createState({
    policyMode: 'us_45y_solar',
    us45ySolarCreditPerKwh: 0.00363,
  })).economics;
  const expectedSupport = economics.policy.outputMetric.value * 0.00363;

  assert.equal(economics.policy.outputMetric.unit, 'kWh/yr', 'Expected 45Y to use solar output in kWh/year.');
  assert.ok(
    Math.abs(economics.revenue.policyCredits - expectedSupport) <= 1e-6,
    [
      'Expected 45Y support to equal annual solar generation times the configured $/kWh credit.',
      `Observed ${formatMoney(economics.revenue.policyCredits)} vs expected ${formatMoney(expectedSupport)}.`,
    ].join(' ')
  );
});

test('two-way solar CfD support can turn negative when reference price exceeds strike', () => {
  const economics = Calc.calculateAll(createState({
    policyMode: 'uk_cfd_solar_ar7',
    ukCfdSolarStrikePricePerMwh: 50,
    ukCfdSolarReferencePricePerMwh: 60,
  })).economics;
  const expectedSupport = economics.policy.outputMetric.value * (50 - 60);

  assert.ok(
    Math.abs(economics.revenue.policyCredits - expectedSupport) <= 1e-6,
    [
      'Expected the solar CfD support to equal annual solar output times strike minus reference price.',
      `Observed ${formatMoney(economics.revenue.policyCredits)} vs expected ${formatMoney(expectedSupport)}.`,
    ].join(' ')
  );
  assert.ok(economics.revenue.policyCredits < 0, 'Expected the modeled CfD support to go negative when the reference price exceeds strike.');
  assert.equal(economics.cashFlowTimeline.hasPolicyCredits, true, 'Expected negative incentive support to still keep the policy-support series visible.');
  assert.ok(
    economics.cashFlowTimeline.annualPolicyCredits.slice(1, 21).every(value => value < 0),
    'Expected the active CfD years to stay negative when the reference price exceeds strike.'
  );
  assert.ok(
    economics.cashFlowTimeline.annualPolicyCredits.slice(21).every(value => Math.abs(value) <= 1e-9),
    'Expected the modeled CfD support to stop after the 20-year support window ends.'
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

test('optimizer progress callback reports monotonic approximate completion', () => {
  const updates = [];
  const result = Calc.findBestRangeValueForIrr(
    createState(),
    {
      stateKey: 'methaneFeedstockSplit',
      min: 0,
      max: 100,
      step: 1,
      currentValue: 50,
      maxCoarseSamples: 101,
      maxTopRegions: 5,
    },
    {
      onProgress(progress) {
        updates.push(progress);
      },
    }
  );

  assert.ok(result === null || Number.isFinite(result.bestValue), 'Expected optimizer search to either improve the value or report no better candidate.');
  assert.ok(updates.length >= 3, 'Expected optimizer progress to report multiple updates.');
  assert.equal(updates[0].percent, 0, 'Expected optimizer progress to start at 0%.');
  assert.equal(updates[updates.length - 1].percent, 100, 'Expected optimizer progress to end at 100%.');
  assert.ok(
    updates.some(update => update.percent > 0 && update.percent < 100),
    'Expected optimizer progress to include at least one intermediate percentage.'
  );
  assert.ok(
    updates.every((update, index) => index === 0 || update.percent >= updates[index - 1].percent),
    'Expected optimizer progress percentages to be monotonic.'
  );
});

test('default 0 to 0.5 MWh battery sweep does not reduce total capex', () => {
  const [withoutBattery, withSmallBattery] = runBatterySweep([0, 0.5]);
  const expectedBatteryCapex = 0.5 * 1000 * createState().batteryCostPerKWh;

  assert.equal(
    withSmallBattery.batteryCapex,
    expectedBatteryCapex,
    `Expected 0.5 MWh of storage to add ${formatMoney(expectedBatteryCapex)} of battery CAPEX.`
  );

  assert.ok(
    withSmallBattery.totalCapex >= withoutBattery.totalCapex,
    [
      'Expected total CAPEX to stay flat or rise when battery moves from 0 to 0.5 MWh under defaults.',
      `Observed ${formatMoney(withoutBattery.totalCapex)} -> ${formatMoney(withSmallBattery.totalCapex)}.`,
    ].join(' ')
  );

  assert.ok(
    withSmallBattery.processCapex < withoutBattery.processCapex,
    [
      'Small storage should reduce downstream process sizing in the current model.',
      `Observed process CAPEX ${formatMoney(withoutBattery.processCapex)} -> ${formatMoney(withSmallBattery.processCapex)}.`,
    ].join(' ')
  );

  assert.ok(
    withSmallBattery.processPowerKW < withoutBattery.processPowerKW,
    `Expected process power to smooth downward with storage, got ${withoutBattery.processPowerKW.toFixed(1)} -> ${withSmallBattery.processPowerKW.toFixed(1)} kW.`
  );
});

test('no-battery process sizing follows the modeled direct-solar peak', () => {
  const result = runScenario({ systemSizeMW: 100, batteryCapacityMWh: 0 });
  const modeledDirectSolarPeakKW = Math.max(...result.chemicalSupply.hourlyKW, 0);

  assert.ok(
    Math.abs(result.chemicalSupply.processPowerKW - modeledDirectSolarPeakKW) <= 1e-6,
    [
      'Expected the no-battery process cap to match the modeled direct-solar peak.',
      `Observed ${result.chemicalSupply.processPowerKW.toFixed(3)} kW vs ${modeledDirectSolarPeakKW.toFixed(3)} kW.`,
    ].join(' ')
  );
});

test('buffered electricity cost matches solar lcoe when all solar is used without storage', () => {
  const result = runScenario({
    systemSizeMW: 100,
    batteryCapacityMWh: 0,
    chemicalSizingPercent: 100,
    aiComputeEnabled: false,
    electrolyzerEnabled: false,
    dacEnabled: false,
    sabatierEnabled: false,
    methanolEnabled: false,
  });

  assert.ok(
    Math.abs(result.economics.bufferedElectricityCostPerMWh - result.solar.lcoe) <= 1e-9,
    [
      'Expected the buffered electricity cost to collapse to the base solar LCOE when storage is off and the modeled load uses the full solar output.',
      `Observed buffered ${result.economics.bufferedElectricityCostPerMWh.toFixed(12)} vs solar ${result.solar.lcoe.toFixed(12)} $/MWh.`,
    ].join(' ')
  );
});

test('buffered electricity cost includes battery annualized cost and storage losses', () => {
  const result = runScenario({
    systemSizeMW: 100,
    batteryCapacityMWh: 24,
    chemicalSizingPercent: 100,
    aiComputeEnabled: false,
    electrolyzerEnabled: false,
    dacEnabled: false,
    sabatierEnabled: false,
    methanolEnabled: false,
  });
  const state = result.state;
  const batteryOmFrac = (state.batteryOmPercent ?? 1.5) / 100;
  const expectedAnnualCost = result.solar.annualizedSolar +
    result.solar.annualSolarOm +
    result.storage.annualizedCapex +
    (result.storage.capex * batteryOmFrac);
  const degradationFactor = Calc.getAverageSolarDegradationFactor(state.panelDegradationAnnual, state.solarAssetLife);
  const expectedLifetimeAverageAnnualMWh = ((result.chemicalSupply.dailyAvailableKWh * result.solar.cyclesPerYear) / 1000) * degradationFactor;
  const expectedBufferedElectricityCost = expectedLifetimeAverageAnnualMWh > 0
    ? expectedAnnualCost / expectedLifetimeAverageAnnualMWh
    : 0;

  assert.ok(
    Math.abs(result.economics.bufferedElectricityAnnualCost - expectedAnnualCost) <= 1e-6,
    [
      'Expected the buffered electricity annual cost to include solar annualization, solar O&M, battery annualization, and battery O&M.',
      `Observed ${result.economics.bufferedElectricityAnnualCost.toFixed(6)} vs expected ${expectedAnnualCost.toFixed(6)} USD/yr.`,
    ].join(' ')
  );
  assert.ok(
    Math.abs(result.economics.bufferedElectricityLifetimeAverageAnnualMWh - expectedLifetimeAverageAnnualMWh) <= 1e-9,
    [
      'Expected the buffered electricity denominator to use lifetime-average delivered MWh after storage losses.',
      `Observed ${result.economics.bufferedElectricityLifetimeAverageAnnualMWh.toFixed(12)} vs expected ${expectedLifetimeAverageAnnualMWh.toFixed(12)} MWh/yr.`,
    ].join(' ')
  );
  assert.ok(
    Math.abs(result.economics.bufferedElectricityCostPerMWh - expectedBufferedElectricityCost) <= 1e-9,
    [
      'Expected the buffered electricity cost to equal annualized solar-plus-battery cost divided by lifetime-average delivered MWh.',
      `Observed ${result.economics.bufferedElectricityCostPerMWh.toFixed(12)} vs expected ${expectedBufferedElectricityCost.toFixed(12)} $/MWh.`,
    ].join(' ')
  );
});

test('buffered electricity cost counts AI-served electricity in AI mode', () => {
  const result = runScenario({
    systemSizeMW: 100,
    batteryCapacityMWh: 24,
    aiComputeEnabled: true,
    aiReliabilityTarget: 95,
  });
  const expectedAnnualDeliveredMWh = (result.ai.annualAiServedKWh + result.ai.chemicalAnnualKWh) / 1000;

  assert.ok(result.ai.annualAiServedKWh > 0, 'Expected AI mode to report a non-zero annual AI-served electricity total.');
  assert.ok(
    Math.abs(result.economics.bufferedElectricityAnnualDeliveredMWh - expectedAnnualDeliveredMWh) <= 1e-9,
    [
      'Expected the buffered electricity metric to count total delivered electricity in AI mode, including the AI-served share.',
      `Observed ${result.economics.bufferedElectricityAnnualDeliveredMWh.toFixed(12)} vs expected ${expectedAnnualDeliveredMWh.toFixed(12)} MWh/yr.`,
    ].join(' ')
  );
});

test('undersizing the no-battery chemical plant clips the modeled solar peak', () => {
  const fullCapture = runScenario({ systemSizeMW: 100, batteryCapacityMWh: 0, chemicalSizingPercent: 100 });
  const undersized = runScenario({ systemSizeMW: 100, batteryCapacityMWh: 0, chemicalSizingPercent: 70 });

  assert.ok(
    Math.abs(undersized.chemicalSupply.processPowerKW - (fullCapture.chemicalSupply.processPowerKW * 0.7)) <= 1e-6,
    [
      'Expected the no-battery process cap to scale from the full-capture peak.',
      `Observed ${undersized.chemicalSupply.processPowerKW.toFixed(3)} kW vs expected ${(fullCapture.chemicalSupply.processPowerKW * 0.7).toFixed(3)} kW.`,
    ].join(' ')
  );
  assert.ok(
    undersized.chemicalSupply.clippedDailyKWh > 0,
    `Expected undersizing to clip some solar energy, got ${undersized.chemicalSupply.clippedDailyKWh.toFixed(6)} kWh/day.`
  );
  assert.ok(
    undersized.chemicalSupply.dailyAvailableKWh < fullCapture.chemicalSupply.dailyAvailableKWh,
    [
      'Expected undersizing to reduce delivered chemical energy when no battery is present.',
      `Observed ${fullCapture.chemicalSupply.dailyAvailableKWh.toFixed(3)} -> ${undersized.chemicalSupply.dailyAvailableKWh.toFixed(3)} kWh/day.`,
    ].join(' ')
  );
});

test('undersizing the battery-backed chemical plant preserves the full-capture reference and introduces clipping', () => {
  const fullCapture = runScenario({ systemSizeMW: 100, batteryCapacityMWh: 24, chemicalSizingPercent: 100 });
  const undersized = runScenario({ systemSizeMW: 100, batteryCapacityMWh: 24, chemicalSizingPercent: 70 });

  assert.ok(
    Math.abs(undersized.chemicalSupply.fullCapturePowerKW - fullCapture.chemicalSupply.processPowerKW) <= 1e-3,
    [
      'Expected the battery-backed full-capture reference to stay available after undersizing.',
      `Observed ${undersized.chemicalSupply.fullCapturePowerKW.toFixed(3)} kW vs ${fullCapture.chemicalSupply.processPowerKW.toFixed(3)} kW.`,
    ].join(' ')
  );
  assert.ok(
    undersized.chemicalSupply.processPowerKW < fullCapture.chemicalSupply.processPowerKW,
    `Expected undersizing to reduce the battery-backed process cap, got ${fullCapture.chemicalSupply.processPowerKW.toFixed(3)} -> ${undersized.chemicalSupply.processPowerKW.toFixed(3)} kW.`
  );
  assert.ok(
    undersized.chemicalSupply.clippedDailyKWh > 0,
    `Expected battery-backed undersizing to clip some solar energy, got ${undersized.chemicalSupply.clippedDailyKWh.toFixed(6)} kWh/day.`
  );
  assert.ok(
    undersized.chemicalSupply.capturedSolarFraction < 0.999,
    `Expected captured-solar fraction to fall below 100%, got ${(undersized.chemicalSupply.capturedSolarFraction * 100).toFixed(3)}%.`
  );
});

test('specific-day selector no longer changes annual non-ai sizing or economics', () => {
  const average = runScenario({
    systemSizeMW: 100,
    batteryCapacityMWh: 0,
    chemicalSizingPercent: 72,
    dayMode: 'average',
    dayOfYear: 355,
  });
  const specific = runScenario({
    systemSizeMW: 100,
    batteryCapacityMWh: 0,
    chemicalSizingPercent: 72,
    dayMode: 'specific',
    dayOfYear: 355,
  });

  assert.ok(
    Math.abs(specific.chemicalSupply.processPowerKW - average.chemicalSupply.processPowerKW) <= 1e-6,
    [
      'Expected the specific-day selector to leave annual process sizing unchanged.',
      `Observed ${average.chemicalSupply.processPowerKW.toFixed(6)} kW vs ${specific.chemicalSupply.processPowerKW.toFixed(6)} kW.`,
    ].join(' ')
  );
  assert.ok(
    Math.abs(specific.chemicalSupply.dailyAvailableKWh - average.chemicalSupply.dailyAvailableKWh) <= 1e-6,
    [
      'Expected the specific-day selector to leave annual-average chemical energy unchanged.',
      `Observed ${average.chemicalSupply.dailyAvailableKWh.toFixed(6)} vs ${specific.chemicalSupply.dailyAvailableKWh.toFixed(6)} kWh/day.`,
    ].join(' ')
  );
  assert.ok(
    Math.abs(specific.economics.irr - average.economics.irr) <= 1e-12,
    [
      'Expected the specific-day selector to avoid perturbing annual project returns.',
      `Observed ${average.economics.irr.toFixed(12)} vs ${specific.economics.irr.toFixed(12)}.`,
    ].join(' ')
  );
});

test('annual chemical day slices show winter no-clipping against a fixed undersized cap', () => {
  const result = runScenario({
    systemSizeMW: 100,
    batteryCapacityMWh: 0,
    chemicalSizingPercent: 72,
  });
  const displayDispatch = result.annualChemicalDisplayDispatch;

  assert.ok(displayDispatch, 'Expected a day-slice chemistry dispatch series for specific-day visualization.');
  assert.equal(
    displayDispatch.dailyClippedKWh.length,
    365,
    `Expected Earth day-slice clipping series to expose 365 daily buckets, got ${displayDispatch.dailyClippedKWh.length}.`
  );
  assert.ok(
    displayDispatch.dailyClippedKWh[354] <= 1e-6,
    [
      'Expected the winter-solstice day to stay below the fixed annual process cap in this undersized case.',
      `Observed ${displayDispatch.dailyClippedKWh[354].toFixed(6)} kWh/day clipped on Dec 21.`,
    ].join(' ')
  );
  assert.ok(
    displayDispatch.dailyClippedKWh[171] > 0,
    [
      'Expected the same fixed annual process cap to clip a sunnier summer day.',
      `Observed ${displayDispatch.dailyClippedKWh[171].toFixed(6)} kWh/day clipped on Jun 21.`,
    ].join(' ')
  );
});

test('100 MW 0 to 0.5 MWh battery sweep does not reduce total capex', () => {
  const [withoutBattery, withSmallBattery] = runBatterySweep([0, 0.5], { systemSizeMW: 100 });
  const expectedBatteryCapex = 0.5 * 1000 * createState().batteryCostPerKWh;

  assert.equal(
    withSmallBattery.batteryCapex,
    expectedBatteryCapex,
    `Expected 0.5 MWh of storage to add ${formatMoney(expectedBatteryCapex)} of battery CAPEX.`
  );

  assert.ok(
    withSmallBattery.totalCapex >= withoutBattery.totalCapex,
    [
      'Expected total CAPEX to stay flat or rise when battery moves from 0 to 0.5 MWh on a 100 MW array.',
      `Observed ${formatMoney(withoutBattery.totalCapex)} -> ${formatMoney(withSmallBattery.totalCapex)}.`,
    ].join(' ')
  );
});

test('ai reliability target sizes against full-rate uptime', () => {
  const result = runScenario({ aiComputeEnabled: true, batteryCapacityMWh: 2, aiReliabilityTarget: 90 });

  assert.ok(result.ai.designLoadKW > 0, 'Expected the AI optimizer to find a non-zero load in this scenario.');
  assert.ok(
    result.ai.fullPowerReliability >= 0.899,
    [
      'Expected AI sizing to satisfy the configured full-rate reliability target.',
      `Observed ${(result.ai.fullPowerReliability * 100).toFixed(3)}% vs target ${result.ai.reliabilityTarget.toFixed(1)}%.`,
    ].join(' ')
  );
});

test('ai mode seeds zero battery from annual solar GWh', () => {
  const result = runScenario({ aiComputeEnabled: true, batteryCapacityMWh: 0 });
  const expectedBatteryMWh = result.solar.annualMWh / 1000;

  assert.ok(
    Math.abs(result.state.batteryCapacityMWh - expectedBatteryMWh) <= 1e-9,
    [
      'Expected AI mode to replace a zero battery entry with the annual-solar-GWh heuristic.',
      `Observed ${result.state.batteryCapacityMWh.toFixed(6)} MWh vs ${expectedBatteryMWh.toFixed(6)} MWh.`,
    ].join(' ')
  );
  assert.equal(result.storage.enabled, expectedBatteryMWh > 1e-9, 'Expected the seeded AI battery heuristic to enable storage.');
});

test('ai mode preserves explicit non-zero battery sizing', () => {
  const result = runScenario({ aiComputeEnabled: true, batteryCapacityMWh: 24 });

  assert.equal(
    result.state.batteryCapacityMWh,
    24,
    'Expected an explicit AI battery size to override the zero-battery heuristic.'
  );
});

test('ai-only 1 GW zero-battery entry seeds a larger and worse battery than nearby explicit capacities', () => {
  const baseOverrides = {
    systemSizeMW: 1000,
    loadConfigTab: 'ai',
    aiComputeEnabled: true,
    electrolyzerEnabled: false,
    dacEnabled: false,
    sabatierEnabled: false,
    methanolEnabled: false,
  };
  const zeroEntry = runScenario({ ...baseOverrides, batteryCapacityMWh: 0 });
  const sampledCandidates = [1200, 1400, 1600].map(batteryCapacityMWh => ({
    batteryCapacityMWh,
    result: runScenario({ ...baseOverrides, batteryCapacityMWh }),
  }));
  const bestSample = sampledCandidates.reduce((best, candidate) => (
    !best || candidate.result.economics.irr > best.result.economics.irr ? candidate : best
  ), null);

  assert.ok(
    zeroEntry.state.batteryCapacityMWh > 1000,
    [
      'Expected the visible 0 MWh AI-only entry to seed a large implicit battery before optimization.',
      `Observed ${zeroEntry.state.batteryCapacityMWh.toFixed(3)} MWh.`,
    ].join(' ')
  );
  assert.ok(bestSample, 'Expected to collect at least one explicit battery candidate for comparison.');
  assert.ok(
    bestSample.result.economics.irr > zeroEntry.economics.irr + 0.1,
    [
      'Expected a nearby explicit battery size to beat the zero-entry AI heuristic in the 1 GW AI-only case.',
      `Observed zero-entry IRR ${zeroEntry.economics.irr.toFixed(6)}% from an implicit ${zeroEntry.state.batteryCapacityMWh.toFixed(3)} MWh battery,`,
      `best sampled explicit point ${bestSample.batteryCapacityMWh.toFixed(1)} MWh -> ${bestSample.result.economics.irr.toFixed(6)}%.`,
    ].join(' ')
  );
  assert.ok(
    bestSample.batteryCapacityMWh < zeroEntry.state.batteryCapacityMWh,
    [
      'Expected the better nearby explicit capacity to be smaller than the implicit zero-entry battery.',
      `Observed ${bestSample.batteryCapacityMWh.toFixed(1)} MWh vs ${zeroEntry.state.batteryCapacityMWh.toFixed(3)} MWh.`,
    ].join(' ')
  );
});

test('ai storage summary reflects the settled annual dispatch state', () => {
  const result = runScenario({ aiComputeEnabled: true, batteryCapacityMWh: 24, aiReliabilityTarget: 95 });
  const settleToleranceKWh = Math.max(1e-3, result.storage.battCapKWh * 1e-6) + 1e-6;

  assert.equal(result.storage.enabled, true, 'Expected battery storage to stay enabled for this AI dispatch scenario.');
  assert.ok(
    Math.abs(result.storage.startBatteryKWh - result.ai.dispatch.startSocKWh) <= settleToleranceKWh,
    'Expected the storage summary to report the same settled starting SOC as the annual dispatch.'
  );
  assert.ok(
    Math.abs(result.storage.endBatteryKWh - result.ai.dispatch.endSocKWh) <= settleToleranceKWh,
    'Expected the storage summary to report the same ending SOC as the annual dispatch.'
  );
  assert.ok(
    Math.abs(result.storage.endBatteryKWh - result.storage.startBatteryKWh) <= settleToleranceKWh,
    [
      'Expected the settled annual dispatch to start and end at nearly the same SOC.',
      `Observed ${result.storage.startBatteryKWh.toFixed(4)} -> ${result.storage.endBatteryKWh.toFixed(4)} kWh.`,
    ].join(' ')
  );
  assert.ok(
    result.storage.utilizedCapacityKWh <= result.storage.battCapKWh + 1e-6,
    'Utilized storage capacity should never exceed the installed battery capacity.'
  );
});

test('fractional cycle aggregation splits edge hours proportionally', () => {
  const aggregated = Calc.aggregateSeriesBySpanHours([10, 20, 30, 40], 1.5);

  assert.equal(aggregated.length, 3, 'Expected 4 hourly samples split into three 1.5-hour windows.');
  assert.ok(Math.abs(aggregated[0] - 20) <= 1e-9, `Expected first fractional window to total 20 kWh, got ${aggregated[0]}.`);
  assert.ok(Math.abs(aggregated[1] - 40) <= 1e-9, `Expected middle fractional window to total 40 kWh, got ${aggregated[1]}.`);
  assert.ok(Math.abs(aggregated[2] - 40) <= 1e-9, `Expected trailing partial window to total 40 kWh, got ${aggregated[2]}.`);
});

test('off-earth ai dispatch follows local cycles instead of Earth days', () => {
  const mars = runScenario({ body: 'mars', aiComputeEnabled: true, batteryCapacityMWh: 24, aiReliabilityTarget: 95 });
  const moon = runScenario({ body: 'moon', aiComputeEnabled: true, batteryCapacityMWh: 24, aiReliabilityTarget: 95 });

  const marsEarlyDistinctHours = new Set(mars.annualSolar.hourlyKW.slice(0, 48).map(value => value.toFixed(6))).size;
  const moonEarlyDistinctHours = new Set(moon.annualSolar.hourlyKW.slice(0, 100).map(value => value.toFixed(6))).size;

  assert.ok(
    marsEarlyDistinctHours > 1,
    'Expected the Mars annual solar driver to vary within the first two Earth days rather than staying flat.'
  );
  assert.ok(
    moonEarlyDistinctHours > 1,
    'Expected the Moon annual solar driver to vary within the first hundred Earth hours rather than stretching one local-cycle bin across the year.'
  );

  assert.ok(
    mars.annualSolar.dayLabels.length >= 355 && mars.annualSolar.dayLabels.length <= 356,
    `Expected Mars annual AI labels to follow sols rather than 365 Earth days; observed ${mars.annualSolar.dayLabels.length}.`
  );
  assert.ok(
    moon.annualSolar.dayLabels.length >= 12 && moon.annualSolar.dayLabels.length <= 13,
    `Expected Moon annual AI labels to follow lunar cycles rather than 365 Earth days; observed ${moon.annualSolar.dayLabels.length}.`
  );
  assert.equal(
    mars.ai.dispatch.dailyAiKWh.length,
    mars.ai.dispatch.dayLabels.length,
    'Expected the Mars AI dispatch buckets to stay aligned with the modeled sol labels.'
  );
  assert.equal(
    moon.ai.dispatch.dailyAiKWh.length,
    moon.annualSolar.dayLabels.length,
    'Expected the Moon AI dispatch buckets to stay aligned with the local-cycle labels.'
  );
  assert.equal(mars.annualSolar.seasonalVariation, true, 'Expected Mars annual solar to mark that it now carries modeled seasonal variation.');
  assert.equal(moon.annualSolar.seasonalVariation, false, 'Expected the Moon annual solar path to remain a repeated representative cycle.');
  assert.match(mars.annualSolar.dayLabels[0], /^Sol 1/, 'Expected Mars cycle labels to start with sols.');
  assert.match(moon.annualSolar.dayLabels[0], /^Cycle 1/, 'Expected lunar cycle labels to start with generic cycle labels.');
});

test('lunar polar proxy stays mostly on with short shadow outages', () => {
  const moon = runScenario({ body: 'moon' });
  const profile = moon.annualSolar.averageDayKW;
  const peak = Math.max(...profile, 0);
  const litThreshold = peak * 0.02;
  const litValues = profile.filter(value => value > litThreshold).sort((a, b) => a - b);
  const lowerQuartile = litValues[Math.floor((litValues.length - 1) * 0.25)] || 0;
  const zeroBins = profile.filter(value => value <= litThreshold).length;

  assert.ok(
    moon.solar.sunHours >= moon.solar.cycleHours * 0.75 && moon.solar.sunHours <= moon.solar.cycleHours * 0.90,
    [
      'Expected the lunar peak-of-eternal-light proxy to stay mostly illuminated, but not report a full-cycle day.',
      `Observed ${moon.solar.sunHours.toFixed(2)} of ${moon.solar.cycleHours.toFixed(2)} hours illuminated per cycle.`,
    ].join(' ')
  );
  assert.ok(
    zeroBins >= 2 && zeroBins <= 4,
    `Expected short lunar shadow outages rather than a long half-cycle blackout; observed ${zeroBins} near-zero bins in the representative cycle.`
  );
  assert.ok(
    peak > 0 && (lowerQuartile / peak) >= 0.4,
    [
      'Expected the lit portion of the lunar profile to stay relatively flat instead of collapsing into a single broad hump.',
      `Observed a lower-quartile output of ${(lowerQuartile / Math.max(peak, 1e-9)).toFixed(3)}x the peak.`,
    ].join(' ')
  );
});

test('mars annual dispatch exposes a finite full-orbit display series', () => {
  const mars = runScenario({ body: 'mars', aiComputeEnabled: true, batteryCapacityMWh: 24, aiReliabilityTarget: 95 });
  const displayLabels = mars.ai.dispatch.displayDayLabels || [];
  const displayAi = mars.ai.dispatch.displayDailyAiKWh || [];
  const displayChemical = mars.ai.dispatch.displayDailyChemicalKWh || [];

  assert.ok(
    displayLabels.length >= 668 && displayLabels.length <= 669,
    `Expected Mars annual dispatch charts to cover one Mars year; observed ${displayLabels.length} sols.`
  );
  assert.equal(
    displayAi.length,
    displayLabels.length,
    'Expected the Mars display AI buckets to stay aligned with the full-orbit sol labels.'
  );
  assert.equal(
    displayChemical.length,
    displayLabels.length,
    'Expected the Mars display chemical buckets to stay aligned with the full-orbit sol labels.'
  );
  assert.ok(
    displayLabels.length === mars.ai.dispatch.dayLabels.length,
    'Expected the Mars chart display series to stay aligned with the dispatch horizon used for sizing.'
  );
  assert.match(displayLabels[0], /^Sol 1/, 'Expected Mars full-orbit chart labels to begin with the first sol.');
  assert.match(
    displayLabels[displayLabels.length - 1],
    /^Sol 669 \(partial\)$/,
    'Expected the Mars full-orbit chart series to end at a bounded partial sol rather than an open-ended sequence.'
  );
  assert.equal(mars.ai.dispatch.dispatchBasisLabel, 'orbital-year', 'Expected Mars AI dispatch to size against a full orbital-year basis.');
});

test('mars ai reliability target matches the full-orbit display horizon', () => {
  const mars = runScenario({ body: 'mars', aiComputeEnabled: true, batteryCapacityMWh: 24, aiReliabilityTarget: 99.9 });
  const displayAi = (mars.ai.dispatch.displayDailyAiKWh || []).slice(0, -1);
  const fullSolKWh = mars.ai.designLoadKW * Calc.getBodyConfig('mars').cycleHours;
  const minServedFraction = displayAi.length > 0 ? Math.min(...displayAi) / Math.max(fullSolKWh, 1e-9) : 0;

  assert.ok(
    mars.ai.fullPowerReliability >= 0.9989,
    [
      'Expected Mars AI sizing to satisfy the configured reliability target over the full displayed orbital year.',
      `Observed ${(mars.ai.fullPowerReliability * 100).toFixed(3)}% vs target ${mars.ai.reliabilityTarget.toFixed(1)}%.`,
    ].join(' ')
  );
  assert.ok(
    minServedFraction > 0.95,
    [
      'Expected the full-orbit Mars annual dispatch chart to stay close to flat at a 99.9% reliability target.',
      `Observed a minimum served fraction of ${(minServedFraction * 100).toFixed(2)}% of full-sol AI energy.`,
    ].join(' ')
  );
});

test('mars annual solar carries a meaningful seasonal swing', () => {
  const mars = runScenario({ body: 'mars' });
  const fullSolSeriesKWh = mars.annualSolar.dailyKWh.slice(0, -1);
  const seasonalMin = Math.min(...fullSolSeriesKWh);
  const seasonalMax = Math.max(...fullSolSeriesKWh);
  const swingRatio = seasonalMin > 0 ? seasonalMax / seasonalMin : Infinity;

  assert.ok(
    swingRatio > 1.2,
    [
      'Expected the updated Mars annual solar model to show a clear orbital-seasonal swing over the modeled Earth-year slice.',
      `Observed ${seasonalMin.toFixed(3)} to ${seasonalMax.toFixed(3)} kWh/sol, a ${swingRatio.toFixed(3)}x swing.`,
    ].join(' ')
  );
});

test('invalid inputs are normalized before calculations run', () => {
  const result = runScenario({
    body: 'pluto',
    mountingType: 'bogus',
    batteryCapacityMWh: -5,
    batteryEfficiency: 150,
    electrolyzerEfficiency: 0,
    dacEnergy: 0,
    analysisHorizonYears: -3,
    debtTermYears: 999,
    discountRate: Number.NaN,
    methanePrice: -10,
  });

  assert.equal(result.state.body, createState().body, 'Invalid body keys should fall back to the default body.');
  assert.equal(
    result.state.mountingType,
    createState().mountingType,
    'Invalid mounting types should fall back to the default mounting.'
  );
  assert.equal(result.storage.enabled, false, 'Negative battery capacity should normalize to zero storage.');
  assert.ok(Number.isFinite(result.economics.totalCapex), 'Normalized scenarios should still produce finite CAPEX.');
  assert.ok(Number.isFinite(result.economics.totalAnnualRevenue), 'Normalized scenarios should still produce finite revenue.');
});

test('feed-buffer toggles default on for buffer-capable modules', () => {
  const state = createState();

  assert.equal(state.sabatierBufferEnabled, true, 'Expected Sabatier feed buffering to default on.');
  assert.equal(state.methanolBufferEnabled, true, 'Expected methanol feed buffering to default on.');
  assert.equal(state.mtgBufferEnabled, true, 'Expected MTG feed buffering to default on.');
  assert.equal(state.carbonMonoxideBufferEnabled, true, 'Expected CO route feed buffering to default on when supported.');
  assert.equal(state.ammoniaBufferEnabled, true, 'Expected ammonia feed buffering to default on when supported.');
});

test('enabled downstream modules auto-enable their upstream process dependencies', () => {
  const mtgState = Calc.normalizeState(createState({
    mtgEnabled: true,
    methanolEnabled: false,
    electrolyzerEnabled: false,
    dacEnabled: false,
  }));
  const rwgsState = Calc.normalizeState(createState({
    carbonMonoxideEnabled: true,
    carbonMonoxideRoute: 'rwgs',
    electrolyzerEnabled: false,
    dacEnabled: false,
  }));
  const lowTempCoState = Calc.normalizeState(createState({
    carbonMonoxideEnabled: true,
    carbonMonoxideRoute: 'low-temp-electrolysis',
    sabatierEnabled: false,
    methanolEnabled: false,
    electrolyzerEnabled: false,
    dacEnabled: false,
  }));

  assert.equal(mtgState.mtgEnabled, true, 'Expected MTG to stay enabled.');
  assert.equal(mtgState.methanolEnabled, true, 'Expected MTG to auto-enable methanol.');
  assert.equal(mtgState.electrolyzerEnabled, true, 'Expected methanol-dependent MTG to auto-enable the electrolyzer chain.');
  assert.equal(mtgState.dacEnabled, true, 'Expected methanol-dependent MTG to auto-enable DAC.');

  assert.equal(rwgsState.carbonMonoxideEnabled, true, 'Expected the CO module to stay enabled.');
  assert.equal(rwgsState.dacEnabled, true, 'Expected CO production to auto-enable DAC.');
  assert.equal(rwgsState.electrolyzerEnabled, true, 'Expected the RWGS route to auto-enable electrolyzer feed.');

  assert.equal(lowTempCoState.carbonMonoxideEnabled, true, 'Expected the low-temp CO route to stay enabled.');
  assert.equal(lowTempCoState.dacEnabled, true, 'Expected every CO route to auto-enable DAC.');
  assert.equal(lowTempCoState.electrolyzerEnabled, false, 'Expected non-RWGS CO routes to avoid forcing the electrolyzer.');
});

test('mtg exploratory module preserves its route and reports rough modeled output', () => {
  const baseline = runScenario({ methanolEnabled: true });
  const withMtg = runScenario({ methanolEnabled: false, mtgEnabled: true, mtgRoute: 'fluid-bed' });
  const mtg = withMtg.exploratoryModules.find(module => module.id === 'mtg');
  const mtgEconomics = withMtg.economics.exploratoryDetails.find(module => module.id === 'mtg');

  assert.ok(mtg, 'Expected the MTG experimental module to be present in exploratory results.');
  assert.equal(mtg.enabled, true, 'Expected MTG to reflect the enabled toggle.');
  assert.equal(mtg.route, 'fluid-bed', 'Expected MTG to preserve the selected exploratory route.');
  assert.equal(mtg.diagramInputs?.methanol, true, 'Expected MTG to advertise methanol as a required diagram input.');
  assert.equal(withMtg.state.methanolEnabled, true, 'Expected MTG to auto-enable methanol in the normalized state.');
  assert.ok(mtg.outputDailyUnits > 0, 'Expected MTG to report a non-zero rough output when methanol is available.');
  assert.ok(mtg.capex > 0, 'Expected MTG to report a rough CAPEX estimate.');
  assert.ok(mtgEconomics, 'Expected MTG to appear in the exploratory economics breakdown.');
  assert.ok(mtgEconomics.capex > 0, 'Expected MTG CAPEX to flow into project economics.');
  assert.ok(mtgEconomics.annualRevenue > 0, 'Expected MTG revenue to flow into project economics.');
  assert.ok(
    withMtg.economics.modeledExploratoryModules.includes('MTG (Methanol -> Gasoline)'),
    'Expected MTG to appear in the modeled exploratory route list.'
  );
  assert.ok(
    withMtg.economics.capex.exploratory > 0,
    'Expected exploratory CAPEX to contribute to total project CAPEX.'
  );
  assert.ok(
    withMtg.methanol.exportAnnualTons < baseline.methanol.annualTons,
    'Expected MTG to divert part of the gross methanol stream away from export.'
  );
});

test('exploratory economics honor custom capex, sale price, and o&m inputs', () => {
  const lowCase = runScenario({
    methanolEnabled: false,
    mtgEnabled: true,
    mtgRoute: 'fluid-bed',
    mtgCapexBasis: 200,
    mtgPrice: 600,
    exploratoryOmPercent: 1,
  });
  const highCase = runScenario({
    methanolEnabled: false,
    mtgEnabled: true,
    mtgRoute: 'fluid-bed',
    mtgCapexBasis: 1200,
    mtgPrice: 1200,
    exploratoryOmPercent: 10,
  });

  const lowMtg = lowCase.economics.exploratoryDetails.find(module => module.id === 'mtg');
  const highMtg = highCase.economics.exploratoryDetails.find(module => module.id === 'mtg');

  assert.ok(lowMtg, 'Expected the low-input MTG case to produce exploratory economics details.');
  assert.ok(highMtg, 'Expected the high-input MTG case to produce exploratory economics details.');
  assert.equal(lowMtg.unitPrice, 600, 'Expected the exploratory unit price to track the configured sale price.');
  assert.equal(highMtg.unitPrice, 1200, 'Expected the exploratory unit price to track the configured sale price.');
  assert.ok(highMtg.capex > lowMtg.capex, 'Expected MTG CAPEX to rise with the configured CAPEX basis.');
  assert.ok(highMtg.annualRevenue > lowMtg.annualRevenue, 'Expected MTG revenue to rise with the configured sale price.');
  assert.ok(highMtg.annualOM > lowMtg.annualOM, 'Expected MTG annual O&M to rise with the configured O&M percentage.');
});

test('multiple exploratory routes no longer collapse to the same output', () => {
  const result = runScenario({
    systemSizeMW: 100,
    sabatierEnabled: false,
    methanolEnabled: false,
    limeEnabled: true,
    titaniumEnabled: true,
    limePriorityWeight: 100,
    titaniumPriorityWeight: 100,
  });

  const lime = result.exploratoryModules.find(module => module.id === 'lime');
  const titanium = result.exploratoryModules.find(module => module.id === 'titanium');

  assert.ok(lime && titanium, 'Expected both exploratory modules to be present in the modeled results.');
  assert.ok(lime.outputDailyUnits > 0, 'Expected lime to produce a non-zero exploratory output.');
  assert.ok(titanium.outputDailyUnits > 0, 'Expected titanium to produce a non-zero exploratory output.');
  assert.ok(
    Math.abs(lime.outputDailyUnits - titanium.outputDailyUnits) > 1e-6,
    'Expected different electricity intensities to produce different exploratory outputs.'
  );
  assert.ok(
    lime.outputDailyUnits > titanium.outputDailyUnits,
    'Expected the lower-intensity lime route to produce more output than the higher-intensity titanium route at equal priority.'
  );
});

test('exploratory modules expose peak-day throughput for diagram cards', () => {
  const result = runScenario({
    latitude: 64.15,
    longitude: -21.94,
    systemSizeMW: 100,
    sabatierEnabled: false,
    methanolEnabled: false,
    limeEnabled: true,
  });

  const lime = result.exploratoryModules.find(module => module.id === 'lime');
  const peakChemicalDailyKWh = Math.max(...(result.ai.dispatch?.dailyChemicalKWh || []), 0);
  const expectedPeakScale = result.chemicalSupply.dailyAvailableKWh > 0
    ? Math.max(1, peakChemicalDailyKWh / result.chemicalSupply.dailyAvailableKWh)
    : 1;

  assert.ok(lime, 'Expected the lime exploratory module to be present in the modeled results.');
  assert.ok(lime.outputDailyUnits > 0, 'Expected the lime route to produce a non-zero average-cycle output.');
  assert.ok(
    lime.peakOutputDailyUnits > lime.outputDailyUnits,
    'Expected the peak-day throughput to exceed the average-cycle throughput in a seasonal solar case.'
  );
  assert.ok(
    Math.abs(lime.peakOutputDailyUnits - (lime.outputDailyUnits * expectedPeakScale)) <= 1e-6,
    [
      'Expected the diagram peak throughput to scale from the modeled most-active chemical day.',
      `Observed ${lime.peakOutputDailyUnits.toFixed(6)} vs expected ${(lime.outputDailyUnits * expectedPeakScale).toFixed(6)}.`,
    ].join(' ')
  );
});

test('exploratory capex uses annual peak throughput rather than average-day sizing', () => {
  const result = runScenario({
    latitude: 64.15,
    longitude: -21.94,
    systemSizeMW: 100,
    sabatierEnabled: false,
    methanolEnabled: false,
    limeEnabled: true,
  });

  const lime = result.exploratoryModules.find(module => module.id === 'lime');
  const route = Calc.getExploratoryRouteConfig('lime', 'resistive-calciner');
  const peakSizingKW = Math.max(result.chemicalSupply.processPowerKW, result.ai.dispatch?.chemicalPeakKW || 0);
  const expectedPeakOutputUnitsPerHour = peakSizingKW / route.electricityKwhPerUnit;
  const expectedPeakSizedCapex = expectedPeakOutputUnitsPerHour *
    result.solar.cycleHours *
    result.solar.cyclesPerYear *
    lime.capexBasis *
    route.cyclingPenalty;
  const averageDaySizedCapex = (result.chemicalSupply.processPowerKW / route.electricityKwhPerUnit) *
    result.solar.cycleHours *
    result.solar.cyclesPerYear *
    lime.capexBasis *
    route.cyclingPenalty;

  assert.ok(lime, 'Expected the lime exploratory module to be present in the modeled results.');
  assert.ok(
    Math.abs(lime.peakOutputUnitsPerHour - expectedPeakOutputUnitsPerHour) <= 1e-9,
    [
      'Expected exploratory peak sizing to track the annual peak chemical dispatch rate.',
      `Observed ${lime.peakOutputUnitsPerHour.toFixed(9)} vs expected ${expectedPeakOutputUnitsPerHour.toFixed(9)} units/hour.`,
    ].join(' ')
  );
  assert.ok(
    Math.abs(lime.capex - expectedPeakSizedCapex) <= 1e-6,
    [
      'Expected exploratory CAPEX to size from the peak hourly throughput implied by annual peak dispatch.',
      `Observed ${lime.capex.toFixed(6)} vs expected ${expectedPeakSizedCapex.toFixed(6)}.`,
    ].join(' ')
  );
  assert.ok(
    lime.capex > averageDaySizedCapex,
    'Expected seasonal peak sizing to produce more CAPEX than the old average-day sizing basis.'
  );
});

test('sabatier feed buffer keeps output while sizing from peak-day average gas flow', () => {
  const baseOverrides = {
    latitude: 64.15,
    longitude: -21.94,
    systemSizeMW: 100,
    batteryCapacityMWh: 0,
    sabatierEnabled: true,
    methanolEnabled: false,
    sabatierBufferEnabled: false,
  };
  const unbuffered = runScenario(baseOverrides);
  const buffered = runScenario({ ...baseOverrides, sabatierBufferEnabled: true });
  const peakChemicalDailyKWh = Math.max(...(buffered.ai.dispatch?.dailyChemicalKWh || []), 0);
  const peakDayScale = buffered.chemicalSupply.dailyAvailableKWh > 0
    ? Math.max(1, peakChemicalDailyKWh / buffered.chemicalSupply.dailyAvailableKWh)
    : 1;
  const conversion = buffered.state.sabatierConversion / 100;
  const expectedDesignFeedKgPerHour = conversion > 0 && buffered.solar.cycleHours > 0
    ? (((buffered.sabatier.h2Consumed + buffered.sabatier.co2Consumed) / conversion) * peakDayScale) / buffered.solar.cycleHours
    : 0;

  assert.equal(buffered.sabatier.bufferEnabled, true, 'Expected the Sabatier result to reflect the feed-buffer toggle.');
  assert.ok(
    Math.abs(buffered.sabatier.ch4AnnualKg - unbuffered.sabatier.ch4AnnualKg) <= 1e-9,
    'Expected the Sabatier feed buffer to preserve methane output.'
  );
  assert.ok(
    Math.abs(buffered.sabatier.designFeedKgPerHour - expectedDesignFeedKgPerHour) <= 1e-6,
    [
      'Expected the Sabatier reactor to size from peak-day average feed when the buffer is enabled.',
      `Observed ${buffered.sabatier.designFeedKgPerHour.toFixed(6)} vs expected ${expectedDesignFeedKgPerHour.toFixed(6)} kg/h.`,
    ].join(' ')
  );
  assert.ok(
    buffered.sabatier.capex < unbuffered.sabatier.capex,
    [
      'Expected the Sabatier feed buffer to reduce reactor CAPEX at unchanged output.',
      `Observed ${formatMoney(unbuffered.sabatier.capex)} -> ${formatMoney(buffered.sabatier.capex)}.`,
    ].join(' ')
  );
});

test('methanol feed buffer keeps output while sizing from peak-day average gas flow', () => {
  const baseOverrides = {
    latitude: 64.15,
    longitude: -21.94,
    systemSizeMW: 100,
    batteryCapacityMWh: 0,
    sabatierEnabled: false,
    methanolEnabled: true,
    methanolBufferEnabled: false,
  };
  const unbuffered = runScenario(baseOverrides);
  const buffered = runScenario({ ...baseOverrides, methanolBufferEnabled: true });
  const peakChemicalDailyKWh = Math.max(...(buffered.ai.dispatch?.dailyChemicalKWh || []), 0);
  const peakDayScale = buffered.chemicalSupply.dailyAvailableKWh > 0
    ? Math.max(1, peakChemicalDailyKWh / buffered.chemicalSupply.dailyAvailableKWh)
    : 1;
  const efficiency = buffered.state.methanolEfficiency / 100;
  const expectedDesignFeedKgPerHour = efficiency > 0 && buffered.solar.cycleHours > 0
    ? (((buffered.methanol.h2Consumed + buffered.methanol.co2Consumed) / efficiency) * peakDayScale) / buffered.solar.cycleHours
    : 0;

  assert.equal(buffered.methanol.bufferEnabled, true, 'Expected the methanol result to reflect the feed-buffer toggle.');
  assert.ok(
    Math.abs(buffered.methanol.annualKg - unbuffered.methanol.annualKg) <= 1e-9,
    'Expected the methanol feed buffer to preserve methanol output.'
  );
  assert.ok(
    Math.abs(buffered.methanol.designFeedKgPerHour - expectedDesignFeedKgPerHour) <= 1e-6,
    [
      'Expected the methanol reactor to size from peak-day average feed when the buffer is enabled.',
      `Observed ${buffered.methanol.designFeedKgPerHour.toFixed(6)} vs expected ${expectedDesignFeedKgPerHour.toFixed(6)} kg/h.`,
    ].join(' ')
  );
  assert.ok(
    buffered.methanol.capex < unbuffered.methanol.capex,
    [
      'Expected the methanol feed buffer to reduce reactor CAPEX at unchanged output.',
      `Observed ${formatMoney(unbuffered.methanol.capex)} -> ${formatMoney(buffered.methanol.capex)}.`,
    ].join(' ')
  );
});

test('co2-to-co feed buffer keeps output while sizing from peak-day average co2 flow', () => {
  const baseOverrides = {
    latitude: 64.15,
    longitude: -21.94,
    systemSizeMW: 100,
    batteryCapacityMWh: 0,
    sabatierEnabled: false,
    methanolEnabled: false,
    carbonMonoxideEnabled: true,
    carbonMonoxideRoute: 'plasma',
    carbonMonoxideBufferEnabled: false,
  };
  const unbuffered = runScenario(baseOverrides);
  const buffered = runScenario({ ...baseOverrides, carbonMonoxideBufferEnabled: true });
  const coUnbuffered = unbuffered.exploratoryModules.find(module => module.id === 'carbonMonoxide');
  const coBuffered = buffered.exploratoryModules.find(module => module.id === 'carbonMonoxide');
  const route = Calc.getExploratoryRouteConfig('carbonMonoxide', 'plasma');
  const peakChemicalDailyKWh = Math.max(...(buffered.ai.dispatch?.dailyChemicalKWh || []), 0);
  const peakDayScale = buffered.chemicalSupply.dailyAvailableKWh > 0
    ? Math.max(1, peakChemicalDailyKWh / buffered.chemicalSupply.dailyAvailableKWh)
    : 1;
  const allocationPlan = Calc.buildProcessAllocationPlan(buffered.state);
  const powerShare = allocationPlan.powerShares.exploratory.carbonMonoxide || 0;
  const co2Share = allocationPlan.feedShares.co2.carbonMonoxide || 0;
  const peakSizingKW = Math.max(
    buffered.chemicalSupply.processPowerKW,
    buffered.ai.dispatch?.chemicalPeakKW || 0
  );
  const expectedBufferedPeakUnitsPerHour = Math.min(
    route.electricityKwhPerUnit > 0
      ? (peakSizingKW * powerShare) / route.electricityKwhPerUnit
      : Infinity,
    route.feedstocks.co2Kg > 0 && buffered.solar.cycleHours > 0
      ? ((((buffered.dac.co2DailyKg || 0) * peakDayScale) * co2Share) / buffered.solar.cycleHours) / route.feedstocks.co2Kg
      : Infinity
  );

  assert.ok(coUnbuffered && coBuffered, 'Expected the CO module to appear in both buffered and unbuffered results.');
  assert.equal(coBuffered.bufferEnabled, true, 'Expected the CO result to reflect the feed-buffer toggle.');
  assert.ok(
    Math.abs(coBuffered.outputDailyUnits - coUnbuffered.outputDailyUnits) <= 1e-9,
    'Expected the CO feed buffer to preserve exploratory output.'
  );
  assert.ok(
    Math.abs(coBuffered.capexSizingOutputUnitsPerHour - expectedBufferedPeakUnitsPerHour) <= 1e-9,
    [
      'Expected the CO module to size from peak-day average buffered CO2 flow when the feed buffer is enabled.',
      `Observed ${coBuffered.capexSizingOutputUnitsPerHour.toFixed(9)} vs expected ${expectedBufferedPeakUnitsPerHour.toFixed(9)} units/hour.`,
    ].join(' ')
  );
  assert.ok(
    coBuffered.capexSizingOutputUnitsPerHour < coUnbuffered.capexSizingOutputUnitsPerHour,
    [
      'Expected the CO feed buffer to reduce nameplate sizing below the unbuffered peak throughput.',
      `Observed ${coUnbuffered.capexSizingOutputUnitsPerHour.toFixed(9)} -> ${coBuffered.capexSizingOutputUnitsPerHour.toFixed(9)} units/hour.`,
    ].join(' ')
  );
  assert.ok(
    coBuffered.capex < coUnbuffered.capex,
    [
      'Expected the CO feed buffer to reduce exploratory CAPEX at unchanged output.',
      `Observed ${formatMoney(coUnbuffered.capex)} -> ${formatMoney(coBuffered.capex)}.`,
    ].join(' ')
  );
});

test('mtg peak fully reflects upstream methanol buffering even without the MTG buffer', () => {
  const baseOverrides = {
    latitude: 64.15,
    longitude: -21.94,
    systemSizeMW: 100,
    batteryCapacityMWh: 0,
    sabatierEnabled: false,
    methanolEnabled: true,
    methanolBufferEnabled: false,
    mtgEnabled: true,
    mtgRoute: 'fluid-bed',
    mtgBufferEnabled: false,
  };
  const unbuffered = runScenario(baseOverrides);
  const methanolBuffered = runScenario({ ...baseOverrides, methanolBufferEnabled: true });
  const mtgUnbuffered = unbuffered.exploratoryModules.find(module => module.id === 'mtg');
  const mtgMethanolBuffered = methanolBuffered.exploratoryModules.find(module => module.id === 'mtg');
  const route = Calc.getExploratoryRouteConfig('mtg', 'fluid-bed');
  const methanolShare = Calc.buildProcessAllocationPlan(methanolBuffered.state).feedShares.methanol.mtg || 0;
  const expectedBufferedPeakUnitsPerHour = (
    (methanolBuffered.methanol.designHourlyOutputKg || 0) * methanolShare
  ) / route.feedstocks.methanolKg;

  assert.ok(mtgUnbuffered && mtgMethanolBuffered, 'Expected MTG to appear in both upstream-buffered and unbuffered results.');
  assert.ok(
    Math.abs(mtgMethanolBuffered.outputDailyUnits - mtgUnbuffered.outputDailyUnits) <= 1e-9,
    'Expected upstream methanol buffering to preserve MTG annualized output.'
  );
  assert.ok(
    mtgMethanolBuffered.peakOutputUnitsPerHour < mtgUnbuffered.peakOutputUnitsPerHour,
    [
      'Expected MTG peak throughput to fall when upstream methanol buffering smooths the incoming feed.',
      `Observed ${mtgUnbuffered.peakOutputUnitsPerHour.toFixed(9)} -> ${mtgMethanolBuffered.peakOutputUnitsPerHour.toFixed(9)} units/hour.`,
    ].join(' ')
  );
  assert.ok(
    Math.abs(mtgMethanolBuffered.peakOutputUnitsPerHour - expectedBufferedPeakUnitsPerHour) <= 1e-9,
    [
      'Expected upstream methanol buffering alone to fully flatten the MTG feed over the cycle.',
      `Observed ${mtgMethanolBuffered.peakOutputUnitsPerHour.toFixed(9)} vs expected ${expectedBufferedPeakUnitsPerHour.toFixed(9)} units/hour.`,
    ].join(' ')
  );
  assert.ok(
    Math.abs(mtgMethanolBuffered.capexSizingOutputUnitsPerHour - expectedBufferedPeakUnitsPerHour) <= 1e-9,
    'Expected MTG nameplate sizing to match the already-buffered upstream methanol feed when the MTG buffer is off.'
  );
});

test('mtg buffer no longer changes peak or capex after methanol is already buffered upstream', () => {
  const baseOverrides = {
    latitude: 64.15,
    longitude: -21.94,
    systemSizeMW: 100,
    batteryCapacityMWh: 0,
    sabatierEnabled: false,
    methanolEnabled: true,
    methanolBufferEnabled: false,
    mtgEnabled: true,
    mtgRoute: 'fluid-bed',
    mtgBufferEnabled: false,
  };
  const unbuffered = runScenario(baseOverrides);
  const mtgBuffered = runScenario({ ...baseOverrides, mtgBufferEnabled: true });
  const upstreamBuffered = runScenario({ ...baseOverrides, methanolBufferEnabled: true });
  const bothBuffered = runScenario({ ...baseOverrides, methanolBufferEnabled: true, mtgBufferEnabled: true });
  const mtgUnbuffered = unbuffered.exploratoryModules.find(module => module.id === 'mtg');
  const mtgOnlyBuffered = mtgBuffered.exploratoryModules.find(module => module.id === 'mtg');
  const mtgUpstreamBuffered = upstreamBuffered.exploratoryModules.find(module => module.id === 'mtg');
  const mtgBothBuffered = bothBuffered.exploratoryModules.find(module => module.id === 'mtg');
  const route = Calc.getExploratoryRouteConfig('mtg', 'fluid-bed');
  const methanolShare = Calc.buildProcessAllocationPlan(upstreamBuffered.state).feedShares.methanol.mtg || 0;
  const expectedBufferedPeakUnitsPerHour = (
    (upstreamBuffered.methanol.designHourlyOutputKg || 0) * methanolShare
  ) / route.feedstocks.methanolKg;
  const expectedBufferedCapexTotal = expectedBufferedPeakUnitsPerHour *
    mtgBuffered.solar.cycleHours *
    mtgBuffered.solar.cyclesPerYear *
    mtgOnlyBuffered.capexBasis *
    route.cyclingPenalty;

  assert.ok(mtgUnbuffered && mtgOnlyBuffered && mtgUpstreamBuffered && mtgBothBuffered, 'Expected MTG to appear in all buffered and unbuffered comparison scenarios.');
  assert.equal(mtgOnlyBuffered.bufferEnabled, true, 'Expected the MTG result to reflect the feed-buffer toggle.');
  assert.ok(
    Math.abs(mtgOnlyBuffered.outputDailyUnits - mtgUnbuffered.outputDailyUnits) <= 1e-9,
    'Expected the MTG feed buffer to preserve exploratory output.'
  );
  assert.ok(
    mtgOnlyBuffered.capexSizingOutputUnitsPerHour < mtgUnbuffered.peakOutputUnitsPerHour,
    [
      'Expected MTG feed buffering to reduce nameplate sizing below the unbuffered instantaneous MTG peak.',
      `Observed ${mtgUnbuffered.peakOutputUnitsPerHour.toFixed(9)} -> ${mtgOnlyBuffered.capexSizingOutputUnitsPerHour.toFixed(9)} units/hour.`,
    ].join(' ')
  );
  assert.ok(
    Math.abs(mtgOnlyBuffered.capexSizingOutputUnitsPerHour - expectedBufferedPeakUnitsPerHour) <= 1e-9,
    [
      'Expected the MTG feed buffer to smooth the methanol feed to the same cycle-average peak reached by upstream methanol buffering.',
      `Observed ${mtgOnlyBuffered.capexSizingOutputUnitsPerHour.toFixed(9)} vs expected ${expectedBufferedPeakUnitsPerHour.toFixed(9)} units/hour.`,
    ].join(' ')
  );
  assert.ok(
    Math.abs(mtgOnlyBuffered.capex - expectedBufferedCapexTotal) <= 1e-6,
    [
      'Expected buffered MTG CAPEX to size from the feed-smoothed nameplate throughput.',
      `Observed ${mtgOnlyBuffered.capex.toFixed(6)} vs expected ${expectedBufferedCapexTotal.toFixed(6)}.`,
    ].join(' ')
  );
  assert.ok(
    mtgOnlyBuffered.capex < mtgUnbuffered.capex,
    [
      'Expected the MTG feed buffer to reduce exploratory CAPEX at unchanged output.',
      `Observed ${formatMoney(mtgUnbuffered.capex)} -> ${formatMoney(mtgOnlyBuffered.capex)}.`,
    ].join(' ')
  );
  assert.ok(
    Math.abs(mtgUpstreamBuffered.peakOutputUnitsPerHour - expectedBufferedPeakUnitsPerHour) <= 1e-9,
    [
      'Expected upstream methanol buffering alone to reach the same fully buffered MTG peak.',
      `Observed ${mtgUpstreamBuffered.peakOutputUnitsPerHour.toFixed(9)} vs expected ${expectedBufferedPeakUnitsPerHour.toFixed(9)} units/hour.`,
    ].join(' ')
  );
  assert.ok(
    Math.abs(mtgBothBuffered.capexSizingOutputUnitsPerHour - mtgUpstreamBuffered.peakOutputUnitsPerHour) <= 1e-9,
    [
      'Expected turning on the MTG buffer after upstream methanol buffering to leave the MTG peak unchanged.',
      `Observed ${mtgUpstreamBuffered.peakOutputUnitsPerHour.toFixed(9)} vs ${mtgBothBuffered.capexSizingOutputUnitsPerHour.toFixed(9)} units/hour.`,
    ].join(' ')
  );
  assert.ok(
    Math.abs(mtgBothBuffered.capex - mtgUpstreamBuffered.capex) <= 1e-6,
    [
      'Expected turning on the MTG buffer after upstream methanol buffering to leave the MTG CAPEX unchanged.',
      `Observed ${mtgUpstreamBuffered.capex.toFixed(6)} vs ${mtgBothBuffered.capex.toFixed(6)}.`,
    ].join(' ')
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
