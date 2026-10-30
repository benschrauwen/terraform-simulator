/* ============================================
   Datacenter design optimizer
   ============================================
   optimizeDatacenterDesign(state, options): the design with the highest
   NPV whose achieved uptime meets the state's uptime target, over

     solar MWdc       0 .. 4 x design facility peak       (continuous)
     battery MWh      0 .. 24 h x design facility peak    (continuous)
     firm units       0 .. ceil(peak / unit size) + 3     (integer; the
                      selected gas type, or nuclear type; 0 = no firm plant;
                      an existing-plant contract is 0 or 1 block at the
                      average load)
     grid connection  firm and/or flexible (grid / hybrid only, optional)

   Everything else (site, cooling, revenue, prices, the gas or nuclear
   type, battery duration, ...) stays as given. Each candidate is a full
   fast-mode scenario run (one hourly dispatch year, ~1-2 ms).

   Method. For a given (solar, battery) the fewest gas units meeting the
   target is the auto sizing without spares (firm-sizing.js, one zero-gas
   dispatch). For nuclear, or if that count is not feasible as a manual
   count, it is bisected instead (uptime does not fall when a unit is added:
   more available capacity in every hour), bracketed from a neighbouring
   candidate's answer. NPV is then walked one unit at a time from there
   (more units than the minimum pay when on-site gas is cheaper than the
   grid, or when they serve hours above the target). Over (solar, battery):
   a coarse grid (0 plus halvings down from each upper bound; the battery
   axis also 0.25-2 h of the design peak, where a small battery replacing
   firm units forms its own basin), then a compass/pattern search from up to
   three coarse cells (the best and the next best that are not its grid
   neighbours and come within 2% of its capex in NPV), halving the step
   until it is below the resolution. Candidates are ranked feasible first, then by
   NPV; infeasible ones by uptime, so the search walks towards feasibility.
   The budget caps scenario evaluations per architecture (cache hits are
   free). It is a local search on one TMY year: see README "Design
   optimizer".

   compareArchitectures(state, options) runs it for grid, hybrid and
   islanded, each from that architecture's starting design
   (getArchitectureStartState: the schema's applyArchitectureDefaults when
   it exists, otherwise the current state with the architecture switched).

   Pure; no DOM. */

import { GAS_GENSET_TYPES } from '../../data/datacenter/power.js';
import { DATACENTER_DEFAULT_STATE, normalizeDatacenterState } from '../../state/datacenter-schema.js';
import { calculateDatacenterScenario } from './scenario.js';
import { buildStartingDesign } from './starting-design.js';

export const DEFAULT_OPTIMIZER_BUDGET = 800;
export const OPTIMIZER_ARCHITECTURES = Object.freeze(['grid', 'hybrid', 'islanded']);
export const OPTIMIZER_BOUND_FACTORS = Object.freeze({
  solarPeakMultiple: 4, // MWdc per MW of design facility peak
  batteryHoursOfPeak: 24, // MWh per MW of design facility peak
  extraUnits: 3, // firm units above ceil(peak / unit size)
});
const COARSE_LEVELS = 6; // non-zero geometric coarse levels per axis: max, max/2, ..., max/32
// Battery levels at the small end, in hours of the design facility peak: a
// small battery that rides through outages or curtailments can replace
// several firm units, a basin the halvings of the upper bound step over.
// They replace the two smallest halvings (1.5 h and 0.75 h of peak at the
// default bounds): 0, 0.25, 0.5, 1, 2, 3, 6, 12, 24 h of peak.
const BATTERY_PEAK_HOUR_LEVELS = Object.freeze([0.25, 0.5, 1, 2]);
// Coarse cells the pattern search starts from (best first, then the next
// best that are not grid neighbours of a chosen one).
const REFINE_STARTS = 3;
/* Thorough mode (the UI's "Wider search range", ~10-15 s for a full
   comparison in the worker): the doubled bounds come from boundsScale; this
   adds a denser coarse grid (9 halvings + 11 uniform steps of each bound +
   the small levels; 17 x 22 distinct cells at the default site), five
   refinement starts with a wider NPV window, battery durations 1/2/4/8 h and
   the gas type's unit sizes (min, default, max). Each start is first
   refined at the start's own duration and unit size, then every duration x
   unit size is tried there and the search continues with those as discrete
   steps. The default search on the same bounds runs first and its best
   design stays a candidate, so the thorough result is never worse. Budget:
   runs per architecture on top of the default search's; the coarse grid
   gets at most 60% of a connection's share, the starts the rest. */
export const THOROUGH_SEARCH = Object.freeze({
  budget: 5000,
  coarseBudgetShare: 0.6,
  geometricLevels: 9,
  uniformDivisions: 12,
  solarPeakMultiples: Object.freeze([0.25, 0.5, 1]),
  refineStarts: 5,
  startNpvWindow: 0.05,
  durationsHours: Object.freeze([1, 2, 4, 8]),
});

// judgment: refining could move a cell's NPV by a few % of capex (the
// two-basin case at the default site differed by ~0.1%); further from the
// best than this, a start is not worth its runs.
const START_NPV_WINDOW = 0.02;

/**
 * The starting design of an architecture (starting-design.js: the schema's
 * architecture defaults with the model's design peak, topped up with gas
 * units until it meets the uptime target). The single place the optimizer
 * asks for architecture defaults.
 */
export function getArchitectureStartState(state, architecture) {
  return normalizeDatacenterState({ ...buildStartingDesign(state, architecture).state, architecture });
}

/** Keys of `next` that differ from `reference` (both normalized), as a state patch. */
export function diffDatacenterState(reference, next) {
  const patch = {};
  Object.keys(DATACENTER_DEFAULT_STATE).forEach(key => {
    if (next[key] !== reference[key]) patch[key] = next[key];
  });
  return patch;
}

/** Fewest units in [0, max] with feasible(n), assuming feasibility never drops as n grows; null if none. */
export function findMinimumUnits(feasible, max, hint = null) {
  let lo = -1; // largest known infeasible count
  let hi = null; // smallest known feasible count
  if (Number.isInteger(hint) && hint >= 0 && hint <= max) {
    // Bracket from the hint with growing steps (a neighbour's answer is usually within a unit or two).
    if (feasible(hint)) {
      hi = hint;
      for (let step = 1; hi - step >= 0; step *= 2) {
        const probe = hi - step;
        if (!feasible(probe)) { lo = probe; break; }
        hi = probe;
      }
    } else {
      lo = hint;
      for (let step = 1; lo < max; step *= 2) {
        const probe = Math.min(max, lo + step);
        if (feasible(probe)) { hi = probe; break; }
        lo = probe;
      }
    }
  }
  if (hi === null) {
    if (lo >= max || !feasible(max)) return null;
    hi = max;
  }
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (feasible(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** Feasible beats infeasible; then higher NPV; infeasible candidates by uptime (then NPV). */
export function isBetterCandidate(a, b) {
  if (!a) return false;
  if (!b) return true;
  if (a.feasible !== b.feasible) return a.feasible;
  if (!a.feasible && Math.abs(a.uptimePercent - b.uptimePercent) > 1e-9) return a.uptimePercent > b.uptimePercent;
  return a.npv > b.npv + 1e-6 * Math.max(1, Math.abs(b.npv));
}

function summarize(r, design = {}) {
  const e = r.economics;
  return {
    solarMWdc: r.state.solarSizeMWdc,
    batteryMWh: r.state.batteryCapacityMWh,
    batteryDurationHours: r.state.batteryDurationHours,
    units: r.firm.units,
    unitSizeMW: r.firm.unitSizeMW,
    firmFamily: r.firm.family,
    firmType: r.firm.type,
    firmLabel: r.firm.label,
    firmCapacityMW: r.firm.capacityMW,
    architecture: r.state.architecture,
    gridConnection: r.grid.connected ? r.state.gridConnection : null,
    npv: e.npv,
    irr: e.irr,
    mirr: e.mirr,
    totalCapex: e.totalCapex,
    uptimePercent: r.reliability.uptimePercent,
    targetPercent: r.reliability.targetPercent,
    feasible: r.reliability.meetsTarget,
    firstPower: r.schedule.energizationDate,
    firstPowerMonths: r.schedule.energizationMonth,
    criticalPath: r.schedule.criticalPath?.label || '',
    costOfPowerPerMWh: e.levelized?.costOfPowerPerMWh,
    design,
  };
}

const roundTo = (value, resolution) => Math.round(value / resolution) * resolution;
const millions = value => `${value < 0 ? '-' : ''}$${Math.abs(value / 1e6).toFixed(0)}M`;

// Decision fields every patch carries, so applying one design after another
// never leaves the previous design's sizing behind.
const DESIGN_KEYS = ['architecture', 'gridConnection', 'solarSizeMWdc', 'batteryCapacityMWh', 'batteryDurationHours', 'firmFamily', 'firmSizingMode', 'firmUnits', 'gasUnitSizeMW'];
const resolutionFor = max => (max >= 100 ? 1 : max >= 10 ? 0.1 : 0.01);

/** max x i / n for i = 1 .. n - 1. */
function uniformLevels(max, divisions) {
  return Array.from({ length: Math.max(0, divisions - 1) }, (_, i) => (max * (i + 1)) / divisions);
}

/** Coarse levels: 0 plus max, max/2, ... and any `extra` levels up to max (rounded, distinct, ascending). */
function coarseLevels(max, resolution, count = COARSE_LEVELS, extra = []) {
  const levels = new Set([0]);
  for (let k = 0; k < count; k++) {
    const value = roundTo(max / 2 ** k, resolution);
    if (value > 0) levels.add(value);
  }
  extra.forEach(level => {
    const value = roundTo(level, resolution);
    if (value > 0 && value <= max) levels.add(value);
  });
  return [...levels].sort((a, b) => a - b);
}

/**
 * One architecture: optimize from `startState`, report the patch against
 * `referenceState` (the user's current design).
 */
function optimizeFrom(startState, referenceState, options = {}) {
  const t0 = Date.now();
  const {
    sizeSolar = true,
    sizeBattery = true,
    sizeFirm = true,
    sizeGridConnection = false,
    budget: budgetOption = null,
    bounds = {},
    boundsScale = 1,
    thorough = false,
    onProgress = null,
  } = options;
  const start = normalizeDatacenterState(startState);
  const reference = normalizeDatacenterState(referenceState);
  const base = calculateDatacenterScenario(start, { fastMode: true });
  const peakMW = base.load.designPeakMW;
  const islanded = start.architecture === 'islanded';
  const firmFamily = start.firmFamily === 'none' ? 'gas' : start.firmFamily;
  // An existing-plant contract is one block sized to the average load: units 0 or 1 (auto sizing).
  const contract = firmFamily === 'nuclear' && start.nuclearType === 'contracted-existing';
  const unitSizeMW = contract ? base.load.meanFacilityMW : firmFamily === 'nuclear' ? start.nuclearUnitSizeMW : start.gasUnitSizeMW;

  const scale = Math.max(0.1, Number(boundsScale) || 1);
  const solarMax = sizeSolar ? (bounds.solarMaxMWdc ?? OPTIMIZER_BOUND_FACTORS.solarPeakMultiple * peakMW * scale) : start.solarSizeMWdc;
  const batteryMax = sizeBattery ? (bounds.batteryMaxMWh ?? OPTIMIZER_BOUND_FACTORS.batteryHoursOfPeak * peakMW * scale) : start.batteryCapacityMWh;
  const gasRange = firmFamily === 'gas' ? GAS_GENSET_TYPES[start.gasType]?.unitSizeMW : null;
  // Thorough mode also searches battery duration and (gas types with a size
  // range) the unit size: discrete values tried at each refinement start and
  // as +/-1 steps of the pattern search.
  const durations = thorough && sizeBattery
    ? [...new Set([...THOROUGH_SEARCH.durationsHours, start.batteryDurationHours])].sort((x, y) => x - y)
    : [start.batteryDurationHours];
  const unitSizes = thorough && sizeFirm && gasRange && gasRange.max > gasRange.min
    ? [...new Set([gasRange.min, gasRange.default, gasRange.max, start.gasUnitSizeMW])].sort((x, y) => x - y)
    : [unitSizeMW];
  const unitsMaxFor = size => (!sizeFirm ? base.firm.units
    : contract ? 1
      : (bounds.unitsMax ?? Math.ceil((peakMW * scale) / size - 1e-9) + OPTIMIZER_BOUND_FACTORS.extraUnits));
  const unitsMax = unitsMaxFor(unitSizeMW);
  const solarRes = resolutionFor(solarMax);
  const batteryRes = resolutionFor(batteryMax);
  const connections = !islanded && sizeGridConnection ? ['firm', 'flexible'] : [start.gridConnection];
  const budget = budgetOption ?? (thorough ? THOROUGH_SEARCH.budget : DEFAULT_OPTIMIZER_BUDGET);
  const refineStarts = thorough ? THOROUGH_SEARCH.refineStarts : REFINE_STARTS;
  const startWindow = thorough ? THOROUGH_SEARCH.startNpvWindow : START_NPV_WINDOW;

  // Thorough mode first runs the default search on the same bounds and keeps
  // its best design as a candidate, so it can only add to it.
  const quick = thorough
    ? optimizeFrom(startState, referenceState, { ...options, thorough: false, budget: DEFAULT_OPTIMIZER_BUDGET, onProgress: null })
    : null;
  let evaluations = quick ? quick.candidatesEvaluated : 0;
  let monotonicityExceptions = 0;
  const cache = new Map();
  const reserve = Math.ceil(Math.log2(Math.max(...unitSizes.map(unitsMaxFor)) + 2)) + 4; // one candidate's unit search
  const budgetLeft = () => budget - evaluations;
  const report = stage => onProgress?.({ stage, evaluations, budget, percent: Math.min(100, (evaluations / budget) * 100) });

  // A point is { solar, battery, duration, unitSize }; with no battery the
  // duration is irrelevant and kept at the start's (one cache entry).
  const pointOf = (solar, battery, duration = start.batteryDurationHours, unitSize = unitSizeMW) => ({
    solar, battery, duration: battery > 0 ? duration : start.batteryDurationHours, unitSize,
  });
  const pointKey = q => `${q.solar}|${q.battery}|${q.duration}|${q.unitSize}`;
  const stateFor = d => {
    const s = {
      ...start, solarSizeMWdc: d.solar, batteryCapacityMWh: d.battery, gridConnection: d.connection,
      batteryDurationHours: d.duration ?? start.batteryDurationHours,
    };
    if (firmFamily === 'gas' && !contract && d.unitSize) s.gasUnitSizeMW = d.unitSize;
    if (sizeFirm) {
      if (d.units > 0 && contract) Object.assign(s, { firmFamily, firmSizingMode: 'auto' });
      else if (d.units > 0) Object.assign(s, { firmFamily, firmSizingMode: 'manual', firmUnits: d.units });
      else s.firmFamily = 'none'; // no plant on the schedule's required path either
    }
    return s;
  };
  const evaluate = d => {
    const key = `${pointKey(d)}|${d.units}|${d.connection}`;
    if (cache.has(key)) return cache.get(key);
    const r = calculateDatacenterScenario(stateFor(d), { fastMode: true });
    evaluations += 1;
    const summary = summarize(r, { ...d });
    cache.set(key, summary);
    if (evaluations % 10 === 0) report('search');
    return summary;
  };

  /*
   * Fewest gas units meeting the target at a point: the auto sizing with no
   * spares (firm-sizing.js, one zero-gas dispatch; the same count the
   * bisection finds, tested), its run doubling as the candidate at that
   * count. Nuclear, or a count above the bound: null, and the caller bisects.
   */
  const autoMinUnits = (q, connection, max) => {
    if (firmFamily !== 'gas') return null;
    const key = `${pointKey(q)}|auto|${connection}`;
    if (!cache.has(key)) {
      const d = { ...q, units: 1, connection };
      const r = calculateDatacenterScenario({ ...stateFor(d), firmSizingMode: 'auto', firmSpareUnits: 0 }, { fastMode: true });
      evaluations += 1;
      const basis = r.firm.sizingBasis;
      const units = basis?.reachable ? basis.minUnits : null;
      cache.set(key, units);
      // The auto run is the manual design at that count (same dispatch and costs; 0 units = no plant).
      if (units !== null && units <= max) cache.set(`${pointKey(q)}|${units}|${connection}`, summarize(r, { ...q, units, connection }));
    }
    const units = cache.get(key);
    return units !== null && units <= max ? units : null;
  };

  /** Best candidate at a point and connection: minimum feasible units, then an NPV walk. */
  const bestForPoint = (q, connection, hint = {}) => {
    const max = unitsMaxFor(q.unitSize);
    const at = units => evaluate({ ...q, units, connection });
    if (!sizeFirm) return { best: at(max), minUnits: null };
    let minUnits = autoMinUnits(q, connection, max);
    if (minUnits === null || !at(minUnits).feasible) {
      minUnits = findMinimumUnits(units => at(units).feasible, max, hint.minUnits ?? null);
    }
    if (minUnits === null) return { best: at(max), minUnits: null }; // infeasible: highest uptime
    let n = Math.max(minUnits, Math.min(max, hint.units ?? minUnits));
    let best = at(n);
    // Walk while NPV improves (never below the minimum; a count above it that is
    // infeasible would break monotonicity: counted and skipped).
    for (const direction of [1, -1]) {
      for (let next = n + direction; next >= minUnits && next <= max && budgetLeft() > 0; next += direction) {
        const candidate = at(next);
        if (!candidate.feasible) { monotonicityExceptions += 1; continue; }
        if (!isBetterCandidate(candidate, best)) break;
        best = candidate;
        n = next;
      }
    }
    return { best, minUnits };
  };

  const solarExtra = thorough ? THOROUGH_SEARCH.solarPeakMultiples.map(multiple => multiple * peakMW) : [];
  const batteryExtra = BATTERY_PEAK_HOUR_LEVELS.map(hours => hours * peakMW);
  const solarLevels = !sizeSolar ? [start.solarSizeMWdc]
    : thorough ? coarseLevels(solarMax, solarRes, THOROUGH_SEARCH.geometricLevels, [...solarExtra, ...uniformLevels(solarMax, THOROUGH_SEARCH.uniformDivisions)])
      : coarseLevels(solarMax, solarRes);
  const batteryLevels = !sizeBattery ? [start.batteryCapacityMWh]
    : thorough ? coarseLevels(batteryMax, batteryRes, THOROUGH_SEARCH.geometricLevels, [...batteryExtra, ...uniformLevels(batteryMax, THOROUGH_SEARCH.uniformDivisions)])
      : coarseLevels(batteryMax, batteryRes, COARSE_LEVELS - 2, batteryExtra);
  const perConnection = [];
  let overall = null;

  connections.forEach((connection, index) => {
    const share = Math.floor((budget * (index + 1)) / connections.length);
    // The coarse grid may use at most this much, so the refinement keeps the rest.
    const coarseShare = thorough ? evaluations + Math.floor((share - evaluations) * THOROUGH_SEARCH.coarseBudgetShare) : share;
    const cells = [];
    let best = null;
    let bestHint = { units: base.firm.units };
    // Coarse grid, row by row; each cell starts from its left (or upper) neighbour's units.
    solarLevels.forEach((solar, i) => {
      cells[i] = [];
      batteryLevels.forEach((battery, j) => {
        if (evaluations + reserve > coarseShare) { cells[i][j] = null; return; }
        const neighbour = j > 0 ? cells[i][j - 1] : i > 0 ? cells[i - 1][j] : null;
        const hint = neighbour ? { minUnits: neighbour.minUnits, units: neighbour.units } : bestHint;
        const { best: cellBest, minUnits } = bestForPoint(pointOf(solar, battery), connection, hint);
        cells[i][j] = {
          solarMWdc: solar, batteryMWh: battery, units: cellBest.units, minUnits,
          npv: cellBest.npv, uptimePercent: cellBest.uptimePercent, feasible: cellBest.feasible,
        };
        Object.defineProperty(cells[i][j], 'summary', { value: cellBest, enumerable: false });
        if (isBetterCandidate(cellBest, best)) {
          best = cellBest;
          bestHint = { minUnits, units: cellBest.units };
        }
      });
    });
    report('refine');

    // Pattern search from the best coarse cells: the best one and the next
    // best that are not grid neighbours of a chosen one (another basin, e.g.
    // a small battery replacing firm units vs more units) and come within
    // the NPV window, up to refineStarts; each start's budget share is what
    // is left / starts left.
    const ranked = [];
    cells.forEach((row, i) => row.forEach((cell, j) => { if (cell) ranked.push({ i, j, cell }); }));
    ranked.sort((x, y) => (isBetterCandidate(x.cell.summary, y.cell.summary) ? -1 : isBetterCandidate(y.cell.summary, x.cell.summary) ? 1 : 0));
    const starts = [];
    for (const entry of ranked) {
      if (starts.length >= refineStarts) break;
      if (starts.some(other => Math.abs(other.i - entry.i) <= 1 && Math.abs(other.j - entry.j) <= 1)) continue;
      const lead = starts[0]?.cell.summary;
      if (lead && (!entry.cell.feasible || entry.cell.npv < lead.npv - startWindow * Math.abs(lead.totalCapex))) continue;
      starts.push(entry);
    }
    if (!sizeSolar && !sizeBattery && durations.length * unitSizes.length === 1) starts.length = Math.min(starts.length, 1);
    starts.forEach((entry, startIndex) => {
      const startShare = evaluations + Math.floor((share - evaluations) / (starts.length - startIndex));
      let localBest = entry.cell.summary;
      let point = pointOf(localBest.design.solar, localBest.design.battery);
      let hint = { minUnits: entry.cell.minUnits, units: localBest.units };
      const tryPoint = trial => {
        const { best: candidate, minUnits } = bestForPoint(trial, connection, hint);
        if (!isBetterCandidate(candidate, localBest)) return false;
        localBest = candidate;
        point = trial;
        hint = { minUnits, units: candidate.units };
        return true;
      };
      const steps = [];
      if (durations.length > 1) steps.push({ key: 'duration', values: durations });
      if (unitSizes.length > 1) steps.push({ key: 'unitSize', values: unitSizes });
      // Compass search: continuous steps on solar and battery, halved when no
      // move improves; with `discrete`, also the next shorter / longer
      // duration and unit size whenever no continuous move improved.
      const compass = discrete => {
        const axes = [];
        if (sizeSolar) axes.push({ key: 'solar', max: solarMax, res: solarRes, step: Math.max(point.solar / 2, solarLevels[1] / 2 || solarRes) });
        if (sizeBattery) axes.push({ key: 'battery', max: batteryMax, res: batteryRes, step: Math.max(point.battery / 2, batteryLevels[1] / 2 || batteryRes) });
        while (axes.some(axis => axis.step >= axis.res) && evaluations + reserve <= startShare) {
          let improved = false;
          for (const axis of axes) {
            if (axis.step < axis.res) continue;
            for (const sign of [1, -1]) {
              if (evaluations + reserve > startShare) break;
              const value = Math.min(axis.max, Math.max(0, roundTo(point[axis.key] + sign * axis.step, axis.res)));
              if (value === point[axis.key]) continue;
              const next = { ...point, [axis.key]: value };
              if (tryPoint(pointOf(next.solar, next.battery, next.duration, next.unitSize))) { improved = true; break; }
            }
          }
          for (const step of improved || !discrete ? [] : steps) {
            const index = step.values.indexOf(point[step.key]);
            for (const offset of [1, -1]) {
              const value = step.values[index + offset];
              if (value === undefined || evaluations + reserve > startShare) continue;
              const next = { ...point, [step.key]: value };
              if (tryPoint(pointOf(next.solar, next.battery, next.duration, next.unitSize))) { improved = true; break; }
            }
            if (improved) break;
          }
          if (!improved) axes.forEach(axis => { axis.step /= 2; });
        }
      };
      // First at the start's own duration and unit size (as without the
      // thorough search, so it can only add), then every duration x unit size
      // at the refined point, then the search again with discrete steps.
      compass(false);
      if (steps.length) {
        const here = point;
        durations.forEach(duration => unitSizes.forEach(unitSize => {
          if (evaluations + reserve <= startShare) tryPoint(pointOf(here.solar, here.battery, duration, unitSize));
        }));
        compass(true);
      }
      if (isBetterCandidate(localBest, best)) best = localBest;
    });
    perConnection.push({ connection, best, cells });
    if (isBetterCandidate(best, overall)) overall = best;
  });

  if (quick && isBetterCandidate(quick.best, overall)) overall = { ...quick.best, design: { ...quick.best.design } };
  if (!overall) overall = bestForPoint(pointOf(start.solarSizeMWdc, start.batteryCapacityMWh), connections[0], { units: base.firm.units }).best;
  // The winning design as a full state and a patch against the user's state.
  const bestState = normalizeDatacenterState(stateFor(overall.design));
  const bestResult = calculateDatacenterScenario(bestState, { fastMode: true });
  const patch = diffDatacenterState(reference, bestState);
  DESIGN_KEYS.forEach(key => { patch[key] = bestState[key]; });
  const best = { ...summarize(bestResult, overall.design), patch };
  const winning = perConnection.find(entry => entry.best === overall)
    || perConnection.find(entry => entry.connection === overall.design.connection) || perConnection[0];

  const corners = [];
  if (sizeSolar && best.solarMWdc >= solarMax - solarRes / 2) corners.push('solar');
  if (sizeBattery && best.batteryMWh >= batteryMax - batteryRes / 2) corners.push('battery');
  if (sizeFirm && !contract && best.units >= unitsMaxFor(overall.design.unitSize ?? unitSizeMW)) corners.push('units');

  const notes = [];
  if (!best.feasible) {
    notes.push(`No design within the bounds meets the ${start.uptimeTargetPercent}% uptime target; the best reaches ${best.uptimePercent.toFixed(3)}%.`);
  }
  if (corners.length) notes.push(`At the upper bound: ${corners.join(', ')}; a wider search range may find more.`);
  if (best.feasible && !islanded && best.gridConnection === 'firm' && sizeFirm && best.units === 0 && base.firm.units > 0) {
    notes.push('On this firm connection the utility outages fit within the hours the uptime target allows (or the battery rides through them), so no standby generation is needed for the target; real Tier III sites still carry N+1 standby.');
  }
  if (monotonicityExceptions > 0) notes.push(`Uptime fell when a unit was added in ${monotonicityExceptions} case(s); those were skipped.`);
  if (perConnection.length > 1) {
    perConnection.forEach(entry => {
      if (entry !== winning && entry.best) {
        notes.push(`Best with a ${entry.connection} connection: NPV ${millions(entry.best.npv)}${entry.best.feasible ? '' : ' (misses the target)'}.`);
      }
    });
  }
  report('done');

  return {
    architecture: start.architecture,
    best,
    baseline: summarize(calculateDatacenterScenario(reference, { fastMode: true })),
    start: summarize(base),
    feasible: best.feasible,
    candidatesEvaluated: evaluations,
    budget,
    bounds: {
      solarMaxMWdc: solarMax, batteryMaxMWh: batteryMax, unitsMax, unitSizeMW, firmFamily, peakMW, boundsScale: scale,
      thorough, durationsHours: durations, unitSizesMW: unitSizes, solarLevels: solarLevels.length, batteryLevels: batteryLevels.length, refineStarts,
    },
    sized: { solar: sizeSolar, battery: sizeBattery, firm: sizeFirm, gridConnection: connections.length > 1 },
    corners,
    frontier: {
      connection: winning.connection,
      solarLevels,
      batteryLevels,
      cells: winning.cells,
    },
    connections: perConnection.map(entry => ({ connection: entry.connection, best: entry.best })),
    notes,
    elapsedMs: Date.now() - t0,
  };
}

/**
 * Highest-NPV design meeting the uptime target, from the current state.
 * options: { sizeSolar, sizeBattery, sizeFirm (default true), sizeGridConnection
 * (default false: try firm and flexible), budget (scenario runs, default 800),
 * bounds { solarMaxMWdc, batteryMaxMWh, unitsMax } (explicit overrides),
 * boundsScale (multiplies the peak-load-derived bounds), onProgress({ stage,
 * evaluations, budget, percent }) }. Returns { architecture, best { patch, npv,
 * irr, mirr, uptimePercent, firstPower, totalCapex, solarMWdc, batteryMWh, units,
 * unitSizeMW, ... }, baseline, feasible, candidatesEvaluated, bounds, corners,
 * frontier { solarLevels, batteryLevels, cells[i][j] }, notes, elapsedMs }.
 */
export function optimizeDatacenterDesign(state, options = {}) {
  return optimizeFrom(state, state, options);
}

/**
 * The optimizer for each architecture from its starting design:
 * { rows: [{ architecture, result }], baseline, bestArchitecture,
 *   candidatesEvaluated, elapsedMs }. Patches are against `state`.
 */
export function compareArchitectures(state, options = {}) {
  const t0 = Date.now();
  const { architectures = OPTIMIZER_ARCHITECTURES, onProgress = null, ...rest } = options;
  const rows = architectures.map((architecture, index) => {
    const result = optimizeFrom(getArchitectureStartState(state, architecture), state, {
      ...rest,
      onProgress: progress => onProgress?.({
        ...progress,
        architecture,
        percent: ((index + (progress.percent || 0) / 100) / architectures.length) * 100,
      }),
    });
    return { architecture, result };
  });
  let bestRow = null;
  rows.forEach(row => {
    if (!bestRow || isBetterCandidate(row.result.best, bestRow.result.best)) bestRow = row;
  });
  return {
    rows,
    baseline: summarize(calculateDatacenterScenario(state, { fastMode: true })),
    bestArchitecture: bestRow?.architecture ?? null,
    candidatesEvaluated: rows.reduce((sum, row) => sum + row.result.candidatesEvaluated, 0),
    elapsedMs: Date.now() - t0,
  };
}
