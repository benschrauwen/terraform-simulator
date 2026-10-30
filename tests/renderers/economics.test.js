import assert from 'node:assert/strict';
import test from 'node:test';

import { METHANE_MARKET_PRESETS } from '../../js/data/reference-data.js';
import { Calc } from '../../js/model/index.js';
import { DEFAULT_STATE } from '../../js/state/schema.js';
import { renderEconomicsBreakdown } from '../../js/ui/renderers/economics.js';

function render(overrides = {}) {
  const state = Calc.normalizeState({ ...DEFAULT_STATE, ...overrides });
  const results = Calc.calculateAll(state);
  return renderEconomicsBreakdown(results, {
    state: results.state || state,
    methaneMarket: METHANE_MARKET_PRESETS[state.methaneMarketPreset],
    cycleUnit: results.solar.cycleUnitCompact,
  });
}

function groupTitles(html) {
  return [...html.matchAll(/<span class="econ-group-title">([^<]*)<\/span>/g)].map(match => match[1]);
}

test('economics breakdown renders the unlevered row groups by default', () => {
  const html = render();

  assert.ok(html.startsWith('<div class="econ-summary-grid">'));
  assert.deepEqual(groupTitles(html), [
    'Project returns',
    'Cost breakdown',
    'Revenue breakdown',
    'Unit economics',
    'Context &amp; routes',
  ]);
  assert.match(html, /<span class="econ-metric-label tooltip-label"[^>]*>NPV<\/span>/);
  assert.doesNotMatch(html, /Equity IRR/);
  assert.match(html, /Methane market/);
});

test('economics breakdown switches labels and adds a financing group when debt is enabled', () => {
  const html = render({ financingEnabled: true });

  assert.ok(groupTitles(html).includes('Financing details'));
  assert.match(html, />Project NPV</);
  assert.match(html, />Equity IRR</);
  assert.match(html, />Debt coupon</);
});

test('economics breakdown always shows MIRR and explains a withheld IRR', () => {
  const html = render();
  assert.match(html, />MIRR</);

  const grantHtml = render({ policyMode: 'custom', customCapexGrantShare: 1 });
  assert.match(grantHtml, /n\/a \(no net investment\)/);
  assert.match(grantHtml, /no net upfront investment/);

  const levered = render({ financingEnabled: true });
  assert.match(levered, />Equity MIRR</);
  assert.match(levered, />Project MIRR</);
});
