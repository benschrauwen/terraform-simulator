/* ============================================
   Datacenter scenario: the single entry point
   ============================================
   calculateDatacenterScenario(state, { fastMode }) normalizes the state and
   runs the pipeline:

     normalizeDatacenterState -> site + cooling profile (PUE/WUE per hour)
       -> facility load = IT x utilization x PUE(h)
       -> supply (solar series, grid availability, firm generation units;
          'auto' gas = the fewest units meeting the uptime target, firm-sizing.js)
       -> hourly dispatch (settled battery) -> facility energy split
       -> emissions, water, heat, flows, footprint
       -> schedule (critical path, energization) -> economics -> warnings

   fastMode skips the hourly / typical-day display series and reuses a
   cached dispatch when only prices or costs changed (tornado, break-even).

   Result shape (units in the key names; MWh are per year):
   {
     state,                      normalized datacenter state
     site,                       sites.js preset (name, lat, lon, climate, grid region, ...)
     cooling: { technology, label, annualPue, peakPue, wueLPerKWhIT,
                monthlyPue[12], pueTable[12][24], wueTable[12][24] },
     load: { itCapacityMW, itLoadMW (average), itLoadFraction (average IT draw / nameplate), meanFacilityMW,
             peakFacilityMW (dispatch year), designPeakMW (IT nameplate x peak PUE) },
     solar: { enabled, sizeMWdc, annualMWh, capacityFactor, siteYield, yieldMultiplier, areaM2, acres, lcoe,
              dailyVariability (TMY day-to-day factor applied), reachable },
     grid: { connected, connection, importCapMW, unavailableHours (outages + curtailments), outageHours,
             curtailmentHours, events[{ startHour, hours, kind: 'outage' | 'curtailment' }] },
     gpu: { enabled (revenueBasis 'gpu-rental'), platform, label, count (fractional), itKWPerGpu,
            capexPerGpu, rentalPricePerHour, occupancyPercent, priceDeclinePercentPerYear, lifeYears,
            itLoadFraction, marketIndex, ownerTcoPerGpuHour, gpuHoursSoldPerYear },
     firm: { family, type, label, units, unitSizeMW, capacityMW, mustTake, onSite,
             availabilityFraction, outageHoursPerUnit, marginalCostPerMWh, sizing,
             requiredMW (gas: firm MW the uptime target needs, every unit available),
             sizingBasis (gas, firm-sizing.js: { method, minUnits (before spares), spareUnits,
               reachable, allowedUnservedHours, hoursShortWithoutFirm, requiredMW, maxShortfallMW,
               hoursCoveredByFirm, unservedHoursWithFirm }; null for nuclear, or manual gas in fast mode) },
     dispatch: {
       order ('grid-first' | 'firm-first'), batteryRole ('shift' | 'reserve' | 'none'),
       annual: { loadMWh, servedMWh, solarMWh, nuclearMWh, gridMWh, gasMWh,
                 batteryDischargeMWh, batteryChargeMWh, exportMWh, curtailedMWh, unservedMWh,
                 solarToLoadMWh, nuclearToLoadMWh, gridToLoadMWh, gasToLoadMWh,
                 gridToBatteryMWh, gasToBatteryMWh, fuelMMBtu, gasRunHours, gridImportHours,
                 peakGridMW, monthlyPeakGridMW[12], peakExportMW,
                 sharesOfServed: { solar, nuclear, grid, gas, battery } },
       battery: { capacityMWh, powerMW, equivalentFullCyclesPerYear, lifetimeYears,
                  startSocMWh, endSocMWh, lossesMWh },
       hourly (full mode only): { loadMW, itMW, solarMW, nuclearMW, gridMW, gasMW,
                 batteryDischargeMW, batteryChargeMW, exportMW, curtailedMW, unservedMW,
                 batterySocMWh, pue, dryBulbC }  Float64Array(8760), local standard time,
       typicalDays (full mode only): { <same keys>: { byMonth[12][24], average[24] } },
     },
     reliability: { uptimePercent (hours fully served), servedEnergyPercent, unservedHours,
                    unservedMWh, maxUnservedMW, longestOutageHours, targetPercent, meetsTarget },
     energy: { itDemandMWh, itServedMWh, coolingMWh, electricalLossesMWh, facilityServedMWh },
     emissions: { gridT, gasT, totalT, kgPerMWhServed, gridCo2KgPerMWh, gasCo2KgPerMMBtu },
     water: { withdrawnM3, evaporatedM3, dischargedM3, wueLPerKWhIT,
              cooling|gas|nuclear: { withdrawnM3, evaporatedM3, dischargedM3 } },
     heat: { itMWh, coolingPowerMWh, electricalLossesMWh, facilityMWh, latentMWh, sensibleMWh,
             gasWasteMWh, nuclearWasteMWh, batteryLossesMWh, reuse: { supplyTempC, potentialMWh, note } },
     flows: { labels{id: label}, electricity[], heat[], water[], co2[]: { from, to, value, unit }, unservedMWh },
     footprint: { areasM2: { building, coolingYard, solarField, battery, gasPlant, nuclearPlant,
                  substation, utilitySwitchyard (0 islanded) }, totalM2, totalAcres, referenceSiteAcresExclSolar, nuclearExclusionZone },
     schedule: { case, scale, noticeToProceed, energizationMonth, energizationYears, energizationDate
                 { year, month, label }, criticalPath { id, label, durationMonths },
                 paths[{ id, label, required, phases{ permittingMonths, procurementMonths,
                 constructionMonths }, waitForCodMonths, durationMonths, slackMonths, critical, finish }] },
     economics: plant-builder shape (npv, irr, projectIrrAnalysis, mirr, paybackYears,
                 sustainedPaybackYears, roi, yearlyCashFlows[], cashFlowTimeline, financing,
                 capexItems[{ key, label, capex, group, paidAtYear, parts? }], totalCapex,
                 netCapexAtClose, annualOM, revenue{ gpuRental, tokens, colocation, powerPassThrough,
                 export, policyCredits } (full year; GPU rental at the new-GPU price), yearlyCashFlows[]
                 also carry operatingFraction, rentalPriceFactor (average over the operating time),
                 gpuHoursSold, deferredCapexOutflow, totalAnnualRevenue, levelizedAnnualCost, levelizedAnnualProfit,
                 discountRatePercent) plus opexLines[], fixedOmLines[], deferredCapex{ year, atYears, total,
                 byYear[{ year, total }], items }, energizationYears, annualGpuHoursSold, totalGpuHoursSold,
                 annualTokensM, levelized{ costOfPowerPerMWh,
                 costPerMWhIT, costPerMToken, costPerGpuHour, revenuePerMWhIT }, breakEven{ paramKey, label, unit, currentPrice,
                 breakEvenPrice, npvPerUnitPrice, ratioToCurrent },
     warnings: [{ key, message }],
   }
   Pure; no DOM. */

import { COOLING_TECHNOLOGIES } from '../../data/datacenter/cooling.js';
import { getBatteryCapexAndLife, getBatteryPowerKW } from '../battery.js';
import { getDatacenterSite, normalizeDatacenterState } from '../../state/datacenter-schema.js';
import { buildCoolingProfile, HOURS_PER_YEAR, MONTH_OF_HOUR, MONTH_DAYS, typicalDays } from './climate.js';
import { dispatchYear, getDispatchOrder } from './dispatch.js';
import { calculateDatacenterEconomics } from './economics.js';
import {
  buildFlows,
  calculateEmissions,
  calculateFootprint,
  calculateHeat,
  calculateWater,
  getSubstationKW,
  splitFacilityEnergy,
} from './impacts.js';
import { getGpuFleet, getItLoadFraction } from './gpu.js';
import { buildSchedule } from './schedule.js';
import { sizeGasForUptime } from './firm-sizing.js';
import { buildFirmSupply, buildGridSupply, buildSolarSupply } from './supply.js';
import { buildWarnings } from './warnings.js';

const coolingCache = new Map();
function getCoolingProfile(site, tech) {
  const key = `${site.id}|${tech.id}`;
  if (!coolingCache.has(key)) coolingCache.set(key, buildCoolingProfile(site, tech));
  return coolingCache.get(key);
}

// State fields the hourly dispatch depends on besides the firm unit count
// (prices and costs excluded, except through the hybrid merit order, which
// is part of the key). The dispatch cache adds the resolved unit count; the
// gas sizing cache (firm-sizing.js) adds nothing, its result being the count.
const SUPPLY_KEYS = [
  'siteId', 'itCapacityMW', 'itUtilizationPercent', 'revenueBasis', 'gpuOccupancyPercent', 'coolingTechnology', 'architecture', 'gridConnection', 'gridImportCapMW',
  'gridUnavailableHoursPerYear', 'firmGridOutageHoursPerYear', 'gridExportEnabled', 'solarSizeMWdc', 'mountingType', 'siteYieldMwhPerMwdcYear',
  'batteryCapacityMWh', 'batteryDurationHours', 'batteryEfficiency', 'firmFamily', 'uptimeTargetPercent',
  'gasType', 'gasUnitSizeMW', 'gasHeatRateMMBtuPerMWh', 'gasAvailabilityPercent',
  'nuclearType', 'nuclearUnitSizeMW', 'nuclearCapacityFactorPercent', 'firmSizingMode',
];
const dispatchCache = new Map();

const toMW = series => Float64Array.from(series, value => value / 1000);

function monthlyMeans(series) {
  const sums = new Array(12).fill(0);
  for (let h = 0; h < HOURS_PER_YEAR; h++) sums[MONTH_OF_HOUR[h]] += series[h];
  return sums.map((sum, month) => sum / (MONTH_DAYS[month] * 24));
}

/** Full datacenter scenario; see the header for the result shape. */
export function calculateDatacenterScenario(rawState, { fastMode = false } = {}) {
  const state = normalizeDatacenterState(rawState);
  const site = getDatacenterSite(state.siteId);
  const tech = COOLING_TECHNOLOGIES[state.coolingTechnology];
  const cooling = getCoolingProfile(site, tech);

  // Average IT draw: utilization, or (GPU rental) the occupancy-driven draw.
  const itLoadFraction = getItLoadFraction(state);
  const itKW = state.itCapacityMW * 1000 * itLoadFraction;
  const loadKW = new Float64Array(HOURS_PER_YEAR);
  let peakLoadKW = 0;
  for (let h = 0; h < HOURS_PER_YEAR; h++) {
    loadKW[h] = itKW * cooling.pue[h];
    if (loadKW[h] > peakLoadKW) peakLoadKW = loadKW[h];
  }
  // Infrastructure (grid connection, substation, auto-sized gas) is sized
  // for the IT nameplate at the hottest hour's PUE.
  const designPeakKW = state.itCapacityMW * 1000 * cooling.peakPue;
  const meanLoadKW = itKW * cooling.meanPue;

  const solar = buildSolarSupply(state, site);
  const grid = buildGridSupply(state, loadKW, designPeakKW);
  const exportAllowed = state.gridExportEnabled && grid.connected;
  // Gas sized for the uptime target ('auto'), or (full mode) what the
  // target would need next to a manual count; firm-sizing.js.
  let firm = buildFirmSupply(state, { meanLoadKW });
  const order = getDispatchOrder(state, firm);
  const autoGas = firm.family === 'gas' && state.firmSizingMode === 'auto';
  let sizing = null;
  if (firm.family === 'gas' && (autoGas || !fastMode)) {
    const key = JSON.stringify([...SUPPLY_KEYS.map(k => state[k]), order]);
    sizing = sizeGasForUptime(state, { loadKW, solar, grid, firm, order, exportAllowed, key });
    if (autoGas) firm = buildFirmSupply(state, { meanLoadKW, autoBaseUnits: sizing.minUnits });
  }
  const dispatchInputs = {
    loadKW, solarKW: solar.hourlyKW, solar, firm, grid, batteryState: state, order, exportAllowed,
  };
  let run;
  if (fastMode) {
    const key = JSON.stringify([...SUPPLY_KEYS.map(k => state[k]), firm.units, order]);
    run = dispatchCache.get(key);
    if (!run) {
      run = dispatchYear(dispatchInputs);
      if (dispatchCache.size >= 16) dispatchCache.delete(dispatchCache.keys().next().value);
      dispatchCache.set(key, run);
    }
  } else {
    run = dispatchYear(dispatchInputs, { capture: true });
  }
  const { totals } = run;

  const capacityKWh = state.batteryCapacityMWh * 1000;
  const efc = capacityKWh > 0 ? run.battery.dischargeThroughputKWh / capacityKWh : 0;
  const batteryCost = getBatteryCapexAndLife(state, efc);
  const batteryLossesKWh = totals.batteryChargeKWh - totals.batteryDischargeKWh - (run.battery.endSocKWh - run.battery.startSocKWh);

  const energy = splitFacilityEnergy({ itKW, cooling, tech, loadKW, unservedKW: run.unservedKW });
  const emissions = calculateEmissions(state, totals, energy.facilityServedKWh);
  const water = calculateWater(state, { tech, energy, totals, firm });
  const heat = calculateHeat({ tech, energy, water, totals, firm, batteryLossesKWh });
  const flows = buildFlows({ totals, energy, water, heat, emissions, batteryLossesKWh });
  const substationKW = getSubstationKW(designPeakKW, totals);
  const footprint = calculateFootprint(state, { tech, solar, firm, substationKW, gridCapKW: grid.connected ? grid.capKW : 0 });
  const schedule = buildSchedule(state, { firm, solarEnabled: solar.enabled });
  const economics = calculateDatacenterEconomics(state, {
    energy, totals, monthlyPeakGridKW: run.monthlyPeakGridKW, water, firm, solar,
    battery: batteryCost, gridCapKW: grid.capKW, substationKW, gridConnected: grid.connected, schedule,
  });

  const mwh = kWh => kWh / 1000;
  const served = totals.loadKWh - totals.unservedKWh;
  const share = kWh => (served > 0 ? kWh / served : 0);
  const gridToLoadKWh = totals.gridKWh - totals.gridToBatteryKWh;
  const gasToLoadKWh = totals.gasKWh - totals.gasToBatteryKWh;
  const dispatch = {
    order,
    batteryRole: run.role,
    annual: {
      loadMWh: mwh(totals.loadKWh),
      servedMWh: mwh(served),
      solarMWh: mwh(totals.solarKWh),
      nuclearMWh: mwh(totals.nuclearKWh),
      gridMWh: mwh(totals.gridKWh),
      gasMWh: mwh(totals.gasKWh),
      batteryDischargeMWh: mwh(totals.batteryDischargeKWh),
      batteryChargeMWh: mwh(totals.batteryChargeKWh),
      exportMWh: mwh(totals.exportKWh),
      curtailedMWh: mwh(totals.curtailedKWh),
      unservedMWh: mwh(totals.unservedKWh),
      solarToLoadMWh: mwh(totals.solarToLoadKWh),
      nuclearToLoadMWh: mwh(totals.nuclearToLoadKWh),
      gridToLoadMWh: mwh(gridToLoadKWh),
      gasToLoadMWh: mwh(gasToLoadKWh),
      gridToBatteryMWh: mwh(totals.gridToBatteryKWh),
      gasToBatteryMWh: mwh(totals.gasToBatteryKWh),
      fuelMMBtu: totals.fuelMMBtu,
      gasRunHours: totals.gasRunHours,
      gridImportHours: totals.gridImportHours,
      peakGridMW: mwh(totals.peakGridKW),
      monthlyPeakGridMW: run.monthlyPeakGridKW.map(mwh),
      peakExportMW: mwh(totals.peakExportKW),
      sharesOfServed: {
        solar: share(totals.solarToLoadKWh),
        nuclear: share(totals.nuclearToLoadKWh),
        grid: share(gridToLoadKWh),
        gas: share(gasToLoadKWh),
        battery: share(totals.batteryDischargeKWh),
      },
    },
    battery: {
      capacityMWh: state.batteryCapacityMWh,
      powerMW: getBatteryPowerKW(state) / 1000,
      equivalentFullCyclesPerYear: efc,
      lifetimeYears: batteryCost.lifetimeYears,
      startSocMWh: mwh(run.battery.startSocKWh),
      endSocMWh: mwh(run.battery.endSocKWh),
      lossesMWh: mwh(batteryLossesKWh),
    },
  };
  if (!fastMode && run.series) {
    const s = run.series;
    const itSeries = new Float64Array(HOURS_PER_YEAR).fill(itKW);
    for (let h = 0; h < HOURS_PER_YEAR; h++) {
      if (loadKW[h] > 0) itSeries[h] = itKW * (1 - run.unservedKW[h] / loadKW[h]);
    }
    dispatch.hourly = {
      loadMW: toMW(loadKW),
      itMW: toMW(itSeries),
      solarMW: toMW(s.solarKW),
      nuclearMW: toMW(s.nuclearKW),
      gridMW: toMW(s.gridKW),
      gasMW: toMW(s.gasKW),
      batteryDischargeMW: toMW(s.batteryDischargeKW),
      batteryChargeMW: toMW(s.batteryChargeKW),
      exportMW: toMW(s.exportKW),
      curtailedMW: toMW(s.curtailedKW),
      unservedMW: toMW(run.unservedKW),
      batterySocMWh: toMW(s.socKWh),
      pue: Float64Array.from(cooling.pue),
      dryBulbC: Float64Array.from(cooling.dryBulbC),
    };
    dispatch.typicalDays = Object.fromEntries(Object.entries(dispatch.hourly).map(([key, series]) => [key, typicalDays(series)]));
  }

  const reliability = {
    uptimePercent: (totals.servedHours / HOURS_PER_YEAR) * 100,
    servedEnergyPercent: totals.loadKWh > 0 ? (served / totals.loadKWh) * 100 : 100,
    unservedHours: totals.unservedHours,
    unservedMWh: mwh(totals.unservedKWh),
    maxUnservedMW: mwh(totals.maxUnservedKW),
    longestOutageHours: totals.longestUnservedStreakHours,
    targetPercent: state.uptimeTargetPercent,
  };
  reliability.meetsTarget = reliability.uptimePercent >= state.uptimeTargetPercent - 1e-9;

  const result = {
    state,
    site,
    cooling: {
      technology: tech.id,
      label: tech.label,
      annualPue: cooling.meanPue,
      peakPue: cooling.peakPue,
      wueLPerKWhIT: water.wueLPerKWhIT,
      monthlyPue: monthlyMeans(cooling.pue),
      pueTable: cooling.pueTable,
      wueTable: cooling.wueTable,
    },
    load: {
      itCapacityMW: state.itCapacityMW,
      itLoadMW: itKW / 1000,
      itLoadFraction,
      meanFacilityMW: meanLoadKW / 1000,
      peakFacilityMW: peakLoadKW / 1000,
      designPeakMW: designPeakKW / 1000,
    },
    solar: {
      enabled: solar.enabled,
      sizeMWdc: solar.sizeMWdc,
      annualMWh: solar.annualMWh,
      capacityFactor: solar.capacityFactor,
      siteYield: solar.siteYield,
      yieldMultiplier: solar.yieldMultiplier,
      areaM2: solar.model?.landAreaM2 || 0,
      acres: solar.model?.acres || 0,
      lcoe: solar.model?.lcoe || 0,
      dailyVariability: Boolean(solar.dailyVariability),
      reachable: solar.reachable,
    },
    grid: {
      connected: grid.connected,
      connection: grid.connection,
      importCapMW: grid.capKW / 1000,
      unavailableHours: grid.connected ? grid.unavailableHours : HOURS_PER_YEAR,
      outageHours: grid.outageHours,
      curtailmentHours: grid.curtailmentHours,
      events: grid.events,
    },
    firm: {
      family: firm.family,
      type: firm.type,
      label: firm.label,
      units: firm.units,
      unitSizeMW: firm.unitSizeMW,
      capacityMW: firm.capacityMW,
      mustTake: firm.mustTake,
      onSite: firm.onSite,
      availabilityFraction: firm.availabilityFraction,
      outageHoursPerUnit: firm.outageHoursPerUnit,
      marginalCostPerMWh: firm.marginalCostPerMWh,
      sizing: firm.sizing,
      // Gas: what the uptime target needs (firm-sizing.js); null for nuclear
      // and for a manual gas count in fast mode.
      requiredMW: sizing ? sizing.requiredMW : null,
      sizingBasis: sizing ? {
        ...sizing,
        spareUnits: autoGas ? firm.units - sizing.minUnits : null,
      } : null,
    },
    gpu: { ...getGpuFleet(state), gpuHoursSoldPerYear: economics.annualGpuHoursSold },
    dispatch,
    reliability,
    energy: {
      itDemandMWh: mwh(energy.itDemandKWh),
      itServedMWh: mwh(energy.itServedKWh),
      coolingMWh: mwh(energy.coolingKWh),
      electricalLossesMWh: mwh(energy.overheadKWh),
      facilityServedMWh: mwh(energy.facilityServedKWh),
    },
    emissions,
    water,
    heat,
    flows,
    footprint,
    schedule,
    economics,
  };
  result.warnings = buildWarnings(result, { designPeakKW });
  return result;
}
