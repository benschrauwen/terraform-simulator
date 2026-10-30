/* ============================================
   Datacenter state schema and defaults
   ============================================
   Field definitions (type, range, default) for the Abundance Stack
   datacenter simulator, DATACENTER_DEFAULT_STATE assembled from them and
   normalizeDatacenterState. The state is flat (like the plant builder's) so
   the generic control binding, share-link diff and tornado helpers work on
   it unchanged; field types follow state/schema.js and are normalized by the
   same helper (normalizeCoreStateFields): enums fall back to their default,
   numbers are clamped, booleans must be literally true, unknown keys drop.

   Preset-derived fields. Some defaults depend on a selection: the site sets
   the grid price, grid CO2 and solar yield; the cooling technology its capex
   and O&M; the GPU platform its rental price, IT kW and capex per GPU; the
   mounting the solar cost; the gas and nuclear types their
   unit size, costs, heat rate and availability. Those fields carry
   `derive(state)`. normalizeDatacenterState uses the input value when one is
   given and otherwise derives it from the (normalized) selection, so a share
   link that changes only the site still gets that site's price. When the UI
   changes a selection it should call applyDatacenterPresetDefaults(state,
   key) to reset the dependent fields, and share links should always carry
   DATACENTER_DERIVED_KEYS (a value equal to the default-site value would
   otherwise be dropped from the diff and re-derived for the new site).

   Default scenario (judgment, see each field): a new 100 MW-IT AI datacenter
   at Abilene, TX, liquid-cooled with dry coolers, on a firm grid connection
   at the site's all-in year-to-date industrial price (demand charge 0, so
   it is not counted twice), with standby diesel generators sized for the
   uptime target plus one spare (N+1), renting GB300 NVL72 GPUs by the hour, 8% discount rate over
   20 years. */

import { getSolarCostPresetValues, MOUNTING_TYPES } from '../data/reference-data.js';
import { COOLING_TECHNOLOGIES, DEFAULT_COOLING_TECHNOLOGY } from '../data/datacenter/cooling.js';
import { FACILITY_DEFAULTS } from '../data/datacenter/facility.js';
import { DEFAULT_GPU_PLATFORM, GPU_PLATFORMS, GPU_RENTAL_DEFAULTS } from '../data/datacenter/gpu.js';
import { DATACENTER_MODEL_ASSUMPTIONS } from '../data/datacenter/model-assumptions.js';
import {
  ARCHITECTURE_STARTING_DESIGNS,
  ARCHITECTURES,
  DEFAULT_ARCHITECTURE,
  DEFAULT_GAS_GENSET_TYPE,
  DEFAULT_NUCLEAR_TYPE,
  GAS_GENSET_TYPES,
  getGensetFuel,
  GRID_DEFAULTS,
  NUCLEAR_TYPES,
  ONSITE_SUBSTATION,
} from '../data/datacenter/power.js';
import { DATACENTER_SITES, DEFAULT_DATACENTER_SITE_ID } from '../data/datacenter/sites.js';
import { clampNumber } from '../util.js';
import { normalizeCoreStateFields } from './normalize.js';
import { DEFAULT_STATE } from './schema.js';

// Solar costs reuse the plant builder's SOLAR_COST_PRESETS. The measured
// 2026 build is the conservative basis for a datacenter developer (the
// Terraform target basis is a cost goal); judgment.
export const DATACENTER_SOLAR_COST_PRESET = 'terraform-2026-build';

const SITE_BY_ID = new Map(DATACENTER_SITES.map(site => [site.id, site]));

/** The site preset for an id, falling back to the default site. */
export function getDatacenterSite(siteId) {
  return SITE_BY_ID.get(siteId) || SITE_BY_ID.get(DEFAULT_DATACENTER_SITE_ID);
}

const gasType = state => GAS_GENSET_TYPES[state.gasType] || GAS_GENSET_TYPES[DEFAULT_GAS_GENSET_TYPE];
const nuclearType = state => NUCLEAR_TYPES[state.nuclearType] || NUCLEAR_TYPES[DEFAULT_NUCLEAR_TYPE];
const gpuPlatform = state => GPU_PLATFORMS[state.gpuPlatform] || GPU_PLATFORMS[DEFAULT_GPU_PLATFORM];
const coolingTech = state => COOLING_TECHNOLOGIES[state.coolingTechnology] || COOLING_TECHNOLOGIES[DEFAULT_COOLING_TECHNOLOGY];
const solarCost = state => getSolarCostPresetValues(DATACENTER_SOLAR_COST_PRESET, state.mountingType);

export const DATACENTER_STATE_FIELDS = [
  /* ---------- Site ---------- */
  { key: 'siteId', type: 'enum', getOptions: () => DATACENTER_SITES.map(site => site.id), defaultValue: DEFAULT_DATACENTER_SITE_ID },
  // PVGIS fixed-optimal-tilt yield of the site (MWh/MWdc-yr), the base the
  // mounting multiplier applies to (as in the plant builder).
  { key: 'siteYieldMwhPerMwdcYear', type: 'number', min: 0, max: 3000, derive: state => getDatacenterSite(state.siteId).baseYield },

  /* ---------- Datacenter ---------- */
  // judgment: a mid-size new AI campus phase (Abilene's first two buildings
  // were ~200 MW IT, facility.js).
  { key: 'itCapacityMW', type: 'number', min: 0.1, max: 20000, defaultValue: 100 },
  // Average IT draw / IT nameplate for 'tokens' and 'colocation'; with
  // 'gpu-rental' the draw follows GPU occupancy instead (model/datacenter/gpu.js).
  { key: 'itUtilizationPercent', type: 'number', min: 1, max: 100, defaultValue: FACILITY_DEFAULTS.itUtilization.default * 100 },
  // Legacy Tier III availability (facility.js uptimeTiers); the model
  // reports the achieved supply adequacy against it.
  { key: 'uptimeTargetPercent', type: 'number', min: 90, max: 99.9999, defaultValue: 99.982 },
  { key: 'facilityTier', type: 'enum', options: Object.keys(FACILITY_DEFAULTS.tierCapexMultiplier), defaultValue: FACILITY_DEFAULTS.defaultTier },
  { key: 'facilityCapexPerKWIT', type: 'number', min: 0, max: 50000, defaultValue: FACILITY_DEFAULTS.capexPerKWIT.default },
  { key: 'facilityOmPercent', type: 'number', min: 0, max: 20, defaultValue: FACILITY_DEFAULTS.facilityOmPercentOfCapexPerYear },
  { key: 'facilityAssetLifeYears', type: 'integer', min: 1, max: 60, defaultValue: FACILITY_DEFAULTS.facilityAssetLifeYears },
  { key: 'landCapexPerKWIT', type: 'number', min: 0, max: 10000, defaultValue: FACILITY_DEFAULTS.landCapexPerKWIT },

  /* ---------- Cooling ---------- */
  { key: 'coolingTechnology', type: 'enum', getOptions: () => Object.keys(COOLING_TECHNOLOGIES), defaultValue: DEFAULT_COOLING_TECHNOLOGY },
  { key: 'coolingCapexPerKWIT', type: 'number', min: 0, max: 10000, derive: state => coolingTech(state).capexPerKWIT.default },
  { key: 'coolingOmPercent', type: 'number', min: 0, max: 20, derive: state => coolingTech(state).omPercentOfCapexPerYear },
  { key: 'waterPricePerM3', type: 'number', min: 0, max: 50, defaultValue: FACILITY_DEFAULTS.waterPricePerM3.default },

  /* ---------- IT hardware and revenue ---------- */
  // 'gpu-rental' (default, owner decision): the operator owns the GPUs and
  // rents them by the GPU-hour (data/datacenter/gpu.js). 'tokens': it buys
  // IT at $/kW and sells tokens, using the plant builder's AI defaults.
  // 'colocation': a wholesale lease of powered space; the tenant supplies
  // the IT, so IT capex and IT O&M drop out (facility.js).
  { key: 'revenueBasis', type: 'enum', options: ['gpu-rental', 'tokens', 'colocation'], defaultValue: 'gpu-rental' },

  // GPU rental (revenueBasis 'gpu-rental'). GPUs = IT capacity / IT kW per
  // GPU; IT capex = GPUs x capex per GPU (replaces itCapexPerKW); the
  // average IT draw follows occupancy (itUtilizationPercent is not used).
  { key: 'gpuPlatform', type: 'enum', getOptions: () => Object.keys(GPU_PLATFORMS), defaultValue: DEFAULT_GPU_PLATFORM },
  { key: 'gpuRentalPricePerHour', type: 'number', min: 0, max: 100, derive: state => gpuPlatform(state).rentalPricePerGpuHour },
  { key: 'gpuItKWPerGpu', type: 'number', min: 0.1, max: 20, derive: state => gpuPlatform(state).itKWPerGpu },
  { key: 'gpuCapexPerGpu', type: 'number', min: 0, max: 1e6, derive: state => gpuPlatform(state).capexPerGpu },
  { key: 'gpuOccupancyPercent', type: 'number', min: 0, max: 100, defaultValue: GPU_RENTAL_DEFAULTS.occupancyPercent },
  { key: 'gpuPriceDeclinePercentPerYear', type: 'number', min: 0, max: 90, defaultValue: GPU_RENTAL_DEFAULTS.priceDeclinePercentPerYear },
  { key: 'gpuLifeYears', type: 'integer', min: 1, max: 20, defaultValue: GPU_RENTAL_DEFAULTS.lifeYears },

  // $/kW-IT IT hardware for 'tokens' (gpu-rental prices GPUs per unit).
  { key: 'itCapexPerKW', type: 'number', min: 0, max: 200000, defaultValue: FACILITY_DEFAULTS.itCapexPerKW.default },
  { key: 'itAssetLifeYears', type: 'integer', min: 1, max: 20, defaultValue: FACILITY_DEFAULTS.itAssetLifeYears },
  { key: 'itOmPercent', type: 'number', min: 0, max: 20, defaultValue: FACILITY_DEFAULTS.itOmPercent },
  // When the GPUs are paid for: 'energization' (default, judgment: hardware
  // is ordered to arrive for first power, its own lead time is months, see
  // FACILITY_LEAD_TIMES['it-delivery']) or 'ntp' (with the rest of the
  // capex at notice-to-proceed).
  { key: 'itCapexTiming', type: 'enum', options: ['energization', 'ntp'], defaultValue: 'energization' },
  { key: 'tokenPricePerM', type: 'number', min: 0, max: 100, defaultValue: DEFAULT_STATE.aiTokenPricePerM },
  { key: 'millionTokensPerMWhIT', type: 'number', min: 0, max: 1e6, defaultValue: DATACENTER_MODEL_ASSUMPTIONS.millionTokensPerMWhIT },
  { key: 'colocationLeasePerKWMonth', type: 'number', min: 0, max: 2000, defaultValue: FACILITY_DEFAULTS.colocationLeasePerKWMonth.default },
  // Colocation tenants usually pay for power on top of the lease (facility.js:
  // "tenant supplies IT and pays power"): energy costs are recovered at cost.
  { key: 'colocationPowerPassThrough', type: 'boolean', defaultValue: true },

  /* ---------- Power architecture ---------- */
  { key: 'architecture', type: 'enum', getOptions: () => Object.keys(ARCHITECTURES), defaultValue: DEFAULT_ARCHITECTURE },

  /* ---------- Grid ---------- */
  { key: 'gridConnection', type: 'enum', options: ['firm', 'flexible'], defaultValue: GRID_DEFAULTS.connection },
  // 0 = sized to the design facility peak (IT nameplate x peak PUE).
  { key: 'gridImportCapMW', type: 'number', min: 0, max: 100000, defaultValue: 0 },
  { key: 'gridUnavailableHoursPerYear', type: 'integer', min: 0, max: 8760, defaultValue: GRID_DEFAULTS.flexibleUnavailableHoursPerYear },
  // Utility outages of any connection, firm included (power.js: transmission
  // delivery points ~2.7 h/yr); flexible curtailments come on top.
  { key: 'firmGridOutageHoursPerYear', type: 'integer', min: 0, max: 8760, defaultValue: GRID_DEFAULTS.outageHoursPerYear },
  // The site's EIA year-to-date ALL-IN industrial price (sites.js
  // electricityPriceAltUsdPerMWh), so the demand charge defaults to 0.
  { key: 'gridEnergyPricePerMWh', type: 'number', min: 0, max: 1000, derive: state => getDatacenterSite(state.siteId).electricityPriceAltUsdPerMWh },
  { key: 'gridDemandChargePerKWMonth', type: 'number', min: 0, max: 100, defaultValue: 0 },
  { key: 'gridCo2KgPerMWh', type: 'number', min: 0, max: 2000, derive: state => getDatacenterSite(state.siteId).gridCo2KgPerMWh },
  { key: 'gridExportEnabled', type: 'boolean', defaultValue: GRID_DEFAULTS.exportEnabled },
  { key: 'gridExportPricePerMWh', type: 'number', min: 0, max: 1000, defaultValue: GRID_DEFAULTS.exportPricePerMWh },
  { key: 'gridInterconnectionCapexPerKW', type: 'number', min: 0, max: 5000, defaultValue: GRID_DEFAULTS.interconnectionCapexPerKW },
  { key: 'substationCapexPerKW', type: 'number', min: 0, max: 2000, defaultValue: ONSITE_SUBSTATION.capexPerKW },

  /* ---------- Solar (optional everywhere) ---------- */
  { key: 'solarSizeMWdc', type: 'number', min: 0, max: 100000, defaultValue: 0 },
  // Owner decision: East-West fixed (MOUNTING_TYPES.ew), the dense low-tilt
  // layout of the Terraform plant builder: ~0.92x the fixed-tilt yield but
  // the lowest BOS and ~2.5x the trackers' ground coverage, so a solar field
  // next to a datacenter needs the least land; its two-shoulder daily
  // profile also spreads output over more of the day.
  { key: 'mountingType', type: 'enum', getOptions: () => Object.keys(MOUNTING_TYPES), defaultValue: 'ew' },
  { key: 'panelCostPerW', type: 'number', min: 0, max: 100, derive: state => solarCost(state).panelCostPerW },
  { key: 'bosCostPerW', type: 'number', min: 0, max: 100, derive: state => solarCost(state).bosCostPerW },
  { key: 'panelEfficiency', type: 'number', min: 1, max: 100, defaultValue: DEFAULT_STATE.panelEfficiency },
  { key: 'landCostPerAcre', type: 'number', min: 0, max: 1e9, defaultValue: DEFAULT_STATE.landCostPerAcre },
  { key: 'sitePrepCostPerAcre', type: 'number', min: 0, max: 1e9, defaultValue: DEFAULT_STATE.sitePrepCostPerAcre },
  { key: 'solarAssetLife', type: 'integer', min: 1, max: 100, defaultValue: DEFAULT_STATE.solarAssetLife },
  { key: 'solarOmPercent', type: 'number', min: 0, max: 100, defaultValue: DEFAULT_STATE.solarOmPercent },

  /* ---------- Battery (optional; same fields and defaults as the plant builder) ---------- */
  { key: 'batteryCapacityMWh', type: 'number', min: 0, max: 1e7, defaultValue: 0 },
  { key: 'batteryDurationHours', type: 'number', min: 0.25, max: 24, defaultValue: DEFAULT_STATE.batteryDurationHours },
  { key: 'batteryCostPerKWh', type: 'number', min: 0, max: 5000, defaultValue: DEFAULT_STATE.batteryCostPerKWh },
  { key: 'batteryEfficiency', type: 'number', min: 1, max: 100, defaultValue: DEFAULT_STATE.batteryEfficiency },
  { key: 'batteryCycles', type: 'number', min: 1, max: 1e6, defaultValue: DEFAULT_STATE.batteryCycles },
  { key: 'batteryOmPercent', type: 'number', min: 0, max: 100, defaultValue: DEFAULT_STATE.batteryOmPercent },

  /* ---------- Firm generation: one family at a time ---------- */
  // Default 'gas' family with the standby-diesel type as STANDBY generation:
  // Tier III sites carry on-site standby (facility.js's all-in check adds
  // "HV substation/standby generation ~$2,000-3,500/kW"). On a firm grid it
  // mostly adds capex and fixed O&M; it runs when the grid is short.
  { key: 'firmFamily', type: 'enum', options: ['none', 'gas', 'nuclear'], defaultValue: 'gas' },
  // 'auto': gas = the fewest units with which the hourly dispatch meets the
  // uptime target given the grid, solar and battery (model/datacenter/
  // firm-sizing.js), + spare units when that is at least one; nuclear =
  // enough units for the average facility load (an existing-plant contract
  // is sized to the average load exactly). 'manual': firmUnits x unit size.
  { key: 'firmSizingMode', type: 'enum', options: ['auto', 'manual'], defaultValue: 'auto' },
  // N+1 (power.js GAS_REDUNDANCY_GUIDANCE: backup N+1, islanded N+2).
  { key: 'firmSpareUnits', type: 'integer', min: 0, max: 20, defaultValue: 1 },
  // Manual unit count. 15 = N+1 at the default site's design peak (131 MW /
  // 10 MW engines -> 14, + 1), the former auto rule; kept as the default so
  // older share links with a manual count decode unchanged. The UI seeds it
  // from the current auto count when the user switches to manual.
  { key: 'firmUnits', type: 'integer', min: 0, max: 2000, defaultValue: 15 },

  { key: 'gasType', type: 'enum', getOptions: () => Object.keys(GAS_GENSET_TYPES), defaultValue: DEFAULT_GAS_GENSET_TYPE },
  { key: 'gasUnitSizeMW', type: 'number', min: 0.1, max: 1500, derive: state => gasType(state).unitSizeMW.default },
  { key: 'gasCapexPerKW', type: 'number', min: 0, max: 20000, derive: state => gasType(state).capexPerKW.default },
  { key: 'gasFixedOmPerKWYear', type: 'number', min: 0, max: 1000, derive: state => gasType(state).fixedOmPerKWYear },
  { key: 'gasVariableOmPerMWh', type: 'number', min: 0, max: 500, derive: state => gasType(state).variableOmPerMWh },
  { key: 'gasHeatRateMMBtuPerMWh', type: 'number', min: 3.412, max: 20, derive: state => gasType(state).heatRateMMBtuPerMWh.default },
  { key: 'gasAvailabilityPercent', type: 'number', min: 50, max: 100, derive: state => gasType(state).availabilityPercent },
  // Delivered fuel price ($/MMBtu HHV) of the selected type's fuel: natural
  // gas (GAS_DEFAULTS) or, for standby diesel, diesel (DIESEL_DEFAULTS).
  { key: 'gasFuelPricePerMMBtu', type: 'number', min: 0, max: 100, derive: state => getGensetFuel(gasType(state)).fuelPricePerMMBtu },

  { key: 'nuclearType', type: 'enum', getOptions: () => Object.keys(NUCLEAR_TYPES), defaultValue: DEFAULT_NUCLEAR_TYPE },
  { key: 'nuclearUnitSizeMW', type: 'number', min: 1, max: 2500, derive: state => nuclearType(state).unitSizeMWe.default },
  { key: 'nuclearCapexPerKW', type: 'number', min: 0, max: 50000, derive: state => nuclearType(state).capexPerKW.default },
  { key: 'nuclearFixedOmPerKWYear', type: 'number', min: 0, max: 2000, derive: state => nuclearType(state).fixedOmPerKWYear },
  { key: 'nuclearVariableOmPerMWh', type: 'number', min: 0, max: 500, derive: state => nuclearType(state).variableOmPerMWh },
  { key: 'nuclearFuelPerMWh', type: 'number', min: 0, max: 500, derive: state => nuclearType(state).fuelPerMWh },
  { key: 'nuclearCapacityFactorPercent', type: 'number', min: 50, max: 100, derive: state => nuclearType(state).capacityFactor * 100 },
  // Existing-plant contracts only (no capex); 0 for new builds.
  { key: 'nuclearPpaPricePerMWh', type: 'number', min: 0, max: 1000, derive: state => nuclearType(state).ppaPricePerMWh?.default ?? 0 },

  /* ---------- Schedule ---------- */
  { key: 'scheduleCase', type: 'enum', options: ['low', 'typical', 'high'], defaultValue: 'typical' },
  // Multiplies every lead-time phase (the tornado's "schedule" input).
  { key: 'scheduleScalePercent', type: 'number', min: 25, max: 400, defaultValue: 100 },

  /* ---------- Finance & valuation (as the plant builder) ---------- */
  // UI setting of the tornado (+/- %), kept in share links.
  { key: 'tornadoSwingPercent', type: 'number', min: 1, max: 90, defaultValue: 20 },
  // 20 years from notice-to-proceed = the facility asset life
  // (facility.js); longer-lived assets (substation, gas, nuclear) return
  // their unexpired book value as salvage. judgment.
  { key: 'analysisHorizonYears', type: 'integer', min: 1, max: 60, defaultValue: 20 },
  { key: 'discountRate', type: 'number', min: 0, max: 100, defaultValue: DEFAULT_STATE.discountRate },
  { key: 'financingEnabled', type: 'boolean', defaultValue: false },
  { key: 'debtSharePercent', type: 'number', min: 0, max: 90, defaultValue: DEFAULT_STATE.debtSharePercent },
  { key: 'debtInterestRate', type: 'number', min: 0, max: 100, defaultValue: DEFAULT_STATE.debtInterestRate },
  { key: 'debtTermYears', type: 'integer', min: 1, max: 30, defaultValue: DEFAULT_STATE.debtTermYears },
  { key: 'debtFeePercent', type: 'number', min: 0, max: 100, defaultValue: DEFAULT_STATE.debtFeePercent },
];

const BASE_FIELDS = DATACENTER_STATE_FIELDS.filter(field => typeof field.derive !== 'function');
const DERIVED_FIELDS = DATACENTER_STATE_FIELDS.filter(field => typeof field.derive === 'function');

/** Keys whose default follows a selection (site, cooling, mounting, gas or nuclear type). */
export const DATACENTER_DERIVED_KEYS = Object.freeze(DERIVED_FIELDS.map(field => field.key));

// Which derived fields each selection drives.
const DERIVED_BY_SELECTION = {
  siteId: ['siteYieldMwhPerMwdcYear', 'gridEnergyPricePerMWh', 'gridCo2KgPerMWh'],
  coolingTechnology: ['coolingCapexPerKWIT', 'coolingOmPercent'],
  gpuPlatform: ['gpuRentalPricePerHour', 'gpuItKWPerGpu', 'gpuCapexPerGpu'],
  mountingType: ['panelCostPerW', 'bosCostPerW'],
  gasType: ['gasUnitSizeMW', 'gasCapexPerKW', 'gasFixedOmPerKWYear', 'gasVariableOmPerMWh', 'gasHeatRateMMBtuPerMWh', 'gasAvailabilityPercent', 'gasFuelPricePerMMBtu'],
  nuclearType: ['nuclearUnitSizeMW', 'nuclearCapexPerKW', 'nuclearFixedOmPerKWYear', 'nuclearVariableOmPerMWh', 'nuclearFuelPerMWh', 'nuclearCapacityFactorPercent', 'nuclearPpaPricePerMWh'],
};

function applyDerivedFields(input, normalized) {
  DERIVED_FIELDS.forEach(field => {
    const given = input[field.key];
    const hasValue = given !== undefined && given !== null && given !== '' && Number.isFinite(Number(given));
    normalized[field.key] = clampNumber(hasValue ? given : field.derive(normalized), field.min, field.max, field.derive(normalized));
  });
}

function buildDefaultState() {
  const defaults = {};
  // Field order (derived fields get their value below).
  DATACENTER_STATE_FIELDS.forEach(field => {
    defaults[field.key] = field.defaultValue;
  });
  applyDerivedFields({}, defaults);
  return defaults;
}

export const DATACENTER_DEFAULT_STATE = Object.freeze(buildDefaultState());

/**
 * Complete, clamped datacenter state from arbitrary input (UI state, share
 * link, test overrides). Unknown keys are dropped; preset-derived fields
 * missing from the input follow their (normalized) selection.
 */
export function normalizeDatacenterState(rawState = {}) {
  const input = rawState && typeof rawState === 'object' ? rawState : {};
  const normalized = { ...DATACENTER_DEFAULT_STATE };
  Object.keys(DATACENTER_DEFAULT_STATE).forEach(key => {
    if (Object.hasOwn(input, key)) normalized[key] = input[key];
  });
  normalizeCoreStateFields(input, normalized, BASE_FIELDS);
  applyDerivedFields(input, normalized);
  return normalized;
}

/**
 * State after the user changes `selectionKey` (siteId, coolingTechnology,
 * gpuPlatform, mountingType, gasType or nuclearType): the fields that selection drives
 * are reset to the new selection's defaults; everything else is kept.
 */
export function applyDatacenterPresetDefaults(state, selectionKey) {
  const dependent = new Set(DERIVED_BY_SELECTION[selectionKey] || []);
  const input = Object.fromEntries(Object.entries(state || {}).filter(([key]) => !dependent.has(key)));
  return normalizeDatacenterState(input);
}

/** State fields a starting design sets (applyArchitectureDefaults). */
export const ARCHITECTURE_DESIGN_KEYS = Object.freeze([
  'architecture', 'gridConnection', 'solarSizeMWdc', 'batteryCapacityMWh', 'batteryDurationHours',
  'firmFamily', 'firmSizingMode', 'firmSpareUnits', 'firmUnits', 'gasType',
  // Reset with the gas type when the design changes it (DERIVED_BY_SELECTION.gasType).
  ...DERIVED_BY_SELECTION.gasType,
]);

/**
 * State after the user switches to `architecture` ('grid' | 'hybrid' |
 * 'islanded'): the supply side is reset to that architecture's starting
 * design (ARCHITECTURE_STARTING_DESIGNS in data/datacenter/power.js, where
 * the sizes are justified); everything else (site, IT, cooling, prices, the
 * solar mounting) is kept. Pure.
 *
 * - grid: firm connection, no solar or battery, standby diesel auto-sized
 *   for the uptime target + 1 spare: exactly DATACENTER_DEFAULT_STATE's
 *   supply side.
 * - hybrid: flexible connection, solar = 2 MWdc per MW IT, a 4-hour battery
 *   of 4 h x IT MW, standby diesel auto-sized for the uptime target + 1 spare.
 * - islanded: no solar or battery, reciprocating gas engines (prime power)
 *   auto-sized + 2 spares.
 *
 * The design sets the generator type; when that changes the type, the
 * type's own costs, unit size, heat rate, availability and fuel price are
 * applied (as a type selection would); with the same type the user's values
 * are kept.
 *
 * 'auto' gas is the fewest units with which the dispatch meets the uptime
 * target (model/datacenter/firm-sizing.js), so it follows the battery,
 * solar and grid of the design. Solar and battery round to their slider
 * steps (5 MWdc, 10 MWh). The third argument is accepted for callers that
 * pass the model's design peak; the sizes no longer need it.
 */
export function applyArchitectureDefaults(state, architecture) {
  const base = normalizeDatacenterState(state);
  const design = ARCHITECTURE_STARTING_DESIGNS[architecture];
  if (!design) return base;
  const itMW = base.itCapacityMW;
  const roundTo = (value, step) => Math.round(value / step) * step;
  const typeChanged = design.gasType && design.gasType !== base.gasType;
  const kept = typeChanged
    ? Object.fromEntries(Object.entries(base).filter(([key]) => !DERIVED_BY_SELECTION.gasType.includes(key)))
    : base;
  return normalizeDatacenterState({
    ...kept,
    gasType: design.gasType || base.gasType,
    architecture,
    gridConnection: design.gridConnection || base.gridConnection,
    solarSizeMWdc: roundTo(design.solarMWdcPerMWIT * itMW, 5),
    batteryCapacityMWh: roundTo(design.batteryHoursOfIT * itMW, 10),
    batteryDurationHours: design.batteryDurationHours || DATACENTER_DEFAULT_STATE.batteryDurationHours,
    firmFamily: 'gas',
    firmSizingMode: 'auto',
    firmSpareUnits: design.gasSpareUnits,
    firmUnits: DATACENTER_DEFAULT_STATE.firmUnits,
  });
}

/**
 * A share-link diff from before standby diesel became the default
 * generator type. Share links always carry the preset-derived fields
 * (DATACENTER_DERIVED_KEYS) and, since then, the gas type; an older link
 * carries the derived gas fields (unit size, costs) but no type, because its
 * type was the then-default reciprocating engine. Restore that type so the
 * link decodes to the design it was made with. Pure; returns a new object.
 */
export function migrateDatacenterShareDiff(diff) {
  if (!diff || typeof diff !== 'object') return diff;
  if (!Object.hasOwn(diff, 'gasType') && Object.hasOwn(diff, 'gasUnitSizeMW')) return { ...diff, gasType: 'recip' };
  return diff;
}
