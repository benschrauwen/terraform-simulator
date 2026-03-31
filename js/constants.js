/* ============================================
   Constants, presets, and reference data
   ============================================ */

const PLANETARY_BODIES = {
  earth: {
    label: 'Earth',
    cycleHours: 24,
    cyclesPerEarthYear: 365,
    cycleUnit: 'day',
    cycleUnitCompact: 'day',
    hoursPerCycleLabel: 'hrs/day',
    chartLabelMode: 'clock',
    supportsSpecificDay: true,
    chartNote: '',
    siteYieldNote: 'For more accurate Earth output, use a cloud/weather-adjusted source such as PVGIS or Global Solar Atlas PVOUT.',
  },
  mars: {
    label: 'Mars',
    cycleHours: 24.66,
    cyclesPerEarthYear: 355,
    cycleUnit: 'sol',
    cycleUnitCompact: 'sol',
    hoursPerCycleLabel: 'hrs/sol',
    chartLabelMode: 'clock',
    supportsSpecificDay: false,
    chartNote: 'Representative average local-sol profile; annual dispatch includes modeled Mars orbital seasonality. Annual economics remain normalized to an Earth year.',
    siteYieldNote: 'Mars presets use literature-inspired annual-yield benchmarks; Earth cloud datasets and latitude heuristics are disabled.',
  },
  moon: {
    label: 'Moon',
    cycleHours: 708.7,
    cyclesPerEarthYear: 12.37,
    cycleUnit: 'lunar cycle',
    cycleUnitCompact: 'cycle',
    hoursPerCycleLabel: 'hrs/cycle',
    chartLabelMode: 'days',
    supportsSpecificDay: false,
    chartNote: 'Representative south-polar ridge profile: mostly-on illumination with terrain-shadow dips and brief outages, not a clean two-week day/night cycle. Mounting still matters because the Sun stays low on the horizon. Annual economics remain normalized to an Earth year.',
    siteYieldNote: 'Lunar presets use literature-inspired annual-yield benchmarks; Earth cloud datasets and latitude heuristics are disabled.',
  },
};

const LOCATION_PRESETS = [
  {
    name: 'Mars - Noctis Labyrinthus',
    body: 'mars',
    profile: 'mars-average',
    lat: -7.0,
    lon: -102.0,
    ghi: 900,
    baseYield: 1150,
    region: 'planetary',
  },
  {
    name: 'Moon - South Pole Peak of Eternal Light',
    body: 'moon',
    profile: 'lunar-pel',
    lat: -89.5,
    lon: 0.0,
    ghi: 3200,
    baseYield: 3000,
    region: 'planetary',
  },
  { name: 'Los Angeles, CA', lat: 34.05, lon: -118.24, ghi: 2050, baseYield: 1680, region: 'desert' },
  { name: 'Phoenix, AZ', lat: 33.45, lon: -112.07, ghi: 2380, baseYield: 1940, region: 'desert' },
  { name: 'Mojave Desert, CA', lat: 35.05, lon: -117.60, ghi: 2450, baseYield: 2050, region: 'desert' },
  { name: 'Atacama, Chile', lat: -24.50, lon: -69.25, ghi: 2800, baseYield: 2300, region: 'desert' },
  { name: 'Sahara (Algeria)', lat: 30.05, lon: 2.88, ghi: 2500, baseYield: 2100, region: 'desert' },
  { name: 'Rajasthan, India', lat: 26.92, lon: 70.90, ghi: 2200, baseYield: 1820, region: 'desert' },
  { name: 'Pilbara, Australia', lat: -22.30, lon: 118.30, ghi: 2400, baseYield: 1980, region: 'desert' },
  { name: 'Dubai, UAE', lat: 25.20, lon: 55.27, ghi: 2150, baseYield: 1780, region: 'desert' },
  { name: 'Austin, TX', lat: 30.27, lon: -97.74, ghi: 1900, baseYield: 1550, region: 'temperate' },
  { name: 'Denver, CO', lat: 39.74, lon: -104.99, ghi: 1950, baseYield: 1640, region: 'temperate' },
  { name: 'Miami, FL', lat: 25.76, lon: -80.19, ghi: 1800, baseYield: 1475, region: 'tropical' },
  { name: 'Madrid, Spain', lat: 40.42, lon: -3.70, ghi: 1850, baseYield: 1530, region: 'temperate' },
  { name: 'Berlin, Germany', lat: 52.52, lon: 13.41, ghi: 1050, baseYield: 890, region: 'cloudy' },
  { name: 'London, UK', lat: 51.51, lon: -0.13, ghi: 950, baseYield: 790, region: 'cloudy' },
  { name: 'Tokyo, Japan', lat: 35.68, lon: 139.69, ghi: 1350, baseYield: 1120, region: 'temperate' },
  { name: 'Nairobi, Kenya', lat: -1.29, lon: 36.82, ghi: 2000, baseYield: 1660, region: 'tropical' },
  { name: 'São Paulo, Brazil', lat: -23.55, lon: -46.63, ghi: 1600, baseYield: 1320, region: 'tropical' },
  { name: 'Beijing, China', lat: 39.90, lon: 116.40, ghi: 1400, baseYield: 1180, region: 'temperate' },
  { name: 'Reykjavik, Iceland', lat: 64.15, lon: -21.94, ghi: 750, baseYield: 620, region: 'cloudy' },
  { name: 'Cape Town, SA', lat: -33.93, lon: 18.42, ghi: 1950, baseYield: 1620, region: 'temperate' },
];

const MOUNTING_TYPES = {
  fixed: {
    label: 'Fixed Tilt',
    yieldMult: 1.0,
    landPacking: 1.0,
    windRating: '130 mph',
    typicalBOS: 0.20,
    note: 'Simple baseline for generic utility-scale PV.',
  },
  ew: {
    label: 'East-West Fixed',
    yieldMult: 0.92,
    landPacking: 2.25,
    windRating: '180 mph (vendor claim class)',
    typicalBOS: 0.12,
    note: 'High-density low-tilt layout inspired by PEG-style systems with a broader two-shoulder daily profile.',
  },
  single: {
    label: 'Single-Axis Tracker',
    yieldMult: 1.18,
    landPacking: 0.90,
    windRating: '120 mph',
    typicalBOS: 0.35,
    note: 'Higher yield, higher BOS, more land, stronger weather dependence, and a flatter tracked daily profile.',
  },
  dual: {
    label: 'Dual-Axis Tracker',
    yieldMult: 1.28,
    landPacking: 0.60,
    windRating: '90 mph',
    typicalBOS: 0.55,
    note: 'Comparison only. Not part of the Terraform-style thesis.',
  },
};

const CHEMISTRY = {
  electrolysis: {
    theoreticalMinimum: 39.4,
    h2EnergyContent: 33.33,
    waterPerKgH2: 9,
  },
  dac: {
    co2MolarMass: 44.01,
    atmosphericCO2ppm: 420,
    calcinationTemp: 900,
  },
  sabatier: {
    ch4MolarMass: 16.04,
    ch4PerMCF: 19.25,
    h2MassPerKgCH4: 0.503,
    co2MassPerKgCH4: 2.744,
    waterPerKgCH4: 2.25,
  },
  methanol: {
    molarMass: 32.04,
    h2MassPerKgMeOH: 0.189,
    co2MassPerKgMeOH: 1.374,
    waterPerKgMeOH: 0.562,
    density: 0.792,
  },
};

const POLICY_CREDITS = {
  us_45v_tier4: 3.00,
  us_45v_tier3: 1.00,
  us_45v_tier2: 0.75,
  us_45v_tier1: 0.60,
  us_45q_utilization: 130,
  us_45q_sequestration: 180,
};

const POLICY_OPTIONS = {
  none: {
    label: 'No policy credits',
    applicability: 'None selected',
    basis: 'Pure market revenue only',
    note: 'No federal production credits are applied. US 45V and 45Q presets are available under Policy Mode when you want to explore those cases.',
    stackingRule: 'No policy credit selected',
    useCustomH2: false,
    useCustomCo2: false,
  },
  us_45v_tier4: {
    label: 'US 45V clean H2 - Tier 4',
    applicability: 'United States',
    basis: 'Top-tier 45V credit, modeled at $3.00/kg H2 for eligible hydrogen production over 10 years',
    note: 'Use this only for top-tier US clean hydrogen cases. Treasury final rules require lifecycle qualification plus incrementality, deliverability, and temporal matching for EAC-based electrolytic claims.',
    stackingRule: 'Modeled as mutually exclusive with US 45Q for the same facility',
    h2Credit: POLICY_CREDITS.us_45v_tier4,
    useCustomH2: false,
    useCustomCo2: false,
    durationYears: 10,
  },
  us_45v_tier3: {
    label: 'US 45V clean H2 - Tier 3',
    applicability: 'United States',
    basis: 'Mid-tier 45V credit, modeled at $1.00/kg H2 for 0.45-1.5 kg CO2e/kg H2 cases',
    note: 'Use when the US project qualifies for the third 45V emissions tier rather than the top tier.',
    stackingRule: 'Modeled as mutually exclusive with US 45Q for the same facility',
    h2Credit: POLICY_CREDITS.us_45v_tier3,
    useCustomH2: false,
    useCustomCo2: false,
    durationYears: 10,
  },
  us_45v_tier2: {
    label: 'US 45V clean H2 - Tier 2',
    applicability: 'United States',
    basis: 'Mid-tier 45V credit, modeled at $0.75/kg H2 for 1.5-2.5 kg CO2e/kg H2 cases',
    note: 'Use when the US project qualifies for the second 45V emissions tier.',
    stackingRule: 'Modeled as mutually exclusive with US 45Q for the same facility',
    h2Credit: POLICY_CREDITS.us_45v_tier2,
    useCustomH2: false,
    useCustomCo2: false,
    durationYears: 10,
  },
  us_45v_tier1: {
    label: 'US 45V clean H2 - Tier 1',
    applicability: 'United States',
    basis: 'Entry-tier 45V credit, modeled at $0.60/kg H2 for 2.5-4.0 kg CO2e/kg H2 cases',
    note: 'Use when the US project qualifies for the first 45V emissions tier.',
    stackingRule: 'Modeled as mutually exclusive with US 45Q for the same facility',
    h2Credit: POLICY_CREDITS.us_45v_tier1,
    useCustomH2: false,
    useCustomCo2: false,
    durationYears: 10,
  },
  us_45q_utilization: {
    label: 'US 45Q DAC utilization',
    applicability: 'United States',
    basis: 'DAC utilization credit modeled at $130/t-CO2 for qualifying US projects',
    note: 'This is the post-IRA DAC utilization value commonly cited by Terraform for US projects that use captured CO2 rather than sequestering it.',
    stackingRule: 'Modeled as mutually exclusive with US 45V for the same facility',
    co2Credit: POLICY_CREDITS.us_45q_utilization,
    useCustomH2: false,
    useCustomCo2: false,
  },
  us_45q_sequestration: {
    label: 'US 45Q DAC sequestration',
    applicability: 'United States',
    basis: 'DAC sequestration credit modeled at $180/t-CO2 for qualifying US projects',
    note: 'Use this only for US sequestration cases, not for methane synthesis or other CO2 utilization pathways.',
    stackingRule: 'Modeled as mutually exclusive with US 45V for the same facility',
    co2Credit: POLICY_CREDITS.us_45q_sequestration,
    useCustomH2: false,
    useCustomCo2: false,
  },
  eu_hydrogen_bank: {
    label: 'EU Hydrogen Bank premium',
    applicability: 'European Union; 2026 auction rounds also include Germany and Spain top-up budgets via Auctions-as-a-Service',
    basis: 'User-entered fixed premium on verified hydrogen production for up to 10 years',
    note: 'This is not a single statutory EU-wide amount. Enter your assumed bid premium in the model currency; early winning bids were far below the ceiling and country top-ups still flow through the auction mechanism.',
    stackingRule: 'Modeled here as one bid-based H2 premium rather than a stack of separate EU and member-state credits',
    useCustomH2: true,
    useCustomCo2: false,
    h2InputLabel: 'EU H2 Premium ($/kg equivalent)',
    durationYears: 10,
  },
  custom: {
    label: 'Custom / country-specific credits',
    applicability: 'User-defined',
    basis: 'User-entered H2 and CO2 credits for country-specific or stacked cases',
    note: 'Use this for country programs or contract structures that are not captured by the named US and EU presets.',
    stackingRule: 'Custom mode can stack user-defined H2 and CO2 credits',
    useCustomH2: true,
    useCustomCo2: true,
    h2InputLabel: 'Custom H2 Credit ($/kg)',
    co2InputLabel: 'Custom CO2 Credit ($/ton)',
  },
};

const METHANE_MARKET_PRESETS = {
  terraform_commodity: {
    label: 'Commodity gas / whitepaper-style case',
    applicability: 'Generic / multi-country',
    basis: 'Simple sale-price assumption for commodity methane; Terraform public materials often illustrate a roughly $10/MCF case before incentives',
    note: 'Use this when you want an unsubsidized commodity-gas framing rather than a country-specific biomethane support regime.',
  },
  premium_green_methane: {
    label: 'Premium synthetic / green methane offtake',
    applicability: 'Generic / voluntary premium markets',
    basis: 'Sale-price assumption for premium synthetic methane, biomethane, or low-carbon gas contracts',
    note: 'Use this for premium offtake scenarios such as green gas contracts. The slider should capture the net realized methane value.',
  },
  germany_biomethane_eeg: {
    label: 'Germany biomethane auction / EEG',
    applicability: 'Germany',
    basis: 'Bundesnetzagentur EEG biomethane auction framework; country-specific and tender-based rather than one universal methane subsidy',
    note: 'Germany has a specific biomethane tender framework, but it does not translate cleanly into one fixed $/MCF credit here. Keep the methane sale price manual and use the note as a country context label.',
  },
  netherlands_sdepp: {
    label: 'Netherlands renewable gas / SDE++',
    applicability: 'Netherlands',
    basis: 'SDE++ operating support for renewable gas injected into the network; effectively a difference-style support structure tied to market value',
    note: 'This is a Netherlands-specific operating support scheme rather than a single flat methane premium. Use the slider for your assumed net realized methane value or supported equivalent.',
  },
  denmark_green_gas_tender: {
    label: 'Denmark green gas tender',
    applicability: 'Denmark',
    basis: 'Danish Energy Agency tender framework for upgraded biogas and e-methane delivered to the gas grid',
    note: 'This is a Denmark-specific bid-based support structure with long support periods, so the app leaves the methane price manual instead of inventing a single default premium.',
  },
};

const MODEL_ASSUMPTIONS = {
  fallbackYieldFromGhi: 0.82,
  batteryNominalLifeYears: 12,
  batteryMonthlyLeakage: 0.02,
  fossilGasEmissionsPerMCF: 0.053,
};

const AI_COMPUTE_DEFAULTS = {
  capexPerKW: 50000,
  assetLifeYears: 5,
  omPercent: 4,
};

const AI_RELIABILITY_OPTIONS = [
  { value: 90, label: '90.0%' },
  { value: 95, label: '95.0%' },
  { value: 99, label: '99.0%' },
  { value: 99.5, label: '99.5%' },
  { value: 99.9, label: '99.9%' },
  { value: 99.95, label: '99.95%' },
  { value: 99.99, label: '99.99%' },
];

const MODULE_REGISTRY = [
  {
    id: 'electrolyzer',
    label: 'Electrolyzer',
    family: 'air-water-chemistry',
    maturity: 'Supported',
    kind: 'core',
    defaultEnabled: true,
    assetLifeKey: 'electrolyzerAssetLife',
    configs: [
      { key: 'electrolyzerEfficiency', label: 'Efficiency (kWh/kg H2)', type: 'range', min: 39, max: 100, step: 1, unit: 'kWh/kg' },
      { key: 'electrolyzerCapex', label: 'CAPEX ($/kW)', type: 'range', min: 10, max: 500, step: 10, unit: '$/kW' },
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
    configs: [
      { key: 'dacEnergy', label: 'Energy (kWh/t-CO2)', type: 'range', min: 1000, max: 5000, step: 100, unit: 'kWh/t' },
      { key: 'dacCapex', label: 'CAPEX ($/t-yr capacity)', type: 'range', min: 100, max: 2000, step: 50, unit: '$/t-yr' },
    ],
  },
  {
    id: 'sabatier',
    label: 'Methane (Sabatier)',
    family: 'air-water-chemistry',
    maturity: 'Supported',
    kind: 'product',
    order: 1,
    defaultEnabled: true,
    assetLifeKey: 'sabatierAssetLife',
    configs: [
      { key: 'sabatierConversion', label: 'Conversion Rate (%)', type: 'range', min: 80, max: 99.5, step: 0.5, unit: '%' },
      { key: 'sabatierCapex', label: 'Reactor CAPEX ($ per kg/h feed)', type: 'range', min: 20, max: 500, step: 5, unit: '$/kg-feed-hr' },
    ],
  },
  {
    id: 'methanol',
    label: 'Methanol',
    family: 'air-water-chemistry',
    maturity: 'Supported',
    kind: 'product',
    order: 2,
    defaultEnabled: false,
    assetLifeKey: 'methanolAssetLife',
    configs: [
      { key: 'methanolEfficiency', label: 'Conversion Efficiency (%)', type: 'range', min: 60, max: 95, step: 1, unit: '%' },
      { key: 'methanolCapex', label: 'Reactor CAPEX ($ per kg/h feed)', type: 'range', min: 50, max: 1000, step: 5, unit: '$/kg-feed-hr' },
    ],
  },
  {
    id: 'carbonMonoxide',
    label: 'CO2 -> CO',
    family: 'air-water-chemistry',
    maturity: 'Exploratory',
    routeOptions: [
      { value: 'plasma-splitting', label: 'Plasma CO2 splitting' },
      { value: 'solid-oxide-electrolysis', label: 'Solid oxide CO2 electrolysis' },
      { value: 'rwgs', label: 'Reverse water-gas shift' },
    ],
    missingInputs: [
      'Specific energy use and single-pass conversion by route',
      'CO purification/compression and O2 or syngas handling assumptions',
      'Reactor durability and CAPEX scaling for intermittent operation',
    ],
  },
  {
    id: 'ammonia',
    label: 'Ammonia',
    family: 'air-water-chemistry',
    maturity: 'Exploratory',
    routeOptions: [
      { value: 'haber-bosch', label: 'Haber-Bosch style loop' },
      { value: 'electrochemical', label: 'Electrochemical route' },
    ],
    missingInputs: [
      'N2 separation and compression assumptions',
      'Loop pressure, recycle, and conversion basis',
      'Reactor CAPEX scaling for intermittent operation',
    ],
  },
  {
    id: 'coke',
    label: 'Coke / Graphite / Graphene',
    family: 'carbon-solids',
    maturity: 'Exploratory',
    routeOptions: [
      { value: 'electrochemical-carbon', label: 'Electrochemical carbon deposition' },
      { value: 'thermal-carbon', label: 'Thermal carbon formation' },
    ],
    missingInputs: [
      'Target carbon product grade and yield',
      'Faradaic or thermal efficiency assumptions',
      'Byproduct oxygen handling and reactor CAPEX',
    ],
  },
  {
    id: 'cement',
    label: 'Cement / Lime',
    family: 'calcination-minerals',
    maturity: 'Exploratory',
    routeOptions: [
      { value: 'electrified-calciner', label: 'Electrified calciner' },
      { value: 'cyclonic-calciner', label: 'Cyclonic calciner' },
    ],
    missingInputs: [
      'Kiln or calciner energy intensity',
      'Feed purity and throughput assumptions',
      'CO2 treatment and final product pricing',
    ],
  },
  {
    id: 'steel',
    label: 'Steel',
    family: 'oxide-reduction',
    maturity: 'Exploratory',
    routeOptions: [
      { value: 'h2-dri-eaf', label: 'H2-DRI + EAF' },
      { value: 'flash-ironmaking', label: 'Flash ironmaking' },
      { value: 'molten-oxide-electrolysis', label: 'Molten oxide electrolysis' },
    ],
    missingInputs: [
      'Ore grade and reductant basis',
      'Furnace and downstream melting CAPEX',
      'Scrap usage and product mix assumptions',
    ],
  },
  {
    id: 'silicon',
    label: 'Silicon',
    family: 'oxide-reduction',
    maturity: 'Exploratory',
    routeOptions: [
      { value: 'electric-furnace', label: 'Electric furnace route' },
      { value: 'electrochemical-reduction', label: 'Electrochemical reduction' },
    ],
    missingInputs: [
      'Feed purity and product grade',
      'Energy intensity by route',
      'Furnace or cell CAPEX scaling',
    ],
  },
  {
    id: 'aluminum',
    label: 'Aluminum',
    family: 'oxide-reduction',
    maturity: 'Exploratory',
    routeOptions: [
      { value: 'hall-heroult', label: 'Hall-Heroult style' },
      { value: 'novel-electrolysis', label: 'Novel electrolysis' },
    ],
    missingInputs: [
      'Current efficiency and anode consumption',
      'Alumina feed assumptions',
      'Cell CAPEX and intermittent operation behavior',
    ],
  },
  {
    id: 'titanium',
    label: 'Titanium',
    family: 'oxide-reduction',
    maturity: 'Exploratory',
    routeOptions: [
      { value: 'kroll-like', label: 'Kroll-like route' },
      { value: 'ffc-cambridge', label: 'FFC-style electroreduction' },
    ],
    missingInputs: [
      'Ore or chloride feed assumptions',
      'Batch vs continuous process basis',
      'Reductant and reactor CAPEX assumptions',
    ],
  },
  {
    id: 'desalination',
    label: 'Desalination',
    family: 'water-systems',
    maturity: 'Exploratory',
    routeOptions: [
      { value: 'reverse-osmosis', label: 'Reverse osmosis' },
      { value: 'electrodialysis', label: 'Electrodialysis' },
      { value: 'thermal', label: 'Thermal desalination' },
    ],
    missingInputs: [
      'Feed salinity and recovery ratio',
      'Pretreatment requirements',
      'Water pricing and brine handling assumptions',
    ],
  },
];

const DEFAULT_STATE = {
  loadConfigTab: 'chemicals',

  dayMode: 'average',
  dayOfYear: 172,

  body: 'earth',
  solarProfileModel: 'earth',
  latitude: 35.05,
  longitude: -117.60,
  siteYieldMwhPerMwdcYear: 2050,
  siteYieldSource: 'preset',

  systemSizeMW: 1.0,
  panelEfficiency: 20,
  panelCostPerW: 0.20,
  panelDegradationAnnual: 0.65,
  mountingType: 'ew',
  bosCostPerW: 0.12,
  landCostPerAcre: 5000,
  sitePrepCostPerAcre: 15000,

  batteryEnabled: false,
  batteryCapacityMWh: 0.0,
  batteryCostPerKWh: 150,
  batteryEfficiency: 90,
  batteryCycles: 4000,

  aiComputeEnabled: false,
  aiReliabilityTarget: 99.9,
  aiTokenPricePerM: 3.0,
  aiMillionTokensPerMWh: 1000,
  aiGpuCapexPerKW: AI_COMPUTE_DEFAULTS.capexPerKW,
  aiAssetLifeYears: AI_COMPUTE_DEFAULTS.assetLifeYears,

  electrolyzerEnabled: true,
  electrolyzerEfficiency: 79,
  electrolyzerCapex: 100,
  electrolyzerAssetLife: 7,

  dacEnabled: true,
  dacEnergy: 3440,
  dacCapex: 600,
  dacAssetLife: 7,

  sabatierEnabled: true,
  sabatierConversion: 99,
  sabatierCapex: 120,
  sabatierAssetLife: 7,

  methanolEnabled: false,
  methaneFeedstockSplit: 50,
  methanolEfficiency: 80,
  methanolCapex: 385,
  methanolAssetLife: 7,

  methaneMarketPreset: 'terraform_commodity',

  carbonMonoxideEnabled: false,
  carbonMonoxideRoute: 'plasma-splitting',

  ammoniaEnabled: false,
  ammoniaRoute: 'haber-bosch',

  cokeEnabled: false,
  cokeRoute: 'electrochemical-carbon',

  cementEnabled: false,
  cementRoute: 'electrified-calciner',

  steelEnabled: false,
  steelRoute: 'h2-dri-eaf',

  siliconEnabled: false,
  siliconRoute: 'electric-furnace',

  aluminumEnabled: false,
  aluminumRoute: 'hall-heroult',

  titaniumEnabled: false,
  titaniumRoute: 'kroll-like',

  desalinationEnabled: false,
  desalinationRoute: 'reverse-osmosis',

  methanePrice: 20,
  methanolPrice: 600,

  policyMode: 'us_45v_tier4',
  customH2Credit: 0,
  customCo2Credit: 0,

  solarAssetLife: 30,
  analysisHorizonYears: 30,
  discountRate: 8,
  financingEnabled: false,
  debtSharePercent: 70,
  debtInterestRate: 6.5,
  debtTermYears: 15,
  debtFeePercent: 1.5,

  /** Annual M&O as % of applicable CAPEX (module+BOS, process equipment, battery). */
  solarOmPercent: 1.5,
  processOmPercent: 3,
  batteryOmPercent: 1.5,
};

const SLIDER_MARKERS = {
  aiTokenPrice: [
    { value: 1, label: 'Low-value internal workload' },
    { value: 3, label: 'Balanced default case' },
    { value: 5, label: 'Higher-value inference mix' },
  ],
  aiTokensPerMWh: [
    { value: 400, label: 'Heavier models / lower throughput' },
    { value: 1000, label: 'Balanced default case' },
    { value: 1600, label: 'Lighter models / higher throughput' },
  ],
  methanePrice: [
    { value: 3, label: 'Low US spot gas' },
    { value: 10, label: 'Whitepaper commodity case' },
    { value: 20, label: 'Generic green methane case' },
    { value: 35, label: '2024 premium CH4 sale' },
  ],
  methanolPrice: [
    { value: 350, label: 'China spot price' },
    { value: 600, label: 'Europe' },
    { value: 1000, label: 'Green methanol' },
  ],
  batteryCost: [
    { value: 80, label: 'China' },
    { value: 150, label: 'Europe / US' },
  ],
  panelCost: [
    { value: 0.11, label: 'Mono-crystalline, no tariffs' },
    { value: 0.3, label: 'Mono-crystalline, with tariffs' },
  ],
  landCost: [
    { value: 2500, label: 'Cheap ag / desert land' },
    { value: 10000, label: 'Higher-value land' },
  ],
  sitePrepCost: [
    { value: 8000, label: 'Light clearing / grading' },
    { value: 20000, label: 'Heavier site prep' },
  ],
};
