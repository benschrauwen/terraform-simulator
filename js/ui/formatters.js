/* ============================================
   Domain display formatters shared by controls and renderers
   ============================================ */

import { ModuleCatalog } from '../data/module-catalog.js';
import { FormatNumbers } from './format-numbers.js';

export function formatSystemSizeMW(value) {
  const mw = parseFloat(value);
  if (!Number.isFinite(mw)) return '—';
  if (mw >= 1000) return `${FormatNumbers.fixed(mw / 1000, 2)} GW`;
  return `${FormatNumbers.fixed(mw, 1)} MW`;
}

/* Power given in kW: kW below 1 MW, then MW / GW. */
export function formatPowerKW(value) {
  const kw = parseFloat(value);
  if (!Number.isFinite(kw)) return '—';
  if (kw >= 1000) return formatSystemSizeMW(kw / 1000);
  return `${FormatNumbers.fixed(kw, kw < 10 ? 1 : 0)} kW`;
}

export function formatYears(value) {
  return `${FormatNumbers.fixed(parseInt(value, 10), 0)} years`;
}

export function formatIrr(value) {
  if (!Number.isFinite(value) || value <= -99.9) return 'N/A';
  return `${FormatNumbers.fixed(value, 1)}%`;
}

/** IRR, or the model's verdict label when no single meaningful IRR exists. */
export function formatIrrWithStatus(value, analysis) {
  if (Number.isFinite(value) && value > -99.9) return formatIrr(value);
  return analysis?.label || 'N/A';
}

/** MIRR (finance and reinvest at the discount rate). */
export function formatMirr(value) {
  return Number.isFinite(value) ? `${FormatNumbers.fixed(value, 1)}%` : 'N/A';
}

export function formatMethaneFeedstockSplit(value) {
  const methaneShare = Math.max(0, Math.min(100, parseFloat(value)));
  const methanolShare = Math.max(0, 100 - methaneShare);
  return `${FormatNumbers.fixed(methaneShare, 0)}% methane / ${FormatNumbers.fixed(methanolShare, 0)}% methanol`;
}

export function formatMtgMethanolSplit(value) {
  const mtgShare = Math.max(0, Math.min(100, parseFloat(value)));
  const exportShare = Math.max(0, 100 - mtgShare);
  return `${FormatNumbers.fixed(mtgShare, 0)}% MTG / ${FormatNumbers.fixed(exportShare, 0)}% export`;
}

export function formatChemicalSizingPercent(value) {
  const percent = Math.max(0, Math.min(100, parseFloat(value)));
  return `${FormatNumbers.fixed(percent, 0)}% of full-capture peak`;
}

export function formatExploratoryPriorityWeight(value) {
  return `${FormatNumbers.fixed(parseFloat(value), 0)} weight`;
}

export function formatExploratoryOmPercent(value) {
  return `${FormatNumbers.fixed(parseFloat(value), 1)}%/yr`;
}

/** CAPEX basis of an exploratory route, e.g. `$450/ton/yr capacity`. */
export function formatExploratoryCapexBasis(moduleId, route, value) {
  const capexConfig = ModuleCatalog.getCapexControlConfig(moduleId, route);
  const digits = capexConfig.step < 1 ? 2 : 0;
  return `$${FormatNumbers.fixed(parseFloat(value), digits)}/${capexConfig.unitLabel.replace('$/', '')}`;
}

/** Sale price of a module's market product, e.g. `$350/ton`. */
export function formatModuleMarketValue(moduleId, route, value) {
  const marketConfig = ModuleCatalog.getMarketConfig(moduleId, route);
  if (!marketConfig) return `$${FormatNumbers.fixed(parseFloat(value), 2)}`;
  const digits = marketConfig.step < 1 ? 2 : 0;
  return `$${FormatNumbers.fixed(parseFloat(value), digits)}/${marketConfig.unitLabel.replace('$/', '')}`;
}

/** Module config slider value in the unit declared by the module catalog. */
export function formatConfigValue(unit, value) {
  const numeric = parseFloat(value);
  if (unit === '%') return `${FormatNumbers.fixed(numeric, numeric % 1 ? 1 : 0)}%`;
  if (unit === '$') return `$${FormatNumbers.fixed(Math.round(numeric), 0)}`;
  if (unit === '$/W') return `$${FormatNumbers.fixed(numeric, 2)}/W`;
  if (unit === '$/kW') return `$${FormatNumbers.fixed(Math.round(numeric), 0)}/kW`;
  if (unit === '$/kW-CH4') return `$${FormatNumbers.fixed(Math.round(numeric), 0)}/kW CH4`;
  if (unit === '$/t-yr') return `$${FormatNumbers.fixed(Math.round(numeric), 0)}/ton/yr`;
  if (unit === '$/kg-feed-hr') return `$${FormatNumbers.fixed(Math.round(numeric), 0)}/(kg/h feed)`;
  if (unit === 'kWh/kg') return `${FormatNumbers.fixed(Math.round(numeric), 0)} kWh/kg`;
  if (unit === 'kWh/t') return `${FormatNumbers.fixed(Math.round(numeric), 0)} kWh/t`;
  return `${FormatNumbers.fixed(numeric, Number.isInteger(numeric) ? 0 : 2)}`;
}
