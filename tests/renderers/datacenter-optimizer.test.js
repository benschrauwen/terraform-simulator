/* Datacenter design optimizer: worker protocol, client (worker + main-thread fallback) and the
   results card (rendering, escaping, Apply). */
import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateDatacenterScenario, compareArchitectures, DATACENTER_DEFAULT_STATE, normalizeDatacenterState } from '../../js/model/datacenter/index.js';
import { datacenterOptimizerClientMethods } from '../../js/ui/datacenter/optimizer-client.js';
import { compactMoney, datacenterOptimizerMethods, optimizerColumns, renderOptimizerResults } from '../../js/ui/datacenter/optimizer-panel.js';
import { formatYearMonth, money } from '../../js/ui/datacenter/format.js';

test('datacenter optimizer worker answers both request types with progress, result and errors', async t => {
  const listeners = {};
  const messages = [];
  globalThis.self = {
    addEventListener(type, listener) {
      listeners[type] = listener;
    },
    postMessage(message) {
      messages.push(message);
    },
  };
  t.after(() => {
    delete globalThis.self;
  });

  await import('../../js/workers/datacenter-optimizer-worker.js');
  assert.equal(typeof listeners.message, 'function');

  const state = { ...DATACENTER_DEFAULT_STATE };
  listeners.message({ data: { requestId: 3, type: 'optimizeDatacenterDesign', state, options: { budget: 60, sizeSolar: false } } });
  listeners.message({ data: { requestId: 4, type: 'unrelated' } });
  listeners.message({ data: { requestId: 5, type: 'compareDatacenterArchitectures', state, options: { budget: 40, architectures: ['islanded'] } } });
  listeners.message({ data: { requestId: 6, type: 'optimizeDatacenterDesign', state: null, options: { budget: -1, bounds: { unitsMax: Symbol('x') } } } });

  assert.ok(messages.every(message => message.requestId !== 4), 'unknown types are ignored');
  const byRequest = id => messages.filter(message => message.requestId === id);

  const single = byRequest(3);
  assert.equal(single.at(-1).messageType, 'result');
  assert.ok(single.slice(0, -1).every(message => message.messageType === 'progress'));
  assert.equal(single.at(-2).progress.stage, 'done');
  assert.ok(single.at(-1).result.candidatesEvaluated <= 60);
  assert.equal(single.at(-1).result.best.solarMWdc, 0, 'solar not sized');
  // The result crosses the worker boundary: it must be structured-cloneable.
  assert.doesNotThrow(() => structuredClone(single.at(-1).result));

  const compare = byRequest(5);
  assert.equal(compare.at(-1).messageType, 'result');
  assert.deepEqual(compare.at(-1).result.rows.map(row => row.architecture), ['islanded']);
  assert.ok(compare.filter(message => message.messageType === 'progress').every(message => message.progress.architecture === 'islanded'));

  const failed = byRequest(6);
  assert.equal(failed.at(-1).messageType, 'error');
  assert.match(failed.at(-1).error.message, /\S/);
});

/* ---------- Results card ---------- */

const COMPARE = compareArchitectures({ ...DATACENTER_DEFAULT_STATE }, { budget: 150 });
const compareRun = () => ({ mode: 'compare', result: structuredClone(COMPARE), reference: { ...DATACENTER_DEFAULT_STATE }, elapsedMs: 1234, appliedKey: null });

test('results table: the current design plus one column per architecture, with the model\'s numbers', () => {
  const run = compareRun();
  const html = renderOptimizerResults(run);
  const columns = optimizerColumns(run);
  assert.deepEqual(columns.map(column => column.key), ['current', 'grid', 'hybrid', 'islanded']);
  columns.forEach(column => {
    assert.ok(html.includes(`>${compactMoney(column.summary.npv)}<`), `${column.key} NPV`);
    assert.ok(html.includes(`title="${money(column.summary.npv)}"`), `${column.key} exact NPV`);
    assert.ok(html.includes(`>${compactMoney(column.summary.totalCapex)}<`), `${column.key} CAPEX`);
    assert.ok(html.includes(formatYearMonth(column.summary.firstPower)), `${column.key} first power`);
  });
  assert.equal((html.match(/data-optimizer-apply="/g) || []).length, 3, 'one Apply per optimized design');
  assert.match(html, /<span class="dc-opt-tag">best<\/span>/);
  assert.match(html, /model runs in 1\.2 s/);
  assert.doesNotMatch(html, /\sstyle=/);
});

test('results table escapes notes and flags infeasible designs and upper-bound corners', () => {
  const run = compareRun();
  const islanded = run.result.rows.find(row => row.architecture === 'islanded').result;
  islanded.best.feasible = false;
  islanded.corners = ['battery'];
  islanded.notes = ['Uptime <b>low</b> & more'];
  const html = renderOptimizerResults(run);
  assert.match(html, /misses target/);
  assert.match(html, /battery at the upper bound of the search/);
  assert.match(html, /Uptime &lt;b&gt;low&lt;\/b&gt; &amp; more/);
  assert.doesNotMatch(html, /<b>low<\/b>/);
});

test('compact money keeps three significant figures', () => {
  assert.equal(compactMoney(581.32e6), '$581M');
  assert.equal(compactMoney(5.213e9), '$5.21B');
  assert.equal(compactMoney(-42.04e6), '-$42.0M');
  assert.equal(compactMoney(NaN), '—');
});

function fakeElement(extra = {}) {
  return { hidden: false, textContent: '', innerHTML: '', value: 0, checked: false, disabled: false, addEventListener() {}, ...extra };
}

test('Apply puts the design (architecture included) into the state and recalculates', t => {
  const elements = { optimizerResults: fakeElement(), optimizerStatus: fakeElement(), optimizerProgress: fakeElement(), optimizerStale: fakeElement() };
  globalThis.document = { getElementById: id => elements[id] || null };
  t.after(() => { delete globalThis.document; });
  let recalculations = 0;
  const app = Object.assign(Object.create(datacenterOptimizerMethods), {
    state: { ...DATACENTER_DEFAULT_STATE },
    optimizerRun: compareRun(),
    syncStateToControls() {},
    recalculate() {
      recalculations += 1;
      this.state = normalizeDatacenterState(this.state);
      this.updateOptimizerStaleness();
    },
  });
  const islanded = COMPARE.rows.find(row => row.architecture === 'islanded').result.best;
  app.applyOptimizerDesign('islanded');
  assert.equal(recalculations, 1);
  assert.equal(app.state.architecture, 'islanded');
  assert.equal(app.state.solarSizeMWdc, islanded.solarMWdc);
  assert.equal(app.state.batteryCapacityMWh, islanded.batteryMWh);
  assert.match(elements.optimizerResults.innerHTML, /data-optimizer-apply="islanded" disabled[^>]*>Applied</);
  assert.equal(elements.optimizerStale.hidden, true, 'the applied design is not stale');
  // Switching to another result leaves nothing of the first behind: the state is that design.
  app.applyOptimizerDesign('grid');
  const grid = COMPARE.rows.find(row => row.architecture === 'grid').result.best;
  assert.equal(app.state.architecture, 'grid');
  assert.equal(calculateDatacenterScenario(app.state, { fastMode: true }).economics.npv, grid.npv);
  // A later edit marks the results stale.
  app.state = { ...app.state, itCapacityMW: 250 };
  app.updateOptimizerStaleness();
  assert.equal(elements.optimizerStale.hidden, false);
  // The current-design column has no patch: nothing to apply.
  const before = { ...app.state };
  app.applyOptimizerDesign('current');
  assert.deepEqual(app.state, before);
});

test('the optimizer client falls back to the main thread when the worker cannot start', async t => {
  globalThis.Worker = function BlockedWorker() {
    throw new Error('Worker blocked by runtime policy.');
  };
  const warnings = [];
  t.mock.method(console, 'warn', (...args) => warnings.push(args));
  t.after(() => { delete globalThis.Worker; });
  const app = Object.create(datacenterOptimizerClientMethods);
  const progress = [];
  const result = await app.requestDatacenterOptimization('optimizeDatacenterDesign', { ...DATACENTER_DEFAULT_STATE }, { budget: 40, sizeSolar: false, sizeBattery: false }, update => progress.push(update));
  assert.ok(result.candidatesEvaluated <= 40);
  assert.equal(progress.at(-1).stage, 'done');
  assert.match(String(warnings[0][0]), /worker failed/);
  await assert.rejects(app.requestDatacenterOptimization('nope', {}), /Unknown optimizer request/);
});

test('the optimizer client resolves the worker URL next to the module and routes progress by request', async t => {
  const workers = [];
  globalThis.Worker = class FakeWorker {
    constructor(url, options) {
      this.url = url;
      this.options = options;
      this.listeners = {};
      workers.push(this);
    }

    addEventListener(type, listener) {
      this.listeners[type] = listener;
    }

    postMessage(message) {
      this.message = message;
    }
  };
  t.after(() => { delete globalThis.Worker; });
  const app = Object.create(datacenterOptimizerClientMethods);
  const progress = [];
  const pending = app.postDatacenterOptimizerRequest('compareDatacenterArchitectures', { itCapacityMW: 5 }, { budget: 10 }, update => progress.push(update));
  const worker = workers[0];
  assert.match(worker.url.href, /\/js\/workers\/datacenter-optimizer-worker\.js$/);
  assert.deepEqual(worker.options, { type: 'module' });
  assert.equal(worker.message.type, 'compareDatacenterArchitectures');
  const { requestId } = worker.message;
  worker.listeners.message({ data: { requestId, messageType: 'progress', progress: { percent: 40 } } });
  worker.listeners.message({ data: { requestId: requestId + 99, messageType: 'result', result: { wrong: true } } });
  worker.listeners.message({ data: { requestId, messageType: 'result', result: { ok: true } } });
  assert.deepEqual(await pending, { ok: true });
  assert.deepEqual(progress, [{ percent: 40 }]);
  // A crash rejects what is pending and drops the cached worker.
  const second = app.postDatacenterOptimizerRequest('optimizeDatacenterDesign', {}, {}, null);
  worker.listeners.error({ message: 'boom' });
  await assert.rejects(second, /boom/);
  assert.equal(app.datacenterOptimizerWorker, null);
});
