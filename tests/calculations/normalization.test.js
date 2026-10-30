/*
 * State normalization: invalid inputs clamp to the schema, only schema keys
 * survive, booleans must be literal true, labels are sanitized, inherited
 * property names are never aliases, and module dependencies auto-enable.
 * Share-link decoding is in tests/share-state.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { migrateLegacyState } from '../../js/state/migrations.js';
import { Calc, ModuleCatalog, PolicyModel, createState, runScenario } from './harness.js';

test('invalid inputs are normalized before calculations run', () => {
  const result = runScenario({
    body: 'pluto',
    mountingType: 'bogus',
    batteryCapacityMWh: -5,
    batteryEfficiency: 150,
    electrolyzerEfficiency: 0,
    dacEnergy: 0,
    analysisHorizonYears: -3,
    debtTermYears: 999,
    discountRate: Number.NaN,
    methanePrice: -10,
  });

  assert.equal(result.state.body, createState().body, 'Invalid body keys should fall back to the default body.');
  assert.equal(
    result.state.mountingType,
    createState().mountingType,
    'Invalid mounting types should fall back to the default mounting.'
  );
  assert.equal(result.storage.enabled, false, 'Negative battery capacity should normalize to zero storage.');
  assert.ok(Number.isFinite(result.economics.totalCapex), 'Normalized scenarios should still produce finite CAPEX.');
  assert.ok(Number.isFinite(result.economics.totalAnnualRevenue), 'Normalized scenarios should still produce finite revenue.');
});

test('normalizeState keeps only schema keys', () => {
  const input = JSON.parse('{"systemSizeMW": 5, "evilKey": "<script>", "__proto__": {"polluted": true}}');
  const normalized = Calc.normalizeState(input);

  assert.equal(normalized.systemSizeMW, 5);
  assert.equal(Object.hasOwn(normalized, 'evilKey'), false, 'Unknown keys must not survive normalization.');
  assert.equal(Object.hasOwn(normalized, '__proto__'), false);
  assert.equal(normalized.polluted, undefined, 'Input must not be able to change the prototype.');
  assert.deepEqual(
    Object.keys(normalized).filter(key => !Object.hasOwn(createState(), key)),
    [],
    'Every normalized key should be a schema key.'
  );
});

test('normalizeState only treats literal true as an enabled boolean', () => {
  const normalized = Calc.normalizeState({
    financingEnabled: 'false',
    aiComputeEnabled: 1,
    locationPresetIsCustom: true,
    sabatierEnabled: 'false',
    methanolEnabled: 'true',
    mtgBufferEnabled: 0,
    methanolBufferEnabled: true,
  });

  assert.equal(normalized.financingEnabled, false, 'The string "false" must not enable financing.');
  assert.equal(normalized.aiComputeEnabled, false);
  assert.equal(normalized.locationPresetIsCustom, true);
  assert.equal(normalized.sabatierEnabled, false, 'Module Enabled flags must be literal booleans.');
  assert.equal(normalized.methanolEnabled, false);
  assert.equal(normalized.mtgBufferEnabled, false);
  assert.equal(normalized.methanolBufferEnabled, true);
});

test('custom site labels drop control, zero-width and bidi override characters', () => {
  const normalized = Calc.normalizeState({
    customSiteLabel: '  My\u0007 Si​te‮ txt.exe⁦⁩‏  ',
  });

  assert.equal(normalized.customSiteLabel, 'My Site txt.exe');
});

test('legacy policy aliases and scheme lookup ignore inherited property names', () => {
  assert.deepEqual(
    migrateLegacyState({ policyMode: 'toString', systemSizeMW: 2 }),
    { policyMode: 'toString', systemSizeMW: 2 },
    'Inherited names must not resolve to a migration alias.'
  );
  assert.equal(migrateLegacyState({ policyMode: 'us_45v_tier2' }).policyMode, 'us_45v_h2');
  const inherited = Calc.normalizeState({ policyMode: 'toString' });
  assert.equal(inherited.policyMode, createState().policyMode, 'Inherited names are not policy modes.');
  assert.equal(PolicyModel.getScheme('toString'), PolicyModel.getScheme('none'));
  assert.equal(PolicyModel.getScheme('constructor'), PolicyModel.getScheme('none'));
  assert.equal(ModuleCatalog.getById('toString'), null);
  assert.equal(ModuleCatalog.getById('hasOwnProperty'), null);
});

// Buffers hold real H2/CO2 inventory that is now costed, and Terraform's design
// runs the reactor intermittently without storage, so buffering is opt-in.
test('feed-buffer toggles default off for every module', () => {
  const state = createState();

  ModuleCatalog.getAll().forEach(module => {
    assert.equal(state[`${module.id}BufferEnabled`], false, `Expected ${module.id} feed buffering to default off.`);
  });
});

test('enabled downstream modules auto-enable their upstream process dependencies', () => {
  const mtgState = Calc.normalizeState(createState({
    mtgEnabled: true,
    methanolEnabled: false,
    electrolyzerEnabled: false,
    dacEnabled: false,
  }));
  const rwgsState = Calc.normalizeState(createState({
    carbonMonoxideEnabled: true,
    carbonMonoxideRoute: 'rwgs',
    electrolyzerEnabled: false,
    dacEnabled: false,
  }));
  const lowTempCoState = Calc.normalizeState(createState({
    carbonMonoxideEnabled: true,
    carbonMonoxideRoute: 'low-temp-electrolysis',
    sabatierEnabled: false,
    methanolEnabled: false,
    electrolyzerEnabled: false,
    dacEnabled: false,
  }));

  assert.equal(mtgState.mtgEnabled, true, 'Expected MTG to stay enabled.');
  assert.equal(mtgState.methanolEnabled, true, 'Expected MTG to auto-enable methanol.');
  assert.equal(mtgState.electrolyzerEnabled, true, 'Expected methanol-dependent MTG to auto-enable the electrolyzer chain.');
  assert.equal(mtgState.dacEnabled, true, 'Expected methanol-dependent MTG to auto-enable DAC.');

  assert.equal(rwgsState.carbonMonoxideEnabled, true, 'Expected the CO module to stay enabled.');
  assert.equal(rwgsState.dacEnabled, true, 'Expected CO production to auto-enable DAC.');
  assert.equal(rwgsState.electrolyzerEnabled, true, 'Expected the RWGS route to auto-enable electrolyzer feed.');

  assert.equal(lowTempCoState.carbonMonoxideEnabled, true, 'Expected the low-temp CO route to stay enabled.');
  assert.equal(lowTempCoState.dacEnabled, true, 'Expected every CO route to auto-enable DAC.');
  assert.equal(lowTempCoState.electrolyzerEnabled, false, 'Expected non-RWGS CO routes to avoid forcing the electrolyzer.');
});
