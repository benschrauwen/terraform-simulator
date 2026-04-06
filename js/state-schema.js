/* ============================================
   Shared state schema and defaults
   ============================================ */

const SOLAR_PROFILE_DEFAULTS_BY_BODY = {
  earth: 'earth',
  mars: 'mars-average',
  moon: 'lunar-pel',
};

const SOLAR_PROFILE_OPTIONS_BY_BODY = {
  earth: ['earth'],
  mars: ['mars', 'mars-average'],
  moon: ['moon', 'lunar-pel'],
};

const CORE_STATE_FIELDS = [
  { key: 'loadConfigTab', type: 'enum', options: ['chemicals', 'ai'], defaultValue: 'chemicals' },
  { key: 'dayMode', type: 'enum', options: ['average', 'specific'], defaultValue: 'average' },
  { key: 'body', type: 'enum', getOptions: () => Object.keys(PLANETARY_BODIES), defaultValue: 'earth' },
  { key: 'mountingType', type: 'enum', getOptions: () => Object.keys(MOUNTING_TYPES), defaultValue: 'ew' },
  { key: 'siteYieldSource', type: 'enum', options: ['preset', 'manual', 'estimated', 'planetary-custom'], defaultValue: 'preset' },
  { key: 'policyMode', type: 'enum', getOptions: () => Object.keys(POLICY_SCHEMES), defaultValue: 'us_45v_h2' },
  { key: 'methaneMarketPreset', type: 'enum', getOptions: () => Object.keys(METHANE_MARKET_PRESETS), defaultValue: 'terraform_commodity' },

  { key: 'dayOfYear', type: 'integer', min: 1, max: 365, defaultValue: 172 },

  { key: 'latitude', type: 'number', min: -90, max: 90, defaultValue: 35.05 },
  { key: 'longitude', type: 'number', min: -180, max: 180, defaultValue: -117.60 },
  {
    key: 'locationPresetIsCustom',
    type: 'boolean',
    defaultValue: false,
  },
  { key: 'siteYieldMwhPerMwdcYear', type: 'number', min: 0, max: 1e6, defaultValue: 2050 },
  { key: 'systemSizeMW', type: 'number', min: 0, max: 1e6, defaultValue: 1.0 },
  { key: 'panelEfficiency', type: 'number', min: 1, max: 100, defaultValue: 20 },
  { key: 'panelCostPerW', type: 'number', min: 0, max: 1e6, defaultValue: 0.20 },
  { key: 'panelDegradationAnnual', type: 'number', min: 0, max: 100, defaultValue: 0.65 },
  { key: 'bosCostPerW', type: 'number', min: 0, max: 1e6, defaultValue: 0.12 },
  { key: 'landCostPerAcre', type: 'number', min: 0, max: 1e9, defaultValue: 5000 },
  { key: 'sitePrepCostPerAcre', type: 'number', min: 0, max: 1e9, defaultValue: 15000 },

  { key: 'batteryEnabled', type: 'boolean', defaultValue: false },
  { key: 'batteryCapacityMWh', type: 'number', min: 0, max: 1e9, defaultValue: 0.0 },
  { key: 'batteryCostPerKWh', type: 'number', min: 0, max: 1e6, defaultValue: 150 },
  { key: 'batteryEfficiency', type: 'number', min: 0, max: 100, defaultValue: 90 },
  { key: 'batteryCycles', type: 'number', min: 1, max: 1e9, defaultValue: 4000 },
  { key: 'chemicalSizingPercent', type: 'number', min: 0, max: 100, defaultValue: 100 },

  { key: 'aiComputeEnabled', type: 'boolean', defaultValue: false },
  { key: 'aiReliabilityTarget', type: 'number', min: 0, max: 99.9999, defaultValue: 99.9 },
  { key: 'aiTokenPricePerM', type: 'number', min: 0, max: 1e9, defaultValue: 3.0 },
  { key: 'aiMillionTokensPerMWh', type: 'number', min: 0, max: 1e9, defaultValue: 1000 },
  { key: 'aiGpuCapexPerKW', type: 'number', min: 0, max: 1e9, defaultValue: AI_COMPUTE_DEFAULTS.capexPerKW },
  { key: 'aiAssetLifeYears', type: 'integer', min: 1, max: 100, defaultValue: AI_COMPUTE_DEFAULTS.assetLifeYears },

  { key: 'methaneFeedstockSplit', type: 'number', min: 0, max: 100, defaultValue: 50 },
  { key: 'mtgMethanolSplit', type: 'number', min: 0, max: 100, defaultValue: 50 },
  { key: 'methanePrice', type: 'number', min: 0, max: 1e9, defaultValue: 20 },
  { key: 'methanolPrice', type: 'number', min: 0, max: 1e9, defaultValue: 600 },
  { key: 'exploratoryOmPercent', type: 'number', min: 0, max: 20, defaultValue: 4 },

  ...POLICY_INPUT_FIELDS,

  { key: 'solarAssetLife', type: 'integer', min: 1, max: 100, defaultValue: 30 },
  { key: 'analysisHorizonYears', type: 'integer', min: 1, max: 100, defaultValue: 30 },
  { key: 'discountRate', type: 'number', min: 0, max: 1000, defaultValue: 8 },
  { key: 'financingEnabled', type: 'boolean', defaultValue: false },
  { key: 'debtSharePercent', type: 'number', min: 0, max: 90, defaultValue: 70 },
  { key: 'debtInterestRate', type: 'number', min: 0, max: 1000, defaultValue: 6.5 },
  {
    key: 'debtTermYears',
    type: 'integer',
    min: 1,
    max: 30,
    getMax: state => Math.max(1, state.analysisHorizonYears || 1),
    defaultValue: 15,
  },
  { key: 'debtFeePercent', type: 'number', min: 0, max: 100, defaultValue: 1.5 },

  { key: 'solarOmPercent', type: 'number', min: 0, max: 100, defaultValue: 1.5 },
  { key: 'processOmPercent', type: 'number', min: 0, max: 100, defaultValue: 3 },
  { key: 'batteryOmPercent', type: 'number', min: 0, max: 100, defaultValue: 1.5 },
];

const APP_CONTROL_SYNC_FIELDS = {
  checkboxes: [
    { id: 'aiComputeEnabled' },
    { id: 'financingEnabled' },
  ],
  selects: [
    { id: 'mountingType' },
    { id: 'policyMode' },
    { id: 'methaneMarketPreset' },
    { id: 'aiReliabilityTarget' },
  ],
  numbers: [
    { id: 'latitude' },
    { id: 'longitude' },
    { id: 'siteYield', stateKey: 'siteYieldMwhPerMwdcYear' },
  ],
};

function getStateFieldOptions(field) {
  if (typeof field.getOptions === 'function') {
    return field.getOptions();
  }

  return field.options || [];
}

function getModuleDefaultRoute(module) {
  return ModuleCatalog.getDefaultRoute(module);
}

function buildCoreDefaultState() {
  const defaults = {
    solarProfileModel: SOLAR_PROFILE_DEFAULTS_BY_BODY.earth,
  };

  CORE_STATE_FIELDS.forEach(field => {
    defaults[field.key] = field.defaultValue;
  });

  return defaults;
}

function buildModuleDefaultState() {
  const defaults = {};

  ModuleCatalog.getAll().forEach(module => {
    defaults[`${module.id}Enabled`] = Boolean(module.defaultEnabled);
    defaults[`${module.id}BufferEnabled`] = Boolean(module.defaultBufferEnabled);

    ModuleCatalog.getConfigFields(module).forEach(config => {
      if (Object.prototype.hasOwnProperty.call(config, 'defaultValue')) {
        defaults[config.key] = config.defaultValue;
      }
    });

    const assetLifeKey = ModuleCatalog.getAssetLifeKey(module);
    if (assetLifeKey) {
      defaults[assetLifeKey] = ModuleCatalog.getDefaultAssetLife(module);
    }

    const defaultRoute = getModuleDefaultRoute(module);
    if (defaultRoute) {
      defaults[`${module.id}Route`] = defaultRoute;
    }

    if (module.exploratory) {
      defaults[`${module.id}PriorityWeight`] = module.defaultPriorityWeight ?? 100;

      if (defaultRoute) {
        defaults[`${module.id}CapexBasis`] =
          ModuleCatalog.getRouteConfig(module, defaultRoute)?.capexPerAnnualUnit ?? 0;
      }
    }

    const marketConfig = ModuleCatalog.getMarketConfig(module, defaultRoute);
    if (marketConfig) {
      defaults[`${module.id}Price`] = marketConfig.defaultValue;
    }
  });

  return defaults;
}

function buildDefaultState() {
  return {
    ...buildCoreDefaultState(),
    ...buildModuleDefaultState(),
  };
}

const DEFAULT_STATE = buildDefaultState();
