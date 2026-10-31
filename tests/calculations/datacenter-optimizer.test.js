import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyDatacenterPresetDefaults,
  calculateDatacenterScenario,
  DATACENTER_DEFAULT_STATE,
  normalizeDatacenterState,
} from '../../js/model/datacenter/index.js';
import {
  compareArchitectures,
  findMinimumUnits,
  getArchitectureStartState,
  isBetterCandidate,
  optimizeDatacenterDesign,
  THOROUGH_SEARCH,
} from '../../js/model/datacenter/optimizer.js';

// The default grid design (standby diesel, the only generators a grid design may have), and
// reciprocating gas engines for the hybrid and islanded cases (they need gas cheaper than the grid).
const BASE = { ...DATACENTER_DEFAULT_STATE };
const RECIP = applyDatacenterPresetDefaults({ ...DATACENTER_DEFAULT_STATE, architecture: 'hybrid', gasType: 'recip' }, 'gasType');
const ISLANDED = { ...RECIP, architecture: 'islanded', firmSpareUnits: 2 };
// The hybrid starting design with standby diesel instead of its engines (the two-basin landscape).
const HYBRID_DIESEL = applyDatacenterPresetDefaults({ ...getArchitectureStartState(DATACENTER_DEFAULT_STATE, 'hybrid'), gasType: 'standby-diesel' }, 'gasType');

/** The state the optimizer evaluates for a gas design: auto sizing (the units the target needs +
    the spare policy, which a battery may cover) plus `extra` units run on cost. */
function designState(state, { solar, battery, extra }) {
  return { ...state, solarSizeMWdc: solar, batteryCapacityMWh: battery, firmFamily: 'gas', firmSizingMode: 'auto', firmExtraUnits: extra };
}

/** Exhaustive search over a grid: the best feasible design (or null). */
function bruteForce(state, solars, batteries, extraMax) {
  let best = null;
  for (const solar of solars) {
    for (const battery of batteries) {
      for (let extra = 0; extra <= extraMax; extra++) {
        const r = calculateDatacenterScenario(designState(state, { solar, battery, extra }), { fastMode: true });
        if (!r.reliability.meetsTarget) continue;
        if (!best || r.economics.npv > best.npv) best = { solar, battery, extra, units: r.firm.units, npv: r.economics.npv };
      }
    }
  }
  return best;
}

const range = (max, step) => Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step);

test('fast mode gives the same NPV, uptime and first power as the full run (the optimizer relies on it)', () => {
  [
    BASE,
    designState(ISLANDED, { solar: 120, battery: 300, units: 9 }),
    designState({ ...BASE, architecture: 'hybrid', gridConnection: 'flexible' }, { solar: 200, battery: 100, units: 4 }),
  ].forEach(state => {
    const full = calculateDatacenterScenario(state);
    const fast = calculateDatacenterScenario(state, { fastMode: true });
    assert.equal(fast.economics.npv, full.economics.npv);
    assert.equal(fast.economics.irr, full.economics.irr);
    assert.equal(fast.reliability.uptimePercent, full.reliability.uptimePercent);
    assert.deepEqual(fast.schedule.energizationDate, full.schedule.energizationDate);
    assert.equal(fast.economics.totalCapex, full.economics.totalCapex);
  });
});

test('minimum-units bisection equals a linear scan, with or without a hint', () => {
  // Real feasibility: islanded gas plants at a few (solar, battery) points.
  const points = [
    { solar: 0, battery: 0 },
    { solar: 40, battery: 0 },
    { solar: 130, battery: 400 },
    { solar: 260, battery: 1500 },
  ];
  points.forEach(point => {
    const feasible = units => calculateDatacenterScenario(designState(ISLANDED, { ...point, units }), { fastMode: true }).reliability.meetsTarget;
    const flags = Array.from({ length: 17 }, (_, units) => feasible(units));
    // Uptime never falls when a unit is added (the monotonicity the bisection relies on).
    flags.forEach((flag, units) => { if (units > 0 && flags[units - 1]) assert.ok(flag, `feasible at ${units - 1} but not ${units} units`); });
    const linear = flags.indexOf(true);
    const expected = linear === -1 ? null : linear;
    const cached = units => flags[units];
    assert.equal(findMinimumUnits(cached, 16), expected);
    [0, 3, 9, 12, 16].forEach(hint => assert.equal(findMinimumUnits(cached, 16, hint), expected, `hint ${hint}`));
  });
  // Synthetic edge cases: always feasible, never feasible, only the maximum.
  assert.equal(findMinimumUnits(() => true, 10, 5), 0);
  assert.equal(findMinimumUnits(() => false, 10, 5), null);
  assert.equal(findMinimumUnits(units => units >= 10, 10), 10);
  assert.equal(findMinimumUnits(units => units >= 10, 10, 2), 10);
});

test('islanded gas: the optimizer matches an exhaustive grid search, spares kept', () => {
  const bounds = { solarMaxMWdc: 64, batteryMaxMWh: 256, unitsMax: 3 };
  const brute = bruteForce(ISLANDED, range(64, 8), range(256, 32), 3);
  assert.ok(brute, 'the grid holds a feasible design');
  const result = optimizeDatacenterDesign(ISLANDED, { bounds });
  assert.equal(result.feasible, true);
  // The optimum keeps the islanded N+2 policy (less any spares a battery covers), like auto sizing.
  const applied = calculateDatacenterScenario({ ...ISLANDED, ...result.best.patch }, { fastMode: true });
  assert.equal(applied.state.firmSizingMode, 'auto');
  assert.equal(result.best.spareUnits + result.best.sparesReplacedByBattery, 2);
  assert.equal(result.best.units, applied.firm.sizingBasis.minUnits + result.best.spareUnits + result.best.extraUnits);
  assert.ok(result.best.uptimePercent >= ISLANDED.uptimeTargetPercent - 1e-9);
  // The optimizer is not limited to the brute-force grid, so it may only do better.
  assert.ok(result.best.npv >= brute.npv - 1e-6 * Math.abs(brute.npv),
    `optimizer ${result.best.npv} vs exhaustive ${brute.npv} at ${JSON.stringify(brute)}`);
  assert.ok(result.candidatesEvaluated <= result.budget);
});

test('hybrid (gas cheaper than grid power): extra units beyond the target and spares are found when they pay', () => {
  // Cheap gas makes on-site generation earn its keep: the best count is above what the uptime
  // target needs plus the spare (none needed: a firm grid without utility outages here).
  const hybrid = { ...RECIP, gasFuelPricePerMMBtu: 1, gridEnergyPricePerMWh: 150, firmGridOutageHoursPerYear: 0 };
  const bounds = { solarMaxMWdc: 0, batteryMaxMWh: 0, unitsMax: 17 };
  const brute = bruteForce(hybrid, [0], [0], 17);
  const result = optimizeDatacenterDesign(hybrid, { bounds, sizeSolar: false, sizeBattery: false });
  assert.ok(brute.extra > 0);
  assert.equal(result.best.extraUnits, brute.extra);
  assert.equal(result.best.units, brute.units);
  assert.ok(Math.abs(result.best.npv - brute.npv) <= 1e-6 * Math.abs(brute.npv));
});

test('the optimum is feasible and at least as good as the current (feasible) design', () => {
  [BASE, ISLANDED, { ...RECIP, gridConnection: 'flexible' }].forEach(state => {
    const result = optimizeDatacenterDesign(state, { sizeGridConnection: true });
    assert.equal(result.baseline.feasible, true);
    assert.equal(result.feasible, true);
    assert.ok(result.best.npv >= result.baseline.npv, `${state.architecture}: ${result.best.npv} < ${result.baseline.npv}`);
    assert.ok(result.candidatesEvaluated <= result.budget);
    // The patch reproduces the reported design.
    const applied = calculateDatacenterScenario({ ...state, ...result.best.patch });
    assert.equal(applied.economics.npv, result.best.npv);
    assert.ok(applied.reliability.meetsTarget);
  });
});

test('infeasible bounds: says so and returns the highest uptime found', () => {
  // Solar + battery only, islanded, within 4x peak and 24 h of storage: one TMY year has a
  // multi-day overcast spell, so the 99.982% target is out of reach.
  const solarOnly = { ...ISLANDED, firmFamily: 'none' };
  const result = optimizeDatacenterDesign(solarOnly, { sizeFirm: false, budget: 120 });
  assert.equal(result.feasible, false);
  assert.ok(result.best.uptimePercent < solarOnly.uptimeTargetPercent);
  // Uptime never falls with more solar or storage, so the largest design in the bounds is
  // the uptime ceiling; the optimizer must reach it rather than stop at a lower point.
  const { solarMaxMWdc, batteryMaxMWh } = result.bounds;
  const largest = calculateDatacenterScenario({ ...solarOnly, solarSizeMWdc: solarMaxMWdc, batteryCapacityMWh: batteryMaxMWh }, { fastMode: true });
  assert.ok(result.best.uptimePercent >= largest.reliability.uptimePercent - 1e-9, 'it walks to the highest uptime in the bounds');
  assert.match(result.notes.join(' '), /No design within the bounds meets/);
  assert.ok(result.candidatesEvaluated <= 120);
});

test('candidate ranking: feasible first, then NPV; infeasible by uptime', () => {
  const a = { feasible: true, npv: 1, uptimePercent: 99.99 };
  const b = { feasible: false, npv: 100, uptimePercent: 99.5 };
  const c = { feasible: false, npv: -5, uptimePercent: 99.9 };
  assert.ok(isBetterCandidate(a, b));
  assert.ok(isBetterCandidate(c, b));
  assert.ok(!isBetterCandidate(b, c));
  assert.ok(isBetterCandidate({ ...a, npv: 2 }, a));
});

test('architecture comparison: one row per architecture, patches against the current state', () => {
  const result = compareArchitectures(BASE, { budget: 300 });
  assert.deepEqual(result.rows.map(row => row.architecture), ['grid', 'hybrid', 'islanded']);
  result.rows.forEach(({ architecture, result: row }) => {
    const start = getArchitectureStartState(BASE, architecture);
    assert.equal(start.architecture, architecture);
    const applied = normalizeDatacenterState({ ...BASE, ...row.best.patch });
    assert.equal(applied.architecture, architecture);
    assert.equal(calculateDatacenterScenario(applied, { fastMode: true }).economics.npv, row.best.npv);
    assert.ok(row.candidatesEvaluated <= 300);
  });
  assert.ok(result.rows.some(row => row.architecture === result.bestArchitecture));
  assert.equal(result.candidatesEvaluated, result.rows.reduce((sum, row) => sum + row.result.candidatesEvaluated, 0));
});

test('two basins: the optimizer finds the battery design across a valley of mid-size batteries', () => {
  // Hybrid starting design with standby diesel (flexible connection) and a cheap battery ($150/kWh,
  // no power cost). Two basins: no battery and ~31 diesel units (NPV ~$655M), or a battery of ~360
  // MWh that carries the 4-hour evening curtailments, precharged from the grid, with no diesel
  // (~$688M); mid-size batteries in between (40-160 MWh) are worse than either. Reduced brute
  // force: solar 0-300 MWdc step 25, battery 0-400 MWh step 20, the auto design (target + spare)
  // with up to two extra units. With the same bounds the default search must land in the battery
  // basin within 2% of its NPV (its compass steps in solar stop on the unit-count steps: ~1.6%
  // short here), and the wider search within 0.5%. (A single-start search once stopped in the
  // no-battery basin.)
  const start = { ...HYBRID_DIESEL, batteryCostPerKWh: 150, batteryPowerCostPerKW: 0 };
  const best = bruteForce(start, range(300, 25), range(400, 20), 2);
  assert.ok(best.battery > 0, 'the brute-force optimum uses a battery');
  const bounds = { solarMaxMWdc: 300, batteryMaxMWh: 400, unitsMax: 40 };
  const result = optimizeDatacenterDesign(start, { bounds });
  assert.ok(result.best.feasible);
  assert.ok(result.best.npv >= best.npv - 0.02 * Math.abs(best.npv), `optimizer ${result.best.npv} vs brute force ${best.npv} (${JSON.stringify(best)})`);
  assert.ok(result.best.batteryMWh > 0, 'the optimizer lands in the battery basin');
  const wide = optimizeDatacenterDesign(start, { bounds, thorough: true });
  assert.ok(wide.best.npv >= best.npv - 0.005 * Math.abs(best.npv), `wider search ${wide.best.npv} vs brute force ${best.npv}`);
});

test('thorough (wider) search: its configuration, and never worse than the default search', () => {
  // Configuration: dense levels, five starts, battery durations and the type's unit sizes.
  assert.deepEqual([...THOROUGH_SEARCH.durationsHours], [1, 2, 4, 8]);
  assert.equal(THOROUGH_SEARCH.refineStarts, 5);
  const start = { ...HYBRID_DIESEL, batteryCostPerKWh: 150, batteryPowerCostPerKW: 0 };
  const bounds = { solarMaxMWdc: 300, batteryMaxMWh: 200, unitsMax: 40 };
  const quick = optimizeDatacenterDesign(start, { bounds });
  const wide = optimizeDatacenterDesign(start, { bounds, thorough: true });
  assert.equal(wide.bounds.thorough, true);
  assert.deepEqual(wide.bounds.durationsHours, [1, 2, 4, 8]);
  assert.deepEqual(wide.bounds.unitSizesMW, [2.5, 3, 3.25]); // standby diesel: min, default, max
  assert.ok(wide.bounds.solarLevels >= 15 && wide.bounds.batteryLevels >= 15, `${wide.bounds.solarLevels} x ${wide.bounds.batteryLevels}`);
  assert.ok(quick.bounds.solarLevels <= 7 && quick.bounds.batteryLevels <= 9);
  // Each start is refined as in the default search before durations and unit sizes are tried.
  assert.ok(wide.best.feasible);
  assert.ok(wide.best.npv >= quick.best.npv - 1e-6 * Math.abs(quick.best.npv), `${wide.best.npv} < ${quick.best.npv}`);
  // The patch carries the searched duration and unit size, and reproduces the reported NPV.
  assert.ok(Object.hasOwn(wide.best.patch, 'batteryDurationHours') && Object.hasOwn(wide.best.patch, 'gasUnitSizeMW'));
  const applied = calculateDatacenterScenario({ ...start, ...wide.best.patch }, { fastMode: true });
  assert.ok(Math.abs(applied.economics.npv - wide.best.npv) < 1e-6 * Math.abs(wide.best.npv));
});

/* ---------- Architecture constraints ---------- */

test('grid: the optimizer never sizes solar, a flexible connection or prime-power gas', () => {
  // Asked to size everything, a grid design keeps firm service, no solar and standby diesel.
  const result = optimizeDatacenterDesign(BASE, { sizeSolar: true, sizeGridConnection: true, budget: 200 });
  assert.equal(result.sized.solar, false);
  assert.equal(result.sized.gridConnection, false);
  assert.equal(result.bounds.solarMaxMWdc, 0);
  assert.equal(result.best.solarMWdc, 0);
  assert.equal(result.best.gridConnection, 'firm');
  assert.ok(result.best.firmFamily === 'none' || result.best.firmType === 'standby-diesel', result.best.firmType);
  assert.ok(result.feasible);
  assert.equal(result.reducesTo, null);
  // Every candidate it evaluated was a legal grid design (the frontier has one solar level: 0).
  assert.deepEqual(result.frontier.solarLevels, [0]);
});

test('compare: grid stays a backup-only design; the hybrid optimum differs from it at the default site', () => {
  const result = compareArchitectures(DATACENTER_DEFAULT_STATE, { sizeGridConnection: true });
  const row = architecture => result.rows.find(entry => entry.architecture === architecture).result;
  const grid = row('grid').best;
  assert.equal(grid.solarMWdc, 0);
  assert.equal(grid.gridConnection, 'firm');
  assert.equal(grid.firmType, 'standby-diesel');
  assert.equal(normalizeDatacenterState({ ...DATACENTER_DEFAULT_STATE, ...grid.patch }).architecture, 'grid');
  // Hybrid searches as before with its gas engines (dispatched on cost): it builds on-site
  // generation and beats the grid-only design, so it is not presented as the same design.
  const hybrid = row('hybrid');
  assert.equal(hybrid.best.firmType, 'recip');
  assert.ok(hybrid.best.solarMWdc > 0 || hybrid.best.units > 0);
  assert.ok(hybrid.best.npv > grid.npv, `hybrid ${hybrid.best.npv} vs grid ${grid.npv}`);
  assert.equal(hybrid.reducesTo, null);
});

test('a hybrid optimum without on-site generation says it reduces to the grid design', () => {
  // Firm service, no solar to size and standby diesel: nothing on site but backup.
  const start = { ...HYBRID_DIESEL, gridConnection: 'firm', solarSizeMWdc: 0 };
  const result = optimizeDatacenterDesign(start, { sizeSolar: false, budget: 200 });
  assert.equal(result.architecture, 'hybrid');
  assert.equal(result.reducesTo, 'grid');
  assert.match(result.notes.join(' '), /reduces to a grid-connected design/);
  // With its gas engines the hybrid design is on-site generation, not a grid design.
  assert.equal(optimizeDatacenterDesign({ ...RECIP, gridConnection: 'firm', gasFuelPricePerMMBtu: 1 }, { sizeSolar: false, sizeBattery: false, budget: 100 }).reducesTo, null);
});
