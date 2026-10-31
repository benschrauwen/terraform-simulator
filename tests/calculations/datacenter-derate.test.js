/* Hot-weather derating of gas units (power.js ambientDerate, supply.js gasAmbientFactors). */
import assert from 'node:assert/strict';
import test from 'node:test';

import { GAS_GENSET_TYPES } from '../../js/data/datacenter/power.js';
import { applyDatacenterPresetDefaults, calculateDatacenterScenario, DATACENTER_DEFAULT_STATE } from '../../js/model/datacenter/index.js';
import { gasAmbientFactors, gasFuelMMBtu } from '../../js/model/datacenter/supply.js';

const islanded = (gasType, siteId) => applyDatacenterPresetDefaults({ ...DATACENTER_DEFAULT_STATE, architecture: 'islanded', gasType, siteId, firmSpareUnits: 2 }, 'gasType');

test('output and heat-rate factors follow the sourced %/°C above each type\'s reference', () => {
  const temps = Float64Array.from({ length: 8760 }, (_, h) => (h === 100 ? 40 : 10));
  // Aeroderivative: 0.86%/°C above 15 °C -> 78.5% at 40 °C; heat rate +0.2%/°C -> +5%.
  const aero = gasAmbientFactors(GAS_GENSET_TYPES.aero, temps);
  assert.ok(Math.abs(aero.output[100] - (1 - 0.0086 * 25)) < 1e-12);
  assert.ok(Math.abs(aero.heatRate[100] - 1.05) < 1e-12);
  assert.equal(aero.output[0], 1);
  assert.equal(aero.minOutput, aero.output[100]);
  // Engines: 0.18%/°C above 25 °C -> 97.3% at 40 °C.
  assert.ok(Math.abs(gasAmbientFactors(GAS_GENSET_TYPES.recip, temps).output[100] - (1 - 0.0018 * 15)) < 1e-12);
  // Fuel cells and standby diesel (rated to 45 °C): no derate at 40 °C.
  assert.equal(gasAmbientFactors(GAS_GENSET_TYPES.sofc, temps), null);
  assert.equal(gasAmbientFactors(GAS_GENSET_TYPES['standby-diesel'], temps), null);
});

test('a hot site needs more turbine units; fuel cells are unaffected', () => {
  // Phoenix islanded aeroderivatives: the hot afternoons need more 50 MW units than the
  // required MW at full rating would suggest.
  const aero = calculateDatacenterScenario(islanded('aero', 'phoenix-az'), { fastMode: true });
  const basis = aero.firm.sizingBasis;
  assert.ok(aero.firm.ambientMinOutputFraction < 0.85, `${aero.firm.ambientMinOutputFraction}`);
  assert.ok(basis.minUnits > Math.ceil(basis.requiredMW / 50), `${basis.minUnits} units for ${basis.requiredMW} MW`);
  assert.ok(aero.reliability.meetsTarget);
  // One unit fewer (manual, no spares) misses the target: the derate is what binds.
  const fewer = calculateDatacenterScenario({ ...aero.state, firmSizingMode: 'manual', firmUnits: basis.minUnits - 1 }, { fastMode: true });
  assert.equal(fewer.reliability.meetsTarget, false);
  // Fuel cells: no derate, full rating every hour.
  const sofc = calculateDatacenterScenario(islanded('sofc', 'phoenix-az'), { fastMode: true });
  assert.equal(sofc.firm.ambientMinOutputFraction, 1);
});

test('hot hours burn more fuel per MWh in turbines', () => {
  const r = calculateDatacenterScenario(islanded('aero', 'phoenix-az'));
  const firm = { unitSizeMW: 50, heatRate: 9.45, partLoad: GAS_GENSET_TYPES.aero.partLoad, ambient: gasAmbientFactors(GAS_GENSET_TYPES.aero, r.dispatch.hourly.dryBulbC) };
  let hottest = 0;
  r.dispatch.hourly.dryBulbC.forEach((t, h) => { if (t > r.dispatch.hourly.dryBulbC[hottest]) hottest = h; });
  const cool = gasFuelMMBtu(40000, firm, -1);
  const hot = gasFuelMMBtu(40000, firm, hottest);
  assert.ok(hot > cool * 1.02, `${hot} vs ${cool}`);
});
