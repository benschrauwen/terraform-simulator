/*
 * Characterization snapshot of the full calculation output.
 *
 * Pins the complete result tree for a matrix of scenarios so structural
 * refactors can prove they are behaviour-preserving. It is a change
 * detector, not a correctness check: what the numbers must satisfy lives in
 * invariants.test.js and the golden / physics tests.
 *
 * When a model change is intentional, regenerate the fixture in the same
 * commit and review the diff (only the scenarios you meant to move should
 * change):
 *
 *   UPDATE_CHARACTERIZATION=1 node --test tests/calculations/characterization.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Calc, ModuleCatalog, PolicyModel, createState } from './harness.js';

const FIXTURE_PATH = fileURLToPath(new URL('../fixtures/characterization.json', import.meta.url));
const UPDATE = process.env.UPDATE_CHARACTERIZATION === '1';
const REL_TOL = 1e-9;
const ABS_TOL = 1e-6;

const EXPLORATORY_MODULES = ModuleCatalog.getAll().filter(module => module.exploratory);

const POLICY_IDS = PolicyModel.getSelectGroups()
  .flatMap(group => group.options.map(option => option.id));

function estimatedSiteState(latitude, longitude) {
  assert.equal(Calc.getNearbyPreset(latitude, longitude, 'earth'), undefined, 'estimated site must not snap to a preset');
  const ghi = Calc.estimateGHI(latitude, longitude, 'earth');
  return {
    latitude,
    longitude,
    siteYieldMwhPerMwdcYear: Calc.estimateBaseYield(latitude, longitude, ghi, 'earth'),
    siteYieldSource: 'estimated',
    locationPresetIsCustom: true,
  };
}

const SCENARIOS = {
  default: {},
  battery2: { batteryEnabled: true, batteryCapacityMWh: 2 },
  sizing70: { chemicalSizingPercent: 70 },
  fixedTilt: { mountingType: 'fixed' },
  singleAxis: { mountingType: 'single' },
  dualAxis: { mountingType: 'dual' },
  specificDay: { dayMode: 'specific', dayOfYear: 355 },
  financing: { financingEnabled: true },
  methanolOnly: { sabatierEnabled: false, methanolEnabled: true },
  methaneMethanolMtg: { methanolEnabled: true, mtgEnabled: true },
  buffersOff: { electrolyzerBufferEnabled: false, dacBufferEnabled: false, sabatierBufferEnabled: false, methanolBufferEnabled: false },
  allExploratory: Object.fromEntries(EXPLORATORY_MODULES.map(module => [`${module.id}Enabled`, true])),
  allExploratoryLastRoutesUnbuffered: Object.fromEntries(EXPLORATORY_MODULES.flatMap(module => [
    [`${module.id}Enabled`, true],
    [`${module.id}BufferEnabled`, false],
    [`${module.id}Route`, Object.keys(module.routes).at(-1)],
  ])),
  // A custom Earth site away from every preset (Chisinau, Moldova), with the
  // yield the UI writes on a location edit (site-controls.js
  // handleLocationEdited): estimateGHI -> estimateBaseYield. Berlin sat on
  // a preset, and the model takes the state's yield as given, so the old
  // estimatedBerlin row never ran the estimator.
  estimatedCustomSite: estimatedSiteState(47.0, 28.8),
  largePlant: { systemSizeMW: 100, batteryEnabled: true, batteryCapacityMWh: 24, chemicalSizingPercent: 80 },
  horizon40: { analysisHorizonYears: 40 },
  aiCompute: { aiComputeEnabled: true },
  aiBattery8: { aiComputeEnabled: true, batteryEnabled: true, batteryCapacityMWh: 8, aiReliabilityTarget: 95 },
  mars: { body: 'mars' },
  moon: { body: 'moon' },
};

// Policy schemes only change the economics, so those scenarios pin just that branch.
const POLICY_SCENARIOS = Object.fromEntries(
  POLICY_IDS.map(id => [`policy:${id}`, { policyMode: id, methanolEnabled: true }])
);

function hashStrings(values) {
  let hash = 2166136261;
  for (const char of values.join('\u0000')) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

function digestArray(values) {
  if (values.every(value => typeof value === 'number' || value === null)) {
    let sum = 0;
    let weighted = 0;
    let min = Infinity;
    let max = -Infinity;
    values.forEach((value, index) => {
      const numeric = Number(value);
      sum += numeric;
      weighted += numeric * ((index % 97) + 1);
      min = Math.min(min, numeric);
      max = Math.max(max, numeric);
    });
    return { length: values.length, sum, weighted, min, max };
  }
  if (values.every(value => typeof value === 'string')) {
    return { length: values.length, first: values[0] ?? null, last: values.at(-1) ?? null, hash: hashStrings(values) };
  }
  return values.map(digest);
}

function digest(value) {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === 'number') return Number.isFinite(value) ? Number(value.toPrecision(12)) : String(value);
  if (typeof value === 'string' && value.length > 48) return `#${hashStrings([value])}`;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value) || ArrayBuffer.isView(value)) return digestArray(Array.from(value));
  return Object.fromEntries(
    Object.keys(value).sort().map(key => [key, digest(value[key])])
  );
}

function computeSnapshot() {
  const snapshot = {};
  for (const [name, overrides] of Object.entries(SCENARIOS)) {
    const state = createState(overrides);
    snapshot[name] = {
      result: digest(Calc.calculateAll(state)),
      leanIrr: digest(Calc.calculateIrr(state)),
    };
  }
  for (const [name, overrides] of Object.entries(POLICY_SCENARIOS)) {
    const state = createState(overrides);
    snapshot[name] = {
      economics: digest(Calc.calculateAll(state).economics),
      leanIrr: digest(Calc.calculateIrr(state)),
    };
  }
  snapshot.sensitivity = digest(Calc.runSensitivity(createState(), 'methanePrice', [5, 20, 40]));
  return snapshot;
}

function findMismatches(expected, actual, pathLabel, out) {
  if (out.length >= 25) return;
  if (typeof expected === 'number' && typeof actual === 'number') {
    const tolerance = Math.max(ABS_TOL, Math.abs(expected) * REL_TOL);
    if (Math.abs(expected - actual) > tolerance) out.push(`${pathLabel}: expected ${expected}, got ${actual}`);
    return;
  }
  if (expected && actual && typeof expected === 'object' && typeof actual === 'object') {
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    for (const key of keys) {
      if (!(key in actual)) out.push(`${pathLabel}.${key}: missing`);
      else if (!(key in expected)) out.push(`${pathLabel}.${key}: unexpected`);
      else findMismatches(expected[key], actual[key], `${pathLabel}.${key}`, out);
    }
    return;
  }
  if (expected !== actual) out.push(`${pathLabel}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

test('full calculation output matches the characterization fixture', () => {
  const actual = JSON.parse(JSON.stringify(computeSnapshot()));

  if (UPDATE || !fs.existsSync(FIXTURE_PATH)) {
    fs.mkdirSync(path.dirname(FIXTURE_PATH), { recursive: true });
    fs.writeFileSync(FIXTURE_PATH, `${JSON.stringify(actual)}\n`);
    if (!UPDATE) assert.fail('Characterization fixture was missing and has been created; rerun the tests.');
    return;
  }

  const expected = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
  const mismatches = [];
  findMismatches(expected, actual, 'snapshot', mismatches);
  assert.deepEqual(mismatches, [], `Calculation output drifted:\n${mismatches.join('\n')}`);
});
