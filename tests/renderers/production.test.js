import assert from 'node:assert/strict';
import test from 'node:test';

import { rendererMethods } from '../../js/ui/renderers/index.js';
import { econMetric, econRow } from '../../js/ui/renderers/markup.js';

function loadRendererMethods() {
  const productionGrid = { innerHTML: '' };
  globalThis.document = {
    getElementById(id) {
      if (id === 'productionGrid') return productionGrid;
      throw new Error(`Unexpected element lookup: ${id}`);
    },
  };

  return {
    methods: rendererMethods,
    productionGrid,
  };
}

test.afterEach(() => {
  delete globalThis.document;
});

function createHarness() {
  const { methods, productionGrid } = loadRendererMethods();
  const app = {
    getCycleRateUnit(result) {
      return result.solar.cycleUnitCompact;
    },
  };

  return {
    methods,
    productionGrid,
    app,
  };
}

test('production summary keeps AI scenarios focused on outputs', () => {
  const { methods, productionGrid, app } = createHarness();
  const result = {
    solar: { annualMWh: 185643, cycleUnitCompact: 'day' },
    ai: { enabled: true, annualTokensM: 72491.13 },
    electrolyzer: { enabled: true, h2DailyKg: 2861.9 },
    dac: { enabled: true, co2DailyKg: 20805.7 },
    sabatier: { enabled: false, ch4DailyMCF: 0 },
    methanol: { enabled: true, dailyLiters: 15295.4 },
    h2Surplus: 572.4,
    co2Surplus: 4161.1,
  };

  methods.updateProduction.call(app, result);

  assert.ok(productionGrid.innerHTML.includes('Electricity'));
  assert.ok(productionGrid.innerHTML.includes('AI Tokens'));
  assert.ok(productionGrid.innerHTML.includes('Hydrogen'));
  assert.ok(productionGrid.innerHTML.includes('CO₂ Captured'));
  assert.ok(productionGrid.innerHTML.includes('Methanol'));
  assert.ok(productionGrid.innerHTML.includes('Unused H₂'));
  assert.ok(productionGrid.innerHTML.includes('CO₂ Surplus'));
  assert.equal(productionGrid.innerHTML.includes('Flexible Chem Energy'), false);
  assert.equal(productionGrid.innerHTML.includes('Residual Chem Energy'), false);
  assert.equal(productionGrid.innerHTML.includes('AI Load'), false);
  assert.equal(productionGrid.innerHTML.includes('AI Utilization'), false);
});

test('production summary omits disabled process rows', () => {
  const { methods, productionGrid, app } = createHarness();
  const result = {
    solar: { annualMWh: 4200, cycleUnitCompact: 'day' },
    ai: { enabled: false, annualTokensM: 0 },
    electrolyzer: { enabled: false, h2DailyKg: 0 },
    dac: { enabled: false, co2DailyKg: 0 },
    sabatier: { enabled: false, ch4DailyMCF: 0 },
    methanol: { enabled: false, dailyLiters: 0 },
    h2Surplus: 0,
    co2Surplus: 0,
  };

  methods.updateProduction.call(app, result);

  assert.ok(productionGrid.innerHTML.includes('Electricity'));
  assert.equal(productionGrid.innerHTML.includes('Daily Energy'), false);
  assert.equal(productionGrid.innerHTML.includes('Hydrogen'), false);
  assert.equal(productionGrid.innerHTML.includes('CO₂ Captured'), false);
  assert.equal(productionGrid.innerHTML.includes('AI Tokens'), false);
});

test('economics renderer uses custom tooltip attributes on labels', () => {
  const rowHtml = econRow('IRR', '12.4%', '', 'Project "return" & hurdle comparison');
  assert.ok(rowHtml.includes('class="econ-label tooltip-label"'));
  assert.ok(rowHtml.includes('data-tooltip="Project &quot;return&quot; &amp; hurdle comparison"'));
  assert.equal(rowHtml.includes('title='), false);

  const metricHtml = econMetric('Levelized cost', '$42', 'negative', 'CRF capital + O&M');
  assert.ok(metricHtml.includes('class="econ-metric-label tooltip-label"'));
  assert.ok(metricHtml.includes('data-tooltip="CRF capital + O&amp;M"'));
});

/* Fake DOM: every id resolves to a recording stub. */
function stubDocument() {
  const elements = new Map();
  const make = () => ({
    textContent: '',
    innerHTML: '',
    hidden: false,
    dataset: {},
    classList: { add() {}, remove() {} },
    setAttribute() {},
    removeAttribute() {},
  });
  globalThis.document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, make());
      return elements.get(id);
    },
  };
  return elements;
}

test('info read-outs show chemical-plant utilization and dispatch hours, not solar CF or day length', async () => {
  const { Calc, DEFAULT_STATE } = await import('../../js/model/index.js');
  // Default: no battery, 100% chemical sizing (nothing clipped). The
  // plant is sized on the annual solar peak, so its utilization is
  // delivered energy / (process kW x 8760 h), above the solar CF
  // (energy / DC nameplate) because the peak sits below nameplate.
  const result = Calc.calculateAll({ ...DEFAULT_STATE });
  const elements = stubDocument();
  rendererMethods.updateInfoDisplays.call({ getDisplaySolarGeometry: () => null }, result);
  const utilization = result.annualDispatch.chemicalKWh / (result.chemicalSupply.processPowerKW * 8760);
  assert.equal(elements.get('effectiveCF').textContent, `${(utilization * 100).toFixed(1)}%`);
  assert.notEqual(elements.get('effectiveCF').textContent, `${(result.solar.capacityFactor * 100).toFixed(1)}%`);
  assert.equal(elements.get('dailyOpHours').textContent, `${result.chemicalSupply.dailyOpHours.toFixed(1)} hrs`);
  assert.ok(result.chemicalSupply.dailyOpHours < Number(result.solar.sunHours), 'op hours sit inside daylight');
});

test('"Near Design Rate" follows reactor utilization, not its absolute MCF/h rate', () => {
  const elements = stubDocument();
  const base = {
    economics: { roi: 0, paybackYears: Infinity },
    chemicalSupply: { effectiveCF: 0.2 },
    electrolyzer: { enabled: false },
    h2Surplus: 0,
  };
  const app = { state: { analysisHorizonYears: 30 } };
  const badges = sabatier => {
    rendererMethods.updatePlantScore.call(app, { ...base, sabatier });
    return elements.get('scoreBadges').innerHTML;
  };
  // A big plant at half load: high absolute rate, low utilization.
  assert.ok(!badges({ enabled: true, designHourlyRate: 50, operatingUtilization: 0.5 }).includes('Near Design Rate'));
  // A tiny plant running flat out.
  assert.ok(badges({ enabled: true, designHourlyRate: 0.01, operatingUtilization: 0.95 }).includes('Near Design Rate'));
});
