import assert from 'node:assert/strict';
import test from 'node:test';

import LZString from 'lz-string';

import { ShareStateCodec } from '../../js/state/share-codec.js';

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

test('share hash parser rejects oversized encoded payloads before decompressing', () => {
  const oversized = 'A'.repeat(ShareStateCodec.MAX_ENCODED_LENGTH + 1);
  let decompressCalls = 0;
  const spyLzString = {
    compressToEncodedURIComponent: LZString.compressToEncodedURIComponent,
    decompressFromEncodedURIComponent(value) {
      decompressCalls += 1;
      return LZString.decompressFromEncodedURIComponent(value);
    },
  };

  assert.throws(
    () => ShareStateCodec.parseHash(`#s=${oversized}`, { lzString: spyLzString }),
    /payload is too large/,
    'Expected an oversized share link to be rejected outright.'
  );
  assert.equal(decompressCalls, 0, 'Expected no decompression work for an oversized payload.');
});

test('share hash parser rejects payloads that decompress beyond the size cap', () => {
  // Highly repetitive JSON compresses far below the encoded-length cap.
  const expanding = LZString.compressToEncodedURIComponent(JSON.stringify({
    v: ShareStateCodec.VERSION,
    d: { customSiteLabel: 'x'.repeat(ShareStateCodec.MAX_DECODED_LENGTH) },
  }));
  assert.ok(
    expanding.length <= ShareStateCodec.MAX_ENCODED_LENGTH,
    'Test payload should pass the encoded-length cap.'
  );

  assert.throws(
    () => ShareStateCodec.parseHash(`#s=${expanding}`, { lzString: LZString }),
    /too large once decompressed/,
    'Expected an expanding payload to be rejected before JSON parsing.'
  );
});

test('share hash parser still accepts a large realistic diff', () => {
  const defaults = Object.fromEntries(Array.from({ length: 300 }, (_, index) => [`key${index}`, 0]));
  const state = Object.fromEntries(Object.keys(defaults).map((key, index) => [key, index * 1.2345]));
  const hash = ShareStateCodec.serializeHashFromState(state, defaults, { lzString: LZString });

  const { key0, ...expectedDiff } = state; // key0 equals its default
  assert.equal(key0, 0);
  assert.ok(hash.length < ShareStateCodec.MAX_ENCODED_LENGTH);
  assert.deepEqual(ShareStateCodec.parseHash(hash, { lzString: LZString }).diff, expectedDiff);
});
