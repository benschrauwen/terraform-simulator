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

import { applyDatacenterPresetDefaults, normalizeDatacenterState } from '../../state/datacenter-schema.js';
import { compareArchitectures, isBetterCandidate } from './optimizer.js';

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
