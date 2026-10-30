/* ============================================
   Tornado (one-at-a-time) sensitivity variables
   ============================================
   The inputs the "What drives NPV" tornado moves, one at a time, with every
   other input at its current value. Each entry:
     stateKey   state field that is varied
     label      short row label
     format     { prefix, suffix, digits, scale } for showing input values
     bounds     { kind: 'absolute', low, high }  values in the field's units
                (numbers, or (state) => number when they depend on another
                input such as the mounting type), or
                { kind: 'relative', low, high } multipliers of the current
                value, used where no absolute range is meaningful across
                builds (site yield, a chosen technology's capex or energy use)
     appliesTo  (state, result) => whether the input matters for this build;
                `state` is normalized and `result` is its scenario result
   Bounds are clamped to the field's schema range when resolved
   (js/model/tornado.js). Market and solar bounds are the sourced slider
   benchmarks (js/ui/slider-markers.js, SOLAR_COST_PRESETS, AI_COMPUTE_DEFAULTS);
   the rest say where they come from.

   Adding a variable: append an entry here. The model, chart and tests pick it
   up; the registry test checks its bounds against the schema. */

import { POLICY_SCHEMES } from './policies.js';
import { getSolarCostPresetValues } from './reference-data.js';

// AACE International Recommended Practice 18R-97: a Class 4 (feasibility-study)
// capital estimate is expected to land within -15..-30% / +20..+50% of the final
// cost. Terraform's process capex is pre-commercial, so the wide end is used.
const PROCESS_CAPEX_RANGE = Object.freeze({ kind: 'relative', low: 0.7, high: 1.5 });
// Energy use of the selected electrolyzer / DAC technology, +/-10%: a judgment
// covering stack/sorbent degradation and scale-up, not a sourced range.
const PROCESS_ENERGY_RANGE = Object.freeze({ kind: 'relative', low: 0.9, high: 1.1 });

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
    // OPIS TOPCon module FOB China $0.109/W (Jul 2026) to DDP US $0.290/W (Mar 2026):
    // https://www.pv-magazine.com/2026/07/31/chinese-topcon-module-prices-fall-as-high-efficiency-supply-adds-pressure/
    // https://www.pv-magazine.com/2026/03/06/china-topcon-module-prices-edge-higher-as-march-cargoes-clear/
    bounds: { kind: 'absolute', low: 0.11, high: 0.29 },
    appliesTo: state => state.systemSizeMW > 0,
  },
  {
    id: 'bosCost',
    stateKey: 'bosCostPerW',
    label: 'Solar BOS',
    format: { prefix: '$', suffix: '/W', digits: 2 },
    // Terraform's target stack to the BOS implied by its measured 2026 build
    // (SOLAR_COST_PRESETS), each with the selected mounting's premium:
    // https://terraformindustries.wordpress.com/2026/10/27/how-terraform-built-the-cheapest-solar-in-north-america/
    bounds: {
      kind: 'absolute',
      low: state => getSolarCostPresetValues('terraform-target', state.mountingType).bosCostPerW,
      high: state => getSolarCostPresetValues('terraform-2026-build', state.mountingType).bosCostPerW,
    },
    appliesTo: state => state.systemSizeMW > 0,
  },
  {
    id: 'siteYield',
    stateKey: 'siteYieldMwhPerMwdcYear',
    label: 'Site yield',
    format: { suffix: ' MWh/MWdc-yr', digits: 0 },
    // +/-10% of the current site's yield: a judgment spanning weather-year
    // variability and disagreement between resource datasets (PVGIS vs Global
    // Solar Atlas). Relative because sites differ by a factor of three.
    bounds: { kind: 'relative', low: 0.9, high: 1.1 },
    appliesTo: state => state.systemSizeMW > 0,
  },
  {
    id: 'electrolyzerCapex',
    stateKey: 'electrolyzerCapex',
    label: 'Electrolyzer CAPEX',
    format: { prefix: '$', suffix: '/kW', digits: 0 },
    bounds: PROCESS_CAPEX_RANGE,
    appliesTo: state => Boolean(state.electrolyzerEnabled),
  },
  {
    id: 'electrolyzerEnergy',
    stateKey: 'electrolyzerEfficiency',
    label: 'Electrolyzer energy use',
    format: { suffix: ' kWh/kg', digits: 1 },
    bounds: PROCESS_ENERGY_RANGE,
    appliesTo: state => Boolean(state.electrolyzerEnabled),
  },
  {
    id: 'dacCapex',
    stateKey: 'dacCapex',
    label: 'DAC CAPEX',
    format: { prefix: '$', suffix: '/t-yr', digits: 0 },
    bounds: PROCESS_CAPEX_RANGE,
    appliesTo: state => Boolean(state.dacEnabled),
  },
  {
    id: 'dacEnergy',
    stateKey: 'dacEnergy',
    label: 'DAC energy use',
    format: { suffix: ' kWh/t', digits: 0 },
    bounds: PROCESS_ENERGY_RANGE,
    appliesTo: state => Boolean(state.dacEnabled),
  },
  {
    id: 'sabatierCapex',
    stateKey: 'sabatierCapex',
    label: 'Methane reactor CAPEX',
    format: { prefix: '$', suffix: '/kW-CH4', digits: 0 },
    bounds: PROCESS_CAPEX_RANGE,
    appliesTo: sellsMethane,
  },
  {
    id: 'methanolCapex',
    stateKey: 'methanolCapex',
    label: 'Methanol reactor CAPEX',
    format: { prefix: '$', suffix: '/kg-feed-hr', digits: 0 },
    bounds: PROCESS_CAPEX_RANGE,
    appliesTo: state => Boolean(state.methanolEnabled),
  },
  {
    id: 'methanePrice',
    stateKey: 'methanePrice',
    label: 'Methane price',
    format: { prefix: '$', suffix: '/MCF', digits: 0 },
    // Whitepaper 2.0 "$10/kcf" commodity case to Terraform's reported production
    // cost "under $30/MCF" (Jun 2026):
    // https://terraformindustries.wordpress.com/2023/01/09/terraform-industries-whitepaper-2-0/
    // https://terraformindustries.wordpress.com/2026/06/16/the-enormous-size-of-the-oil-and-gas-market-drives-adoption-of-synthetic-fuel-production/
    bounds: { kind: 'absolute', low: 10, high: 30 },
    appliesTo: sellsMethane,
  },
  {
    id: 'methanolPrice',
    stateKey: 'methanolPrice',
    label: 'Methanol price',
    format: { prefix: '$', suffix: '/t', digits: 0 },
    // China CFR spot $540/t (Oct 2026) to Methanex European posted contract
    // EUR 875/t = $970/t (Q4 2026):
    // https://www.procurementresource.com/news-and-articles/asian-methanol-jumps-64-percent
    // https://www.methanex.com/about-methanol/pricing/
    bounds: { kind: 'absolute', low: 540, high: 970 },
    appliesTo: sellsMethanol,
  },
  {
    id: 'discountRate',
    stateKey: 'discountRate',
    label: 'Discount rate',
    format: { suffix: '%', digits: 1 },
    // Judgment: ~5% for contracted, infrastructure-like cash flows to ~11% for
    // a merchant first-of-a-kind plant, around the 8% default.
    bounds: { kind: 'absolute', low: 5, high: 11 },
    appliesTo: () => true,
  },
  {
    id: 'processOm',
    stateKey: 'processOmPercent',
    label: 'Process O&M',
    format: { suffix: '% of CAPEX/yr', digits: 1 },
    // Judgment: the usual 2-5%/yr screening range for maintenance and
    // operating costs of a small process plant, around the 3% default.
    bounds: { kind: 'absolute', low: 2, high: 5 },
    appliesTo: hasProcess,
  },
  {
    id: 'batteryCost',
    stateKey: 'batteryCostPerKWh',
    label: 'Battery cost',
    format: { prefix: '$', suffix: '/kWh', digits: 0 },
    // BNEF 2025 turnkey BESS averages: China $73/kWh to US $219/kWh:
    // https://www.energy-storage.news/behind-the-numbers-bnef-finds-40-year-on-year-drop-in-bess-costs/
    bounds: { kind: 'absolute', low: 73, high: 219 },
    appliesTo: hasBattery,
  },
  {
    id: 'aiTokenPrice',
    stateKey: 'aiTokenPricePerM',
    label: 'AI token price',
    format: { prefix: '$', suffix: '/M tokens', digits: 2 },
    // Blended open-model list prices (Oct 2026): commodity open models ~$0.15
    // to premium open / reasoning models ~$1 per M tokens:
    // https://artificialanalysis.ai/models/comparisons/deepseek-v3-2-reasoning-vs-gpt-oss-120b
    // https://deepinfra.com/pricing
    bounds: { kind: 'absolute', low: 0.15, high: 1 },
    appliesTo: sellsTokens,
  },
  {
    id: 'aiThroughput',
    stateKey: 'aiMillionTokensPerMWh',
    label: 'AI throughput',
    format: { suffix: ' M tokens/MWh', digits: 0 },
    // InferenceX peak for DeepSeek-R1 on GB200 / B200 is ~9,000-12,000 M tokens
    // per facility MWh; the default halves it for real traffic. Low = half the
    // low peak, high = the full high peak (no real-traffic derate):
    // https://inferencex.semianalysis.com/compare/deepseek-r1-gb200-vs-h100
    bounds: { kind: 'absolute', low: 4500, high: 12000 },
    appliesTo: sellsTokens,
  },
  {
    id: 'aiGpuCapex',
    stateKey: 'aiGpuCapexPerKW',
    label: 'AI GPU CAPEX',
    format: { prefix: '$', suffix: '/kW', digits: 0 },
    // Epoch AI GB200 hyperscale build (~$33k per facility kW) to Terraform's
    // "around $50,000/kW":
    // https://epoch.ai/data-insights/ai-datacenter-cost-breakdown
    // https://terraformindustries.wordpress.com/2026/01/30/direct-current-data-centers/
    bounds: { kind: 'absolute', low: 33000, high: 50000 },
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
