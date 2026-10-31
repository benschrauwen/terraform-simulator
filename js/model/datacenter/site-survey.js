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

import { PRICE_LEARNING } from '../../data/datacenter/learning.js';
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

/* ---------- Price sweeps (the hidden datacenter-solar-sweep.html page) ---------- */

// Installed solar prices swept ($/W DC, panel + BOS); the default east-west build is ~$0.69/W.
export const SOLAR_SWEEP_PRICES_PER_W = Object.freeze([0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 1.0]);
// Installed battery prices swept ($/kWh of a 4-hour battery: energy part + power part / 4);
// the US default is $250/kWh (power.js BATTERY_COSTS).
export const BATTERY_SWEEP_PRICES_PER_KWH = Object.freeze([75, 100, 125, 150, 175, 200, 250, 300]);
export const BATTERY_SWEEP_HOURS = 4;

/** Installed solar ($/W, panel + BOS) of a state. */
export const solarPricePerW = state => state.panelCostPerW + state.bosCostPerW;

/** Installed battery price of a state ($/kWh of a 4-hour battery: energy + power / 4). */
export const batteryPricePerKWh = state => state.batteryCostPerKWh + state.batteryPowerCostPerKW / BATTERY_SWEEP_HOURS;

/** `state` with installed solar (panel + BOS) at `totalPerW` $/W, keeping its panel / BOS split. */
export function withSolarPrice(state, totalPerW) {
  const normalized = normalizeDatacenterState(state);
  const current = solarPricePerW(normalized);
  const panelShare = current > 0 ? normalized.panelCostPerW / current : 0.42;
  return normalizeDatacenterState({ ...normalized, panelCostPerW: totalPerW * panelShare, bosCostPerW: totalPerW * (1 - panelShare) });
}

/**
 * `state` with the battery at `perKWh` $/kWh of a 4-hour battery, both parts
 * (energy $/kWh and power $/kW) scaled by the same factor, so their split is
 * kept.
 */
export function withBatteryPrice(state, perKWh) {
  const normalized = normalizeDatacenterState(state);
  const current = batteryPricePerKWh(normalized);
  if (!(current > 0)) return normalizeDatacenterState({ ...normalized, batteryCostPerKWh: perKWh, batteryPowerCostPerKW: 0 });
  const factor = perKWh / current;
  return normalizeDatacenterState({ ...normalized, batteryCostPerKWh: normalized.batteryCostPerKWh * factor, batteryPowerCostPerKW: normalized.batteryPowerCostPerKW * factor });
}

/** Cumulative deployment at the start of `year` (the end of the year before), from the base year. */
function cumulativeAt({ cumulative, additions, additionsGrowth, additionsGrowthAfter2030 }, baseYear, year) {
  let total = cumulative;
  let added = additions;
  for (let y = baseYear; y < year; y++) {
    added *= 1 + (y <= 2030 ? additionsGrowth : additionsGrowthAfter2030);
    total += added;
  }
  return total;
}

/** Wright's law: the cost factor after cumulative deployment grows by `ratio` at learning rate `rate`. */
export const learningFactor = (ratio, rate) => ratio ** Math.log2(1 - rate);

/**
 * Expected solar and battery prices by year (data/datacenter/learning.js): the state's own panel, BOS, battery energy
 * and battery power prices in the base year, each part falling at its path's
 * learning rate on its technology's cumulative deployment. Returns
 * [{ year, solarPricePerW, batteryPricePerKWh }] for the data's years.
 */
export function learningPricePath(state, pathKey = 'central', data = PRICE_LEARNING) {
  const rates = data.paths[pathKey];
  const s = normalizeDatacenterState(state);
  const solar = { cumulative: data.solar.cumulativeGW, additions: data.solar.additionsGW, additionsGrowth: data.solar.additionsGrowth, additionsGrowthAfter2030: data.solar.additionsGrowthAfter2030 };
  const battery = { cumulative: data.battery.cumulativeGWh, additions: data.battery.additionsGWh, additionsGrowth: data.battery.additionsGrowth, additionsGrowthAfter2030: data.battery.additionsGrowthAfter2030 };
  return data.years.map(year => {
    const solarRatio = cumulativeAt(solar, data.baseYear, year) / solar.cumulative;
    const batteryRatio = cumulativeAt(battery, data.baseYear, year) / battery.cumulative;
    return {
      year,
      solarPricePerW: s.panelCostPerW * learningFactor(solarRatio, rates.module) + s.bosCostPerW * learningFactor(solarRatio, rates.bos),
      batteryPricePerKWh: s.batteryCostPerKWh * learningFactor(batteryRatio, rates.batteryEnergy)
        + (s.batteryPowerCostPerKW * learningFactor(batteryRatio, rates.batteryPower)) / BATTERY_SWEEP_HOURS,
    };
  });
}

/**
 * One point of a price sweep: the user's settings moved to a site ({ kind:
 * 'site', id: siteId }) or prefilled with a real project ({ kind:
 * 'project', id: projectId }), solar and battery at the given prices (null:
 * the settings' own), then the best design across grid, hybrid and islanded
 * (compareArchitectures from each architecture's starting design; a project
 * keeps its site, IT size, GPUs, cooling, grid cap and backup diesel).
 * Returns { kind, id, solarPricePerW, batteryPricePerKWh, architecture, npv,
 * irr, co2eT, curtailedMWh, exportMWh, solarMWdc, batteryMWh, firmLabel,
 * units, feasible, patch (the design against the priced start) }.
 */
export function priceSweepPoint(baseState, { kind, id, solarPricePerW: solarPrice = null, batteryPricePerKWh: batteryPrice = null }, options = {}) {
  const start = kind === 'project'
    ? applyDatacenterProject(baseState, id)
    : applyDatacenterPresetDefaults({ ...normalizeDatacenterState(baseState), siteId: id, projectId: 'none' }, 'siteId');
  let priced = solarPrice === null ? start : withSolarPrice(start, solarPrice);
  if (batteryPrice !== null) priced = withBatteryPrice(priced, batteryPrice);
  const comparison = compareArchitectures(priced, options);
  let bestRow = null;
  comparison.rows.forEach(row => {
    if (row.result.best && (!bestRow || isBetterCandidate(row.result.best, bestRow.result.best))) bestRow = row;
  });
  const state = bestRow ? normalizeDatacenterState({ ...priced, ...bestRow.result.best.patch }) : priced;
  const r = calculateDatacenterScenario(state, { fastMode: true });
  return {
    kind, id,
    solarPricePerW: solarPricePerW(priced),
    batteryPricePerKWh: batteryPricePerKWh(priced),
    architecture: state.architecture,
    npv: r.economics.npv,
    irr: r.economics.projectIrr,
    co2eT: r.emissions.totalCo2eT,
    // Excess electricity: on-site generation the site neither used nor stored (curtailed) or sold (exported).
    curtailedMWh: r.dispatch.annual.curtailedMWh,
    exportMWh: r.dispatch.annual.exportMWh,
    solarMWdc: state.solarSizeMWdc,
    batteryMWh: state.batteryCapacityMWh,
    firmLabel: r.firm.units > 0 ? r.firm.label : null,
    units: r.firm.units,
    feasible: r.reliability.meetsTargetWithoutBackup,
    // The winning design as a patch on the priced start (sweepPointState rebuilds the full state).
    patch: bestRow ? bestRow.result.best.patch : {},
  };
}

/**
 * The full state of a sweep point (the simulator link of a cell): the
 * settings at the point's site (or project) and prices, with the point's
 * design patch applied.
 */
export function sweepPointState(baseState, { kind, id, solarPricePerW: solarPrice, batteryPricePerKWh: batteryPrice, patch = {} }) {
  const start = kind === 'project'
    ? applyDatacenterProject(baseState, id)
    : applyDatacenterPresetDefaults({ ...normalizeDatacenterState(baseState), siteId: id, projectId: 'none' }, 'siteId');
  return normalizeDatacenterState({ ...withBatteryPrice(withSolarPrice(start, solarPrice), batteryPrice), ...patch });
}
