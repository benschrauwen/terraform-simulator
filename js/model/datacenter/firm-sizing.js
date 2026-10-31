/* ============================================
   Firm generation sized for the uptime target
   ============================================
   sizeGasForUptime(state, context): the fewest gas units (before spares)
   with which the hourly dispatch meets the uptime target, given the grid
   (utility outages, flexible curtailments, import cap), solar and battery.

   Uptime counts hours with the full load served (dispatch.js: an hour is
   unserved when its deficit exceeds servedTolerance x load), so the target
   allows H unserved hours:

     H = the largest whole number with (8760 - H) / 8760 x 100 >= target

   Exact method ('residual'). Run the dispatch once with zero firm capacity.
   Gas is the last resource in each hour's deficit order, and in these
   designs nothing the gas does feeds back into other hours:
   - a shifting battery (solar or nuclear on site) charges only from surplus
     and discharges before grid and gas;
   - a reserve battery on a grid-first design charges only from spare grid
     and discharges before gas;
   - firm-first (hybrid when gas is cheaper, islanded) with a shifting or no
     battery: the order of gas and grid within an hour does not change what
     is left unserved.
   So the residual shortfall s(h) of that run is what gas faces in every
   hour, and an hour is served with gas available G(h) iff
   G(h) >= need(h) = s(h) - servedTolerance x load(h). With N units, G(h) =
   (N - units in maintenance at h) x unit size, the maintenance blocks being
   the same deterministic ones the dispatch uses (supply.js
   buildOutageCounts). The fewest N with at most H failing hours starts at
   ceil(required MW / unit size), required MW = the (H+1)-th largest need
   (all units available), and steps up while maintenance blocks overlap
   needed hours or hot hours derate the units (power.js ambientDerate: G(h)
   uses each unit's output at that hour's temperature). More units never remove capacity from any hour, so the
   first N that passes is the minimum.

   Fallback ('bisection'). A reserve battery that is charged from spare gas
   (islanded) or used after gas (hybrid firm-first), or any battery charged
   from spare grid ahead of known curtailments while gas runs before the
   grid (gas frees grid capacity for the charge), makes the battery state
   depend on the gas fleet, so the residual is not fixed. Then the count is
   bisected on full dispatch runs between 0 and the residual count computed
   without the battery (an upper bound: in those orders the battery only
   adds supply after gas, and is charged only from spare capacity).

   Results are cached per supply design (prices excluded). Pure; no DOM. */

import { DATACENTER_MODEL_ASSUMPTIONS as A } from '../../data/datacenter/model-assumptions.js';
import { HOURS_PER_YEAR } from './climate.js';
import { dispatchYear, getBatteryRole } from './dispatch.js';
import { buildOutageCounts } from './supply.js';

// Hours the uptime target allows unserved (see header).
export function allowedUnservedHours(targetPercent) {
  const h = Math.floor(HOURS_PER_YEAR - ((targetPercent - 1e-9) * HOURS_PER_YEAR) / 100 + 1e-9);
  return Math.max(0, Math.min(HOURS_PER_YEAR, h));
}

// The last bisected count: the next sizing (a neighbouring design) starts there.
let lastBisectionUnits = null;

// Above this many units the count is reported unreachable (schema firmUnits
// max): enough for the largest IT load (20 GW) on the smallest units (0.325
// MW fuel cells, ~90,000 at a ~1.4 peak PUE).
export const MAX_FIRM_UNITS = 200000;
// kW margin so a count that only just covers an hour in exact arithmetic is
// not judged served when the dispatch's floating point would leave it short.
const NEED_MARGIN_KW = 1e-6;

/** Available gas kW per hour for `units` identical units (supply.js maintenance blocks). */
export function gasAvailableKW(units, firm) {
  const counts = buildOutageCounts(units, firm.outageHoursPerUnit, A.gasOutageStartDayOfYear * 24);
  const unitKW = firm.unitSizeMW * 1000;
  const output = firm.ambient?.output;
  const available = new Float64Array(HOURS_PER_YEAR);
  for (let h = 0; h < HOURS_PER_YEAR; h++) available[h] = Math.max(0, units - counts[h]) * unitKW * (output ? output[h] : 1);
  return available;
}

function withUnits(firm, units) {
  return { ...firm, units, capacityMW: units * firm.unitSizeMW, availableKW: gasAvailableKW(units, firm) };
}

/* Hours still unserved by the residual `needs` [{ hour, kW }] with N units. */
function failingHours(needs, units, firm) {
  if (!needs.length) return 0;
  if (units <= 0) return needs.length;
  const counts = buildOutageCounts(units, firm.outageHoursPerUnit, A.gasOutageStartDayOfYear * 24);
  const unitKW = firm.unitSizeMW * 1000;
  const output = firm.ambient?.output;
  let failing = 0;
  for (const { hour, kW } of needs) {
    if (Math.max(0, units - counts[hour]) * unitKW * (output ? output[hour] : 1) < kW + NEED_MARGIN_KW) failing += 1;
  }
  return failing;
}

/* Residual sizing from a zero-firm dispatch run. */
function residualSizing(run, loadKW, firm, H) {
  const needs = [];
  for (let h = 0; h < HOURS_PER_YEAR; h++) {
    const kW = run.unservedKW[h] - A.servedTolerance * loadKW[h];
    if (run.unservedKW[h] > A.servedTolerance * loadKW[h]) needs.push({ hour: h, kW });
  }
  const sorted = needs.map(entry => entry.kW).sort((a, b) => b - a);
  const requiredKW = sorted.length > H ? sorted[H] : 0;
  const start = requiredKW > 0 ? Math.min(MAX_FIRM_UNITS, Math.ceil(requiredKW / (firm.unitSizeMW * 1000) - 1e-9)) : 0;
  // More units never remove capacity from an hour (a new unit's maintenance
  // block only takes out that unit), so failing hours fall monotonically:
  // gallop up from the start count, then bisect to the fewest that pass.
  const passes = n => failingHours(needs, n, firm) <= H;
  let units = start;
  if (!passes(start)) {
    let lo = start;
    let hi = start;
    for (let step = 1; hi < MAX_FIRM_UNITS; step *= 2) {
      hi = Math.min(MAX_FIRM_UNITS, lo + step);
      if (passes(hi)) break;
      lo = hi;
    }
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (passes(mid)) hi = mid;
      else lo = mid;
    }
    units = hi;
  }
  const failing = failingHours(needs, units, firm);
  return {
    units,
    reachable: failing <= H,
    requiredKW,
    maxShortfallKW: sorted.length ? sorted[0] : 0,
    hoursShortWithoutFirm: needs.length,
    unservedHoursWithFirm: failing,
  };
}

const sizingCache = new Map();

/**
 * Gas sizing for the uptime target. `context`: { loadKW, solar, grid, firm
 * (a gas firm supply; its units are ignored), order, exportAllowed, key
 * (cache key of the supply design, or null) }. Returns { method ('residual'
 * | 'bisection'), minUnits (before spares), reachable, allowedUnservedHours,
 * hoursShortWithoutFirm, requiredMW (firm MW the target needs with every
 * unit available), maxShortfallMW, hoursCoveredByFirm, unservedHoursWithFirm }.
 */
export function sizeGasForUptime(state, context) {
  // stats: false skips the bisection's display statistics (a fast-mode search).
  const { loadKW, solar, grid, firm, order, exportAllowed, key, stats = true } = context;
  if (key && sizingCache.has(key)) return sizingCache.get(key);
  const H = allowedUnservedHours(state.uptimeTargetPercent);
  const inputs = { loadKW, solarKW: solar.hourlyKW, solar, grid, batteryState: state, order, exportAllowed };
  const zero = withUnits(firm, 0);
  const role = getBatteryRole(state, solar, zero);
  // A battery charged ahead of known curtailments from spare grid (dispatch.js
  // header, 5) depends on the gas fleet when gas runs before the grid: gas
  // that serves the load frees grid capacity for the charge.
  const prechargedByGrid = role !== 'none' && order !== 'grid-first' && Boolean(grid.curtailment?.some(Boolean)) && A.flexibleEventPrechargeHours > 0;
  const separable = !prechargedByGrid && (role !== 'reserve' || (grid.connected && order === 'grid-first'));

  let result;
  if (separable) {
    const run = dispatchYear({ ...inputs, firm: zero });
    const sized = residualSizing(run, loadKW, firm, H);
    result = { method: 'residual', minUnits: sized.units, ...sized };
  } else {
    // Upper bound (when needed): the residual count without the battery.
    const noBattery = { ...state, batteryCapacityMWh: 0 };
    const upperBound = () => residualSizing(dispatchYear({ ...inputs, batteryState: noBattery, firm: zero }, {}), loadKW, firm, H).units;
    const runs = new Map();
    // Each run warm-starts the battery from the nearest count already run (dispatch.js).
    const runWith = units => {
      if (!runs.has(units)) {
        let nearest = null;
        runs.forEach((run, n) => { if (nearest === null || Math.abs(n - units) < Math.abs(nearest - units)) nearest = n; });
        const startSocHintKWh = nearest === null ? null : runs.get(nearest).battery.startSocKWh;
        runs.set(units, dispatchYear({ ...inputs, firm: withUnits(firm, units) }, { startSocHintKWh }));
      }
      return runs.get(units);
    };
    const feasible = units => runWith(units).totals.unservedHours <= H;
    // Bracket around the last answer first (neighbouring designs in an
    // optimization need about the same count; usually two runs settle it),
    // otherwise from zero and the no-battery bound; then bisect. The same
    // minimum either way: feasibility does not fall when a unit is added.
    let lo = -1;
    let hi = null;
    const guess = lastBisectionUnits;
    if (guess !== null && guess >= 0) {
      if (feasible(guess)) {
        hi = guess;
        if (guess === 0 || !feasible(guess - 1)) lo = guess - 1;
      } else {
        lo = guess;
      }
    }
    if (lo < 0 && hi !== 0) {
      if (feasible(0)) hi = 0;
      else lo = Math.max(lo, 0);
    }
    if (hi === null) hi = upperBound();
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (feasible(mid)) hi = mid;
      else lo = mid;
    }
    lastBisectionUnits = hi;
    // The shortfall without firm generation (display statistics; skipped in a search).
    const needs = [];
    if (stats) {
      const zeroRun = runWith(0);
      for (let h = 0; h < HOURS_PER_YEAR; h++) {
        if (zeroRun.unservedKW[h] > A.servedTolerance * loadKW[h]) needs.push(zeroRun.unservedKW[h]);
      }
      needs.sort((a, b) => b - a);
    }
    const finalRun = runWith(hi);
    result = {
      method: 'bisection',
      minUnits: hi,
      startSocKWh: finalRun.battery.startSocKWh,
      reachable: finalRun.totals.unservedHours <= H,
      requiredKW: hi * firm.unitSizeMW * 1000,
      maxShortfallKW: needs.length ? needs[0] : 0,
      hoursShortWithoutFirm: stats ? needs.length : null,
      unservedHoursWithFirm: finalRun.totals.unservedHours,
    };
  }
  const out = {
    method: result.method,
    // The settled battery state at the found count (a warm start for the scenario's run).
    startSocKWh: result.startSocKWh ?? null,
    minUnits: result.minUnits,
    reachable: result.reachable,
    allowedUnservedHours: H,
    hoursShortWithoutFirm: result.hoursShortWithoutFirm,
    requiredMW: result.requiredKW / 1000,
    maxShortfallMW: result.maxShortfallKW / 1000,
    unservedHoursWithFirm: result.unservedHoursWithFirm,
    hoursCoveredByFirm: result.hoursShortWithoutFirm === null ? null : Math.max(0, result.hoursShortWithoutFirm - result.unservedHoursWithFirm),
  };
  if (key) {
    if (sizingCache.size >= 32) sizingCache.delete(sizingCache.keys().next().value);
    sizingCache.set(key, out);
  }
  return out;
}
