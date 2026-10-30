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
const DESIGN_KEYS = ['architecture', 'gridConnection', 'solarSizeMWdc', 'batteryCapacityMWh', 'firmFamily', 'firmSizingMode', 'firmUnits'];
const resolutionFor = max => (max >= 100 ? 1 : max >= 10 ? 0.1 : 0.01);

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
    budget = DEFAULT_OPTIMIZER_BUDGET,
    bounds = {},
    boundsScale = 1,
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
  const unitsMax = !sizeFirm ? base.firm.units
    : contract ? 1
      : (bounds.unitsMax ?? Math.ceil((peakMW * scale) / unitSizeMW - 1e-9) + OPTIMIZER_BOUND_FACTORS.extraUnits);
  const solarRes = resolutionFor(solarMax);
  const batteryRes = resolutionFor(batteryMax);
  const connections = !islanded && sizeGridConnection ? ['firm', 'flexible'] : [start.gridConnection];

  let evaluations = 0;
  let monotonicityExceptions = 0;
  const cache = new Map();
  const reserve = Math.ceil(Math.log2(unitsMax + 2)) + 4; // one candidate's unit search
  const budgetLeft = () => budget - evaluations;
  const report = stage => onProgress?.({ stage, evaluations, budget, percent: Math.min(100, (evaluations / budget) * 100) });

  const stateFor = d => {
    const s = { ...start, solarSizeMWdc: d.solar, batteryCapacityMWh: d.battery, gridConnection: d.connection };
    if (sizeFirm) {
      if (d.units > 0 && contract) Object.assign(s, { firmFamily, firmSizingMode: 'auto' });
      else if (d.units > 0) Object.assign(s, { firmFamily, firmSizingMode: 'manual', firmUnits: d.units });
      else s.firmFamily = 'none'; // no plant on the schedule's required path either
    }
    return s;
  };
  const evaluate = d => {
    const key = `${d.solar}|${d.battery}|${d.units}|${d.connection}`;
    if (cache.has(key)) return cache.get(key);
    const r = calculateDatacenterScenario(stateFor(d), { fastMode: true });
    evaluations += 1;
    const summary = summarize(r, { ...d });
    cache.set(key, summary);
    if (evaluations % 10 === 0) report('search');
    return summary;
  };

  /*
   * Fewest gas units meeting the target at (solar, battery, connection): the
   * auto sizing with no spares (firm-sizing.js, one zero-gas dispatch; the
   * same count the bisection finds, tested), its run doubling as the
   * candidate at that count. Nuclear, or a count above unitsMax: null, and
   * the caller bisects.
   */
  const autoMinUnits = (solar, battery, connection) => {
    if (firmFamily !== 'gas') return null;
    const key = `${solar}|${battery}|auto|${connection}`;
    if (!cache.has(key)) {
      const r = calculateDatacenterScenario({ ...stateFor({ solar, battery, units: 1, connection }), firmSizingMode: 'auto', firmSpareUnits: 0 }, { fastMode: true });
      evaluations += 1;
      const basis = r.firm.sizingBasis;
      const units = basis?.reachable ? basis.minUnits : null;
      cache.set(key, units);
      // The auto run is the manual design at that count (same dispatch and costs; 0 units = no plant).
      if (units !== null && units <= unitsMax) cache.set(`${solar}|${battery}|${units}|${connection}`, summarize(r, { solar, battery, units, connection }));
    }
    const units = cache.get(key);
    return units !== null && units <= unitsMax ? units : null;
  };

  /** Best candidate for (solar, battery, connection): minimum feasible units, then an NPV walk. */
  const bestForPoint = (solar, battery, connection, hint = {}) => {
    const at = units => evaluate({ solar, battery, units, connection });
    if (!sizeFirm) return { best: at(unitsMax), minUnits: null };
    let minUnits = autoMinUnits(solar, battery, connection);
    if (minUnits === null || !at(minUnits).feasible) {
      minUnits = findMinimumUnits(units => at(units).feasible, unitsMax, hint.minUnits ?? null);
    }
    if (minUnits === null) return { best: at(unitsMax), minUnits: null }; // infeasible: highest uptime
    let n = Math.max(minUnits, Math.min(unitsMax, hint.units ?? minUnits));
    let best = at(n);
    // Walk while NPV improves (never below the minimum; a count above it that is
    // infeasible would break monotonicity: counted and skipped).
    for (const direction of [1, -1]) {
      for (let next = n + direction; next >= minUnits && next <= unitsMax && budgetLeft() > 0; next += direction) {
        const candidate = at(next);
        if (!candidate.feasible) { monotonicityExceptions += 1; continue; }
        if (!isBetterCandidate(candidate, best)) break;
        best = candidate;
        n = next;
      }
    }
    return { best, minUnits };
  };

  const solarLevels = sizeSolar ? coarseLevels(solarMax, solarRes) : [start.solarSizeMWdc];
  const batteryLevels = sizeBattery
    ? coarseLevels(batteryMax, batteryRes, COARSE_LEVELS - 2, BATTERY_PEAK_HOUR_LEVELS.map(hours => hours * peakMW))
    : [start.batteryCapacityMWh];
  const perConnection = [];
  let overall = null;

  connections.forEach((connection, index) => {
    const share = Math.floor((budget * (index + 1)) / connections.length);
    const cells = [];
    let best = null;
    let bestHint = { units: base.firm.units };
    // Coarse grid, row by row; each cell starts from its left (or upper) neighbour's units.
    solarLevels.forEach((solar, i) => {
      cells[i] = [];
      batteryLevels.forEach((battery, j) => {
        if (evaluations + reserve > share) { cells[i][j] = null; return; }
        const neighbour = j > 0 ? cells[i][j - 1] : i > 0 ? cells[i - 1][j] : null;
        const hint = neighbour ? { minUnits: neighbour.minUnits, units: neighbour.units } : bestHint;
        const { best: cellBest, minUnits } = bestForPoint(solar, battery, connection, hint);
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

    // Pattern search on (solar, battery) from the best coarse cells: the best
    // one and the next best that are not its grid neighbours (another basin,
    // e.g. a small battery replacing firm units vs more units), up to
    // REFINE_STARTS; each start's budget share is what is left / starts left.
    const ranked = [];
    cells.forEach((row, i) => row.forEach((cell, j) => { if (cell) ranked.push({ i, j, cell }); }));
    ranked.sort((a, b) => (isBetterCandidate(a.cell.summary, b.cell.summary) ? -1 : isBetterCandidate(b.cell.summary, a.cell.summary) ? 1 : 0));
    const starts = [];
    for (const entry of ranked) {
      if (starts.length >= REFINE_STARTS) break;
      if (starts.some(other => Math.abs(other.i - entry.i) <= 1 && Math.abs(other.j - entry.j) <= 1)) continue;
      // A further start only for a feasible cell within reach of the best:
      // NPV within START_NPV_WINDOW of the best design's capex.
      const lead = starts[0]?.cell.summary;
      if (lead && (!entry.cell.feasible || entry.cell.npv < lead.npv - START_NPV_WINDOW * Math.abs(lead.totalCapex))) continue;
      starts.push(entry);
    }
    if (!sizeSolar && !sizeBattery) starts.length = Math.min(starts.length, 1);
    starts.forEach((entry, startIndex) => {
      const startShare = evaluations + Math.floor((share - evaluations) / (starts.length - startIndex));
      let localBest = entry.cell.summary;
      let point = { solar: localBest.design.solar, battery: localBest.design.battery };
      let hint = { minUnits: entry.cell.minUnits, units: localBest.units };
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
            const trial = { ...point, [axis.key]: value };
            const { best: candidate, minUnits } = bestForPoint(trial.solar, trial.battery, connection, hint);
            if (isBetterCandidate(candidate, localBest)) {
              localBest = candidate;
              point = trial;
              hint = { minUnits, units: candidate.units };
              improved = true;
              break;
            }
          }
        }
        if (!improved) axes.forEach(axis => { axis.step /= 2; });
      }
      if (isBetterCandidate(localBest, best)) best = localBest;
    });
    perConnection.push({ connection, best, cells });
    if (isBetterCandidate(best, overall)) overall = best;
  });

  if (!overall) overall = bestForPoint(start.solarSizeMWdc, start.batteryCapacityMWh, connections[0], { units: base.firm.units }).best;
  // The winning design as a full state and a patch against the user's state.
  const bestState = normalizeDatacenterState(stateFor(overall.design));
  const bestResult = calculateDatacenterScenario(bestState, { fastMode: true });
  const patch = diffDatacenterState(reference, bestState);
  DESIGN_KEYS.forEach(key => { patch[key] = bestState[key]; });
  const best = { ...summarize(bestResult, overall.design), patch };
  const winning = perConnection.find(entry => entry.best === overall) || perConnection[0];

  const corners = [];
  if (sizeSolar && best.solarMWdc >= solarMax - solarRes / 2) corners.push('solar');
  if (sizeBattery && best.batteryMWh >= batteryMax - batteryRes / 2) corners.push('battery');
  if (sizeFirm && !contract && best.units >= unitsMax) corners.push('units');

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
    bounds: { solarMaxMWdc: solarMax, batteryMaxMWh: batteryMax, unitsMax, unitSizeMW, firmFamily, peakMW, boundsScale: scale },
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
