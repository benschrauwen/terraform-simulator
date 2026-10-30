/* ============================================
   Tornado (one-at-a-time) sensitivity
   ============================================
   For each applicable input in data/sensitivity-variables.js: NPV with that
   input at its low and at its high bound, every other input at its current
   value. Uses the fast scenario path (same NPV as the full run, without the
   display-only series): ~1 ms per run, two runs per variable. Pure; no DOM. */

import { ModuleCatalog } from '../data/module-catalog.js';
import { getSensitivityVariables } from '../data/sensitivity-variables.js';
import { CORE_STATE_FIELDS } from '../state/schema.js';
import { Calc } from './index.js';

/** Schema min/max of a numeric state field (core, policy or module config), or null. */
export function getStateFieldRange(stateKey) {
  const core = CORE_STATE_FIELDS.find(field => field.key === stateKey);
  if (core && (core.type === 'number' || core.type === 'integer')) {
    return { min: core.min, max: core.max };
  }
  for (const module of ModuleCatalog.getAll()) {
    const config = ModuleCatalog.getConfigFields(module).find(field => field.key === stateKey);
    if (config) return { min: config.min, max: config.max };
  }
  return null;
}

function resolveBound(bound, state) {
  return typeof bound === 'function' ? bound(state) : bound;
}

/**
 * A variable's low/high input values for `state` (normalized), clamped to the
 * field's schema range; null when the field is unknown or the range is empty.
 */
export function resolveVariableBounds(variable, state) {
  const range = getStateFieldRange(variable.stateKey);
  const current = Number(state[variable.stateKey]);
  if (!range || !Number.isFinite(current)) return null;

  const { kind } = variable.bounds;
  let low = resolveBound(variable.bounds.low, state);
  let high = resolveBound(variable.bounds.high, state);
  if (kind === 'relative') {
    low *= current;
    high *= current;
  } else if (kind !== 'absolute') {
    return null;
  }
  const clamp = value => Math.min(range.max, Math.max(range.min, value));
  low = clamp(low);
  high = clamp(high);
  return Number.isFinite(low) && Number.isFinite(high) && high > low ? { low, high } : null;
}

/**
 * One-at-a-time NPV sensitivity. Returns the base NPV and one bar per
 * applicable variable: { id, stateKey, label, variable, baseValue, lowValue,
 * highValue, lowNpv, highNpv, swing }, where swing is the NPV span the bar
 * covers (base included), sorted by swing, largest first. Variables whose
 * bounds do not move NPV are left out.
 */
export function runTornado(rawState, variables = null) {
  const state = Calc.normalizeState(rawState);
  const fastNpv = scenarioState => Calc.calculateScenario(scenarioState, { fastMode: true }).economics.npv;
  const baseResult = Calc.calculateScenario(state, { fastMode: true });
  const baseNpv = baseResult.economics.npv;
  let runs = 1;
  const bars = [];

  (variables || getSensitivityVariables(state)).forEach(variable => {
    if (typeof variable.appliesTo === 'function' && !variable.appliesTo(state, baseResult)) return;
    const bounds = resolveVariableBounds(variable, state);
    if (!bounds) return;

    const lowNpv = fastNpv({ ...state, [variable.stateKey]: bounds.low });
    const highNpv = fastNpv({ ...state, [variable.stateKey]: bounds.high });
    runs += 2;
    if (!Number.isFinite(lowNpv) || !Number.isFinite(highNpv)) return;

    const swing = Math.max(baseNpv, lowNpv, highNpv) - Math.min(baseNpv, lowNpv, highNpv);
    // Below a cent per million dollars of NPV the input does not matter here.
    if (!(swing > 1e-8 * Math.max(1, Math.abs(baseNpv)))) return;

    bars.push({
      id: variable.id,
      stateKey: variable.stateKey,
      label: variable.label,
      variable,
      baseValue: state[variable.stateKey],
      lowValue: bounds.low,
      highValue: bounds.high,
      lowNpv,
      highNpv,
      swing,
    });
  });

  bars.sort((a, b) => b.swing - a.swing);
  return { baseNpv, bars, runs };
}
