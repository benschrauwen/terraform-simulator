/*
 * Mass balance of the shared H2 / CO2 feed allocation.
 *
 * Independent truths: every kg of H2 and CO2 produced is either converted
 * by a consumer or reported as surplus; with feeds split in stoichiometric
 * proportion the only stranded feed is the unconverted fraction of each
 * reactor; at 100% conversion nothing is stranded.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { CHEMISTRY } from '../../js/data/reference-data.js';
import { Calc, createState, runScenario } from './harness.js';

function consumedH2(result) {
  return (result.sabatier.h2Consumed || 0) +
    (result.methanol.h2Consumed || 0) +
    result.exploratoryModules.reduce((sum, module) => sum + (module.h2Consumed || 0), 0);
}

function consumedCO2(result) {
  return (result.sabatier.co2Consumed || 0) +
    (result.methanol.co2Consumed || 0) +
    result.exploratoryModules.reduce((sum, module) => sum + (module.co2Consumed || 0), 0);
}

const MIXES = {
  methaneOnly: {},
  methaneMethanol5050: { methanolEnabled: true, methaneFeedstockSplit: 50 },
  methaneMethanol2080: { methanolEnabled: true, methaneFeedstockSplit: 20 },
  methaneAmmonia: { ammoniaEnabled: true },
  methaneSteel: { steelEnabled: true },
  methaneRwgsCo: { carbonMonoxideEnabled: true, carbonMonoxideRoute: 'rwgs' },
};

test('H2 and CO2 produced equal the sum consumed plus surplus for every product mix', () => {
  Object.entries(MIXES).forEach(([name, overrides]) => {
    const result = runScenario(overrides);
    const h2Produced = result.electrolyzer.h2DailyKg;
    const co2Produced = result.dac.co2DailyKg;
    assert.ok(h2Produced > 0 && co2Produced > 0, name);
    assert.ok(Math.abs(h2Produced - consumedH2(result) - result.h2Surplus) <= h2Produced * 1e-9, `${name} H2 balance`);
    assert.ok(Math.abs(co2Produced - consumedCO2(result) - result.co2Surplus) <= co2Produced * 1e-9, `${name} CO2 balance`);
  });
});

test('feed-limited surplus never exceeds the unconverted fraction of the least-converting consumer', () => {
  Object.entries(MIXES).forEach(([name, overrides]) => {
    const result = runScenario(overrides);
    const state = result.state;
    // Exploratory routes are modeled at full feed conversion, so the worst
    // case is the lowest supported-reactor conversion.
    const conversions = [state.sabatierConversion / 100];
    if (state.methanolEnabled) conversions.push(state.methanolEfficiency / 100);
    const maxLoss = 1 - Math.min(...conversions);
    assert.ok(result.h2Surplus / result.electrolyzer.h2DailyKg <= maxLoss + 1e-9, `${name} H2 surplus`);
    assert.ok(result.co2Surplus / result.dac.co2DailyKg <= maxLoss + 1e-9, `${name} CO2 surplus`);
  });
});

test('50/50 methane + methanol strands only the conversion loss (hand-derived 9.1% H2, 10.0% CO2)', () => {
  // Feeds split by product weight x stoichiometric kg/kg:
  //   H2:  CH4 0.503, MeOH 0.189 kg/kg; CO2: CH4 2.744, MeOH 1.374 kg/kg.
  //   H2 surplus  = (0.503 x 5% + 0.189 x 20%) / (0.503 + 0.189) = 9.10%
  //   CO2 surplus = (2.744 x 5% + 1.374 x 20%) / (2.744 + 1.374) = 10.00%
  // (Sabatier 95%, methanol 80% conversion.) Splitting by weight alone
  // stranded ~20% H2 / ~16% CO2.
  const s = CHEMISTRY.sabatier;
  const m = CHEMISTRY.methanol;
  const expectedH2 = (s.h2MassPerKgCH4 * 0.05 + m.h2MassPerKgMeOH * 0.20) / (s.h2MassPerKgCH4 + m.h2MassPerKgMeOH);
  const expectedCO2 = (s.co2MassPerKgCH4 * 0.05 + m.co2MassPerKgMeOH * 0.20) / (s.co2MassPerKgCH4 + m.co2MassPerKgMeOH);
  assert.ok(Math.abs(expectedH2 - 0.0910) < 5e-4);
  assert.ok(Math.abs(expectedCO2 - 0.1000) < 5e-4);

  const result = runScenario({ methanolEnabled: true, methaneFeedstockSplit: 50, sabatierConversion: 95, methanolEfficiency: 80 });
  assert.ok(Math.abs(result.h2Surplus / result.electrolyzer.h2DailyKg - expectedH2) < 1e-6);
  assert.ok(Math.abs(result.co2Surplus / result.dac.co2DailyKg - expectedCO2) < 1e-6);
});

test('stoichiometric feeds at 100% conversion leave no surplus for a methane + methanol split', () => {
  // Bypass normalization so conversion can be exactly 100%.
  const state = { ...createState({ methanolEnabled: true, methaneFeedstockSplit: 30 }), sabatierConversion: 100, methanolEfficiency: 100 };
  const plan = Calc.buildProcessAllocationPlan(state);
  const s = CHEMISTRY.sabatier;
  const m = CHEMISTRY.methanol;
  // 30 t CH4 : 70 t MeOH of gross product, scaled to an arbitrary day.
  const h2DailyKg = 1000 * (30 * s.h2MassPerKgCH4 + 70 * m.h2MassPerKgMeOH);
  const co2DailyKg = 1000 * (30 * s.co2MassPerKgCH4 + 70 * m.co2MassPerKgMeOH);
  const flows = Calc.calculateSupportedProducts(state, { h2DailyKg, co2DailyKg }, 10, plan);
  assert.ok(flows.h2Remaining <= h2DailyKg * 1e-9);
  assert.ok(flows.co2Remaining <= co2DailyKg * 1e-9);
  assert.ok(Math.abs(flows.outputs.sabatier.ch4DailyKg - 30000) < 1e-6);
  assert.ok(Math.abs(flows.outputs.methanol.dailyKg - 70000) < 1e-6);
});

test('electrolyzer and DAC power shares deliver H2:CO2 in the consumers combined stoichiometric ratio', () => {
  const result = runScenario({ methanolEnabled: true, methaneFeedstockSplit: 40 });
  const s = CHEMISTRY.sabatier;
  const m = CHEMISTRY.methanol;
  const expectedRatio = (40 * s.h2MassPerKgCH4 + 60 * m.h2MassPerKgMeOH) / (40 * s.co2MassPerKgCH4 + 60 * m.co2MassPerKgMeOH);
  assert.ok(Math.abs(result.electrolyzer.h2DailyKg / result.dac.co2DailyKg - expectedRatio) < 1e-9);
});
