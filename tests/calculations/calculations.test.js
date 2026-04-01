const assert = require('node:assert/strict');
const test = require('node:test');

const {
  Calc,
  createState,
  formatMoney,
  runBatterySweep,
  runScenario,
} = require('./harness');

test('default scenario stays numerically sane', () => {
  const state = createState();
  const result = runScenario();

  assert.equal(state.batteryCapacityMWh, 0, 'This regression suite assumes the current defaults start with no battery.');
  assert.equal(result.storage.enabled, false, 'Battery should stay disabled in the zero-capacity default case.');
  assert.ok(Number.isFinite(result.economics.totalCapex), 'Total CAPEX should be finite.');
  assert.ok(Number.isFinite(result.economics.totalAnnualRevenue), 'Annual revenue should be finite.');
  assert.ok(Number.isFinite(result.economics.npv), 'NPV should be finite.');
  assert.ok(Number.isFinite(result.economics.irr), 'IRR should be finite.');
  assert.ok(Number.isFinite(result.electrolyzer.h2AnnualKg), 'Hydrogen output should be finite.');
  assert.ok(Number.isFinite(result.dac.co2AnnualTons), 'DAC output should be finite.');
});

test('capex breakdown still adds up to the reported total', () => {
  const result = runScenario();
  const capex = result.economics.capex;
  const sumOfComponents = Object.values(capex).reduce((sum, value) => sum + value, 0);

  assert.ok(
    Math.abs(sumOfComponents - result.economics.totalCapex) <= 1e-6,
    `Expected CAPEX components to sum to ${formatMoney(result.economics.totalCapex)}, got ${formatMoney(sumOfComponents)}.`
  );
});

test('lean IRR path matches the full default scenario calculation', () => {
  const state = createState();
  const fullResult = Calc.calculateAll(state);
  const leanIrr = Calc.calculateIrr(state);

  assert.ok(
    Math.abs(fullResult.economics.irr - leanIrr) <= 1e-9,
    `Expected lean IRR ${leanIrr} to match full IRR ${fullResult.economics.irr}.`
  );
});

test('lean IRR path matches the full AI-enabled scenario calculation', () => {
  const state = createState({ aiComputeEnabled: true, batteryCapacityMWh: 24, aiReliabilityTarget: 95 });
  const fullResult = Calc.calculateAll(state);
  const leanIrr = Calc.calculateIrr(state);

  assert.ok(
    Math.abs(fullResult.economics.irr - leanIrr) <= 1e-9,
    `Expected lean AI IRR ${leanIrr} to match full IRR ${fullResult.economics.irr}.`
  );
});

test('lean IRR path matches the full exploratory-enabled scenario calculation', () => {
  const state = createState({
    systemSizeMW: 100,
    batteryCapacityMWh: 24,
    limeEnabled: true,
    limePrice: 1000,
  });
  const fullResult = Calc.calculateAll(state);
  const leanIrr = Calc.calculateIrr(state);

  assert.ok(Number.isFinite(fullResult.economics.irr), 'Expected the full exploratory regression case to produce a finite IRR.');
  assert.ok(Number.isFinite(leanIrr), 'Expected the lean exploratory regression case to produce a finite IRR.');
  assert.ok(
    Math.abs(fullResult.economics.irr - leanIrr) <= 1e-9,
    `Expected lean exploratory IRR ${leanIrr} to match full IRR ${fullResult.economics.irr}.`
  );
});

test('optimizer progress callback reports monotonic approximate completion', () => {
  const updates = [];
  const result = Calc.findBestRangeValueForIrr(
    createState(),
    {
      stateKey: 'methaneFeedstockSplit',
      min: 0,
      max: 100,
      step: 1,
      currentValue: 50,
      maxCoarseSamples: 101,
      maxTopRegions: 5,
    },
    {
      onProgress(progress) {
        updates.push(progress);
      },
    }
  );

  assert.ok(result === null || Number.isFinite(result.bestValue), 'Expected optimizer search to either improve the value or report no better candidate.');
  assert.ok(updates.length >= 3, 'Expected optimizer progress to report multiple updates.');
  assert.equal(updates[0].percent, 0, 'Expected optimizer progress to start at 0%.');
  assert.equal(updates[updates.length - 1].percent, 100, 'Expected optimizer progress to end at 100%.');
  assert.ok(
    updates.some(update => update.percent > 0 && update.percent < 100),
    'Expected optimizer progress to include at least one intermediate percentage.'
  );
  assert.ok(
    updates.every((update, index) => index === 0 || update.percent >= updates[index - 1].percent),
    'Expected optimizer progress percentages to be monotonic.'
  );
});

test('default 0 to 0.5 MWh battery sweep does not reduce total capex', () => {
  const [withoutBattery, withSmallBattery] = runBatterySweep([0, 0.5]);
  const expectedBatteryCapex = 0.5 * 1000 * createState().batteryCostPerKWh;

  assert.equal(
    withSmallBattery.batteryCapex,
    expectedBatteryCapex,
    `Expected 0.5 MWh of storage to add ${formatMoney(expectedBatteryCapex)} of battery CAPEX.`
  );

  assert.ok(
    withSmallBattery.totalCapex >= withoutBattery.totalCapex,
    [
      'Expected total CAPEX to stay flat or rise when battery moves from 0 to 0.5 MWh under defaults.',
      `Observed ${formatMoney(withoutBattery.totalCapex)} -> ${formatMoney(withSmallBattery.totalCapex)}.`,
    ].join(' ')
  );

  assert.ok(
    withSmallBattery.processCapex < withoutBattery.processCapex,
    [
      'Small storage should reduce downstream process sizing in the current model.',
      `Observed process CAPEX ${formatMoney(withoutBattery.processCapex)} -> ${formatMoney(withSmallBattery.processCapex)}.`,
    ].join(' ')
  );

  assert.ok(
    withSmallBattery.processPowerKW < withoutBattery.processPowerKW,
    `Expected process power to smooth downward with storage, got ${withoutBattery.processPowerKW.toFixed(1)} -> ${withSmallBattery.processPowerKW.toFixed(1)} kW.`
  );
});

test('no-battery process sizing follows the modeled direct-solar peak', () => {
  const result = runScenario({ systemSizeMW: 100, batteryCapacityMWh: 0 });
  const modeledDirectSolarPeakKW = Math.max(...result.chemicalSupply.hourlyKW, 0);

  assert.ok(
    Math.abs(result.chemicalSupply.processPowerKW - modeledDirectSolarPeakKW) <= 1e-6,
    [
      'Expected the no-battery process cap to match the modeled direct-solar peak.',
      `Observed ${result.chemicalSupply.processPowerKW.toFixed(3)} kW vs ${modeledDirectSolarPeakKW.toFixed(3)} kW.`,
    ].join(' ')
  );
});

test('100 MW 0 to 0.5 MWh battery sweep does not reduce total capex', () => {
  const [withoutBattery, withSmallBattery] = runBatterySweep([0, 0.5], { systemSizeMW: 100 });
  const expectedBatteryCapex = 0.5 * 1000 * createState().batteryCostPerKWh;

  assert.equal(
    withSmallBattery.batteryCapex,
    expectedBatteryCapex,
    `Expected 0.5 MWh of storage to add ${formatMoney(expectedBatteryCapex)} of battery CAPEX.`
  );

  assert.ok(
    withSmallBattery.totalCapex >= withoutBattery.totalCapex,
    [
      'Expected total CAPEX to stay flat or rise when battery moves from 0 to 0.5 MWh on a 100 MW array.',
      `Observed ${formatMoney(withoutBattery.totalCapex)} -> ${formatMoney(withSmallBattery.totalCapex)}.`,
    ].join(' ')
  );
});

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

test('lunar polar proxy stays mostly on with short shadow outages', () => {
  const moon = runScenario({ body: 'moon' });
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

test('invalid inputs are normalized before calculations run', () => {
  const result = runScenario({
    body: 'pluto',
    mountingType: 'bogus',
    batteryCapacityMWh: -5,
    batteryEfficiency: 150,
    electrolyzerEfficiency: 0,
    dacEnergy: 0,
    analysisHorizonYears: -3,
    debtTermYears: 999,
    discountRate: Number.NaN,
    methanePrice: -10,
  });

  assert.equal(result.state.body, createState().body, 'Invalid body keys should fall back to the default body.');
  assert.equal(
    result.state.mountingType,
    createState().mountingType,
    'Invalid mounting types should fall back to the default mounting.'
  );
  assert.equal(result.storage.enabled, false, 'Negative battery capacity should normalize to zero storage.');
  assert.ok(Number.isFinite(result.economics.totalCapex), 'Normalized scenarios should still produce finite CAPEX.');
  assert.ok(Number.isFinite(result.economics.totalAnnualRevenue), 'Normalized scenarios should still produce finite revenue.');
});

test('enabled downstream modules auto-enable their upstream process dependencies', () => {
  const mtgState = Calc.normalizeState(createState({
    mtgEnabled: true,
    methanolEnabled: false,
    electrolyzerEnabled: false,
    dacEnabled: false,
  }));
  const rwgsState = Calc.normalizeState(createState({
    carbonMonoxideEnabled: true,
    carbonMonoxideRoute: 'rwgs',
    electrolyzerEnabled: false,
    dacEnabled: false,
  }));
  const lowTempCoState = Calc.normalizeState(createState({
    carbonMonoxideEnabled: true,
    carbonMonoxideRoute: 'low-temp-electrolysis',
    sabatierEnabled: false,
    methanolEnabled: false,
    electrolyzerEnabled: false,
    dacEnabled: false,
  }));

  assert.equal(mtgState.mtgEnabled, true, 'Expected MTG to stay enabled.');
  assert.equal(mtgState.methanolEnabled, true, 'Expected MTG to auto-enable methanol.');
  assert.equal(mtgState.electrolyzerEnabled, true, 'Expected methanol-dependent MTG to auto-enable the electrolyzer chain.');
  assert.equal(mtgState.dacEnabled, true, 'Expected methanol-dependent MTG to auto-enable DAC.');

  assert.equal(rwgsState.carbonMonoxideEnabled, true, 'Expected the CO module to stay enabled.');
  assert.equal(rwgsState.dacEnabled, true, 'Expected CO production to auto-enable DAC.');
  assert.equal(rwgsState.electrolyzerEnabled, true, 'Expected the RWGS route to auto-enable electrolyzer feed.');

  assert.equal(lowTempCoState.carbonMonoxideEnabled, true, 'Expected the low-temp CO route to stay enabled.');
  assert.equal(lowTempCoState.dacEnabled, true, 'Expected every CO route to auto-enable DAC.');
  assert.equal(lowTempCoState.electrolyzerEnabled, false, 'Expected non-RWGS CO routes to avoid forcing the electrolyzer.');
});

test('mtg exploratory module preserves its route and reports rough modeled output', () => {
  const baseline = runScenario({ methanolEnabled: true });
  const withMtg = runScenario({ methanolEnabled: false, mtgEnabled: true, mtgRoute: 'fluid-bed' });
  const mtg = withMtg.exploratoryModules.find(module => module.id === 'mtg');
  const mtgEconomics = withMtg.economics.exploratoryDetails.find(module => module.id === 'mtg');

  assert.ok(mtg, 'Expected the MTG experimental module to be present in exploratory results.');
  assert.equal(mtg.enabled, true, 'Expected MTG to reflect the enabled toggle.');
  assert.equal(mtg.route, 'fluid-bed', 'Expected MTG to preserve the selected exploratory route.');
  assert.equal(mtg.diagramInputs?.methanol, true, 'Expected MTG to advertise methanol as a required diagram input.');
  assert.equal(withMtg.state.methanolEnabled, true, 'Expected MTG to auto-enable methanol in the normalized state.');
  assert.ok(mtg.outputDailyUnits > 0, 'Expected MTG to report a non-zero rough output when methanol is available.');
  assert.ok(mtg.capex > 0, 'Expected MTG to report a rough block CAPEX estimate.');
  assert.ok(mtgEconomics, 'Expected MTG to appear in the exploratory economics breakdown.');
  assert.ok(mtgEconomics.capex > 0, 'Expected MTG CAPEX to flow into project economics.');
  assert.ok(mtgEconomics.annualRevenue > 0, 'Expected MTG revenue to flow into project economics.');
  assert.ok(
    withMtg.economics.modeledExploratoryModules.includes('MTG (Methanol -> Gasoline)'),
    'Expected MTG to appear in the modeled exploratory route list.'
  );
  assert.ok(
    withMtg.economics.capex.exploratory > 0,
    'Expected exploratory CAPEX to contribute to total project CAPEX.'
  );
  assert.ok(
    withMtg.methanol.exportAnnualTons < baseline.methanol.annualTons,
    'Expected MTG to divert part of the gross methanol stream away from export.'
  );
});

test('exploratory economics honor custom capex, sale price, and o&m inputs', () => {
  const lowCase = runScenario({
    methanolEnabled: false,
    mtgEnabled: true,
    mtgRoute: 'fluid-bed',
    mtgCapexBasis: 200,
    mtgPrice: 600,
    exploratoryOmPercent: 1,
  });
  const highCase = runScenario({
    methanolEnabled: false,
    mtgEnabled: true,
    mtgRoute: 'fluid-bed',
    mtgCapexBasis: 1200,
    mtgPrice: 1200,
    exploratoryOmPercent: 10,
  });

  const lowMtg = lowCase.economics.exploratoryDetails.find(module => module.id === 'mtg');
  const highMtg = highCase.economics.exploratoryDetails.find(module => module.id === 'mtg');

  assert.ok(lowMtg, 'Expected the low-input MTG case to produce exploratory economics details.');
  assert.ok(highMtg, 'Expected the high-input MTG case to produce exploratory economics details.');
  assert.equal(lowMtg.unitPrice, 600, 'Expected the exploratory unit price to track the configured sale price.');
  assert.equal(highMtg.unitPrice, 1200, 'Expected the exploratory unit price to track the configured sale price.');
  assert.ok(highMtg.capex > lowMtg.capex, 'Expected MTG CAPEX to rise with the configured CAPEX basis.');
  assert.ok(highMtg.annualRevenue > lowMtg.annualRevenue, 'Expected MTG revenue to rise with the configured sale price.');
  assert.ok(highMtg.annualOM > lowMtg.annualOM, 'Expected MTG annual O&M to rise with the configured O&M percentage.');
});

test('multiple exploratory routes no longer collapse to the same output', () => {
  const result = runScenario({
    systemSizeMW: 100,
    sabatierEnabled: false,
    methanolEnabled: false,
    limeEnabled: true,
    titaniumEnabled: true,
    limePriorityWeight: 100,
    titaniumPriorityWeight: 100,
  });

  const lime = result.exploratoryModules.find(module => module.id === 'lime');
  const titanium = result.exploratoryModules.find(module => module.id === 'titanium');

  assert.ok(lime && titanium, 'Expected both exploratory modules to be present in the modeled results.');
  assert.ok(lime.outputDailyUnits > 0, 'Expected lime to produce a non-zero exploratory output.');
  assert.ok(titanium.outputDailyUnits > 0, 'Expected titanium to produce a non-zero exploratory output.');
  assert.ok(
    Math.abs(lime.outputDailyUnits - titanium.outputDailyUnits) > 1e-6,
    'Expected different electricity intensities to produce different exploratory outputs.'
  );
  assert.ok(
    lime.outputDailyUnits > titanium.outputDailyUnits,
    'Expected the lower-intensity lime route to produce more output than the higher-intensity titanium route at equal priority.'
  );
});

test('exploratory modules expose peak-day throughput for diagram cards', () => {
  const result = runScenario({
    latitude: 64.15,
    longitude: -21.94,
    systemSizeMW: 100,
    sabatierEnabled: false,
    methanolEnabled: false,
    limeEnabled: true,
  });

  const lime = result.exploratoryModules.find(module => module.id === 'lime');
  const peakChemicalDailyKWh = Math.max(...(result.ai.dispatch?.dailyChemicalKWh || []), 0);
  const expectedPeakScale = result.chemicalSupply.dailyAvailableKWh > 0
    ? Math.max(1, peakChemicalDailyKWh / result.chemicalSupply.dailyAvailableKWh)
    : 1;

  assert.ok(lime, 'Expected the lime exploratory module to be present in the modeled results.');
  assert.ok(lime.outputDailyUnits > 0, 'Expected the lime route to produce a non-zero average-cycle output.');
  assert.ok(
    lime.peakOutputDailyUnits > lime.outputDailyUnits,
    'Expected the peak-day throughput to exceed the average-cycle throughput in a seasonal solar case.'
  );
  assert.ok(
    Math.abs(lime.peakOutputDailyUnits - (lime.outputDailyUnits * expectedPeakScale)) <= 1e-6,
    [
      'Expected the diagram peak throughput to scale from the modeled most-active chemical day.',
      `Observed ${lime.peakOutputDailyUnits.toFixed(6)} vs expected ${(lime.outputDailyUnits * expectedPeakScale).toFixed(6)}.`,
    ].join(' ')
  );
});

test('simple payback reports first recovery even if later years dip negative', () => {
  const simplePaybackYears = Calc.calculateSimplePaybackYears(100, [120, -30]);
  const sustainedPaybackYears = Calc.calculateSustainedPaybackYears(100, [120, -30]);

  assert.ok(
    Math.abs(simplePaybackYears - (100 / 120)) <= 1e-9,
    `Expected first-crossover payback at ${(100 / 120).toFixed(6)} years, got ${simplePaybackYears}.`
  );
  assert.equal(
    sustainedPaybackYears,
    Infinity,
    'The sustained-payback helper should still reject paths that dip negative again later.'
  );
});
