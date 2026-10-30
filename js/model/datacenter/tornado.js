/* ============================================
   Datacenter tornado and break-even
   ============================================
   runDatacenterTornado: the plant builder's one-at-a-time NPV tornado
   (model/tornado.js resolveVariableBounds: +/- swing, clamped to the field's
   schema range) over data/datacenter/sensitivity-variables.js, using the
   fast scenario path (cached dispatch when only prices or costs move).

   calculateDatacenterBreakEven: the revenue price (token price or
   colocation lease) at which project NPV = 0. Revenue is volume x price x
   operating fraction and nothing else reads the price, so NPV is a straight
   line in it: two fast runs give the root (model/break-even.js
   solveLinearZero), cross-checking the analytic economics.breakEven.
   Pure; no DOM. */

import { getDatacenterSensitivityVariables } from '../../data/datacenter/sensitivity-variables.js';
import { DATACENTER_STATE_FIELDS, normalizeDatacenterState } from '../../state/datacenter-schema.js';
import { solveLinearZero } from '../break-even.js';
import { DEFAULT_TORNADO_SWING_PERCENT, resolveVariableBounds } from '../tornado.js';
import { calculateDatacenterScenario } from './scenario.js';

/** Schema min/max of a numeric datacenter field, or null. */
export function getDatacenterFieldRange(stateKey) {
  const field = DATACENTER_STATE_FIELDS.find(entry => entry.key === stateKey);
  return field && (field.type === 'number' || field.type === 'integer') ? { min: field.min, max: field.max } : null;
}

const fastNpv = state => calculateDatacenterScenario(state, { fastMode: true }).economics.npv;

/**
 * One-at-a-time NPV sensitivity: { baseNpv, bars[{ id, stateKey, label,
 * variable, baseValue, lowValue, highValue, lowNpv, highNpv, swing }],
 * runs, swingPercent }, bars sorted by swing (largest first), rows that do
 * not move NPV dropped (same shape as the plant builder's runTornado).
 */
export function runDatacenterTornado(rawState, variables = null, options = {}) {
  const state = normalizeDatacenterState(rawState);
  const swingPercent = Number(options.swingPercent ?? state.tornadoSwingPercent ?? DEFAULT_TORNADO_SWING_PERCENT);
  const swingFraction = Math.min(0.95, Math.max(0.01, swingPercent / 100));
  const baseResult = calculateDatacenterScenario(state, { fastMode: true });
  const baseNpv = baseResult.economics.npv;
  let runs = 1;
  const bars = [];

  (variables || getDatacenterSensitivityVariables(state)).forEach(variable => {
    if (typeof variable.appliesTo === 'function' && !variable.appliesTo(state, baseResult)) return;
    const bounds = resolveVariableBounds(variable, state, swingFraction, getDatacenterFieldRange);
    if (!bounds) return;
    // Integer fields (asset lives) move to the nearest whole value.
    const field = DATACENTER_STATE_FIELDS.find(entry => entry.key === variable.stateKey);
    const value = v => (field?.type === 'integer' ? Math.round(v) : v);
    const lowValue = value(bounds.low);
    const highValue = value(bounds.high);
    if (lowValue === highValue) return;
    const lowNpv = fastNpv({ ...state, [variable.stateKey]: lowValue });
    const highNpv = fastNpv({ ...state, [variable.stateKey]: highValue });
    runs += 2;
    if (!Number.isFinite(lowNpv) || !Number.isFinite(highNpv)) return;
    const swing = Math.max(baseNpv, lowNpv, highNpv) - Math.min(baseNpv, lowNpv, highNpv);
    if (!(swing > 1e-8 * Math.max(1, Math.abs(baseNpv)))) return;
    bars.push({
      id: variable.id, stateKey: variable.stateKey, label: variable.label, variable,
      baseValue: state[variable.stateKey], lowValue, highValue, lowNpv, highNpv, swing,
    });
  });

  bars.sort((a, b) => b.swing - a.swing);
  return { baseNpv, bars, runs, swingPercent: swingFraction * 100 };
}

/**
 * Break-even revenue price by two fast runs: { paramKey, label, unit,
 * currentPrice, breakEvenPrice (null when nothing is sold), npvPerUnitPrice,
 * ratioToCurrent, positiveAtZeroPrice }.
 */
export function calculateDatacenterBreakEven(rawState, { baseResult = null } = {}) {
  const base = baseResult?.economics ? baseResult : calculateDatacenterScenario(rawState, { fastMode: true });
  const { paramKey, label, unit } = base.economics.breakEven;
  const p0 = base.state[paramKey];
  const empty = { paramKey, label, unit, currentPrice: p0, breakEvenPrice: null, npvPerUnitPrice: 0, ratioToCurrent: null, positiveAtZeroPrice: false };
  const range = getDatacenterFieldRange(paramKey);
  const step = Math.max(0.01, Math.abs(p0) * 0.5);
  const probePrice = p0 + step <= range.max ? p0 + step : p0 - step;
  if (probePrice < range.min) return empty;
  const probeNpv = fastNpv({ ...base.state, [paramKey]: probePrice });
  const breakEvenPrice = solveLinearZero(p0, base.economics.npv, probePrice, probeNpv);
  if (breakEvenPrice === null) return empty;
  return {
    ...empty,
    breakEvenPrice,
    npvPerUnitPrice: (probeNpv - base.economics.npv) / (probePrice - p0),
    ratioToCurrent: p0 > 0 ? breakEvenPrice / p0 : null,
    positiveAtZeroPrice: breakEvenPrice < 0,
  };
}
