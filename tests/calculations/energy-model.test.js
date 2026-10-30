/*
 * Energy-model physics: clear-sky irradiance, mounting multipliers vs
 * PVGIS, lunar polar geometry, planetary constants and site lookups.
 * Expected values are independent references (published formulas, PVGIS
 * v5.3 outputs, conservation laws), not snapshots of the model.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { LOCATION_PRESETS, PLANETARY_BODIES } from '../../js/data/reference-data.js';
import { SolarGeometry } from '../../js/model/solar-geometry.js';
import { Calc, createState, runScenario } from './harness.js';

const close = (actual, expected, tolerance, label) => assert.ok(
  Math.abs(actual - expected) <= tolerance,
  `${label}: expected ${expected} ± ${tolerance}, got ${actual}`
);
const within = (actual, min, max, label) => assert.ok(
  actual >= min && actual <= max,
  `${label}: expected within [${min}, ${max}], got ${actual}`
);
const sum = series => Array.from(series || []).reduce((total, value) => total + value, 0);

function solarFor(overrides) {
  return Calc.calculateSolar(Calc.normalizeState(createState(overrides)));
}

test('clear-sky DNI follows Meinel: 1353 * 0.7^(AM^0.678)', () => {
  within(SolarGeometry.clearSkyDNI(1), 850, 1050, 'DNI at AM1');
  within(SolarGeometry.clearSkyDNI(2), 700, 900, 'DNI at AM2');
  // AM2: 2^0.678 = 1.6000, 0.7^1.6000 = 0.56514 -> 1353 * 0.56514 = 764.6 W/m2.
  close(SolarGeometry.clearSkyDNI(2), 764.6, 0.5, 'DNI at AM2 (hand-derived)');
  // Clear-sky diffuse is 10% of DNI; GHI = DNI sin(elev) + DHI.
  const sky = SolarGeometry.skyIrradiance(90, 1, 1);
  close(sky.dhi / sky.dni, 0.1, 1e-12, 'clear-sky DHI/DNI');
  close(sky.ghi, sky.dni + sky.dhi, 1e-9, 'GHI at zenith');
});

test('beam-to-diffuse conversion reproduces the requested annual diffuse fraction and conserves GHI', () => {
  [0.2, 0.55].forEach(target => {
    const t = SolarGeometry.beamTransmittanceForDiffuseFraction(51.5, target);
    let ghi = 0;
    let dhi = 0;
    let ghiClear = 0;
    for (let day = 8; day <= 365; day += 15) {
      const decl = SolarGeometry.declination(day);
      for (let step = 0; step < 48; step++) {
        const hourAngle = (((step + 0.5) / 2) - 12) * 15 * SolarGeometry.DEG;
        const elev = SolarGeometry.solarElevation(51.5 * SolarGeometry.DEG, decl, hourAngle) / SolarGeometry.DEG;
        const sky = SolarGeometry.skyIrradiance(elev, SolarGeometry.extraterrestrialFactor(day), t);
        const clear = SolarGeometry.skyIrradiance(elev, SolarGeometry.extraterrestrialFactor(day), 1);
        ghi += (sky.dni * Math.sin(elev * SolarGeometry.DEG)) + sky.dhi;
        dhi += sky.dhi;
        ghiClear += clear.ghi;
      }
    }
    close(dhi / ghi, target, 1e-6, `annual diffuse fraction for target ${target}`);
    close(ghi, ghiClear, 1e-6 * ghiClear, 'GHI conserved by the beam-to-diffuse split');
  });
});

// PVGIS v5.3 PVcalc (14% loss, retrieved 2026-10-30): E-W 8 deg / optimal
// fixed = 0.848 Mojave, 0.823 London; unlimited single-axis 1.30 Mojave. Our
// tracker is limited to +/-60 deg and backtracks at GCR 0.30, so it sits below
// PVGIS's unconstrained figure but inside the plausible range.
test('mounting multipliers match PVGIS reference ranges', () => {
  const mojave = { latitude: 35.05, longitude: -117.6 };
  const london = { latitude: 51.51, longitude: -0.13 };
  within(solarFor({ ...mojave, mountingType: 'ew' }).yieldMult, 0.83, 0.90, 'Mojave E-W');
  within(solarFor({ ...mojave, mountingType: 'single' }).yieldMult, 1.18, 1.30, 'Mojave single-axis');
  within(solarFor({ ...mojave, mountingType: 'dual' }).yieldMult, 1.35, 1.50, 'Mojave dual-axis (PVGIS 1.46)');
  within(solarFor({ ...london, mountingType: 'ew' }).yieldMult, 0.80, 0.88, 'London E-W');
  within(solarFor({ ...london, mountingType: 'single' }).yieldMult, 1.05, 1.16, 'London single-axis (PVGIS 1.14)');
  assert.equal(solarFor({ ...mojave, mountingType: 'fixed' }).yieldMult, 1, 'Fixed tilt is the base-yield reference');
  // Trackers gain less where diffuse light dominates.
  assert.ok(
    solarFor({ ...london, mountingType: 'single' }).yieldMult < solarFor({ ...mojave, mountingType: 'single' }).yieldMult,
    'Tracker gain should shrink at a cloudy high-latitude site'
  );
});

test('modeled optimal fixed tilt lands near the PVGIS optimum', () => {
  // PVGIS optimal slopes: Mojave 34 deg, London 40 deg, Madrid 37 deg.
  [[35.05, -117.6, 34], [51.51, -0.13, 40], [40.42, -3.7, 37]].forEach(([latitude, longitude, pvgisTilt]) => {
    const solar = solarFor({ latitude, longitude, mountingType: 'fixed' });
    within(solar.skyModel.fixedTiltDeg, pvgisTilt - 6, pvgisTilt + 3, `optimal tilt at ${latitude}`);
  });
});

test('Earth preset yields are consistent with irradiation (no flat 0.82 x GHI)', () => {
  LOCATION_PRESETS.filter(preset => !preset.body).forEach(preset => {
    // Yield per unit GHI = performance ratio (~0.73-0.81) x tilt gain (1-1.25).
    within(preset.baseYield / preset.ghi, 0.72, 1.0, `${preset.name} yield/GHI`);
    within(preset.diffuseFraction ?? 0.4, 0.1, 0.7, `${preset.name} diffuse fraction`);
  });
  const london = LOCATION_PRESETS.find(preset => preset.name.startsWith('London'));
  assert.ok(london.baseYield / london.ghi > 0.9, 'Cool, steep-tilt sites yield more than 0.9 x GHI (PVGIS: 0.956)');
});

test('estimated Earth yield tracks PVGIS away from presets', () => {
  // London latitude and PVGIS GHI, but 10 deg east so no preset matches:
  // PVGIS gives 1023 kWh/kWp at London itself.
  const estimate = Calc.estimateBaseYield(51.51, 10, 1070, 'earth');
  close(estimate, 1023, 1023 * 0.07, 'estimated London-latitude yield');
});

test('planetary presets do not imply a performance ratio above 1', () => {
  const mars = LOCATION_PRESETS.find(preset => preset.body === 'mars');
  assert.ok(mars.baseYield < mars.ghi, 'Mars yield must stay below horizontal irradiation');
  const moon = LOCATION_PRESETS.find(preset => preset.body === 'moon');
  // Nameplate-capped: at most every lit hour at nameplate (~85-90% of 8760 h).
  assert.ok(moon.baseYield <= 0.9 * 8760, 'Lunar PEL yield cannot exceed nameplate x lit hours');
  assert.ok(moon.baseYield < moon.ghi, 'Lunar PEL yield below sun-facing irradiation');
});

// At ~89.5 S the Sun circles ~1 deg above the horizon once per lunation.
// Average cos(incidence) over azimuth phi: sun-pointing panel 1; vertical
// panel facing one way (1/pi) ~ 0.318; horizontal-axis tracker limited to
// 60 deg: sin(60) x 2/pi ~ 0.55; 8 deg E-W rack: sin(8)/pi + sin(1)/2 ~ 0.053.
test('lunar polar mounting factors follow grazing-sun geometry', () => {
  close(SolarGeometry.lunarPolarMountingFactor('dual'), 1, 1e-12, 'PEL sun-pointing reference');
  close(SolarGeometry.lunarPolarMountingFactor('fixed'), 1 / Math.PI, 0.03, 'PEL vertical fixed panel');
  within(SolarGeometry.lunarPolarMountingFactor('single'), 0.45, 0.6, 'PEL horizontal-axis tracker');
  within(SolarGeometry.lunarPolarMountingFactor('ew'), 0.03, 0.08, 'PEL low-tilt E-W rack');
  const pel = runScenario({ body: 'moon', latitude: -89.5, longitude: 0, solarProfileModel: 'lunar-pel', siteYieldMwhPerMwdcYear: 7400, mountingType: 'ew' });
  within(pel.solar.yieldMult, 0.03, 0.08, 'PEL E-W multiplier in the scenario');
});

test('planetary constants match published values', () => {
  const mars = PLANETARY_BODIES.mars.orbit;
  assert.equal(mars.axialTiltDeg, 25.19);
  assert.equal(mars.perihelionLsDeg, 251);
  assert.equal(mars.solarConstant, 586);
  // Eclipse year 346.62 d / synodic month 29.53 d = 11.74 lunations.
  close(PLANETARY_BODIES.moon.orbit.orbitalDays, 346.62 / 29.530589, 0.01, 'lunar declination cycle (lunations)');
  // Flux peaks at perihelion: scan Ls and find the maximum.
  let best = { flux: 0, ls: 0 };
  for (let day = 1; day <= 669; day += 0.25) {
    const season = SolarGeometry.planetarySeasonState({ seasonalDay: day, ...mars });
    if (season.solarFlux > best.flux) best = { flux: season.solarFlux, ls: season.solarLongitudeDeg };
  }
  close(best.ls, 251, 0.5, 'Mars Ls of peak solar flux');
});

test('site lookups use the nearest preset and respect an explicit zero yield', () => {
  // Mojave (35.05, -117.6) is also within the box of Los Angeles (34.05, -118.24).
  assert.equal(Calc.getNearbyPreset(35.05, -117.6).name, 'Mojave Desert, CA');
  assert.equal(Calc.getNearbyPreset(34.1, -118.2).name, 'Los Angeles, CA');
  const zero = solarFor({ siteYieldMwhPerMwdcYear: 0 });
  assert.equal(zero.annualMWh, 0, 'An explicit 0 MWh/MWdc-yr yield stays 0');
  assert.equal(solarFor({ systemSizeMW: 0 }).capacityFactor, 0, 'CF is 0, not NaN, for a 0 MW plant');
});

