/* Datacenter design optimizer: worker protocol, client (worker + main-thread fallback) and the
   results card (rendering, escaping, Apply). */
import assert from 'node:assert/strict';
import test from 'node:test';

import { DATACENTER_DEFAULT_STATE } from '../../js/model/datacenter/index.js';

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
