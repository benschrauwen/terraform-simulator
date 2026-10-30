import assert from 'node:assert/strict';
import test from 'node:test';

import { Calc } from '../../js/model/index.js';
import { optimizerMethods } from '../../js/ui/optimizer-client.js';

function loadOptimizerMethods(t, { Calc: calcOverrides, Worker } = {}) {
  const elements = new Map();
  const warnings = [];
  globalThis.window = {};
  globalThis.document = {
    getElementById(id) {
      return elements.get(id) || null;
    },
  };
  t.mock.method(console, 'warn', (...args) => {
    warnings.push(args);
  });

  Object.entries(calcOverrides || {}).forEach(([name, implementation]) => {
    t.mock.method(Calc, name, implementation);
  });
  if (Worker !== undefined) globalThis.Worker = Worker;
  else delete globalThis.Worker;

  return {
    methods: optimizerMethods,
    warnings,
    registerInput(id, overrides = {}) {
      const input = {
        id,
        min: '0',
        max: '100',
        step: '1',
        value: '20',
        ...overrides,
      };
      elements.set(id, input);
      return input;
    },
  };
}

test.afterEach(() => {
  delete globalThis.Worker;
  delete globalThis.document;
  delete globalThis.window;
});

function createOptimizerApp(overrides = {}) {
  return Object.assign(Object.create(optimizerMethods), {
    state: {
      batteryCapacityMWh: 20,
    },
    optimizerWorker: null,
    optimizerRequestId: 0,
    optimizerRequests: new Map(),
    ...overrides,
  });
}

test('optimizer worker module answers search requests through the Calc facade', async t => {
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
  t.mock.method(Calc, 'findBestRangeValueForIrr', (state, search, { onProgress } = {}) => {
    onProgress?.({ percent: 50, stage: 'coarse' });
    return { bestValue: search.max };
  });

  await import('../../js/workers/optimizer-worker.js');
  assert.equal(typeof listeners.message, 'function');

  listeners.message({ data: { requestId: 7, type: 'findBestRangeValueForIrr', state: {}, search: { max: 12 } } });
  listeners.message({ data: { requestId: 8, type: 'unrelated' } });

  assert.deepEqual(messages, [
    { requestId: 7, messageType: 'progress', progress: { percent: 50, stage: 'coarse' } },
    { requestId: 7, messageType: 'result', result: { bestValue: 12 } },
  ]);
});

test('IRR optimizer falls back to Calc when Worker construction fails', async t => {
  const calcCalls = [];
  const { methods, registerInput, warnings } = loadOptimizerMethods(t, {
    Worker: function BlockedWorker() {
      throw new Error('Worker blocked by runtime policy.');
    },
    Calc: {
      findBestRangeValueForIrr(state, search, { onProgress } = {}) {
        calcCalls.push({ state, search });
        onProgress?.({ percent: 100, stage: 'done' });
        return { bestValue: 42 };
      },
    },
  });
  const app = createOptimizerApp();
  const progress = [];
  registerInput('batteryCapacity', {
    min: '0',
    max: '80',
    step: '0.5',
    value: '20',
  });

  const bestValue = await methods.findBestRangeValueForIrr.call(
    app,
    {
      inputId: 'batteryCapacity',
      stateKey: 'batteryCapacityMWh',
      maxCoarseSamples: 9,
      maxTopRegions: 2,
    },
    update => progress.push(update)
  );

  assert.equal(bestValue, 42);
  assert.equal(calcCalls.length, 1);
  assert.equal(calcCalls[0].search.step, 0.5);
  assert.equal(calcCalls[0].search.maxCoarseSamples, 9);
  assert.equal(progress.at(-1).stage, 'done');
  assert.equal(app.optimizerRequests.size, 0);
  assert.match(String(warnings[0][0]), /Optimizer worker failed/);
});

test('worker error rejects pending optimizer searches and clears the cached worker', async t => {
  const workers = [];
  class FakeWorker {
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
  }

  const { methods } = loadOptimizerMethods(t, { Worker: FakeWorker });
  const app = createOptimizerApp();
  const request = methods.requestOptimizerWorkerSearch.call(app, { stateKey: 'batteryCapacityMWh' });

  assert.equal(workers.length, 1);
  assert.ok(workers[0].url instanceof URL, 'Expected the worker to be resolved relative to the module URL.');
  assert.match(workers[0].url.href, /\/js\/workers\/optimizer-worker\.js$/);
  assert.deepEqual(workers[0].options, { type: 'module' });
  assert.equal(workers[0].message.requestId, 1);
  assert.equal(app.optimizerRequests.size, 1);

  workers[0].listeners.error({ message: 'Worker crashed while importing runtime.' });

  await assert.rejects(request, /Worker crashed while importing runtime/);
  assert.equal(app.optimizerRequests.size, 0);
  assert.equal(app.optimizerWorker, null);
});

test('postMessage failures do not leave stale optimizer requests', async t => {
  class ThrowingWorker {
    addEventListener() {}

    postMessage() {
      throw new Error('Data clone failed.');
    }
  }

  const { methods } = loadOptimizerMethods(t, { Worker: ThrowingWorker });
  const app = createOptimizerApp();

  await assert.rejects(
    methods.requestOptimizerWorkerSearch.call(app, { stateKey: 'batteryCapacityMWh' }),
    /Data clone failed/
  );
  assert.equal(app.optimizerRequestId, 1);
  assert.equal(app.optimizerRequests.size, 0);
});
