const assert = require('node:assert/strict');
const test = require('node:test');

const LZString = require('lz-string');
const ShareStateCodec = require('../../js/share-state.js');

test('share hash is empty when state matches defaults', () => {
  const defaults = {
    batteryEnabled: false,
    body: 'earth',
    systemSizeMW: 1,
  };
  const state = { ...defaults };

  assert.equal(
    ShareStateCodec.serializeHashFromState(state, defaults, { lzString: LZString }),
    '',
    'Expected default state to omit the share hash entirely.'
  );
});

test('share hash buildDiff skips undefined state values', () => {
  const defaults = {
    batteryEnabled: false,
    body: 'earth',
    customSiteLabel: '',
    systemSizeMW: 1,
  };
  const state = {
    ...defaults,
    systemSizeMW: 5,
    customSiteLabel: undefined,
  };

  const diff = ShareStateCodec.buildDiff(state, defaults);
  assert.deepEqual(diff, { systemSizeMW: 5 });
});

test('share hash round-trips the non-default state diff', () => {
  const defaults = {
    aiComputeEnabled: false,
    batteryEnabled: false,
    body: 'earth',
    methaneFeedstockSplit: 50,
    systemSizeMW: 1,
  };
  const state = {
    ...defaults,
    aiComputeEnabled: true,
    batteryEnabled: true,
    body: 'mars',
    systemSizeMW: 250,
  };

  const hash = ShareStateCodec.serializeHashFromState(state, defaults, {
    lzString: LZString,
  });
  const parsed = ShareStateCodec.parseHash(hash, {
    lzString: LZString,
  });

  assert.match(hash, /^#s=/, 'Expected the share state to be encoded into the #s hash parameter.');
  assert.deepEqual(
    parsed.diff,
    {
      aiComputeEnabled: true,
      body: 'mars',
      systemSizeMW: 250,
    },
    'Expected the encoded payload to keep only non-default values and skip derived fields.'
  );
});

test('share hash parser ignores unrelated anchors', () => {
  const parsed = ShareStateCodec.parseHash('#overview');

  assert.equal(parsed.hasState, false);
  assert.equal(parsed.ignored, true);
});

test('share hash parser rejects unsupported payload versions', () => {
  const encoded = LZString.compressToEncodedURIComponent(JSON.stringify({
    v: 999,
    d: { systemSizeMW: 42 },
  }));

  assert.throws(
    () => ShareStateCodec.parseHash(`#s=${encoded}`, { lzString: LZString }),
    /Unsupported shared state version/,
    'Expected version mismatches to fail loudly so future migrations are explicit.'
  );
});
