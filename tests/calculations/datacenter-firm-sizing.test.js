/* Gas sized for the uptime target (model/datacenter/firm-sizing.js). Independent truths:
   - the definition: the auto fleet meets the target and one base unit fewer (manual count, so the
     spares are out of the picture) does not, checked against full dispatch runs;
   - the arithmetic of allowed unserved hours from the uptime definition (hours fully served / 8760);
   - monotonicity: more battery or a lower target never needs more units; more outage hours never
     needs fewer;
   - with a battery that rides through every outage, no unit is needed (and no spares come with it);
   - the optimizer's minimum-units bisection lands on the same count. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { allowedUnservedHours } from '../../js/model/datacenter/firm-sizing.js';
import {
  applyDatacenterPresetDefaults,
  buildStartingDesign,
  calculateDatacenterScenario,
  DATACENTER_DEFAULT_STATE,
} from '../../js/model/datacenter/index.js';
import { findMinimumUnits, optimizeDatacenterDesign } from '../../js/model/datacenter/optimizer.js';

const BASE = { ...DATACENTER_DEFAULT_STATE };
// Reciprocating gas engines ($4/MMBtu: cheaper than the default grid price).
const RECIP = applyDatacenterPresetDefaults({ ...BASE, architecture: 'hybrid', gasType: 'recip' }, 'gasType');
const run = state => calculateDatacenterScenario(state, { fastMode: true });
const manual = (state, units) => run({ ...state, firmFamily: units > 0 ? 'gas' : 'none', firmSizingMode: 'manual', firmUnits: units });

test('allowed unserved hours follow from uptime = fully served hours / 8760', () => {
  // 99.982% x 8760 = 8758.42 h must be served -> 8759 h -> 1 h may go unserved.
  assert.equal(allowedUnservedHours(99.982), 1);
  // 99.9%: 8751.24 -> 8752 served, 8 unserved. 99%: 8672.4 -> 8673 served, 87 unserved.
  assert.equal(allowedUnservedHours(99.9), 8);
  assert.equal(allowedUnservedHours(99), 87);
  // 99.995%: 8759.56 -> every hour.
  assert.equal(allowedUnservedHours(99.995), 0);
  // Exactly representable boundary: 8759 / 8760 = 99.98858...% allows 1 h.
  assert.equal(allowedUnservedHours((8759 / 8760) * 100), 1);
});

/* The auto fleet meets the target; with one base unit fewer the target is missed. */
function assertMinimal(state, label) {
  const auto = run({ ...state, firmFamily: 'gas', firmSizingMode: 'auto' });
  const basis = auto.firm.sizingBasis;
  assert.ok(basis, `${label}: sizing basis reported`);
  assert.ok(auto.reliability.meetsTarget, `${label}: auto fleet ${auto.firm.units} units meets the target (${auto.reliability.uptimePercent})`);
  const base = basis.minUnits;
  assert.equal(auto.firm.units, base > 0 ? base + state.firmSpareUnits : 0, `${label}: spares only on top of a plant`);
  assert.ok(manual(state, base).reliability.meetsTarget, `${label}: ${base} base units meet the target`);
  if (base > 0) {
    const fewer = manual(state, base - 1);
    assert.equal(fewer.reliability.meetsTarget, false, `${label}: ${base - 1} units miss the target`);
  }
  return auto;
}

test('auto sizing is the fewest units meeting the target (starting designs, several sites)', () => {
  for (const siteId of ['abilene-tx', 'richland-la', 'phoenix-az']) {
    for (const architecture of ['grid', 'hybrid', 'islanded']) {
      const { state } = buildStartingDesign({ ...BASE, siteId }, architecture);
      assertMinimal(state, `${siteId} ${architecture}`);
    }
  }
});

test('auto sizing is exact on the non-separable designs too (reserve battery after or charged by gas)', () => {
  // Islanded gas + reserve battery (topped up from spare gas): bisection on full runs.
  const islanded = assertMinimal({ ...BASE, architecture: 'islanded', batteryCapacityMWh: 200 }, 'islanded reserve battery');
  assert.equal(islanded.firm.sizingBasis.method, 'bisection');
  // Hybrid, gas cheaper than the grid (firm-first), reserve battery.
  const hybrid = assertMinimal({ ...RECIP, architecture: 'hybrid', gridConnection: 'flexible', batteryCapacityMWh: 100 }, 'hybrid firm-first reserve');
  assert.equal(hybrid.dispatch.order, 'firm-first');
  assert.equal(hybrid.firm.sizingBasis.method, 'bisection');
  // A grid-first reserve battery is exact from one zero-gas run.
  const grid = assertMinimal({ ...BASE, batteryCapacityMWh: 150 }, 'grid reserve battery');
  assert.equal(grid.firm.sizingBasis.method, 'residual');
  // Flexible connection, more curtailment, different target.
  assertMinimal({ ...BASE, architecture: 'hybrid', gridConnection: 'flexible', gridUnavailableHoursPerYear: 200, uptimeTargetPercent: 99.9 }, 'flexible 200 h');
});

test('auto units fall with more battery and a lower target, and rise with more outage hours', () => {
  const units = overrides => run({ ...BASE, ...overrides }).firm.sizingBasis.minUnits;
  let previous = Infinity;
  for (let battery = 0; battery <= 600; battery += 50) {
    const n = units({ batteryCapacityMWh: battery });
    assert.ok(n <= previous, `battery ${battery} MWh: ${n} > ${previous}`);
    previous = n;
  }
  previous = Infinity;
  for (const target of [99.9999, 99.995, 99.982, 99.95, 99.9, 99.5, 99]) {
    const n = units({ uptimeTargetPercent: target });
    assert.ok(n <= previous, `target ${target}: ${n} > ${previous}`);
    previous = n;
  }
  previous = -Infinity;
  for (let hours = 0; hours <= 24; hours += 1) {
    const n = units({ firmGridOutageHoursPerYear: hours, architecture: 'hybrid', gridConnection: 'flexible', gridUnavailableHoursPerYear: 0 });
    assert.ok(n >= previous, `outage ${hours} h: ${n} < ${previous}`);
    previous = n;
  }
  // The same holds on a flexible connection's curtailment hours.
  previous = -Infinity;
  for (const hours of [0, 20, 50, 100, 200, 400]) {
    const n = units({ architecture: 'hybrid', gridConnection: 'flexible', gridUnavailableHoursPerYear: hours });
    assert.ok(n >= previous, `curtailment ${hours} h: ${n} < ${previous}`);
    previous = n;
  }
});

test('a battery that rides through every outage needs no firm units and gets no spares', () => {
  // Default grid site: 3 h of utility outage at ~93 MW of load; a 400 MWh / 100 MW (4 h) battery
  // carries it, so no gas is needed at all.
  const r = run({ ...BASE, batteryCapacityMWh: 400 });
  assert.equal(r.firm.sizingBasis.minUnits, 0);
  assert.equal(r.firm.units, 0);
  assert.equal(r.firm.capacityMW, 0);
  assert.equal(r.firm.requiredMW, 0);
  assert.ok(r.reliability.meetsTarget);
  assert.equal(r.dispatch.annual.gasMWh, 0);
  // No gas plant on the schedule or in the footprint.
  assert.ok(!r.schedule.paths.some(path => path.id.startsWith('gas-') || path.id.startsWith('diesel')));
  assert.equal(r.footprint.areasM2.gasPlant, 0);
  // A target loose enough to absorb the 3 outage hours needs none either.
  assert.equal(run({ ...BASE, uptimeTargetPercent: 99.9 }).firm.units, 0);
});

test('required MW is the (H+1)-th largest hourly shortfall and covers the target', () => {
  // Firm grid, no battery: the residual shortfall is the load in each utility-outage hour.
  const r = calculateDatacenterScenario(BASE);
  const basis = r.firm.sizingBasis;
  assert.equal(basis.hoursShortWithoutFirm, r.grid.outageHours);
  const outageLoads = [];
  r.grid.events.filter(event => event.kind === 'outage').forEach(event => {
    for (let k = 0; k < event.hours; k++) outageLoads.push(r.dispatch.hourly.loadMW[event.startHour + k]);
  });
  outageLoads.sort((a, b) => b - a);
  const H = basis.allowedUnservedHours;
  assert.ok(Math.abs(basis.requiredMW - (outageLoads[H] - 1e-9 * outageLoads[H])) < 1e-6);
  assert.ok(Math.abs(basis.maxShortfallMW - outageLoads[0]) < 1e-6);
  assert.ok(basis.minUnits * r.firm.unitSizeMW >= basis.requiredMW);
  assert.equal(basis.hoursCoveredByFirm + basis.unservedHoursWithFirm, basis.hoursShortWithoutFirm);
});

test('the optimizer minimum-units bisection equals the auto count before spares', () => {
  const designs = [
    { ...BASE },
    { ...BASE, batteryCapacityMWh: 100 },
    buildStartingDesign(BASE, 'hybrid').state,
    buildStartingDesign(BASE, 'islanded').state,
    { ...BASE, architecture: 'islanded', batteryCapacityMWh: 200 },
  ];
  designs.forEach((state, index) => {
    const auto = run({ ...state, firmFamily: 'gas', firmSizingMode: 'auto' }).firm.sizingBasis.minUnits;
    // The optimizer's own feasibility test (manual count, 0 = no plant) and bisection.
    const bisected = findMinimumUnits(units => manual(state, units).reliability.meetsTarget, 60);
    assert.equal(bisected, auto, `design ${index}`);
    // And the optimizer's frontier cell for the design's own solar and battery.
    const result = optimizeDatacenterDesign(state, { sizeSolar: false, sizeBattery: false, budget: 60 });
    assert.equal(result.frontier.cells[0][0].minUnits, auto, `design ${index}: optimizer`);
  });
});
