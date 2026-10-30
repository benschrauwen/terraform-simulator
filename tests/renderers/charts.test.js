import assert from 'node:assert/strict';
import test from 'node:test';

import { Calc } from '../../js/model/index.js';
import { RESULT_CHARTS, chartMethods } from '../../js/ui/charts/index.js';
import { findSweepBreakEven } from '../../js/ui/charts/sensitivity-chart.js';

function createElement(id) {
  return {
    id,
    hidden: false,
    dataset: {},
    attributes: {},
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    removeAttribute(name) {
      delete this.attributes[name];
    },
  };
}

function createCanvas(id) {
  const wrapper = createElement(`${id}Wrapper`);
  const canvas = {
    ...createElement(id),
    parentElement: wrapper,
    closest(selector) {
      return selector === '.chart-wrapper' ? wrapper : null;
    },
  };
  return { canvas, wrapper };
}

function loadChartMethods({ Chart, runSensitivity } = {}) {
  const elements = new Map();
  globalThis.window = {};
  globalThis.document = {
    getElementById(id) {
      return elements.get(id) || null;
    },
  };

  if (Chart) globalThis.Chart = Chart;
  else delete globalThis.Chart;

  Calc.runSensitivity = runSensitivity || (() => []);

  return {
    methods: chartMethods,
    registerCanvas(id) {
      const element = createCanvas(id);
      elements.set(id, element.canvas);
      return element;
    },
    registerElement(id) {
      const element = createElement(id);
      elements.set(id, element);
      return element;
    },
  };
}

const originalRunSensitivity = Calc.runSensitivity;

test.afterEach(() => {
  Calc.runSensitivity = originalRunSensitivity;
  delete globalThis.Chart;
  delete globalThis.document;
  delete globalThis.window;
});

test('updateCharts redraws every registered per-result chart once, in order', () => {
  const calls = [];
  const app = Object.create(chartMethods);
  RESULT_CHARTS.forEach(([methods, update]) => {
    assert.equal(typeof methods[update], 'function', `${update} is defined by its chart module`);
    assert.equal(chartMethods[update], methods[update], `${update} is mixed into the App`);
    app[update] = r => calls.push([update, r]);
  });
  app.updateSensitivityChart = () => calls.push(['updateSensitivityChart']);
  const result = { marker: true };
  app.updateCharts(result);
  assert.deepEqual(calls, RESULT_CHARTS.map(([, update]) => [update, result]));
});

function createEconomicsResult() {
  return {
    economics: {
      capexItems: [
        { key: 'solar', label: 'Solar', capex: 100, parts: [{ key: 'solarModules', label: 'Solar modules', capex: 100 }] },
        { key: 'battery', label: 'Battery', capex: 0 },
      ],
    },
  };
}

test('economics chart shows a visible fallback when Chart.js is unavailable', () => {
  const { methods, registerCanvas } = loadChartMethods();
  const { canvas, wrapper } = registerCanvas('econChart');
  let destroyed = false;
  const app = {
    charts: {
      econ: {
        destroy() {
          destroyed = true;
        },
      },
    },
    chartKeys: {
      econ: 'previous-render',
    },
  };

  assert.doesNotThrow(() => methods.updateEconChart.call(app, createEconomicsResult()));

  assert.equal(destroyed, true);
  assert.equal(app.charts.econ, undefined);
  assert.equal(app.chartKeys.econ, undefined);
  assert.equal(canvas.hidden, true);
  assert.equal(wrapper.dataset.chartUnavailable, 'Charts are unavailable because Chart.js failed to load.');
  assert.equal(wrapper.attributes.role, 'status');
  assert.equal(wrapper.attributes['aria-label'], 'Charts are unavailable because Chart.js failed to load.');
});

test('sensitivity charts do not run sweeps when Chart.js is unavailable', () => {
  const { methods, registerCanvas, registerElement } = loadChartMethods({
    runSensitivity() {
      throw new Error('Sensitivity sweep should not run without Chart.js.');
    },
  });
  const methane = registerCanvas('sensitivityMethaneChart');
  registerCanvas('sensitivityMethanolChart');
  registerCanvas('sensitivityAiChart');
  const methaneCard = registerElement('sensitivityMethaneCard');
  const methanolCard = registerElement('sensitivityMethanolCard');
  const aiCard = registerElement('sensitivityAiCard');
  const emptyState = registerElement('sensitivityEmptyState');
  const app = {
    charts: {},
    chartKeys: {},
    state: {},
  };

  assert.doesNotThrow(() => methods.updateSensitivityChart.call(app, {
    sabatier: { enabled: true, ch4AnnualMCF: 10 },
    methanol: { enabled: false, annualTons: 0 },
    ai: { enabled: false, annualTokensM: 0 },
  }));

  assert.equal(methaneCard.hidden, false);
  assert.equal(methanolCard.hidden, true);
  assert.equal(aiCard.hidden, true);
  assert.equal(emptyState.hidden, true);
  assert.equal(methane.canvas.hidden, true);
  assert.equal(methane.wrapper.dataset.chartUnavailable, 'Charts are unavailable because Chart.js failed to load.');
});

test('chart fallback state clears when Chart.js is available', () => {
  function FakeChart(canvas, config) {
    this.canvas = canvas;
    this.config = config;
    this.destroy = () => {};
    FakeChart.instances.push(this);
  }
  FakeChart.instances = [];

  const { methods, registerCanvas } = loadChartMethods({ Chart: FakeChart });
  const { canvas, wrapper } = registerCanvas('econChart');
  canvas.hidden = true;
  wrapper.dataset.chartUnavailable = 'previous fallback';
  wrapper.setAttribute('role', 'status');
  wrapper.setAttribute('aria-label', 'previous fallback');
  const app = {
    charts: {},
    chartKeys: {},
  };

  methods.updateEconChart.call(app, createEconomicsResult());

  assert.equal(FakeChart.instances.length, 1);
  assert.equal(app.charts.econ, FakeChart.instances[0]);
  assert.equal(canvas.hidden, false);
  assert.equal(wrapper.dataset.chartUnavailable, undefined);
  assert.equal(wrapper.attributes.role, undefined);
  assert.equal(wrapper.attributes['aria-label'], undefined);
});

test('the sensitivity sweep break-even is the zero of the NPV line', () => {
  // NPV = 10 x price - 80 -> zero at $8.
  const series = [2, 4, 10, 20].map(x => ({ x, npv: (10 * x) - 80 }));
  assert.deepEqual(findSweepBreakEven(series), { price: 8, inSweep: true });
  assert.deepEqual(findSweepBreakEven(series.map(point => ({ ...point, npv: point.npv + 300 }))), { price: -22, inSweep: false });
  assert.equal(findSweepBreakEven([{ x: 1, npv: 5 }, { x: 2, npv: 5 }]), null);
});
