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

export function summarizeResult(result, extra = {}) {
  const capex = result.economics.capex;
  const processCapex = (
    (capex.electrolyzer || 0) +
    (capex.dac || 0) +
    (capex.sabatier || 0) +
    (capex.methanol || 0)
  );

  return {
    ...extra,
    totalCapex: result.economics.totalCapex,
    solarCapex: capex.solar || 0,
    batteryCapex: capex.battery || 0,
    processCapex,
    electrolyzerCapex: capex.electrolyzer || 0,
    dacCapex: capex.dac || 0,
    sabatierCapex: capex.sabatier || 0,
    methanolCapex: capex.methanol || 0,
    annualRevenue: result.economics.totalAnnualRevenue,
    annualCost: result.economics.annualCost,
    npv: result.economics.npv,
    irr: result.economics.irr,
    paybackYears: result.economics.paybackYears,
    processPowerKW: result.chemicalSupply.processPowerKW || 0,
    effectiveCF: result.chemicalSupply.effectiveCF || 0,
    batteryDailyAvailableKWh: result.chemicalSupply.dailyAvailableKWh || 0,
  };
}

export function runBatterySweep(capacities, baseOverrides = {}) {
  return capacities.map(batteryCapacityMWh => {
    const result = runScenario({
      ...baseOverrides,
      batteryCapacityMWh,
    });

    return summarizeResult(result, { batteryCapacityMWh });
  });
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

export function formatPercent(value) {
  if (!Number.isFinite(value)) return 'N/A';
  return `${value.toFixed(2)}%`;
}
