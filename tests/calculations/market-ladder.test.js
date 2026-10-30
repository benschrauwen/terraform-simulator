import assert from 'node:assert/strict';
import test from 'node:test';

import { MARKET_LADDERS, MMBTU_PER_MCF_CH4 } from '../../js/data/market-ladders.js';
import { buildMarketLadder, getMarketPosition, getSiteWorkingPoint } from '../../js/model/market-ladder.js';
import { createState, runScenario } from './harness.js';

const close = (actual, expected, tolerance = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${actual} vs ${expected}`);

test('tier volumes come from each tier’s share of the cumulative market at its price', () => {
  const methane = buildMarketLadder('methane');
  // Beachhead: $180M/yr at $495/MMBtu; strategic: ($23B - $180M) at $45/MMBtu.
  close(methane.tiers[0].volume, 180e6 / 495);
  close(methane.tiers[1].volume, (23e9 - 180e6) / 45);
  close(methane.tiers[1].endVolume, 180e6 / 495 + (23e9 - 180e6) / 45);

  ['methane', 'methanol'].forEach(key => {
    const ladder = buildMarketLadder(key);
    const revenue = ladder.tiers.reduce((sum, tier) => sum + tier.volume * tier.price, 0);
    close(revenue, MARKET_LADDERS[key].tiers.at(-1).cumulativeMarket);
    ladder.tiers.forEach((tier, index) => {
      assert.ok(tier.volume > 0);
      if (index > 0) assert.ok(tier.price < ladder.tiers[index - 1].price, `${key} prices must descend`);
      if (index > 0) close(tier.startVolume, ladder.tiers[index - 1].endVolume);
    });
  });
});

test('a site clears every tier priced at or above its cost', () => {
  const ladder = buildMarketLadder('methanol');
  const position = getMarketPosition(ladder, { unitCost: 1000, annualVolume: 300 });
  assert.deepEqual(position.clearedTiers.map(tier => tier.price), [3000, 2000, 1300]);
  assert.equal(position.addressableMarket, 216e6);
  assert.equal(position.nextTier.price, 700);
  close(position.costCutToNextTier, 0.3);
  close(position.beachheadShare, 300 / (90e6 / 3000));

  const cheap = getMarketPosition(ladder, { unitCost: 100, annualVolume: 300 });
  assert.equal(cheap.clearedTiers.length, ladder.tiers.length);
  assert.equal(cheap.nextTier, null);
  assert.equal(getMarketPosition(ladder, { unitCost: 5000, annualVolume: 300 }).clearedTiers.length, 0);
  assert.equal(getMarketPosition(ladder, { unitCost: 1000, annualVolume: 0 }), null);
});

test('the site working point converts the model’s methane and methanol outputs to ladder units', () => {
  const state = createState({ methanolEnabled: true });
  const result = runScenario({ methanolEnabled: true });

  const methane = getSiteWorkingPoint('methane', result, state);
  close(methane.annualVolume, result.sabatier.ch4AnnualMCF * MMBTU_PER_MCF_CH4);
  close(methane.unitCost, result.economics.costPerMCF / MMBTU_PER_MCF_CH4);
  close(methane.salePrice, state.methanePrice / MMBTU_PER_MCF_CH4);

  const methanol = getSiteWorkingPoint('methanol', result, state);
  close(methanol.annualVolume, result.methanol.exportAnnualTons);
  close(methanol.unitCost, result.economics.costPerTonMethanol);

  const methaneOff = getSiteWorkingPoint('methane', runScenario({ sabatierEnabled: false, methanolEnabled: true }), state);
  assert.equal(methaneOff.annualVolume, 0);
});
