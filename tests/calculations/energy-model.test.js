/*
 * Energy-model physics and invariants: clear-sky irradiance, mounting
 * multipliers vs PVGIS, lunar polar geometry, annual series and dispatch
 * energy balances, sizing definitions and lifetime (degradation) vectors.
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

test('annual solar series total equals the plant annual energy', () => {
  ['fixed', 'ew', 'single', 'dual'].forEach(mountingType => {
    const result = runScenario({ mountingType });
    close(result.annualSolar.totalKWh, result.solar.annualMWh * 1000, 1e-6 * result.solar.annualMWh * 1000, `Earth ${mountingType}`);
    close(sum(result.annualSolar.hourlyKW), result.annualSolar.totalKWh, 1e-6 * result.annualSolar.totalKWh, `Earth ${mountingType} hourly sum`);
    assert.ok(Math.max(...result.annualSolar.hourlyKW) <= result.solar.peakPowerKW + 1e-9, 'Series stays at or below nameplate');
  });
  const mars = runScenario({ body: 'mars', latitude: -7, longitude: -102, solarProfileModel: 'mars-average', siteYieldMwhPerMwdcYear: 980 });
  close(mars.annualSolar.totalKWh, mars.solar.annualMWh * 1000, 1e-6 * mars.solar.annualMWh * 1000, 'Mars Earth-year series');
  close(mars.annualDispatch.solarKWh * (355 / 668.6), mars.solar.annualMWh * 1000, 1e-6 * mars.solar.annualMWh * 1000, 'Mars orbital basis, annualized');
  const moon = runScenario({ body: 'moon', latitude: -89.5, longitude: 0, solarProfileModel: 'lunar-pel', siteYieldMwhPerMwdcYear: 7400, mountingType: 'dual' });
  close(moon.annualSolar.totalKWh, moon.solar.annualMWh * 1000, 1e-6 * moon.solar.annualMWh * 1000, 'Moon PEL');
  assert.deepEqual(moon.warnings, [], 'Lunar PEL preset yield must be reachable under the nameplate cap');
});

function checkBatteryBalance(dispatch, battery, label) {
  // Stored - delivered / discharge efficiency - self-discharge = change in state of charge.
  const storedKWh = dispatch.chargeThroughputKWh;
  const drawnKWh = dispatch.dischargeThroughputKWh / battery.dischargeEff;
  close(
    storedKWh - drawnKWh - dispatch.leakageKWh,
    dispatch.endSocKWh - dispatch.startSocKWh,
    1e-6 * Math.max(1, storedKWh),
    `${label} battery SoC balance`
  );
  // Energy stored = energy drawn from solar x charge efficiency.
  close(dispatch.chargeInputKWh * battery.chargeEff, storedKWh, 1e-6 * Math.max(1, storedKWh), `${label} charge losses`);
  assert.ok(dispatch.minSocKWh >= -1e-9, `${label} SoC never negative`);
  assert.ok(dispatch.maxSocKWh <= battery.capacityKWh + 1e-6, `${label} SoC never above capacity`);
}

test('chemical dispatch conserves energy for every battery size', () => {
  [0, 1, 4, 20].forEach(batteryCapacityMWh => {
    [100, 70].forEach(chemicalSizingPercent => {
      const label = `${batteryCapacityMWh} MWh @ ${chemicalSizingPercent}%`;
      const state = Calc.normalizeState(createState({ batteryCapacityMWh, chemicalSizingPercent }));
      const result = Calc.calculateAll(state);
      const dispatch = result.annualDispatch;
      const battery = createBatteryShape(state);
      // Solar = direct use + battery charging + clipped.
      close(dispatch.solarKWh, dispatch.directToChemicalKWh + dispatch.chargeInputKWh + dispatch.clippedSolarKWh, 1e-6 * dispatch.solarKWh, `${label} solar split`);
      // Delivered = direct + battery discharge.
      close(dispatch.chemicalKWh, dispatch.directToChemicalKWh + dispatch.dischargeThroughputKWh, 1e-6 * dispatch.solarKWh, `${label} delivered`);
      assert.ok(dispatch.chemicalKWh <= dispatch.solarKWh + 1e-6, `${label} delivered <= solar`);
      assert.ok(result.chemicalSupply.effectiveCF <= 1 + 1e-12, `${label} effective CF <= 1`);
      if (batteryCapacityMWh > 0) checkBatteryBalance(dispatch, battery, label);
      // Power limit: capacity / duration per hour, both directions.
      const powerKW = (batteryCapacityMWh * 1000) / state.batteryDurationHours;
      assert.ok(Math.max(0, ...dispatch.batteryChargeHourlyKW) <= powerKW + 1e-6, `${label} charge power limit`);
      const processKW = result.chemicalSupply.processPowerKW;
      const maxDischargeKW = Math.max(0, ...dispatch.chemicalHourlyKW.map((delivered, hour) =>
        delivered - Math.min(result.annualSolar.hourlyKW[hour], processKW)));
      assert.ok(maxDischargeKW <= powerKW + 1e-6, `${label} discharge power limit`);
    });
  });
});

function createBatteryShape(state) {
  const oneWay = Math.sqrt(Math.max(state.batteryEfficiency / 100, 1e-9));
  return { capacityKWh: state.batteryCapacityMWh * 1000, chargeEff: oneWay, dischargeEff: oneWay };
}

test('AI dispatch conserves energy and meets its reliability target', () => {
  [1, 4, 20].forEach(batteryCapacityMWh => {
    const state = Calc.normalizeState(createState({ aiComputeEnabled: true, batteryCapacityMWh, aiReliabilityTarget: 95 }));
    const result = Calc.calculateAll(state);
    const dispatch = result.ai.dispatch;
    const label = `AI ${batteryCapacityMWh} MWh`;
    const aiFromSolar = dispatch.aiServedKWh - dispatch.dischargeThroughputKWh;
    close(dispatch.solarKWh, aiFromSolar + dispatch.chargeInputKWh + dispatch.chemicalKWh + dispatch.clippedSolarKWh, 1e-6 * dispatch.solarKWh, `${label} solar split`);
    checkBatteryBalance(dispatch, createBatteryShape(state), label);
    assert.ok(result.ai.fullPowerReliability >= 0.95 - 1e-12, `${label} meets the 95% target`);
    assert.ok(dispatch.aiServedKWh <= dispatch.loadKW * dispatch.hours + 1e-6, `${label} served <= demand`);
  });
});

test('an automatically seeded AI battery is reported, also after the UI writes it back', () => {
  const seeded = runScenario({ aiComputeEnabled: true, batteryCapacityMWh: 0 });
  // Seed rule: 1 MWh per GWh/yr of solar.
  close(seeded.ai.batterySeededMWh, seeded.solar.annualMWh / 1000, 1e-9, 'seeded MWh');
  close(seeded.state.batteryCapacityMWh, seeded.ai.batterySeededMWh, 1e-12, 'seeded battery in state');
  const rerun = Calc.calculateAll(seeded.state);
  close(rerun.ai.batterySeededMWh, seeded.ai.batterySeededMWh, 1e-12, 'still reported on the normalized state');
  assert.equal(runScenario({ aiComputeEnabled: true, batteryCapacityMWh: 3 }).ai.batterySeededMWh, 0, 'explicit battery is not seeded');
});

test('AI design load never shrinks as the battery grows', () => {
  let previous = -Infinity;
  [0.5, 1, 2, 4, 8, 16].forEach(batteryCapacityMWh => {
    const result = runScenario({ aiComputeEnabled: true, batteryCapacityMWh, aiReliabilityTarget: 99 });
    assert.ok(result.ai.designLoadKW >= previous - 1e-6, `design load at ${batteryCapacityMWh} MWh`);
    previous = result.ai.designLoadKW;
  });
});

test('100% chemical sizing is the smallest capacity that clips nothing over the year', () => {
  [0, 4].forEach(batteryCapacityMWh => {
    const state = Calc.normalizeState(createState({ batteryCapacityMWh }));
    const result = Calc.calculateAll(state);
    const fullKW = result.chemicalSupply.processPowerKW;
    const atFull = Calc.simulateAnnualChemicalDispatch(state, result.annualSolar, fullKW, { captureSeries: false });
    const below = Calc.simulateAnnualChemicalDispatch(state, result.annualSolar, fullKW * 0.99, { captureSeries: false });
    assert.ok(atFull.clippedSolarKWh <= 1e-6 * result.annualSolar.totalKWh, `${batteryCapacityMWh} MWh: no clipping at full size`);
    assert.ok(below.clippedSolarKWh > 0, `${batteryCapacityMWh} MWh: 1% smaller clips`);
  });
  // Storage lets a smaller constant plant absorb the same year.
  assert.ok(
    runScenario({ batteryCapacityMWh: 4 }).chemicalSupply.processPowerKW < runScenario({}).chemicalSupply.processPowerKW,
    'Battery-backed full-capture size below the no-storage annual peak'
  );
});

test('sizing below 100% clips and lowers delivered energy against the same annual basis', () => {
  const full = runScenario({});
  const partial = runScenario({ chemicalSizingPercent: 70 });
  close(partial.chemicalSupply.processPowerKW, full.chemicalSupply.processPowerKW * 0.7, 1e-9, '70% of full-capture size');
  assert.ok(partial.chemicalSupply.clippedDailyKWh > 0, 'Undersized plant clips');
  close(
    (partial.chemicalSupply.dailyAvailableKWh + partial.chemicalSupply.clippedDailyKWh) * 365,
    full.annualSolar.totalKWh,
    1e-6 * full.annualSolar.totalKWh,
    'delivered + clipped = solar without storage'
  );
});

test('edge states produce finite energy results', () => {
  const edgeStates = [
    { systemSizeMW: 0 },
    { systemSizeMW: 0, batteryCapacityMWh: 4 },
    { systemSizeMW: 0, batteryCapacityMWh: 4, aiComputeEnabled: true },
    { chemicalSizingPercent: 0 },
    { chemicalSizingPercent: 0, batteryCapacityMWh: 2 },
    { batteryEfficiency: 0, batteryCapacityMWh: 2 },
    { batteryEfficiency: 0, batteryCapacityMWh: 2, aiComputeEnabled: true },
    { latitude: 90 },
    { latitude: -90, mountingType: 'single' },
    { body: 'moon', latitude: -90, solarProfileModel: 'lunar-pel' },
  ];
  const findNaN = (value, path, out) => {
    if (typeof value === 'number') { if (Number.isNaN(value)) out.push(path); return; }
    if (Array.isArray(value)) { value.forEach((item, index) => findNaN(item, `${path}[${index}]`, out)); return; }
    if (value && typeof value === 'object') Object.entries(value).forEach(([key, item]) => findNaN(item, `${path}.${key}`, out));
  };
  edgeStates.forEach(overrides => {
    const result = runScenario(overrides);
    const nan = [];
    findNaN({ solar: result.solar, chemicalSupply: result.chemicalSupply, storage: result.storage, ai: result.ai }, 'result', nan);
    assert.deepEqual(nan.slice(0, 5), [], `NaN in ${JSON.stringify(overrides)}`);
    assert.ok(result.solar.capacityFactor <= 1 && result.chemicalSupply.effectiveCF <= 1 + 1e-12, `CF <= 1 for ${JSON.stringify(overrides)}`);
  });
  // Zero plant with storage: nothing to deliver, no phantom start-of-year charge.
  const empty = runScenario({ systemSizeMW: 0, batteryCapacityMWh: 4 });
  assert.equal(empty.annualDispatch.chemicalKWh, 0);
  assert.equal(empty.annualDispatch.settleIterations, 0);
});

test('an unreachable site yield is capped and flagged instead of inventing energy', () => {
  const result = runScenario({ siteYieldMwhPerMwdcYear: 9000 });
  assert.equal(result.warnings.length, 1, 'Expected a capped-yield warning');
  assert.ok(result.solar.annualMWh < result.solar.requestedAnnualMWh, 'Delivered energy below the request');
  close(result.solar.annualMWh * 1000, result.annualSolar.totalKWh, 1e-6 * result.annualSolar.totalKWh, 'solar summary follows the capped series');
  assert.ok(result.solar.capacityFactor <= 1, 'CF <= 1');
  assert.deepEqual(runScenario({}).warnings, [], 'Default site is reachable');
});

test('site lookups use the nearest preset and respect an explicit zero yield', () => {
  // Mojave (35.05, -117.6) is also within the box of Los Angeles (34.05, -118.24).
  assert.equal(Calc.getNearbyPreset(35.05, -117.6).name, 'Mojave Desert, CA');
  assert.equal(Calc.getNearbyPreset(34.1, -118.2).name, 'Los Angeles, CA');
  const zero = solarFor({ siteYieldMwhPerMwdcYear: 0 });
  assert.equal(zero.annualMWh, 0, 'An explicit 0 MWh/MWdc-yr yield stays 0');
  assert.equal(solarFor({ systemSizeMW: 0 }).capacityFactor, 0, 'CF is 0, not NaN, for a 0 MW plant');
});

test('lifetime energy re-dispatches the fixed design on the degraded, repowered array', () => {
  // Without storage at 100% sizing nothing clips, so chemical energy is exactly
  // proportional to PV output: chemical factor == solar factor every year.
  const linear = runScenario({});
  linear.lifetimeEnergy.solarFactorByYear.forEach((factor, index) => {
    close(linear.lifetimeEnergy.chemicalFactorByYear[index], factor, 1e-9, `year ${index + 1} chemical factor`);
  });
  close(linear.lifetimeEnergy.solarFactorByYear[29], Math.pow(1 - 0.0065, 29), 1e-12, 'year-30 PV factor');

  // Repowering at the end of a 30-year solar life restarts degradation in year 31.
  const repowered = runScenario({ analysisHorizonYears: 40 });
  assert.equal(repowered.lifetimeEnergy.solarFactorByYear[30], 1);
  close(repowered.lifetimeEnergy.solarFactorByYear[31], 1 - 0.0065, 1e-12, 'year-32 factor after repowering');

  // AI is served first, so it loses less than PV output and the residual
  // chemistry loses more; reliability of the fixed design load falls.
  const ai = runScenario({ aiComputeEnabled: true });
  const last = ai.lifetimeEnergy.horizonYears - 1;
  const pvFactor = ai.lifetimeEnergy.solarFactorByYear[last];
  assert.ok(ai.lifetimeEnergy.aiServedFactorByYear[last] > pvFactor, 'AI-served energy degrades less than PV');
  assert.ok(ai.lifetimeEnergy.chemicalFactorByYear[last] < pvFactor, 'Residual chemistry degrades more than PV');
  assert.ok(ai.ai.lateLifeReliability < ai.ai.fullPowerReliability, 'Late-life reliability below year 1');
  const direct = Calc.simulateAnnualDispatchWithConstantAiLoad(ai.state, ai.annualSolar, ai.ai.designLoadKW, {
    captureSeries: false,
    chemicalCapacityKW: ai.chemicalSupply.processPowerKW,
    solarScale: pvFactor,
  });
  close(ai.ai.lateLifeReliability, direct.fullPowerReliability, 1e-12, 'late-life reliability = re-dispatch at the year-30 PV factor');

  // Economics apply the vectors to the matching revenue streams.
  const year30 = ai.economics.yearlyCashFlows[last];
  close(year30.revenue.ai, ai.economics.revenue.ai * ai.lifetimeEnergy.aiServedFactorByYear[last], 1e-6, 'year-30 AI revenue');
  close(year30.revenue.methane, ai.economics.revenue.methane * ai.lifetimeEnergy.chemicalFactorByYear[last], 1e-6, 'year-30 methane revenue');
});
