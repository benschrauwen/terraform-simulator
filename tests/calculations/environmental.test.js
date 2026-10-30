/*
 * CO2 accounting: captured = bound + vented; net avoided is fossil fuel
 * displacement only and can never exceed the CO2 bound in the fuels.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { CHEMISTRY } from '../../js/data/reference-data.js';
import { runScenario } from './harness.js';

const close = (actual, expected, tolerance, message) => assert.ok(
  Math.abs(actual - expected) <= tolerance,
  `${message || ''} expected ${expected}, got ${actual}`
);

test('captured CO2 is either bound in products or vented', () => {
  [{}, { methanolEnabled: true }, { ammoniaEnabled: true }, { specialtyCarbonEnabled: true }].forEach(overrides => {
    const env = runScenario(overrides).environmental;
    close(env.co2Captured, env.co2BoundInProducts + env.co2Vented, 1e-9, JSON.stringify(overrides));
    assert.ok(env.co2Vented >= 0);
  });
});

test('net avoided counts only displaced fossil fuel combustion, not capture', () => {
  const result = runScenario();
  const env = result.environmental;
  // 0.0528 t/MCF = 19.25 kg CH4 x 44.01/16.04 / 1000.
  close(19.25 * CHEMISTRY.dac.co2MolarMass / CHEMISTRY.sabatier.ch4MolarMass / 1000, 0.0528, 5e-5);
  close(env.co2NetAvoided, result.sabatier.ch4AnnualMCF * 0.0528, 1e-9);
  assert.ok(env.co2NetAvoided <= env.co2BoundInProducts * (1 + 1e-3));
  assert.ok(env.co2NetAvoided < env.co2Captured);
  assert.equal(env.totalCO2Benefit, undefined, 'captured + displaced double-counted the same carbon');
  assert.equal(env.landProductivityVsCorn, undefined, 'unsourced constant removed');
});

test('methanol displacement follows its carbon content', () => {
  const result = runScenario({ sabatierEnabled: false, methanolEnabled: true });
  const env = result.environmental;
  const methanolTons = result.methanol.reactorAnnualTons;
  close(env.co2NetAvoided, methanolTons * CHEMISTRY.methanol.co2MassPerKgMeOH, 1e-6);
  close(env.co2BoundInProducts, env.co2NetAvoided, 1e-6);
});
