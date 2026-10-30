/* ============================================
   Datacenter supply resources
   ============================================
   Builds the hourly supply side the dispatch draws on:
   - solar: the plant builder's solar model (Calc.calculateSolar for cost,
     land and layout; its clear-sky hourly plane-of-array shape, with the
     datacenter site's own diffuse fraction, shifted from solar time to local
     standard time), varied day by day with the site's PVGIS TMY daily factor
     and scaled to the site's PVGIS yield x mounting multiplier;
   - grid: connected or not, import cap, the utility outage hours every
     connection sees and, for a flexible connection, the curtailed hours on
     top of them;
   - firm generation (gas or nuclear): unit sizing and the hourly available
     capacity after deterministic planned outages.
   Pure; no DOM. */

import { DATACENTER_MODEL_ASSUMPTIONS as A } from '../../data/datacenter/model-assumptions.js';
import { GAS_GENSET_TYPES, NUCLEAR_TYPES } from '../../data/datacenter/power.js';
import { DEFAULT_STATE } from '../../state/schema.js';
import { Calc, SolarGeometry } from '../index.js';
import { HOURS_PER_YEAR } from './climate.js';

/* ---------- Solar ---------- */

const solarCache = new Map();

/* Plant-builder state for the solar model of a datacenter site. */
function toSolarState(state, site) {
  return {
    ...DEFAULT_STATE,
    body: 'earth',
    solarProfileModel: 'earth',
    latitude: site.lat,
    longitude: site.lon,
    mountingType: state.mountingType,
    siteYieldMwhPerMwdcYear: state.siteYieldMwhPerMwdcYear,
    systemSizeMW: state.solarSizeMWdc,
    panelCostPerW: state.panelCostPerW,
    bosCostPerW: state.bosCostPerW,
    panelEfficiency: state.panelEfficiency,
    landCostPerAcre: state.landCostPerAcre,
    sitePrepCostPerAcre: state.sitePrepCostPerAcre,
    solarAssetLife: state.solarAssetLife,
    solarOmPercent: state.solarOmPercent,
    discountRate: state.discountRate,
  };
}

/**
 * Solar supply: { enabled, sizeMWdc, model (Calc.calculateSolar result:
 * capex parts, acres, landAreaM2, groundCoverageRatio), yieldMultiplier,
 * siteYield (MWh/MWdc-yr), annualMWh, capacityFactor, hourlyKW (8760,
 * local standard time), localTimeShiftHours, dailyVariability, reachable }.
 */
export function buildSolarSupply(state, site) {
  const sizeMWdc = state.solarSizeMWdc;
  if (!(sizeMWdc > 0)) {
    return { enabled: false, sizeMWdc: 0, model: null, yieldMultiplier: 0, siteYield: 0, annualMWh: 0, capacityFactor: 0, hourlyKW: null, localTimeShiftHours: 0, reachable: true };
  }
  const key = JSON.stringify([site.id, sizeMWdc, state.mountingType, state.siteYieldMwhPerMwdcYear, state.panelCostPerW, state.bosCostPerW,
    state.panelEfficiency, state.landCostPerAcre, state.sitePrepCostPerAcre, state.solarAssetLife, state.solarOmPercent, state.discountRate]);
  if (solarCache.has(key)) return solarCache.get(key);

  const solarState = toSolarState(state, site);
  const model = Calc.calculateSolar(solarState);
  // The site's own PVGIS diffuse fraction and GHI drive the sky model (the
  // plant builder would look up its own location presets instead).
  const sitePreset = { diffuseFraction: site.diffuseFraction, region: site.region };
  const sky = Calc.getEarthSkyModel(site.lat, sitePreset, site.ghi, model.groundCoverageRatio);
  const yieldMultiplier = Calc.getMountingYieldMultiplier(solarState, sitePreset, site.ghi, sky);
  const peakKW = sizeMWdc * 1000;
  const targetKWh = peakKW * state.siteYieldMwhPerMwdcYear * yieldMultiplier;
  // Clear-sky plane-of-array shape from the plant builder's geometry, moved
  // from solar time to local standard time (solar noon falls at
  // 12 - (lon - 15 x utcOffset) / 15 local hours; equation of time ignored,
  // rounded to whole hours), times the site's daily TMY factor (cloudy and
  // clear days, sites.js dailySolarFactor), then scaled to the annual yield
  // with every hour capped at nameplate (Calc.scaleRawSeriesToEnergy).
  const geometry = SolarGeometry.annualHourlyPlaneOfArray(site.lat, state.mountingType, Calc.getMountingSkyOptions(state.mountingType, sky));
  const shift = Math.round(-(site.lon - 15 * site.utcOffsetHours) / 15);
  const dailyFactor = site.dailySolarFactor ? site.dailySolarFactor.flat() : null;
  const raw = new Float64Array(HOURS_PER_YEAR);
  for (let h = 0; h < HOURS_PER_YEAR; h++) {
    raw[h] = (geometry.hourly[(h - shift + HOURS_PER_YEAR) % HOURS_PER_YEAR] || 0) * (dailyFactor ? dailyFactor[Math.floor(h / 24)] : 1);
  }
  const series = Calc.scaleRawSeriesToEnergy(raw, targetKWh, peakKW);
  const hourlyKW = Float64Array.from(series.hourlyKW);
  const totalKWh = series.totalKWh;
  const annualMWh = totalKWh / 1000;
  const result = {
    enabled: true,
    sizeMWdc,
    model,
    yieldMultiplier,
    siteYield: annualMWh / sizeMWdc,
    annualMWh,
    capacityFactor: annualMWh / (sizeMWdc * HOURS_PER_YEAR),
    hourlyKW,
    localTimeShiftHours: shift,
    dailyVariability: Boolean(dailyFactor),
    reachable: series.reachable,
  };
  if (solarCache.size >= 16) solarCache.delete(solarCache.keys().next().value);
  solarCache.set(key, result);
  return result;
}

/* ---------- Grid ---------- */

/*
 * Hours a flexible connection is unavailable: contiguous events of E hours
 * (E = max(flexibleEventHours, ceil(N / 365))) on the days whose best E-hour
 * window carries the most facility load, highest first (ties: earlier day
 * and hour), until N hours are taken. With typical-day climate these are
 * the hottest afternoons of the hottest month: a heat-wave curtailment.
 * Days with an hour in `excluded` (the utility outages) are skipped, so
 * curtailments add to outages instead of overlapping them; only if every
 * other day is taken do the remaining hours fill the first free hours.
 */
export function selectFlexibleOutageHours(loadKW, hours, excluded = null) {
  const unavailable = new Uint8Array(HOURS_PER_YEAR);
  const events = [];
  const free = HOURS_PER_YEAR - (excluded ? excluded.reduce((sum, value) => sum + (value ? 1 : 0), 0) : 0);
  const target = Math.max(0, Math.min(free, Math.round(hours)));
  if (!target) return { unavailable, events };
  const eventHours = Math.min(24, Math.max(A.flexibleEventHours, Math.ceil(target / 365)));
  const days = [];
  for (let day = 0; day < 365; day++) {
    if (excluded && excluded.subarray(day * 24, day * 24 + 24).some(Boolean)) continue;
    let best = -Infinity;
    let bestStart = 0;
    for (let start = 0; start + eventHours <= 24; start++) {
      let sum = 0;
      for (let k = 0; k < eventHours; k++) sum += loadKW[day * 24 + start + k];
      if (sum > best + 1e-9) {
        best = sum;
        bestStart = start;
      }
    }
    days.push({ day, start: bestStart, sum: best });
  }
  days.sort((a, b) => (b.sum - a.sum) || (a.day - b.day));
  let remaining = target;
  for (const { day, start } of days) {
    if (remaining <= 0) break;
    const length = Math.min(eventHours, remaining);
    const startHour = day * 24 + start;
    unavailable.fill(1, startHour, startHour + length);
    events.push({ startHour, hours: length, kind: 'curtailment' });
    remaining -= length;
  }
  for (let h = 0; h < HOURS_PER_YEAR && remaining > 0; h++) {
    if (unavailable[h] || excluded?.[h]) continue;
    unavailable[h] = 1;
    events.push({ startHour: h, hours: 1, kind: 'curtailment' });
    remaining -= 1;
  }
  events.sort((a, b) => a.startHour - b.startHour);
  return { unavailable, events };
}

/*
 * Utility outage hours of any grid connection (firm service included):
 * n = ceil(N / gridOutageEventHours) events of gridOutageEventHours (the
 * last one shorter), event k on day gridOutageStartDayOfYear +
 * floor(k x 365 / n) (wrapping) from gridOutageStartHour local standard
 * time: deterministic, documented hours (model-assumptions.js), not random
 * draws.
 */
export function selectGridOutageHours(hours) {
  const unavailable = new Uint8Array(HOURS_PER_YEAR);
  const events = [];
  const target = Math.max(0, Math.min(HOURS_PER_YEAR, Math.round(hours)));
  if (!target) return { unavailable, events };
  const eventHours = Math.max(A.gridOutageEventHours, Math.ceil(target / 365));
  const count = Math.ceil(target / eventHours);
  let remaining = target;
  for (let k = 0; k < count; k++) {
    const day = (A.gridOutageStartDayOfYear + Math.floor((k * 365) / count)) % 365;
    const length = Math.min(eventHours, remaining);
    // Long events (N > 3 x 365 h) start earlier so they stay within the day.
    const startHour = day * 24 + Math.min(A.gridOutageStartHour, 24 - length);
    unavailable.fill(1, startHour, startHour + length);
    events.push({ startHour, hours: length, kind: 'outage' });
    remaining -= length;
  }
  events.sort((a, b) => a.startHour - b.startHour);
  return { unavailable, events };
}

/**
 * Grid supply: { connected, connection, capKW, available (Uint8Array 1/0
 * per hour, null when not connected), unavailableHours (outages +
 * curtailments), outageHours, curtailmentHours, events [{ startHour,
 * hours, kind: 'outage' | 'curtailment' }] }. Import cap 0 = the design
 * facility peak. Every connection has the utility outages
 * (firmGridOutageHoursPerYear); a flexible one is also curtailed for
 * gridUnavailableHoursPerYear on other days.
 */
export function buildGridSupply(state, loadKW, designPeakKW) {
  const connected = state.architecture !== 'islanded';
  if (!connected) {
    return { connected: false, connection: null, capKW: 0, available: null, unavailableHours: HOURS_PER_YEAR, outageHours: 0, curtailmentHours: 0, events: [] };
  }
  const capKW = state.gridImportCapMW > 0 ? state.gridImportCapMW * 1000 : designPeakKW;
  const outages = selectGridOutageHours(state.firmGridOutageHoursPerYear);
  const curtailments = state.gridConnection === 'flexible'
    ? selectFlexibleOutageHours(loadKW, state.gridUnavailableHoursPerYear, outages.unavailable)
    : { unavailable: new Uint8Array(HOURS_PER_YEAR), events: [] };
  const available = new Uint8Array(HOURS_PER_YEAR);
  let outageHours = 0;
  let curtailmentHours = 0;
  for (let h = 0; h < HOURS_PER_YEAR; h++) {
    available[h] = outages.unavailable[h] || curtailments.unavailable[h] ? 0 : 1;
    outageHours += outages.unavailable[h];
    curtailmentHours += curtailments.unavailable[h] && !outages.unavailable[h] ? 1 : 0;
  }
  const events = [...outages.events, ...curtailments.events].sort((a, b) => a.startHour - b.startHour);
  return {
    connected, connection: state.gridConnection, capKW, available,
    unavailableHours: outageHours + curtailmentHours, outageHours, curtailmentHours, events,
  };
}

/* ---------- Firm generation ---------- */

/*
 * Units out of service per hour: each of `units` units is out for
 * `outageHours` consecutive hours, unit k starting `k x outageHours` after
 * `startHour` (wrapping around the year), so units are maintained one after
 * another and only overlap when units x outageHours > 8760.
 */
export function buildOutageCounts(units, outageHours, startHour) {
  const counts = new Uint16Array(HOURS_PER_YEAR);
  const length = Math.max(0, Math.min(HOURS_PER_YEAR, Math.round(outageHours)));
  if (!length) return counts;
  for (let unit = 0; unit < units; unit++) {
    const first = startHour + unit * length;
    for (let k = 0; k < length; k++) counts[(first + k) % HOURS_PER_YEAR] += 1;
  }
  return counts;
}

const EMPTY_FIRM = Object.freeze({
  family: 'none', type: null, typeData: null, label: 'None', units: 0, unitSizeMW: 0, capacityMW: 0, mustTake: false,
  availableKW: null, outageHoursPerUnit: 0, availabilityFraction: 0, heatRate: 0, partLoad: null, marginalCostPerMWh: Infinity,
  onSite: false, sizing: 'none',
});

/**
 * Firm generation: { family, type, typeData (power.js entry), label, units,
 * (gas 'auto': autoBaseUnits, the count firm-sizing.js finds for the uptime
 * target, + spare units),
 * unitSizeMW, capacityMW, mustTake (nuclear runs as baseload), availableKW
 * (8760), outageHoursPerUnit, availabilityFraction, heatRate (gas, HHV
 * MMBtu/MWh), partLoad, marginalCostPerMWh (gas: fuel x heat rate + VOM),
 * onSite (false for an existing plant under contract), sizing }.
 */
export function buildFirmSupply(state, { meanLoadKW, autoBaseUnits = 0 }) {
  const family = state.firmFamily;
  if (family === 'gas') {
    const typeData = GAS_GENSET_TYPES[state.gasType];
    const unitSizeMW = state.gasUnitSizeMW;
    // 'auto': the units the uptime target needs (firm-sizing.js) plus the
    // spare units, which only come with a plant (none when no unit is needed).
    const units = state.firmSizingMode === 'manual'
      ? state.firmUnits
      : autoBaseUnits + (autoBaseUnits > 0 ? state.firmSpareUnits : 0);
    const availabilityFraction = state.gasAvailabilityPercent / 100;
    const outageHoursPerUnit = (1 - availabilityFraction) * HOURS_PER_YEAR;
    const counts = buildOutageCounts(units, outageHoursPerUnit, A.gasOutageStartDayOfYear * 24);
    const availableKW = new Float64Array(HOURS_PER_YEAR);
    for (let h = 0; h < HOURS_PER_YEAR; h++) availableKW[h] = Math.max(0, units - counts[h]) * unitSizeMW * 1000;
    return {
      family, type: state.gasType, typeData, label: typeData.label, units, unitSizeMW, capacityMW: units * unitSizeMW,
      mustTake: false, availableKW, outageHoursPerUnit, availabilityFraction,
      heatRate: state.gasHeatRateMMBtuPerMWh, partLoad: typeData.partLoad,
      marginalCostPerMWh: state.gasHeatRateMMBtuPerMWh * state.gasFuelPricePerMMBtu + state.gasVariableOmPerMWh,
      onSite: true, sizing: state.firmSizingMode,
    };
  }
  if (family === 'nuclear') {
    const typeData = NUCLEAR_TYPES[state.nuclearType];
    const contracted = state.nuclearType === 'contracted-existing';
    let units;
    let unitSizeMW;
    if (state.firmSizingMode === 'manual') {
      units = state.firmUnits;
      unitSizeMW = state.nuclearUnitSizeMW;
    } else if (contracted) {
      // A contract for the average facility load.
      units = 1;
      unitSizeMW = meanLoadKW / 1000;
    } else {
      unitSizeMW = state.nuclearUnitSizeMW;
      units = Math.max(1, Math.ceil(meanLoadKW / 1000 / unitSizeMW - 1e-9));
    }
    const availabilityFraction = state.nuclearCapacityFactorPercent / 100;
    const outageHoursPerUnit = (1 - availabilityFraction) * HOURS_PER_YEAR;
    const counts = buildOutageCounts(units, outageHoursPerUnit, A.nuclearOutageStartDayOfYear * 24);
    const availableKW = new Float64Array(HOURS_PER_YEAR);
    for (let h = 0; h < HOURS_PER_YEAR; h++) availableKW[h] = Math.max(0, units - counts[h]) * unitSizeMW * 1000;
    return {
      family, type: state.nuclearType, typeData, label: typeData.label, units, unitSizeMW, capacityMW: units * unitSizeMW,
      mustTake: true, availableKW, outageHoursPerUnit, availabilityFraction, heatRate: 0, partLoad: null,
      marginalCostPerMWh: contracted ? state.nuclearPpaPricePerMWh : state.nuclearFuelPerMWh + state.nuclearVariableOmPerMWh,
      onSite: !contracted, sizing: state.firmSizingMode,
    };
  }
  return { ...EMPTY_FIRM };
}

/*
 * Gas fuel (MMBtu) for one hour of `genKW` from a plant of identical units:
 * the plant commits the fewest units that can carry the output and shares
 * it equally; each unit's heat rate rises linearly from the full-load value
 * to (1 + heatRatePenaltyAt50Percent) at 50% load (extrapolated below,
 * floored at the minimum stable load), per power.js partLoad.
 */
export function gasFuelMMBtu(genKW, firm) {
  if (!(genKW > 0)) return 0;
  const unitKW = firm.unitSizeMW * 1000;
  const committed = Math.max(1, Math.ceil(genKW / unitKW - 1e-9));
  const loading = Math.max(genKW / (committed * unitKW), (firm.partLoad?.minStableLoadPercent || 0) / 100);
  const penalty = (firm.partLoad?.heatRatePenaltyAt50Percent || 0) * Math.max(0, (1 - loading) / 0.5);
  return (genKW / 1000) * firm.heatRate * (1 + penalty);
}
