/* ============================================
   Unified module catalog and helpers
   ============================================ */

const MODULE_FAMILY_LABELS = Object.freeze({
  'air-water-chemistry': 'Air and water chemistry',
  'carbon-solids': 'Carbon solids',
  'calcination-minerals': 'Calcination and mineral decomposition',
  'oxide-reduction': 'Oxide reduction and metallurgy',
  'water-systems': 'Water systems',
});

function normalizeRouteDefinition(routeId, definition = {}) {
  return Object.freeze({
    ...definition,
    id: routeId,
    feedstocks: Object.freeze({ ...(definition.feedstocks || {}) }),
    diagramInputs: Object.freeze({ ...(definition.diagramInputs || {}) }),
    market: definition.market ? Object.freeze({ ...definition.market }) : null,
  });
}

function normalizePresetDefinition(definition = {}) {
  return Object.freeze({
    ...definition,
    values: Object.freeze({ ...(definition.values || {}) }),
  });
}

function normalizeModuleDefinition(definition = {}) {
  const routeEntries = Object.entries(definition.routes || {});
  const routes = Object.freeze(
    Object.fromEntries(routeEntries.map(([routeId, routeDefinition]) => [
      routeId,
      normalizeRouteDefinition(routeId, routeDefinition),
    ]))
  );
  const presets = Object.freeze(
    (definition.presets || []).map(normalizePresetDefinition)
  );
  const routeOptions = Object.freeze(
    (definition.routeOptions || routeEntries.map(([routeId, routeDefinition]) => ({
      value: routeId,
      label: routeDefinition.label || routeId,
    }))).map(option => Object.freeze({ ...option }))
  );
  const routeDependencies = Object.freeze(
    Object.fromEntries(
      Object.entries(definition.routeDependencies || {}).map(([routeId, dependencies]) => [
        routeId,
        Object.freeze([...(dependencies || [])]),
      ])
    )
  );

  return Object.freeze({
    kind: 'core',
    defaultEnabled: false,
    defaultBufferEnabled: false,
    order: 0,
    ...definition,
    exploratory: Boolean(definition.exploratory),
    maturity: definition.exploratory ? 'Exploratory' : 'Supported',
    configs: Object.freeze([...(definition.configs || [])]),
    dependencies: Object.freeze([...(definition.dependencies || [])]),
    presets,
    defaultPreset: presets.some(preset => preset.value === definition.defaultPreset)
      ? definition.defaultPreset
      : (presets[0]?.value || null),
    routeDependencies,
    routeOptions,
    routes,
    missingInputs: Object.freeze([...(definition.missingInputs || [])]),
    diagramInputs: Object.freeze({ ...(definition.diagramInputs || {}) }),
    market: definition.market ? Object.freeze({ ...definition.market }) : null,
    defaultRoute: definition.defaultRoute || routeOptions[0]?.value || null,
  });
}

const MODULE_CATALOG = Object.freeze([
  normalizeModuleDefinition({
    id: 'electrolyzer',
    label: 'Electrolyzer',
    family: 'air-water-chemistry',
    exploratory: false,
    kind: 'core',
    defaultEnabled: true,
    assetLifeKey: 'electrolyzerAssetLife',
    defaultAssetLife: 7,
    presets: [
      {
        value: 'terraform-default',
        label: 'Terraform',
        values: {
          electrolyzerEfficiency: 79,
          electrolyzerCapex: 100,
        },
      },
      {
        value: 'alkaline',
        label: 'Alkaline',
        values: {
          electrolyzerEfficiency: 55,
          electrolyzerCapex: 1300,
        },
      },
      {
        value: 'pem',
        label: 'PEM',
        values: {
          electrolyzerEfficiency: 53,
          electrolyzerCapex: 2100,
        },
      },
      {
        value: 'soec',
        label: 'SOEC',
        values: {
          electrolyzerEfficiency: 47,
          electrolyzerCapex: 4500,
        },
      },
    ],
    defaultPreset: 'terraform-default',
    configs: [
      { key: 'electrolyzerEfficiency', label: 'Efficiency (kWh/kg H2)', type: 'range', min: 39, max: 100, step: 1, unit: 'kWh/kg', defaultValue: 79 },
      { key: 'electrolyzerCapex', label: 'CAPEX ($/kW)', type: 'range', min: 10, max: 5000, step: 10, unit: '$/kW', defaultValue: 100 },
    ],
  }),
  normalizeModuleDefinition({
    id: 'dac',
    label: 'Direct Air Capture',
    family: 'calcination-minerals',
    exploratory: false,
    kind: 'core',
    defaultEnabled: true,
    assetLifeKey: 'dacAssetLife',
    defaultAssetLife: 7,
    presets: [
      {
        value: 'terraform-default',
        label: 'Terraform',
        values: {
          dacEnergy: 3440,
          dacCapex: 450,
        },
      },
      {
        value: 'solid-dac',
        label: 'Solid DAC',
        values: {
          dacEnergy: 1500,
          dacCapex: 15600,
        },
      },
      {
        value: 'liquid-dac',
        label: 'Liquid DAC',
        values: {
          dacEnergy: 1900,
          dacCapex: 7800,
        },
      },
      {
        value: 'electro-swing-absorption',
        label: 'Electro-swing absorption',
        values: {
          dacEnergy: 655,
          dacCapex: 4700,
        },
      },
    ],
    defaultPreset: 'terraform-default',
    configs: [
      { key: 'dacEnergy', label: 'Efficiency (kWh/t-CO2)', type: 'range', min: 500, max: 5000, step: 5, unit: 'kWh/t', defaultValue: 3440 },
      { key: 'dacCapex', label: 'CAPEX ($/ton capture capacity/yr)', type: 'range', min: 50, max: 20000, step: 50, unit: '$/t-yr', defaultValue: 450 },
    ],
  }),
  normalizeModuleDefinition({
    id: 'sabatier',
    label: 'Methane (Sabatier)',
    family: 'air-water-chemistry',
    exploratory: false,
    kind: 'product',
    supportsFeedBuffer: true,
    defaultBufferEnabled: true,
    dependencies: ['electrolyzer', 'dac'],
    order: 1,
    defaultEnabled: true,
    assetLifeKey: 'sabatierAssetLife',
    defaultAssetLife: 7,
    configs: [
      { key: 'sabatierConversion', label: 'Conversion Rate (%)', type: 'range', min: 80, max: 99.5, step: 0.5, unit: '%', defaultValue: 95 },
      { key: 'sabatierCapex', label: 'CAPEX ($ per kW CH4)', type: 'range', min: 50, max: 5000, step: 50, unit: '$/kW-CH4', defaultValue: 50 },
    ],
  }),
  normalizeModuleDefinition({
    id: 'methanol',
    label: 'Methanol',
    family: 'air-water-chemistry',
    exploratory: false,
    kind: 'product',
    supportsFeedBuffer: true,
    defaultBufferEnabled: true,
    dependencies: ['electrolyzer', 'dac'],
    order: 2,
    defaultEnabled: false,
    assetLifeKey: 'methanolAssetLife',
    defaultAssetLife: 7,
    configs: [
      { key: 'methanolEfficiency', label: 'Conversion Rate (%)', type: 'range', min: 60, max: 95, step: 1, unit: '%', defaultValue: 80 },
      { key: 'methanolCapex', label: 'CAPEX ($ per kg/h feed)', type: 'range', min: 50, max: 1000, step: 5, unit: '$/kg-feed-hr', defaultValue: 385 },
    ],
  }),
  normalizeModuleDefinition({
    id: 'mtg',
    label: 'MTG (Methanol -> Gasoline)',
    family: 'air-water-chemistry',
    exploratory: true,
    defaultBufferEnabled: true,
    dependencies: ['methanol'],
    diagramInputs: {
      methanol: true,
    },
    market: {
      min: 200,
      max: 2000,
      step: 25,
      defaultValue: 900,
      label: 'Hydrocarbon sale price',
      unitLabel: '$/ton',
    },
    routes: {
      'fixed-bed': {
        label: 'Fixed-bed MTG',
        electricityKwhPerUnit: 250,
        capexPerAnnualUnit: 650,
        capexUnit: 'tpa',
        cyclingPenalty: 1.35,
        supportsFeedBuffer: true,
        feedstocks: { methanolKg: 2273 },
        feedstockSummary: 'Needs MeOH',
        outputLabel: 'Hydrocarbons',
        outputUnit: 't',
        diagramInputs: { methanol: true },
      },
      'fluid-bed': {
        label: 'Fluid-bed MTG',
        electricityKwhPerUnit: 180,
        capexPerAnnualUnit: 450,
        capexUnit: 'tpa',
        cyclingPenalty: 1.2,
        supportsFeedBuffer: true,
        feedstocks: { methanolKg: 2273 },
        feedstockSummary: 'Needs MeOH',
        outputLabel: 'Hydrocarbons',
        outputUnit: 't',
        diagramInputs: { methanol: true },
      },
    },
    missingInputs: [
      'Gasoline vs total hydrocarbon basis and LPG / fuel-gas split',
      'Durene management, recycle-gas compression, and catalyst cycle length',
      'Minimum turndown, regeneration timing, and intermittent restart behavior',
    ],
  }),
  normalizeModuleDefinition({
    id: 'carbonMonoxide',
    label: 'CO2 -> CO',
    family: 'air-water-chemistry',
    exploratory: true,
    defaultBufferEnabled: true,
    dependencies: ['dac'],
    routeDependencies: {
      rwgs: ['electrolyzer'],
    },
    market: {
      min: 100,
      max: 1500,
      step: 25,
      defaultValue: 600,
      label: 'CO sale price',
      unitLabel: '$/ton',
    },
    routes: {
      plasma: {
        label: 'Plasma route (speculative)',
        electricityKwhPerUnit: 5410,
        capexPerAnnualUnit: 750,
        capexUnit: 'tpa',
        cyclingPenalty: 1.2,
        supportsFeedBuffer: true,
        feedstocks: { co2Kg: 1570 },
        feedstockSummary: 'Needs DAC CO2',
        outputLabel: 'CO',
        outputUnit: 't',
        diagramInputs: { co2: true },
      },
      rwgs: {
        label: 'Reverse water-gas shift',
        electricityKwhPerUnit: 400,
        capexPerAnnualUnit: 250,
        capexUnit: 'tpa',
        cyclingPenalty: 1.2,
        supportsFeedBuffer: true,
        feedstocks: { co2Kg: 1570, h2Kg: 71 },
        feedstockSummary: 'Needs DAC CO2 + H2',
        outputLabel: 'CO',
        outputUnit: 't',
        diagramInputs: { co2: true, h2: true },
      },
      'low-temp-electrolysis': {
        label: 'Low-temp CO2 electrolysis',
        electricityKwhPerUnit: 9360,
        capexPerAnnualUnit: 1500,
        capexUnit: 'tpa',
        cyclingPenalty: 1.15,
        supportsFeedBuffer: true,
        feedstocks: { co2Kg: 1570 },
        feedstockSummary: 'Needs DAC CO2',
        outputLabel: 'CO',
        outputUnit: 't',
        diagramInputs: { co2: true },
      },
      'soec-coelectrolysis': {
        label: 'SOEC / co-electrolysis (developmental)',
        electricityKwhPerUnit: 7000,
        capexPerAnnualUnit: 1650,
        capexUnit: 'tpa',
        cyclingPenalty: 1.6,
        supportsFeedBuffer: true,
        feedstocks: { co2Kg: 1570 },
        feedstockSummary: 'Needs DAC CO2 + heat',
        outputLabel: 'CO',
        outputUnit: 't',
        diagramInputs: { co2: true },
      },
    },
    missingInputs: [
      'DAC CO2 recycle ratio and CO purification spec',
      'Compression pressure, optional sacrificial carbon basis, and O2 handling',
      'Stack or reactor durability under hot cycling and intermittent dispatch',
    ],
  }),
  normalizeModuleDefinition({
    id: 'ammonia',
    label: 'Ammonia',
    family: 'air-water-chemistry',
    exploratory: true,
    defaultBufferEnabled: true,
    routeDependencies: {
      'haber-bosch': ['electrolyzer'],
    },
    market: {
      min: 200,
      max: 1500,
      step: 25,
      defaultValue: 700,
      label: 'Ammonia sale price',
      unitLabel: '$/ton',
    },
    routes: {
      'haber-bosch': {
        label: 'Haber-Bosch style loop',
        electricityKwhPerUnit: 1200,
        capexPerAnnualUnit: 600,
        capexUnit: 'tpa',
        cyclingPenalty: 1.5,
        supportsFeedBuffer: true,
        feedstocks: { h2Kg: 176 },
        feedstockSummary: 'Needs H2 + N2',
        outputLabel: 'NH3',
        outputUnit: 't',
        diagramInputs: { h2: true },
      },
      electrochemical: {
        label: 'Electrochemical route (speculative)',
        electricityKwhPerUnit: 7000,
        capexPerAnnualUnit: 3000,
        capexUnit: 'tpa',
        cyclingPenalty: 1.1,
        feedstocks: {},
        feedstockSummary: 'Needs N2',
        outputLabel: 'NH3',
        outputUnit: 't',
        diagramInputs: {},
      },
    },
    missingInputs: [
      'ASU type, N2 compression, argon purge, and NH3 condensation basis',
      'Loop minimum turndown, H2 buffer duration, and hot-standby energy',
      'Parallel-reactor flexibility assumptions for intermittent operation',
    ],
  }),
  normalizeModuleDefinition({
    id: 'specialtyCarbon',
    label: 'Specialty Electrocarbon',
    family: 'carbon-solids',
    exploratory: true,
    market: {
      min: 200,
      max: 5000,
      step: 50,
      defaultValue: 1500,
      label: 'Specialty carbon sale price',
      unitLabel: '$/ton',
    },
    routes: {
      'molten-carbonate': {
        label: 'Molten-carbonate electrolysis',
        electricityKwhPerUnit: 3500,
        capexPerAnnualUnit: 1200,
        capexUnit: 'tpa',
        cyclingPenalty: 1.1,
        feedstocks: { co2Kg: 3670 },
        feedstockSummary: 'Needs CO2',
        outputLabel: 'Carbon',
        outputUnit: 't',
        diagramInputs: { co2: true },
      },
      'graphene-grade': {
        label: 'Graphene-grade polishing (speculative)',
        electricityKwhPerUnit: 5000,
        capexPerAnnualUnit: 2200,
        capexUnit: 'tpa',
        cyclingPenalty: 1.15,
        feedstocks: { co2Kg: 3670 },
        feedstockSummary: 'Needs CO2',
        outputLabel: 'Carbon',
        outputUnit: 't',
        diagramInputs: { co2: true },
      },
    },
    missingInputs: [
      'Carbon morphology, purity target, and post-treatment yield',
      'Oxygen credit, contamination control, and concentrated CO2 vs DAC basis',
      'Market-size limits for premium grades versus generic specialty carbon',
    ],
  }),
  normalizeModuleDefinition({
    id: 'lime',
    label: 'Lime',
    family: 'calcination-minerals',
    exploratory: true,
    market: {
      min: 50,
      max: 300,
      step: 5,
      defaultValue: 120,
      label: 'Lime sale price',
      unitLabel: '$/ton',
    },
    routes: {
      'resistive-calciner': {
        label: 'Resistive electric calciner',
        electricityKwhPerUnit: 890,
        capexPerAnnualUnit: 200,
        capexUnit: 'tpa',
        cyclingPenalty: 1.35,
        feedstocks: {},
        feedstockSummary: 'Needs limestone',
        outputLabel: 'CaO',
        outputUnit: 't',
        diagramInputs: {},
      },
      'indirect-heated': {
        label: 'Indirect-heated calciner',
        electricityKwhPerUnit: 980,
        capexPerAnnualUnit: 240,
        capexUnit: 'tpa',
        cyclingPenalty: 1.3,
        feedstocks: {},
        feedstockSummary: 'Needs limestone',
        outputLabel: 'CaO',
        outputUnit: 't',
        diagramInputs: {},
      },
    },
    missingInputs: [
      'Limestone purity, moisture, and calciner boundary definition',
      'CO2 capture / compression basis and thermal-storage assumptions',
      'Hot-idle behavior for solar-only dispatch',
    ],
  }),
  normalizeModuleDefinition({
    id: 'cement',
    label: 'Cement',
    family: 'calcination-minerals',
    exploratory: true,
    market: {
      min: 50,
      max: 250,
      step: 5,
      defaultValue: 100,
      label: 'Cement / clinker sale price',
      unitLabel: '$/ton',
    },
    routes: {
      'electrified-precalciner': {
        label: 'Electrified precalciner',
        electricityKwhPerUnit: 1320,
        capexPerAnnualUnit: 275,
        capexUnit: 'tpa',
        cyclingPenalty: 1.4,
        feedstocks: {},
        feedstockSummary: 'Needs raw meal',
        outputLabel: 'Clinker eq.',
        outputUnit: 't',
        diagramInputs: {},
      },
      'integrated-electric-kiln': {
        label: 'Integrated electric kiln',
        electricityKwhPerUnit: 1500,
        capexPerAnnualUnit: 325,
        capexUnit: 'tpa',
        cyclingPenalty: 1.45,
        feedstocks: {},
        feedstockSummary: 'Needs raw meal',
        outputLabel: 'Clinker eq.',
        outputUnit: 't',
        diagramInputs: {},
      },
    },
    missingInputs: [
      'Raw meal chemistry, moisture, and precalciner vs kiln boundary',
      'CO2 capture / compression basis and clinker-factor assumption',
      'Thermal storage and hot-idle behavior under intermittent solar',
    ],
  }),
  normalizeModuleDefinition({
    id: 'steel',
    label: 'Steel',
    family: 'oxide-reduction',
    exploratory: true,
    routeDependencies: {
      'h2-dri-eaf': ['electrolyzer'],
    },
    market: {
      min: 400,
      max: 1800,
      step: 10,
      defaultValue: 900,
      label: 'Steel sale price',
      unitLabel: '$/ton',
    },
    routes: {
      'h2-dri-eaf': {
        label: 'H2-DRI + EAF',
        electricityKwhPerUnit: 3800,
        capexPerAnnualUnit: 700,
        capexUnit: 'tpa',
        cyclingPenalty: 1.15,
        feedstocks: { h2Kg: 54 },
        feedstockSummary: 'Needs H2 + pellets',
        outputLabel: 'Steel',
        outputUnit: 't',
        diagramInputs: { h2: true },
      },
      'flash-ironmaking': {
        label: 'Flash ironmaking (developmental)',
        electricityKwhPerUnit: 3000,
        capexPerAnnualUnit: 550,
        capexUnit: 'tpa',
        cyclingPenalty: 1.25,
        feedstocks: {},
        feedstockSummary: 'Needs ore + reductant',
        outputLabel: 'Steel',
        outputUnit: 't',
        diagramInputs: {},
      },
      'molten-oxide-electrolysis': {
        label: 'Molten oxide electrolysis (speculative)',
        electricityKwhPerUnit: 5000,
        capexPerAnnualUnit: 2500,
        capexUnit: 'tpa',
        cyclingPenalty: 1.6,
        feedstocks: {},
        feedstockSummary: 'Needs ore + flux',
        outputLabel: 'Steel',
        outputUnit: 't',
        diagramInputs: {},
      },
    },
    missingInputs: [
      'DR-grade pellet quality, metallization target, and hot charge vs HBI',
      'Scrap fraction, oxygen use / credit, and grade-specific finishing',
      'Large H2 or HBI buffering assumptions for flexible solar operation',
    ],
  }),
  normalizeModuleDefinition({
    id: 'silicon',
    label: 'Silicon',
    family: 'oxide-reduction',
    exploratory: true,
    market: {
      min: 800,
      max: 5000,
      step: 50,
      defaultValue: 2200,
      label: 'Silicon sale price',
      unitLabel: '$/ton',
    },
    routes: {
      'electric-furnace': {
        label: 'Electric furnace route',
        electricityKwhPerUnit: 12000,
        capexPerAnnualUnit: 900,
        capexUnit: 'tpa',
        cyclingPenalty: 1.25,
        feedstocks: {},
        feedstockSummary: 'Needs quartz + C',
        outputLabel: 'Si',
        outputUnit: 't',
        diagramInputs: {},
      },
      'electrochemical-reduction': {
        label: 'Electrochemical reduction (developmental)',
        electricityKwhPerUnit: 9000,
        capexPerAnnualUnit: 1800,
        capexUnit: 'tpa',
        cyclingPenalty: 1.15,
        feedstocks: {},
        feedstockSummary: 'Needs silica',
        outputLabel: 'Si',
        outputUnit: 't',
        diagramInputs: {},
      },
    },
    missingInputs: [
      'MG-Si vs solar-grade basis, quartz purity, and reductant mix',
      'Off-gas recovery and impurity-removal boundary',
      'Electrochemical scale-up and product-quality assumptions',
    ],
  }),
  normalizeModuleDefinition({
    id: 'aluminum',
    label: 'Aluminum',
    family: 'oxide-reduction',
    exploratory: true,
    market: {
      min: 1200,
      max: 5000,
      step: 25,
      defaultValue: 2500,
      label: 'Aluminum sale price',
      unitLabel: '$/ton',
    },
    routes: {
      'hall-heroult': {
        label: 'Hall-Heroult style',
        electricityKwhPerUnit: 12500,
        capexPerAnnualUnit: 3500,
        capexUnit: 'tpa',
        cyclingPenalty: 1.8,
        feedstocks: {},
        feedstockSummary: 'Needs alumina + anodes',
        outputLabel: 'Al',
        outputUnit: 't',
        diagramInputs: {},
      },
      'novel-electrolysis': {
        label: 'Novel electrolysis (developmental)',
        electricityKwhPerUnit: 11000,
        capexPerAnnualUnit: 5000,
        capexUnit: 'tpa',
        cyclingPenalty: 1.6,
        feedstocks: {},
        feedstockSummary: 'Needs alumina',
        outputLabel: 'Al',
        outputUnit: 't',
        diagramInputs: {},
      },
    },
    missingInputs: [
      'Alumina-refinery boundary, bath chemistry, and casting losses',
      'Potline turndown, restart penalty, and anode-effect sensitivity',
      'Whether intermittent solar is realistic without major buffering',
    ],
  }),
  normalizeModuleDefinition({
    id: 'titanium',
    label: 'Titanium',
    family: 'oxide-reduction',
    exploratory: true,
    market: {
      min: 4000,
      max: 18000,
      step: 100,
      defaultValue: 10000,
      label: 'Titanium sale price',
      unitLabel: '$/ton',
    },
    routes: {
      'kroll-like': {
        label: 'Kroll-like route',
        electricityKwhPerUnit: 50000,
        capexPerAnnualUnit: 8000,
        capexUnit: 'tpa',
        cyclingPenalty: 1.4,
        feedstocks: {},
        feedstockSummary: 'Needs TiCl4 + Mg',
        outputLabel: 'Ti',
        outputUnit: 't',
        diagramInputs: {},
      },
      'ffc-cambridge': {
        label: 'FFC-style electroreduction (developmental)',
        electricityKwhPerUnit: 17000,
        capexPerAnnualUnit: 4000,
        capexUnit: 'tpa',
        cyclingPenalty: 1.2,
        feedstocks: {},
        feedstockSummary: 'Needs TiO2',
        outputLabel: 'Ti',
        outputUnit: 't',
        diagramInputs: {},
      },
    },
    missingInputs: [
      'TiCl4 boundary, Mg / MgCl2 recycle, and oxygen spec',
      'Sponge vs powder vs ingot basis with remelting boundary',
      'Batch cycle time versus continuous electroreduction assumptions',
    ],
  }),
  normalizeModuleDefinition({
    id: 'desalination',
    label: 'Desalination',
    family: 'water-systems',
    exploratory: true,
    market: {
      min: 0.25,
      max: 10,
      step: 0.25,
      defaultValue: 1.5,
      label: 'Water sale price',
      unitLabel: '$/m3',
    },
    routes: {
      'reverse-osmosis': {
        label: 'Seawater reverse osmosis',
        electricityKwhPerUnit: 2.2,
        capexPerAnnualUnit: 1500,
        capexUnit: 'm3pd',
        cyclingPenalty: 1.05,
        feedstocks: {},
        feedstockSummary: 'Needs saline water',
        outputLabel: 'Water',
        outputUnit: 'm3',
        diagramInputs: {},
      },
      electrodialysis: {
        label: 'Brackish-water electrodialysis',
        electricityKwhPerUnit: 0.8,
        capexPerAnnualUnit: 900,
        capexUnit: 'm3pd',
        cyclingPenalty: 1.02,
        feedstocks: {},
        feedstockSummary: 'Needs brackish water',
        outputLabel: 'Water',
        outputUnit: 'm3',
        diagramInputs: {},
      },
      thermal: {
        label: 'Thermal MED / MSF',
        electricityKwhPerUnit: 14,
        capexPerAnnualUnit: 3200,
        capexUnit: 'm3pd',
        cyclingPenalty: 1.25,
        feedstocks: {},
        feedstockSummary: 'Needs saline water',
        outputLabel: 'Water',
        outputUnit: 'm3',
        diagramInputs: {},
      },
    },
    missingInputs: [
      'Feed TDS, recovery ratio, and pretreatment intensity',
      'Energy-recovery-device assumptions and scaling / fouling behavior',
      'Brine discharge cost and whether the source is seawater or brackish',
    ],
  }),
]);

const MODULE_CATALOG_BY_ID = Object.freeze(
  Object.fromEntries(MODULE_CATALOG.map(module => [module.id, module]))
);

function resolveModule(moduleOrId) {
  if (typeof moduleOrId === 'string') {
    return MODULE_CATALOG_BY_ID[moduleOrId] || null;
  }
  return moduleOrId || null;
}

const EXPLORATORY_ROUTE_LIBRARY = Object.freeze(
  Object.fromEntries(
    MODULE_CATALOG
      .filter(module => module.exploratory)
      .map(module => [module.id, Object.freeze({ routes: module.routes || {} })])
  )
);

const EXPLORATORY_MARKET_CONFIG = Object.freeze(
  Object.fromEntries(
    MODULE_CATALOG
      .filter(module => module.exploratory && module.market)
      .map(module => [module.id, module.market])
  )
);

const ModuleCatalog = Object.freeze({
  getAll() {
    return MODULE_CATALOG;
  },

  getById(moduleId) {
    return MODULE_CATALOG_BY_ID[moduleId] || null;
  },

  list(filters = {}) {
    return MODULE_CATALOG.filter(module => {
      if (Object.prototype.hasOwnProperty.call(filters, 'exploratory') && module.exploratory !== Boolean(filters.exploratory)) {
        return false;
      }
      if (filters.family && module.family !== filters.family) return false;
      if (filters.kind && module.kind !== filters.kind) return false;
      if (Object.prototype.hasOwnProperty.call(filters, 'hasRoutes') && this.hasRoutes(module) !== Boolean(filters.hasRoutes)) {
        return false;
      }
      if (Object.prototype.hasOwnProperty.call(filters, 'hasMarket') && this.hasMarket(module) !== Boolean(filters.hasMarket)) {
        return false;
      }
      return true;
    });
  },

  getSupportedModules() {
    return MODULE_CATALOG.filter(module => !module.exploratory);
  },

  getExploratoryModules() {
    return MODULE_CATALOG.filter(module => module.exploratory);
  },

  resolve(moduleOrId) {
    return resolveModule(moduleOrId);
  },

  isExploratory(moduleOrId) {
    return Boolean(resolveModule(moduleOrId)?.exploratory);
  },

  hasRoutes(moduleOrId) {
    return Object.keys(resolveModule(moduleOrId)?.routes || {}).length > 0;
  },

  hasPresets(moduleOrId) {
    return (resolveModule(moduleOrId)?.presets || []).length > 0;
  },

  getPresets(moduleOrId) {
    return resolveModule(moduleOrId)?.presets || [];
  },

  getPreset(moduleOrId, presetValue = null) {
    const module = resolveModule(moduleOrId);
    if (!module) return null;

    const presets = module.presets || [];
    if (!presets.length) return null;
    if (presetValue) {
      return presets.find(preset => preset.value === presetValue) || null;
    }
    return presets.find(preset => preset.value === module.defaultPreset) || presets[0] || null;
  },

  getMatchingPreset(moduleOrId, state = {}) {
    return this.getPresets(moduleOrId).find(preset =>
      Object.entries(preset.values || {}).every(([stateKey, expectedValue]) => {
        const actualValue = Number(state?.[stateKey]);
        const targetValue = Number(expectedValue);
        return Number.isFinite(actualValue)
          && Number.isFinite(targetValue)
          && Math.abs(actualValue - targetValue) <= 1e-9;
      })
    ) || null;
  },

  isPresetConfigField(moduleOrId, configKey) {
    return this.getPresets(moduleOrId).some(
      preset => Object.prototype.hasOwnProperty.call(preset.values || {}, configKey)
    );
  },

  getRouteOptions(moduleOrId) {
    return resolveModule(moduleOrId)?.routeOptions || [];
  },

  getDefaultRoute(moduleOrId) {
    return resolveModule(moduleOrId)?.defaultRoute || null;
  },

  getRouteConfig(moduleOrId, route = null) {
    const module = resolveModule(moduleOrId);
    if (!module) return null;

    const routes = module.routes || {};
    if (route && routes[route]) return routes[route];

    const fallbackRoute = module.defaultRoute;
    return fallbackRoute ? routes[fallbackRoute] || null : null;
  },

  getMarketConfig(moduleOrId, route = null) {
    return this.getRouteConfig(moduleOrId, route)?.market || resolveModule(moduleOrId)?.market || null;
  },

  hasMarket(moduleOrId, route = null) {
    return Boolean(this.getMarketConfig(moduleOrId, route));
  },

  getConfigFields(moduleOrId) {
    return resolveModule(moduleOrId)?.configs || [];
  },

  getAssetLifeKey(moduleOrId) {
    return resolveModule(moduleOrId)?.assetLifeKey || null;
  },

  getDefaultAssetLife(moduleOrId) {
    return resolveModule(moduleOrId)?.defaultAssetLife ?? 7;
  },

  getMissingInputs(moduleOrId) {
    return resolveModule(moduleOrId)?.missingInputs || [];
  },

  getDependencies(moduleOrId, state = {}) {
    const module = resolveModule(moduleOrId);
    if (!module) return [];

    const dependencies = new Set(module.dependencies || []);
    const route = state?.[`${module.id}Route`] || module.defaultRoute;
    const routeDependencies = module.routeDependencies?.[route];
    if (Array.isArray(routeDependencies)) {
      routeDependencies.forEach(dependencyId => dependencies.add(dependencyId));
    }

    return Array.from(dependencies);
  },

  getFamilyLabel(familyKey) {
    return MODULE_FAMILY_LABELS[familyKey] || familyKey;
  },

  groupByFamily(modules = MODULE_CATALOG) {
    return modules.reduce((groups, module) => {
      const familyKey = module.family || 'other';
      groups[familyKey] = groups[familyKey] || [];
      groups[familyKey].push(module);
      return groups;
    }, {});
  },

  getExploratoryRouteLibrary() {
    return EXPLORATORY_ROUTE_LIBRARY;
  },

  getExploratoryMarketConfigMap() {
    return EXPLORATORY_MARKET_CONFIG;
  },
});

const MODULE_REGISTRY = ModuleCatalog.getAll();
