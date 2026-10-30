/* Benchmark markers on the datacenter sliders (the shared slider-markers.js draws them). Values
   come from the sourced data files (js/data/datacenter/, js/data/reference-data.js via the plant
   builder's SLIDER_MARKERS); the labels name the source the data file cites. */

import { FACILITY_DEFAULTS } from '../../data/datacenter/facility.js';
import { GAS_DEFAULTS, GRID_DEFAULTS } from '../../data/datacenter/power.js';
import { SLIDER_MARKERS } from '../slider-markers.js';

export const DATACENTER_SLIDER_MARKERS = {
  tokenPricePerM: SLIDER_MARKERS.aiTokenPrice,
  batteryCostPerKWh: SLIDER_MARKERS.batteryCost,
  panelCostPerW: SLIDER_MARKERS.panelCost,
  itUtilizationPercent: [
    { value: FACILITY_DEFAULTS.itUtilization.aiInference * 100, label: 'AI inference (LBNL 2024)' },
    { value: FACILITY_DEFAULTS.itUtilization.colocation * 100, label: 'Colocation, share of contracted capacity used (LBNL 2024)' },
    { value: FACILITY_DEFAULTS.itUtilization.aiTraining * 100, label: 'AI training (LBNL 2024)' },
  ],
  gasFuelPricePerMMBtu: [
    { value: GAS_DEFAULTS.henryHub2027PerMMBtu, label: 'Henry Hub 2027 forecast (EIA STEO Oct 2026)' },
    { value: GAS_DEFAULTS.henryHubPerMMBtu, label: 'Henry Hub 2026 average (EIA STEO Oct 2026)' },
  ],
  gridUnavailableHoursPerYear: [
    { value: GRID_DEFAULTS.flexibleUnavailableHoursRange.low, label: 'Flexible connection, low (Camus / encoord / Princeton PJM study)' },
    { value: GRID_DEFAULTS.flexibleUnavailableHoursRange.high, label: 'Flexible connection, high (Camus / encoord / Princeton PJM study)' },
  ],
  gridExportPricePerMWh: [
    { value: GRID_DEFAULTS.wholesalePricePerMWh.ercotNorth2025, label: 'ERCOT North hub average 2025 (EIA STEO)' },
    { value: GRID_DEFAULTS.wholesalePricePerMWh.pjmWest2025, label: 'PJM West hub average 2025 (EIA STEO)' },
  ],
  colocationLeasePerKWMonth: [
    { value: FACILITY_DEFAULTS.colocationLeasePerKWMonth.low, label: 'Wholesale colocation, low (CBRE 2025-26)' },
    { value: FACILITY_DEFAULTS.colocationLeasePerKWMonth.high, label: 'Wholesale colocation, high (CBRE 2025-26)' },
  ],
  itCapexPerKW: [
    { value: FACILITY_DEFAULTS.itCapexPerKW.low, label: 'GB200 servers + network (Epoch AI)' },
    { value: FACILITY_DEFAULTS.itCapexPerKW.high, label: 'High end of the IT capex range' },
  ],
};
