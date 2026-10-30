/* ============================================
   Model assumptions and heuristics
   ============================================
   Fixed numeric assumptions the calculation engine uses that are not user
   inputs. User-adjustable defaults live in state/schema.js instead. */

export const SQUARE_METERS_PER_ACRE = 4047;

export const MODEL_ASSUMPTIONS = {
  // Annual yield (kWh/kWp) per unit of annual GHI (kWh/m2) when no site
  // yield is given: a typical performance ratio.
  fallbackYieldFromGhi: 0.82,
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
  // Exploratory route asset life (years) when the route defines none.
  exploratoryAssetLifeYears: 10,
  // tCO2 avoided per MCF of fossil natural gas displaced.
  fossilGasEmissionsPerMCF: 0.053,
  // Displayed land-productivity multiple vs. corn ethanol when methane is
  // produced (an illustrative constant, not computed from the scenario).
  landProductivityVsCornFactor: 20,
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

/* Earth yield adjustment per mounting type, added to MOUNTING_TYPES[].yieldMult:
   latitudeSlope * latitudeFactor + cloudinessSlope * cloudiness, where
   latitudeFactor ramps 0 -> 1 over 20-45 deg |lat|. Fixed tilt has none. */
export const MOUNTING_YIELD_ADJUSTMENTS = {
  ew: { latitudeSlope: -0.02, cloudinessSlope: 0.08 },
  single: { latitudeSlope: 0.05, cloudinessSlope: -0.18 },
  dual: { latitudeSlope: 0.07, cloudinessSlope: -0.15 },
};

/* Reference site the layout/BOS adjustments are relative to (Mojave-like). */
export const SOLAR_LAYOUT_REFERENCE = {
  latitude: 35.05,
  winterNoonElevationDeg: 31.51,
  cloudiness: 0.05,
};
