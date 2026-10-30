/*
 * A methanol consumer is any exploratory route whose feedstocks include
 * methanolKg, not just the module with id 'mtg'. A data-only route is
 * injected into the module definitions before the catalog loads (node --test
 * runs each file in its own process, so no other test sees it).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { MODULE_DEFINITIONS } from '../../js/data/modules.js';

const MTO_KG_MEOH_PER_T = 2600;
MODULE_DEFINITIONS.push({
  id: 'testMto',
  label: 'Methanol to olefins (test)',
  family: 'air-water-chemistry',
  exploratory: true,
  dependencies: ['methanol'],
  market: { min: 100, max: 3000, step: 25, defaultValue: 1000, label: 'Olefin sale price', unitLabel: '$/ton' },
  routes: {
    'fixed-bed': {
      label: 'Fixed-bed MTO',
      electricityKwhPerUnit: 300,
      capexPerAnnualUnit: 700,
      capexUnit: 'tpa',
      cyclingPenalty: 1.2,
      feedstocks: { methanolKg: MTO_KG_MEOH_PER_T },
      outputLabel: 'Olefins',
      outputUnit: 't',
    },
  },
});

const { Calc, DEFAULT_STATE } = await import('../../js/model/index.js');
const MTG_KG_MEOH_PER_T = 2273;

const close = (actual, expected, relTol, label) => assert.ok(
  Math.abs(actual - expected) <= relTol * Math.max(1, Math.abs(expected)),
  `${label}: expected ${expected}, got ${actual}`
);
const run = overrides => Calc.calculateAll({ ...DEFAULT_STATE, methanolEnabled: true, ...overrides });
const route = (result, id) => result.exploratoryModules.find(module => module.id === id);

test('a data-only methanol consumer takes the diverted methanol and produces output', () => {
  const result = run({ testMtoEnabled: true });
  const mto = route(result, 'testMto');
  const reactorKg = result.methanol.reactorDailyKg;
  const divertedKg = reactorKg * DEFAULT_STATE.mtgMethanolSplit / 100;
  assert.ok(reactorKg > 0);
  // Its power share follows its methanol, so methanol is the binding input:
  // it converts the whole diverted pool, at 2,600 kg MeOH per t.
  close(mto.methanolConsumed, divertedKg, 1e-9, 'methanol consumed = diverted pool');
  close(mto.outputDailyUnits, divertedKg / MTO_KG_MEOH_PER_T, 1e-9, 'output from methanol');
  assert.ok(mto.capex > 0 && result.economics.exploratoryDetails.some(detail => detail.id === 'testMto' && detail.annualRevenue > 0));
  // Mass balance: exported + consumed = reactor output.
  close(result.methanol.exportDailyKg + mto.methanolConsumed, reactorKg, 1e-12, 'methanol mass balance');
});

test('methanol consumers share the diverted pool by priority x kg MeOH per unit', () => {
  const result = run({ testMtoEnabled: true, mtgEnabled: true, mtgMethanolSplit: 60 });
  const mtg = route(result, 'mtg');
  const mto = route(result, 'testMto');
  const reactorKg = result.methanol.reactorDailyKg;
  const divertedKg = reactorKg * 0.6;
  // Equal default priorities: shares 2273 : 2600 of the diverted methanol.
  const mtgShare = MTG_KG_MEOH_PER_T / (MTG_KG_MEOH_PER_T + MTO_KG_MEOH_PER_T);
  close(mtg.methanolConsumed, divertedKg * mtgShare, 1e-9, 'MTG methanol');
  close(mto.methanolConsumed, divertedKg * (1 - mtgShare), 1e-9, 'MTO methanol');
  close(result.methanol.exportDailyKg, reactorKg * 0.4, 1e-9, 'export keeps the undiverted 40%');

  // Halving MTO's priority halves its weight: shares 2273 : 1300.
  const weighted = run({ testMtoEnabled: true, mtgEnabled: true, mtgMethanolSplit: 60, testMtoPriorityWeight: 50 });
  const weightedShare = MTG_KG_MEOH_PER_T / (MTG_KG_MEOH_PER_T + 0.5 * MTO_KG_MEOH_PER_T);
  close(route(weighted, 'mtg').methanolConsumed, weighted.methanol.reactorDailyKg * 0.6 * weightedShare, 1e-9, 'priority-weighted MTG methanol');
});

test('MTG alone still takes the whole diverted pool', () => {
  const result = run({ mtgEnabled: true });
  close(route(result, 'mtg').methanolConsumed, result.methanol.reactorDailyKg * DEFAULT_STATE.mtgMethanolSplit / 100, 1e-9, 'MTG methanol');
  assert.equal(route(result, 'testMto').methanolConsumed, 0);
});
