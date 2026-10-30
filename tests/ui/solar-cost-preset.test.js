import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_SOLAR_COST_PRESET,
  MOUNTING_TYPES,
  SOLAR_COST_PRESETS,
  getSolarCostPresetValues,
} from '../../js/data/reference-data.js';
import { Calc } from '../../js/model/index.js';
import { DEFAULT_STATE } from '../../js/state/schema.js';
import { CONTROL_SPECS } from '../../js/ui/control-spec.js';
import { solarCostControlMethods } from '../../js/ui/solar-cost-controls.js';

const presetState = (presetId, mountingType = 'ew') => ({
  ...DEFAULT_STATE,
  mountingType,
  ...getSolarCostPresetValues(presetId, mountingType),
});

// Same undiscounted, no-O&M amortization that reproduces Terraform's own 1.6 c/kWh.
const undiscountedLcoe = state => Calc.calculateAll({ ...state, discountRate: 0, solarOmPercent: 0 }).solar.lcoe;

test('the default state is the target cost basis and shows a positive IRR', () => {
  assert.equal(DEFAULT_SOLAR_COST_PRESET, 'terraform-target');
  const target = getSolarCostPresetValues('terraform-target', DEFAULT_STATE.mountingType);
  assert.equal(DEFAULT_STATE.panelCostPerW, target.panelCostPerW);
  assert.equal(DEFAULT_STATE.bosCostPerW, target.bosCostPerW);

  const economics = Calc.calculateAll(DEFAULT_STATE).economics;
  assert.ok(Number.isFinite(economics.irr) && economics.irr > 0, `IRR ${economics.irr}`);
  assert.ok(economics.npv > 0);
});

test('each cost basis matches the Terraform figure its label claims', () => {
  // Target: below 1 c/kWh ($10/MWh) on Terraform's amortization basis.
  assert.ok(undiscountedLcoe(presetState('terraform-target')) < 10);

  // Measured build: ~$0.72/W all-in at the default 1 MW site and ~1.6 c/kWh.
  const build = presetState('terraform-2026-build');
  const solar = Calc.calculateAll(build).solar;
  const allInPerW = solar.totalSolarCapex / (build.systemSizeMW * 1e6);
  assert.ok(Math.abs(allInPerW - 0.72) < 0.01, `all-in $${allInPerW.toFixed(3)}/W`);
  assert.ok(Math.abs(undiscountedLcoe(build) - 16) < 1.5);
});

test('the select reports the matching basis, or custom after a manual edit', () => {
  const app = Object.create(solarCostControlMethods);
  Object.keys(SOLAR_COST_PRESETS).forEach(presetId => {
    Object.keys(MOUNTING_TYPES).forEach(mountingType => {
      app.state = presetState(presetId, mountingType);
      assert.equal(app.getSelectedSolarCostPreset(), presetId);
    });
  });
  app.state = { ...presetState('terraform-target'), bosCostPerW: 0.13 };
  assert.equal(app.getSelectedSolarCostPreset(), 'custom');
});

test('changing mounting keeps the chosen basis by shifting BOS by the mounting premium', () => {
  const mountingSpec = CONTROL_SPECS.find(spec => spec.id === 'mountingType');
  const app = Object.create(solarCostControlMethods);
  app.syncStateToControls = () => {};

  app.state = presetState('terraform-2026-build', 'ew');
  ['single', 'fixed', 'dual', 'ew'].reduce((previous, mountingType) => {
    app.state.mountingType = mountingType;
    mountingSpec.onChange(app, mountingType, previous);
    assert.equal(app.state.bosCostPerW, getSolarCostPresetValues('terraform-2026-build', mountingType).bosCostPerW);
    assert.equal(app.getSelectedSolarCostPreset(), 'terraform-2026-build');
    return mountingType;
  }, 'ew');
});
