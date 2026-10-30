import assert from 'node:assert/strict';
import test from 'node:test';

import { Calc, DEFAULT_STATE } from '../../js/model/index.js';
import { runTornado } from '../../js/model/tornado.js';
import { chartMethods } from '../../js/ui/charts/index.js';
import { getTornadoRowLabel, getTornadoSpans } from '../../js/ui/charts/tornado-chart.js';

function createElement(id) {
  return {
    id,
    hidden: true,
    dataset: {},
    attributes: {},
    style: {},
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    removeAttribute(name) {
      delete this.attributes[name];
    },
  };
}

function installDom() {
  const card = createElement('tornadoCard');
  const wrapper = createElement('tornadoWrapper');
  const canvas = {
    ...createElement('tornadoChart'),
    hidden: false,
    parentElement: wrapper,
    closest: selector => (selector === '.chart-wrapper' ? wrapper : null),
  };
  const elements = new Map([['tornadoCard', card], ['tornadoChart', canvas]]);
  globalThis.window = {};
  globalThis.document = { getElementById: id => elements.get(id) || null };
  return { card, wrapper, canvas };
}

function installChartStub() {
  const created = [];
  globalThis.Chart = class {
    constructor(canvas, config) {
      this.canvas = canvas;
      this.config = config;
      this.destroyed = false;
      created.push(this);
    }

    destroy() {
      this.destroyed = true;
    }
  };
  return created;
}

test.afterEach(() => {
  delete globalThis.Chart;
  delete globalThis.document;
  delete globalThis.window;
});

test('spans run from the base NPV; same-side bounds sit end to end instead of overlapping', () => {
  assert.deepEqual(getTornadoSpans({ lowNpv: -50, highNpv: 80 }, 10), { low: [10, -50], high: [10, 80] });
  // Both bounds above the base: the nearer one from the base, the farther one onward.
  assert.deepEqual(getTornadoSpans({ lowNpv: 30, highNpv: 70 }, 10), { low: [10, 30], high: [30, 70] });
  assert.deepEqual(getTornadoSpans({ lowNpv: -90, highNpv: -20 }, 10), { low: [-20, -90], high: [10, -20] });
  // A bound at the base draws as an empty bar.
  assert.deepEqual(getTornadoSpans({ lowNpv: 10, highNpv: -40 }, 10), { low: [10, 10], high: [10, -40] });
});

test('updateTornadoChart draws one horizontal floating bar per applicable input', () => {
  const { card, wrapper, canvas } = installDom();
  const created = installChartStub();
  const app = Object.assign(Object.create(chartMethods), { charts: {}, chartKeys: {}, state: { ...DEFAULT_STATE } });
  const result = Calc.calculateAll(DEFAULT_STATE);
  const expected = runTornado(DEFAULT_STATE);

  app.updateTornadoChart(result);

  assert.equal(card.hidden, false);
  assert.equal(created.length, 1);
  const { config } = created[0];
  assert.equal(config.type, 'bar');
  assert.equal(config.options.indexAxis, 'y');
  assert.equal(config.data.labels.length, expected.bars.length);
  assert.equal(config.data.labels[0], getTornadoRowLabel(expected.bars[0]));
  assert.deepEqual(config.options.plugins.tornadoRowLabels.bars.map(bar => bar.id), expected.bars.map(bar => bar.id));
  assert.equal(config.data.datasets.length, 2);
  config.data.datasets.forEach(dataset => assert.equal(dataset.data.length, expected.bars.length));
  assert.equal(config.options.plugins.tornadoReferenceLines.baseNpv, expected.baseNpv);
  assert.match(wrapper.style.height, /^\d+px$/);
  assert.match(canvas.attributes['aria-label'], new RegExp(expected.bars[0].label));

  // A redraw replaces the previous chart instead of stacking a second one.
  app.updateTornadoChart(result);
  assert.equal(created.length, 2);
  assert.equal(created[0].destroyed, true);
  assert.equal(app.charts.tornado, created[1]);
});

test('updateTornadoChart hides the card without a result and flags a missing Chart.js', () => {
  const { card, wrapper } = installDom();
  const app = Object.assign(Object.create(chartMethods), { charts: {}, chartKeys: {}, state: { ...DEFAULT_STATE } });

  installChartStub();
  app.updateTornadoChart(null);
  assert.equal(card.hidden, true);
  assert.equal(app.charts.tornado, undefined);

  delete globalThis.Chart;
  app.updateTornadoChart(Calc.calculateAll(DEFAULT_STATE));
  assert.equal(card.hidden, false);
  assert.ok(wrapper.dataset.chartUnavailable);
  assert.equal(app.charts.tornado, undefined);
});

test('updateSensitivityCharts refreshes the tornado and the price curves together', () => {
  const calls = [];
  const app = Object.create(chartMethods);
  app.updateTornadoChart = r => calls.push(['tornado', r]);
  app.updateSensitivityChart = r => calls.push(['prices', r]);
  app.updateSensitivityCharts('result');
  assert.deepEqual(calls, [['tornado', 'result'], ['prices', 'result']]);
});
