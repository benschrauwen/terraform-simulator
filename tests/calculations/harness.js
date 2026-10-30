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
