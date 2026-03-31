const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createState,
  formatMoney,
  runBatterySweep,
  runScenario,
} = require('./harness');

test('default scenario stays numerically sane', () => {
  const state = createState();
  const result = runScenario();

  assert.equal(state.batteryCapacityMWh, 0, 'This regression suite assumes the current defaults start with no battery.');
  assert.equal(result.battery.enabled, false, 'Battery should stay disabled in the zero-capacity default case.');
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
  const modeledDirectSolarPeakKW = Math.max(...result.battery.hourlyKW, 0);

  assert.ok(
    Math.abs(result.battery.processPowerKW - modeledDirectSolarPeakKW) <= 1e-6,
    [
      'Expected the no-battery process cap to match the modeled direct-solar peak.',
      `Observed ${result.battery.processPowerKW.toFixed(3)} kW vs ${modeledDirectSolarPeakKW.toFixed(3)} kW.`,
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
