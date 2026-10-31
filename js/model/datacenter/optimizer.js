/* ============================================
   Datacenter design optimizer
   ============================================
   optimizeDatacenterDesign(state, options): the design with the highest
   NPV whose achieved uptime meets the state's uptime target, over

     solar MWdc       0 .. 4 x design facility peak       (continuous)
     battery MWh      0 .. 24 h x design facility peak    (continuous)
     firm units       gas: the auto design (the units the uptime target
                      needs + the state's spare units, firmSpareUnits, which
                      a battery may stand in for) + 0 .. ceil(peak / unit
                      size) + 3 extra units run on cost (firmExtraUnits);
                      nuclear: 0 .. that bound (manual count; 0 = no plant;
                      an existing-plant contract is 0 or 1 block at the
                      average load)
     grid connection  firm and/or flexible (hybrid only, optional; grid-
                      connected designs are firm service)

   within what the architecture allows (ARCHITECTURES in data/datacenter/
   power.js, enforced by the schema): a grid-connected design never gets
   solar, a flexible connection or prime-power gas, since its start state
   has only standby types and solar is not searched. Everything else (site, cooling, revenue, prices, the gas or nuclear
   type, battery duration, ...) stays as given. Each candidate is a full
   fast-mode scenario run (one hourly dispatch year, ~1-2 ms).

   Method. For a given (solar, battery) a gas candidate is the auto design
   (firm-sizing.js plus the spare policy, exactly as a user's auto design,
   battery-as-reserve included), so optimized designs carry the same N+x as
   the starting designs; NPV is then walked one extra unit at a time (extra
   units pay when on-site gas is cheaper than the grid). For nuclear the
   fewest feasible units are bisected (uptime does not fall when a unit is
   added: more available capacity in every hour), bracketed from a
   neighbouring candidate's answer, then walked the same way. Over (solar, battery):
   a coarse grid (0 plus halvings down from each upper bound; the battery
   axis also 0.25-2 h of the design peak, where a small battery replacing
   firm units forms its own basin), then a compass/pattern search (axis and
   diagonal steps) from up to three coarse cells (the best and the next best
   that are not its grid neighbours and come within 2% of its capex in NPV),
   halving the step until it is below the resolution, and one global CMA-ES
   run (cmaes.js) from the centre of the bounds with a short pattern polish:
   with cheap solar and batteries a solar + battery basin can beat every
   coarse cell near the best one, and the local search alone never visits
   it (CMAES_GLOBAL_RUNS for the benchmark). Candidates are ranked feasible first, then by
   NPV; infeasible ones by uptime, so the search walks towards feasibility.
   The budget caps scenario evaluations per architecture (cache hits are
   free). It is a local search on one TMY year: see README "Design
   optimizer".

   compareArchitectures(state, options) runs it for grid, hybrid and
   islanded, each from that architecture's starting design
   (getArchitectureStartState: the schema's applyArchitectureDefaults when
   it exists, otherwise the current state with the architecture switched).
   A hybrid optimum without on-site generation (no solar, prime-power gas
   or own reactor; firm service) is a grid-connected design: the result says
   so (reducesTo 'grid', and a note) rather than presenting it as another.

   Pure; no DOM. */

import { ARCHITECTURES, GAS_GENSET_TYPES } from '../../data/datacenter/power.js';
import { DATACENTER_DEFAULT_STATE, fitsArchitecture, normalizeDatacenterState } from '../../state/datacenter-schema.js';
import { createRng, minimizeCmaes } from './cmaes.js';
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
// The global run: from the centre of the bounds with a step of a third of
// them and a larger population (IPOP-style: more samples for a rugged
// landscape), capped at CMAES_GLOBAL_RUNS scenario runs. Benchmark (Oct
// 2026, 5 sites x 5 solar / battery price pairs, hybrid, against a 41 x 51
// brute-force grid): the pattern search alone missed the solar + battery
// basin at Richland Parish by $17-27M (2 of 25 cases > $1M short, 370 runs,
// 1.0 s); with the global run no case is > $0.2M short and the mean is $0.7M
// better than the brute-force grid (489 runs, 1.3 s at a 100-run cap; a
// 60-run cap missed one basin again, 120 keeps a margin).
const CMAES_GLOBAL_SIGMA0 = 0.3;
const CMAES_GLOBAL_LAMBDA = 12;
const CMAES_GLOBAL_RUNS = 120;
// Stop a run after this many generations without a better point.
const CMAES_STALL_GENERATIONS = 8;
// The polish after CMA-ES starts at this many resolution steps.
const POLISH_RESOLUTION_STEPS = 4;

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
    // Gas auto: spares (after any the battery covers) and extra units in `units`.
    spareUnits: r.firm.sizingBasis?.spareUnits ?? null,
    extraUnits: r.state.firmSizingMode === 'auto' ? r.state.firmExtraUnits : 0,
    sparesReplacedByBattery: r.firm.sparesReplacedByBattery || 0,
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
    // Feasibility without the backup diesel (backup.js): it is resilience on
    // top, not a way to meet the target with emergency engines.
    uptimePercent: r.reliability.uptimeWithoutBackupPercent ?? r.reliability.uptimePercent,
    uptimeWithBackupPercent: r.reliability.uptimePercent,
    targetPercent: r.reliability.targetPercent,
    feasible: r.reliability.meetsTargetWithoutBackup ?? r.reliability.meetsTarget,
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
const DESIGN_KEYS = ['architecture', 'gridConnection', 'solarSizeMWdc', 'batteryCapacityMWh', 'batteryDurationHours', 'firmFamily', 'firmSizingMode', 'firmUnits', 'firmSpareUnits', 'firmExtraUnits', 'gasUnitSizeMW'];
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
    sizeSolar: sizeSolarOption = true,
    sizeBattery = true,
    sizeFirm = true,
    sizeGridConnection = false,
    budget: budgetOption = null,
    bounds = {},
    boundsScale = 1,
    thorough = false,
    // 'global' (default): the pattern search from the best coarse cells plus
    // one global CMA-ES run; 'pattern': the pattern search alone (the former
    // default, kept for comparison).
    refine = 'global',
    // Battery duration (1/2/4/8 h and the state's) as discrete steps at each
    // refinement start; the thorough search always does.
    searchDurations = true,
    // Gas unit size (the type's min, default and max, and the state's) the
    // same way; the size curves (power.js sizeCurve) charge small units their
    // heat rate, $/kW and O&M penalty.
    searchUnitSizes = true,
    onProgress = null,
  } = options;
  const start = normalizeDatacenterState(startState);
  const reference = normalizeDatacenterState(referenceState);
  const base = calculateDatacenterScenario(start, { fastMode: true });
  const peakMW = base.load.designPeakMW;
  const islanded = start.architecture === 'islanded';
  // The architecture's limits: no solar search where it allows none; only its connection types.
  const rules = ARCHITECTURES[start.architecture] || {};
  const sizeSolar = sizeSolarOption && rules.resources?.solar !== 'none';
  const allowedConnections = ['firm', 'flexible'].filter(connection => !rules.gridConnections || rules.gridConnections.includes(connection));
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
  const durations = (thorough || searchDurations) && sizeBattery
    ? [...new Set([...THOROUGH_SEARCH.durationsHours, start.batteryDurationHours])].sort((x, y) => x - y)
    : [start.batteryDurationHours];
  const unitSizes = (thorough || searchUnitSizes) && sizeFirm && gasRange && gasRange.max > gasRange.min
    ? [...new Set([gasRange.min, gasRange.default, gasRange.max, start.gasUnitSizeMW])].sort((x, y) => x - y)
    : [unitSizeMW];
  // Gas: auto sizing (the units the target needs + the spare policy, which
  // a battery may cover: scenario.js getBatteryReserve) and the searched
  // count is the extra units run on cost (firmExtraUnits). Nuclear: the
  // manual unit count.
  const autoGas = sizeFirm && firmFamily === 'gas';
  const unitsMaxFor = size => (!sizeFirm ? base.firm.units
    : contract ? 1
      : (bounds.unitsMax ?? Math.ceil((peakMW * scale) / size - 1e-9) + OPTIMIZER_BOUND_FACTORS.extraUnits));
  const unitsMax = unitsMaxFor(unitSizeMW);
  const solarRes = resolutionFor(solarMax);
  const batteryRes = resolutionFor(batteryMax);
  const connections = !islanded && sizeGridConnection && allowedConnections.length > 1 ? allowedConnections : [start.gridConnection];
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
    if (autoGas) {
      Object.assign(s, { firmFamily, firmSizingMode: 'auto', firmExtraUnits: d.units });
    } else if (sizeFirm) {
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

  /** Walk the searched count from `n` while NPV improves, not below `min`. */
  const walkUnits = (at, n, min, max) => {
    let best = at(n);
    // (Infeasible counts above a feasible one would break monotonicity: counted and skipped.)
    for (const direction of [1, -1]) {
      for (let next = n + direction; next >= min && next <= max && budgetLeft() > 0; next += direction) {
        const candidate = at(next);
        if (!candidate.feasible && best.feasible) { monotonicityExceptions += 1; continue; }
        if (!isBetterCandidate(candidate, best)) break;
        best = candidate;
        n = next;
      }
    }
    return best;
  };

  /**
   * Best candidate at a point and connection. Gas: the auto design (the
   * units the target needs + spares), then extra units while NPV improves
   * (they pay when gas is cheaper than grid power). Nuclear: the minimum
   * feasible count (bisection), then an NPV walk.
   */
  const bestForPoint = (q, connection, hint = {}) => {
    const max = unitsMaxFor(q.unitSize);
    const at = units => evaluate({ ...q, units, connection });
    if (!sizeFirm) return { best: at(max), minUnits: null };
    if (autoGas) return { best: walkUnits(at, Math.min(max, hint.units ?? 0), 0, max), minUnits: 0 };
    let minUnits = findMinimumUnits(units => at(units).feasible, max, hint.minUnits ?? null);
    if (minUnits === null) return { best: at(max), minUnits: null }; // infeasible: highest uptime
    return { best: walkUnits(at, Math.max(minUnits, Math.min(max, hint.units ?? minUnits)), minUnits, max), minUnits };
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
    let bestHint = { units: autoGas ? 0 : base.firm.units };
    // Coarse grid, row by row; each cell starts from its left (or upper) neighbour's units.
    solarLevels.forEach((solar, i) => {
      cells[i] = [];
      batteryLevels.forEach((battery, j) => {
        if (evaluations + reserve > coarseShare) { cells[i][j] = null; return; }
        const neighbour = j > 0 ? cells[i][j - 1] : i > 0 ? cells[i - 1][j] : null;
        const hint = neighbour ? { minUnits: neighbour.minUnits, units: neighbour.summary.design.units } : bestHint;
        const { best: cellBest, minUnits } = bestForPoint(pointOf(solar, battery), connection, hint);
        cells[i][j] = {
          solarMWdc: solar, batteryMWh: battery, units: cellBest.units, minUnits,
          npv: cellBest.npv, uptimePercent: cellBest.uptimePercent, feasible: cellBest.feasible,
        };
        Object.defineProperty(cells[i][j], 'summary', { value: cellBest, enumerable: false });
        if (isBetterCandidate(cellBest, best)) {
          best = cellBest;
          bestHint = { minUnits, units: cellBest.design.units };
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
    // One global CMA-ES run on top of the local starts (a basin no good coarse cell points to).
    if (refine === 'global' && starts.length && (sizeSolar || sizeBattery)) starts.push({ ...starts[0], global: true });
    starts.forEach((entry, startIndex) => {
      const startShare = evaluations + Math.floor((share - evaluations) / (starts.length - startIndex));
      // A global run adopts only what beats the best so far.
      let localBest = entry.global ? best : entry.cell.summary;
      let point = pointOf(localBest.design.solar, localBest.design.battery);
      let hint = { minUnits: entry.cell.minUnits, units: localBest.design.units };
      const tryPoint = trial => {
        const { best: candidate, minUnits } = bestForPoint(trial, connection, hint);
        if (!isBetterCandidate(candidate, localBest)) return false;
        localBest = candidate;
        point = trial;
        hint = { minUnits, units: candidate.design.units };
        return true;
      };
      const steps = [];
      if (durations.length > 1) steps.push({ key: 'duration', values: durations });
      if (unitSizes.length > 1) steps.push({ key: 'unitSize', values: unitSizes });
      // Compass search: continuous steps on solar and battery, then the four
      // diagonals, halved when no move improves; with `discrete`, also the next shorter / longer
      // duration and unit size whenever no continuous move improved.
      const compass = (discrete, polish = false) => {
        const axes = [];
        // A polish (after CMA-ES) starts from a few resolution steps instead of half the value.
        const firstStep = (value, level, res) => (polish ? POLISH_RESOLUTION_STEPS * res : Math.max(value / 2, level / 2 || res));
        if (sizeSolar) axes.push({ key: 'solar', max: solarMax, res: solarRes, step: firstStep(point.solar, solarLevels[1], solarRes) });
        if (sizeBattery) axes.push({ key: 'battery', max: batteryMax, res: batteryRes, step: firstStep(point.battery, batteryLevels[1], batteryRes) });
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
          // Diagonal moves (solar and battery together) before halving: with
          // cheap solar and batteries the optimum lies on a ridge along
          // "less solar, more battery", where no single-axis step improves
          // (Richland Parish at $0.40/W and $150/kWh stalled $7.5M short).
          if (!improved && axes.length === 2 && axes.every(axis => axis.step >= axis.res)) {
            for (const [solarSign, batterySign] of [[-1, 1], [1, -1], [1, 1], [-1, -1]]) {
              if (evaluations + reserve > startShare) break;
              const solar = Math.min(axes[0].max, Math.max(0, roundTo(point.solar + solarSign * axes[0].step, axes[0].res)));
              const battery = Math.min(axes[1].max, Math.max(0, roundTo(point.battery + batterySign * axes[1].step, axes[1].res)));
              if (solar === point.solar || battery === point.battery) continue;
              if (tryPoint(pointOf(solar, battery, point.duration, point.unitSize))) { improved = true; break; }
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
      // CMA-ES (cmaes.js) over (solar, battery) in the unit box of the search
      // bounds, at the point's duration and unit size. Each sample is the best
      // candidate at that point (bestForPoint: auto units and the extra-unit
      // walk); the score ranks feasible designs by NPV ahead of infeasible
      // ones by uptime, as isBetterCandidate does. Deterministic: seeded per
      // connection and start.
      const cmaes = (sigma0, seed, { x0: x0Override = null, lambda = null, maxRuns = Infinity } = {}) => {
        const axes = [];
        if (sizeSolar) axes.push({ key: 'solar', max: solarMax, res: solarRes });
        if (sizeBattery) axes.push({ key: 'battery', max: batteryMax, res: batteryRes });
        if (!axes.length) return;
        const fixedAt = { ...point };
        const toPoint = x => {
          const q = { ...fixedAt };
          axes.forEach((axis, i) => { q[axis.key] = Math.min(axis.max, Math.max(0, roundTo(x[i] * axis.max, axis.res))); });
          return pointOf(q.solar, q.battery, q.duration, q.unitSize);
        };
        const score = candidate => (candidate.feasible ? -candidate.npv : 1e15 + (100 - candidate.uptimePercent) * 1e12);
        const runLimit = Math.min(startShare, evaluations + maxRuns);
        const f = x => {
          if (evaluations + reserve > runLimit) return Infinity;
          const trial = toPoint(x);
          const { best: candidate, minUnits } = bestForPoint(trial, connection, hint);
          if (isBetterCandidate(candidate, localBest)) {
            localBest = candidate;
            point = trial;
            hint = { minUnits, units: candidate.design.units };
          }
          return score(candidate);
        };
        const x0 = x0Override ? axes.map(() => x0Override) : axes.map(axis => (axis.max > 0 ? point[axis.key] / axis.max : 0));
        const tolX = Math.min(...axes.map(axis => (axis.max > 0 ? axis.res / axis.max : 1)));
        // Each sample costs a few scenario runs (the unit walk); the budget check in f stops the rest.
        minimizeCmaes({ f, x0, sigma0, lambda, maxEvals: Math.max(12, Math.floor((runLimit - evaluations) / 2)), rng: createRng(seed), tolX: 2 * tolX, stallGenerations: CMAES_STALL_GENERATIONS });
      };
      const seed = 1 + 97 * index + 13 * startIndex;
      if (refine === 'global' && entry.global) {
        // The global run: CMA-ES from the box centre, then a short polish.
        cmaes(CMAES_GLOBAL_SIGMA0, seed, { x0: 0.5, lambda: CMAES_GLOBAL_LAMBDA, maxRuns: CMAES_GLOBAL_RUNS });
        compass(false, true);
      } else {
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
  if (sizeFirm && !contract && (autoGas ? overall.design.units : best.units) >= unitsMaxFor(overall.design.unitSize ?? unitSizeMW)) corners.push('units');

  const notes = [];
  if (!best.feasible) {
    notes.push(`No design within the bounds meets the ${start.uptimeTargetPercent}% uptime target; the best reaches ${best.uptimePercent.toFixed(3)}%.`);
  }
  if (corners.length) notes.push(`At the upper bound: ${corners.join(', ')}; a wider search range may find more.`);
  if (best.feasible && !islanded && best.gridConnection === 'firm' && sizeFirm && best.units === 0 && base.firm.units > 0) {
    notes.push('On this firm connection the utility outages fit within the hours the uptime target allows (or the battery rides through them), so no standby generation is needed for the target; real Tier III sites still carry N+1 standby.');
  }
  // A hybrid design with nothing on site but a battery or standby units is a grid-connected one.
  const reducesTo = start.architecture === 'hybrid' && fitsArchitecture(bestState, 'grid') ? 'grid' : null;
  if (reducesTo) {
    notes.push('The best hybrid design has no on-site generation (no solar, gas engines or turbines, or own reactor) and firm service: it reduces to a grid-connected design.');
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
    reducesTo,
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
 * frontier { solarLevels, batteryLevels, cells[i][j] }, reducesTo ('grid' when a hybrid
 * optimum has no on-site generation, else null), notes, elapsedMs }.
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
