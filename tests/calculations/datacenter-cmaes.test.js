/*
 * CMA-ES (model/datacenter/cmaes.js) and the optimizer's global run: the minimizer converges on a
 * rotated ridge and on a stepped one, is deterministic for a seed, and the optimizer finds the
 * solar + battery basin the pattern search alone misses (Richland Parish, cheap solar and batteries).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRng, minimizeCmaes, symmetricEigen } from '../../js/model/datacenter/cmaes.js';
import { applyDatacenterPresetDefaults, DATACENTER_DEFAULT_STATE, optimizeDatacenterDesign } from '../../js/model/datacenter/index.js';
import { getArchitectureStartState } from '../../js/model/datacenter/optimizer.js';
import { withBatteryPrice, withSolarPrice } from '../../js/model/datacenter/site-survey.js';

// A narrow ridge rotated 45 degrees, minimum 0 at (0.7, 0.4); and a stepped (plateau) copy.
const ridge = ([x, y]) => 1000 * ((x - 0.7) - (y - 0.4)) ** 2 + ((x - 0.7) + (y - 0.4)) ** 2;
const stepped = x => Math.floor(ridge(x) * 50) / 50;

test('symmetric eigen-decomposition reconstructs the matrix', () => {
  const m = [[4, 1, 0.5], [1, 3, 0.2], [0.5, 0.2, 2]];
  const { values, vectors } = symmetricEigen(m);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    const v = values.reduce((sum, value, k) => sum + vectors[i][k] * value * vectors[j][k], 0);
    assert.ok(Math.abs(v - m[i][j]) < 1e-9, `${i},${j}`);
  }
});

test('CMA-ES follows a rotated ridge and steps over plateaus, deterministically', () => {
  for (const f of [ridge, stepped]) {
    const r = minimizeCmaes({ f, x0: [0.1, 0.9], sigma0: 0.3, maxEvals: 600, rng: createRng(7), tolX: 1e-5, stallGenerations: 1000 });
    assert.ok(Math.abs(r.x[0] - 0.7) < 0.02 && Math.abs(r.x[1] - 0.4) < 0.02, `${r.x}`);
    assert.ok(r.evaluations <= 600);
  }
  const a = minimizeCmaes({ f: ridge, x0: [0.2, 0.2], maxEvals: 200, rng: createRng(3) });
  const b = minimizeCmaes({ f: ridge, x0: [0.2, 0.2], maxEvals: 200, rng: createRng(3) });
  assert.deepEqual(a, b);
  // Samples stay in the unit box.
  minimizeCmaes({ f: x => { assert.ok(x.every(v => v >= 0 && v <= 1)); return ridge(x); }, x0: [0, 1], sigma0: 1, maxEvals: 120, rng: createRng(5) });
});

test('the global run finds the solar + battery basin the pattern search alone misses', () => {
  // Richland Parish, hybrid, solar $0.40/W and a $125/kWh 4-hour battery: the pattern search stays
  // in the no-solar basin (~$618M); a brute force over a 41 x 51 grid reaches ~$644.8M.
  const site = applyDatacenterPresetDefaults({ ...DATACENTER_DEFAULT_STATE, siteId: 'richland-la' }, 'siteId');
  const start = getArchitectureStartState(withBatteryPrice(withSolarPrice(site, 0.4), 125), 'hybrid');
  const pattern = optimizeDatacenterDesign(start, { refine: 'pattern' });
  const global = optimizeDatacenterDesign(start);
  assert.ok(global.best.feasible);
  assert.ok(global.best.solarMWdc > 200 && global.best.batteryMWh > 200, `${global.best.solarMWdc} MW / ${global.best.batteryMWh} MWh`);
  assert.ok(global.best.npv > pattern.best.npv + 15e6, `${global.best.npv} vs ${pattern.best.npv}`);
  assert.ok(global.best.npv > 644.8e6 - 1e6, `${global.best.npv}`);
  // Deterministic: the same design on a second run.
  assert.equal(optimizeDatacenterDesign(start).best.npv, global.best.npv);
});
