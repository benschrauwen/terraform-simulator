/* Shared helpers for the calculation tests. */
import { Calc, DEFAULT_STATE, ModuleCatalog, PolicyModel } from '../../js/model/index.js';

export { Calc, DEFAULT_STATE, ModuleCatalog, PolicyModel };

export function createState(overrides = {}) {
  return {
    ...DEFAULT_STATE,
    ...overrides,
  };
}

export function runScenario(overrides = {}) {
  return Calc.calculateAll(createState(overrides));
}

export function formatMoney(value) {
  if (!Number.isFinite(value)) return 'N/A';
  const absolute = Math.abs(value);
  const sign = value < 0 ? '-' : '';

  if (absolute >= 1e9) return `${sign}$${(absolute / 1e9).toFixed(2)}B`;
  if (absolute >= 1e6) return `${sign}$${(absolute / 1e6).toFixed(2)}M`;
  if (absolute >= 1e3) return `${sign}$${(absolute / 1e3).toFixed(1)}K`;
  return `${sign}$${absolute.toFixed(0)}`;
}

// The defaults now reproduce Terraform's measured 2026 solar build (~$0.72/W
// all-in), at which the default methane plant does not pay back. Tests that need
// a profitable baseline (finite IRR, positive operating cash) use the earlier
// aspirational solar costs explicitly instead of relying on the defaults.
export const LOW_COST_SOLAR = Object.freeze({ panelCostPerW: 0.20, bosCostPerW: 0.12 });
