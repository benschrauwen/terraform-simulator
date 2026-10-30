/* Small numeric helpers shared by the model, state and policy layers.
   Plain functions (no `this`); the Calc facade re-exposes them as methods. */

export function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function clampNumber(value, min, max, fallback = min) {
  const numeric = toFiniteNumber(value, fallback);
  return Math.min(max, Math.max(min, numeric));
}

export function clampInteger(value, min, max, fallback = min) {
  return Math.round(clampNumber(value, min, max, fallback));
}

/* Number of decimals implied by a slider step (0.05 -> 2, 1e-7 -> 7). */
export function getStepPrecision(step) {
  if (!Number.isFinite(step) || Number.isInteger(step)) return 0;
  const normalized = String(step).toLowerCase();
  if (normalized.includes('e-')) {
    return parseInt(normalized.split('e-')[1], 10);
  }
  return normalized.includes('.') ? normalized.split('.')[1].length : 0;
}

export function sumValues(values) {
  return Object.values(values || {}).reduce((sum, value) => sum + (Number(value) || 0), 0);
}

export const utilMethods = {
  toFiniteNumber,
  clampNumber,
  clampInteger,
  getStepPrecision,
};
