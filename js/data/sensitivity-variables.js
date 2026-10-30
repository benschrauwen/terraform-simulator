/* ============================================
   Tornado (one-at-a-time) sensitivity variables
   ============================================
   The inputs the "What drives NPV" tornado moves, one at a time, with every
   other input at its current value. Each entry:
     stateKey   state field that is varied
     label      short row label
     format     { prefix, suffix, digits, scale } for showing input values
     bounds     optional. Without it the input swings by the chosen
                +/- percentage around its current value (the tornado's swing
                selector, state.tornadoSwingPercent). Only inputs with a real
                range set it: { kind: 'absolute', low, high } in the field's
                units (numbers or (state) => number), e.g. an incentive credit
                from the scheme's floor to its current value.
     appliesTo  (state, result) => whether the input matters for this build;
                `state` is normalized and `result` is its scenario result
   All values are clamped to the field's schema range (js/model/tornado.js),
   so a 95% conversion efficiency cannot swing past 100%.

   Adding a variable: append an entry here. The model, chart and tests pick it up. */

import { POLICY_SCHEMES } from './policies.js';

const hasProcess = state => Boolean(state.electrolyzerEnabled || state.dacEnabled);
const sellsMethane = (state, result) => Boolean(result?.sabatier?.enabled) && (result.sabatier.ch4AnnualMCF || 0) > 0;
const sellsMethanol = (state, result) => Boolean(result?.methanol?.enabled) && (result.methanol.exportAnnualTons || 0) > 0;
const sellsTokens = (state, result) => Boolean(result?.ai?.enabled) && (result.ai.annualTokensM || 0) > 0;
const hasBattery = (state, result) => Boolean(result?.storage?.enabled) && (result.storage.battCapKWh || 0) > 0;

export const SENSITIVITY_VARIABLES = Object.freeze([
  {
    id: 'panelCost',
    stateKey: 'panelCostPerW',
    label: 'Module price',
    format: { prefix: '$', suffix: '/W', digits: 2 },
    appliesTo: state => state.systemSizeMW > 0,
  },
  {
    id: 'bosCost',
    stateKey: 'bosCostPerW',
    label: 'Solar BOS',
    format: { prefix: '$', suffix: '/W', digits: 2 },
    appliesTo: state => state.systemSizeMW > 0,
  },
  {
    id: 'siteYield',
    stateKey: 'siteYieldMwhPerMwdcYear',
    label: 'Site yield',
    format: { suffix: ' MWh/MWdc-yr', digits: 0 },
    appliesTo: state => state.systemSizeMW > 0,
  },
  {
    id: 'electrolyzerCapex',
    stateKey: 'electrolyzerCapex',
    label: 'Electrolyzer CAPEX',
    format: { prefix: '$', suffix: '/kW', digits: 0 },
    appliesTo: state => Boolean(state.electrolyzerEnabled),
  },
  {
    id: 'electrolyzerEnergy',
    stateKey: 'electrolyzerEfficiency',
    label: 'Electrolyzer energy use',
    format: { suffix: ' kWh/kg', digits: 1 },
    appliesTo: state => Boolean(state.electrolyzerEnabled),
  },
  {
    id: 'dacCapex',
    stateKey: 'dacCapex',
    label: 'DAC CAPEX',
    format: { prefix: '$', suffix: '/t-yr', digits: 0 },
    appliesTo: state => Boolean(state.dacEnabled),
  },
  {
    id: 'dacEnergy',
    stateKey: 'dacEnergy',
    label: 'DAC energy use',
    format: { suffix: ' kWh/t', digits: 0 },
    appliesTo: state => Boolean(state.dacEnabled),
  },
  {
    id: 'sabatierCapex',
    stateKey: 'sabatierCapex',
    label: 'Methane reactor CAPEX',
    format: { prefix: '$', suffix: '/kW-CH4', digits: 0 },
    appliesTo: sellsMethane,
  },
  {
    id: 'methanolCapex',
    stateKey: 'methanolCapex',
    label: 'Methanol reactor CAPEX',
    format: { prefix: '$', suffix: '/kg-feed-hr', digits: 0 },
    appliesTo: state => Boolean(state.methanolEnabled),
  },
  {
    id: 'methanePrice',
    stateKey: 'methanePrice',
    label: 'Methane price',
    format: { prefix: '$', suffix: '/MCF', digits: 0 },
    appliesTo: sellsMethane,
  },
  {
    id: 'methanolPrice',
    stateKey: 'methanolPrice',
    label: 'Methanol price',
    format: { prefix: '$', suffix: '/t', digits: 0 },
    appliesTo: sellsMethanol,
  },
  {
    id: 'discountRate',
    stateKey: 'discountRate',
    label: 'Discount rate',
    format: { suffix: '%', digits: 1 },
    appliesTo: () => true,
  },
  {
    id: 'processOm',
    stateKey: 'processOmPercent',
    label: 'Process O&M',
    format: { suffix: '% of CAPEX/yr', digits: 1 },
    appliesTo: hasProcess,
  },
  {
    id: 'batteryCost',
    stateKey: 'batteryCostPerKWh',
    label: 'Battery cost',
    format: { prefix: '$', suffix: '/kWh', digits: 0 },
    appliesTo: hasBattery,
  },
  {
    id: 'aiTokenPrice',
    stateKey: 'aiTokenPricePerM',
    label: 'AI token price',
    format: { prefix: '$', suffix: '/M tokens', digits: 2 },
    appliesTo: sellsTokens,
  },
  {
    id: 'aiThroughput',
    stateKey: 'aiMillionTokensPerMWh',
    label: 'AI throughput',
    format: { suffix: ' M tokens/MWh', digits: 0 },
    appliesTo: sellsTokens,
  },
  {
    id: 'aiGpuCapex',
    stateKey: 'aiGpuCapexPerKW',
    label: 'AI GPU CAPEX',
    format: { prefix: '$', suffix: '/kW', digits: 0 },
    appliesTo: (state, result) => Boolean(result?.ai?.enabled) && (result.ai.designLoadKW || 0) > 0,
  },
]);

// Input display formats for policy inputs (see formatPolicyInputValue in model/policy.js).
const POLICY_INPUT_FORMATS = {
  share: { suffix: '%', digits: 0, scale: 100 },
  currency_per_kwh: { prefix: '$', suffix: '/kWh', digits: 3 },
  currency_per_mwh: { prefix: '$', suffix: '/MWh', digits: 0 },
  currency_per_kg: { prefix: '$', suffix: '/kg', digits: 2 },
  currency_per_ton: { prefix: '$', suffix: '/t', digits: 0 },
};

// Cash-flow types whose single input sets the support level on its own.
// Two-input schemes (strike - reference, base - correction) and the custom
// mix have no single "main credit" to move.
const SINGLE_INPUT_POLICY_ROLES = { capex_share: 'share', unit_support: 'perUnit' };

/**
 * The active policy's credit, from the scheme's own floor (0, or the lowest
 * statutory tier where the slider stops above 0, e.g. 45V $0.13/kg) up to the
 * current value. Null when the scheme has no single credit input.
 */
export function buildPolicyCreditVariable(policyMode) {
  const scheme = Object.hasOwn(POLICY_SCHEMES, policyMode) ? POLICY_SCHEMES[policyMode] : null;
  const role = SINGLE_INPUT_POLICY_ROLES[scheme?.cashflowType];
  const input = role ? (scheme.inputs || []).find(candidate => candidate.role === role) : null;
  if (!input) return null;
  return {
    id: 'policyCredit',
    stateKey: input.key,
    label: input.label,
    format: POLICY_INPUT_FORMATS[input.format] || { digits: 2 },
    bounds: { kind: 'absolute', low: input.min, high: state => state[input.key] },
    appliesTo: () => true,
  };
}

/** The registry plus the active policy's credit, for one state. */
export function getSensitivityVariables(state) {
  const policyVariable = buildPolicyCreditVariable(state?.policyMode);
  return policyVariable ? [...SENSITIVITY_VARIABLES, policyVariable] : [...SENSITIVITY_VARIABLES];
}

/** An input value in its variable's display units, e.g. "$0.20/W". */
export function formatSensitivityValue(variable, value) {
  const format = variable?.format || {};
  const scaled = Number(value) * (format.scale || 1);
  if (!Number.isFinite(scaled)) return '—';
  const digits = Number.isInteger(format.digits) ? format.digits : 2;
  const magnitude = Math.abs(scaled).toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return `${scaled < 0 ? '-' : ''}${format.prefix || ''}${magnitude}${format.suffix || ''}`;
}
