/* ============================================
   Reference data and presets
   ============================================
   Planetary bodies, site presets, mounting types, chemistry constants,
   methane market notes and AI datacenter defaults. Fixed model heuristics
   live in data/assumptions.js. */

export const PLANETARY_BODIES = {
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
    // Orbital parameters for the seasonal irradiance model (orbitalDays is
    // the Mars year in sols; Ls = areocentric solar longitude). Obliquity
    // 25.19 deg, perihelion at Ls ~251 deg, mean top-of-atmosphere solar
    // constant 586 W/m2 (NASA Mars fact sheet; Allison & McEwen 2000).
    orbit: {
      orbitalDays: 668.6,
      axialTiltDeg: 25.19,
      solarConstant: 586,
      diffuseFraction: 0,
      eccentricity: 0.093377,
      perihelionLsDeg: 251,
    },
    chartNote: 'Representative average local-sol profile; annual dispatch includes modeled Mars orbital seasonality. Annual economics remain normalized to an Earth year.',
    siteYieldNote: 'Mars presets use a rough annual-yield benchmark (horizontal irradiation x ~0.85 performance ratio, dust deposition not modeled); Earth cloud datasets and latitude heuristics are disabled.',
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
    // Seasonal cycle for the generic (non-polar) lunar profile, counted in
    // local cycles (lunations): the Sun's declination seen from the Moon
    // (amplitude = 1.54 deg obliquity to the ecliptic) repeats with the
    // eclipse (draconic) year, 346.62 d = 11.74 synodic months.
    orbit: {
      orbitalDays: 11.74,
      axialTiltDeg: 1.54,
      solarConstant: 1361,
      diffuseFraction: 0,
    },
    chartNote: 'Representative south-polar ridge profile: mostly-on illumination with terrain-shadow dips and brief outages, not a clean two-week day/night cycle. The Sun circles within ~1.5 deg of the horizon, so only near-vertical, sun-facing panels capture it well; low-tilt racks see almost nothing. Annual economics remain normalized to an Earth year.',
    siteYieldNote: 'Lunar polar yield is relative to vertical sun-tracking panels: ~85% of the time lit by 1361 W/m2, with output capped at DC nameplate. Earth cloud datasets and latitude heuristics are disabled.',
  },
};

/* Site presets. `baseYield` (MWh/MWdc/yr) is the yield of the reference
   mounting the mounting multipliers are relative to: on Earth and Mars a
   fixed, equator-facing array at its optimal tilt; at the lunar
   peak-of-eternal-light (PEL) vertical, sun-tracking panels. `ghi` is
   annual irradiation (kWh/m2/yr) on a horizontal surface, except at the
   lunar PEL where it is on a sun-facing surface (the Sun grazes the horizon).

   Earth: baseYield = PVGIS v5.3 PVcalc E_y, crystalline-Si, 14% system loss,
   free-standing, optimal tilt facing the equator; ghi = PVGIS H(i)_y at 0 deg
   tilt (SARAH3 where covered, otherwise ERA5). Retrieved 2026-10-30 from
   https://re.jrc.ec.europa.eu/api/v5_3/PVcalc. `diffuseFraction` = annual
   DIF / GHI from the Global Solar Atlas long-term averages (Solargis v2.2,
   api.globalsolaratlas.info, retrieved 2026-10-30); Reykjavik is outside its
   coverage and uses the cloudy-region estimate. For Mojave, GSA's PVOUT
   (2034) is ~3% above PVGIS-ERA5 (1974); PVGIS is kept for consistency.

   Mars (Noctis Labyrinthus, 7 S): top-of-atmosphere horizontal irradiation
   at the equator ~ 586 W/m2 / pi x 8766 h ~ 1640 kWh/m2 per Earth year; a
   clear-season dusty atmosphere (optical depth ~0.5) passes ~70% of it
   (Appelbaum & Flood 1990), ~1150 kWh/m2; x 0.85 performance ratio ~ 980.

   Moon PEL: 1361 W/m2 x 0.85 illuminated x 8760 h ~ 10,130 kWh/m2/yr on a
   sun-facing plane. While lit, a panel rated 1 kW at STC (1000 W/m2) sees
   1.36x that irradiance and, after AM0 spectral mismatch (~0.95), hot
   panels (~0.90) and wiring (~0.98), would deliver ~1.14 kW; the model
   caps output at DC nameplate (inverter loading ratio 1), so the yield is
   ~nameplate x the lit hours of the terrain profile ~ 7,400. */
export const LOCATION_PRESETS = [
  {
    name: 'Mars - Noctis Labyrinthus',
    body: 'mars',
    profile: 'mars-average',
    lat: -7.0,
    lon: -102.0,
    ghi: 1150,
    baseYield: 980,
    region: 'planetary',
  },
  {
    name: 'Moon - South Pole Peak of Eternal Light',
    body: 'moon',
    profile: 'lunar-pel',
    lat: -89.5,
    lon: 0.0,
    ghi: 10130,
    baseYield: 7400,
    region: 'planetary',
  },
  { name: 'Los Angeles, CA', lat: 34.05, lon: -118.24, ghi: 2041, baseYield: 1782, diffuseFraction: 0.273, region: 'desert' },
  { name: 'Phoenix, AZ', lat: 33.45, lon: -112.07, ghi: 2145, baseYield: 1831, diffuseFraction: 0.225, region: 'desert' },
  { name: 'Mojave Desert, CA', lat: 35.05, lon: -117.60, ghi: 2199, baseYield: 1974, diffuseFraction: 0.196, region: 'desert' },
  { name: 'Atacama, Chile', lat: -24.50, lon: -69.25, ghi: 2664, baseYield: 2311, diffuseFraction: 0.145, region: 'desert' },
  { name: 'Sahara (Algeria)', lat: 30.05, lon: 2.88, ghi: 2268, baseYield: 1941, diffuseFraction: 0.357, region: 'desert' },
  { name: 'Rajasthan, India', lat: 26.92, lon: 70.90, ghi: 2109, baseYield: 1771, diffuseFraction: 0.438, region: 'desert' },
  { name: 'Pilbara, Australia', lat: -22.30, lon: 118.30, ghi: 2211, baseYield: 1787, diffuseFraction: 0.186, region: 'desert' },
  { name: 'Dubai, UAE', lat: 25.20, lon: 55.27, ghi: 2172, baseYield: 1722, diffuseFraction: 0.416, region: 'desert' },
  { name: 'Austin, TX', lat: 30.27, lon: -97.74, ghi: 1727, baseYield: 1451, diffuseFraction: 0.386, region: 'temperate' },
  { name: 'Denver, CO', lat: 39.74, lon: -104.99, ghi: 1886, baseYield: 1834, diffuseFraction: 0.297, region: 'temperate' },
  { name: 'Miami, FL', lat: 25.76, lon: -80.19, ghi: 1855, baseYield: 1529, diffuseFraction: 0.365, region: 'tropical' },
  { name: 'Madrid, Spain', lat: 40.42, lon: -3.70, ghi: 1779, baseYield: 1620, diffuseFraction: 0.325, region: 'temperate' },
  { name: 'Berlin, Germany', lat: 52.52, lon: 13.41, ghi: 1109, baseYield: 1053, diffuseFraction: 0.525, region: 'cloudy' },
  { name: 'London, UK', lat: 51.51, lon: -0.13, ghi: 1070, baseYield: 1023, diffuseFraction: 0.558, region: 'cloudy' },
  { name: 'Tokyo, Japan', lat: 35.68, lon: 139.69, ghi: 1391, baseYield: 1284, diffuseFraction: 0.474, region: 'temperate' },
  { name: 'Nairobi, Kenya', lat: -1.29, lon: 36.82, ghi: 1996, baseYield: 1521, diffuseFraction: 0.440, region: 'tropical' },
  { name: 'São Paulo, Brazil', lat: -23.55, lon: -46.63, ghi: 1678, baseYield: 1362, diffuseFraction: 0.456, region: 'tropical' },
  { name: 'Beijing, China', lat: 39.90, lon: 116.40, ghi: 1587, baseYield: 1546, diffuseFraction: 0.521, region: 'temperate' },
  { name: 'Reykjavik, Iceland', lat: 64.15, lon: -21.94, ghi: 729, baseYield: 703, region: 'cloudy' },
  { name: 'Cape Town, SA', lat: -33.93, lon: 18.42, ghi: 1954, baseYield: 1730, diffuseFraction: 0.285, region: 'temperate' },
];

/* On Earth the mounting yield multiplier is derived from the model's own
   sky geometry (solar.js getMountingYieldMultiplier); at the lunar PEL from
   the polar sun geometry. `yieldMult` is the fallback table for the other
   off-Earth profiles (Mars, generic Moon), relative to fixed tilt. The
   spacing and BOS sensitivities scale layout and balance-of-system cost with
   latitude and cloudiness relative to SOLAR_LAYOUT_REFERENCE. */
export const MOUNTING_TYPES = {
  fixed: {
    label: 'Fixed Tilt',
    yieldMult: 1.0,
    groundCoverageRatio: 0.45,
    typicalBOS: 0.20,
    spacingLatitudeSensitivity: 0.45,
    spacingCloudRelief: 0.08,
    bosLayoutSensitivity: 0.30,
    bosLatitudeSensitivity: 0.06,
    bosCloudSensitivity: 0.02,
    note: 'Simple baseline for generic utility-scale PV.',
  },
  ew: {
    label: 'East-West Fixed',
    yieldMult: 0.92,
    groundCoverageRatio: 0.75,
    typicalBOS: 0.12,
    spacingLatitudeSensitivity: 0.18,
    spacingCloudRelief: 0.10,
    bosLayoutSensitivity: 0.20,
    bosLatitudeSensitivity: 0.03,
    bosCloudSensitivity: 0.01,
    note: 'High-density low-tilt layout inspired by PEG-style systems with a broader two-shoulder daily profile.',
  },
  single: {
    label: 'Single-Axis Tracker',
    yieldMult: 1.18,
    groundCoverageRatio: 0.30,
    typicalBOS: 0.35,
    spacingLatitudeSensitivity: 0.60,
    spacingCloudRelief: 0.15,
    bosLayoutSensitivity: 0.35,
    bosLatitudeSensitivity: 0.08,
    bosCloudSensitivity: 0.04,
    note: 'Higher yield, higher BOS, more land, stronger weather dependence, and a flatter tracked daily profile.',
  },
  dual: {
    label: 'Dual-Axis Tracker',
    yieldMult: 1.28,
    groundCoverageRatio: 0.22,
    typicalBOS: 0.55,
    spacingLatitudeSensitivity: 0.55,
    spacingCloudRelief: 0.12,
    bosLayoutSensitivity: 0.32,
    bosLatitudeSensitivity: 0.08,
    bosCloudSensitivity: 0.03,
    note: 'Comparison only. Not part of the Terraform-style thesis.',
  },
};

export const CHEMISTRY = {
  electrolysis: {
    // Thermoneutral (HHV, enthalpy) energy of water splitting, kWh/kg H2:
    // no electrolyzer at or above 100% HHV efficiency can use less without
    // external heat. The reversible (Gibbs) minimum is 32.7 kWh/kg.
    thermoneutralKwhPerKg: 39.4,
    reversibleMinimumKwhPerKg: 32.7,
    h2EnergyContent: 33.33,
    // Stoichiometric water (18.02 / 2.016 = 8.94 kg/kg H2); feed water incl.
    // purification rejects is MODEL_ASSUMPTIONS.electrolysisFeedWaterPerKgH2.
    waterPerKgH2: 9,
  },
  dac: {
    co2MolarMass: 44.01,
    // NOAA GML Mauna Loa annual mean, 2025: 427.35 ppm
    // (https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_annmean_mlo.txt, retrieved 2026-10).
    atmosphericCO2ppm: 427,
    calcinationTemp: 900,
  },
  sabatier: {
    ch4MolarMass: 16.04,
    ch4PerMCF: 19.25,
    ch4LhvKwhPerKg: 13.9,
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

export const METHANE_MARKET_PRESETS = {
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

export const AI_COMPUTE_DEFAULTS = {
  capexPerKW: 50000,
  assetLifeYears: 5,
  omPercent: 4,
};

export const AI_RELIABILITY_OPTIONS = [
  { value: 90, label: '90.0%' },
  { value: 95, label: '95.0%' },
  { value: 99, label: '99.0%' },
  { value: 99.5, label: '99.5%' },
  { value: 99.9, label: '99.9%' },
  { value: 99.95, label: '99.95%' },
  { value: 99.99, label: '99.99%' },
];
