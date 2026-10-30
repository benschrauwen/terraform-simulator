/*
 * "Set load" AI sizing: the user fixes the GPU IT load and the model sizes
 * the smallest battery that keeps it at full rate for the reliability
 * target. Checks are hand-derived goldens on synthetic solar, minimality
 * and monotonicity of the sizer, duality with the "max" sizer, and the
 * state plumbing (the user's own battery is never overwritten).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import LZString from 'lz-string';

import { ShareStateCodec } from '../../js/state/share-codec.js';
import { Calc, DEFAULT_STATE, createState, runScenario } from './harness.js';

const relClose = (actual, expected, relTol, label) => assert.ok(
  Math.abs(actual - expected) <= relTol * Math.max(Math.abs(actual), Math.abs(expected)),
  `${label}: expected ${expected}, got ${actual}`
);

const fixed = (loadKW, overrides = {}) => runScenario({
  aiComputeEnabled: true,
  aiSizingMode: 'fixed',
  aiLoadKW: loadKW,
  ...overrides,
});

/* Reliability of a constant load with an explicit battery, on the same
   year-1 dispatch basis the scenario sizes against. */
function reliabilityWithBattery(result, loadKW, batteryMWh) {
  const state = { ...result.state, batteryCapacityMWh: batteryMWh };
  const basis = Calc.getAnnualDispatchBasis(state, result.solar, result.annualSolar, {});
  return Calc.simulateAnnualDispatchWithConstantAiLoad(state, basis.solar, loadKW, {
    captureSeries: false,
    skipOpHours: true,
  }).fullPowerReliability;
}

/* A year of 12 h at `sunKW` then 12 h dark, every day. */
function squareWaveSolar(sunKW) {
  const hourlyKW = Array.from({ length: 8760 }, (_, hour) => (hour % 24 < 12 ? sunKW : 0));
  return { hourlyKW, totalKWh: hourlyKW.reduce((sum, value) => sum + value, 0) };
}

test('square-wave sun: the sized battery carries the 12 h night (energy- and power-limited goldens)', () => {
  const loadKW = 100;
  const solar = squareWaveSolar(3 * loadKW);
  // Every night is identical, so any undersized battery falls short every
  // night (365 h > the 8.76 h / 87.6 h a 99.9% / 99% target allows): the
  // battery must deliver 12 h x 100 kW = 1,200 kWh at the terminal. With
  // 90% round trip the one-way discharge efficiency is sqrt(0.9), so it
  // must hold 1,200 / sqrt(0.9) = 1,264.9 kWh (+ <0.1% for the 2%/month
  // leakage over one night). Power: a 4 h battery of 1.26 MWh gives 316 kW
  // > 100 kW, so energy binds.
  [99.9, 99].forEach(target => {
    const state = createState({ aiComputeEnabled: true, batteryEfficiency: 90, batteryDurationHours: 4 });
    const sizing = Calc.sizeAiBatteryForLoad(state, solar, loadKW, target / 100);
    assert.equal(sizing.feasible, true);
    relClose(sizing.batteryMWh * 1000, 1200 / Math.sqrt(0.9), 2e-3, `energy-limited battery at ${target}%`);
  });

  // At 24 h duration the power rating is B / 24 h both ways. Discharging
  // 100 kW needs B >= 2,400 kWh, but charging binds harder: 12 sunny hours
  // at B / 24 store 12 x (B / 24) x sqrt(0.9) = 0.474 B, which must cover
  // the 1,264.9 kWh night, so B = 1,200 / (0.5 x 0.9) = 2,666.7 kWh.
  const slowState = createState({ aiComputeEnabled: true, batteryEfficiency: 90, batteryDurationHours: 24 });
  const slow = Calc.sizeAiBatteryForLoad(slowState, solar, loadKW, 0.999);
  relClose(slow.batteryMWh * 1000, 1200 / (0.5 * 0.9), 2e-3, 'charge-power-limited battery');
});

test('constant sun above the load needs no battery', () => {
  const hourlyKW = new Array(8760).fill(150);
  const sizing = Calc.sizeAiBatteryForLoad(createState({ aiComputeEnabled: true }), { hourlyKW, totalKWh: 150 * 8760 }, 100, 0.9999);
  assert.equal(sizing.batteryMWh, 0);
  assert.equal(sizing.feasible, true);
});

test('fixed mode: the solved battery meets the target and a 5% smaller one does not', () => {
  [[50, 99.9], [80, 99], [100, 99.9], [100, 95]].forEach(([loadKW, target]) => {
    const result = fixed(loadKW, { aiReliabilityTarget: target });
    const { batteryMWh } = result.ai.batterySizing;
    assert.equal(result.ai.loadFeasible, true, `${loadKW} kW @ ${target}% feasible`);
    assert.ok(batteryMWh > 0, `${loadKW} kW needs storage through the night`);
    assert.ok(result.ai.fullPowerReliability >= target / 100, `${loadKW} kW @ ${target}% met`);
    assert.ok(
      reliabilityWithBattery(result, loadKW, batteryMWh * 0.95) < target / 100,
      `${loadKW} kW @ ${target}%: 95% of ${batteryMWh} MWh must miss the target`
    );
    // The design runs the user's load on the sized battery.
    assert.equal(result.ai.designLoadKW, loadKW);
    relClose(result.storage.battCapKWh, batteryMWh * 1000, 1e-12, 'dispatched battery');
    relClose(result.economics.capex.battery, batteryMWh * 1000 * result.state.batteryCostPerKWh, 1e-12, 'battery capex');
  });
});

test('fixed mode: the solved battery is non-decreasing in load and in the reliability target', () => {
  const byLoad = [30, 50, 70, 90, 100].map(loadKW => fixed(loadKW, { aiReliabilityTarget: 99 }).ai.batterySizing.batteryMWh);
  byLoad.slice(1).forEach((value, index) => {
    assert.ok(value >= byLoad[index] - 1e-9, `battery vs load: ${byLoad.join(', ')}`);
  });
  const byTarget = [90, 95, 99, 99.5, 99.9].map(target => fixed(80, { aiReliabilityTarget: target }).ai.batterySizing.batteryMWh);
  byTarget.slice(1).forEach((value, index) => {
    assert.ok(value >= byTarget[index] - 1e-9, `battery vs target: ${byTarget.join(', ')}`);
  });
});

test('duality: the max load a battery supports needs no more than that battery in fixed mode', () => {
  [[2, 99], [1, 95]].forEach(([batteryMWh, target]) => {
    const max = runScenario({ aiComputeEnabled: true, batteryCapacityMWh: batteryMWh, aiReliabilityTarget: target });
    const sized = fixed(max.ai.designLoadKW, { batteryCapacityMWh: batteryMWh, aiReliabilityTarget: target });
    assert.ok(sized.ai.loadFeasible);
    // The load search resolves to 1e-5 and the battery search to 1e-4.
    assert.ok(
      sized.ai.batterySizing.batteryMWh <= batteryMWh * (1 + 1e-3),
      `${max.ai.designLoadKW} kW: ${sized.ai.batterySizing.batteryMWh} MWh vs ${batteryMWh} MWh`
    );
  });
});

test('an infeasible load reports the capped battery and a smaller feasible load', () => {
  // The default 1 MW site averages ~194 kW of solar, so 200 kW of constant
  // load cannot be carried at 99.9% (round-trip losses alone exceed the margin).
  const result = fixed(200, { aiReliabilityTarget: 99.9 });
  const sizing = result.ai.batterySizing;
  assert.equal(result.ai.loadFeasible, false);
  assert.equal(sizing.feasible, false);
  // Cap: aiFixedLoadMaxAutonomyCycles (7) x 24 h x 200 kW = 33.6 MWh.
  relClose(sizing.maxBatteryMWh, 33.6, 1e-12, 'battery cap');
  assert.equal(sizing.batteryMWh, sizing.maxBatteryMWh);
  assert.ok(result.ai.fullPowerReliability < 0.999, 'reported reliability is below the target');
  assert.ok(sizing.maxFeasibleLoadKW > 0 && sizing.maxFeasibleLoadKW < 200, `max feasible ${sizing.maxFeasibleLoadKW}`);
  // The reported limit is itself feasible, and a little more is not.
  assert.equal(fixed(sizing.maxFeasibleLoadKW, { aiReliabilityTarget: 99.9 }).ai.loadFeasible, true);
  assert.equal(fixed(sizing.maxFeasibleLoadKW * 1.01, { aiReliabilityTarget: 99.9 }).ai.loadFeasible, false);
});

test('fixed mode keeps the user battery in state and seeds none', () => {
  const kept = fixed(60, { batteryCapacityMWh: 7 });
  assert.equal(kept.state.batteryCapacityMWh, 7, 'the user battery is restored when switching back to max');
  assert.notEqual(kept.ai.batterySizing.batteryMWh, 7);
  assert.equal(kept.ai.batterySeededMWh, 0);
  const unseeded = fixed(60, { batteryCapacityMWh: 0 });
  assert.equal(unseeded.state.batteryCapacityMWh, 0, 'no heuristic battery is written into state in fixed mode');
  assert.ok(unseeded.storage.enabled && unseeded.storage.battCapKWh > 0, 'the sized battery is dispatched');
});

test('aiLoadKW is clamped to the array DC peak and the mode falls back to max', () => {
  const clamped = Calc.normalizeState({ ...DEFAULT_STATE, systemSizeMW: 0.5, aiLoadKW: 800 });
  assert.equal(clamped.aiLoadKW, 500);
  assert.equal(Calc.normalizeState({ ...DEFAULT_STATE, aiSizingMode: 'bogus' }).aiSizingMode, 'max');
  assert.equal(Calc.normalizeState({ ...DEFAULT_STATE, aiLoadKW: -5 }).aiLoadKW, 1, 'schema minimum');
  assert.equal(Calc.normalizeState({ ...DEFAULT_STATE, aiLoadKW: 'x' }).aiLoadKW, DEFAULT_STATE.aiLoadKW);
});

test('share links round-trip the sizing fields and old links decode to max mode', () => {
  const codec = { lzString: LZString };
  const sent = Calc.normalizeState({ ...DEFAULT_STATE, aiComputeEnabled: true, aiSizingMode: 'fixed', aiLoadKW: 250 });
  const parsed = ShareStateCodec.parseHash(ShareStateCodec.serializeHashFromState(sent, DEFAULT_STATE, codec), codec);
  assert.deepEqual(parsed.diff, { aiComputeEnabled: true, aiSizingMode: 'fixed', aiLoadKW: 250 });
  const received = Calc.normalizeState(parsed.diff);
  assert.equal(received.aiSizingMode, 'fixed');
  assert.equal(received.aiLoadKW, 250);

  // A link from before the fields existed carries neither key.
  const legacy = ShareStateCodec.serializeHashFromState({ ...DEFAULT_STATE, aiComputeEnabled: true, batteryCapacityMWh: 3 }, DEFAULT_STATE, codec);
  const legacyState = Calc.normalizeState(ShareStateCodec.parseHash(legacy, codec).diff);
  assert.equal(legacyState.aiSizingMode, 'max');
  assert.equal(legacyState.batteryCapacityMWh, 3);
});
