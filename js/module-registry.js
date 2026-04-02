/* ============================================
   Module registry metadata
   ============================================ */

const MODULE_REGISTRY = [
  {
    id: 'electrolyzer',
    label: 'Electrolyzer',
    family: 'air-water-chemistry',
    maturity: 'Supported',
    kind: 'core',
    defaultEnabled: true,
    assetLifeKey: 'electrolyzerAssetLife',
    defaultAssetLife: 7,
    configs: [
      { key: 'electrolyzerEfficiency', label: 'Efficiency (kWh/kg H2)', type: 'range', min: 39, max: 100, step: 1, unit: 'kWh/kg', defaultValue: 79 },
      { key: 'electrolyzerCapex', label: 'CAPEX ($/kW)', type: 'range', min: 10, max: 5000, step: 10, unit: '$/kW', defaultValue: 100 },
    ],
  },
  {
    id: 'dac',
    label: 'Direct Air Capture',
    family: 'calcination-minerals',
    maturity: 'Supported',
    kind: 'core',
    defaultEnabled: true,
    assetLifeKey: 'dacAssetLife',
    defaultAssetLife: 7,
    configs: [
      { key: 'dacEnergy', label: 'Efficiency (kWh/t-CO2)', type: 'range', min: 500, max: 5000, step: 5, unit: 'kWh/t', defaultValue: 3440 },
      { key: 'dacCapex', label: 'CAPEX ($/kW)', type: 'range', min: 50, max: 20000, step: 50, unit: '$/kW', defaultValue: 450 },
    ],
  },
  {
    id: 'sabatier',
    label: 'Methane (Sabatier)',
    family: 'air-water-chemistry',
    maturity: 'Supported',
    kind: 'product',
    dependencies: ['electrolyzer', 'dac'],
    order: 1,
    defaultEnabled: true,
    assetLifeKey: 'sabatierAssetLife',
    defaultAssetLife: 7,
    configs: [
      { key: 'sabatierConversion', label: 'Conversion Rate (%)', type: 'range', min: 80, max: 99.5, step: 0.5, unit: '%', defaultValue: 99 },
      { key: 'sabatierCapex', label: 'CAPEX ($ per kg/h feed)', type: 'range', min: 20, max: 500, step: 5, unit: '$/kg-feed-hr', defaultValue: 120 },
    ],
  },
  {
    id: 'methanol',
    label: 'Methanol',
    family: 'air-water-chemistry',
    maturity: 'Supported',
    kind: 'product',
    dependencies: ['electrolyzer', 'dac'],
    order: 2,
    defaultEnabled: false,
    assetLifeKey: 'methanolAssetLife',
    defaultAssetLife: 7,
    configs: [
      { key: 'methanolEfficiency', label: 'Conversion Rate (%)', type: 'range', min: 60, max: 95, step: 1, unit: '%', defaultValue: 80 },
      { key: 'methanolCapex', label: 'CAPEX ($ per kg/h feed)', type: 'range', min: 50, max: 1000, step: 5, unit: '$/kg-feed-hr', defaultValue: 385 },
    ],
  },
  {
    id: 'mtg',
    label: 'MTG (Methanol -> Gasoline)',
    family: 'air-water-chemistry',
    maturity: 'Exploratory',
    dependencies: ['methanol'],
    diagramInputs: {
      methanol: true,
    },
    routeOptions: [
      { value: 'fixed-bed', label: 'Fixed-bed MTG' },
      { value: 'fluid-bed', label: 'Fluid-bed MTG' },
    ],
    missingInputs: [
      'Gasoline vs total hydrocarbon basis and LPG / fuel-gas split',
      'Durene management, recycle-gas compression, and catalyst cycle length',
      'Minimum turndown, regeneration timing, and intermittent restart behavior',
    ],
  },
  {
    id: 'carbonMonoxide',
    label: 'CO2 -> CO',
    family: 'air-water-chemistry',
    maturity: 'Exploratory',
    dependencies: ['dac'],
    routeDependencies: {
      rwgs: ['electrolyzer'],
    },
    routeOptions: [
      { value: 'plasma', label: 'Plasma route (speculative)' },
      { value: 'rwgs', label: 'Reverse water-gas shift' },
      { value: 'low-temp-electrolysis', label: 'Low-temp CO2 electrolysis' },
      { value: 'soec-coelectrolysis', label: 'SOEC / co-electrolysis (developmental)' },
    ],
    missingInputs: [
      'DAC CO2 recycle ratio and CO purification spec',
      'Compression pressure, optional sacrificial carbon basis, and O2 handling',
      'Stack or reactor durability under hot cycling and intermittent dispatch',
    ],
  },
  {
    id: 'ammonia',
    label: 'Ammonia',
    family: 'air-water-chemistry',
    maturity: 'Exploratory',
    routeDependencies: {
      'haber-bosch': ['electrolyzer'],
    },
    routeOptions: [
      { value: 'haber-bosch', label: 'Haber-Bosch style loop' },
      { value: 'electrochemical', label: 'Electrochemical route (speculative)' },
    ],
    missingInputs: [
      'ASU type, N2 compression, argon purge, and NH3 condensation basis',
      'Loop minimum turndown, H2 buffer duration, and hot-standby energy',
      'Parallel-reactor flexibility assumptions for intermittent operation',
    ],
  },
  {
    id: 'specialtyCarbon',
    label: 'Specialty Electrocarbon',
    family: 'carbon-solids',
    maturity: 'Exploratory',
    routeOptions: [
      { value: 'molten-carbonate', label: 'Molten-carbonate electrolysis' },
      { value: 'graphene-grade', label: 'Graphene-grade polishing (speculative)' },
    ],
    missingInputs: [
      'Carbon morphology, purity target, and post-treatment yield',
      'Oxygen credit, contamination control, and concentrated CO2 vs DAC basis',
      'Market-size limits for premium grades versus generic specialty carbon',
    ],
  },
  {
    id: 'lime',
    label: 'Lime',
    family: 'calcination-minerals',
    maturity: 'Exploratory',
    routeOptions: [
      { value: 'resistive-calciner', label: 'Resistive electric calciner' },
      { value: 'indirect-heated', label: 'Indirect-heated calciner' },
    ],
    missingInputs: [
      'Limestone purity, moisture, and calciner boundary definition',
      'CO2 capture / compression basis and thermal-storage assumptions',
      'Hot-idle behavior for solar-only dispatch',
    ],
  },
  {
    id: 'cement',
    label: 'Cement',
    family: 'calcination-minerals',
    maturity: 'Exploratory',
    routeOptions: [
      { value: 'electrified-precalciner', label: 'Electrified precalciner' },
      { value: 'integrated-electric-kiln', label: 'Integrated electric kiln' },
    ],
    missingInputs: [
      'Raw meal chemistry, moisture, and precalciner vs kiln boundary',
      'CO2 capture / compression basis and clinker-factor assumption',
      'Thermal storage and hot-idle behavior under intermittent solar',
    ],
  },
  {
    id: 'steel',
    label: 'Steel',
    family: 'oxide-reduction',
    maturity: 'Exploratory',
    routeDependencies: {
      'h2-dri-eaf': ['electrolyzer'],
    },
    routeOptions: [
      { value: 'h2-dri-eaf', label: 'H2-DRI + EAF' },
      { value: 'flash-ironmaking', label: 'Flash ironmaking (developmental)' },
      { value: 'molten-oxide-electrolysis', label: 'Molten oxide electrolysis (speculative)' },
    ],
    missingInputs: [
      'DR-grade pellet quality, metallization target, and hot charge vs HBI',
      'Scrap fraction, oxygen use / credit, and grade-specific finishing',
      'Large H2 or HBI buffering assumptions for flexible solar operation',
    ],
  },
  {
    id: 'silicon',
    label: 'Silicon',
    family: 'oxide-reduction',
    maturity: 'Exploratory',
    routeOptions: [
      { value: 'electric-furnace', label: 'Electric furnace route' },
      { value: 'electrochemical-reduction', label: 'Electrochemical reduction (developmental)' },
    ],
    missingInputs: [
      'MG-Si vs solar-grade basis, quartz purity, and reductant mix',
      'Off-gas recovery and impurity-removal boundary',
      'Electrochemical scale-up and product-quality assumptions',
    ],
  },
  {
    id: 'aluminum',
    label: 'Aluminum',
    family: 'oxide-reduction',
    maturity: 'Exploratory',
    routeOptions: [
      { value: 'hall-heroult', label: 'Hall-Heroult style' },
      { value: 'novel-electrolysis', label: 'Novel electrolysis (developmental)' },
    ],
    missingInputs: [
      'Alumina-refinery boundary, bath chemistry, and casting losses',
      'Potline turndown, restart penalty, and anode-effect sensitivity',
      'Whether intermittent solar is realistic without major buffering',
    ],
  },
  {
    id: 'titanium',
    label: 'Titanium',
    family: 'oxide-reduction',
    maturity: 'Exploratory',
    routeOptions: [
      { value: 'kroll-like', label: 'Kroll-like route' },
      { value: 'ffc-cambridge', label: 'FFC-style electroreduction (developmental)' },
    ],
    missingInputs: [
      'TiCl4 boundary, Mg / MgCl2 recycle, and oxygen spec',
      'Sponge vs powder vs ingot basis with remelting boundary',
      'Batch cycle time versus continuous electroreduction assumptions',
    ],
  },
  {
    id: 'desalination',
    label: 'Desalination',
    family: 'water-systems',
    maturity: 'Exploratory',
    routeOptions: [
      { value: 'reverse-osmosis', label: 'Seawater reverse osmosis' },
      { value: 'electrodialysis', label: 'Brackish-water electrodialysis' },
      { value: 'thermal', label: 'Thermal MED / MSF' },
    ],
    missingInputs: [
      'Feed TDS, recovery ratio, and pretreatment intensity',
      'Energy-recovery-device assumptions and scaling / fouling behavior',
      'Brine discharge cost and whether the source is seawater or brackish',
    ],
  },
];
