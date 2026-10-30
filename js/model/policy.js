/* ============================================
   Policy evaluation
   ============================================
   Turns the selected scheme from data/policies.js into upfront (close) and
   annual support cash flows for the economics model. */

import { POLICY_SCHEMES, POLICY_SELECT_GROUPS } from '../data/policies.js';
import { getStepPrecision, sumValues, toFiniteNumber } from './util.js';

export { POLICY_SCHEMES };

function formatFixed(value, digits) {
  return Number(value).toFixed(Math.max(0, digits));
}

function formatSupportFamily(value) {
  return String(value || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, match => match.toUpperCase());
}

function getPolicyScheme(mode) {
  return typeof mode === 'string' && Object.hasOwn(POLICY_SCHEMES, mode)
    ? POLICY_SCHEMES[mode]
    : POLICY_SCHEMES.none;
}

function getPolicySelectGroups() {
  return POLICY_SELECT_GROUPS.map(group => ({
    label: group.label,
    options: group.ids
      .map(id => {
        const scheme = POLICY_SCHEMES[id];
        return scheme ? { id, label: scheme.selectLabel || scheme.label } : null;
      })
      .filter(Boolean),
  })).filter(group => group.options.length);
}

function getPolicyInputValue(state, input) {
  return toFiniteNumber(state?.[input.key], input.defaultValue);
}

function formatPolicyInputValue(input, value) {
  const precision = getStepPrecision(input.step);
  const numeric = toFiniteNumber(value, input.defaultValue);

  switch (input.format) {
    case 'share':
      return `${formatFixed(numeric * 100, Math.max(0, precision - 2))}%`;
    case 'currency_per_kwh':
      return `$${formatFixed(numeric, Math.max(3, precision))}/kWh`;
    case 'currency_per_mwh':
      return `$${formatFixed(numeric, Math.max(0, precision))}/MWh`;
    case 'currency_per_kg':
      return `$${formatFixed(numeric, Math.max(2, precision))}/kg`;
    case 'currency_per_ton':
      return `$${formatFixed(numeric, Math.max(0, precision))}/tCO2`;
    default:
      return formatFixed(numeric, precision);
  }
}

function getPolicyInputDetails(state, scheme) {
  return (scheme.inputs || []).map(input => {
    const value = getPolicyInputValue(state, input);
    return {
      ...input,
      value,
      formattedValue: formatPolicyInputValue(input, value),
    };
  });
}

function getEligibleCapexBreakdown(basis, capex = {}) {
  if (basis === 'solar') {
    return { solar: capex.solar || 0 };
  }
  if (basis === 'electrolyzer') {
    return { electrolyzer: capex.electrolyzer || 0 };
  }
  if (basis === 'dac') {
    return { dac: capex.dac || 0 };
  }
  if (basis === 'total') {
    return {
      solar: capex.solar || 0,
      land: capex.land || 0,
      battery: capex.battery || 0,
      ai: capex.ai || 0,
      electrolyzer: capex.electrolyzer || 0,
      dac: capex.dac || 0,
      sabatier: capex.sabatier || 0,
      methanol: capex.methanol || 0,
      exploratory: capex.exploratory || 0,
    };
  }

  return {};
}

/* Splits an upfront support amount across capex keys pro rata; the last key
   takes the remainder so the parts sum exactly to the total. */
export function allocateUpfrontSupport(totalSupport, breakdown = {}) {
  const eligibleTotal = sumValues(breakdown);
  if (!Number.isFinite(totalSupport) || totalSupport <= 0 || eligibleTotal <= 0) {
    return Object.fromEntries(Object.keys(breakdown).map(key => [key, 0]));
  }

  const keys = Object.keys(breakdown);
  let allocated = 0;
  return keys.reduce((result, key, index) => {
    const basisValue = Math.max(0, Number(breakdown[key]) || 0);
    const value = index === (keys.length - 1)
      ? Math.max(0, totalSupport - allocated)
      : (totalSupport * basisValue) / eligibleTotal;
    allocated += value;
    result[key] = value;
    return result;
  }, {});
}

function getOutputMetric(outputBasis, context = {}) {
  const solarAnnualMwh = Math.max(0, Number(context?.solar?.annualMWh) || 0);
  const hydrogenAnnualKg = context?.electrolyzer?.enabled
    ? Math.max(0, Number(context?.electrolyzer?.h2AnnualKg) || 0)
    : 0;
  const co2AnnualTons = context?.dac?.enabled
    ? Math.max(0, Number(context?.dac?.co2AnnualTons) || 0)
    : 0;

  switch (outputBasis) {
    case 'solar_kwh':
      return {
        label: 'Eligible solar output',
        unit: 'kWh/yr',
        value: solarAnnualMwh * 1000,
      };
    case 'solar_mwh':
      return {
        label: 'Eligible solar output',
        unit: 'MWh/yr',
        value: solarAnnualMwh,
      };
    case 'hydrogen_kg':
      return {
        label: 'Eligible hydrogen output',
        unit: 'kg/yr',
        value: hydrogenAnnualKg,
      };
    case 'co2_ton':
      return {
        label: 'Eligible CO2 output',
        unit: 'tCO2/yr',
        value: co2AnnualTons,
      };
    default:
      return {
        label: 'Eligible output',
        unit: '',
        value: 0,
      };
  }
}

function getEligibleCapexLabel(basis) {
  switch (basis) {
    case 'solar':
      return 'Eligible solar CAPEX';
    case 'electrolyzer':
      return 'Eligible electrolyzer CAPEX';
    case 'dac':
      return 'Eligible DAC CAPEX';
    case 'total':
      return 'Eligible project CAPEX';
    default:
      return 'Eligible CAPEX';
  }
}

function evaluatePolicy(state = {}, context = {}) {
  const scheme = getPolicyScheme(state.policyMode);
  const inputs = getPolicyInputDetails(state, scheme);
  const capexBreakdown = getEligibleCapexBreakdown(scheme.eligibleCapexBasis, context.capex || {});
  const eligibleCapex = sumValues(capexBreakdown);
  const outputMetric = getOutputMetric(scheme.outputBasis, context);

  let annualSupport = 0;
  let upfrontSupport = 0;
  let effectiveUnitSupport = 0;
  const componentValues = {};

  switch (scheme.cashflowType) {
    case 'capex_share': {
      const rate = inputs[0]?.value || 0;
      effectiveUnitSupport = rate;
      upfrontSupport = eligibleCapex * rate;
      break;
    }

    case 'unit_support': {
      const supportPerUnit = inputs[0]?.value || 0;
      effectiveUnitSupport = supportPerUnit;
      annualSupport = outputMetric.value * supportPerUnit;
      break;
    }

    case 'strike_minus_reference': {
      const strike = inputs[0]?.value || 0;
      const reference = inputs[1]?.value || 0;
      effectiveUnitSupport = strike - reference;
      annualSupport = outputMetric.value * effectiveUnitSupport;
      break;
    }

    case 'base_minus_correction': {
      const baseAmount = inputs[0]?.value || 0;
      const correctionAmount = inputs[1]?.value || 0;
      effectiveUnitSupport = Math.max(baseAmount - correctionAmount, 0);
      annualSupport = outputMetric.value * effectiveUnitSupport;
      break;
    }

    case 'custom_composite': {
      const capexShare = inputs.find(input => input.key === 'customCapexGrantShare')?.value || 0;
      const solarSupportPerMwh = inputs.find(input => input.key === 'customSolarSupportPerMwh')?.value || 0;
      const h2SupportPerKg = inputs.find(input => input.key === 'customH2Credit')?.value || 0;
      const co2SupportPerTon = inputs.find(input => input.key === 'customCo2Credit')?.value || 0;
      const solarAnnualMwh = Math.max(0, Number(context?.solar?.annualMWh) || 0);
      const hydrogenAnnualKg = context?.electrolyzer?.enabled
        ? Math.max(0, Number(context?.electrolyzer?.h2AnnualKg) || 0)
        : 0;
      const co2AnnualTons = context?.dac?.enabled
        ? Math.max(0, Number(context?.dac?.co2AnnualTons) || 0)
        : 0;

      upfrontSupport = sumValues(context.capex || {}) * capexShare;
      componentValues.solar = solarAnnualMwh * solarSupportPerMwh;
      componentValues.hydrogen = hydrogenAnnualKg * h2SupportPerKg;
      componentValues.co2 = co2AnnualTons * co2SupportPerTon;
      annualSupport = sumValues(componentValues);
      break;
    }

    case 'framework_only':
    case 'none':
    default:
      break;
  }

  return {
    mode: state.policyMode,
    label: scheme.label,
    applicability: scheme.jurisdiction,
    policyLayer: scheme.policyLayer,
    technology: scheme.technology,
    simulatorTreatment: scheme.simulatorTreatment,
    supportFamily: scheme.supportFamily,
    supportFamilyLabel: formatSupportFamily(scheme.supportFamily),
    supportTiming: scheme.supportTiming,
    durationYears: Number.isFinite(scheme.durationYears) ? scheme.durationYears : null,
    competitiveFlag: scheme.competitiveFlag,
    referencePriceRequired: Boolean(scheme.referencePriceRequired),
    carbonIntensityGate: Boolean(scheme.carbonIntensityGate),
    renewableAttributeGate: Boolean(scheme.renewableAttributeGate),
    domesticContentOrLocationBonus: scheme.domesticContentOrLocationBonus,
    basis: scheme.basis,
    note: scheme.note,
    stackingRule: scheme.stackingOrExclusivity,
    implementationFormula: scheme.implementationFormula,
    annualSupport,
    upfrontSupport,
    total: annualSupport,
    effectiveUnitSupport,
    outputBasis: scheme.outputBasis || null,
    outputMetric,
    eligibleCapexBasis: scheme.eligibleCapexBasis || null,
    eligibleCapex,
    eligibleCapexLabel: getEligibleCapexLabel(scheme.eligibleCapexBasis),
    upfrontSupportByCapexKey: allocateUpfrontSupport(upfrontSupport, capexBreakdown),
    capexBreakdown,
    inputValues: inputs,
    componentValues,
    frameworkOnly: scheme.cashflowType === 'framework_only',
  };
}

export const PolicyModel = {
  getInputDetails: getPolicyInputDetails,
  getScheme: getPolicyScheme,
  getSelectGroups: getPolicySelectGroups,
  evaluate: evaluatePolicy,
  formatInputValue: formatPolicyInputValue,
};
