/*
 * Colocated AI compute (reliability sizing, battery seeding, settled storage)
 * and off-Earth bodies (local cycles, lunar polar illumination, Mars orbital
 * year and seasons).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { Calc, runScenario } from './harness.js';

test('ai reliability target sizes against full-rate uptime', () => {
  const result = runScenario({ aiComputeEnabled: true, batteryCapacityMWh: 2, aiReliabilityTarget: 90 });

  assert.ok(result.ai.designLoadKW > 0, 'Expected the AI optimizer to find a non-zero load in this scenario.');
  assert.ok(
    result.ai.fullPowerReliability >= 0.899,
    [
      'Expected AI sizing to satisfy the configured full-rate reliability target.',
      `Observed ${(result.ai.fullPowerReliability * 100).toFixed(3)}% vs target ${result.ai.reliabilityTarget.toFixed(1)}%.`,
    ].join(' ')
  );
});

test('ai mode seeds zero battery from annual solar GWh', () => {
  const result = runScenario({ aiComputeEnabled: true, batteryCapacityMWh: 0 });
  const expectedBatteryMWh = result.solar.annualMWh / 1000;

  assert.ok(
    Math.abs(result.state.batteryCapacityMWh - expectedBatteryMWh) <= 1e-9,
    [
      'Expected AI mode to replace a zero battery entry with the annual-solar-GWh heuristic.',
      `Observed ${result.state.batteryCapacityMWh.toFixed(6)} MWh vs ${expectedBatteryMWh.toFixed(6)} MWh.`,
    ].join(' ')
  );
  assert.equal(result.storage.enabled, expectedBatteryMWh > 1e-9, 'Expected the seeded AI battery heuristic to enable storage.');
});

test('ai mode preserves explicit non-zero battery sizing', () => {
  const result = runScenario({ aiComputeEnabled: true, batteryCapacityMWh: 24 });

  assert.equal(
    result.state.batteryCapacityMWh,
    24,
    'Expected an explicit AI battery size to override the zero-battery heuristic.'
  );
});

test('ai-only 1 GW zero-battery entry seeds a large battery no better than nearby explicit capacities', () => {
  const baseOverrides = {
    systemSizeMW: 1000,
    loadConfigTab: 'ai',
    aiComputeEnabled: true,
    electrolyzerEnabled: false,
    dacEnabled: false,
    sabatierEnabled: false,
    methanolEnabled: false,
  };
  const zeroEntry = runScenario({ ...baseOverrides, batteryCapacityMWh: 0 });
  const sampledCandidates = [1200, 1400, 1600].map(batteryCapacityMWh => ({
    batteryCapacityMWh,
    result: runScenario({ ...baseOverrides, batteryCapacityMWh }),
  }));
  const bestSample = sampledCandidates.reduce((best, candidate) => (
    !best || candidate.result.economics.irr > best.result.economics.irr ? candidate : best
  ), null);

  assert.ok(
    zeroEntry.state.batteryCapacityMWh > 1000,
    [
      'Expected the visible 0 MWh AI-only entry to seed a large implicit battery before optimization.',
      `Observed ${zeroEntry.state.batteryCapacityMWh.toFixed(3)} MWh.`,
    ].join(' ')
  );
  assert.ok(bestSample, 'Expected to collect at least one explicit battery candidate for comparison.');
  assert.ok(
    bestSample.result.economics.irr >= zeroEntry.economics.irr,
    [
      'Expected a nearby explicit battery size to beat the zero-entry AI heuristic in the 1 GW AI-only case.',
      `Observed zero-entry IRR ${zeroEntry.economics.irr.toFixed(6)}% from an implicit ${zeroEntry.state.batteryCapacityMWh.toFixed(3)} MWh battery,`,
      `best sampled explicit point ${bestSample.batteryCapacityMWh.toFixed(1)} MWh -> ${bestSample.result.economics.irr.toFixed(6)}%.`,
    ].join(' ')
  );
  assert.ok(
    bestSample.batteryCapacityMWh < zeroEntry.state.batteryCapacityMWh,
    [
      'Expected the better nearby explicit capacity to be smaller than the implicit zero-entry battery.',
      `Observed ${bestSample.batteryCapacityMWh.toFixed(1)} MWh vs ${zeroEntry.state.batteryCapacityMWh.toFixed(3)} MWh.`,
    ].join(' ')
  );
});

test('ai storage summary reflects the settled annual dispatch state', () => {
  const result = runScenario({ aiComputeEnabled: true, batteryCapacityMWh: 24, aiReliabilityTarget: 95 });
  const settleToleranceKWh = Math.max(1e-3, result.storage.battCapKWh * 1e-6) + 1e-6;

  assert.equal(result.storage.enabled, true, 'Expected battery storage to stay enabled for this AI dispatch scenario.');
  assert.ok(
    Math.abs(result.storage.startBatteryKWh - result.ai.dispatch.startSocKWh) <= settleToleranceKWh,
    'Expected the storage summary to report the same settled starting SOC as the annual dispatch.'
  );
  assert.ok(
    Math.abs(result.storage.endBatteryKWh - result.ai.dispatch.endSocKWh) <= settleToleranceKWh,
    'Expected the storage summary to report the same ending SOC as the annual dispatch.'
  );
  assert.ok(
    Math.abs(result.storage.endBatteryKWh - result.storage.startBatteryKWh) <= settleToleranceKWh,
    [
      'Expected the settled annual dispatch to start and end at nearly the same SOC.',
      `Observed ${result.storage.startBatteryKWh.toFixed(4)} -> ${result.storage.endBatteryKWh.toFixed(4)} kWh.`,
    ].join(' ')
  );
  assert.ok(
    result.storage.utilizedCapacityKWh <= result.storage.battCapKWh + 1e-6,
    'Utilized storage capacity should never exceed the installed battery capacity.'
  );
});

test('fractional cycle aggregation splits edge hours proportionally', () => {
  const aggregated = Calc.aggregateSeriesBySpanHours([10, 20, 30, 40], 1.5);

  assert.equal(aggregated.length, 3, 'Expected 4 hourly samples split into three 1.5-hour windows.');
  assert.ok(Math.abs(aggregated[0] - 20) <= 1e-9, `Expected first fractional window to total 20 kWh, got ${aggregated[0]}.`);
  assert.ok(Math.abs(aggregated[1] - 40) <= 1e-9, `Expected middle fractional window to total 40 kWh, got ${aggregated[1]}.`);
  assert.ok(Math.abs(aggregated[2] - 40) <= 1e-9, `Expected trailing partial window to total 40 kWh, got ${aggregated[2]}.`);
});

test('off-earth ai dispatch follows local cycles instead of Earth days', () => {
  const mars = runScenario({ body: 'mars', aiComputeEnabled: true, batteryCapacityMWh: 24, aiReliabilityTarget: 95 });
  const moon = runScenario({ body: 'moon', aiComputeEnabled: true, batteryCapacityMWh: 24, aiReliabilityTarget: 95 });

  const marsEarlyDistinctHours = new Set(mars.annualSolar.hourlyKW.slice(0, 48).map(value => value.toFixed(6))).size;
  const moonEarlyDistinctHours = new Set(moon.annualSolar.hourlyKW.slice(0, 100).map(value => value.toFixed(6))).size;

  assert.ok(
    marsEarlyDistinctHours > 1,
    'Expected the Mars annual solar driver to vary within the first two Earth days rather than staying flat.'
  );
  assert.ok(
    moonEarlyDistinctHours > 1,
    'Expected the Moon annual solar driver to vary within the first hundred Earth hours rather than stretching one local-cycle bin across the year.'
  );

  assert.ok(
    mars.annualSolar.dayLabels.length >= 355 && mars.annualSolar.dayLabels.length <= 356,
    `Expected Mars annual AI labels to follow sols rather than 365 Earth days; observed ${mars.annualSolar.dayLabels.length}.`
  );
  assert.ok(
    moon.annualSolar.dayLabels.length >= 12 && moon.annualSolar.dayLabels.length <= 13,
    `Expected Moon annual AI labels to follow lunar cycles rather than 365 Earth days; observed ${moon.annualSolar.dayLabels.length}.`
  );
  assert.equal(
    mars.ai.dispatch.dailyAiKWh.length,
    mars.ai.dispatch.dayLabels.length,
    'Expected the Mars AI dispatch buckets to stay aligned with the modeled sol labels.'
  );
  assert.equal(
    moon.ai.dispatch.dailyAiKWh.length,
    moon.annualSolar.dayLabels.length,
    'Expected the Moon AI dispatch buckets to stay aligned with the local-cycle labels.'
  );
  assert.equal(mars.annualSolar.seasonalVariation, true, 'Expected Mars annual solar to mark that it now carries modeled seasonal variation.');
  assert.equal(moon.annualSolar.seasonalVariation, false, 'Expected the Moon annual solar path to remain a repeated representative cycle.');
  assert.match(mars.annualSolar.dayLabels[0], /^Sol 1/, 'Expected Mars cycle labels to start with sols.');
  assert.match(moon.annualSolar.dayLabels[0], /^Cycle 1/, 'Expected lunar cycle labels to start with generic cycle labels.');
});

// Sun-pointing panels (the PEL reference mounting) see the illumination
// pattern itself; low-tilt racks add a strong azimuth swing on top.
test('lunar polar proxy stays mostly on with short shadow outages', () => {
  const moon = runScenario({ body: 'moon', latitude: -89.5, longitude: 0, mountingType: 'dual' });
  const profile = moon.annualSolar.averageDayKW;
  const peak = Math.max(...profile, 0);
  const litThreshold = peak * 0.02;
  const litValues = profile.filter(value => value > litThreshold).sort((a, b) => a - b);
  const lowerQuartile = litValues[Math.floor((litValues.length - 1) * 0.25)] || 0;
  const zeroBins = profile.filter(value => value <= litThreshold).length;

  assert.ok(
    moon.solar.sunHours >= moon.solar.cycleHours * 0.75 && moon.solar.sunHours <= moon.solar.cycleHours * 0.90,
    [
      'Expected the lunar peak-of-eternal-light proxy to stay mostly illuminated, but not report a full-cycle day.',
      `Observed ${moon.solar.sunHours.toFixed(2)} of ${moon.solar.cycleHours.toFixed(2)} hours illuminated per cycle.`,
    ].join(' ')
  );
  assert.ok(
    zeroBins >= 2 && zeroBins <= 4,
    `Expected short lunar shadow outages rather than a long half-cycle blackout; observed ${zeroBins} near-zero bins in the representative cycle.`
  );
  assert.ok(
    peak > 0 && (lowerQuartile / peak) >= 0.4,
    [
      'Expected the lit portion of the lunar profile to stay relatively flat instead of collapsing into a single broad hump.',
      `Observed a lower-quartile output of ${(lowerQuartile / Math.max(peak, 1e-9)).toFixed(3)}x the peak.`,
    ].join(' ')
  );
});

test('mars annual dispatch exposes a finite full-orbit display series', () => {
  const mars = runScenario({ body: 'mars', aiComputeEnabled: true, batteryCapacityMWh: 24, aiReliabilityTarget: 95 });
  const displayLabels = mars.ai.dispatch.displayDayLabels || [];
  const displayAi = mars.ai.dispatch.displayDailyAiKWh || [];
  const displayChemical = mars.ai.dispatch.displayDailyChemicalKWh || [];

  assert.ok(
    displayLabels.length >= 668 && displayLabels.length <= 669,
    `Expected Mars annual dispatch charts to cover one Mars year; observed ${displayLabels.length} sols.`
  );
  assert.equal(
    displayAi.length,
    displayLabels.length,
    'Expected the Mars display AI buckets to stay aligned with the full-orbit sol labels.'
  );
  assert.equal(
    displayChemical.length,
    displayLabels.length,
    'Expected the Mars display chemical buckets to stay aligned with the full-orbit sol labels.'
  );
  assert.ok(
    displayLabels.length === mars.ai.dispatch.dayLabels.length,
    'Expected the Mars chart display series to stay aligned with the dispatch horizon used for sizing.'
  );
  assert.match(displayLabels[0], /^Sol 1/, 'Expected Mars full-orbit chart labels to begin with the first sol.');
  assert.match(
    displayLabels[displayLabels.length - 1],
    /^Sol 669 \(partial\)$/,
    'Expected the Mars full-orbit chart series to end at a bounded partial sol rather than an open-ended sequence.'
  );
  assert.equal(mars.ai.dispatch.dispatchBasisLabel, 'orbital-year', 'Expected Mars AI dispatch to size against a full orbital-year basis.');
});

test('mars ai reliability target matches the full-orbit display horizon', () => {
  const mars = runScenario({ body: 'mars', aiComputeEnabled: true, batteryCapacityMWh: 24, aiReliabilityTarget: 99.9 });
  const displayAi = (mars.ai.dispatch.displayDailyAiKWh || []).slice(0, -1);
  const fullSolKWh = mars.ai.designLoadKW * Calc.getBodyConfig('mars').cycleHours;
  const minServedFraction = displayAi.length > 0 ? Math.min(...displayAi) / Math.max(fullSolKWh, 1e-9) : 0;

  assert.ok(
    mars.ai.fullPowerReliability >= 0.9989,
    [
      'Expected Mars AI sizing to satisfy the configured reliability target over the full displayed orbital year.',
      `Observed ${(mars.ai.fullPowerReliability * 100).toFixed(3)}% vs target ${mars.ai.reliabilityTarget.toFixed(1)}%.`,
    ].join(' ')
  );
  assert.ok(
    minServedFraction > 0.95,
    [
      'Expected the full-orbit Mars annual dispatch chart to stay close to flat at a 99.9% reliability target.',
      `Observed a minimum served fraction of ${(minServedFraction * 100).toFixed(2)}% of full-sol AI energy.`,
    ].join(' ')
  );
});

test('mars annual solar carries a meaningful seasonal swing', () => {
  const mars = runScenario({ body: 'mars' });
  const fullSolSeriesKWh = mars.annualSolar.dailyKWh.slice(0, -1);
  const seasonalMin = Math.min(...fullSolSeriesKWh);
  const seasonalMax = Math.max(...fullSolSeriesKWh);
  const swingRatio = seasonalMin > 0 ? seasonalMax / seasonalMin : Infinity;

  assert.ok(
    swingRatio > 1.2,
    [
      'Expected the updated Mars annual solar model to show a clear orbital-seasonal swing over the modeled Earth-year slice.',
      `Observed ${seasonalMin.toFixed(3)} to ${seasonalMax.toFixed(3)} kWh/sol, a ${swingRatio.toFixed(3)}x swing.`,
    ].join(' ')
  );
});
