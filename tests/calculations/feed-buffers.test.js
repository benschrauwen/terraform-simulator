/*
 * Feed buffers are not free: a buffered reactor running at a constant rate
 * holds the feed that arrives during operating hours but is consumed later.
 * In exchange it is sized on the peak day's average feed rather than the
 * peak hour, at unchanged output.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { CHEMISTRY } from '../../js/data/reference-data.js';
import { Calc, ModuleCatalog, createState, formatMoney, runScenario } from './harness.js';

const close = (actual, expected, tolerance, message) => assert.ok(
  Math.abs(actual - expected) <= tolerance,
  `${message || ''} expected ${expected}, got ${actual}`
);

test('buffered Sabatier holds peak-day feed x (1 - op hours / cycle hours)', () => {
  // Feed flat over 10 of 24 hours, reactor at a constant 1/24 of the day:
  // inventory peaks at the end of the sunny window = F x (1 - 10/24).
  const s = CHEMISTRY.sabatier;
  const h2 = 100 * s.h2MassPerKgCH4;
  const co2 = 100 * s.co2MassPerKgCH4;
  const buffered = Calc.calculateSabatier(createState({ sabatierBufferEnabled: true }), h2, co2, 10, h2 / 10, co2 / 10, h2, co2);
  close(buffered.bufferH2Kg, h2 * (14 / 24), 1e-9);
  close(buffered.bufferCO2Kg, co2 * (14 / 24), 1e-9);
  const unbuffered = Calc.calculateSabatier(createState({ sabatierBufferEnabled: false }), h2, co2, 10, h2 / 10, co2 / 10, h2, co2);
  assert.equal(unbuffered.bufferH2Kg, 0);

  const storage = Calc.calculateFeedBufferStorage(createState({ h2BufferCostPerKg: 750, co2BufferCostPerTon: 1000 }), [buffered]);
  close(storage.capex, buffered.bufferH2Kg * 750 + (buffered.bufferCO2Kg / 1000) * 1000, 1e-9);
});

test('feed buffer storage is a capex block with process O&M; none without buffers', () => {
  const buffered = runScenario({ sabatierBufferEnabled: true });
  assert.ok(buffered.economics.capex.feedBuffers > 0);
  close(buffered.economics.capex.feedBuffers, buffered.feedBuffers.capex, 1e-9);

  const unbuffered = runScenario({ sabatierBufferEnabled: false });
  assert.equal(unbuffered.economics.capex.feedBuffers, 0);
  const processCapex = economics => economics.capex.electrolyzer + economics.capex.dac + economics.capex.sabatier + economics.capex.methanol;
  const omDifference = buffered.economics.annualOM - unbuffered.economics.annualOM;
  const expectedOmDifference = 0.03 * (processCapex(buffered.economics) + buffered.economics.capex.feedBuffers - processCapex(unbuffered.economics));
  close(omDifference, expectedOmDifference, 1e-6);
});

test('sabatier feed buffer keeps output while sizing from peak-day average gas flow', () => {
  const baseOverrides = {
    latitude: 64.15,
    longitude: -21.94,
    systemSizeMW: 100,
    batteryCapacityMWh: 0,
    sabatierEnabled: true,
    methanolEnabled: false,
    sabatierBufferEnabled: false,
  };
  const unbuffered = runScenario(baseOverrides);
  const buffered = runScenario({ ...baseOverrides, sabatierBufferEnabled: true });
  const peakChemicalDailyKWh = Math.max(...(buffered.annualDispatch?.dailyChemicalKWh || []), 0);
  const peakDayScale = buffered.chemicalSupply.dailyAvailableKWh > 0
    ? Math.max(1, peakChemicalDailyKWh / buffered.chemicalSupply.dailyAvailableKWh)
    : 1;
  const conversion = buffered.state.sabatierConversion / 100;
  const expectedDesignFeedKgPerHour = conversion > 0 && buffered.solar.cycleHours > 0
    ? (((buffered.sabatier.h2Consumed + buffered.sabatier.co2Consumed) / conversion) * peakDayScale) / buffered.solar.cycleHours
    : 0;

  assert.equal(buffered.sabatier.bufferEnabled, true, 'Expected the Sabatier result to reflect the feed-buffer toggle.');
  assert.ok(
    Math.abs(buffered.sabatier.ch4AnnualKg - unbuffered.sabatier.ch4AnnualKg) <= 1e-9,
    'Expected the Sabatier feed buffer to preserve methane output.'
  );
  assert.ok(
    Math.abs(buffered.sabatier.designFeedKgPerHour - expectedDesignFeedKgPerHour) <= 1e-6,
    [
      'Expected the Sabatier reactor to size from peak-day average feed when the buffer is enabled.',
      `Observed ${buffered.sabatier.designFeedKgPerHour.toFixed(6)} vs expected ${expectedDesignFeedKgPerHour.toFixed(6)} kg/h.`,
    ].join(' ')
  );
  assert.ok(
    buffered.sabatier.capex < unbuffered.sabatier.capex,
    [
      'Expected the Sabatier feed buffer to reduce reactor CAPEX at unchanged output.',
      `Observed ${formatMoney(unbuffered.sabatier.capex)} -> ${formatMoney(buffered.sabatier.capex)}.`,
    ].join(' ')
  );
});

test('methanol feed buffer keeps output while sizing from peak-day average gas flow', () => {
  const baseOverrides = {
    latitude: 64.15,
    longitude: -21.94,
    systemSizeMW: 100,
    batteryCapacityMWh: 0,
    sabatierEnabled: false,
    methanolEnabled: true,
    methanolBufferEnabled: false,
  };
  const unbuffered = runScenario(baseOverrides);
  const buffered = runScenario({ ...baseOverrides, methanolBufferEnabled: true });
  const peakChemicalDailyKWh = Math.max(...(buffered.annualDispatch?.dailyChemicalKWh || []), 0);
  const peakDayScale = buffered.chemicalSupply.dailyAvailableKWh > 0
    ? Math.max(1, peakChemicalDailyKWh / buffered.chemicalSupply.dailyAvailableKWh)
    : 1;
  const efficiency = buffered.state.methanolEfficiency / 100;
  const expectedDesignFeedKgPerHour = efficiency > 0 && buffered.solar.cycleHours > 0
    ? (((buffered.methanol.h2Consumed + buffered.methanol.co2Consumed) / efficiency) * peakDayScale) / buffered.solar.cycleHours
    : 0;

  assert.equal(buffered.methanol.bufferEnabled, true, 'Expected the methanol result to reflect the feed-buffer toggle.');
  assert.ok(
    Math.abs(buffered.methanol.annualKg - unbuffered.methanol.annualKg) <= 1e-9,
    'Expected the methanol feed buffer to preserve methanol output.'
  );
  assert.ok(
    Math.abs(buffered.methanol.designFeedKgPerHour - expectedDesignFeedKgPerHour) <= 1e-6,
    [
      'Expected the methanol reactor to size from peak-day average feed when the buffer is enabled.',
      `Observed ${buffered.methanol.designFeedKgPerHour.toFixed(6)} vs expected ${expectedDesignFeedKgPerHour.toFixed(6)} kg/h.`,
    ].join(' ')
  );
  assert.ok(
    buffered.methanol.capex < unbuffered.methanol.capex,
    [
      'Expected the methanol feed buffer to reduce reactor CAPEX at unchanged output.',
      `Observed ${formatMoney(unbuffered.methanol.capex)} -> ${formatMoney(buffered.methanol.capex)}.`,
    ].join(' ')
  );
});

test('co2-to-co feed buffer keeps output while sizing from peak-day average co2 flow', () => {
  const baseOverrides = {
    latitude: 64.15,
    longitude: -21.94,
    systemSizeMW: 100,
    batteryCapacityMWh: 0,
    sabatierEnabled: false,
    methanolEnabled: false,
    carbonMonoxideEnabled: true,
    carbonMonoxideRoute: 'plasma',
    carbonMonoxideBufferEnabled: false,
  };
  const unbuffered = runScenario(baseOverrides);
  const buffered = runScenario({ ...baseOverrides, carbonMonoxideBufferEnabled: true });
  const coUnbuffered = unbuffered.exploratoryModules.find(module => module.id === 'carbonMonoxide');
  const coBuffered = buffered.exploratoryModules.find(module => module.id === 'carbonMonoxide');
  const route = ModuleCatalog.getRouteConfig('carbonMonoxide', 'plasma');
  const peakChemicalDailyKWh = Math.max(...(buffered.annualDispatch?.dailyChemicalKWh || []), 0);
  const peakDayScale = buffered.chemicalSupply.dailyAvailableKWh > 0
    ? Math.max(1, peakChemicalDailyKWh / buffered.chemicalSupply.dailyAvailableKWh)
    : 1;
  const allocationPlan = Calc.buildProcessAllocationPlan(buffered.state);
  const powerShare = allocationPlan.powerShares.exploratory.carbonMonoxide || 0;
  const co2Share = allocationPlan.feedShares.co2.carbonMonoxide || 0;
  const peakSizingKW = Math.max(
    buffered.chemicalSupply.processPowerKW,
    buffered.annualDispatch?.chemicalPeakKW || 0
  );
  const expectedBufferedPeakUnitsPerHour = Math.min(
    route.electricityKwhPerUnit > 0
      ? (peakSizingKW * powerShare) / route.electricityKwhPerUnit
      : Infinity,
    route.feedstocks.co2Kg > 0 && buffered.solar.cycleHours > 0
      ? ((((buffered.dac.co2DailyKg || 0) * peakDayScale) * co2Share) / buffered.solar.cycleHours) / route.feedstocks.co2Kg
      : Infinity
  );

  assert.ok(coUnbuffered && coBuffered, 'Expected the CO module to appear in both buffered and unbuffered results.');
  assert.equal(coBuffered.bufferEnabled, true, 'Expected the CO result to reflect the feed-buffer toggle.');
  assert.ok(
    Math.abs(coBuffered.outputDailyUnits - coUnbuffered.outputDailyUnits) <= 1e-9,
    'Expected the CO feed buffer to preserve exploratory output.'
  );
  assert.ok(
    Math.abs(coBuffered.capexSizingOutputUnitsPerHour - expectedBufferedPeakUnitsPerHour) <= 1e-9,
    [
      'Expected the CO module to size from peak-day average buffered CO2 flow when the feed buffer is enabled.',
      `Observed ${coBuffered.capexSizingOutputUnitsPerHour.toFixed(9)} vs expected ${expectedBufferedPeakUnitsPerHour.toFixed(9)} units/hour.`,
    ].join(' ')
  );
  assert.ok(
    coBuffered.capexSizingOutputUnitsPerHour < coUnbuffered.capexSizingOutputUnitsPerHour,
    [
      'Expected the CO feed buffer to reduce nameplate sizing below the unbuffered peak throughput.',
      `Observed ${coUnbuffered.capexSizingOutputUnitsPerHour.toFixed(9)} -> ${coBuffered.capexSizingOutputUnitsPerHour.toFixed(9)} units/hour.`,
    ].join(' ')
  );
  assert.ok(
    coBuffered.capex < coUnbuffered.capex,
    [
      'Expected the CO feed buffer to reduce exploratory CAPEX at unchanged output.',
      `Observed ${formatMoney(coUnbuffered.capex)} -> ${formatMoney(coBuffered.capex)}.`,
    ].join(' ')
  );
});

test('mtg peak fully reflects upstream methanol buffering even without the MTG buffer', () => {
  const baseOverrides = {
    latitude: 64.15,
    longitude: -21.94,
    systemSizeMW: 100,
    batteryCapacityMWh: 0,
    sabatierEnabled: false,
    methanolEnabled: true,
    methanolBufferEnabled: false,
    mtgEnabled: true,
    mtgRoute: 'fluid-bed',
    mtgBufferEnabled: false,
  };
  const unbuffered = runScenario(baseOverrides);
  const methanolBuffered = runScenario({ ...baseOverrides, methanolBufferEnabled: true });
  const mtgUnbuffered = unbuffered.exploratoryModules.find(module => module.id === 'mtg');
  const mtgMethanolBuffered = methanolBuffered.exploratoryModules.find(module => module.id === 'mtg');
  const route = ModuleCatalog.getRouteConfig('mtg', 'fluid-bed');
  const methanolShare = Calc.buildProcessAllocationPlan(methanolBuffered.state).feedShares.methanol.mtg || 0;
  const expectedBufferedPeakUnitsPerHour = (
    (methanolBuffered.methanol.designHourlyOutputKg || 0) * methanolShare
  ) / route.feedstocks.methanolKg;

  assert.ok(mtgUnbuffered && mtgMethanolBuffered, 'Expected MTG to appear in both upstream-buffered and unbuffered results.');
  assert.ok(
    Math.abs(mtgMethanolBuffered.outputDailyUnits - mtgUnbuffered.outputDailyUnits) <= 1e-9,
    'Expected upstream methanol buffering to preserve MTG annualized output.'
  );
  assert.ok(
    mtgMethanolBuffered.peakOutputUnitsPerHour < mtgUnbuffered.peakOutputUnitsPerHour,
    [
      'Expected MTG peak throughput to fall when upstream methanol buffering smooths the incoming feed.',
      `Observed ${mtgUnbuffered.peakOutputUnitsPerHour.toFixed(9)} -> ${mtgMethanolBuffered.peakOutputUnitsPerHour.toFixed(9)} units/hour.`,
    ].join(' ')
  );
  assert.ok(
    Math.abs(mtgMethanolBuffered.peakOutputUnitsPerHour - expectedBufferedPeakUnitsPerHour) <= 1e-9,
    [
      'Expected upstream methanol buffering alone to fully flatten the MTG feed over the cycle.',
      `Observed ${mtgMethanolBuffered.peakOutputUnitsPerHour.toFixed(9)} vs expected ${expectedBufferedPeakUnitsPerHour.toFixed(9)} units/hour.`,
    ].join(' ')
  );
  assert.ok(
    Math.abs(mtgMethanolBuffered.capexSizingOutputUnitsPerHour - expectedBufferedPeakUnitsPerHour) <= 1e-9,
    'Expected MTG nameplate sizing to match the already-buffered upstream methanol feed when the MTG buffer is off.'
  );
});

test('mtg buffer no longer changes peak or capex after methanol is already buffered upstream', () => {
  const baseOverrides = {
    latitude: 64.15,
    longitude: -21.94,
    systemSizeMW: 100,
    batteryCapacityMWh: 0,
    sabatierEnabled: false,
    methanolEnabled: true,
    methanolBufferEnabled: false,
    mtgEnabled: true,
    mtgRoute: 'fluid-bed',
    mtgBufferEnabled: false,
  };
  const unbuffered = runScenario(baseOverrides);
  const mtgBuffered = runScenario({ ...baseOverrides, mtgBufferEnabled: true });
  const upstreamBuffered = runScenario({ ...baseOverrides, methanolBufferEnabled: true });
  const bothBuffered = runScenario({ ...baseOverrides, methanolBufferEnabled: true, mtgBufferEnabled: true });
  const mtgUnbuffered = unbuffered.exploratoryModules.find(module => module.id === 'mtg');
  const mtgOnlyBuffered = mtgBuffered.exploratoryModules.find(module => module.id === 'mtg');
  const mtgUpstreamBuffered = upstreamBuffered.exploratoryModules.find(module => module.id === 'mtg');
  const mtgBothBuffered = bothBuffered.exploratoryModules.find(module => module.id === 'mtg');
  const route = ModuleCatalog.getRouteConfig('mtg', 'fluid-bed');
  const methanolShare = Calc.buildProcessAllocationPlan(upstreamBuffered.state).feedShares.methanol.mtg || 0;
  const expectedBufferedPeakUnitsPerHour = (
    (upstreamBuffered.methanol.designHourlyOutputKg || 0) * methanolShare
  ) / route.feedstocks.methanolKg;
  const expectedBufferedCapexTotal = expectedBufferedPeakUnitsPerHour *
    mtgBuffered.solar.cycleHours *
    mtgBuffered.solar.cyclesPerYear *
    mtgOnlyBuffered.capexBasis *
    route.cyclingPenalty;

  assert.ok(mtgUnbuffered && mtgOnlyBuffered && mtgUpstreamBuffered && mtgBothBuffered, 'Expected MTG to appear in all buffered and unbuffered comparison scenarios.');
  assert.equal(mtgOnlyBuffered.bufferEnabled, true, 'Expected the MTG result to reflect the feed-buffer toggle.');
  assert.ok(
    Math.abs(mtgOnlyBuffered.outputDailyUnits - mtgUnbuffered.outputDailyUnits) <= 1e-9,
    'Expected the MTG feed buffer to preserve exploratory output.'
  );
  assert.ok(
    mtgOnlyBuffered.capexSizingOutputUnitsPerHour < mtgUnbuffered.peakOutputUnitsPerHour,
    [
      'Expected MTG feed buffering to reduce nameplate sizing below the unbuffered instantaneous MTG peak.',
      `Observed ${mtgUnbuffered.peakOutputUnitsPerHour.toFixed(9)} -> ${mtgOnlyBuffered.capexSizingOutputUnitsPerHour.toFixed(9)} units/hour.`,
    ].join(' ')
  );
  assert.ok(
    Math.abs(mtgOnlyBuffered.capexSizingOutputUnitsPerHour - expectedBufferedPeakUnitsPerHour) <= 1e-9,
    [
      'Expected the MTG feed buffer to smooth the methanol feed to the same cycle-average peak reached by upstream methanol buffering.',
      `Observed ${mtgOnlyBuffered.capexSizingOutputUnitsPerHour.toFixed(9)} vs expected ${expectedBufferedPeakUnitsPerHour.toFixed(9)} units/hour.`,
    ].join(' ')
  );
  assert.ok(
    Math.abs(mtgOnlyBuffered.capex - expectedBufferedCapexTotal) <= 1e-6,
    [
      'Expected buffered MTG CAPEX to size from the feed-smoothed nameplate throughput.',
      `Observed ${mtgOnlyBuffered.capex.toFixed(6)} vs expected ${expectedBufferedCapexTotal.toFixed(6)}.`,
    ].join(' ')
  );
  assert.ok(
    mtgOnlyBuffered.capex < mtgUnbuffered.capex,
    [
      'Expected the MTG feed buffer to reduce exploratory CAPEX at unchanged output.',
      `Observed ${formatMoney(mtgUnbuffered.capex)} -> ${formatMoney(mtgOnlyBuffered.capex)}.`,
    ].join(' ')
  );
  assert.ok(
    Math.abs(mtgUpstreamBuffered.peakOutputUnitsPerHour - expectedBufferedPeakUnitsPerHour) <= 1e-9,
    [
      'Expected upstream methanol buffering alone to reach the same fully buffered MTG peak.',
      `Observed ${mtgUpstreamBuffered.peakOutputUnitsPerHour.toFixed(9)} vs expected ${expectedBufferedPeakUnitsPerHour.toFixed(9)} units/hour.`,
    ].join(' ')
  );
  assert.ok(
    Math.abs(mtgBothBuffered.capexSizingOutputUnitsPerHour - mtgUpstreamBuffered.peakOutputUnitsPerHour) <= 1e-9,
    [
      'Expected turning on the MTG buffer after upstream methanol buffering to leave the MTG peak unchanged.',
      `Observed ${mtgUpstreamBuffered.peakOutputUnitsPerHour.toFixed(9)} vs ${mtgBothBuffered.capexSizingOutputUnitsPerHour.toFixed(9)} units/hour.`,
    ].join(' ')
  );
  assert.ok(
    Math.abs(mtgBothBuffered.capex - mtgUpstreamBuffered.capex) <= 1e-6,
    [
      'Expected turning on the MTG buffer after upstream methanol buffering to leave the MTG CAPEX unchanged.',
      `Observed ${mtgUpstreamBuffered.capex.toFixed(6)} vs ${mtgBothBuffered.capex.toFixed(6)}.`,
    ].join(' ')
  );
});
