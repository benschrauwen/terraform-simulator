/*
 * Solar layout and chemical-plant sizing against the annual dispatch: land and
 * BOS vs location, battery capex, full-capture vs undersized process caps,
 * clipping, the buffered electricity cost and the specific-day view.
 * Energy conservation of the dispatch itself is in energy-model.test.js.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { Calc, createState, formatMoney, runScenario } from './harness.js';

test('solar land use stays physically larger than panel area while preserving denser east-west packing', () => {
  const baseOverrides = {
    systemSizeMW: 1,
    panelEfficiency: 20,
    batteryCapacityMWh: 0,
    electrolyzerEnabled: false,
    dacEnabled: false,
    sabatierEnabled: false,
    methanolEnabled: false,
  };
  const fixed = runScenario({ ...baseOverrides, mountingType: 'fixed' });
  const eastWest = runScenario({ ...baseOverrides, mountingType: 'ew' });
  const singleAxis = runScenario({ ...baseOverrides, mountingType: 'single' });

  for (const [label, result] of [
    ['fixed tilt', fixed],
    ['east-west', eastWest],
    ['single-axis', singleAxis],
  ]) {
    assert.ok(
      result.solar.landAreaM2 > result.solar.panelAreaM2,
      `Expected ${label} land area ${result.solar.landAreaM2.toFixed(3)} m2 to exceed panel area ${result.solar.panelAreaM2.toFixed(3)} m2.`
    );
  }

  const densityRatio = singleAxis.solar.landAreaM2 / eastWest.solar.landAreaM2;
  assert.ok(
    densityRatio > 2.45 && densityRatio < 2.55,
    `Expected east-west to stay about 2.5x denser than single-axis tracking, observed ${densityRatio.toFixed(3)}x.`
  );
});

test('solar acreage and BOS respond to location while keeping installed MW fixed', () => {
  function solarAt({ latitude, longitude, mountingType, bosCostPerW }) {
    return Calc.calculateSolar(createState({
      latitude,
      longitude,
      mountingType,
      systemSizeMW: 1,
      panelEfficiency: 21.5,
      panelCostPerW: 0.20,
      bosCostPerW,
      landCostPerAcre: 5000,
      sitePrepCostPerAcre: 15000,
      siteYieldMwhPerMwdcYear: 0,
    }));
  }

  const mojaveEw = solarAt({ latitude: 35.05, longitude: -117.60, mountingType: 'ew', bosCostPerW: 0.12 });
  const houstonEw = solarAt({ latitude: 29.7604, longitude: -95.3698, mountingType: 'ew', bosCostPerW: 0.12 });
  const buffaloEw = solarAt({ latitude: 42.8864, longitude: -78.8784, mountingType: 'ew', bosCostPerW: 0.12 });
  const mojaveSingle = solarAt({ latitude: 35.05, longitude: -117.60, mountingType: 'single', bosCostPerW: 0.35 });
  const houstonSingle = solarAt({ latitude: 29.7604, longitude: -95.3698, mountingType: 'single', bosCostPerW: 0.35 });
  const buffaloSingle = solarAt({ latitude: 42.8864, longitude: -78.8784, mountingType: 'single', bosCostPerW: 0.35 });

  assert.ok(
    Math.abs(mojaveEw.groundCoverageRatio - mojaveEw.baseGroundCoverageRatio) <= 1e-12,
    'Expected the Mojave east-west reference case to preserve the baseline ground coverage ratio.'
  );
  assert.ok(
    Math.abs(mojaveSingle.bosCostPerW - mojaveSingle.baseBosCostPerW) <= 1e-12,
    'Expected the Mojave single-axis reference case to preserve the baseline BOS cost per watt.'
  );
  assert.ok(
    houstonSingle.acres < mojaveSingle.acres && buffaloSingle.acres > mojaveSingle.acres,
    [
      'Expected the same installed single-axis MWdc to use less land in Houston and more land in Buffalo than the Mojave reference.',
      `Observed Houston ${houstonSingle.acres.toFixed(3)}, Mojave ${mojaveSingle.acres.toFixed(3)}, Buffalo ${buffaloSingle.acres.toFixed(3)} acres.`,
    ].join(' ')
  );
  assert.ok(
    houstonSingle.bosCapex < mojaveSingle.bosCapex && buffaloSingle.bosCapex > mojaveSingle.bosCapex,
    [
      'Expected single-axis BOS to fall slightly at lower-latitude Houston and rise at higher-latitude Buffalo.',
      `Observed Houston ${houstonSingle.bosCapex.toFixed(0)}, Mojave ${mojaveSingle.bosCapex.toFixed(0)}, Buffalo ${buffaloSingle.bosCapex.toFixed(0)} USD.`,
    ].join(' ')
  );
  assert.ok(
    Math.abs(buffaloSingle.acres - houstonSingle.acres) > Math.abs(buffaloEw.acres - houstonEw.acres),
    [
      'Expected tracker acreage to react more strongly to location than east-west acreage at fixed installed MWdc.',
      `Observed EW swing ${Math.abs(buffaloEw.acres - houstonEw.acres).toFixed(3)} vs tracker swing ${Math.abs(buffaloSingle.acres - houstonSingle.acres).toFixed(3)} acres.`,
    ].join(' ')
  );
});


test('a small battery adds exactly its capex and smooths the process cap down', () => {
  // Battery capex = MWh x 1000 x $/kWh; storage shifts energy into the
  // evening, so a flatter delivery needs a smaller process peak.
  [1, 100].forEach(systemSizeMW => {
    const without = runScenario({ systemSizeMW, batteryCapacityMWh: 0 });
    const withSmall = runScenario({ systemSizeMW, batteryCapacityMWh: 0.5 });
    const expectedBatteryCapex = 0.5 * 1000 * createState().batteryCostPerKWh;
    assert.equal(withSmall.economics.capex.battery, expectedBatteryCapex, `${systemSizeMW} MW battery capex`);
    assert.ok(withSmall.economics.totalCapex >= without.economics.totalCapex, `${systemSizeMW} MW total capex`);
    assert.ok(
      withSmall.chemicalSupply.processPowerKW < without.chemicalSupply.processPowerKW,
      `${systemSizeMW} MW process power ${without.chemicalSupply.processPowerKW} -> ${withSmall.chemicalSupply.processPowerKW}`
    );
  });
});

// The 100% no-storage size is the annual hourly solar peak (the smallest
// constant capacity that clips nothing all year), not the average-day peak.
test('no-battery process sizing follows the annual hourly solar peak', () => {
  const result = runScenario({ systemSizeMW: 100, batteryCapacityMWh: 0 });
  const annualSolarPeakKW = Math.max(...result.annualSolar.hourlyKW, 0);
  const averageDayPeakKW = Math.max(...result.chemicalSupply.hourlyKW, 0);

  assert.ok(
    Math.abs(result.chemicalSupply.processPowerKW - annualSolarPeakKW) <= 1e-6,
    [
      'Expected the no-battery process cap to match the annual hourly solar peak.',
      `Observed ${result.chemicalSupply.processPowerKW.toFixed(3)} kW vs ${annualSolarPeakKW.toFixed(3)} kW.`,
    ].join(' ')
  );
  assert.ok(annualSolarPeakKW > averageDayPeakKW, 'The seasonal peak hour must exceed the average-day peak.');
  assert.ok(result.chemicalSupply.clippedDailyKWh <= 1e-9, 'Full capture must clip nothing.');
  assert.ok(
    Math.abs((result.chemicalSupply.dailyAvailableKWh * 365) - result.annualSolar.totalKWh) <= 1e-6 * result.annualSolar.totalKWh,
    'Without storage or clipping, delivered chemical energy equals the annual solar energy.'
  );
});

test('buffered electricity cost matches solar lcoe when all solar is used without storage', () => {
  const result = runScenario({
    systemSizeMW: 100,
    batteryCapacityMWh: 0,
    chemicalSizingPercent: 100,
    aiComputeEnabled: false,
    electrolyzerEnabled: false,
    dacEnabled: false,
    sabatierEnabled: false,
    methanolEnabled: false,
  });

  assert.ok(
    Math.abs(result.economics.bufferedElectricityCostPerMWh - result.solar.lcoe) <= 1e-9,
    [
      'Expected the buffered electricity cost to collapse to the base solar LCOE when storage is off and the modeled load uses the full solar output.',
      `Observed buffered ${result.economics.bufferedElectricityCostPerMWh.toFixed(12)} vs solar ${result.solar.lcoe.toFixed(12)} $/MWh.`,
    ].join(' ')
  );
});

test('buffered electricity cost includes battery annualized cost and storage losses', () => {
  const result = runScenario({
    systemSizeMW: 100,
    batteryCapacityMWh: 24,
    chemicalSizingPercent: 100,
    aiComputeEnabled: false,
    electrolyzerEnabled: false,
    dacEnabled: false,
    sabatierEnabled: false,
    methanolEnabled: false,
  });
  const state = result.state;
  const batteryOmFrac = (state.batteryOmPercent ?? 1.5) / 100;
  const expectedAnnualCost = result.solar.annualizedSolar +
    result.solar.annualSolarOm +
    result.storage.annualizedCapex +
    (result.storage.capex * batteryOmFrac);
  // Was the arithmetic-average degradation; energy is now levelized
  // (discounted) like the CRF capital charge it is divided into.
  const degradationFactor = Calc.getLevelizedSolarDegradationFactor(state.panelDegradationAnnual, state.solarAssetLife, state.discountRate / 100);
  const expectedLevelizedAnnualMWh = ((result.chemicalSupply.dailyAvailableKWh * result.solar.cyclesPerYear) / 1000) * degradationFactor;
  const expectedBufferedElectricityCost = expectedLevelizedAnnualMWh > 0
    ? expectedAnnualCost / expectedLevelizedAnnualMWh
    : 0;

  assert.ok(
    Math.abs(result.economics.bufferedElectricityAnnualCost - expectedAnnualCost) <= 1e-6,
    [
      'Expected the buffered electricity annual cost to include solar annualization, solar O&M, battery annualization, and battery O&M.',
      `Observed ${result.economics.bufferedElectricityAnnualCost.toFixed(6)} vs expected ${expectedAnnualCost.toFixed(6)} USD/yr.`,
    ].join(' ')
  );
  assert.ok(
    Math.abs(result.economics.bufferedElectricityLevelizedAnnualMWh - expectedLevelizedAnnualMWh) <= 1e-9,
    [
      'Expected the buffered electricity denominator to use lifetime-average delivered MWh after storage losses.',
      `Observed ${result.economics.bufferedElectricityLevelizedAnnualMWh.toFixed(12)} vs expected ${expectedLevelizedAnnualMWh.toFixed(12)} MWh/yr.`,
    ].join(' ')
  );
  assert.ok(
    Math.abs(result.economics.bufferedElectricityCostPerMWh - expectedBufferedElectricityCost) <= 1e-9,
    [
      'Expected the buffered electricity cost to equal annualized solar-plus-battery cost divided by lifetime-average delivered MWh.',
      `Observed ${result.economics.bufferedElectricityCostPerMWh.toFixed(12)} vs expected ${expectedBufferedElectricityCost.toFixed(12)} $/MWh.`,
    ].join(' ')
  );
});

test('buffered electricity cost counts AI-served electricity in AI mode', () => {
  const result = runScenario({
    systemSizeMW: 100,
    batteryCapacityMWh: 24,
    aiComputeEnabled: true,
    aiReliabilityTarget: 95,
  });
  const expectedAnnualDeliveredMWh = (result.ai.annualAiServedKWh + result.ai.chemicalAnnualKWh) / 1000;

  assert.ok(result.ai.annualAiServedKWh > 0, 'Expected AI mode to report a non-zero annual AI-served electricity total.');
  assert.ok(
    Math.abs(result.economics.bufferedElectricityAnnualDeliveredMWh - expectedAnnualDeliveredMWh) <= 1e-9,
    [
      'Expected the buffered electricity metric to count total delivered electricity in AI mode, including the AI-served share.',
      `Observed ${result.economics.bufferedElectricityAnnualDeliveredMWh.toFixed(12)} vs expected ${expectedAnnualDeliveredMWh.toFixed(12)} MWh/yr.`,
    ].join(' ')
  );
});

test('undersizing the no-battery chemical plant clips the modeled solar peak', () => {
  const fullCapture = runScenario({ systemSizeMW: 100, batteryCapacityMWh: 0, chemicalSizingPercent: 100 });
  const undersized = runScenario({ systemSizeMW: 100, batteryCapacityMWh: 0, chemicalSizingPercent: 70 });

  assert.ok(
    Math.abs(undersized.chemicalSupply.processPowerKW - (fullCapture.chemicalSupply.processPowerKW * 0.7)) <= 1e-6,
    [
      'Expected the no-battery process cap to scale from the full-capture peak.',
      `Observed ${undersized.chemicalSupply.processPowerKW.toFixed(3)} kW vs expected ${(fullCapture.chemicalSupply.processPowerKW * 0.7).toFixed(3)} kW.`,
    ].join(' ')
  );
  assert.ok(
    undersized.chemicalSupply.clippedDailyKWh > 0,
    `Expected undersizing to clip some solar energy, got ${undersized.chemicalSupply.clippedDailyKWh.toFixed(6)} kWh/day.`
  );
  assert.ok(
    undersized.chemicalSupply.dailyAvailableKWh < fullCapture.chemicalSupply.dailyAvailableKWh,
    [
      'Expected undersizing to reduce delivered chemical energy when no battery is present.',
      `Observed ${fullCapture.chemicalSupply.dailyAvailableKWh.toFixed(3)} -> ${undersized.chemicalSupply.dailyAvailableKWh.toFixed(3)} kWh/day.`,
    ].join(' ')
  );
});

test('undersizing the battery-backed chemical plant preserves the full-capture reference and introduces clipping', () => {
  const fullCapture = runScenario({ systemSizeMW: 100, batteryCapacityMWh: 24, chemicalSizingPercent: 100 });
  const undersized = runScenario({ systemSizeMW: 100, batteryCapacityMWh: 24, chemicalSizingPercent: 70 });

  assert.ok(
    Math.abs(undersized.chemicalSupply.fullCapturePowerKW - fullCapture.chemicalSupply.processPowerKW) <= 1e-3,
    [
      'Expected the battery-backed full-capture reference to stay available after undersizing.',
      `Observed ${undersized.chemicalSupply.fullCapturePowerKW.toFixed(3)} kW vs ${fullCapture.chemicalSupply.processPowerKW.toFixed(3)} kW.`,
    ].join(' ')
  );
  assert.ok(
    undersized.chemicalSupply.processPowerKW < fullCapture.chemicalSupply.processPowerKW,
    `Expected undersizing to reduce the battery-backed process cap, got ${fullCapture.chemicalSupply.processPowerKW.toFixed(3)} -> ${undersized.chemicalSupply.processPowerKW.toFixed(3)} kW.`
  );
  assert.ok(
    undersized.chemicalSupply.clippedDailyKWh > 0,
    `Expected battery-backed undersizing to clip some solar energy, got ${undersized.chemicalSupply.clippedDailyKWh.toFixed(6)} kWh/day.`
  );
  assert.ok(
    undersized.chemicalSupply.capturedSolarFraction < 0.999,
    `Expected captured-solar fraction to fall below 100%, got ${(undersized.chemicalSupply.capturedSolarFraction * 100).toFixed(3)}%.`
  );
});

test('specific-day selector no longer changes annual non-ai sizing or economics', () => {
  const average = runScenario({
    systemSizeMW: 100,
    batteryCapacityMWh: 0,
    chemicalSizingPercent: 72,
    dayMode: 'average',
    dayOfYear: 355,
  });
  const specific = runScenario({
    systemSizeMW: 100,
    batteryCapacityMWh: 0,
    chemicalSizingPercent: 72,
    dayMode: 'specific',
    dayOfYear: 355,
  });

  assert.ok(
    Math.abs(specific.chemicalSupply.processPowerKW - average.chemicalSupply.processPowerKW) <= 1e-6,
    [
      'Expected the specific-day selector to leave annual process sizing unchanged.',
      `Observed ${average.chemicalSupply.processPowerKW.toFixed(6)} kW vs ${specific.chemicalSupply.processPowerKW.toFixed(6)} kW.`,
    ].join(' ')
  );
  assert.ok(
    Math.abs(specific.chemicalSupply.dailyAvailableKWh - average.chemicalSupply.dailyAvailableKWh) <= 1e-6,
    [
      'Expected the specific-day selector to leave annual-average chemical energy unchanged.',
      `Observed ${average.chemicalSupply.dailyAvailableKWh.toFixed(6)} vs ${specific.chemicalSupply.dailyAvailableKWh.toFixed(6)} kWh/day.`,
    ].join(' ')
  );
  assert.ok(
    Math.abs(specific.economics.irr - average.economics.irr) <= 1e-12,
    [
      'Expected the specific-day selector to avoid perturbing annual project returns.',
      `Observed ${average.economics.irr.toFixed(12)} vs ${specific.economics.irr.toFixed(12)}.`,
    ].join(' ')
  );
});

test('annual chemical day slices show winter no-clipping against a fixed undersized cap', () => {
  const result = runScenario({
    systemSizeMW: 100,
    batteryCapacityMWh: 0,
    chemicalSizingPercent: 72,
  });
  const displayDispatch = result.annualDispatch;

  assert.ok(displayDispatch, 'Expected a day-slice chemistry dispatch series for specific-day visualization.');
  assert.equal(
    displayDispatch.dailyClippedKWh.length,
    365,
    `Expected Earth day-slice clipping series to expose 365 daily buckets, got ${displayDispatch.dailyClippedKWh.length}.`
  );
  assert.ok(
    displayDispatch.dailyClippedKWh[354] <= 1e-6,
    [
      'Expected the winter-solstice day to stay below the fixed annual process cap in this undersized case.',
      `Observed ${displayDispatch.dailyClippedKWh[354].toFixed(6)} kWh/day clipped on Dec 21.`,
    ].join(' ')
  );
  assert.ok(
    displayDispatch.dailyClippedKWh[171] > 0,
    [
      'Expected the same fixed annual process cap to clip a sunnier summer day.',
      `Observed ${displayDispatch.dailyClippedKWh[171].toFixed(6)} kWh/day clipped on Jun 21.`,
    ].join(' ')
  );
});
