const assert = require('node:assert/strict');
const test = require('node:test');

const {
  Calc,
  createState,
  formatMoney,
  runBatterySweep,
  runScenario,
} = require('./harness');

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

test('capex breakdown still adds up to the reported total', () => {
  const result = runScenario();
  const capex = result.economics.capex;
  const sumOfComponents = Object.values(capex).reduce((sum, value) => sum + value, 0);

  assert.ok(
    Math.abs(sumOfComponents - result.economics.totalCapex) <= 1e-6,
    `Expected CAPEX components to sum to ${formatMoney(result.economics.totalCapex)}, got ${formatMoney(sumOfComponents)}.`
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
