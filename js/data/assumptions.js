/* ============================================
   Model assumptions and heuristics
   ============================================
   Fixed numeric assumptions the calculation engine uses that are not user
   inputs. User-adjustable defaults live in state/schema.js instead. */

export const SQUARE_METERS_PER_ACRE = 4047;

export const MODEL_ASSUMPTIONS = {
  // Estimated Earth base yield when no preset is near: annual GHI x the
  // modeled optimal-tilt plane-of-array gain x this performance ratio
  // (yield per kWh/m2 in-plane). PVGIS v5.3 at 14% system loss gives
  // 0.73 (hot desert) - 0.81 (cool, cloudy) across the Earth presets.
  fallbackPerformanceRatio: 0.78,
  // Annual diffuse fraction (DIF/GHI) for sites without a measured value:
  // clearSkyDiffuseFraction + cloudiness * diffuseFractionPerCloudiness
  // (desert ~0.20, temperate ~0.29, tropical ~0.39, overcast ~0.56, which
  // brackets the Global Solar Atlas values of the presets in each region).
  clearSkyDiffuseFraction: 0.18,
  diffuseFractionPerCloudiness: 0.38,
  // Battery calendar-life cap (years) regardless of cycle count.
  batteryNominalLifeYears: 12,
  // Battery self-discharge per average month (fraction of stored energy).
  batteryMonthlyLeakage: 0.02,
  // Annual dispatch starts from this state of charge (fraction of capacity)
  // before settling to a periodic year.
  batteryStartSocFraction: 0.5,
  // AI mode seeds storage at 1 MWh per GWh/yr of solar when none is set.
  aiBatterySeedMWhPerSolarGWh: 1,
  // A process block counts as operating in a step when it runs at or above
  // this fraction of its capacity.
  processOperatingThresholdFraction: 0.05,
  // DAC CAPEX is quoted per t-CO2/yr of capacity at this reference solar
  // utilization and applied to nameplate: capex = $/t-yr x DAC kW x 8760 h x
  // 0.25 / kWh-per-t, so the same hardware costs the same at any site.
  // Basis: Terraform Industries whitepaper 2.0 (2023-01-09) quotes DAC cost
  // per ton-year as capex over output at 25% utilization ("331 kg CO2/day
  // (25% utilization)", "$14700/T-day" = $40.35/T-year).
  dacCapexReferenceUtilization: 0.25,
  // Electrolyzer feed water per kg H2: 8.94 kg reacts (stoichiometric);
  // demineralization/RO rejects bring typical withdrawals to ~10-15 kg/kg.
  electrolysisFeedWaterPerKgH2: 12,
  // Feed-buffer pressure vessels / tanks (years); replaced on this life.
  feedBufferAssetLifeYears: 20,
  // Exploratory route asset life (years) when the route defines none.
  exploratoryAssetLifeYears: 10,
  // Combustion tCO2 per MCF of fossil methane displaced: pure CH4 at
  // 19.25 kg/MCF x 44.01/16.04 = 52.8 kg (~0.053 t). EPA's ~0.055 t/MCF is
  // for pipeline gas at ~1,036 Btu/scf (53.06 kg/MMBtu x 1.036). Upstream
  // emissions and methane leakage of the displaced gas are excluded.
  fossilGasEmissionsPerMCF: 0.0528,
  // Share of the lunar south-pole cycle with direct sun at a ridge site
  // (peak-of-eternal-light profile).
  lunarPolarIlluminatedFraction: 0.85,
};

/* Earth GHI estimate (kWh/m2/yr) used when no preset site is nearby.
   Piecewise linear in |latitude|: ghi = ghi0 + (|lat| - atAbsLatitude) * slope,
   using the first band whose maxAbsLatitude is not exceeded. */
export const GHI_LATITUDE_BANDS = [
  { maxAbsLatitude: 10, ghi0: 1950, atAbsLatitude: 0, slope: 0 },
  { maxAbsLatitude: 20, ghi0: 2100, atAbsLatitude: 20, slope: -10 },
  { maxAbsLatitude: 30, ghi0: 2000, atAbsLatitude: 30, slope: -10 },
  { maxAbsLatitude: 40, ghi0: 1700, atAbsLatitude: 30, slope: -20 },
  { maxAbsLatitude: 50, ghi0: 1400, atAbsLatitude: 40, slope: -35 },
  { maxAbsLatitude: 60, ghi0: 1050, atAbsLatitude: 50, slope: -25 },
  { maxAbsLatitude: Infinity, ghi0: 800, atAbsLatitude: 60, slope: -15 },
];

/* Subtropical desert belts get a GHI uplift (applied for 18-35 deg |lat|).
   Bounds are exclusive; missing bounds are open. */
export const ARID_GHI_REGIONS = {
  minAbsLatitude: 18,
  maxAbsLatitude: 35,
  multiplier: 1.15,
  boxes: [
    { name: 'US Southwest', minLon: -120, maxLon: -100, minLat: 25, maxLat: Infinity },
    { name: 'Sahara / Arabia', minLon: -15, maxLon: 50, minLat: 15, maxLat: 35 },
    { name: 'Thar', minLon: 65, maxLon: 80, minLat: 22, maxLat: 30 },
    { name: 'Australian interior', minLon: 115, maxLon: 135, minLat: -28, maxLat: -18 },
  ],
};

export const GHI_ESTIMATE_RANGE = { min: 600, max: 2900 };

/* Cloudiness index (0 = clear desert, 1 = persistently overcast) by preset
   region; sites without a region fall back to GHI thresholds. */
export const CLOUDINESS_BY_REGION = {
  cloudy: 1.0,
  tropical: 0.55,
  temperate: 0.30,
  desert: 0.05,
};

export const CLOUDINESS_BY_GHI = [
  { maxGhi: 1000, cloudiness: 0.95 },
  { maxGhi: 1400, cloudiness: 0.70 },
  { maxGhi: 1800, cloudiness: 0.40 },
  { maxGhi: Infinity, cloudiness: 0.10 },
];

/* Reference site the layout/BOS adjustments are relative to (Mojave-like). */
export const SOLAR_LAYOUT_REFERENCE = {
  latitude: 35.05,
  winterNoonElevationDeg: 31.51,
  cloudiness: 0.05,
};
