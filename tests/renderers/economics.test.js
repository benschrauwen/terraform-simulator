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
  // Equity NPV is shown, with its discount basis stated.
  assert.match(html, />Equity NPV</);
  assert.match(html, /discounted at the [\d.]+% project discount rate/);
});

test('payback that is not recovered inside the horizon says so', () => {
  // 3-year horizon: operating cash recovers about half the outlay.
  assert.match(render({ analysisHorizonYears: 3 }), /Not within horizon/);
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

function renderWithBreakEven(overrides = {}) {
  const state = Calc.normalizeState({ ...DEFAULT_STATE, ...overrides });
  const results = Calc.calculateAll(state);
  const breakEven = Calc.calculateBreakEvenPrices(results.state, { baseResult: results });
  const html = renderEconomicsBreakdown(results, {
    state: results.state,
    methaneMarket: METHANE_MARKET_PRESETS[state.methaneMarketPreset],
    cycleUnit: results.solar.cycleUnitCompact,
    breakEven,
  });
  return { html, breakEven, results };
}

test('unit economics lists a break-even price per sold product next to the current price', () => {
  const { html, breakEven } = renderWithBreakEven({ methanolEnabled: true });
  const [methane, methanol] = breakEven;
  assert.match(html, new RegExp(`Break-even methane price \\(NPV = 0\\)</span>\\s*<span class="econ-value">\\$${methane.breakEvenPrice.toFixed(2)}/MCF \\(current \\$20\\.00/MCF\\)`));
  assert.match(html, new RegExp(`Break-even methanol price \\(NPV = 0\\)</span>\\s*<span class="econ-value">\\$${Math.round(methanol.breakEvenPrice)}/t \\(current \\$600/t\\)`));
  assert.match(html, /data-tooltip="Sale price of methane at which project NPV is zero[^"]*held fixed\./);
});

test('a negative break-even is shown as such, not hidden', () => {
  const { html, breakEven } = renderWithBreakEven({ aiComputeEnabled: true });
  const methane = breakEven.find(product => product.key === 'methane');
  assert.ok(methane.breakEvenPrice < 0);
  assert.match(html, new RegExp(`−\\$${Math.abs(methane.breakEvenPrice).toFixed(2)}/MCF \\(current`));
  assert.match(html, /NPV stays positive even if methane were given away/);
  assert.match(html, /Break-even AI token price \(NPV = 0\)/);
});
