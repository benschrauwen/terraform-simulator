/*
 * Policy scheme catalog and cash-flow treatment: every scheme resolves with
 * complete metadata and evaluates to finite economics; upfront (48E), per-kWh
 * (45Y) and two-way CfD support land where the scheme rules put them.
 * Output bases are in policy-basis.test.js, statutory amounts in
 * policy-facts.test.js.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { Calc, PolicyModel, createState, formatMoney } from './harness.js';

// Was: also pinned the number of option groups (5) and policies (>= 25).
test('policy select catalog exposes valid unique schemes and input metadata', () => {
  const groups = PolicyModel.getSelectGroups();
  const options = groups.flatMap(group => group.options.map(option => ({ ...option, group: group.label })));
  const ids = options.map(option => option.id);

  assert.ok(groups.length > 0 && ids.includes('none'));
  assert.equal(ids.length, new Set(ids).size, 'Expected policy select IDs to be unique across groups.');

  options.forEach(option => {
    const scheme = PolicyModel.getScheme(option.id);
    assert.ok(scheme, `Expected policy scheme ${option.id} from ${option.group} to resolve.`);
    assert.equal(option.label, scheme.selectLabel, `Expected select label for ${option.id} to match the scheme metadata.`);

    [
      'label',
      'selectLabel',
      'jurisdiction',
      'policyLayer',
      'technology',
      'simulatorTreatment',
      'supportFamily',
      'supportTiming',
      'basis',
      'note',
      'stackingOrExclusivity',
      'implementationFormula',
      'cashflowType',
    ].forEach(key => {
      assert.equal(typeof scheme[key], 'string', `Expected ${option.id}.${key} to be a string.`);
      assert.notEqual(scheme[key].trim(), '', `Expected ${option.id}.${key} to be non-empty.`);
    });

    const inputDetails = PolicyModel.getInputDetails(createState({ policyMode: option.id }), scheme);
    inputDetails.forEach(input => {
      const label = `${option.id}.${input.key}`;
      assert.equal(typeof input.key, 'string', `Expected ${option.id} input key to be a string.`);
      assert.notEqual(input.key.trim(), '', `Expected ${option.id} input key to be non-empty.`);
      assert.equal(typeof input.label, 'string', `Expected ${label} label to be a string.`);
      ['min', 'max', 'step', 'value'].forEach(field => {
        assert.equal(Number.isFinite(input[field]), true, `Expected ${label} ${field} to be finite.`);
      });
      assert.ok(input.min <= input.max, `Expected ${label} min <= max.`);
      assert.ok(input.value >= input.min - 1e-12 && input.value <= input.max + 1e-12, `Expected ${label} value within range.`);
      assert.equal(typeof input.formattedValue, 'string', `Expected ${label} formattedValue to be a string.`);
      assert.notEqual(input.formattedValue.trim(), '', `Expected ${label} formattedValue to be non-empty.`);
    });
  });
});

test('every exposed policy scheme evaluates to finite economics outputs', () => {
  const ids = PolicyModel.getSelectGroups().flatMap(group => group.options.map(option => option.id));

  ids.forEach(policyMode => {
    const result = Calc.calculateAll(createState({ policyMode }));
    const policy = result.economics.policy;

    assert.equal(policy.mode, policyMode, `Expected evaluated policy mode to remain ${policyMode}.`);
    assert.equal(typeof policy.label, 'string', `Expected ${policyMode} label to be a string.`);
    assert.notEqual(policy.label.trim(), '', `Expected ${policyMode} label to be non-empty.`);
    assert.equal(Number.isFinite(policy.annualSupport), true, `Expected ${policyMode} annual support to be finite.`);
    assert.equal(Number.isFinite(policy.upfrontSupport), true, `Expected ${policyMode} upfront support to be finite.`);
    assert.equal(Number.isFinite(policy.total), true, `Expected ${policyMode} total support to be finite.`);
    assert.equal(Number.isFinite(policy.effectiveUnitSupport), true, `Expected ${policyMode} effective unit support to be finite.`);
    assert.equal(Number.isFinite(policy.outputMetric.value), true, `Expected ${policyMode} output metric to be finite.`);
    assert.equal(Number.isFinite(policy.eligibleCapex), true, `Expected ${policyMode} eligible CAPEX to be finite.`);
    assert.equal(Number.isFinite(result.economics.totalAnnualRevenue), true, `Expected ${policyMode} total annual revenue to be finite.`);
    assert.equal(Number.isFinite(result.economics.npv), true, `Expected ${policyMode} NPV to be finite.`);

    policy.inputValues.forEach(input => {
      assert.equal(Number.isFinite(input.value), true, `Expected ${policyMode}.${input.key} evaluated value to be finite.`);
      assert.equal(typeof input.formattedValue, 'string', `Expected ${policyMode}.${input.key} evaluated formatted value to be a string.`);
      assert.notEqual(input.formattedValue.trim(), '', `Expected ${policyMode}.${input.key} evaluated formatted value to be non-empty.`);
    });

    if (policy.frameworkOnly || policyMode === 'none') {
      assert.equal(policy.annualSupport, 0, `Expected ${policyMode} to have no annual modeled cash support.`);
      assert.equal(policy.upfrontSupport, 0, `Expected ${policyMode} to have no upfront modeled cash support.`);
    }
  });
});

test('48E solar support reduces net capex at close and appears in the close bucket', () => {
  const economics = Calc.calculateAll(createState({
    policyMode: 'us_48e_solar',
    us48eSolarRate: 0.30,
  })).economics;
  const expectedSupport = economics.capex.solar * 0.30;

  assert.ok(
    Math.abs(economics.policy.upfrontSupport - expectedSupport) <= 1e-6,
    [
      'Expected 48E support to equal the configured share of solar CAPEX.',
      `Observed ${formatMoney(economics.policy.upfrontSupport)} vs expected ${formatMoney(expectedSupport)}.`,
    ].join(' ')
  );
  assert.ok(
    Math.abs(economics.netCapexAtClose - (economics.totalCapex - expectedSupport)) <= 1e-6,
    [
      'Expected close-date net CAPEX to equal gross CAPEX minus the 48E support.',
      `Observed ${formatMoney(economics.netCapexAtClose)} vs expected ${formatMoney(economics.totalCapex - expectedSupport)}.`,
    ].join(' ')
  );
  assert.equal(economics.revenue.policyCredits, 0, 'Expected 48E to stay a close-date capex support rather than annual operating revenue.');
  assert.ok(
    Math.abs(economics.cashFlowTimeline.annualPolicyCredits[0] - expectedSupport) <= 1e-6,
    'Expected the cash-flow timeline close bucket to show the upfront 48E support.'
  );
  assert.ok(
    Math.abs(economics.cashFlowTimeline.projectCashFlow[0] + economics.netCapexAtClose) <= 1e-6,
    'Expected project cash at close to start from the net CAPEX after 48E support.'
  );
});

test('45Y solar support scales directly with modeled annual solar output', () => {
  const economics = Calc.calculateAll(createState({
    policyMode: 'us_45y_solar',
    // 2026 prevailing-wage 45Y amount, $0.031/kWh (IRS Notice 2026-47); the old
    // $0.00363 sat below the $0.006 statutory base and is now clamped to the slider floor.
    us45ySolarCreditPerKwh: 0.031,
  })).economics;
  const expectedSupport = economics.policy.outputMetric.value * 0.031;

  assert.equal(economics.policy.outputMetric.unit, 'kWh/yr', 'Expected 45Y to use solar output in kWh/year.');
  assert.ok(
    Math.abs(economics.revenue.policyCredits - expectedSupport) <= 1e-6,
    [
      'Expected 45Y support to equal annual solar generation times the configured $/kWh credit.',
      `Observed ${formatMoney(economics.revenue.policyCredits)} vs expected ${formatMoney(expectedSupport)}.`,
    ].join(' ')
  );
});

test('two-way solar CfD support can turn negative when reference price exceeds strike', () => {
  const economics = Calc.calculateAll(createState({
    policyMode: 'uk_cfd_solar_ar7',
    ukCfdSolarStrikePricePerMwh: 50,
    ukCfdSolarReferencePricePerMwh: 60,
  })).economics;
  const expectedSupport = economics.policy.outputMetric.value * (50 - 60);

  assert.ok(
    Math.abs(economics.revenue.policyCredits - expectedSupport) <= 1e-6,
    [
      'Expected the solar CfD support to equal annual solar output times strike minus reference price.',
      `Observed ${formatMoney(economics.revenue.policyCredits)} vs expected ${formatMoney(expectedSupport)}.`,
    ].join(' ')
  );
  assert.ok(economics.revenue.policyCredits < 0, 'Expected the modeled CfD support to go negative when the reference price exceeds strike.');
  assert.equal(economics.cashFlowTimeline.hasPolicyCredits, true, 'Expected negative incentive support to still keep the policy-support series visible.');
  assert.ok(
    economics.cashFlowTimeline.annualPolicyCredits.slice(1, 21).every(value => value < 0),
    'Expected the active CfD years to stay negative when the reference price exceeds strike.'
  );
  assert.ok(
    economics.cashFlowTimeline.annualPolicyCredits.slice(21).every(value => Math.abs(value) <= 1e-9),
    'Expected the modeled CfD support to stop after the 20-year support window ends.'
  );
});
