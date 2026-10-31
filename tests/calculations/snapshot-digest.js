/* Digest and comparison helpers shared by the characterization snapshots
   (plant builder and datacenter): numbers to 12 significant digits, long
   strings hashed, numeric arrays reduced to length / sum / weighted sum /
   min / max, and a tolerant recursive diff. */

const REL_TOL = 1e-9;
const ABS_TOL = 1e-6;

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

export function digest(value) {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === 'number') return Number.isFinite(value) ? Number(value.toPrecision(12)) : String(value);
  if (typeof value === 'string' && value.length > 48) return `#${hashStrings([value])}`;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value) || ArrayBuffer.isView(value)) return digestArray(Array.from(value));
  return Object.fromEntries(
    Object.keys(value).sort().map(key => [key, digest(value[key])])
  );
}

export function findMismatches(expected, actual, pathLabel, out) {
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
