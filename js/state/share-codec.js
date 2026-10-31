/* ============================================
   Share-link codec
   ============================================
   Encodes the non-default part of the state as an lz-string compressed JSON
   payload in the URL hash (#s=...), and decodes / validates it back. */

export const ShareStateCodec = (function () {
  const VERSION = 1;
  const HASH_KEY = 's';
  const EXCLUDED_STATE_KEYS = ['batteryEnabled'];
  // Real share links are a few hundred characters; the caps bound the work
  // (and memory) a crafted link can cause before validation.
  const MAX_ENCODED_LENGTH = 16384;
  const MAX_DECODED_LENGTH = 200000;

  function getLzString(explicitLzString) {
    const lzString = explicitLzString || globalThis.LZString;

    if (
      !lzString ||
      typeof lzString.compressToEncodedURIComponent !== 'function' ||
      typeof lzString.decompressFromEncodedURIComponent !== 'function'
    ) {
      throw new Error('LZString is unavailable.');
    }

    return lzString;
  }

  function normalizeHash(hash = '') {
    return typeof hash === 'string' ? hash.replace(/^#/, '') : '';
  }

  /* The non-default part of `state`. `options.alwaysIncludeKeys` lists keys
     that join any non-empty diff even when they equal the default: fields
     whose default follows another field (the datacenter page's preset-derived
     prices) would otherwise be re-derived from the new selection on decode. */
  function buildDiff(state = {}, defaults = {}, options = {}) {
    const excludedKeys = new Set(options.excludeKeys || EXCLUDED_STATE_KEYS);
    const diff = {};

    Object.keys(defaults).forEach(key => {
      if (excludedKeys.has(key)) return;
      const value = state[key];
      if (value === undefined) return;
      if (Object.is(value, defaults[key])) return;
      diff[key] = value;
    });

    if (Object.keys(diff).length) {
      (options.alwaysIncludeKeys || []).forEach(key => {
        if (excludedKeys.has(key) || state[key] === undefined) return;
        diff[key] = state[key];
      });
    }

    return diff;
  }

  function validatePayload(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('Shared state payload must be an object.');
    }

    if (payload.v !== VERSION) {
      throw new Error(`Unsupported shared state version: ${payload.v}`);
    }

    if (!payload.d || typeof payload.d !== 'object' || Array.isArray(payload.d)) {
      throw new Error('Shared state diff must be an object.');
    }
  }

  function encodePayload(payload, options = {}) {
    const lzString = getLzString(options.lzString);
    return lzString.compressToEncodedURIComponent(JSON.stringify(payload));
  }

  function decodePayload(encodedPayload, options = {}) {
    const lzString = getLzString(options.lzString);
    if (typeof encodedPayload === 'string' && encodedPayload.length > MAX_ENCODED_LENGTH) {
      throw new Error('Shared state payload is too large.');
    }

    const json = lzString.decompressFromEncodedURIComponent(encodedPayload);

    if (!json) {
      throw new Error('Unable to decompress shared state payload.');
    }

    if (json.length > MAX_DECODED_LENGTH) {
      throw new Error('Shared state payload is too large once decompressed.');
    }

    let payload;
    try {
      payload = JSON.parse(json);
    } catch {
      throw new Error('Unable to parse shared state payload JSON.');
    }

    validatePayload(payload);
    return payload;
  }

  function parseHash(hash = '', options = {}) {
    const hashKey = options.hashKey || HASH_KEY;
    const normalizedHash = normalizeHash(hash);

    if (!normalizedHash) {
      return {
        diff: {},
        empty: true,
        hasState: false,
        ignored: false,
        payload: null,
      };
    }

    if (!normalizedHash.includes('=')) {
      return {
        diff: {},
        empty: false,
        hasState: false,
        ignored: true,
        payload: null,
      };
    }

    const params = new URLSearchParams(normalizedHash);
    if (!params.has(hashKey)) {
      return {
        diff: {},
        empty: false,
        hasState: false,
        ignored: true,
        payload: null,
      };
    }

    const encodedPayload = params.get(hashKey);
    if (!encodedPayload) {
      throw new Error('Shared state payload is empty.');
    }

    const payload = decodePayload(encodedPayload, options);
    return {
      diff: payload.d,
      empty: false,
      hasState: true,
      ignored: false,
      payload,
    };
  }

  function serializeHashFromState(state = {}, defaults = {}, options = {}) {
    const diff = buildDiff(state, defaults, options);
    if (!Object.keys(diff).length) return '';

    const payload = {
      v: options.version || VERSION,
      d: diff,
    };
    const params = new URLSearchParams();
    params.set(options.hashKey || HASH_KEY, encodePayload(payload, options));
    return `#${params.toString()}`;
  }

  function statesEqual(left = {}, right = {}, keys = null) {
    const compareKeys = Array.isArray(keys)
      ? keys
      : Array.from(new Set([...Object.keys(left), ...Object.keys(right)]));

    return compareKeys.every(key => Object.is(left[key], right[key]));
  }

  return {
    VERSION,
    HASH_KEY,
    EXCLUDED_STATE_KEYS,
    MAX_ENCODED_LENGTH,
    MAX_DECODED_LENGTH,
    buildDiff,
    decodePayload,
    encodePayload,
    normalizeHash,
    parseHash,
    serializeHashFromState,
    statesEqual,
  };
})();
