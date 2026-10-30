/* Architecture switches: applyArchitectureDefaults (state) and buildStartingDesign (model) reset
   the supply side to each architecture's starting design. Checked against the sizing rules of
   ARCHITECTURE_STARTING_DESIGNS (hand-derived at the default site), the uptime target, and what
   must differ between architectures in the state, the result and the footprint. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { ARCHITECTURE_STARTING_DESIGNS, GAS_GENSET_TYPES, GAS_REDUNDANCY_GUIDANCE } from '../../js/data/datacenter/power.js';
import { buildStartingDesign, calculateDatacenterScenario } from '../../js/model/datacenter/index.js';
import {
  applyArchitectureDefaults,
  ARCHITECTURE_DESIGN_KEYS,
  DATACENTER_DEFAULT_STATE,
  normalizeDatacenterState,
} from '../../js/state/datacenter-schema.js';

const baseline = calculateDatacenterScenario({});
const designPeakMW = baseline.load.designPeakMW;
const designs = Object.fromEntries(['grid', 'hybrid', 'islanded'].map(a => [a, buildStartingDesign(DATACENTER_DEFAULT_STATE, a)]));

test('switching back to grid restores exactly the default design', () => {
  assert.deepEqual(applyArchitectureDefaults(DATACENTER_DEFAULT_STATE, 'grid', { designPeakMW }), DATACENTER_DEFAULT_STATE);
  const fromHybrid = applyArchitectureDefaults(designs.hybrid.state, 'grid', { designPeakMW });
  assert.deepEqual(fromHybrid, DATACENTER_DEFAULT_STATE);
  assert.deepEqual(designs.grid.state, DATACENTER_DEFAULT_STATE);
  // An unknown architecture changes nothing.
  assert.deepEqual(applyArchitectureDefaults(DATACENTER_DEFAULT_STATE, 'orbital'), DATACENTER_DEFAULT_STATE);
});

test('the hybrid starting design follows its sizing rule (hand-derived at Abilene)', () => {
  const s = applyArchitectureDefaults(DATACENTER_DEFAULT_STATE, 'hybrid', { designPeakMW });
  const rule = ARCHITECTURE_STARTING_DESIGNS.hybrid;
  assert.equal(s.architecture, 'hybrid');
  assert.equal(s.gridConnection, 'flexible');
  // Solar 2 MWdc per MW IT: 100 MW IT -> 200 MWdc. Battery 4 h of the IT nameplate: 400 MWh / 4 h = 100 MW.
  assert.equal(s.solarSizeMWdc, rule.solarMWdcPerMWIT * DATACENTER_DEFAULT_STATE.itCapacityMW);
  assert.equal(s.solarSizeMWdc, 200);
  assert.equal(s.batteryCapacityMWh, 400);
  assert.equal(s.batteryDurationHours, 4);
  assert.ok(Math.abs(designPeakMW - 130.8) < 0.05, `design peak ${designPeakMW}`);
  // Gas: auto-sized for the uptime target, plus one spare (was a manual design-peak-less-battery
  // count before the sizing followed the uptime target).
  assert.equal(s.firmFamily, 'gas');
  assert.equal(s.firmSizingMode, 'auto');
  assert.equal(s.firmSpareUnits, GAS_REDUNDANCY_GUIDANCE.backup.spareUnits);
  const r = designs.hybrid.result;
  const base = r.firm.sizingBasis.minUnits;
  assert.equal(r.firm.units, base > 0 ? base + 1 : 0);
  // The battery's full power covers at least as much as the old rule credited it with, so the
  // uptime-sized base count never exceeds ceil((design peak - battery MW) / unit size).
  const batteryMW = s.batteryCapacityMWh / s.batteryDurationHours;
  assert.ok(base <= Math.ceil((designPeakMW - batteryMW) / s.gasUnitSizeMW));
});

test('the islanded starting design is gas-only with N+2 redundancy', () => {
  const { state, result } = designs.islanded;
  assert.equal(state.solarSizeMWdc, 0);
  assert.equal(state.batteryCapacityMWh, 0);
  assert.equal(state.firmSizingMode, 'auto');
  assert.equal(state.firmSpareUnits, GAS_REDUNDANCY_GUIDANCE.islanded.spareUnits);
  // Gas carries the whole load: N units cover the dispatch-year load except in the hours the
  // uptime target allows; N + 2 spares, and N is at most the design-peak count ceil(130.8 / 10) = 14.
  const base = result.firm.sizingBasis.minUnits;
  assert.equal(result.firm.units, base + 2);
  assert.ok(base * state.gasUnitSizeMW >= result.load.meanFacilityMW);
  assert.ok(base <= Math.ceil(designPeakMW / state.gasUnitSizeMW));
  assert.equal(result.grid.connected, false);
  assert.equal(result.dispatch.annual.gridMWh, 0);
});

test('a switch keeps everything outside the supply design', () => {
  const custom = normalizeDatacenterState({
    siteId: 'phoenix-az', itCapacityMW: 250, coolingTechnology: 'immersion', gasType: 'aero', mountingType: 'fixed',
    gridEnergyPricePerMWh: 55, discountRate: 9, solarSizeMWdc: 777, firmFamily: 'nuclear',
  });
  ['grid', 'hybrid', 'islanded'].forEach(architecture => {
    const next = applyArchitectureDefaults(custom, architecture, { designPeakMW: 300 });
    Object.keys(custom).filter(key => !ARCHITECTURE_DESIGN_KEYS.includes(key)).forEach(key => {
      assert.equal(next[key], custom[key], `${architecture}: ${key} kept`);
    });
    assert.equal(next.firmFamily, 'gas', `${architecture}: gas is the starting firm generation`);
  });
  // Hybrid sizes scale with the IT capacity and keep the gas unit size: 250 MW IT -> 500 MWdc,
  // 1,000 MWh; aero units (50 MW), auto-sized.
  const hybrid = applyArchitectureDefaults(custom, 'hybrid', { designPeakMW: 300 });
  assert.equal(hybrid.solarSizeMWdc, 500);
  assert.equal(hybrid.batteryCapacityMWh, 1000);
  assert.equal(hybrid.gasUnitSizeMW, 50);
  assert.equal(hybrid.firmSizingMode, 'auto');
});

test('every starting design meets the uptime target at the default site without top-up', () => {
  Object.entries(designs).forEach(([architecture, { result, addedUnits }]) => {
    assert.equal(result.state.architecture, architecture);
    assert.ok(result.reliability.meetsTarget, `${architecture}: uptime ${result.reliability.uptimePercent}`);
    assert.equal(addedUnits, 0, architecture);
  });
});

test('switching architecture changes the result and the footprint as the design says', () => {
  const r = Object.fromEntries(Object.entries(designs).map(([key, design]) => [key, calculateDatacenterScenario(design.state)]));
  // Grid connection: firm, flexible, none.
  assert.deepEqual([r.grid.grid.connected, r.hybrid.grid.connected, r.islanded.grid.connected], [true, true, false]);
  assert.equal(r.grid.grid.connection, 'firm');
  assert.equal(r.hybrid.grid.connection, 'flexible');
  assert.ok(r.hybrid.grid.unavailableHours > 0);
  // Solar and battery only in the hybrid design.
  assert.equal(r.grid.dispatch.annual.solarMWh, 0);
  assert.ok(r.hybrid.dispatch.annual.solarMWh > 0);
  assert.equal(r.islanded.dispatch.annual.solarMWh, 0);
  assert.ok(r.hybrid.dispatch.battery.capacityMWh > 0);
  // Gas: standby on a firm grid runs only through the utility outages; islanded it carries the whole load.
  assert.ok(r.grid.dispatch.annual.gasMWh > 0);
  assert.ok(r.grid.dispatch.annual.gasMWh <= r.grid.grid.outageHours * r.grid.load.designPeakMW + 1e-6);
  assert.ok(Math.abs(r.islanded.dispatch.annual.gasMWh - r.islanded.dispatch.annual.servedMWh) < 1e-6 * r.islanded.dispatch.annual.servedMWh);
  // Footprint: the switchyard exists iff grid-connected; solar field and battery iff sized.
  const areas = key => r[key].footprint.areasM2;
  assert.ok(areas('grid').utilitySwitchyard > 0 && areas('hybrid').utilitySwitchyard > 0);
  assert.equal(areas('islanded').utilitySwitchyard, 0);
  assert.equal(areas('grid').solarField, 0);
  assert.ok(areas('hybrid').solarField > 0 && areas('hybrid').battery > 0);
  assert.equal(areas('islanded').battery, 0);
  // Gas plant area is proportional to the installed gas capacity (footprint m2 per MW x MW).
  ['grid', 'hybrid', 'islanded'].forEach(key => {
    const perMW = areas(key).gasPlant / r[key].firm.capacityMW;
    assert.ok(Math.abs(perMW - GAS_GENSET_TYPES.recip.footprintM2PerMW) < 1e-9, `${key} gas m2/MW`);
  });
  // Switchyard: 40 m2 per MW of import cap (power.js GRID_DEFAULTS), 130.8 MW -> 5,232 m2.
  assert.ok(Math.abs(areas('grid').utilitySwitchyard - 40 * r.grid.grid.importCapMW) < 1e-6);
});

test('auto-sized starting designs meet the target without a top-up, also where the battery is not full', () => {
  // At Richland, LA the battery shifts solar and is not always full when a curtailment starts; the
  // old design-peak-less-battery rule needed gas units added there. Auto sizing already accounts
  // for it: no top-up, the target is met, and one base unit fewer misses it.
  const design = buildStartingDesign({ ...DATACENTER_DEFAULT_STATE, siteId: 'richland-la' }, 'hybrid');
  assert.equal(design.addedUnits, 0);
  assert.ok(design.result.reliability.meetsTarget);
  const base = design.result.firm.sizingBasis.minUnits;
  assert.ok(base > 0);
  const oneFewer = calculateDatacenterScenario({ ...design.state, firmSizingMode: 'manual', firmUnits: base - 1 });
  assert.equal(oneFewer.reliability.meetsTarget, false);
});
