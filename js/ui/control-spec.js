/* ============================================
   Declarative registry of state-backed form controls.

   Each entry maps one DOM control to one state key and is used both to bind
   the control (input -> state) and to sync it back (state -> control).

   Fields:
     type      'range' | 'checkbox' | 'select' | 'number'
     id        element id; `${id}Value` is the range read-out element
     stateKey  state key (defaults to id)
     format    (value, app) => read-out text (range only)
     parse     (rawValue) => state value (select only; default keeps the string)
     toggles   id of a panel whose `active` class follows the checkbox
     onInput   (app) => void, after a range wrote state, before recalculation
     onChange  (app, value) => void, after a checkbox/select/number wrote state
     dayViewOnly  range only changes the displayed day (no recalculation)

   Controls whose behaviour does not fit (location preset, module presets and
   routes, policy inputs, tabs) stay explicit code in the control mixins.
   ============================================ */

import { MOUNTING_TYPES } from '../data/reference-data.js';
import { ModuleCatalog } from '../model/module-catalog.js';
import { SolarGeometry } from '../model/solar-geometry.js';
import { FormatNumbers } from './format-numbers.js';
import {
  formatChemicalSizingPercent,
  formatConfigValue,
  formatExploratoryCapexBasis,
  formatExploratoryOmPercent,
  formatExploratoryPriorityWeight,
  formatMethaneFeedstockSplit,
  formatModuleMarketValue,
  formatMtgMethanolSplit,
  formatSystemSizeMW,
  formatYears,
} from './formatters.js';

const fixed = (digits, parse = parseFloat) => value => FormatNumbers.fixed(parse(value), digits);
const intFixed = digits => fixed(digits, value => parseInt(value, 10));
const wholeDollars = value => `$${Math.round(parseFloat(value)).toLocaleString()}`;
const omPercent = value => `${fixed(1)(value)}%/yr`;

export const CONTROL_SPECS = Object.freeze([
  // Analysis cycle
  {
    type: 'range',
    id: 'dayOfYear',
    format: value => {
      const day = parseInt(value, 10);
      return `${SolarGeometry.dayToDateString(day)}${SolarGeometry.notableDay(day)}`;
    },
    dayViewOnly: true,
  },

  // Site
  { type: 'number', id: 'latitude', onChange: app => app.handleLocationEdited() },
  { type: 'number', id: 'longitude', onChange: app => app.handleLocationEdited() },
  { type: 'number', id: 'siteYield', stateKey: 'siteYieldMwhPerMwdcYear', onChange: app => app.handleSiteYieldEdited() },

  // Solar array
  { type: 'range', id: 'systemSize', stateKey: 'systemSizeMW', format: formatSystemSizeMW },
  { type: 'range', id: 'panelEfficiency', format: value => `${fixed(1)(value)}%` },
  { type: 'range', id: 'panelCost', stateKey: 'panelCostPerW', format: value => `$${fixed(2)(value)}/W` },
  { type: 'range', id: 'panelDegradationAnnual', format: value => `${fixed(2)(value)}%/yr` },
  {
    type: 'select',
    id: 'mountingType',
    onChange: (app, value) => {
      app.state.bosCostPerW = MOUNTING_TYPES[value].typicalBOS;
      app.syncStateToControls();
    },
  },
  { type: 'range', id: 'bosCost', stateKey: 'bosCostPerW', format: value => `$${fixed(2)(value)}/W` },
  { type: 'range', id: 'landCost', stateKey: 'landCostPerAcre', format: value => `${wholeDollars(value)}/acre` },
  { type: 'range', id: 'sitePrepCost', stateKey: 'sitePrepCostPerAcre', format: value => `${wholeDollars(value)}/acre` },

  // Battery
  {
    type: 'range',
    id: 'batteryCapacity',
    stateKey: 'batteryCapacityMWh',
    format: value => `${fixed(1)(value)} MWh`,
    onInput: app => app.syncBatteryEnabledState(),
  },
  { type: 'range', id: 'batteryCost', stateKey: 'batteryCostPerKWh', format: value => `$${intFixed(0)(value)}/kWh` },
  { type: 'range', id: 'batteryEfficiency', format: value => `${intFixed(0)(value)}%` },
  { type: 'range', id: 'batteryCycles', format: value => parseInt(value, 10).toLocaleString() },
  { type: 'range', id: 'batteryDurationHours', format: value => `${fixed(1)(value)} h` },

  // Processes
  { type: 'range', id: 'chemicalSizingPercent', format: formatChemicalSizingPercent },
  { type: 'range', id: 'methaneFeedstockSplit', format: formatMethaneFeedstockSplit },
  { type: 'range', id: 'mtgMethanolSplit', format: formatMtgMethanolSplit },

  // AI compute
  {
    type: 'checkbox',
    id: 'aiComputeEnabled',
    toggles: 'aiComputeConfig',
    onChange: app => window.requestAnimationFrame(() => app.positionSliderMarkers()),
  },
  { type: 'select', id: 'aiReliabilityTarget', parse: parseFloat },
  { type: 'range', id: 'aiGpuCapexPerKW', format: value => `${wholeDollars(value)}/kW` },
  { type: 'range', id: 'aiTokenPrice', stateKey: 'aiTokenPricePerM', format: value => `$${fixed(2)(value)} / 1M tokens` },
  {
    type: 'range',
    id: 'aiTokensPerMWh',
    stateKey: 'aiMillionTokensPerMWh',
    format: value => `${Math.round(parseFloat(value)).toLocaleString()} M tokens/MWh`,
  },
  { type: 'range', id: 'aiAssetLifeYears', format: formatYears },

  // Markets and incentives
  { type: 'select', id: 'methaneMarketPreset', onChange: app => app.syncDynamicVisibility() },
  { type: 'range', id: 'methanePrice', format: value => `$${fixed(2)(value)}/MCF` },
  { type: 'range', id: 'methanolPrice', format: value => `$${intFixed(0)(value)}/ton` },
  { type: 'range', id: 'exploratoryOmPercent', format: formatExploratoryOmPercent },
  { type: 'range', id: 'h2BufferCostPerKg', format: value => `$${intFixed(0)(value)}/kg H2` },
  { type: 'range', id: 'co2BufferCostPerTon', format: value => `$${intFixed(0)(value)}/t CO2` },
  {
    type: 'select',
    id: 'policyMode',
    onChange: app => {
      app.renderPolicyInputs();
      app.syncDynamicVisibility();
    },
  },

  // Project economics
  { type: 'range', id: 'solarAssetLife', format: formatYears },
  { type: 'range', id: 'analysisHorizonYears', format: formatYears },
  { type: 'range', id: 'discountRate', format: value => `${fixed(1)(value)}%` },

  // Financing
  { type: 'checkbox', id: 'financingEnabled', toggles: 'financingConfig' },
  { type: 'range', id: 'debtShare', stateKey: 'debtSharePercent', format: value => `${intFixed(0)(value)}%` },
  { type: 'range', id: 'debtInterestRate', format: value => `${fixed(2)(value)}%` },
  { type: 'range', id: 'debtTermYears', format: formatYears },
  { type: 'range', id: 'debtFeePercent', format: value => `${fixed(2)(value)}%` },

  // Maintenance
  { type: 'range', id: 'solarOmPercent', format: omPercent },
  { type: 'range', id: 'processOmPercent', format: omPercent },
  { type: 'range', id: 'batteryOmPercent', format: omPercent },
]);

const routeOf = (app, moduleId) => app.state[`${moduleId}Route`];

/**
 * Controls generated per process module (see module-controls.js for their markup).
 * Market price sliders only exist for modules whose route has a market at render time.
 */
export function getModuleControlSpecs(state) {
  const specs = [];

  ModuleCatalog.getAll().forEach(module => {
    specs.push({
      type: 'checkbox',
      id: `${module.id}Enabled`,
      toggles: `${module.id}Config`,
      onChange: app => {
        app.enforceModuleDependencies();
        app.syncDerivedFeedControls();
      },
    });
    specs.push({ type: 'checkbox', id: `${module.id}BufferEnabled` });

    ModuleCatalog.getConfigFields(module).forEach(config => {
      specs.push({
        type: 'range',
        id: config.key,
        format: value => formatConfigValue(config.unit, value),
        onInput: ModuleCatalog.isPresetConfigField(module, config.key)
          ? app => app.syncModulePresetControl(module.id)
          : undefined,
      });
    });

    const assetLifeKey = ModuleCatalog.getAssetLifeKey(module);
    if (assetLifeKey) specs.push({ type: 'range', id: assetLifeKey, format: formatYears });

    if (module.exploratory) {
      specs.push({
        type: 'range',
        id: `${module.id}CapexBasis`,
        format: (value, app) => formatExploratoryCapexBasis(module.id, routeOf(app, module.id), value),
      });
      specs.push({
        type: 'range',
        id: `${module.id}PriorityWeight`,
        format: formatExploratoryPriorityWeight,
      });
    }
  });

  ModuleCatalog.getExploratoryModules()
    .filter(module => ModuleCatalog.hasMarket(module.id, state[`${module.id}Route`] || ModuleCatalog.getDefaultRoute(module)))
    .forEach(module => {
      specs.push({
        type: 'range',
        id: `${module.id}Price`,
        format: (value, app) => formatModuleMarketValue(module.id, routeOf(app, module.id), value),
      });
    });

  return specs;
}
