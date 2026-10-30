/*
 * Process modules: catalog structure and presets, reactor / DAC capex bases,
 * and exploratory routes (output, economics inputs, priority weights, peak
 * throughput and capex sizing). Feed-buffer sizing is in feed-buffers.test.js.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { CHEMISTRY } from '../../js/data/reference-data.js';
import { Calc, DEFAULT_STATE, ModuleCatalog, createState, runScenario } from './harness.js';

// Was: pinned the MTG fluid-bed capex (450) and sale price (900) data values.
test('module catalog resolves routes and markets from one definition', () => {
  ModuleCatalog.getExploratoryModules().forEach(module => {
    assert.equal(module.exploratory, true);
    const routeIds = Object.keys(module.routes);
    assert.equal(ModuleCatalog.getDefaultRoute(module.id), routeIds[0], `${module.id} default route is the first`);
    assert.deepEqual(ModuleCatalog.getRouteOptions(module).map(option => option.value), routeIds, `${module.id} route options`);
    routeIds.forEach(routeId => {
      assert.equal(ModuleCatalog.getRouteConfig(module.id, routeId), module.routes[routeId], `${module.id}/${routeId}`);
    });
    const market = ModuleCatalog.getMarketConfig(module.id);
    if (market) assert.equal(DEFAULT_STATE[`${module.id}Price`], market.defaultValue, `${module.id} default price`);
  });
  ['electrolyzer', 'dac', 'sabatier', 'methanol'].forEach(id => {
    assert.ok(ModuleCatalog.getSupportedModules().some(module => module.id === id), id);
  });
});

// Was: pinned the electro-swing DAC preset values (655 kWh/t, $4700/t-yr).
test('every module preset is recognized from its own values and a mismatched pair is custom', () => {
  ModuleCatalog.getAll().filter(module => ModuleCatalog.hasPresets(module)).forEach(module => {
    ModuleCatalog.getPresets(module).forEach(preset => {
      assert.equal(ModuleCatalog.getMatchingPreset(module.id, createState(preset.values))?.value, preset.value, `${module.id}/${preset.value}`);
      assert.equal(ModuleCatalog.getPreset(module.id, preset.value), preset);
    });
  });
  assert.equal(ModuleCatalog.getMatchingPreset('electrolyzer', createState({ electrolyzerEfficiency: 55, electrolyzerCapex: 2100 })), null);
  assert.equal(ModuleCatalog.getConfigFields('dac').find(config => config.key === 'dacCapex')?.unit, '$/t-yr');
});

test('Sabatier capex is sized on methane output power at the CH4 LHV', () => {
  const result = runScenario();
  const sabatier = result.sabatier;
  assert.ok(sabatier.designOutputKW > 0);
  // kW of CH4 = kg/h x 13.9 kWh/kg (LHV); capex = kW x $/kW CH4.
  assert.ok(Math.abs(CHEMISTRY.sabatier.ch4LhvKwhPerKg - 13.9) < 0.05, 'CH4 LHV 50.0 MJ/kg = 13.9 kWh/kg');
  assert.ok(Math.abs(sabatier.designOutputKW - sabatier.designHourlyOutputKg * CHEMISTRY.sabatier.ch4LhvKwhPerKg) <= 1e-9);
  assert.ok(Math.abs(sabatier.capex - sabatier.designOutputKW * result.state.sabatierCapex) <= 1e-6);
});

// Was: CAPEX on realized annual tonnes. Now nameplate at the 25% reference
// utilization, so hardware cost no longer depends on the site's sunshine.
test('dac capex is sized from nameplate capacity at the 25% reference utilization', () => {
  const allocation = { dac: 0.4 };
  const lessEfficient = Calc.calculateDAC(
    createState({ dacEnabled: true, dacCapex: 450, dacEnergy: 4000 }),
    125,
    3000,
    allocation
  );
  const moreEfficient = Calc.calculateDAC(
    createState({ dacEnabled: true, dacCapex: 450, dacEnergy: 2000 }),
    125,
    3000,
    allocation
  );

  assert.ok(Math.abs(lessEfficient.allocKW - 50) <= 1e-9, `Expected 50 kW of DAC allocation, got ${lessEfficient.allocKW}.`);
  // Realized: 3000 kWh/day x 0.4 / 4000 kWh/t x 365 = 109.5 t/yr.
  assert.ok(Math.abs(lessEfficient.co2AnnualTons - 109.5) <= 1e-9);
  // Nameplate: 50 kW x 8760 h x 0.25 / 4000 kWh/t = 27.375 t/yr -> x $450 = $12,318.75.
  assert.ok(Math.abs(lessEfficient.referenceCapacityTpy - 27.375) <= 1e-9);
  assert.ok(Math.abs(lessEfficient.capex - 12318.75) <= 1e-9, `Expected DAC CAPEX of $12,318.75, got ${lessEfficient.capex}.`);
  // Halving kWh/t doubles the tonnes the same kW captures, and so the CAPEX.
  assert.ok(Math.abs(moreEfficient.capex - 24637.5) <= 1e-9);

  // Same DAC power at a cloudier site: same hardware cost, fewer tonnes.
  const cloudier = Calc.calculateDAC(
    createState({ dacEnabled: true, dacCapex: 450, dacEnergy: 4000 }),
    125,
    1500,
    allocation
  );
  assert.equal(cloudier.capex, lessEfficient.capex);
  assert.ok(cloudier.co2AnnualTons < lessEfficient.co2AnnualTons);
});

test('exploratory capex controls spell out annual output capacity units', () => {
  const mtgControl = Calc.getExploratoryCapexControlConfig('mtg', 'fixed-bed');
  const desalinationControl = Calc.getExploratoryCapexControlConfig('desalination', 'reverse-osmosis');

  assert.equal(
    mtgControl.unitLabel,
    '$/ton/yr capacity',
    'Expected solid exploratory routes to show ton/yr capacity instead of the tpa shorthand.'
  );
  assert.equal(
    desalinationControl.unitLabel,
    '$/m3/day',
    'Expected desalination to keep its volumetric capacity basis.'
  );
});

test('mtg exploratory module preserves its route and reports rough modeled output', () => {
  const baseline = runScenario({ methanolEnabled: true });
  const withMtg = runScenario({ methanolEnabled: false, mtgEnabled: true, mtgRoute: 'fluid-bed' });
  const mtg = withMtg.exploratoryModules.find(module => module.id === 'mtg');
  const mtgEconomics = withMtg.economics.exploratoryDetails.find(module => module.id === 'mtg');

  assert.ok(mtg, 'Expected the MTG experimental module to be present in exploratory results.');
  assert.equal(mtg.enabled, true, 'Expected MTG to reflect the enabled toggle.');
  assert.equal(mtg.route, 'fluid-bed', 'Expected MTG to preserve the selected exploratory route.');
  assert.equal(mtg.routeConfig.diagramInputs.methanol, true, 'Expected MTG (methanol feedstock) to draw methanol on the diagram.');
  assert.equal(withMtg.state.methanolEnabled, true, 'Expected MTG to auto-enable methanol in the normalized state.');
  assert.ok(mtg.outputDailyUnits > 0, 'Expected MTG to report a non-zero rough output when methanol is available.');
  assert.ok(mtg.capex > 0, 'Expected MTG to report a rough CAPEX estimate.');
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

// Was: lime out-produced titanium at equal priority because the route power
// pool was split by priority alone. Priority is a product-unit weight (as for
// the methane/methanol split), so equal priorities give equal units and each
// route draws power in proportion to its kWh per unit.
test('exploratory priorities are product-unit weights: power follows weight x kWh per unit', () => {
  const base = {
    systemSizeMW: 100,
    sabatierEnabled: false,
    methanolEnabled: false,
    limeEnabled: true,
    titaniumEnabled: true,
  };
  const equal = runScenario({ ...base, limePriorityWeight: 100, titaniumPriorityWeight: 100 });
  const lime = equal.exploratoryModules.find(module => module.id === 'lime');
  const titanium = equal.exploratoryModules.find(module => module.id === 'titanium');
  assert.ok(lime.outputDailyUnits > 0);
  assert.ok(Math.abs(lime.outputDailyUnits - titanium.outputDailyUnits) <= 1e-9 * lime.outputDailyUnits);
  const kWhRatio = titanium.routeConfig.electricityKwhPerUnit / lime.routeConfig.electricityKwhPerUnit;
  assert.ok(Math.abs(titanium.dailyKWh / lime.dailyKWh - kWhRatio) <= 1e-9 * kWhRatio);

  const limeHeavy = runScenario({ ...base, limePriorityWeight: 100, titaniumPriorityWeight: 50 });
  const limeUnits = limeHeavy.exploratoryModules.find(module => module.id === 'lime').outputDailyUnits;
  const titaniumUnits = limeHeavy.exploratoryModules.find(module => module.id === 'titanium').outputDailyUnits;
  assert.ok(Math.abs(limeUnits / titaniumUnits - 2) <= 1e-9);
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
  const peakChemicalDailyKWh = Math.max(...(result.annualDispatch?.dailyChemicalKWh || []), 0);
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

test('exploratory capex uses annual peak throughput rather than average-day sizing', () => {
  const result = runScenario({
    latitude: 64.15,
    longitude: -21.94,
    systemSizeMW: 100,
    sabatierEnabled: false,
    methanolEnabled: false,
    limeEnabled: true,
  });

  const lime = result.exploratoryModules.find(module => module.id === 'lime');
  const route = Calc.getExploratoryRouteConfig('lime', 'resistive-calciner');
  const peakSizingKW = Math.max(result.chemicalSupply.processPowerKW, result.annualDispatch?.chemicalPeakKW || 0);
  const expectedPeakOutputUnitsPerHour = peakSizingKW / route.electricityKwhPerUnit;
  const expectedPeakSizedCapex = expectedPeakOutputUnitsPerHour *
    result.solar.cycleHours *
    result.solar.cyclesPerYear *
    lime.capexBasis *
    route.cyclingPenalty;
  const averageDayPeakKW = Math.max(...(result.annualSolar.averageDayKW || []), 0);
  const averageDaySizedCapex = (averageDayPeakKW / route.electricityKwhPerUnit) *
    result.solar.cycleHours *
    result.solar.cyclesPerYear *
    lime.capexBasis *
    route.cyclingPenalty;

  assert.ok(lime, 'Expected the lime exploratory module to be present in the modeled results.');
  assert.ok(
    Math.abs(lime.peakOutputUnitsPerHour - expectedPeakOutputUnitsPerHour) <= 1e-9,
    [
      'Expected exploratory peak sizing to track the annual peak chemical dispatch rate.',
      `Observed ${lime.peakOutputUnitsPerHour.toFixed(9)} vs expected ${expectedPeakOutputUnitsPerHour.toFixed(9)} units/hour.`,
    ].join(' ')
  );
  assert.ok(
    Math.abs(lime.capex - expectedPeakSizedCapex) <= 1e-6,
    [
      'Expected exploratory CAPEX to size from the peak hourly throughput implied by annual peak dispatch.',
      `Observed ${lime.capex.toFixed(6)} vs expected ${expectedPeakSizedCapex.toFixed(6)}.`,
    ].join(' ')
  );
  assert.ok(
    lime.capex > averageDaySizedCapex,
    'Expected seasonal peak sizing to produce more CAPEX than the old average-day sizing basis.'
  );
});
