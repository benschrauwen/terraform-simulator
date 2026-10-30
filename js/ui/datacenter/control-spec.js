/* ============================================
   Datacenter control registry (declarative)
   ============================================
   DATACENTER_SECTIONS lists, per left-panel container (the section ids in
   datacenter.html), the controls and info blocks it holds, in order. Each
   control is one state key of state/datacenter-schema.js:

     type      'range' | 'select' | 'checkbox' | 'number'
     id        element id (= state key unless stateKey is given); a range's
               read-out is `${id}Value` (as in the plant builder's controls.js,
               whose bindControlSpec / syncControlSpec bind these)
     label, tooltip, note        visible text (escaped when rendered)
     min, max, step              slider/number bounds, inside the schema range
     scale     'log': the slider carries log10 of the value (min/max/step too)
     range(state)                bounds that follow a selection (unit sizes)
     format(value)               range read-out
     options(state)              select options [{ value, label }]
     parse     select parse (parseFloat for numeric selects)
     preset    selection key for applyDatacenterPresetDefaults on change
     visible(state)              false hides the control (el.hidden)
     onChange(app, value, previous)

   Info blocks are { block: 'name' } placeholders filled by info-panels.js;
   { details: 'Title', items: [...] } groups secondary inputs in a <details>.
   Controls whose state key the schema does not have (yet) are dropped, so
   the spec can name fields the model adds later. */

import { COOLING_TECHNOLOGIES } from '../../data/datacenter/cooling.js';
import { FACILITY_DEFAULTS } from '../../data/datacenter/facility.js';
import { ARCHITECTURES, GAS_GENSET_TYPES, NUCLEAR_TYPES } from '../../data/datacenter/power.js';
import { DATACENTER_SITES } from '../../data/datacenter/sites.js';
import { MOUNTING_TYPES } from '../../data/reference-data.js';
import { DATACENTER_DEFAULT_STATE, DATACENTER_STATE_FIELDS } from '../../state/datacenter-schema.js';
import { getGpuPlatformOptions } from './gpu-platforms.js';
import { fixed, formatMW, formatStorageMWh } from './format.js';

const usd = (digits = 0) => value => `$${fixed(value, digits)}`;
const per = (digits, unit) => value => `$${fixed(value, digits)}/${unit}`;
const pct = (digits = 0, suffix = '%') => value => `${fixed(value, digits)}${suffix}`;
const years = value => `${fixed(value, 0)} years`;
const hours = value => `${fixed(value, value % 1 ? 1 : 0)} h`;

const fieldOptions = key => {
  const field = DATACENTER_STATE_FIELDS.find(entry => entry.key === key);
  return field?.options || field?.getOptions?.() || [];
};

const REVENUE_LABELS = {
  'gpu-rental': 'GPU cloud rental ($/GPU-hour)',
  tokens: 'AI tokens ($/M tokens)',
  colocation: 'Colocation lease ($/kW-month)',
};

const UPTIME_PRESETS = [
  ...FACILITY_DEFAULTS.uptimeTiers.map(tier => ({ value: tier.availabilityPercent, label: `${tier.availabilityPercent}% (legacy Tier ${tier.tier})` })),
  { value: 99.9, label: '99.9% (three nines)' },
  { value: 99.99, label: '99.99% (four nines)' },
  { value: 99.999, label: '99.999% (five nines)' },
].sort((a, b) => a.value - b.value);

const gasType = state => GAS_GENSET_TYPES[state.gasType] || Object.values(GAS_GENSET_TYPES)[0];
const nuclearType = state => NUCLEAR_TYPES[state.nuclearType] || Object.values(NUCLEAR_TYPES)[0];
const isContractedNuclear = state => (nuclearType(state).capexPerKW?.default || 0) === 0;
const ownsIt = state => state.revenueBasis !== 'colocation';

// What the architecture allows (ARCHITECTURES; the schema clamps the state to
// it): selections offer only the allowed values, solar hides where it has none.
const rulesOf = state => ARCHITECTURES[state.architecture] || {};
const allowedBy = list => ([value]) => !list || list.includes(value);
const solarAllowed = state => rulesOf(state).resources?.solar !== 'none';
const backupOnly = state => state.architecture === 'grid';
const CONNECTION_LABELS = {
  firm: 'Firm service (always available)',
  flexible: 'Flexible / conditional (curtailable hours)',
};

/* Bounds of a unit-size slider from the selected type's { min, max } (hidden when min = max). */
function unitSizeRange({ min, max }) {
  if (!(max > min)) return { min, max: min + 1, step: 1 };
  const span = max - min;
  const step = span > 200 ? 1 : span > 20 ? 0.5 : 0.1;
  return { min, max, step };
}

export const DATACENTER_SECTIONS = {
  siteControls: [
    {
      type: 'select', id: 'siteId', label: 'Site', preset: 'siteId',
      options: () => DATACENTER_SITES.map(site => ({ value: site.id, label: site.name })),
    },
    { block: 'siteInfo' },
    {
      details: 'Solar resource override',
      items: [
        {
          type: 'range', id: 'siteYieldMwhPerMwdcYear', label: 'Solar yield (MWh / MWdc / yr)', min: 600, max: 2600, step: 1,
          format: value => `${fixed(value, 0)} MWh/MWdc`,
          tooltip: 'PVGIS output of a fixed array at optimal tilt (14% losses); other mountings scale it. Resets when the site changes.',
        },
      ],
    },
  ],

  datacenterControls: [
    {
      type: 'range', id: 'itCapacityMW', label: 'IT capacity', scale: 'log', min: 1, max: 5000, step: 0.001, format: formatMW,
      tooltip: 'Nameplate IT (server) power. Facility power adds cooling and distribution losses on top (PUE).',
    },
    {
      type: 'range', id: 'itUtilizationPercent', label: 'Average IT utilization', min: 20, max: 100, step: 1, format: pct(0),
      visible: state => state.revenueBasis !== 'gpu-rental',
      tooltip: 'Average IT draw as a share of nameplate. AI training runs ~80%, inference ~45%, colocation ~50% of contracted capacity (LBNL).',
    },
    {
      type: 'select', id: 'uptimeTargetPercent', label: 'Uptime target', parse: parseFloat,
      options: () => UPTIME_PRESETS.map(({ value, label }) => ({ value: String(value), label })),
      note: 'Share of hours with the full load served. The tier percentages are the legacy Uptime Institute figures; the Institute no longer publishes them, so they are a yardstick, not a certification.',
    },
    {
      type: 'select', id: 'facilityTier', label: 'Facility build standard',
      options: () => FACILITY_DEFAULTS.uptimeTiers.map(tier => ({
        value: tier.tier,
        label: `Tier ${tier.tier}: ${tier.label} (${tier.redundancy}), capex x${fixed(FACILITY_DEFAULTS.tierCapexMultiplier[tier.tier], 2)}`,
      })),
      tooltip: 'Sets the building + electrical capex multiplier (redundant UPS, switchgear, distribution paths). Power supply adequacy is modeled separately.',
    },
    {
      details: 'Building costs',
      items: [
        { type: 'range', id: 'facilityCapexPerKWIT', label: 'Building + electrical capex', min: 4000, max: 20000, step: 250, format: per(0, 'kW-IT'), tooltip: 'Shell, fit-out, UPS and medium-voltage distribution per kW of IT, before the tier multiplier.' },
        { type: 'range', id: 'landCapexPerKWIT', label: 'Land', min: 0, max: 1000, step: 10, format: per(0, 'kW-IT') },
        { type: 'range', id: 'substationCapexPerKW', label: 'HV substation capex', min: 0, max: 500, step: 5, format: per(0, 'kW'), tooltip: 'Customer HV transformers and switchgear, per kW of design facility peak.' },
        { type: 'range', id: 'facilityOmPercent', label: 'Building O&M', min: 0, max: 6, step: 0.1, format: pct(1, '% of capex/yr') },
        { type: 'range', id: 'facilityAssetLifeYears', label: 'Building life', min: 10, max: 40, step: 1, format: years },
      ],
    },
  ],

  coolingControls: [
    {
      type: 'select', id: 'coolingTechnology', label: 'Cooling technology', preset: 'coolingTechnology',
      options: () => Object.values(COOLING_TECHNOLOGIES).map(tech => ({ value: tech.id, label: tech.label })),
    },
    { block: 'coolingInfo' },
    {
      details: 'Cooling costs',
      items: [
        { type: 'range', id: 'coolingCapexPerKWIT', label: 'Cooling plant capex', min: 200, max: 4000, step: 50, format: per(0, 'kW-IT'), tooltip: 'Resets to the technology default when the technology changes.' },
        { type: 'range', id: 'coolingOmPercent', label: 'Cooling O&M', min: 0, max: 8, step: 0.25, format: pct(2, '% of capex/yr') },
        { type: 'range', id: 'waterPricePerM3', label: 'Water price', min: 0, max: 10, step: 0.1, format: per(2, 'm³') },
      ],
    },
  ],

  architectureControls: [{ block: 'architectureCards' }],

  gridControls: [
    {
      type: 'select', id: 'gridConnection', label: 'Connection type',
      options: state => Object.entries(CONNECTION_LABELS).filter(allowedBy(rulesOf(state).gridConnections)).map(([value, label]) => ({ value, label })),
    },
    {
      type: 'range', id: 'gridUnavailableHoursPerYear', label: 'Grid unavailable', min: 0, max: 500, step: 2, format: value => `${fixed(value, 0)} h/yr`,
      visible: state => state.gridConnection === 'flexible',
      tooltip: 'Hours a year the utility may cut a flexible connection, placed as 4-hour events on the hottest afternoons. On-site generation or storage must cover them.',
    },
    {
      type: 'range', id: 'firmGridOutageHoursPerYear', label: 'Utility outages', min: 0, max: 24, step: 1, format: value => `${fixed(value, 0)} h/yr`,
      tooltip: 'Unplanned utility interruptions, firm service included: ~2.7 h a year at transmission delivery points (Electricity Canada), 6-11 h for US distribution customers (EIA 2023-24). Placed as 3-hour events from 15 July; a flexible connection\'s curtailments come on top. Covering them takes backup generation or storage.',
    },
    {
      type: 'range', id: 'gridEnergyPricePerMWh', label: 'Grid energy price', min: 0, max: 300, step: 0.5, format: per(1, 'MWh'),
      tooltip: 'Defaults to the site\'s all-in average industrial price (resets when the site changes).',
    },
    {
      type: 'range', id: 'gridDemandChargePerKWMonth', label: 'Demand charge', min: 0, max: 40, step: 0.5, format: per(1, 'kW-month'),
      tooltip: 'Charged on each month\'s peak import. The default price is all-in, so a demand charge on top double counts unless you lower the energy price.',
    },
    { block: 'gridNote' },
    { type: 'range', id: 'gridCo2KgPerMWh', label: 'Grid CO₂ intensity', min: 0, max: 1000, step: 1, format: value => `${fixed(value, 0)} kg/MWh` },
    { type: 'checkbox', id: 'gridExportEnabled', label: 'Export surplus to the grid' },
    { type: 'range', id: 'gridExportPricePerMWh', label: 'Export price', min: 0, max: 200, step: 1, format: per(0, 'MWh'), visible: state => state.gridExportEnabled },
    {
      details: 'Connection size and cost',
      items: [
        {
          type: 'number', id: 'gridImportCapMW', label: 'Import cap (MW, 0 = design peak)', min: 0, max: 100000, step: 1,
          tooltip: '0 sizes the connection for the IT nameplate at the hottest hour\'s PUE.',
        },
        { type: 'range', id: 'gridInterconnectionCapexPerKW', label: 'Interconnection capex', min: 0, max: 1000, step: 10, format: per(0, 'kW') },
      ],
    },
  ],

  solarControls: [
    { block: 'solarArchitectureNote', visible: state => !solarAllowed(state) },
    {
      type: 'range', id: 'solarSizeMWdc', label: 'Solar array', min: 0, max: 5000, step: 5, visible: solarAllowed,
      format: value => (value > 0 ? `${formatMW(value)}dc` : 'None'),
    },
    {
      type: 'select', id: 'mountingType', label: 'Mounting', preset: 'mountingType', visible: solarAllowed,
      options: () => Object.entries(MOUNTING_TYPES).map(([value, type]) => ({ value, label: type.label })),
    },
    { block: 'solarInfo', visible: solarAllowed },
    {
      details: 'Solar cost basis',
      visible: solarAllowed,
      items: [
        { type: 'range', id: 'panelCostPerW', label: 'Module price', min: 0.05, max: 1, step: 0.01, format: per(2, 'W') },
        { type: 'range', id: 'bosCostPerW', label: 'Structure + install BOS', min: 0.05, max: 1.5, step: 0.01, format: per(2, 'W') },
        { type: 'range', id: 'landCostPerAcre', label: 'Solar land', min: 0, max: 50000, step: 500, format: per(0, 'acre') },
        { type: 'range', id: 'solarOmPercent', label: 'Solar O&M', min: 0, max: 5, step: 0.1, format: pct(1, '% of capex/yr') },
        { type: 'range', id: 'solarAssetLife', label: 'Solar life', min: 10, max: 40, step: 1, format: years },
      ],
    },
  ],

  batteryControls: [
    {
      type: 'range', id: 'batteryCapacityMWh', label: 'Battery energy', min: 0, max: 10000, step: 10,
      format: value => (value > 0 ? formatStorageMWh(value) : 'None'),
    },
    { type: 'range', id: 'batteryDurationHours', label: 'Duration', min: 1, max: 12, step: 0.5, format: hours, tooltip: 'Energy / power. A 4-hour battery of 400 MWh delivers 100 MW.' },
    { block: 'batteryInfo' },
    {
      details: 'Battery costs',
      items: [
        { type: 'range', id: 'batteryCostPerKWh', label: 'Battery energy cost ($/kWh)', min: 50, max: 500, step: 1, format: per(0, 'kWh'), tooltip: 'Cells, racks, containers and energy-related balance of system, per kWh of capacity.' },
        { type: 'range', id: 'batteryPowerCostPerKW', label: 'Battery power cost ($/kW)', min: 0, max: 1000, step: 5, format: per(0, 'kW'), tooltip: 'Inverters (PCS), transformers and switchgear, per kW of power (capacity / duration). A shorter battery of the same MWh has more kW, so it costs more per kWh.' },
        { type: 'range', id: 'batteryEfficiency', label: 'Round-trip efficiency', min: 70, max: 98, step: 0.5, format: pct(1) },
        { type: 'range', id: 'batteryOmPercent', label: 'Battery O&M', min: 0, max: 5, step: 0.1, format: pct(1, '% of capex/yr') },
      ],
    },
  ],

  gasControls: [
    {
      type: 'select', id: 'firmFamily', label: 'Firm generation',
      options: state => [
        { value: 'none', label: 'None' },
        { value: 'gas', label: backupOnly(state) ? 'Standby generators (diesel)' : 'Generators: diesel standby, gas engines, turbines, fuel cells' },
        { value: 'nuclear', label: backupOnly(state) ? 'Nuclear: existing-plant contract (grid-delivered)' : 'Nuclear' },
      ],
    },
    { block: 'firmArchitectureNote', visible: backupOnly },
    {
      type: 'select', id: 'gasType', label: 'Generator technology', preset: 'gasType', visible: state => state.firmFamily === 'gas',
      options: state => Object.entries(GAS_GENSET_TYPES).filter(allowedBy(rulesOf(state).gasTypes)).map(([value, type]) => ({ value, label: type.label })),
    },
    { block: 'gasInfo', visible: state => state.firmFamily === 'gas' },
    {
      type: 'select', id: 'nuclearType', label: 'Nuclear option', preset: 'nuclearType', visible: state => state.firmFamily === 'nuclear',
      options: state => Object.entries(NUCLEAR_TYPES).filter(allowedBy(rulesOf(state).nuclearTypes)).map(([value, type]) => ({ value, label: type.label })),
    },
    { block: 'nuclearInfo', visible: state => state.firmFamily === 'nuclear' },
    {
      type: 'select', id: 'firmSizingMode', label: 'Sizing', visible: state => state.firmFamily !== 'none',
      options: state => [
        { value: 'auto', label: state.firmFamily === 'nuclear' ? 'Auto (cover the average load)' : 'Auto (meet uptime target + spare units)' },
        { value: 'manual', label: 'Manual unit count' },
      ],
      // Switching to manual starts from the units auto sizing had chosen.
      onChange: (app, value, previous) => {
        const units = app.lastResults?.firm?.units;
        if (value === 'manual' && previous === 'auto' && Number.isInteger(units)) {
          app.state.firmUnits = units;
          app.syncStateToControls?.();
        }
      },
    },
    {
      type: 'range', id: 'firmSpareUnits', label: 'Spare units (N+x)', min: 0, max: 6, step: 1, format: value => `N+${fixed(value, 0)}`,
      visible: state => state.firmFamily === 'gas' && state.firmSizingMode === 'auto',
      tooltip: 'Units on top of the ones the uptime target needs (which already allow for planned maintenance), for failures and load the model does not see. Backup: N+1; islanded: N+2 is common. None are added when the target needs no unit.',
    },
    {
      type: 'range', id: 'firmUnits', label: 'Units', min: 0, max: 300, step: 1, format: value => `${fixed(value, 0)} units`,
      visible: state => state.firmFamily !== 'none' && state.firmSizingMode === 'manual',
    },
    {
      type: 'range', id: 'gasUnitSizeMW', label: 'Unit size', format: formatMW,
      visible: state => state.firmFamily === 'gas' && gasType(state).unitSizeMW.max > gasType(state).unitSizeMW.min,
      range: state => unitSizeRange(gasType(state).unitSizeMW),
    },
    {
      type: 'range', id: 'nuclearUnitSizeMW', label: 'Unit size', format: formatMW,
      visible: state => state.firmFamily === 'nuclear' && nuclearType(state).unitSizeMWe.max > nuclearType(state).unitSizeMWe.min,
      range: state => unitSizeRange(nuclearType(state).unitSizeMWe),
    },
    { block: 'firmSizing', visible: state => state.firmFamily !== 'none' },
    {
      type: 'range', id: 'gasFuelPricePerMMBtu', label: 'Delivered fuel price', format: per(2, 'MMBtu'), visible: state => state.firmFamily === 'gas',
      // Natural gas $0-15; diesel (standby type) up to $60/MMBtu (~$8.30/gal).
      range: state => (gasType(state).fuel === 'diesel' ? { min: 0, max: 60, step: 0.5 } : { min: 0, max: 15, step: 0.05 }),
      tooltip: 'HHV basis. Natural gas: Henry Hub plus delivery. Diesel: untaxed (dyed, off-road) price per gallon / 0.138 MMBtu.',
    },
    { type: 'range', id: 'nuclearPpaPricePerMWh', label: 'PPA price', min: 0, max: 250, step: 1, format: per(0, 'MWh'), visible: state => state.firmFamily === 'nuclear' && isContractedNuclear(state), tooltip: 'Take-or-pay on all available output.' },
    {
      details: 'Generator costs and performance',
      visible: state => state.firmFamily === 'gas',
      items: [
        { type: 'range', id: 'gasCapexPerKW', label: 'Installed capex', min: 300, max: 9000, step: 25, format: per(0, 'kW') },
        { type: 'range', id: 'gasHeatRateMMBtuPerMWh', label: 'Heat rate (HHV)', min: 5, max: 12.5, step: 0.05, format: value => `${fixed(value, 2)} MMBtu/MWh (${fixed(3.412 / value * 100, 0)}%)` },
        { type: 'range', id: 'gasFixedOmPerKWYear', label: 'Fixed O&M', min: 0, max: 100, step: 0.5, format: per(1, 'kW-yr') },
        { type: 'range', id: 'gasVariableOmPerMWh', label: 'Variable O&M', min: 0, max: 30, step: 0.1, format: per(1, 'MWh') },
        { type: 'range', id: 'gasAvailabilityPercent', label: 'Unit availability', min: 80, max: 100, step: 0.5, format: pct(1), tooltip: 'Each unit is out (1 - availability) x 8760 hours a year for maintenance, one after another.' },
      ],
    },
    {
      details: 'Nuclear costs and performance',
      visible: state => state.firmFamily === 'nuclear',
      items: [
        { type: 'range', id: 'nuclearCapexPerKW', label: 'Overnight capex', min: 0, max: 30000, step: 100, format: per(0, 'kW'), visible: state => !isContractedNuclear(state) },
        { type: 'range', id: 'nuclearCapacityFactorPercent', label: 'Capacity factor', min: 70, max: 100, step: 0.5, format: pct(1), tooltip: 'The rest of the year is a refuelling / maintenance block.' },
        { type: 'range', id: 'nuclearFuelPerMWh', label: 'Fuel', min: 0, max: 40, step: 0.5, format: per(1, 'MWh'), visible: state => !isContractedNuclear(state) },
        { type: 'range', id: 'nuclearFixedOmPerKWYear', label: 'Fixed O&M', min: 0, max: 300, step: 1, format: per(0, 'kW-yr'), visible: state => !isContractedNuclear(state) },
        { type: 'range', id: 'nuclearVariableOmPerMWh', label: 'Variable O&M', min: 0, max: 30, step: 0.1, format: per(1, 'MWh'), visible: state => !isContractedNuclear(state) },
      ],
    },
    { block: 'firmCompare', visible: state => state.firmFamily !== 'none' },
  ],

  revenueControls: [
    {
      type: 'select', id: 'revenueBasis', label: 'Business model',
      options: () => fieldOptions('revenueBasis').map(value => ({ value, label: REVENUE_LABELS[value] || value })),
    },
    { block: 'revenueNote' },
    // GPU cloud rental (fields from the GPU rental model).
    {
      type: 'select', id: 'gpuPlatform', label: 'GPU platform', preset: 'gpuPlatform', visible: state => state.revenueBasis === 'gpu-rental',
      options: () => getGpuPlatformOptions(),
    },
    { block: 'gpuInfo', visible: state => state.revenueBasis === 'gpu-rental' },
    { type: 'range', id: 'gpuRentalPricePerHour', label: 'Rental price', min: 0.25, max: 15, step: 0.05, format: per(2, 'GPU-hr'), visible: state => state.revenueBasis === 'gpu-rental' },
    { type: 'range', id: 'gpuOccupancyPercent', label: 'Occupancy (GPU-hours sold)', min: 10, max: 100, step: 1, format: pct(0), visible: state => state.revenueBasis === 'gpu-rental' },
    { type: 'range', id: 'gpuPriceDeclinePercentPerYear', label: 'Rental price decline', min: 0, max: 40, step: 0.5, format: pct(1, '%/yr'), visible: state => state.revenueBasis === 'gpu-rental', tooltip: 'Rental prices of a GPU generation fall as newer ones ship.' },
    // AI tokens.
    { type: 'range', id: 'tokenPricePerM', label: 'Token price', min: 0.05, max: 5, step: 0.01, format: per(2, 'M tokens'), visible: state => state.revenueBasis === 'tokens' },
    { type: 'range', id: 'millionTokensPerMWhIT', label: 'Token throughput', min: 500, max: 40000, step: 10, format: value => `${fixed(value, 0)} M tokens/MWh-IT`, visible: state => state.revenueBasis === 'tokens' },
    // Colocation.
    { type: 'range', id: 'colocationLeasePerKWMonth', label: 'Lease rate', min: 50, max: 400, step: 5, format: per(0, 'kW-month'), visible: state => state.revenueBasis === 'colocation' },
    { type: 'checkbox', id: 'colocationPowerPassThrough', label: 'Tenant pays for power at cost', visible: state => state.revenueBasis === 'colocation' },
    {
      details: 'GPU / IT hardware',
      visible: ownsIt,
      items: [
        { type: 'range', id: 'gpuCapexPerGpu', label: 'Capex per GPU (all-in)', min: 5000, max: 150000, step: 500, format: usd(0), visible: state => state.revenueBasis === 'gpu-rental' },
        { type: 'range', id: 'gpuItKWPerGpu', label: 'IT power per GPU', min: 0.3, max: 4, step: 0.01, format: value => `${fixed(value, 2)} kW`, visible: state => state.revenueBasis === 'gpu-rental', tooltip: 'Server, network and storage power per GPU; sets the GPU count from the IT capacity.' },
        { type: 'range', id: 'itCapexPerKW', label: 'IT capex', min: 5000, max: 100000, step: 500, format: per(0, 'kW'), visible: state => state.revenueBasis === 'tokens' },
        { type: 'range', id: 'gpuLifeYears', label: 'GPU life', min: 2, max: 10, step: 1, format: years, visible: state => state.revenueBasis === 'gpu-rental' },
        { type: 'range', id: 'itAssetLifeYears', label: 'Hardware life', min: 2, max: 10, step: 1, format: years, visible: state => state.revenueBasis === 'tokens' },
        { type: 'range', id: 'itOmPercent', label: 'IT O&M', min: 0, max: 10, step: 0.25, format: pct(2, '% of capex/yr') },
        {
          type: 'select', id: 'itCapexTiming', label: 'Hardware paid',
          options: () => [{ value: 'energization', label: 'At first power (delivered just in time)' }, { value: 'ntp', label: 'At notice-to-proceed' }],
        },
      ],
    },
  ],

  financeControls: [
    { type: 'range', id: 'analysisHorizonYears', label: 'Analysis horizon', min: 5, max: 40, step: 1, format: years, tooltip: 'Years from notice-to-proceed; the build years count.' },
    { type: 'range', id: 'discountRate', label: 'Discount rate', min: 0, max: 20, step: 0.25, format: pct(2) },
    {
      type: 'select', id: 'constructionCapexTiming', label: 'Construction capex paid',
      options: () => [{ value: 'spread', label: 'Over the build, finishing at first power' }, { value: 'ntp', label: 'All at notice-to-proceed' }],
      tooltip: 'Building, cooling, substation, grid connection, generation, solar and battery. Spread: evenly over each component\'s procurement and construction, as late as its schedule allows (the grid connection over its construction only). Land is paid at notice-to-proceed either way; project debt covers only what is paid at notice-to-proceed.',
    },
    { type: 'checkbox', id: 'financingEnabled', label: 'Project debt' },
    { type: 'range', id: 'debtSharePercent', label: 'Debt share', min: 0, max: 90, step: 1, format: pct(0, '% of capex'), visible: state => state.financingEnabled },
    { type: 'range', id: 'debtInterestRate', label: 'Interest rate', min: 0, max: 15, step: 0.05, format: pct(2), visible: state => state.financingEnabled },
    { type: 'range', id: 'debtTermYears', label: 'Debt term', min: 1, max: 30, step: 1, format: years, visible: state => state.financingEnabled },
    { type: 'range', id: 'debtFeePercent', label: 'Upfront fee', min: 0, max: 5, step: 0.1, format: pct(1, '% of debt'), visible: state => state.financingEnabled },
  ],

  timelineControls: [
    {
      type: 'select', id: 'scheduleCase', label: 'Lead-time case',
      options: () => [{ value: 'low', label: 'Fast (low)' }, { value: 'typical', label: 'Typical' }, { value: 'high', label: 'Slow (high)' }],
    },
    { type: 'range', id: 'scheduleScalePercent', label: 'Schedule scale', min: 25, max: 300, step: 5, format: pct(0, '% of lead times'), tooltip: 'Multiplies every permitting, procurement and construction phase.' },
  ],

  tornadoControls: [
    {
      type: 'select', id: 'tornadoSwingPercent', label: 'Swing each input by', parse: parseFloat,
      options: () => [10, 20, 30, 50].map(value => ({ value: String(value), label: `±${value}%` })),
    },
  ],
};

const hasField = key => Object.hasOwn(DATACENTER_DEFAULT_STATE, key);

/** Section items with the controls the schema lacks removed (recursively in details). */
function availableItems(items) {
  return items.flatMap(item => {
    if (item.details) {
      const nested = availableItems(item.items);
      return nested.length ? [{ ...item, items: nested }] : [];
    }
    if (item.block) return [item];
    return hasField(item.stateKey || item.id) ? [item] : [];
  });
}

export function getDatacenterSections() {
  return Object.fromEntries(Object.entries(DATACENTER_SECTIONS).map(([container, items]) => [container, availableItems(items)]));
}

function flattenControls(items) {
  return items.flatMap(item => (item.details ? flattenControls(item.items) : item.block ? [] : [item]));
}

/** Every control on the page (flat), bindable with controls.js bindControlSpec. */
export function getDatacenterControlSpecs() {
  return Object.values(getDatacenterSections()).flatMap(flattenControls);
}

/** Effective { min, max, step } of a range/number control for a state. */
export function getControlRange(spec, state) {
  return spec.range ? spec.range(state) : { min: spec.min, max: spec.max, step: spec.step };
}

/* Wire the preset reset (applyDatacenterPresetDefaults) into each selection's
   onChange; app.applyPresetSelection does the reset and re-sync. */
export function withPresetHandlers(specs) {
  return specs.map(spec => (spec.preset
    ? { ...spec, onChange: (app, value, previous) => { app.applyPresetSelection(spec.preset); spec.onChange?.(app, value, previous); } }
    : spec));
}
