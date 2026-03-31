#!/usr/bin/env node

const {
  formatMoney,
  formatPercent,
  runBatterySweep,
} = require('./harness');

const DEFAULT_CAPACITIES = [0, 0.5, 1, 2, 5];

const rawArgs = process.argv.slice(2);
const outputJson = rawArgs.includes('--json');
const capacities = rawArgs
  .filter(arg => arg !== '--json')
  .map(value => Number(value))
  .filter(value => Number.isFinite(value));

const sweep = runBatterySweep(capacities.length ? capacities : DEFAULT_CAPACITIES);

if (outputJson) {
  console.log(JSON.stringify(sweep, null, 2));
  process.exit(0);
}

console.table(sweep.map(entry => ({
  'Battery (MWh)': entry.batteryCapacityMWh.toFixed(1),
  'Total CAPEX': formatMoney(entry.totalCapex),
  'Battery CAPEX': formatMoney(entry.batteryCapex),
  'Process CAPEX': formatMoney(entry.processCapex),
  'Process kW': entry.processPowerKW.toFixed(1),
  'Effective CF': formatPercent(entry.effectiveCF * 100),
  NPV: formatMoney(entry.npv),
  IRR: formatPercent(entry.irr),
})));

if (sweep.length >= 2) {
  const baseline = sweep[0];
  const comparison = sweep[1];

  console.log(
    `Total CAPEX: ${baseline.batteryCapacityMWh} -> ${comparison.batteryCapacityMWh} MWh = ` +
    `${formatMoney(baseline.totalCapex)} -> ${formatMoney(comparison.totalCapex)}`
  );
  console.log(
    `Process CAPEX: ${formatMoney(baseline.processCapex)} -> ${formatMoney(comparison.processCapex)}`
  );
}
