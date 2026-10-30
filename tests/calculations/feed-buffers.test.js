/*
 * Feed buffers are not free: a buffered reactor running at a constant rate
 * holds the feed that arrives during operating hours but is consumed later.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { CHEMISTRY } from '../../js/data/reference-data.js';
import { Calc, createState, runScenario } from './harness.js';

const close = (actual, expected, tolerance, message) => assert.ok(
  Math.abs(actual - expected) <= tolerance,
  `${message || ''} expected ${expected}, got ${actual}`
);

test('buffered Sabatier holds peak-day feed x (1 - op hours / cycle hours)', () => {
  // Feed flat over 10 of 24 hours, reactor at a constant 1/24 of the day:
  // inventory peaks at the end of the sunny window = F x (1 - 10/24).
  const s = CHEMISTRY.sabatier;
  const h2 = 100 * s.h2MassPerKgCH4;
  const co2 = 100 * s.co2MassPerKgCH4;
  const buffered = Calc.calculateSabatier(createState({ sabatierBufferEnabled: true }), h2, co2, 10, h2 / 10, co2 / 10, h2, co2);
  close(buffered.bufferH2Kg, h2 * (14 / 24), 1e-9);
  close(buffered.bufferCO2Kg, co2 * (14 / 24), 1e-9);
  const unbuffered = Calc.calculateSabatier(createState({ sabatierBufferEnabled: false }), h2, co2, 10, h2 / 10, co2 / 10, h2, co2);
  assert.equal(unbuffered.bufferH2Kg, 0);

  const storage = Calc.calculateFeedBufferStorage(createState({ h2BufferCostPerKg: 750, co2BufferCostPerTon: 1000 }), [buffered]);
  close(storage.capex, buffered.bufferH2Kg * 750 + (buffered.bufferCO2Kg / 1000) * 1000, 1e-9);
});

test('feed buffer storage is a capex block with process O&M; none without buffers', () => {
  const buffered = runScenario();
  assert.ok(buffered.economics.capex.feedBuffers > 0);
  close(buffered.economics.capex.feedBuffers, buffered.feedBuffers.capex, 1e-9);

  const unbuffered = runScenario({ sabatierBufferEnabled: false });
  assert.equal(unbuffered.economics.capex.feedBuffers, 0);
  const processCapex = economics => economics.capex.electrolyzer + economics.capex.dac + economics.capex.sabatier + economics.capex.methanol;
  const omDifference = buffered.economics.annualOM - unbuffered.economics.annualOM;
  const expectedOmDifference = 0.03 * (processCapex(buffered.economics) + buffered.economics.capex.feedBuffers - processCapex(unbuffered.economics));
  close(omDifference, expectedOmDifference, 1e-6);
});
