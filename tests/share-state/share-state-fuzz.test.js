/*
 * Share links against the real schema: a seeded fuzz of random state diffs
 * must survive encode -> decode -> normalize unchanged, malformed hashes
 * must fail with their specific errors, and old links must still load.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import LZString from 'lz-string';

import { ModuleCatalog } from '../../js/model/module-catalog.js';
import { Calc, DEFAULT_STATE } from '../../js/model/index.js';
import { CORE_STATE_FIELDS, SOLAR_PROFILE_OPTIONS_BY_BODY, getStateFieldOptions } from '../../js/state/schema.js';
import { ShareStateCodec } from '../../js/state/share-codec.js';

const codecOptions = { lzString: LZString };

// mulberry32: small seeded PRNG so failures reproduce.
function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ENUM_OPTIONS = {
  ...Object.fromEntries(CORE_STATE_FIELDS.filter(field => field.type === 'enum').map(field => [field.key, getStateFieldOptions(field)])),
  ...Object.fromEntries(ModuleCatalog.getAll().filter(module => ModuleCatalog.hasRoutes(module)).map(module => [
    `${module.id}Route`,
    ModuleCatalog.getRouteOptions(module).map(option => option.value),
  ])),
  solarProfileModel: Object.values(SOLAR_PROFILE_OPTIONS_BY_BODY).flat(),
};
const LABEL_PIECES = ['Site', ' Ω', 'Zürich', '東京', '&', '#s=', '%20', '"quoted"', ' 🌞', '‮'];
const KEYS = Object.keys(DEFAULT_STATE);

function randomValue(key, random) {
  const pick = list => list[Math.floor(random() * list.length)];
  const current = DEFAULT_STATE[key];
  if (typeof current === 'boolean') return !current;
  if (ENUM_OPTIONS[key]) return pick(ENUM_OPTIONS[key]);
  if (typeof current === 'string') {
    return Array.from({ length: 1 + Math.floor(random() * 4) }, () => pick(LABEL_PIECES)).join('');
  }
  const scale = Math.abs(current) || 1;
  return pick([
    0,
    current * 2,
    current / 2,
    Math.round(random() * 3 * scale * 1000) / 1000,
    Math.round(random() * 100),
  ]);
}

function randomDiff(random) {
  const diff = {};
  const count = 1 + Math.floor(random() * 12);
  for (let i = 0; i < count; i++) {
    const key = KEYS[Math.floor(random() * KEYS.length)];
    diff[key] = randomValue(key, random);
  }
  return diff;
}

function shareHash(state) {
  return ShareStateCodec.serializeHashFromState(state, DEFAULT_STATE, codecOptions);
}

test('fuzz: 1,000 random schema diffs survive encode -> decode -> normalize unchanged', () => {
  const random = createRandom(20261030);
  for (let i = 0; i < 1000; i++) {
    const diff = randomDiff(random);
    // The app only ever shares normalized state.
    const sent = Calc.normalizeState({ ...DEFAULT_STATE, ...diff });
    const hash = shareHash(sent);
    const parsed = ShareStateCodec.parseHash(hash, codecOptions);
    assert.deepEqual(parsed.diff, ShareStateCodec.buildDiff(sent, DEFAULT_STATE), `case ${i}: codec diff ${JSON.stringify(diff)}`);
    assert.ok(!Object.hasOwn(parsed.diff, 'batteryEnabled'), `case ${i}: derived batteryEnabled is not shared`);
    const received = Calc.normalizeState(parsed.diff);
    assert.deepEqual(received, sent, `case ${i}: state ${JSON.stringify(diff)}`);
  }
});

function hashFor(payload) {
  return `#s=${LZString.compressToEncodedURIComponent(typeof payload === 'string' ? payload : JSON.stringify(payload))}`;
}

test('malformed share hashes fail with their specific errors', () => {
  const cases = [
    ['#s=', /payload is empty/],
    ['#s=%E2%98%83not-lz-data', /Unable to decompress/],
    [hashFor('{"v":1,"d":'), /Unable to parse shared state payload JSON/],
    [hashFor([1, 2, 3]), /payload must be an object/],
    [hashFor('null'), /payload must be an object/],
    [hashFor({ v: 1, d: [1, 2] }), /diff must be an object/],
    [hashFor({ v: 1 }), /diff must be an object/],
    [hashFor({ v: 2, d: {} }), /Unsupported shared state version/],
    [`#s=${'A'.repeat(ShareStateCodec.MAX_ENCODED_LENGTH + 1)}`, /payload is too large/],
  ];
  cases.forEach(([hash, error]) => {
    assert.throws(() => ShareStateCodec.parseHash(hash, codecOptions), error, hash.slice(0, 40));
  });
  // Not a share hash at all: ignored, not an error.
  assert.equal(ShareStateCodec.parseHash('#methodology', codecOptions).ignored, true);
  assert.equal(ShareStateCodec.parseHash('#a=1&b=2', codecOptions).ignored, true);
  assert.equal(ShareStateCodec.parseHash('', codecOptions).empty, true);
});

test('unknown and prototype keys in a link are dropped on load', () => {
  const hash = hashFor('{"v":1,"d":{"systemSizeMW":7,"evil":"<script>","__proto__":{"polluted":true},"constructor":1}}');
  const state = Calc.normalizeState(ShareStateCodec.parseHash(hash, codecOptions).diff);
  assert.equal(state.systemSizeMW, 7);
  assert.deepEqual(Object.keys(state).sort(), Object.keys(DEFAULT_STATE).sort());
  assert.equal({}.polluted, undefined);
});

test('legacy policy modes in old links migrate to the consolidated schemes', () => {
  const load = diff => Calc.normalizeState(ShareStateCodec.parseHash(hashFor({ v: 1, d: diff }), codecOptions).diff);
  // Each retired mode maps to its scheme and seeds the value the old mode implied.
  const expectations = [
    [{ policyMode: 'us_45v_tier1' }, 'us_45v_h2', 'us45vHydrogenCreditPerKg', 0.60],
    [{ policyMode: 'us_45v_tier2' }, 'us_45v_h2', 'us45vHydrogenCreditPerKg', 0.75],
    [{ policyMode: 'us_45v_tier3' }, 'us_45v_h2', 'us45vHydrogenCreditPerKg', 1.00],
    [{ policyMode: 'us_45v_tier4' }, 'us_45v_h2', 'us45vHydrogenCreditPerKg', 3.00],
    [{ policyMode: 'us_45q_utilization' }, 'us_45q_dac', 'us45qDacCreditPerTon', 130],
    [{ policyMode: 'us_45q_sequestration' }, 'us_45q_dac', 'us45qDacCreditPerTon', 180],
    [{ policyMode: 'eu_hydrogen_bank', customH2Credit: 0.55 }, 'eu_ehb_rfnbo', 'euHydrogenBankPremiumPerKg', 0.55],
    // An explicit value in the old link wins over the implied one.
    [{ policyMode: 'us_45v_tier2', us45vHydrogenCreditPerKg: 2.5 }, 'us_45v_h2', 'us45vHydrogenCreditPerKg', 2.5],
  ];
  expectations.forEach(([diff, mode, key, value]) => {
    const state = load(diff);
    assert.equal(state.policyMode, mode, JSON.stringify(diff));
    assert.equal(state[key], value, JSON.stringify(diff));
  });
  // Unknown or inherited names fall back to the default scheme.
  assert.equal(load({ policyMode: 'toString' }).policyMode, DEFAULT_STATE.policyMode);
  assert.equal(load({ policyMode: 'retired_mode' }).policyMode, DEFAULT_STATE.policyMode);
});
