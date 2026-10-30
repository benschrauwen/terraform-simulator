/*
 * Optimizer search (findBestRangeValueForIrr) against stubbed objectives.
 *
 * The search only needs Calc.calculateReturnMetrics, so each test runs it on
 * Object.create(Calc) with that method replaced by a closed-form objective of
 * the swept value: the optimum is known exactly and no plant is simulated.
 * The real-model integration is covered in finance-golden.test.js.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { Calc } from './harness.js';

const KEY = 'sweptValue';

function stubCalc(objective) {
  const calc = Object.create(Calc);
  calc.calls = 0;
  calc.calculateReturnMetrics = function (state) {
    this.calls += 1;
    const metrics = objective(state[KEY]);
    return typeof metrics === 'number' ? { irr: metrics, mirr: metrics / 2, npv: metrics * 1000 } : metrics;
  };
  return calc;
}

function search(calc, range, options) {
  return calc.findBestRangeValueForIrr({ [KEY]: range.currentValue }, { stateKey: KEY, ...range }, options);
}

test('exhaustive sweep (range <= maxCoarseSamples) finds the exact optimum and evaluates each step once', () => {
  const calc = stubCalc(x => 20 - ((x - 37) ** 2) / 100);
  const result = search(calc, { min: 0, max: 100, step: 1, currentValue: 90 });
  assert.equal(result.metric, 'irr');
  assert.equal(result.bestValue, 37);
  assert.equal(result.bestIrr, 20);
  assert.equal(result.currentValue, 90);
  assert.equal(calc.calls, 101, 'each of the 101 steps once (current value is cached)');
});

test('exhaustive sweep snaps to the step grid and handles fractional steps', () => {
  const calc = stubCalc(x => -Math.abs(x - 0.37));
  const result = search(calc, { min: 0, max: 1, step: 0.05, currentValue: 0 });
  // Grid points 0.35 and 0.40 are 0.02 and 0.03 away: 0.35 wins.
  assert.equal(result.bestValue, 0.35);
});

test('coarse + refine finds a smooth optimum on a 10,001-step range with far fewer evaluations', () => {
  const calc = stubCalc(x => 15 - ((x - 6543) / 1000) ** 2);
  const result = search(calc, { min: 0, max: 10000, step: 1, currentValue: 100 });
  assert.equal(result.bestValue, 6543);
  // 257 coarse samples + at most (maxTopRegions + current) windows of
  // 2 x coarse spacing (40) + 1 steps.
  assert.ok(calc.calls <= 257 + 6 * 81, `evaluations ${calc.calls}`);
});

test('coarse + refine resolves a narrow peak next to the best coarse sample', () => {
  // A broad hill peaking at 5000 with a 5-step spike at 5012-5016 that no
  // coarse sample (spacing ~39) lands on; refinement around the best coarse
  // samples must still find it.
  const calc = stubCalc(x => {
    const hill = 10 - ((x - 5000) / 2000) ** 2;
    return x >= 5012 && x <= 5016 ? hill + 3 - Math.abs(x - 5014) * 0.1 : hill;
  });
  const result = search(calc, { min: 0, max: 10000, step: 1, currentValue: 0 });
  assert.equal(result.bestValue, 5014);
});

test('a sweep with some undefined IRRs ranks every candidate by MIRR', () => {
  // IRR withheld (NaN) above 60; MIRR peaks at 75 and is defined everywhere.
  const calc = stubCalc(x => ({
    irr: x > 60 ? Number.NaN : 10 + x / 10,
    mirr: 8 - ((x - 75) / 20) ** 2,
    npv: x,
  }));
  const result = search(calc, { min: 0, max: 100, step: 1, currentValue: 10 });
  assert.equal(result.metric, 'mirr');
  assert.equal(result.bestValue, 75);
  assert.ok(Number.isNaN(result.bestIrr));
});

test('NPV ranks the sweep when MIRR is undefined too; all-undefined sweeps return null', () => {
  const npvOnly = stubCalc(x => ({ irr: Number.NaN, mirr: x < 50 ? Number.NaN : 1, npv: -((x - 20) ** 2) }));
  const result = search(npvOnly, { min: 0, max: 100, step: 1, currentValue: 90 });
  assert.equal(result.metric, 'npv');
  assert.equal(result.bestValue, 20);

  const undefinedEverywhere = stubCalc(() => ({ irr: Number.NaN, mirr: Number.NaN, npv: Number.NaN }));
  assert.equal(search(undefinedEverywhere, { min: 0, max: 10, step: 1, currentValue: 5 }), null);
});

test('no suggestion when the current value is already optimal (within tolerance) or the range is invalid', () => {
  const calc = stubCalc(x => 5 - ((x - 40) ** 2));
  assert.equal(search(calc, { min: 0, max: 100, step: 1, currentValue: 40 }), null);
  const flat = stubCalc(() => 7);
  assert.equal(search(flat, { min: 0, max: 100, step: 1, currentValue: 3 }), null);
  assert.equal(search(calc, { min: 10, max: 0, step: 1, currentValue: 0 }), null);
  assert.equal(search(calc, { min: 0, max: 10, step: 0, currentValue: 0 }), null);
  assert.equal(calc.findBestRangeValueForIrr({}, { stateKey: '', min: 0, max: 1, step: 1 }), null);
});

test('progress is reported from 0 to 100% and never goes backwards, on both search paths', () => {
  [
    { min: 0, max: 100, step: 1, currentValue: 50 },
    { min: 0, max: 5000, step: 1, currentValue: 50 },
  ].forEach(range => {
    const updates = [];
    const calc = stubCalc(x => -Math.abs(x - 33));
    const result = search(calc, range, { onProgress: progress => updates.push(progress) });
    assert.equal(result.bestValue, 33);
    assert.equal(updates[0].percent, 0);
    assert.equal(updates.at(-1).percent, 100);
    assert.equal(updates.at(-1).stage, 'done');
    assert.ok(updates.some(update => update.percent > 0 && update.percent < 100));
    updates.forEach((update, index) => {
      if (index > 0) assert.ok(update.percent >= updates[index - 1].percent);
    });
  });
  // A throwing progress callback does not change the result.
  const calc = stubCalc(x => -Math.abs(x - 33));
  const result = search(calc, { min: 0, max: 100, step: 1, currentValue: 50 }, { onProgress: () => { throw new Error('ui'); } });
  assert.equal(result.bestValue, 33);
});
