/*
 * Capital assets: replacement timing, straight-line salvage, land treatment.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildReplacementSchedule, crf } from '../../js/model/finance.js';
import { runScenario } from './harness.js';

const close = (actual, expected, tolerance, message) => assert.ok(
  Math.abs(actual - expected) <= tolerance,
  `${message || ''} expected ${expected}, got ${actual}`
);

test('a 7-year asset over 30 years is replaced in years 7, 14, 21, 28 and salvaged at 5/7 of cost', () => {
  const schedule = buildReplacementSchedule(30, [{ key: 'x', label: 'X', cost: 700, lifeYears: 7 }]);
  assert.deepEqual(schedule.entries.map(entry => entry.year), [7, 14, 21, 28]);
  assert.equal(schedule.total, 2800);
  // Installed in year 28, runs years 29-30: 5 of 7 years left.
  close(schedule.salvage.total, 700 * 5 / 7, 1e-9);
});

test('an asset whose life ends exactly at the horizon is neither replaced nor salvaged', () => {
  const schedule = buildReplacementSchedule(30, [{ key: 's', label: 'S', cost: 300, lifeYears: 30 }]);
  assert.equal(schedule.entries.length, 0);
  assert.equal(schedule.salvage.total, 0);
});

test('fractional lives are paid at the end of the year they fall in without drifting', () => {
  // 11.3-year battery over 30 years: due at 11.3 and 22.6 -> paid in years 12 and 23;
  // the last unit (installed 22.6) has 11.3 - 7.4 = 3.9 years left at year 30.
  const schedule = buildReplacementSchedule(30, [{ key: 'b', label: 'B', cost: 113, lifeYears: 11.3 }]);
  assert.deepEqual(schedule.entries.map(entry => entry.year), [12, 23]);
  close(schedule.salvage.total, 113 * 3.9 / 11.3, 1e-9);
});

test('replacement cost can differ from the initial cost and drives salvage after a replacement', () => {
  const schedule = buildReplacementSchedule(40, [{ key: 'solar', label: 'Solar', cost: 1000, replacementCost: 800, lifeYears: 30 }]);
  assert.equal(schedule.total, 800);
  close(schedule.salvage.total, 800 * 20 / 30, 1e-9);
});

test('land is never replaced, carries capital x r instead of CRF, and returns at cost', () => {
  const result = runScenario({ analysisHorizonYears: 40, solarAssetLife: 25 });
  const economics = result.economics;
  const land = result.solar.landCapex;
  assert.ok(land > 0);
  assert.equal(economics.capex.land, land);
  assert.ok(!economics.replacementSchedule.some(entry => entry.items.some(item => item.key === 'land')));
  close(economics.annualizedCapex.land, land * 0.08, 1e-9);
  assert.equal(economics.salvageItems.find(item => item.key === 'land').value, land);

  // The solar repowering (year 25) replaces modules + BOS only, not site prep or land.
  const repowering = economics.replacementSchedule.find(entry => entry.year === 25).items.find(item => item.key === 'solar');
  close(repowering.cost, result.solar.moduleCapex + result.solar.bosCapex, 1e-6);
  // Solar block = modules + BOS + site prep, annualized with CRF over its life.
  close(economics.capex.solar, result.solar.moduleCapex + result.solar.bosCapex + result.solar.sitePrepCapex, 1e-6);
  close(economics.annualizedCapex.solar, economics.capex.solar * crf(0.08, 25), 1e-6);
});

test('land stays out of the 48E solar ITC basis', () => {
  const economics = runScenario({ policyMode: 'us_48e_solar' }).economics;
  close(economics.policy.eligibleCapex, economics.capex.solar, 1e-6);
  assert.ok(economics.capex.land > 0);
  assert.ok(!(economics.policy.upfrontSupportByCapexKey.land > 0));
});

test('salvage lands in the final year cash flow and is discounted in NPV', () => {
  const economics = runScenario().economics;
  const last = economics.yearlyCashFlows.at(-1);
  close(last.salvageValue, economics.salvageValue, 1e-9);
  close(last.netCashFlow, last.operatingCashFlow - last.replacementOutflow + last.salvageValue, 1e-9);
  assert.ok(economics.yearlyCashFlows.slice(0, -1).every(entry => entry.salvageValue === 0));
  // Default 30 years: electrolyzer, DAC, Sabatier (7-yr lives, last replaced in year 28)
  // return 5/7 of their cost; feed buffers (20-yr life, replaced in year 20)
  // return 10/20; land returns at cost.
  const expected = economics.capex.land +
    (5 / 7) * (economics.capex.electrolyzer + economics.capex.dac + economics.capex.sabatier) +
    (10 / 20) * economics.capex.feedBuffers;
  close(economics.salvageValue, expected, 1e-6);
  assert.equal(economics.cashFlowTimeline.salvageValue.at(-1), economics.salvageValue);
});

test('scale homogeneity: doubling solar and battery doubles capex, NPV and outputs, IRR unchanged', () => {
  const base = runScenario({ systemSizeMW: 10, batteryEnabled: true, batteryCapacityMWh: 4 });
  const doubled = runScenario({ systemSizeMW: 20, batteryEnabled: true, batteryCapacityMWh: 8 });
  const relative = (a, b) => Math.abs(a - b) / Math.max(1, Math.abs(b));
  assert.ok(relative(doubled.economics.totalCapex, 2 * base.economics.totalCapex) < 1e-9);
  assert.ok(relative(doubled.economics.npv, 2 * base.economics.npv) < 1e-9);
  assert.ok(relative(doubled.electrolyzer.h2AnnualKg, 2 * base.electrolyzer.h2AnnualKg) < 1e-9);
  assert.ok(relative(doubled.sabatier.ch4AnnualMCF, 2 * base.sabatier.ch4AnnualMCF) < 1e-9);
  if (Number.isFinite(base.economics.irr)) {
    assert.ok(Math.abs(doubled.economics.irr - base.economics.irr) < 1e-9);
  }
  assert.ok(Math.abs(doubled.economics.mirr - base.economics.mirr) < 1e-9);
});

test('PV degradation restarts after the solar repowering', () => {
  const result = runScenario({ analysisHorizonYears: 40, solarAssetLife: 30, panelDegradationAnnual: 0.5 });
  const factors = result.lifetimeEnergy.solarFactorByYear;
  close(factors[29], Math.pow(0.995, 29), 1e-12, 'year 30');
  close(factors[30], 1, 1e-12, 'year 31 (new array)');
});
