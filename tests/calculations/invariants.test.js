/*
 * Invariant matrix: identities every scenario must satisfy, whatever the
 * inputs. Each check recomputes its truth independently of the model code
 * (own NPV / IRR root test, stoichiometric masses from molar masses, energy
 * conservation, scale homogeneity) instead of snapshotting outputs.
 *
 * Adding a scenario: append an entry to SCENARIOS (overrides on top of
 * DEFAULT_STATE). Every invariant below runs on it automatically.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { LOCATION_PRESETS } from '../../js/data/reference-data.js';
import { capexChartSlices } from '../../js/ui/charts/capex-chart.js';
import { Calc, ModuleCatalog, createState } from './harness.js';

const EXPLORATORY = ModuleCatalog.getAll().filter(module => module.exploratory);

/* Same fields the site picker writes when a location preset is chosen
   (ui/site-controls.js), so the yield matches the site. */
function sitePreset(namePrefix) {
  const preset = LOCATION_PRESETS.find(entry => entry.name.startsWith(namePrefix));
  assert.ok(preset, `location preset ${namePrefix}`);
  return {
    body: preset.body || 'earth',
    solarProfileModel: preset.profile || preset.body || 'earth',
    latitude: preset.lat,
    longitude: preset.lon,
    siteYieldMwhPerMwdcYear: preset.baseYield,
    siteYieldSource: 'preset',
    locationPresetIsCustom: false,
  };
}

const SCENARIOS = {
  default: {},
  policyNone: { policyMode: 'none' },
  battery2: { batteryCapacityMWh: 2 },
  battery20: { batteryCapacityMWh: 20 },
  // Cycle life binds before the 12-year calendar cap.
  battery2LowCycles: { batteryCapacityMWh: 2, batteryCycles: 1000 },
  large100MW: { systemSizeMW: 100, batteryCapacityMWh: 24, chemicalSizingPercent: 70 },
  methanolOnly: { sabatierEnabled: false, methanolEnabled: true },
  methaneMethanolMtg: { methanolEnabled: true, mtgEnabled: true },
  allExploratory: Object.fromEntries(EXPLORATORY.map(module => [`${module.id}Enabled`, true])),
  // Buffers default off, so the alternative-route row turns them on to cover
  // the buffered sizing path as well.
  allExploratoryAltRoutesBuffered: {
    sabatierBufferEnabled: true,
    ...Object.fromEntries(EXPLORATORY.flatMap(module => [
      [`${module.id}Enabled`, true],
      [`${module.id}BufferEnabled`, true],
      [`${module.id}Route`, Object.keys(module.routes).at(-1)],
    ])),
  },
  financing70: { financingEnabled: true, debtSharePercent: 70 },
  financing90: { financingEnabled: true, debtSharePercent: 90 },
  debtPastHorizon: { financingEnabled: true, debtTermYears: 25, analysisHorizonYears: 20 },
  horizon40: { analysisHorizonYears: 40, methanolEnabled: true },
  // Short horizon: most of the capex comes back only as final-year salvage.
  horizon3: { analysisHorizonYears: 3 },
  us48e: { policyMode: 'us_48e_solar' },
  us45y: { policyMode: 'us_45y_solar' },
  ukCfd: { policyMode: 'uk_cfd_solar_ar7' },
  // A grant on total installed CAPEX, exploratory routes included.
  euGrantWithAmmonia: { policyMode: 'eu_innovation_fund', ammoniaEnabled: true },
  ai: { aiComputeEnabled: true },
  aiBattery: { aiComputeEnabled: true, batteryCapacityMWh: 8, aiReliabilityTarget: 95 },
  mars: sitePreset('Mars'),
  moonPel: { ...sitePreset('Moon'), mountingType: 'dual' },
  berlin: sitePreset('Berlin'),
  zeroSize: { systemSizeMW: 0 },
  // No product reactor: the electrolyzer / DAC split falls back to the
  // methane ratio among the enabled blocks.
  noReactor: { sabatierEnabled: false },
  dacOnly: { sabatierEnabled: false, electrolyzerEnabled: false },
};

const results = Object.fromEntries(
  Object.entries(SCENARIOS).map(([name, overrides]) => [name, Calc.calculateAll(createState(overrides))])
);

function forEachScenario(check) {
  Object.entries(results).forEach(([name, result]) => check(result, name));
}

const relClose = (actual, expected, relTol, label, absTol = 1e-9) => assert.ok(
  Math.abs(actual - expected) <= Math.max(absTol, relTol * Math.max(Math.abs(actual), Math.abs(expected))),
  `${label}: expected ${expected}, got ${actual}`
);
const sum = values => values.reduce((total, value) => total + value, 0);

/* Independent NPV: sum cf_t / (1 + r)^t, t = 0 at financial close. */
function npv(cashFlows, rate) {
  let total = 0;
  for (let year = 0; year < cashFlows.length; year++) total += cashFlows[year] / Math.pow(1 + rate, year);
  return total;
}

function projectCashFlows(economics) {
  return [-economics.netCapexAtClose, ...economics.yearlyCashFlows.map(entry => entry.netCashFlow)];
}

function equityCashFlows(economics) {
  return [-economics.financing.equityUpfront, ...economics.yearlyCashFlows.map(entry => entry.equityCashFlow)];
}

function moneyScale(economics) {
  return Math.max(1, economics.totalCapex, Math.abs(economics.npv));
}

test('I1 NPV equals an independent discounted sum of the yearly cash flows (incl. salvage)', () => {
  forEachScenario((result, name) => {
    const economics = result.economics;
    const rate = result.state.discountRate / 100;
    const timeline = economics.cashFlowTimeline;
    economics.yearlyCashFlows.forEach((entry, index) => {
      // Net cash = revenue - O&M - replacements + salvage, rebuilt from parts.
      const rebuilt = entry.totalRevenue - timeline.annualOperatingCost[index + 1] -
        entry.replacementOutflow + entry.salvageValue;
      relClose(entry.netCashFlow, rebuilt, 1e-9, `${name} year ${entry.year} net cash`, 1e-6);
      relClose(entry.equityCashFlow, entry.netCashFlow - entry.debtService, 1e-9, `${name} year ${entry.year} equity cash`, 1e-6);
      // DSCR on CFADS = revenue - O&M (before reserve-funded replacements);
      // every negative equity year, replacement-driven or not, is sponsor cash.
      // The scheduled payment excludes a horizon balloon.
      if (entry.dscr !== null) {
        const scheduled = entry.debtService - entry.balloonPayment;
        relClose(entry.dscr, (entry.totalRevenue - timeline.annualOperatingCost[index + 1]) / scheduled, 1e-9, `${name} year ${entry.year} DSCR`, 1e-9);
      }
      relClose(entry.sponsorSupportNeeded, economics.financing.enabled ? Math.max(0, -entry.equityCashFlow) : 0, 1e-9, `${name} year ${entry.year} sponsor`, 1e-6);
    });
    relClose(economics.yearlyCashFlows.at(-1).salvageValue, economics.salvageValue, 1e-12, `${name} salvage in final year`);
    relClose(economics.npv, npv(projectCashFlows(economics), rate), 1e-9, `${name} project NPV`, 1e-6);
    relClose(economics.equityNpv, npv(equityCashFlows(economics), rate), 1e-9, `${name} equity NPV`, 1e-6);
  });
});

test('I2 a reported IRR zeroes NPV; a withheld IRR carries a reason and MIRR stays finite', () => {
  forEachScenario((result, name) => {
    const economics = result.economics;
    const legs = [
      ['project', economics.projectIrr, economics.projectIrrAnalysis, economics.projectMirr, projectCashFlows(economics)],
      ['equity', economics.equityIrr, economics.equityIrrAnalysis, economics.equityMirr, equityCashFlows(economics)],
    ];
    legs.forEach(([leg, irr, analysis, mirr, cashFlows]) => {
      const label = `${name} ${leg}`;
      if (Number.isFinite(irr)) {
        assert.equal(analysis.status, 'ok', label);
        assert.ok(Math.abs(npv(cashFlows, irr / 100)) <= 1e-6 * moneyScale(economics), `${label}: NPV(IRR) = ${npv(cashFlows, irr / 100)}`);
      } else {
        assert.notEqual(analysis.status, 'ok', label);
        assert.ok(typeof analysis.reason === 'string' && analysis.reason.length > 0, `${label}: IRR n/a needs a reason`);
      }
      const hasOutflow = cashFlows.some(value => value < 0);
      const hasInflow = cashFlows.some(value => value > 0);
      if (hasOutflow && hasInflow) assert.ok(Number.isFinite(mirr), `${label}: MIRR finite`);
    });
    // Headline metrics follow the financing toggle.
    const levered = economics.financing.enabled;
    assert.ok(Object.is(economics.irr, levered ? economics.equityIrr : economics.projectIrr), `${name} headline IRR`);
    assert.ok(Object.is(economics.mirr, levered ? economics.equityMirr : economics.projectMirr), `${name} headline MIRR`);
  });
});

test('I3 capex components sum to the total; yearly arrays span the horizon; cumulative columns are running sums', () => {
  forEachScenario((result, name) => {
    const economics = result.economics;
    const horizon = result.state.analysisHorizonYears;
    relClose(sum(Object.values(economics.capex)), economics.totalCapex, 1e-12, `${name} capex sum`, 1e-6);
    const solarParts = economics.capexItems.find(item => item.key === 'solar').parts;
    relClose(sum(solarParts.map(part => part.capex)), economics.capex.solar, 1e-12, `${name} solar capex parts`, 1e-6);
    relClose(result.solar.landCapex, economics.capex.land, 1e-12, `${name} land capex`, 1e-6);
    relClose(
      sum(economics.replacementSchedule.map(entry => entry.total)),
      economics.totalReplacementOutflows,
      1e-12,
      `${name} replacement total`,
      1e-6
    );

    assert.equal(economics.yearlyCashFlows.length, horizon, `${name} yearly cash flows`);
    economics.yearlyCashFlows.forEach((entry, index) => assert.equal(entry.year, index + 1, `${name} year index`));
    assert.equal(result.lifetimeEnergy.solarFactorByYear.length, horizon, `${name} lifetime energy`);
    assert.equal(result.lifetimeEnergy.chemicalKWhByYear.length, horizon, `${name} lifetime chemical energy`);
    Object.entries(economics.cashFlowTimeline).forEach(([key, value]) => {
      if (Array.isArray(value)) assert.equal(value.length, horizon + 1, `${name} timeline ${key} (close + years)`);
    });

    let project = -economics.netCapexAtClose;
    let equity = -economics.financing.equityUpfront;
    let operating = -economics.netCapexAtClose;
    economics.yearlyCashFlows.forEach(entry => {
      project += entry.netCashFlow;
      equity += entry.equityCashFlow;
      operating += entry.operatingCashFlow;
      const tol = 1e-9 * moneyScale(economics);
      assert.ok(Math.abs(entry.cumulativeNetCash - project) <= tol, `${name} cumulative net cash year ${entry.year}`);
      assert.ok(Math.abs(entry.cumulativeEquityCash - equity) <= tol, `${name} cumulative equity cash year ${entry.year}`);
      assert.ok(Math.abs(entry.cumulativeOperatingCash - operating) <= tol, `${name} cumulative operating cash year ${entry.year}`);
    });
    relClose(economics.finalCumulativeNetCash, project, 1e-9, `${name} final cumulative`, 1e-6);
    const timeline = economics.cashFlowTimeline;
    timeline.cumulativeProjectCash.forEach((value, index) => {
      relClose(value, sum(timeline.projectCashFlow.slice(0, index + 1)), 1e-9, `${name} timeline cumulative ${index}`, 1e-6);
    });
  });
});

const h2Consumed = result => (result.sabatier.h2Consumed || 0) + (result.methanol.h2Consumed || 0) +
  sum(result.exploratoryModules.map(module => module.h2Consumed || 0));
const co2Consumed = result => (result.sabatier.co2Consumed || 0) + (result.methanol.co2Consumed || 0) +
  sum(result.exploratoryModules.map(module => module.co2Consumed || 0));

test('I4 H2 and CO2 produced equal the sum consumed plus a non-negative surplus', () => {
  forEachScenario((result, name) => {
    const h2 = result.electrolyzer.h2DailyKg;
    const co2 = result.dac.co2DailyKg;
    assert.ok(result.h2Surplus >= 0 && result.co2Surplus >= 0, `${name} surplus >= 0`);
    assert.ok(Math.abs(h2 - h2Consumed(result) - result.h2Surplus) <= 1e-6 * Math.max(h2, 1e-9), `${name} H2 balance`);
    assert.ok(Math.abs(co2 - co2Consumed(result) - result.co2Surplus) <= 1e-6 * Math.max(co2, 1e-9), `${name} CO2 balance`);
    // Methanol fed to MTG comes out of the reactor's gross output.
    const mtgMethanol = sum(result.exploratoryModules.map(module => module.methanolConsumed || 0));
    if (result.methanol.enabled) {
      relClose(result.methanol.exportDailyKg + mtgMethanol, result.methanol.reactorDailyKg, 1e-9, `${name} methanol split`);
    } else {
      assert.equal(mtgMethanol, 0, `${name} no methanol for MTG without the reactor`);
    }
    // Exploratory routes convert their feeds fully, so the only stranded
    // H2 / CO2 is the unconverted fraction of the supported reactors
    // (all of it when nothing consumes that feed).
    const plan = Calc.buildProcessAllocationPlan(result.state);
    if (!Object.keys(plan.feedShares.h2).length || !Object.keys(plan.feedShares.co2).length) return;
    const conversions = [1];
    if (result.sabatier.enabled) conversions.push(result.state.sabatierConversion / 100);
    if (result.methanol.enabled) conversions.push(result.state.methanolEfficiency / 100);
    const maxStranded = 1 - Math.min(...conversions);
    assert.ok(result.h2Surplus <= maxStranded * h2 + 1e-9, `${name} H2 surplus ${result.h2Surplus / h2} <= ${maxStranded}`);
    assert.ok(result.co2Surplus <= maxStranded * co2 + 1e-9, `${name} CO2 surplus ${result.co2Surplus / co2} <= ${maxStranded}`);
  });
});

test('I4 no exploratory route is handed power or feed it cannot use', () => {
  // Output is min(power / kWh per unit, feed_i / kg per unit). With power
  // and feeds shared by the same weight x need product, every limit binds at
  // once; a looser limit means electricity or gas went to a route that
  // cannot use it.
  forEachScenario((result, name) => {
    const plan = Calc.buildProcessAllocationPlan(result.state);
    result.exploratoryModules.filter(module => module.enabled).forEach(module => {
      const route = module.routeConfig;
      const feeds = route.feedstocks || {};
      const limits = { power: module.dailyKWh / route.electricityKwhPerUnit };
      if (feeds.h2Kg > 0) limits.h2 = result.electrolyzer.h2DailyKg * (plan.feedShares.h2[module.id] || 0) / feeds.h2Kg;
      if (feeds.co2Kg > 0) limits.co2 = result.dac.co2DailyKg * (plan.feedShares.co2[module.id] || 0) / feeds.co2Kg;
      if (feeds.methanolKg > 0) limits.methanol = result.methanol.reactorDailyKg * (plan.feedShares.methanol[module.id] || 0) / feeds.methanolKg;
      Object.entries(limits).forEach(([kind, limit]) => {
        relClose(limit, module.outputDailyUnits, 1e-9, `${name} ${module.id} ${kind}-limited output`);
      });
    });
  });
});

// Molar masses (g/mol): H2 2.016, CO2 44.01, CH4 16.04, CH3OH 32.04, H2O 18.015.
// Sabatier CO2 + 4 H2 -> CH4 + 2 H2O; methanol CO2 + 3 H2 -> CH3OH + H2O.
const M = { h2: 2.016, co2: 44.01, ch4: 16.04, meoh: 32.04, h2o: 18.015 };

test('I5 reactor and electrolyzer flows follow stoichiometry', () => {
  forEachScenario((result, name) => {
    const s = result.sabatier;
    if (s.enabled && s.ch4DailyKg > 0) {
      relClose(s.co2Consumed / s.h2Consumed, M.co2 / (4 * M.h2), 5e-3, `${name} Sabatier CO2:H2`);
      relClose(s.ch4DailyKg, (s.h2Consumed / (4 * M.h2)) * M.ch4, 5e-3, `${name} Sabatier CH4 from H2`);
      relClose(s.waterProducedDaily, (s.ch4DailyKg / M.ch4) * 2 * M.h2o, 5e-3, `${name} Sabatier water`);
      relClose(s.ch4AnnualKg, s.ch4DailyKg * result.solar.cyclesPerYear, 1e-12, `${name} CH4 annual`);
    }
    const m = result.methanol;
    if (m.enabled && m.reactorDailyKg > 0) {
      relClose(m.co2Consumed / m.h2Consumed, M.co2 / (3 * M.h2), 5e-3, `${name} methanol CO2:H2`);
      relClose(m.reactorDailyKg, (m.h2Consumed / (3 * M.h2)) * M.meoh, 5e-3, `${name} MeOH from H2`);
      relClose(m.waterProducedDaily, (m.reactorDailyKg / M.meoh) * M.h2o, 5e-3, `${name} methanol water`);
    }
    const e = result.electrolyzer;
    if (e.enabled && e.h2DailyKg > 0) {
      // Model's stated stoichiometric intensity (18.015 / 2.016 = 8.94, rounded to 9).
      relClose(e.waterDailyKg, 9 * e.h2DailyKg, 1e-12, `${name} electrolysis water`);
      relClose(e.h2DailyKg, e.dailyKWh / result.state.electrolyzerEfficiency, 1e-12, `${name} H2 from kWh`);
      assert.ok(result.state.electrolyzerEfficiency >= 39.4 - 1e-9, `${name} electrolyzer at or above the HHV floor`);
    }
    const d = result.dac;
    if (d.enabled && d.co2DailyKg > 0) {
      relClose(d.co2DailyKg, (d.dailyKWh / result.state.dacEnergy) * 1000, 1e-12, `${name} DAC CO2 from kWh`);
    }
  });
});

test('I6 energy: delivered + clipped <= solar, allocations sum to delivered, CF <= 1, series total = annual MWh', () => {
  forEachScenario((result, name) => {
    const dispatch = result.annualDispatch;
    const solarKWh = dispatch.solarKWh;
    const tol = 1e-6 * Math.max(1, solarKWh);
    const used = dispatch.chemicalKWh + (dispatch.aiServedKWh || 0) + dispatch.clippedSolarKWh;
    assert.ok(used <= solarKWh + tol, `${name}: delivered + clipped ${used} <= solar ${solarKWh}`);
    if (!result.storage.enabled) {
      relClose(used, solarKWh, 1e-6, `${name}: without storage every solar kWh is delivered or clipped`, 1e-6);
    } else {
      // The gap is battery round-trip loss (+ self-discharge, + SoC change).
      const losses = solarKWh - used;
      const roundTripLoss = dispatch.chargeInputKWh - dispatch.dischargeThroughputKWh;
      assert.ok(losses >= -tol, `${name}: storage losses non-negative`);
      relClose(losses, roundTripLoss - (dispatch.endSocKWh - dispatch.startSocKWh), 1e-6, `${name}: losses = charge in - discharge out - dSoC`, tol);
    }

    // Delivered chemical energy is shared among the processes without loss.
    const cycles = result.solar.cyclesPerYear;
    const delivered = result.chemicalSupply.dailyAvailableKWh;
    const allocated = result.electrolyzer.dailyKWh + result.dac.dailyKWh +
      sum(result.exploratoryModules.map(module => module.dailyKWh || 0));
    relClose(allocated, delivered, 1e-9, `${name}: process allocations = delivered`, 1e-6);
    // The dispatch runs over its own basis (Earth year; Mars orbital year),
    // so compare delivered fractions of solar, which do not depend on it.
    const annualSolarKWh = result.solar.annualMWh * 1000;
    if (annualSolarKWh > 0) {
      relClose(
        (delivered * cycles) / annualSolarKWh,
        dispatch.chemicalKWh / solarKWh,
        1e-9,
        `${name}: annual chemical energy / solar on both bases`,
        1e-9
      );
      if (result.state.aiComputeEnabled) {
        relClose(result.ai.annualAiServedKWh / annualSolarKWh, dispatch.aiServedKWh / solarKWh, 1e-9, `${name}: AI served / solar`, 1e-9);
      }
    }

    const cf = result.chemicalSupply.effectiveCF;
    assert.ok(cf >= 0 && cf <= 1 + 1e-12, `${name}: effective CF ${cf}`);
    assert.ok(result.solar.capacityFactor >= 0 && result.solar.capacityFactor <= 1, `${name}: solar CF`);
    if (!result.warnings.length) {
      relClose(result.annualSolar.totalKWh, result.solar.annualMWh * 1000, 1e-6, `${name}: series total = annual MWh`, 1e-6);
    }
  });
});

test('I6b revenue lines are physical output x price and follow their energy over the years', () => {
  forEachScenario((result, name) => {
    const { economics, state, lifetimeEnergy } = result;
    const revenue = economics.revenue;
    relClose(revenue.methane, result.sabatier.enabled ? result.sabatier.ch4AnnualMCF * state.methanePrice : 0, 1e-12, `${name} methane revenue`);
    relClose(revenue.methanol, result.methanol.enabled ? result.methanol.exportAnnualTons * state.methanolPrice : 0, 1e-12, `${name} methanol revenue`);
    relClose(
      revenue.exploratory,
      sum(result.exploratoryModules.filter(module => module.enabled).map(module => module.annualOutputUnits * state[`${module.id}Price`])),
      1e-12,
      `${name} exploratory revenue`
    );
    relClose(revenue.ai, result.ai.enabled ? (result.ai.annualAiServedKWh / 1000) * state.aiMillionTokensPerMWh * state.aiTokenPricePerM : 0, 1e-12, `${name} AI revenue`);
    relClose(economics.totalAnnualRevenue, sum(Object.values(revenue)), 1e-12, `${name} total revenue`);
    // Product revenue in year t scales with that year's delivered chemical
    // energy; AI revenue with the AI-served energy.
    economics.yearlyCashFlows.forEach((entry, index) => {
      const product = revenue.methane + revenue.methanol + revenue.exploratory;
      const yearProduct = entry.revenue.methane + entry.revenue.methanol + entry.revenue.exploratory;
      relClose(yearProduct, product * lifetimeEnergy.chemicalFactorByYear[index], 1e-9, `${name} product revenue year ${entry.year}`, 1e-6);
      relClose(entry.revenue.ai, revenue.ai * lifetimeEnergy.aiServedFactorByYear[index], 1e-9, `${name} AI revenue year ${entry.year}`, 1e-6);
      relClose(lifetimeEnergy.chemicalKWhByYear[index], lifetimeEnergy.chemicalKWhByYear[0] * lifetimeEnergy.chemicalFactorByYear[index], 1e-9, `${name} chemical energy factor year ${entry.year}`, 1e-6);
    });
    // Hardware is priced on its own sizing basis.
    relClose(result.electrolyzer.capex, result.electrolyzer.allocKW * state.electrolyzerCapex, 1e-12, `${name} electrolyzer capex`);
    relClose(economics.capex.battery, state.batteryCapacityMWh * 1000 * state.batteryCostPerKWh, 1e-12, `${name} battery capex`);
    relClose(result.solar.moduleCapex, state.systemSizeMW * 1e6 * state.panelCostPerW, 1e-12, `${name} module capex`);
  });
});

/* Fields that are legitimately undefined for some cash-flow shapes, plus
   land's infinite remaining life (it is never depreciated). */
const NA_ABLE = /(^|\.)(remainingYears|irr|projectIrr|equityIrr|mirr|projectMirr|equityMirr|roi|paybackYears|sustainedPaybackYears|equityPaybackYears|sustainedEquityPaybackYears|dscr|minDscr|averageDscr|bestIrr)$/;

function collectNonFinite(value, path, out, seen) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) && !NA_ABLE.test(path)) out.push(`${path}=${value}`);
    return;
  }
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  if (ArrayBuffer.isView(value)) {
    value.forEach((item, index) => collectNonFinite(item, `${path}[${index}]`, out, seen));
    return;
  }
  Object.entries(value).forEach(([key, item]) => collectNonFinite(item, path ? `${path}.${key}` : key, out, seen));
}

test('I7 every numeric output is finite (except n/a-able returns) and physical quantities are non-negative', () => {
  forEachScenario((result, name) => {
    const nonFinite = [];
    collectNonFinite(result, '', nonFinite, new Set());
    assert.deepEqual(nonFinite.slice(0, 10), [], `${name}: non-finite outputs`);

    Object.entries(result.economics.capex).forEach(([key, value]) => assert.ok(value >= 0, `${name}: capex.${key} = ${value}`));
    assert.ok(result.economics.totalCapex >= 0, `${name}: total capex`);
    assert.ok(result.solar.acres >= 0 && result.environmental.landAcres >= 0, `${name}: acres`);
    [
      result.electrolyzer.h2DailyKg,
      result.dac.co2DailyKg,
      result.sabatier.ch4DailyKg,
      result.methanol.reactorDailyKg,
      result.methanol.exportDailyKg,
      ...result.exploratoryModules.map(module => module.outputDailyUnits),
      ...result.exploratoryModules.map(module => module.capex),
      result.annualDispatch.chemicalKWh,
      result.annualDispatch.clippedSolarKWh,
      result.annualDispatch.aiServedKWh,
    ].forEach((value, index) => assert.ok(value >= 0, `${name}: output #${index} = ${value}`));
    // Market revenue lines are non-negative; only policy support (two-way
    // CfD) can be negative.
    Object.entries(result.economics.revenue).forEach(([key, value]) => {
      if (key !== 'policyCredits') assert.ok(value >= 0, `${name}: revenue.${key}`);
    });
  });
});

function doubledOverrides(overrides) {
  const base = createState(overrides);
  return {
    ...overrides,
    systemSizeMW: base.systemSizeMW * 2,
    batteryCapacityMWh: base.batteryCapacityMWh * 2,
  };
}

test('I8 scale homogeneity: 2x array (and battery) doubles capex, NPV, outputs and land; returns unchanged', () => {
  Object.entries(SCENARIOS).forEach(([name, overrides]) => {
    const base = results[name];
    // An AI scenario without an explicit battery gets one seeded from annual
    // solar GWh, which also doubles, so it stays homogeneous.
    const doubled = Calc.calculateAll(createState(doubledOverrides(overrides)));
    const tol = 1e-6;
    const pairs = [
      ['totalCapex', base.economics.totalCapex, doubled.economics.totalCapex],
      ['npv', base.economics.npv, doubled.economics.npv],
      ['equityNpv', base.economics.equityNpv, doubled.economics.equityNpv],
      ['annual revenue', base.economics.totalAnnualRevenue, doubled.economics.totalAnnualRevenue],
      ['H2', base.electrolyzer.h2AnnualKg, doubled.electrolyzer.h2AnnualKg],
      ['CO2', base.dac.co2AnnualKg, doubled.dac.co2AnnualKg],
      ['CH4', base.sabatier.ch4AnnualKg, doubled.sabatier.ch4AnnualKg],
      ['methanol', base.methanol.annualKg, doubled.methanol.annualKg],
      ['acres', base.solar.acres, doubled.solar.acres],
      ['delivered', base.annualDispatch.chemicalKWh, doubled.annualDispatch.chemicalKWh],
      ['AI served', base.annualDispatch.aiServedKWh, doubled.annualDispatch.aiServedKWh],
      ...base.exploratoryModules.map((module, index) => [
        `${module.id} output`, module.annualOutputUnits, doubled.exploratoryModules[index].annualOutputUnits,
      ]),
    ];
    pairs.forEach(([label, one, two]) => {
      relClose(two, 2 * one, tol, `${name} ${label}`, 1e-6);
    });
    ['irr', 'equityIrr', 'mirr'].forEach(key => {
      const one = base.economics[key];
      const two = doubled.economics[key];
      if (Number.isFinite(one) || Number.isFinite(two)) relClose(two, one, tol, `${name} ${key}`, 1e-9);
    });
  });
});

/* Monotonicity sweeps: each list is in increasing order of the input. */
function sweep(baseOverrides, key, values, read) {
  return values.map(value => read(Calc.calculateAll(createState({ ...baseOverrides, [key]: value }))));
}

function assertMonotone(series, direction, label) {
  for (let i = 1; i < series.length; i++) {
    const ok = direction > 0 ? series[i] > series[i - 1] : series[i] < series[i - 1];
    assert.ok(ok, `${label}: step ${i} ${series[i - 1]} -> ${series[i]}`);
  }
}

test('I9 monotonicity: NPV, H2 and delivered energy move the right way with their drivers', () => {
  const npvOf = result => result.economics.npv;
  ['default', 'battery2', 'methanolOnly', 'financing70', 'berlin'].forEach(name => {
    const base = SCENARIOS[name];
    assertMonotone(sweep(base, 'panelCostPerW', [0.1, 0.2, 0.3, 0.5], npvOf), -1, `${name} NPV vs panel cost`);
    assertMonotone(sweep(base, 'discountRate', [4, 6, 8, 10, 12], npvOf), -1, `${name} NPV vs discount rate`);
    assertMonotone(
      sweep(base, 'electrolyzerEfficiency', [45, 50, 55, 60], result => result.electrolyzer.h2AnnualKg),
      -1,
      `${name} H2 vs kWh/kg`
    );
    assertMonotone(
      sweep(base, 'chemicalSizingPercent', [40, 60, 80, 100], result => result.annualDispatch.chemicalKWh),
      1,
      `${name} delivered energy vs chemical sizing`
    );
  });
  ['default', 'policyNone', 'battery20', 'large100MW'].forEach(name => {
    assertMonotone(sweep(SCENARIOS[name], 'methanePrice', [5, 10, 20, 40], npvOf), 1, `${name} NPV vs methane price`);
  });
});

test('I9 IRR has no jumps over an electrolyzer capex sweep (100 -> 500 $/kW)', () => {
  ['default', 'policyNone', 'financing70', 'battery20'].forEach(name => {
    const points = [];
    for (let capex = 100; capex <= 500; capex += 25) {
      const economics = Calc.calculateAll(createState({ ...SCENARIOS[name], electrolyzerCapex: capex })).economics;
      points.push({ capex, irr: economics.irr, mirr: economics.mirr });
    }
    for (let i = 1; i < points.length; i++) {
      const [a, b] = [points[i - 1], points[i]];
      if (Number.isFinite(a.irr) && Number.isFinite(b.irr)) {
        assert.ok(Math.abs(b.irr - a.irr) <= 10, `${name}: IRR jump ${a.irr} -> ${b.irr} at ${b.capex} $/kW`);
        assert.ok(b.irr < a.irr, `${name}: IRR falls with electrolyzer capex at ${b.capex}`);
      }
      assert.ok(b.mirr < a.mirr, `${name}: MIRR falls with electrolyzer capex at ${b.capex}`);
    }
  });
});

test('I10 the lean IRR path equals the full calculation for every scenario', () => {
  Object.entries(SCENARIOS).forEach(([name, overrides]) => {
    const state = createState(overrides);
    const full = results[name].economics;
    const leanIrr = Calc.calculateIrr(state);
    assert.ok(Object.is(leanIrr, full.irr) || Math.abs(leanIrr - full.irr) <= 1e-9, `${name}: lean ${leanIrr} vs full ${full.irr}`);
    const metrics = Calc.calculateReturnMetrics(state);
    assert.ok(Object.is(metrics.mirr, full.mirr) || Math.abs(metrics.mirr - full.mirr) <= 1e-9, `${name}: lean MIRR`);
    assert.ok(Math.abs(metrics.npv - full.npv) <= 1e-9 * moneyScale(full), `${name}: lean NPV`);
  });
});

/* Independent simple payback: first year in which cumulative (operating
   cash - replacement CAPEX) recovers the outlay, interpolated within the
   year; Infinity if never. Salvage is deliberately absent. */
function independentPayback(outlay, flows) {
  if (!(outlay > 0)) return 0;
  let cumulative = -outlay;
  for (let i = 0; i < flows.length; i++) {
    if (flows[i] > 0 && cumulative < 0 && cumulative + flows[i] >= 0) return i + (-cumulative / flows[i]);
    cumulative += flows[i];
  }
  return Infinity;
}

test('I11 payback is earned from operating cash minus replacements, never from salvage', () => {
  forEachScenario((result, name) => {
    const economics = result.economics;
    const operating = economics.yearlyCashFlows.map(entry => entry.operatingCashFlow - entry.replacementOutflow);
    const expected = independentPayback(economics.netCapexAtClose, operating);
    assert.ok(
      Object.is(economics.paybackYears, expected) || Math.abs(economics.paybackYears - expected) <= 1e-9,
      `${name}: payback ${economics.paybackYears} vs ${expected}`
    );
    if (economics.financing.enabled) {
      const equity = economics.yearlyCashFlows.map((entry, index) => operating[index] - entry.debtService);
      const expectedEquity = independentPayback(economics.financing.equityUpfront, equity);
      assert.ok(
        Object.is(economics.equityPaybackYears, expectedEquity) || Math.abs(economics.equityPaybackYears - expectedEquity) <= 1e-9,
        `${name}: equity payback ${economics.equityPaybackYears} vs ${expectedEquity}`
      );
    }
  });
  // 3-year horizon: ~$238k of operating cash against ~$469k net CAPEX, so
  // there is no payback; the ~$385k book-value salvage used to fake one at
  // 2.67 years.
  const short = results.horizon3.economics;
  assert.ok(short.cumulativeOperatingCashFlow < short.netCapexAtClose);
  assert.equal(short.paybackYears, Infinity);
});

test('I13 an exploratory route costs the same per unit of nameplate rate on every body', () => {
  // $/m3/day prices 24 h of nameplate; $/t-yr an Earth year (cycle hours x
  // cycles per Earth year: 8760 h Earth, 8754 h Mars, 8767 h Moon). Neither
  // depends on the local day length.
  const bodies = ['earth', 'mars', 'moon'].map(key => Calc.getBodyConfig(key));
  EXPLORATORY.forEach(module => Object.entries(module.routes).forEach(([routeId, route]) => {
    const basis = route.capexPerAnnualUnit;
    const penalty = route.cyclingPenalty || 1;
    const hoursPerUnitBasis = route.capexUnit === 'm3pd' ? 24 : 8760;
    bodies.forEach(body => {
      const perUnitRate = Calc.calculateExploratoryCapex(route, basis, 1, body.cycleHours, body.cyclesPerEarthYear);
      relClose(perUnitRate, hoursPerUnitBasis * basis * penalty, route.capexUnit === 'm3pd' ? 1e-12 : 1e-3, `${module.id}/${routeId} on ${body.label || body.cycleHours}`);
    });
  }));
  // End to end: lunar desalination is priced on its nameplate rate x 24 h.
  ['moonPel', 'mars', 'default'].forEach(name => {
    const desal = Calc.calculateAll(createState({ ...SCENARIOS[name], desalinationEnabled: true }))
      .exploratoryModules.find(module => module.id === 'desalination');
    const route = desal.routeConfig;
    relClose(desal.capex, desal.peakOutputUnitsPerHour * 24 * desal.capexBasis * (route.cyclingPenalty || 1), 1e-9, `${name} desalination capex`);
  });
});

test('I12 cost allocation: AI + chemical plant = total asset-life annual cost; AI pays the battery in AI mode', () => {
  forEachScenario((result, name) => {
    const economics = result.economics;
    const u = economics.unitCosts;
    // Total annual cost on the asset-life basis, rebuilt from its parts.
    const total = sum(Object.values(economics.annualizedCapex)) + economics.annualOM;
    relClose(economics.assetLifeAnnualCost, total, 1e-12, `${name} asset-life cost`, 1e-6);
    relClose(u.aiAnnualCost + u.chemicalPlantAnnualCost, total, 1e-9, `${name} AI + chemical = total`, 1e-6);
    const batteryCost = economics.annualizedCapex.battery + economics.capex.battery * result.state.batteryOmPercent / 100;
    const solarLandCost = economics.annualizedCapex.solar + economics.annualizedCapex.land + result.solar.annualSolarOm;
    if (result.ai.enabled) {
      // The battery discharges only to the AI load (ai-compute.js), so the
      // chemical plant's power is its energy share of solar + land alone.
      const chemShare = result.ai.chemicalAnnualKWh / (result.ai.chemicalAnnualKWh + result.ai.annualAiServedKWh);
      relClose(u.chemicalPowerCost, solarLandCost * chemShare, 1e-9, `${name} chemical power cost`, 1e-6);
      relClose(u.aiPowerCost, batteryCost + solarLandCost * (1 - chemShare), 1e-9, `${name} AI power cost`, 1e-6);
      relClose(u.aiAnnualCost, u.aiPowerCost + economics.annualizedCapex.ai + result.ai.annualOM, 1e-9, `${name} AI cost`, 1e-6);
    } else {
      assert.equal(u.aiAnnualCost, 0, `${name} no AI cost without AI`);
      relClose(u.chemicalPowerCost, solarLandCost + batteryCost, 1e-9, `${name} chemical power cost`, 1e-6);
    }
  });
});

test('I14 power shares cover only enabled blocks and sum to 1; with no reactor they follow the methane ratio', () => {
  forEachScenario((result, name) => {
    const { allocation, state } = result;
    const shares = [allocation.electrolyzer, allocation.dac, ...Object.values(allocation.exploratory)];
    if (state.electrolyzerEnabled || state.dacEnabled || result.exploratoryModules.some(module => module.enabled)) {
      relClose(sum(shares), 1, 1e-12, `${name} power shares`);
    }
    if (!state.electrolyzerEnabled) assert.equal(allocation.electrolyzer, 0, `${name} disabled electrolyzer`);
    if (!state.dacEnabled) assert.equal(allocation.dac, 0, `${name} disabled DAC`);
    assert.ok(['productMix', 'methane', 'methanol', 'exploratoryOnly', 'methaneFallback'].includes(allocation.kind), `${name} kind`);
  });
  // CH4 + 2 H2O <- CO2 + 4 H2: per kg CH4, 4 x 2.016 / 16.04 = 0.503 kg H2
  // and 44.01 / 16.04 = 2.744 kg CO2. The electrolyzer power share is
  // 0.503 e / (0.503 e + 2.744 d / 1000): 39.7 / (39.7 + 9.44) = 0.808 at
  // the default 79 kWh/kg H2 and 3,440 kWh/t CO2 (the old fallback was 0.5).
  const { state, allocation } = results.noReactor;
  assert.equal(allocation.kind, 'methaneFallback');
  const h2 = (4 * M.h2 / M.ch4) * state.electrolyzerEfficiency;
  const co2 = (M.co2 / M.ch4) * state.dacEnergy / 1000;
  relClose(allocation.electrolyzer, h2 / (h2 + co2), 2e-3, 'methane-ratio electrolyzer share');
  assert.equal(results.dacOnly.allocation.dac, 1, 'a lone DAC takes all the power');
});

test('I15 battery life = rated cycles / equivalent full cycles of the dispatch, capped at calendar life', () => {
  let cycleLimited = 0;
  forEachScenario((result, name) => {
    const storage = result.storage;
    if (!storage.enabled) return;
    // Earth scenarios: the dispatch basis is one Earth year (no annualization).
    if (result.state.body !== 'earth') return;
    const efcPerYear = storage.dischargeThroughputKWh / storage.battCapKWh;
    relClose(storage.equivalentFullCyclesPerYear, efcPerYear, 1e-12, `${name} EFC/yr`);
    const expected = Math.max(1, Math.min(12, result.state.batteryCycles / efcPerYear));
    relClose(storage.lifetimeYears, expected, 1e-12, `${name} battery life`);
    // A battery cannot do more than ~one full cycle per hour of charge at
    // its power rating, and here it never exceeds one per day.
    assert.ok(efcPerYear <= 366, `${name}: ${efcPerYear} cycles/yr`);
    if (expected < 12) cycleLimited += 1;
  });
  // 1,000 cycles at ~176 EFC/yr (2 MWh, partly used): ~5.7 years, not the
  // 2.7 years of one full cycle per day.
  const low = results.battery2LowCycles.storage;
  assert.ok(low.lifetimeYears > 1000 / 365 * 1.5 && low.lifetimeYears < 12, `cycle-limited life ${low.lifetimeYears}`);
  assert.ok(cycleLimited >= 1);
});

test('I16 every CAPEX-bearing block is in capexItems and the CAPEX chart, which both sum to the headline total', () => {
  let withExploratory = 0;
  forEachScenario((result, name) => {
    const economics = result.economics;
    // Rebuilt from the blocks' own capex, not from the economics' list: solar
    // parts, land, battery, AI, process blocks, feed buffers and every enabled
    // exploratory route. (The chart once listed slices by hand and dropped
    // exploratory routes: header $555,888 vs chart $459,576 with ammonia on.)
    const exploratoryCapex = sum(result.exploratoryModules.filter(module => module.enabled).map(module => module.capex));
    if (exploratoryCapex > 0) withExploratory += 1;
    const blocks = result.solar.moduleCapex + result.solar.bosCapex + result.solar.sitePrepCapex + result.solar.landCapex +
      (result.storage.enabled ? result.storage.capex : 0) + (result.ai.enabled ? result.ai.capex : 0) +
      result.electrolyzer.capex + result.dac.capex + result.sabatier.capex + result.methanol.capex +
      result.feedBuffers.capex + exploratoryCapex;
    relClose(economics.totalCapex, blocks, 1e-12, `${name} total CAPEX from blocks`, 1e-6);
    relClose(sum(economics.capexItems.map(item => item.capex)), blocks, 1e-12, `${name} capexItems`, 1e-6);
    relClose(sum(capexChartSlices(economics).values), blocks, 1e-12, `${name} CAPEX chart slices`, 1e-6);
    const policy = economics.policy;
    if (policy.eligibleCapexBasis === 'total') {
      relClose(policy.eligibleCapex, blocks, 1e-12, `${name} 'total' policy basis`, 1e-6);
      relClose(policy.upfrontSupport, blocks * result.state.euInnovationFundGrantShare, 1e-12, `${name} grant`, 1e-6);
    }
  });
  assert.ok(withExploratory >= 3, 'matrix covers exploratory capex');
  assert.equal(results.euGrantWithAmmonia.economics.policy.eligibleCapexBasis, 'total');
});
