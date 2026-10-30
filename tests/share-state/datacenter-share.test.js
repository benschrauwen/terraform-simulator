/* Datacenter share links: the hash carries the non-default state plus every preset-derived
   field, so a link round-trips exactly even when a derived value equals the default site's. */
import assert from 'node:assert/strict';
import test from 'node:test';

import LZString from 'lz-string';

import { getSolarCostPresetValues, MOUNTING_TYPES } from '../../js/data/reference-data.js';
import {
  applyDatacenterPresetDefaults,
  DATACENTER_DEFAULT_STATE,
  DATACENTER_SOLAR_COST_PRESET,
  DATACENTER_DERIVED_KEYS,
  getDatacenterSite,
  normalizeDatacenterState,
} from '../../js/state/datacenter-schema.js';
import { ShareStateCodec } from '../../js/state/share-codec.js';
import { parseDatacenterHash, serializeDatacenterHash } from '../../js/ui/datacenter/share.js';

test('the default state has an empty hash and an empty hash gives the defaults', () => {
  assert.equal(serializeDatacenterHash(DATACENTER_DEFAULT_STATE, LZString), '');
  const parsed = parseDatacenterHash('', LZString);
  assert.equal(parsed.hasShareState, false);
  assert.deepEqual(parsed.state, normalizeDatacenterState({}));
});

test('a link keeps a user price that equals the default site\'s after the site changes', () => {
  const abilenePrice = DATACENTER_DEFAULT_STATE.gridEnergyPricePerMWh;
  const phoenix = applyDatacenterPresetDefaults({ ...DATACENTER_DEFAULT_STATE, siteId: 'phoenix-az' }, 'siteId');
  assert.notEqual(phoenix.gridEnergyPricePerMWh, abilenePrice, 'precondition: the sites differ in price');
  // The user then types Abilene's price back in: equal to the default, so a plain diff drops it.
  const state = { ...phoenix, gridEnergyPricePerMWh: abilenePrice, itCapacityMW: 250 };

  const plainDiff = ShareStateCodec.buildDiff(state, DATACENTER_DEFAULT_STATE, { excludeKeys: [] });
  assert.equal(Object.hasOwn(plainDiff, 'gridEnergyPricePerMWh'), false, 'without derived keys the price would be lost');
  assert.equal(normalizeDatacenterState(plainDiff).gridEnergyPricePerMWh, getDatacenterSite('phoenix-az').electricityPriceAltUsdPerMWh);

  const hash = serializeDatacenterHash(state, LZString);
  assert.match(hash, /^#s=/);
  const parsed = parseDatacenterHash(hash, LZString);
  assert.equal(parsed.hasShareState, true);
  assert.equal(parsed.error, null);
  assert.deepEqual(parsed.state, normalizeDatacenterState(state));
  assert.equal(parsed.state.gridEnergyPricePerMWh, abilenePrice);

  // Every derived key, and the gas type, travels in the payload (read through the hash parser:
  // the payload is URL-encoded, so slicing the raw hash breaks on a '+').
  const { d } = ShareStateCodec.parseHash(hash, { lzString: LZString }).payload;
  DATACENTER_DERIVED_KEYS.forEach(key => assert.ok(Object.hasOwn(d, key), `${key} in the link`));
  assert.equal(d.gasType, 'standby-diesel');
});

test('a link from before standby diesel became the default keeps its gas engines', () => {
  // An older link: the derived gas fields of the then-default reciprocating engines, no gas type
  // (it equalled the default) and no fuel price (a plain field at its default then).
  const old = { itCapacityMW: 250, gasUnitSizeMW: 10, gasCapexPerKW: 2000, gasFixedOmPerKWYear: 45, gasVariableOmPerMWh: 7.4, gasHeatRateMMBtuPerMWh: 7.8, gasAvailabilityPercent: 97 };
  const payload = ShareStateCodec.encodePayload({ v: ShareStateCodec.VERSION, d: old }, { lzString: LZString });
  const parsed = parseDatacenterHash(`#s=${encodeURIComponent(payload)}`, LZString);
  assert.equal(parsed.error, null);
  assert.equal(parsed.state.gasType, 'recip');
  assert.equal(parsed.state.gasFuelPricePerMMBtu, 4);
  assert.equal(parsed.state.gasUnitSizeMW, 10);
  // A current link with diesel round-trips as diesel.
  const current = normalizeDatacenterState({ itCapacityMW: 250 });
  assert.equal(parseDatacenterHash(serializeDatacenterHash(current, LZString), LZString).state.gasType, 'standby-diesel');
});

test('round trips across architectures, families and GPU platforms', () => {
  const steps = [
    [['architecture', 'islanded'], ['firmFamily', 'gas'], ['gasType', 'aero'], ['firmSpareUnits', 2]],
    [['firmFamily', 'nuclear'], ['nuclearType', 'bwrx-300'], ['solarSizeMWdc', 300], ['batteryCapacityMWh', 400]],
    [['revenueBasis', 'tokens'], ['coolingTechnology', 'immersion'], ['mountingType', 'fixed']],
    [['gpuPlatform', 'h100-sxm'], ['gpuRentalPricePerHour', 2.4], ['financingEnabled', true]],
  ];
  steps.forEach(sequence => {
    let state = { ...DATACENTER_DEFAULT_STATE };
    sequence.forEach(([key, value]) => {
      state = { ...state, [key]: value };
      state = applyDatacenterPresetDefaults(state, key);
    });
    const parsed = parseDatacenterHash(serializeDatacenterHash(state, LZString), LZString);
    assert.deepEqual(parsed.state, normalizeDatacenterState(state), JSON.stringify(sequence));
  });
});

test('a corrupt link falls back to the defaults with an error; foreign hashes are ignored', () => {
  const corrupt = parseDatacenterHash('#s=not-a-real-payload', LZString);
  assert.ok(corrupt.error);
  assert.deepEqual(corrupt.state, normalizeDatacenterState({}));
  assert.equal(parseDatacenterHash('#flowView', LZString).ignored, true);
});

test('east-west fixed racking is the default solar mounting and survives preset resets', () => {
  assert.equal(MOUNTING_TYPES.ew.label, 'East-West Fixed');
  assert.equal(DATACENTER_DEFAULT_STATE.mountingType, 'ew');
  // Its derived costs are the EW preset's: EW is the BOS reference, so no premium is added.
  const ewCost = getSolarCostPresetValues(DATACENTER_SOLAR_COST_PRESET, 'ew');
  assert.equal(DATACENTER_DEFAULT_STATE.bosCostPerW, ewCost.bosCostPerW);
  assert.equal(DATACENTER_DEFAULT_STATE.panelCostPerW, ewCost.panelCostPerW);
  // Resetting another selection, or normalizing a state without a mounting, keeps EW.
  ['siteId', 'coolingTechnology', 'gasType', 'mountingType'].forEach(key => {
    assert.equal(applyDatacenterPresetDefaults(DATACENTER_DEFAULT_STATE, key).mountingType, 'ew', key);
  });
  assert.equal(normalizeDatacenterState({ solarSizeMWdc: 200 }).mountingType, 'ew');
  // The default hash stays empty (mounting is a base field, not a derived one).
  assert.equal(serializeDatacenterHash({ ...DATACENTER_DEFAULT_STATE }, LZString), '');
});
