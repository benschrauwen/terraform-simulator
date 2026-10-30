/*
 * Output-based support is paid on qualifying output only: H2 converted into
 * products, CO2 utilized in them, solar delivered to the plant (not clipped).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { runScenario } from './harness.js';

const close = (actual, expected, tolerance, message) => assert.ok(
  Math.abs(actual - expected) <= tolerance,
  `${message || ''} expected ${expected}, got ${actual}`
);

test('45V pays $/kg on converted H2 for years 1-10, then nothing', () => {
  const result = runScenario({ policyMode: 'us_45v_h2', us45vHydrogenCreditPerKg: 3.28, methanolEnabled: true });
  const economics = result.economics;
  const cycles = result.solar.cyclesPerYear;
  // Qualifying H2 = produced - vented surplus (methanol at 80% vents ~9% of H2).
  const qualifyingKg = result.electrolyzer.h2AnnualKg - result.h2Surplus * cycles;
  assert.ok(qualifyingKg < result.electrolyzer.h2AnnualKg * 0.95);
  close(economics.policy.outputMetric.value, qualifyingKg, 1e-6);
  close(economics.policy.total, 3.28 * qualifyingKg, 1e-6);

  const chemicalFactors = result.lifetimeEnergy.chemicalFactorByYear;
  economics.yearlyCashFlows.forEach(entry => {
    const expected = entry.year <= 10 ? 3.28 * qualifyingKg * chemicalFactors[entry.year - 1] : 0;
    close(entry.revenue.policyCredits, expected, 1e-6, `year ${entry.year}`);
  });
});

test('45Q pays on CO2 utilized in products, not on vented CO2', () => {
  const result = runScenario({ policyMode: 'us_45q_dac', us45qDacCreditPerTon: 180 });
  const cycles = result.solar.cyclesPerYear;
  const utilizedTons = result.dac.co2AnnualTons - (result.co2Surplus * cycles) / 1000;
  close(utilizedTons, (result.sabatier.co2Consumed * cycles) / 1000, 1e-9);
  close(result.economics.policy.total, 180 * utilizedTons, 1e-6);
});

test('45Y pays on delivered solar electricity, excluding clipped output', () => {
  const result = runScenario({ policyMode: 'us_45y_solar', us45ySolarCreditPerKwh: 0.031, chemicalSizingPercent: 60 });
  const lifetime = result.lifetimeEnergy;
  const clippedShare = lifetime.clippedKWhByYear[0] / lifetime.solarKWhByYear[0];
  assert.ok(clippedShare > 0.01, 'undersized plant should clip');
  const deliveredKWh = result.solar.annualMWh * 1000 * (1 - clippedShare);
  close(result.economics.policy.total, 0.031 * deliveredKWh, 1e-6);
  // Year 2 follows delivered energy on the degraded array.
  const delivered = year => lifetime.solarKWhByYear[year - 1] - lifetime.clippedKWhByYear[year - 1];
  close(
    result.economics.yearlyCashFlows[1].revenue.policyCredits,
    result.economics.policy.total * (delivered(2) / delivered(1)),
    1e-6
  );
});

test('custom mixed support says its capex share applies to total CAPEX incl. land', () => {
  const economics = runScenario({ policyMode: 'custom', customCapexGrantShare: 0.5 }).economics;
  close(economics.policy.upfrontSupport, 0.5 * economics.totalCapex, 1e-6);
  assert.match(economics.policy.inputValues.find(input => input.key === 'customCapexGrantShare').label, /total CAPEX incl\. land/);
});
