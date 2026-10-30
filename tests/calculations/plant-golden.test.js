/*
 * Hand-derived golden values for a minimal solar -> electrolyzer + DAC ->
 * Sabatier plant with no policy support. Every expected number is derived
 * below from the inputs, not read back from the model.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { runScenario } from './harness.js';

const close = (actual, expected, relTol, label) => assert.ok(
  Math.abs(actual - expected) <= relTol * Math.abs(expected),
  `${label}: expected ${expected}, got ${actual}`
);

// 1 MWdc, fixed tilt (the base-yield reference, yield multiplier 1) at a
// manual 2000 MWh/MWdc-yr, no battery, full-capture sizing, methane only.
const INPUTS = {
  policyMode: 'none',
  systemSizeMW: 1,
  mountingType: 'fixed',
  siteYieldSource: 'manual',
  siteYieldMwhPerMwdcYear: 2000,
  batteryCapacityMWh: 0,
  chemicalSizingPercent: 100,
  electrolyzerEfficiency: 50, // kWh / kg H2
  dacEnergy: 2000, // kWh / t CO2
  sabatierConversion: 95,
  methanePrice: 20, // $ / MCF
};

/*
 * Delivered energy: 1 MW x 2000 MWh/MW = 2,000,000 kWh/yr, all of it (no
 * storage, no clipping at 100% sizing).
 *
 * Power split for 1 t CH4 (CO2 + 4 H2 -> CH4 + 2 H2O; 0.503 kg H2 and
 * 2.744 kg CO2 per kg CH4):
 *   electrolyzer  503 kg x 50 kWh/kg   = 25,150 kWh
 *   DAC          2744 kg x 2 kWh/kg    =  5,488 kWh
 *   shares       25,150 / 30,638 = 0.820876,  5,488 / 30,638 = 0.179124
 *
 * Annual feeds:
 *   H2  = 2,000,000 x 0.820876 / 50   = 32,835.04 kg
 *   CO2 = 2,000,000 x 0.179124 / 2    = 179,123.96 kg   (H2:CO2 = 503:2744)
 * Methane at 95% conversion:
 *   CH4 = 0.95 x 32,835.04 / 0.503    = 62,014.49 kg  = 62,014.49 / 19.25
 *                                     = 3,221.53 MCF
 * Year-1 revenue = 3,221.53 MCF x $20 = $64,430.64; unconverted feed (5% of
 * each) is surplus. Year 2 output degrades by 0.65%: $64,011.84.
 */
const DELIVERED_KWH = 2_000_000;
const ELECTROLYZER_SHARE = 25150 / (25150 + 5488);
const H2_KG = DELIVERED_KWH * ELECTROLYZER_SHARE / 50;
const CO2_KG = DELIVERED_KWH * (1 - ELECTROLYZER_SHARE) / 2;
const CH4_KG = 0.95 * H2_KG / 0.503;
const CH4_MCF = CH4_KG / 19.25;
const REVENUE = CH4_MCF * 20;

test('hand-derived golden: minimal methane plant annual H2, CO2, CH4 and revenue', () => {
  // The derivation's arithmetic, pinned to the rounded figures in the comment.
  close(H2_KG, 32835.04, 1e-6, 'derived H2');
  close(CH4_MCF, 3221.53, 2e-6, 'derived MCF');
  close(REVENUE, 64430.64, 1e-6, 'derived revenue');

  const result = runScenario(INPUTS);
  assert.deepEqual(result.warnings, []);
  close(result.solar.annualMWh, 2000, 1e-12, 'annual solar MWh');
  close(result.annualDispatch.chemicalKWh, DELIVERED_KWH, 1e-9, 'delivered kWh');
  close(result.electrolyzer.h2AnnualKg, H2_KG, 1e-9, 'H2 kg/yr');
  close(result.dac.co2AnnualKg, CO2_KG, 1e-9, 'CO2 kg/yr');
  close(result.sabatier.ch4AnnualKg, CH4_KG, 1e-9, 'CH4 kg/yr');
  close(result.sabatier.ch4AnnualMCF, CH4_MCF, 1e-9, 'CH4 MCF/yr');
  close(result.economics.revenue.methane, REVENUE, 1e-9, 'methane revenue');
  close(result.economics.totalAnnualRevenue, REVENUE, 1e-9, 'total revenue (no policy)');
  assert.equal(result.economics.revenue.policyCredits, 0, 'no policy credits');
  close(result.h2Surplus * 365, 0.05 * H2_KG, 1e-9, 'H2 surplus = 5% unconverted');
  close(result.co2Surplus * 365, 0.05 * CO2_KG, 1e-9, 'CO2 surplus = 5% unconverted');
  close(result.economics.yearlyCashFlows[1].totalRevenue, REVENUE * (1 - 0.0065), 1e-9, 'year-2 revenue after 0.65% degradation');
});
