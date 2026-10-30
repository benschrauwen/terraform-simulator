/* ============================================
   Datacenter tornado (one-at-a-time) sensitivity variables
   ============================================
   The inputs the datacenter "What drives NPV" tornado moves, one at a time,
   by the chosen +/- swing around their current value (state
   .tornadoSwingPercent), every other input unchanged. Same entry format as
   data/sensitivity-variables.js: stateKey (a numeric field of
   state/datacenter-schema.js), label, display format, optional bounds and
   appliesTo(state, result) (result = the scenario result for `state`).
   Values are clamped to the field's schema range (model/datacenter/tornado.js).

   Adding a variable: append an entry here; the runner and tests pick it up. */

const rentsGpus = state => state.revenueBasis === 'gpu-rental';
const sellsTokens = state => state.revenueBasis === 'tokens';
const leases = state => state.revenueBasis === 'colocation';
const usesGrid = (state, result) => Boolean(result?.grid?.connected) && (result?.dispatch?.annual?.gridMWh || 0) > 0;
const burnsGas = (state, result) => (result?.dispatch?.annual?.fuelMMBtu || 0) > 0;
const hasFirm = (state, result) => (result?.firm?.capacityMW || 0) > 0;
const hasSolar = state => state.solarSizeMWdc > 0;
const hasBattery = state => state.batteryCapacityMWh > 0;

export const DATACENTER_SENSITIVITY_VARIABLES = Object.freeze([
  { id: 'gpuRentalPrice', stateKey: 'gpuRentalPricePerHour', label: 'GPU rental price', format: { prefix: '$', suffix: '/GPU-hr', digits: 2 }, appliesTo: rentsGpus },
  { id: 'gpuPriceDecline', stateKey: 'gpuPriceDeclinePercentPerYear', label: 'GPU rental price decline', format: { suffix: '%/yr', digits: 1 }, appliesTo: rentsGpus },
  { id: 'gpuOccupancy', stateKey: 'gpuOccupancyPercent', label: 'GPU occupancy', format: { suffix: '%', digits: 0 }, appliesTo: rentsGpus },
  { id: 'gpuCapex', stateKey: 'gpuCapexPerGpu', label: 'Capex per GPU', format: { prefix: '$', suffix: '/GPU', digits: 0 }, appliesTo: rentsGpus },
  { id: 'gpuLife', stateKey: 'gpuLifeYears', label: 'GPU life', format: { suffix: ' yr', digits: 0 }, appliesTo: rentsGpus },
  { id: 'tokenPrice', stateKey: 'tokenPricePerM', label: 'Token price', format: { prefix: '$', suffix: '/M tokens', digits: 2 }, appliesTo: sellsTokens },
  { id: 'tokenThroughput', stateKey: 'millionTokensPerMWhIT', label: 'Token throughput', format: { suffix: ' M tokens/MWh-IT', digits: 0 }, appliesTo: sellsTokens },
  { id: 'colocationLease', stateKey: 'colocationLeasePerKWMonth', label: 'Colocation lease', format: { prefix: '$', suffix: '/kW-month', digits: 0 }, appliesTo: leases },
  { id: 'itCapex', stateKey: 'itCapexPerKW', label: 'IT hardware capex', format: { prefix: '$', suffix: '/kW', digits: 0 }, appliesTo: sellsTokens },
  { id: 'itLife', stateKey: 'itAssetLifeYears', label: 'IT hardware life', format: { suffix: ' yr', digits: 0 }, appliesTo: sellsTokens },
  { id: 'utilization', stateKey: 'itUtilizationPercent', label: 'IT utilization', format: { suffix: '%', digits: 0 }, appliesTo: state => !rentsGpus(state) },
  { id: 'facilityCapex', stateKey: 'facilityCapexPerKWIT', label: 'Building + electrical capex', format: { prefix: '$', suffix: '/kW-IT', digits: 0 }, appliesTo: () => true },
  { id: 'coolingCapex', stateKey: 'coolingCapexPerKWIT', label: 'Cooling plant capex', format: { prefix: '$', suffix: '/kW-IT', digits: 0 }, appliesTo: () => true },
  { id: 'gridPrice', stateKey: 'gridEnergyPricePerMWh', label: 'Grid energy price', format: { prefix: '$', suffix: '/MWh', digits: 1 }, appliesTo: usesGrid },
  { id: 'demandCharge', stateKey: 'gridDemandChargePerKWMonth', label: 'Grid demand charge', format: { prefix: '$', suffix: '/kW-month', digits: 1 }, appliesTo: (state, result) => usesGrid(state, result) && state.gridDemandChargePerKWMonth > 0 },
  { id: 'interconnectionCapex', stateKey: 'gridInterconnectionCapexPerKW', label: 'Grid interconnection capex', format: { prefix: '$', suffix: '/kW', digits: 0 }, appliesTo: (state, result) => Boolean(result?.grid?.connected) },
  { id: 'gasPrice', stateKey: 'gasFuelPricePerMMBtu', label: 'Gas price', format: { prefix: '$', suffix: '/MMBtu', digits: 2 }, appliesTo: burnsGas },
  { id: 'gasCapex', stateKey: 'gasCapexPerKW', label: 'Gas generation capex', format: { prefix: '$', suffix: '/kW', digits: 0 }, appliesTo: (state, result) => state.firmFamily === 'gas' && hasFirm(state, result) },
  { id: 'nuclearCapex', stateKey: 'nuclearCapexPerKW', label: 'Nuclear capex', format: { prefix: '$', suffix: '/kW', digits: 0 }, appliesTo: (state, result) => state.firmFamily === 'nuclear' && state.nuclearCapexPerKW > 0 && hasFirm(state, result) },
  { id: 'nuclearPpa', stateKey: 'nuclearPpaPricePerMWh', label: 'Nuclear PPA price', format: { prefix: '$', suffix: '/MWh', digits: 0 }, appliesTo: (state, result) => state.firmFamily === 'nuclear' && state.nuclearPpaPricePerMWh > 0 && hasFirm(state, result) },
  { id: 'panelCost', stateKey: 'panelCostPerW', label: 'Module price', format: { prefix: '$', suffix: '/W', digits: 2 }, appliesTo: hasSolar },
  { id: 'bosCost', stateKey: 'bosCostPerW', label: 'Solar BOS', format: { prefix: '$', suffix: '/W', digits: 2 }, appliesTo: hasSolar },
  { id: 'batteryCost', stateKey: 'batteryCostPerKWh', label: 'Battery cost', format: { prefix: '$', suffix: '/kWh', digits: 0 }, appliesTo: hasBattery },
  { id: 'waterPrice', stateKey: 'waterPricePerM3', label: 'Water price', format: { prefix: '$', suffix: '/m³', digits: 2 }, appliesTo: (state, result) => (result?.water?.withdrawnM3 || 0) > 0 },
  // Time to power: every lead-time phase x (1 +/- swing).
  { id: 'schedule', stateKey: 'scheduleScalePercent', label: 'Schedule (time to power)', format: { suffix: '% of lead times', digits: 0 }, appliesTo: () => true },
  { id: 'discountRate', stateKey: 'discountRate', label: 'Discount rate', format: { suffix: '%', digits: 1 }, appliesTo: () => true },
]);

/** Variables for a state (the list is static; kept as a function like the plant builder's). */
export function getDatacenterSensitivityVariables() {
  return DATACENTER_SENSITIVITY_VARIABLES;
}
