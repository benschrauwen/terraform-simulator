/* ============================================
   Site survey: the optimized design at every site
   ============================================
   optimizeForSite(baseState, siteId) moves the user's design to another site
   (the site-driven fields reset to that site's values, as when the user picks
   it: applyDatacenterPresetDefaults), runs the architecture comparison there
   (compareArchitectures: grid, hybrid and islanded, each optimized for the
   highest NPV that meets the uptime target) and returns the winning design as
   a full state, so the sites page can render it and link back to the
   simulator with it. Everything else (IT size, GPUs, cooling, prices, finance)
   stays the user's. Pure. */

import { applyDatacenterProject } from '../../state/datacenter-projects.js';
import { applyDatacenterPresetDefaults, normalizeDatacenterState } from '../../state/datacenter-schema.js';
import { compareArchitectures, isBetterCandidate } from './optimizer.js';
import { calculateDatacenterScenario } from './scenario.js';

/** Per-architecture summary fields the sites page shows. */
const ROW_FIELDS = ['npv', 'irr', 'feasible', 'uptimePercent', 'firstPower', 'firstPowerMonths', 'solarMWdc', 'batteryMWh', 'units', 'unitSizeMW', 'firmLabel', 'gridConnection'];

/**
 * { siteId, state, bestArchitecture, architectures: [{ architecture, npv, irr,
 *   feasible, uptimePercent, firstPower, ... }], candidatesEvaluated, elapsedMs }.
 * `state` is the best design (normalized), or the site's starting state when no
 * architecture produced one. options are compareArchitectures' (budget,
 * boundsScale, onProgress, ...).
 */
export function optimizeForSite(baseState, siteId, options = {}) {
  const t0 = Date.now();
  const siteState = applyDatacenterPresetDefaults({ ...normalizeDatacenterState(baseState), siteId }, 'siteId');
  const comparison = compareArchitectures(siteState, options);
  let bestRow = null;
  comparison.rows.forEach(row => {
    if (row.result.best && (!bestRow || isBetterCandidate(row.result.best, bestRow.result.best))) bestRow = row;
  });
  return {
    siteId,
    state: bestRow ? normalizeDatacenterState({ ...siteState, ...bestRow.result.best.patch }) : siteState,
    bestArchitecture: bestRow?.architecture ?? null,
    architectures: comparison.rows.map(({ architecture, result }) => ({
      architecture,
      ...Object.fromEntries(ROW_FIELDS.map(key => [key, result.best?.[key] ?? null])),
    })),
    candidatesEvaluated: comparison.candidatesEvaluated,
    elapsedMs: Date.now() - t0,
  };
}

/* ---------- Solar price sweep (the hidden datacenter-solar-sweep.html page) ---------- */

// Installed solar prices swept ($/W DC, panel + BOS); the default east-west build is ~$0.69/W.
export const SOLAR_SWEEP_PRICES_PER_W = Object.freeze([0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 1.0, 1.2]);

/** `state` with installed solar (panel + BOS) at `totalPerW` $/W, keeping its panel / BOS split. */
export function withSolarPrice(state, totalPerW) {
  const normalized = normalizeDatacenterState(state);
  const current = normalized.panelCostPerW + normalized.bosCostPerW;
  const panelShare = current > 0 ? normalized.panelCostPerW / current : 0.42;
  return normalizeDatacenterState({ ...normalized, panelCostPerW: totalPerW * panelShare, bosCostPerW: totalPerW * (1 - panelShare) });
}

/**
 * One point of the sweep: the user's settings moved to a site ({ kind:
 * 'site', id: siteId }) or prefilled with a real project ({ kind:
 * 'project', id: projectId }), solar at `pricePerW`, then the best design
 * across grid, hybrid and islanded (compareArchitectures from each
 * architecture's starting design; a project keeps its site, IT size, GPUs,
 * cooling, grid cap and backup diesel). Returns { kind, id, pricePerW,
 * architecture, npv, irr, co2eT, solarMWdc, batteryMWh, firmLabel, units,
 * feasible }.
 */
export function solarSweepPoint(baseState, { kind, id, pricePerW }, options = {}) {
  const start = kind === 'project'
    ? applyDatacenterProject(baseState, id)
    : applyDatacenterPresetDefaults({ ...normalizeDatacenterState(baseState), siteId: id, projectId: 'none' }, 'siteId');
  const priced = withSolarPrice(start, pricePerW);
  const comparison = compareArchitectures(priced, options);
  let bestRow = null;
  comparison.rows.forEach(row => {
    if (row.result.best && (!bestRow || isBetterCandidate(row.result.best, bestRow.result.best))) bestRow = row;
  });
  const state = bestRow ? normalizeDatacenterState({ ...priced, ...bestRow.result.best.patch }) : priced;
  const r = calculateDatacenterScenario(state, { fastMode: true });
  return {
    kind, id, pricePerW,
    architecture: state.architecture,
    npv: r.economics.npv,
    irr: r.economics.projectIrr,
    co2eT: r.emissions.totalCo2eT,
    solarMWdc: state.solarSizeMWdc,
    batteryMWh: state.batteryCapacityMWh,
    firmLabel: r.firm.units > 0 ? r.firm.label : null,
    units: r.firm.units,
    feasible: r.reliability.meetsTargetWithoutBackup,
  };
}
