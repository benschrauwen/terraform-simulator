/* ============================================
   Datacenter energy use, emissions, water, heat, flows and footprint
   ============================================
   Post-processing of a settled dispatch:
   - facility energy split into IT, cooling and electrical overhead, served
     share only (an unserved hour sheds IT, cooling and overhead alike);
   - CO2: grid imports x grid intensity + on-site fuel x its factor:
     natural gas 52.91 kg/MMBtu (EIA, power.js GAS_DEFAULTS), diesel 73.96
     kg/MMBtu (40 CFR 98 Table C-1, DIESEL_DEFAULTS); nuclear, solar and
     batteries emit none here
     (combustion only, like eGRID; no upstream or embodied emissions);
   - water: cooling WUE(h) x served IT energy (withdrawn), split into
     evaporated and blowdown by the technology's shares, plus on-site gas or
     reactor cooling water per MWh generated (power.js);
   - heat: all facility energy leaves as heat; the latent part is the
     evaporated water x 0.678 kWh/L (cooling.js), the rest goes to air;
     gas waste heat = fuel HHV - electricity; on-site reactor waste heat =
     delivered electricity x (1 / efficiency - 1);
   - flows: electricity, heat, water and CO2 as lists of {from, to, value,
     unit} with node labels, for the Sankey views;
   - footprint: building, cooling yard, solar field, battery, firm plant,
     on-site substation and (grid-connected only) the utility switchyard at
     the delivery point, sized for the import cap.
   Pure; no DOM. */

import { SQUARE_METERS_PER_ACRE } from '../../data/assumptions.js';
import { LATENT_HEAT_KWH_PER_LITRE } from '../../data/datacenter/cooling.js';
import { FACILITY_DEFAULTS } from '../../data/datacenter/facility.js';
import { DATACENTER_MODEL_ASSUMPTIONS as A } from '../../data/datacenter/model-assumptions.js';
import { getGensetFuel, GRID_DEFAULTS, ONSITE_SUBSTATION } from '../../data/datacenter/power.js';
import { HOURS_PER_YEAR } from './climate.js';

export const FLOW_NODE_LABELS = Object.freeze({
  solar: 'Solar',
  nuclear: 'Nuclear',
  grid: 'Grid',
  gas: 'Gas generation',
  battery: 'Battery',
  facility: 'Facility',
  it: 'IT equipment',
  cooling: 'Cooling',
  electricalLosses: 'Power distribution losses',
  batteryLosses: 'Battery losses',
  export: 'Export',
  curtailed: 'Curtailed',
  heatRejection: 'Heat rejection',
  air: 'Air (sensible heat)',
  vapour: 'Water vapour (latent heat)',
  waterSupply: 'Water supply',
  coolingPlant: 'Cooling plant',
  gasPlant: 'Gas plant',
  nuclearPlant: 'Reactor cooling',
  evaporated: 'Evaporated',
  discharged: 'Discharged (blowdown)',
  atmosphere: 'Atmosphere',
});

/**
 * Served facility energy by use (kWh/yr) and cooling water (litres/yr):
 * { itDemandKWh, itServedKWh, coolingKWh, overheadKWh, facilityServedKWh,
 *   coolingWaterL }.
 */
export function splitFacilityEnergy({ itKW, cooling, tech, loadKW, unservedKW }) {
  const out = { itDemandKWh: 0, itServedKWh: 0, coolingKWh: 0, overheadKWh: 0, facilityServedKWh: 0, coolingWaterL: 0 };
  for (let h = 0; h < HOURS_PER_YEAR; h++) {
    const served = loadKW[h] > 0 ? 1 - unservedKW[h] / loadKW[h] : 1;
    const it = itKW * served;
    out.itDemandKWh += itKW;
    out.itServedKWh += it;
    out.overheadKWh += it * tech.overheadFraction;
    out.coolingKWh += it * (cooling.pue[h] - 1 - tech.overheadFraction);
    out.facilityServedKWh += loadKW[h] - unservedKW[h];
    out.coolingWaterL += cooling.wue[h] * it;
  }
  return out;
}

/**
 * CO2 in tonnes/yr: { gridT, gasT (on-site fuel: natural gas or diesel),
 * totalT, kgPerMWhServed, gridCo2KgPerMWh, gasCo2KgPerMMBtu (the fuel's
 * factor), fuel (label) }. `firm` gives the fuel (default natural gas).
 */
export function calculateEmissions(state, totals, facilityServedKWh, firm = null) {
  const fuel = getGensetFuel(firm?.family === 'gas' ? firm.typeData : null);
  const gridT = (totals.gridKWh / 1000) * state.gridCo2KgPerMWh / 1000;
  const gasT = totals.fuelMMBtu * fuel.co2KgPerMMBtu / 1000;
  const totalT = gridT + gasT;
  return {
    gridT,
    gasT,
    totalT,
    kgPerMWhServed: facilityServedKWh > 0 ? (totalT * 1000) / (facilityServedKWh / 1000) : 0,
    gridCo2KgPerMWh: state.gridCo2KgPerMWh,
    gasCo2KgPerMMBtu: fuel.co2KgPerMMBtu,
    fuel: fuel.label,
  };
}

/* An on-site reactor backs down instead of curtailing: its fuel, water and
   waste heat follow the energy it actually delivers (load, battery,
   export). An existing plant under contract is paid on all its output. */
export function onSiteNuclearMWh(totals) {
  return Math.max(0, totals.nuclearKWh - totals.nuclearCurtailedKWh) / 1000;
}

/** Water in m3/yr by user (cooling, gas plant, on-site reactor). */
export function calculateWater(state, { tech, energy, totals, firm }) {
  const coolingWithdrawnM3 = energy.coolingWaterL / 1000;
  const cooling = {
    withdrawnM3: coolingWithdrawnM3,
    evaporatedM3: coolingWithdrawnM3 * tech.water.evaporatedShare,
    dischargedM3: coolingWithdrawnM3 * tech.water.blowdownShare,
  };
  const plantWater = (perMWh, mwh) => {
    const withdrawnM3 = (perMWh?.withdrawalLPerMWh || 0) * mwh / 1000;
    const evaporatedM3 = (perMWh?.consumptionLPerMWh || 0) * mwh / 1000;
    return { withdrawnM3, evaporatedM3, dischargedM3: Math.max(0, withdrawnM3 - evaporatedM3) };
  };
  const gas = firm.family === 'gas' ? plantWater(firm.typeData.water, totals.gasKWh / 1000) : plantWater(null, 0);
  const nuclear = firm.family === 'nuclear' && firm.onSite ? plantWater(firm.typeData.water, onSiteNuclearMWh(totals)) : plantWater(null, 0);
  const sum = key => cooling[key] + gas[key] + nuclear[key];
  return {
    cooling,
    gas,
    nuclear,
    withdrawnM3: sum('withdrawnM3'),
    evaporatedM3: sum('evaporatedM3'),
    dischargedM3: sum('dischargedM3'),
    // Green Grid WUE: site cooling water per IT kWh (litres).
    wueLPerKWhIT: energy.itServedKWh > 0 ? energy.coolingWaterL / energy.itServedKWh : 0,
    waterPricePerM3: state.waterPricePerM3,
  };
}

/** Heat in MWh/yr. */
export function calculateHeat({ tech, energy, water, totals, firm, batteryLossesKWh }) {
  const facilityMWh = energy.facilityServedKWh / 1000;
  const latentMWh = Math.min(facilityMWh, water.cooling.evaporatedM3 * 1000 * LATENT_HEAT_KWH_PER_LITRE / 1000);
  const gasWasteMWh = Math.max(0, totals.fuelMMBtu * A.kWhPerMMBtu / 1000 - totals.gasKWh / 1000);
  const efficiency = firm.family === 'nuclear' ? (A.nuclearThermalEfficiency[firm.type] || 0.33) : 1;
  const nuclearWasteMWh = firm.family === 'nuclear' && firm.onSite ? onSiteNuclearMWh(totals) * (1 / efficiency - 1) : 0;
  const nuclearLatentMWh = Math.min(nuclearWasteMWh, water.nuclear.evaporatedM3 * 1000 * LATENT_HEAT_KWH_PER_LITRE / 1000);
  return {
    itMWh: energy.itServedKWh / 1000,
    coolingPowerMWh: energy.coolingKWh / 1000,
    electricalLossesMWh: energy.overheadKWh / 1000,
    facilityMWh,
    latentMWh,
    sensibleMWh: facilityMWh - latentMWh,
    gasWasteMWh,
    nuclearWasteMWh,
    nuclearLatentMWh,
    batteryLossesMWh: Math.max(0, batteryLossesKWh / 1000),
    // Upper bound on reusable heat: all IT heat at the loop's supply
    // temperature (cooling.js heatReuse).
    reuse: { supplyTempC: tech.heatReuse.supplyTempC, potentialMWh: energy.itServedKWh / 1000, note: tech.heatReuse.note },
  };
}

function flow(from, to, value, unit) {
  return { from, to, value, unit };
}

const positive = list => list.filter(entry => entry.value > 1e-9);

/**
 * Flows for the Sankey views: { labels, electricity, heat, water, co2,
 * unservedMWh }. `firm` names the on-site generation node by its fuel
 * (gas or diesel).
 */
export function buildFlows({ totals, energy, water, heat, emissions, batteryLossesKWh, firm = null }) {
  const MWh = 'MWh/yr';
  const m3 = 'm3/yr';
  const mwh = kWh => kWh / 1000;
  const fuel = firm?.family === 'gas' ? getGensetFuel(firm.typeData) : null;
  return {
    labels: fuel && fuel.generationLabel !== FLOW_NODE_LABELS.gas
      ? { ...FLOW_NODE_LABELS, gas: fuel.generationLabel, gasPlant: `${fuel.label} plant` }
      : FLOW_NODE_LABELS,
    electricity: positive([
      flow('solar', 'facility', mwh(totals.solarToLoadKWh), MWh),
      flow('solar', 'battery', mwh(totals.solarToBatteryKWh), MWh),
      flow('solar', 'export', mwh(totals.solarExportKWh), MWh),
      flow('solar', 'curtailed', mwh(totals.solarCurtailedKWh), MWh),
      flow('nuclear', 'facility', mwh(totals.nuclearToLoadKWh), MWh),
      flow('nuclear', 'battery', mwh(totals.nuclearToBatteryKWh), MWh),
      flow('nuclear', 'export', mwh(totals.nuclearExportKWh), MWh),
      flow('nuclear', 'curtailed', mwh(totals.nuclearCurtailedKWh), MWh),
      flow('grid', 'facility', mwh(totals.gridKWh - totals.gridToBatteryKWh), MWh),
      flow('grid', 'battery', mwh(totals.gridToBatteryKWh), MWh),
      flow('gas', 'facility', mwh(totals.gasKWh - totals.gasToBatteryKWh), MWh),
      flow('gas', 'battery', mwh(totals.gasToBatteryKWh), MWh),
      flow('battery', 'facility', mwh(totals.batteryDischargeKWh), MWh),
      flow('battery', 'batteryLosses', mwh(batteryLossesKWh), MWh),
      flow('facility', 'it', mwh(energy.itServedKWh), MWh),
      flow('facility', 'cooling', mwh(energy.coolingKWh), MWh),
      flow('facility', 'electricalLosses', mwh(energy.overheadKWh), MWh),
    ]),
    heat: positive([
      flow('it', 'heatRejection', heat.itMWh, MWh),
      flow('cooling', 'heatRejection', heat.coolingPowerMWh, MWh),
      flow('electricalLosses', 'heatRejection', heat.electricalLossesMWh, MWh),
      flow('heatRejection', 'air', heat.sensibleMWh, MWh),
      flow('heatRejection', 'vapour', heat.latentMWh, MWh),
      flow('gas', 'air', heat.gasWasteMWh, MWh),
      flow('nuclear', 'air', heat.nuclearWasteMWh - heat.nuclearLatentMWh, MWh),
      flow('nuclear', 'vapour', heat.nuclearLatentMWh, MWh),
      flow('battery', 'air', heat.batteryLossesMWh, MWh),
    ]),
    water: positive([
      flow('waterSupply', 'coolingPlant', water.cooling.withdrawnM3, m3),
      flow('coolingPlant', 'evaporated', water.cooling.evaporatedM3, m3),
      flow('coolingPlant', 'discharged', water.cooling.dischargedM3, m3),
      flow('waterSupply', 'gasPlant', water.gas.withdrawnM3, m3),
      flow('gasPlant', 'evaporated', water.gas.evaporatedM3, m3),
      flow('gasPlant', 'discharged', water.gas.dischargedM3, m3),
      flow('waterSupply', 'nuclearPlant', water.nuclear.withdrawnM3, m3),
      flow('nuclearPlant', 'evaporated', water.nuclear.evaporatedM3, m3),
      flow('nuclearPlant', 'discharged', water.nuclear.dischargedM3, m3),
    ]),
    co2: positive([
      flow('grid', 'atmosphere', emissions.gridT, 't/yr'),
      flow('gas', 'atmosphere', emissions.gasT, 't/yr'),
    ]),
    unservedMWh: totals.unservedKWh / 1000,
  };
}

/** HV substation rating (kW): the design facility peak, or peak export if larger. */
export function getSubstationKW(designPeakKW, totals) {
  return Math.max(designPeakKW, totals.peakExportKW || 0);
}

/** Plan areas in m2 (+ acres) of each block, and context notes. gridCapKW: 0 when islanded. */
export function calculateFootprint(state, { tech, solar, firm, substationKW, gridCapKW = 0 }) {
  const itMW = state.itCapacityMW;
  let firmM2 = 0;
  if (firm.family === 'gas') firmM2 = firm.typeData.footprintM2PerMW * firm.capacityMW;
  if (firm.family === 'nuclear' && firm.onSite) firmM2 = (A.nuclearFootprintM2PerMW[firm.type] || 0) * firm.capacityMW;
  const areas = {
    building: FACILITY_DEFAULTS.buildingFootprintM2PerMWIT * itMW,
    coolingYard: tech.footprintM2PerMWIT * itMW,
    solarField: solar.enabled ? solar.model.landAreaM2 : 0,
    battery: state.batteryCapacityMWh * A.batteryFootprintM2PerMWh,
    gasPlant: firm.family === 'gas' ? firmM2 : 0,
    nuclearPlant: firm.family === 'nuclear' ? firmM2 : 0,
    substation: ONSITE_SUBSTATION.footprintM2PerMW * substationKW / 1000,
    utilitySwitchyard: GRID_DEFAULTS.switchyardFootprintM2PerMW * gridCapKW / 1000,
  };
  const totalM2 = Object.values(areas).reduce((sum, value) => sum + value, 0);
  return {
    areasM2: areas,
    totalM2,
    totalAcres: totalM2 / SQUARE_METERS_PER_ACRE,
    // facility.js: fenced site incl. roads and setbacks, excluding solar.
    referenceSiteAcresExclSolar: FACILITY_DEFAULTS.siteAcresPerMWIT * itMW,
    nuclearExclusionZone: firm.family === 'nuclear'
      ? (A.nuclearExclusionZone[firm.type] || A.nuclearExclusionZone.default)
      : null,
  };
}
