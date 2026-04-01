const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');

function getCalculationFilesFromIndex() {
  const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const matches = Array.from(indexHtml.matchAll(/<script[^>]+src="([^"]+)"[^>]*><\/script>/g));
  return matches
    .map(match => match[1].split('?')[0])
    .filter(src =>
      src === 'js/solar-geometry.js' ||
      src === 'js/constants.js' ||
      src.startsWith('js/calculations/')
    );
}

const CALCULATION_FILES = getCalculationFilesFromIndex();

function loadRuntime() {
  const context = {
    console,
    Math,
    Number,
    String,
    Boolean,
    Array,
    Object,
    JSON,
    Date,
    RegExp,
    Set,
    Map,
    parseFloat,
    parseInt,
    isFinite,
    Infinity,
    NaN,
  };

  vm.createContext(context);

  for (const relativePath of CALCULATION_FILES) {
    const absolutePath = path.join(ROOT, relativePath);
    const source = fs.readFileSync(absolutePath, 'utf8');
    vm.runInContext(source, context, { filename: relativePath });
  }

  return {
    Calc: vm.runInContext('Calc', context),
    DEFAULT_STATE: vm.runInContext('DEFAULT_STATE', context),
  };
}

const runtime = loadRuntime();

function createState(overrides = {}) {
  return {
    ...runtime.DEFAULT_STATE,
    ...overrides,
  };
}

function runScenario(overrides = {}) {
  return runtime.Calc.calculateAll(createState(overrides));
}

function summarizeResult(result, extra = {}) {
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

function runBatterySweep(capacities, baseOverrides = {}) {
  return capacities.map(batteryCapacityMWh => {
    const result = runScenario({
      ...baseOverrides,
      batteryCapacityMWh,
    });

    return summarizeResult(result, { batteryCapacityMWh });
  });
}

function formatMoney(value) {
  if (!Number.isFinite(value)) return 'N/A';
  const absolute = Math.abs(value);
  const sign = value < 0 ? '-' : '';

  if (absolute >= 1e9) return `${sign}$${(absolute / 1e9).toFixed(2)}B`;
  if (absolute >= 1e6) return `${sign}$${(absolute / 1e6).toFixed(2)}M`;
  if (absolute >= 1e3) return `${sign}$${(absolute / 1e3).toFixed(1)}K`;
  return `${sign}$${absolute.toFixed(0)}`;
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return 'N/A';
  return `${value.toFixed(2)}%`;
}

module.exports = {
  ROOT,
  CALCULATION_FILES,
  Calc: runtime.Calc,
  createState,
  runScenario,
  summarizeResult,
  runBatterySweep,
  formatMoney,
  formatPercent,
};
