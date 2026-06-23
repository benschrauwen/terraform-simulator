const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');
const ASSET_PATHS_SOURCE = fs.readFileSync(path.join(ROOT, 'js', 'asset-paths.js'), 'utf8');
const APP_OPTIMIZER_SOURCE = fs.readFileSync(path.join(ROOT, 'js', 'app-optimizer.js'), 'utf8');

function loadAssetPaths(buildId) {
  const source = buildId === undefined
    ? ASSET_PATHS_SOURCE
    : ASSET_PATHS_SOURCE.replace("'__APP_BUILD_ID__'", JSON.stringify(buildId));
  const context = {};

  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'js/asset-paths.js' });

  return context.AssetPaths;
}

function loadOptimizerMethods({ AssetPaths, Calc, Worker } = {}) {
  const elements = new Map();
  const warnings = [];
  const context = {
    window: {},
    document: {
      getElementById(id) {
        return elements.get(id) || null;
      },
    },
    console: {
      warn(...args) {
        warnings.push(args);
      },
    },
  };

  if (AssetPaths) context.AssetPaths = AssetPaths;
  if (Calc) context.Calc = Calc;
  if (Worker !== undefined) context.Worker = Worker;

  vm.createContext(context);
  vm.runInContext(APP_OPTIMIZER_SOURCE, context, { filename: 'js/app-optimizer.js' });

  return {
    methods: context.window.AppOptimizerMethods,
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

function createOptimizerApp(overrides = {}) {
  return {
    state: {
      batteryCapacityMWh: 20,
    },
    optimizerWorker: null,
    optimizerRequestId: 0,
    optimizerRequests: new Map(),
    ...overrides,
  };
}

test('asset path resolver versions local assets only when the build token has been replaced', () => {
  const developmentPaths = loadAssetPaths();
  assert.equal(developmentPaths.version, '');
  assert.equal(developmentPaths.resolve('js/optimizer-worker.js'), 'js/optimizer-worker.js');

  const productionPaths = loadAssetPaths('build 123');
  assert.equal(productionPaths.version, 'build 123');
  assert.equal(
    productionPaths.resolve('js/optimizer-worker.js'),
    'js/optimizer-worker.js?v=build%20123'
  );
  assert.equal(
    productionPaths.resolve('js/optimizer-worker.js?mode=fast'),
    'js/optimizer-worker.js?mode=fast&v=build%20123'
  );
});

test('IRR optimizer falls back to Calc when Worker construction fails', async () => {
  const calcCalls = [];
  const { methods, registerInput, warnings } = loadOptimizerMethods({
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

test('worker error rejects pending optimizer searches and clears the cached worker', async () => {
  const workers = [];
  class FakeWorker {
    constructor(url) {
      this.url = url;
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

  const { methods } = loadOptimizerMethods({
    AssetPaths: {
      resolve(assetPath) {
        return `${assetPath}?v=test-build`;
      },
    },
    Worker: FakeWorker,
  });
  const app = createOptimizerApp();
  const request = methods.requestOptimizerWorkerSearch.call(app, { stateKey: 'batteryCapacityMWh' });

  assert.equal(workers.length, 1);
  assert.equal(workers[0].url, 'js/optimizer-worker.js?v=test-build');
  assert.equal(workers[0].message.requestId, 1);
  assert.equal(app.optimizerRequests.size, 1);

  workers[0].listeners.error({ message: 'Worker crashed while importing runtime.' });

  await assert.rejects(request, /Worker crashed while importing runtime/);
  assert.equal(app.optimizerRequests.size, 0);
  assert.equal(app.optimizerWorker, null);
});

test('postMessage failures do not leave stale optimizer requests', async () => {
  class ThrowingWorker {
    addEventListener() {}

    postMessage() {
      throw new Error('Data clone failed.');
    }
  }

  const { methods } = loadOptimizerMethods({ Worker: ThrowingWorker });
  const app = createOptimizerApp();

  await assert.rejects(
    methods.requestOptimizerWorkerSearch.call(app, { stateKey: 'batteryCapacityMWh' }),
    /Data clone failed/
  );
  assert.equal(app.optimizerRequestId, 1);
  assert.equal(app.optimizerRequests.size, 0);
});
