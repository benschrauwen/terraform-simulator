import assert from 'node:assert/strict';
import test from 'node:test';

import { POLICY_SCHEMES } from '../../js/data/policies.js';
import { MOUNTING_TYPES } from '../../js/data/reference-data.js';
import {
  SENSITIVITY_VARIABLES,
  buildPolicyCreditVariable,
  formatSensitivityValue,
  getSensitivityVariables,
} from '../../js/data/sensitivity-variables.js';
import { getStateFieldRange, resolveVariableBounds, runTornado } from '../../js/model/tornado.js';
import { Calc, createState } from './harness.js';

const close = (actual, expected, tolerance = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${actual} vs ${expected}`);

const ids = tornado => tornado.bars.map(bar => bar.id);

const METHANOL_STATE = { methanolEnabled: true };
const BATTERY_STATE = { batteryCapacityMWh: 2 };

test('the base NPV is the full calculation’s NPV', () => {
  [{}, METHANOL_STATE, BATTERY_STATE].forEach(overrides => {
    const state = createState(overrides);
    close(runTornado(state).baseNpv, Calc.calculateAll(state).economics.npv);
  });
});

test('each bar’s low and high NPV equal a full calculation with only that input moved', () => {
  [{}, { ...METHANOL_STATE, ...BATTERY_STATE }].forEach(overrides => {
    const state = Calc.normalizeState(createState(overrides));
    const tornado = runTornado(state);
    assert.ok(tornado.bars.length > 5);
    tornado.bars.forEach(bar => {
      assert.equal(bar.baseValue, state[bar.stateKey]);
      const lowNpv = Calc.calculateAll({ ...state, [bar.stateKey]: bar.lowValue }).economics.npv;
      const highNpv = Calc.calculateAll({ ...state, [bar.stateKey]: bar.highValue }).economics.npv;
      close(bar.lowNpv, lowNpv);
      close(bar.highNpv, highNpv);
    });
  });
});

test('bars are sorted by the NPV span they cover, base included, largest first', () => {
  const tornado = runTornado(createState(METHANOL_STATE));
  const { baseNpv } = tornado;
  tornado.bars.forEach(bar => {
    const ends = [baseNpv, bar.lowNpv, bar.highNpv];
    close(bar.swing, Math.max(...ends) - Math.min(...ends));
    assert.ok(bar.swing > 0);
  });
  for (let index = 1; index < tornado.bars.length; index += 1) {
    assert.ok(tornado.bars[index - 1].swing >= tornado.bars[index].swing, `${ids(tornado)} not sorted`);
  }
});

test('inputs that do not apply to the build are left out', () => {
  const base = ids(runTornado(createState()));
  // Default: methane only, no battery, no AI.
  ['methanolPrice', 'methanolCapex', 'batteryCost', 'aiTokenPrice', 'aiThroughput', 'aiGpuCapex']
    .forEach(id => assert.ok(!base.includes(id), `${id} should not apply by default`));
  ['methanePrice', 'electrolyzerCapex', 'dacCapex', 'panelCost', 'discountRate']
    .forEach(id => assert.ok(base.includes(id), `${id} should apply by default`));

  const methanol = ids(runTornado(createState(METHANOL_STATE)));
  assert.ok(methanol.includes('methanolPrice') && methanol.includes('methanolCapex'));

  const methanolOnly = ids(runTornado(createState({ ...METHANOL_STATE, sabatierEnabled: false })));
  assert.ok(methanolOnly.includes('methanolPrice'));
  assert.ok(!methanolOnly.includes('methanePrice') && !methanolOnly.includes('sabatierCapex'));

  assert.ok(ids(runTornado(createState(BATTERY_STATE))).includes('batteryCost'));

  const ai = ids(runTornado(createState({ aiComputeEnabled: true })));
  ['aiTokenPrice', 'aiThroughput', 'aiGpuCapex'].forEach(id => assert.ok(ai.includes(id), `${id} with AI on`));
  // AI sizing seeds a battery, so its cost now matters too.
  assert.ok(ai.includes('batteryCost'));

  const noPolicy = ids(runTornado(createState({ policyMode: 'none' })));
  assert.ok(!noPolicy.includes('policyCredit'));
});

test('every registry variable is a numeric schema field and swings around its current value', () => {
  const defaults = Calc.normalizeState(createState({ methanolEnabled: true, batteryCapacityMWh: 2, aiComputeEnabled: true }));
  SENSITIVITY_VARIABLES.forEach(variable => {
    const range = getStateFieldRange(variable.stateKey);
    assert.ok(range, `${variable.stateKey} is a numeric schema field`);
    // Only inputs with a real range (incentives) carry their own bounds.
    assert.equal(variable.bounds, undefined, `${variable.id} swings by the chosen percentage`);
    const current = defaults[variable.stateKey];
    const bounds = resolveVariableBounds(variable, defaults, 0.2);
    assert.ok(bounds, variable.id);
    close(bounds.low, Math.max(range.min, current * 0.8));
    close(bounds.high, Math.min(range.max, current * 1.2));
  });
});

test('the swing scales the current value and is clamped to the schema range', () => {
  const siteYield = SENSITIVITY_VARIABLES.find(variable => variable.id === 'siteYield');
  const state = createState({ siteYieldMwhPerMwdcYear: 2000 });
  // +/-20% (default) and +/-10% of 2,000 MWh/MWdc-yr.
  let bounds = resolveVariableBounds(siteYield, state);
  close(bounds.low, 1600);
  close(bounds.high, 2400);
  bounds = resolveVariableBounds(siteYield, state, 0.1);
  close(bounds.low, 1800);
  close(bounds.high, 2200);

  // 95 kWh/kg x 1.2 = 114 would pass the 100 kWh/kg slider ceiling.
  const energy = SENSITIVITY_VARIABLES.find(variable => variable.id === 'electrolyzerEnergy');
  const clamped = resolveVariableBounds(energy, createState({ electrolyzerEfficiency: 95 }), 0.2);
  close(clamped.low, 76);
  assert.equal(clamped.high, getStateFieldRange('electrolyzerEfficiency').max);

  // A zero current value has no range to show.
  assert.equal(resolveVariableBounds(siteYield, createState({ siteYieldMwhPerMwdcYear: 0 })), null);
});

test('the chosen swing comes from state and widens every non-incentive bar', () => {
  const narrow = runTornado(createState({ tornadoSwingPercent: 10 }));
  const wide = runTornado(createState({ tornadoSwingPercent: 30 }));
  assert.equal(narrow.swingPercent, 10);
  assert.equal(wide.swingPercent, 30);
  const methane = result => result.bars.find(bar => bar.id === 'methanePrice');
  close(methane(narrow).lowValue, 18);
  close(methane(wide).highValue, 26);
  // NPV is linear in price, so a 3x wider swing gives a 3x wider bar.
  close(methane(wide).swing, 3 * methane(narrow).swing, 1e-6);
});

test('the policy credit runs from the scheme’s floor to the current value', () => {
  const credit = buildPolicyCreditVariable('us_45v_h2');
  assert.equal(credit.stateKey, 'us45vHydrogenCreditPerKg');
  const bounds = resolveVariableBounds(credit, createState({ us45vHydrogenCreditPerKg: 2 }));
  // 45V's slider floor is the lowest statutory tier, $0.131/kg -> $0.13.
  assert.deepEqual(bounds, { low: 0.13, high: 2 });

  // At the floor there is no range left to show.
  assert.equal(resolveVariableBounds(credit, createState({ us45vHydrogenCreditPerKg: 0.13 })), null);

  // Two-input schemes have no single credit to move; framework-only ones none at all.
  assert.equal(buildPolicyCreditVariable('nl_sdepp'), null);
  assert.equal(buildPolicyCreditVariable('eu_rediii'), null);
  assert.equal(buildPolicyCreditVariable('custom'), null);

  Object.keys(POLICY_SCHEMES).forEach(mode => {
    const variable = buildPolicyCreditVariable(mode);
    if (!variable) return;
    const range = getStateFieldRange(variable.stateKey);
    assert.ok(variable.bounds.low >= range.min, `${mode} floor inside the schema range`);
  });

  assert.equal(getSensitivityVariables({ policyMode: 'none' }).length, SENSITIVITY_VARIABLES.length);
});

test('the 45V bar spans the present value of the credit it removes', () => {
  // The credit is linear in $/kg and touches nothing else, so dropping it from
  // $3.28 to $0.13/kg removes (1 - 0.13/3.28) of each year's credit revenue:
  // NPV gap = sum_t credits_t * (1 - 0.13/3.28) / (1 + r)^t.
  const state = Calc.normalizeState(createState());
  const result = Calc.calculateAll(state);
  const rate = state.discountRate / 100;
  const creditPv = result.economics.yearlyCashFlows.reduce(
    (sum, year) => sum + year.revenue.policyCredits / (1 + rate) ** year.year,
    0
  );
  assert.ok(creditPv > 0);
  const bar = runTornado(state).bars.find(entry => entry.id === 'policyCredit');
  close(bar.highNpv - bar.lowNpv, creditPv * (1 - 0.13 / 3.28), 1e-7);
});

test('input values format in their own units', () => {
  const byId = id => SENSITIVITY_VARIABLES.find(variable => variable.id === id);
  assert.equal(formatSensitivityValue(byId('panelCost'), 0.11), '$0.11/W');
  assert.equal(formatSensitivityValue(byId('methanolPrice'), 970), '$970/t');
  assert.equal(formatSensitivityValue(byId('aiGpuCapex'), 33000), '$33,000/kW');
  assert.equal(formatSensitivityValue(buildPolicyCreditVariable('us_48e_solar'), 0.3), '30%');
});
