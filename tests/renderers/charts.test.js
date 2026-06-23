const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');
const APP_CHARTS_PATH = path.join(ROOT, 'js', 'app-charts.js');
const APP_CHARTS_SOURCE = fs.readFileSync(APP_CHARTS_PATH, 'utf8');

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
  const context = {
    window: {},
    document: {
      getElementById(id) {
        return elements.get(id) || null;
      },
    },
    FormatNumbers: {
      fixed(value, digits = 0) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return 'N/A';
        return numeric.toFixed(digits);
      },
      formatMoney(value) {
        return `$${Number(value).toFixed(0)}`;
      },
    },
    Calc: {
      runSensitivity: runSensitivity || (() => []),
    },
  };

  if (Chart) context.Chart = Chart;

  vm.createContext(context);
  vm.runInContext(APP_CHARTS_SOURCE, context, { filename: 'js/app-charts.js' });

  return {
    methods: context.window.AppChartMethods,
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

function createEconomicsResult() {
  return {
    economics: {
      capexBreakdown: {
        solarModules: 100,
      },
      capex: {
        battery: 0,
        ai: 0,
        electrolyzer: 0,
        dac: 0,
        sabatier: 0,
        methanol: 0,
      },
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
