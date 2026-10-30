/*
 * Policy data facts: each default is re-derived here from the published
 * statutory / notice / auction figures (retrieved 2026-10) rather than copied
 * from js/data/policies.js, so a typo or a stale value fails loudly.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { POLICY_SCHEMES } from '../../js/data/policies.js';

const input = (schemeId, key) => POLICY_SCHEMES[schemeId].inputs.find(entry => entry.key === key);
const roundTo = (value, step) => Math.round(value / step) * step;
const near = (actual, expected, tol, message) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${message}: expected ${expected}, got ${actual}`);

// ECB euro reference rates, 2026-10-29.
const USD_PER_EUR = 1.1130;
const USD_PER_GBP = 1.1130 / 0.83578;

test('45Y 2026 amounts follow IRS Notice 2026-47 (factor 2.0570)', () => {
  // §45Y(a)(2): 0.3 ¢ base rounded to nearest 0.05 ¢; 1.5 ¢ rounded to nearest 0.1 ¢.
  const baseCents = roundTo(0.3 * 2.0570, 0.05);
  const pwaCents = roundTo(1.5 * 2.0570, 0.1);
  const credit = input('us_45y_solar', 'us45ySolarCreditPerKwh');

  near(credit.min, baseCents / 100, 1e-12, '45Y slider floor = 2026 base amount');
  near(credit.defaultValue, pwaCents / 100, 1e-12, '45Y default = 2026 prevailing-wage amount');
  assert.ok(credit.max >= (pwaCents / 100) * 1.2 - 1e-12, '45Y max must allow both 10% bonuses');
});

test('45V 2026 amounts follow IRS Notice 2026-41 (factor 1.0929) and the 5x wage multiplier', () => {
  const topTierBase = roundTo(0.60 * 1.0929, 0.001); // $0.656/kg
  const lowestTierBase = roundTo(topTierBase * 0.20, 0.001); // $0.131/kg
  const credit = input('us_45v_h2', 'us45vHydrogenCreditPerKg');

  near(credit.max, topTierBase * 5, 1e-9, '45V max = 2026 top tier with prevailing wage');
  near(credit.defaultValue, topTierBase * 5, 1e-9, '45V default = 2026 top tier with prevailing wage');
  assert.ok(credit.min <= lowestTierBase, '45V floor must reach the lowest 2026 tier without the multiplier');
});

test('45Q DAC range spans the $36 base to the 5x prevailing-wage amount', () => {
  const credit = input('us_45q_dac', 'us45qDacCreditPerTon');
  assert.equal(credit.min, 36);
  assert.equal(credit.max, 36 * 5);
});

test('converted EUR / GBP benchmarks match their sources at the stated FX rate', () => {
  // UK AR7a solar strike GBP 65.23/MWh; 2025 GB solar capture GBP 66.91/MWh (Montel).
  const strike = input('uk_cfd_solar_ar7', 'ukCfdSolarStrikePricePerMwh');
  const reference = input('uk_cfd_solar_ar7', 'ukCfdSolarReferencePricePerMwh');
  near(strike.defaultValue, roundTo(65.23 * USD_PER_GBP, strike.step), 1e-9, 'CfD strike default');
  near(reference.defaultValue, roundTo(66.91 * USD_PER_GBP, reference.step), 1e-9, 'CfD reference default');

  // EEG: July 2026 award 4.79 ct/kWh minus 2025 annual solar market value 4.508 ct/kWh.
  const eeg = input('de_eeg_solar', 'deEegSolarPremiumPerKwh');
  near(eeg.defaultValue, roundTo(((4.79 - 4.508) / 100) * USD_PER_EUR, eeg.step), 1e-12, 'EEG net premium default');
  assert.ok(eeg.max >= (5.90 / 100) * USD_PER_EUR, 'EEG max must reach the 2026 bid cap of 5.90 ct/kWh');
});

test('statutory support durations match the scheme rules', () => {
  assert.equal(POLICY_SCHEMES.de_eeg_solar.durationYears, 20, 'EEG award term is 20 years');
  assert.equal(POLICY_SCHEMES.nl_sdepp.durationYears, 15, 'SDE++ solar PV runs 15 years');
  assert.equal(POLICY_SCHEMES.uk_cfd_solar_ar7.durationYears, 20, 'AR7 CfDs run 20 years');
  assert.equal(POLICY_SCHEMES.us_45y_solar.durationYears, 10, '45Y credit period is 10 years');
  assert.equal(POLICY_SCHEMES.us_45v_h2.durationYears, 10, '45V credit period is 10 years');
  assert.equal(POLICY_SCHEMES.us_45q_dac.durationYears, 12, '45Q credit period is 12 years');
});

test('user-facing policy text cites no internal sheet', () => {
  Object.entries(POLICY_SCHEMES).forEach(([id, scheme]) => {
    const text = [scheme.note, scheme.basis, scheme.stackingOrExclusivity, ...(scheme.inputs || []).map(entry => entry.label)].join(' ');
    assert.doesNotMatch(text, /policy (parameter )?sheet/i, `${id} must not reference an internal policy sheet`);
  });
});
