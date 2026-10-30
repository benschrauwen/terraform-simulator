/* ============================================
   Process module catalog (data only)
   ============================================
   Every process block the simulator knows: supported core modules
   (electrolyzer, DAC, Sabatier, methanol) and exploratory routes.
   data/module-catalog.js normalizes these definitions (defaults, frozen
   copies) and exposes the ModuleCatalog query API.

   Common fields: id, label, family (key of MODULE_FAMILY_LABELS), exploratory,
   kind, defaultEnabled, dependencies, configs (slider definitions keyed by
   state key), assetLifeKey/defaultAssetLife, presets, supportsFeedBuffer.
   Exploratory modules add `market` (sale-price slider) and `routes`, each with
   electricityKwhPerUnit, capexPerAnnualUnit + capexUnit ('tpa' | 'm3pd'),
   cyclingPenalty, feedstocks (kg per output unit) and display labels.
   To add a route or module: add an entry here; state defaults and
   normalization pick it up automatically. */

export const MODULE_FAMILY_LABELS = Object.freeze({
  'air-water-chemistry': 'Air and water chemistry',
  'carbon-solids': 'Carbon solids',
  'calcination-minerals': 'Calcination and mineral decomposition',
  'oxide-reduction': 'Oxide reduction and metallurgy',
  'water-systems': 'Water systems',
});

export const MODULE_DEFINITIONS = [
  {
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
        // 78.89 kWh/kg (whitepaper 2.0, 2023); $100/kW (Aug 2023 post). The
        // 2026 update reports a stack BOM "well below $100/kW" and demo H2 below
        // $2/kg, so $100/kW stays a conservative default:
        // https://terraformindustries.wordpress.com/2026/10/21/terraform-2026-update/
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
      // Floor 40: below the 39.4 kWh/kg HHV (thermoneutral) energy an
      // electrolyzer would exceed 100% HHV efficiency.
      { key: 'electrolyzerEfficiency', label: 'Efficiency (kWh/kg H2)', type: 'range', min: 40, max: 100, step: 1, unit: 'kWh/kg', defaultValue: 79 },
      { key: 'electrolyzerCapex', label: 'CAPEX ($/kW)', type: 'range', min: 10, max: 5000, step: 10, unit: '$/kW', defaultValue: 100, scale: 'log' },
    ],
  },
  {
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
        // 3.44 MWh/t and the $/t-yr capex basis come from whitepaper 2.0 (2023).
        // The 2026 update reports >99% CO2 from a >1,000 C calciner at an early-stage
        // internal cost "well below $200/T-CO2", with no new energy figure:
        // https://terraformindustries.wordpress.com/2026/10/21/terraform-2026-update/
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
      // $ per t-CO2/yr of capacity at 25% reference utilization, applied to
      // nameplate (see MODEL_ASSUMPTIONS.dacCapexReferenceUtilization).
      { key: 'dacCapex', label: 'CAPEX ($ per t-CO2/yr capacity at 25% utilization)', type: 'range', min: 25, max: 20000, step: 5, unit: '$/t-yr', defaultValue: 450, scale: 'log' },
    ],
  },
  {
    id: 'sabatier',
    label: 'Methane (Sabatier)',
    family: 'air-water-chemistry',
    exploratory: false,
    kind: 'product',
    supportsFeedBuffer: true,
    dependencies: ['electrolyzer', 'dac'],
    order: 1,
    defaultEnabled: true,
    assetLifeKey: 'sabatierAssetLife',
    defaultAssetLife: 7,
    configs: [
      { key: 'sabatierConversion', label: 'Conversion Rate (%)', type: 'range', min: 80, max: 99.5, step: 0.5, unit: '%', defaultValue: 95 },
      // Floor $5/kW-CH4: Terraform's whitepaper 2.0 reactor target ("internal
      // cost target for the reactor is $2500" for a ~MW-scale module) is
      // of order $10/kW-CH4.
      { key: 'sabatierCapex', label: 'CAPEX ($ per kW CH4)', type: 'range', min: 5, max: 5000, step: 5, unit: '$/kW-CH4', defaultValue: 50, scale: 'log' },
    ],
  },
  {
    id: 'methanol',
    label: 'Methanol',
    family: 'air-water-chemistry',
    exploratory: false,
    kind: 'product',
    supportsFeedBuffer: true,
    dependencies: ['electrolyzer', 'dac'],
    order: 2,
    defaultEnabled: false,
    assetLifeKey: 'methanolAssetLife',
    defaultAssetLife: 7,
    configs: [
      { key: 'methanolEfficiency', label: 'Conversion Rate (%)', type: 'range', min: 60, max: 95, step: 1, unit: '%', defaultValue: 80 },
      { key: 'methanolCapex', label: 'CAPEX ($ per kg/h feed)', type: 'range', min: 50, max: 1000, step: 5, unit: '$/kg-feed-hr', defaultValue: 385, scale: 'log' },
    ],
  },
  {
    id: 'mtg',
    label: 'MTG (Methanol -> Gasoline)',
    family: 'air-water-chemistry',
    exploratory: true,
    dependencies: ['methanol'],
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
      },
    },
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
    exploratory: true,
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
      },
    },
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
    exploratory: true,
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
        // Non-H2 electricity only (ASU, syngas/loop compression, refrigeration):
        // ~0.5-0.7 MWh/t NH3 for electrolytic plants; the H2 (176 kg/t) is
        // made upstream by the electrolyzer.
        electricityKwhPerUnit: 600,
        capexPerAnnualUnit: 600,
        capexUnit: 'tpa',
        cyclingPenalty: 1.5,
        supportsFeedBuffer: true,
        feedstocks: { h2Kg: 176 },
        feedstockSummary: 'Needs H2 + N2',
        outputLabel: 'NH3',
        outputUnit: 't',
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
      },
    },
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
        // CO2 -> C + O2 needs 393.5 kJ/mol = 9.1 MWh/t C (4 e- per C: 8.9 MWh/t
        // per cell volt). ~1.2 V cells plus heat losses at ~750 C: ~11 MWh/t.
        electricityKwhPerUnit: 11000,
        capexPerAnnualUnit: 1200,
        capexUnit: 'tpa',
        cyclingPenalty: 1.1,
        feedstocks: { co2Kg: 3670 },
        feedstockSummary: 'Needs CO2',
        outputLabel: 'Carbon',
        outputUnit: 't',
      },
      'graphene-grade': {
        label: 'Graphene-grade polishing (speculative)',
        // Molten-carbonate carbon (~11 MWh/t) plus purification/exfoliation.
        electricityKwhPerUnit: 13000,
        capexPerAnnualUnit: 2200,
        capexUnit: 'tpa',
        cyclingPenalty: 1.15,
        feedstocks: { co2Kg: 3670 },
        feedstockSummary: 'Needs CO2',
        outputLabel: 'Carbon',
        outputUnit: 't',
      },
    },
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
        // CaCO3 -> CaO + CO2 is 178 kJ/mol = 0.88 MWh/t CaO; practical
        // calciners add sensible heat and losses: ~1.1-1.4 MWh/t.
        electricityKwhPerUnit: 1250,
        capexPerAnnualUnit: 200,
        capexUnit: 'tpa',
        cyclingPenalty: 1.35,
        feedstocks: {},
        feedstockSummary: 'Needs limestone',
        outputLabel: 'CaO',
        outputUnit: 't',
      },
      'indirect-heated': {
        label: 'Indirect-heated calciner',
        // Same 0.88 MWh/t enthalpy; heat transfer through a wall costs more.
        electricityKwhPerUnit: 1400,
        capexPerAnnualUnit: 240,
        capexUnit: 'tpa',
        cyclingPenalty: 1.3,
        feedstocks: {},
        feedstockSummary: 'Needs limestone',
        outputLabel: 'CaO',
        outputUnit: 't',
      },
    },
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
      },
    },
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
        // Non-H2 electricity (EAF ~0.75 MWh/t plus H2/pellet heating); the
        // 54 kg H2/t comes from the electrolyzer. Vogl et al. 2018 (J. Clean.
        // Prod. 203:736): ~3.5 MWh/t in total, of which ~2.6 is electrolysis.
        electricityKwhPerUnit: 900,
        capexPerAnnualUnit: 700,
        capexUnit: 'tpa',
        cyclingPenalty: 1.15,
        feedstocks: { h2Kg: 54 },
        feedstockSummary: 'Needs H2 + pellets',
        outputLabel: 'Steel',
        outputUnit: 't',
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
      },
    },
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
      },
      'electrochemical-reduction': {
        label: 'Electrochemical reduction (developmental)',
        // SiO2 -> Si + O2 needs 911 kJ/mol = 9.0 MWh/t Si without a carbon
        // reductant; ~75% electrical efficiency assumed.
        electricityKwhPerUnit: 12000,
        capexPerAnnualUnit: 1800,
        capexUnit: 'tpa',
        cyclingPenalty: 1.15,
        feedstocks: {},
        feedstockSummary: 'Needs silica',
        outputLabel: 'Si',
        outputUnit: 't',
      },
    },
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
        // World-average smelter AC power, ~14 MWh/t Al (International
        // Aluminium Institute); best-in-class cells run ~12.5.
        electricityKwhPerUnit: 14000,
        capexPerAnnualUnit: 3500,
        capexUnit: 'tpa',
        cyclingPenalty: 1.8,
        feedstocks: {},
        feedstockSummary: 'Needs alumina + anodes',
        outputLabel: 'Al',
        outputUnit: 't',
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
      },
    },
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
      },
    },
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
        // Whole plant (intake, pretreatment, RO with energy recovery,
        // post-treatment): ~3-3.5 kWh/m3; the RO train alone is ~2.2.
        electricityKwhPerUnit: 3.2,
        capexPerAnnualUnit: 1500,
        capexUnit: 'm3pd',
        cyclingPenalty: 1.05,
        feedstocks: {},
        feedstockSummary: 'Needs saline water',
        outputLabel: 'Water',
        outputUnit: 'm3',
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
      },
      // Route key kept for saved links. All-electric thermal desalination is
      // mechanical vapour compression (~8-15 kWh/m3); MED/MSF at ~14 kWh/m3
      // would assume free heat (with resistive heat they need ~50-80).
      thermal: {
        label: 'Mechanical vapour compression (MVC)',
        electricityKwhPerUnit: 14,
        capexPerAnnualUnit: 3200,
        capexUnit: 'm3pd',
        cyclingPenalty: 1.25,
        feedstocks: {},
        feedstockSummary: 'Needs saline water',
        outputLabel: 'Water',
        outputUnit: 'm3',
      },
    },
    missingInputs: [
      'Feed TDS, recovery ratio, and pretreatment intensity',
      'Energy-recovery-device assumptions and scaling / fouling behavior',
      'Brine discharge cost and whether the source is seawater or brackish',
    ],
  },
];
