/*
 * Gas unit size (power.js sizeCurve, supply.js gasSizeFactors): smaller units of a type burn more
 * fuel per MWh and cost more per kW and in O&M, interpolated in log(size) and 1 at the type's
 * default size, so the optimizer's unit-size search does not just pick the smallest unit.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { GAS_GENSET_TYPES } from '../../js/data/datacenter/power.js';
import { calculateDatacenterScenario, DATACENTER_DEFAULT_STATE, applyArchitectureDefaults, optimizeDatacenterDesign } from '../../js/model/datacenter/index.js';
import { gasSizeFactors } from '../../js/model/datacenter/supply.js';

const close = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

test('size factors are 1 at the default size and favour larger units within each type', () => {
  Object.entries(GAS_GENSET_TYPES).forEach(([key, type]) => {
    const f = gasSizeFactors(type, type.unitSizeMW.default);
    Object.values(f).forEach(value => assert.ok(close(value, 1), `${key} at its default size`));
    if (!type.sizeCurve) return;
    const small = gasSizeFactors(type, type.unitSizeMW.min);
    const large = gasSizeFactors(type, type.unitSizeMW.max);
    assert.ok(small.heatRate >= large.heatRate && small.capex >= large.capex, key);
  });
  // Recip: 2.5 MW = 8.30 / 7.8 heat rate, 5 MW half way in log size between 2.5 and 10.
  const recip = GAS_GENSET_TYPES.recip;
  assert.ok(close(gasSizeFactors(recip, 2.5).heatRate, 8.3 / 7.8));
  assert.ok(close(gasSizeFactors(recip, 5).heatRate, (8.3 / 7.8 + 1) / 2));
  // Held flat beyond the curve.
  assert.ok(close(gasSizeFactors(recip, 1).heatRate, gasSizeFactors(recip, 2.5).heatRate));
});

test('the model charges a unit size its heat rate, $/kW and O&M', () => {
  const hybrid = applyArchitectureDefaults(DATACENTER_DEFAULT_STATE, 'hybrid');
  const big = calculateDatacenterScenario({ ...hybrid, firmSizingMode: 'manual', firmUnits: 40, gasUnitSizeMW: 10 }, { fastMode: true });
  const small = calculateDatacenterScenario({ ...hybrid, firmSizingMode: 'manual', firmUnits: 160, gasUnitSizeMW: 2.5 }, { fastMode: true });
  const f = gasSizeFactors(GAS_GENSET_TYPES.recip, 2.5);
  const capex = r => r.economics.capexItems.find(item => item.key === 'gas').capex;
  assert.ok(close(capex(small), capex(big) * f.capex));
  // Same 400 MW fleet and dispatch: fuel per MWh rises with the heat rate (slightly less, since
  // small units follow the load more closely and run less at part load).
  assert.ok(close(small.dispatch.annual.gasMWh, big.dispatch.annual.gasMWh, 1e-6));
  const ratio = (small.dispatch.annual.fuelMMBtu / small.dispatch.annual.gasMWh) / (big.dispatch.annual.fuelMMBtu / big.dispatch.annual.gasMWh);
  assert.ok(ratio > 1 && ratio <= f.heatRate + 1e-9 && ratio > f.heatRate - 0.01, `${ratio} vs ${f.heatRate}`);
});

test('with size costs, the optimizer no longer picks the smallest engines at the default site', () => {
  const islanded = applyArchitectureDefaults(DATACENTER_DEFAULT_STATE, 'islanded');
  const result = optimizeDatacenterDesign(islanded);
  assert.ok(result.best.unitSizeMW > GAS_GENSET_TYPES.recip.unitSizeMW.min, `${result.best.unitSizeMW} MW`);
});
