import assert from 'node:assert/strict';
import test from 'node:test';

import { breakEvenMethods, solveLinearZero } from '../../js/model/break-even.js';
import { Calc, ModuleCatalog, createState, runScenario } from './harness.js';

// NPV tolerance: a rounding-level fraction of the money at stake.
const closeToZero = (npv, scale, label) =>
  assert.ok(Math.abs(npv) <= 1e-7 * Math.max(1, scale), `${label}: NPV ${npv} at break-even (scale ${scale})`);

function breakEvenFor(overrides) {
  const state = createState(overrides);
  const result = Calc.calculateAll(state);
  return { state, result, prices: Calc.calculateBreakEvenPrices(state, { baseResult: result }) };
}

test('the zero of a straight line through two points', () => {
  // y = 2x - 25 through (10, -5) and (20, 15): zero at 12.5.
  assert.equal(solveLinearZero(10, -5, 20, 15), 12.5);
  assert.equal(solveLinearZero(10, 3, 20, 3), null, 'flat line has no zero');
  assert.equal(solveLinearZero(10, 3, 10, 5), null, 'two prices needed');
});

test('the fast path returns the same NPV as the full calculation', () => {
  [{}, { financingEnabled: true }, { methanolEnabled: true }, { aiComputeEnabled: true }].forEach(overrides => {
    const state = createState(overrides);
    assert.equal(Calc.calculateScenario(state, { fastMode: true }).economics.npv, Calc.calculateAll(state).economics.npv);
  });
});

test('default methane break-even zeroes the full-run NPV and NPV is linear in price', () => {
  const { state, result, prices } = breakEvenFor({});
  assert.deepEqual(prices.map(product => product.key), ['methane']);
  const [methane] = prices;
  const scale = result.economics.netCapexAtClose;
  assert.ok(Number.isFinite(methane.breakEvenPrice) && methane.breakEvenPrice > 0);
  assert.equal(methane.currentPrice, state.methanePrice);
  assert.equal(methane.ratioToCurrent, methane.breakEvenPrice / state.methanePrice);

  closeToZero(runScenario({ methanePrice: methane.breakEvenPrice }).economics.npv, scale, 'methane');

  // A third price, away from the two the solver used, lands on the same line.
  const p3 = 3.7;
  const predicted = result.economics.npv + (methane.npvPerUnitPrice * (p3 - state.methanePrice));
  const actual = runScenario({ methanePrice: p3 }).economics.npv;
  assert.ok(Math.abs(actual - predicted) <= 1e-7 * scale, `linear prediction ${predicted} vs ${actual}`);
});

test('NPV per $/MCF is the discounted methane volume over the horizon', () => {
  // dNPV/dp = year-1 MCF x sum_y chemicalFactor_y / (1 + r)^y: each year's
  // methane revenue is volume x price x that year's chemical-energy factor.
  const { result, prices } = breakEvenFor({});
  const rate = result.state.discountRate / 100;
  const factors = result.lifetimeEnergy.chemicalFactorByYear;
  let discountedVolume = 0;
  for (let year = 1; year <= result.state.analysisHorizonYears; year++) {
    discountedVolume += result.sabatier.ch4AnnualMCF * factors[year - 1] / Math.pow(1 + rate, year);
  }
  const slope = prices[0].npvPerUnitPrice;
  assert.ok(Math.abs(slope - discountedVolume) <= 1e-6 * discountedVolume, `${slope} vs ${discountedVolume}`);
  // And therefore the break-even is current price - NPV / slope.
  const expected = result.state.methanePrice - (result.economics.npv / discountedVolume);
  assert.ok(Math.abs(prices[0].breakEvenPrice - expected) <= 1e-6 * Math.abs(expected));
});

test('every sold product gets a break-even that zeroes NPV with the others held fixed', () => {
  [
    { methanolEnabled: true },
    { aiComputeEnabled: true },
    { methanolEnabled: true, financingEnabled: true, analysisHorizonYears: 40 },
    { ammoniaEnabled: true },
  ].forEach(overrides => {
    const { result, prices } = breakEvenFor(overrides);
    assert.ok(prices.length >= 2, `${JSON.stringify(overrides)} sells several products`);
    prices.forEach(product => {
      assert.ok(Number.isFinite(product.breakEvenPrice), `${product.key} has a break-even`);
      // Prices normalize to >= 0, so a negative break-even cannot be run
      // directly; then a zero price must still leave NPV positive.
      if (product.breakEvenPrice < 0) {
        assert.ok(runScenario({ ...overrides, [product.paramKey]: 0 }).economics.npv > 0);
        return;
      }
      const npv = runScenario({ ...overrides, [product.paramKey]: product.breakEvenPrice }).economics.npv;
      closeToZero(npv, result.economics.netCapexAtClose, `${JSON.stringify(overrides)} ${product.key}`);
    });
  });
});

test('a negative break-even is reported: NPV stays positive even at a zero price', () => {
  // With AI on, token revenue carries the project; methane alone could be free.
  const { prices } = breakEvenFor({ aiComputeEnabled: true });
  const methane = prices.find(product => product.key === 'methane');
  assert.ok(methane.breakEvenPrice < 0, `methane break-even ${methane.breakEvenPrice}`);
  assert.equal(methane.positiveAtZeroPrice, true);
  assert.ok(runScenario({ aiComputeEnabled: true, methanePrice: 0 }).economics.npv > 0);
});

test('a price pinned at its upper bound is probed downwards', () => {
  const route = createState({ ammoniaEnabled: true }).ammoniaRoute;
  const market = ModuleCatalog.getMarketConfig('ammonia', route);
  const overrides = { ammoniaEnabled: true, ammoniaPrice: market.max };
  const { result, prices } = breakEvenFor(overrides);
  const ammonia = prices.find(product => product.paramKey === 'ammoniaPrice');
  assert.equal(ammonia.currentPrice, market.max);
  const npv = runScenario({ ...overrides, ammoniaPrice: ammonia.breakEvenPrice }).economics.npv;
  closeToZero(npv, result.economics.netCapexAtClose, 'ammonia at max');
});

test('zero sales volume gives no break-even and runs no extra scenario', () => {
  let runs = 0;
  const stub = {
    ...breakEvenMethods,
    calculateScenario() {
      runs += 1;
      throw new Error('should not run');
    },
  };
  const baseResult = {
    state: { methanePrice: 20 },
    sabatier: { enabled: true, ch4AnnualMCF: 0 },
    methanol: { enabled: false },
    ai: { enabled: false },
    economics: { npv: -1000, exploratoryDetails: [] },
  };
  const [methane] = stub.calculateBreakEvenPrices(baseResult.state, { baseResult });
  assert.equal(methane.breakEvenPrice, null);
  assert.equal(methane.ratioToCurrent, null);
  assert.equal(runs, 0);
});
