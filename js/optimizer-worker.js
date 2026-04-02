const OPTIMIZER_WORKER_BUILD_ID = '__APP_BUILD_ID__';
const OPTIMIZER_WORKER_ASSET_VERSION = OPTIMIZER_WORKER_BUILD_ID.startsWith('__') ? '' : OPTIMIZER_WORKER_BUILD_ID;

function resolveOptimizerWorkerBootstrapPath(path) {
  if (!OPTIMIZER_WORKER_ASSET_VERSION) return path;
  return `${path}?v=${encodeURIComponent(OPTIMIZER_WORKER_ASSET_VERSION)}`;
}

importScripts(resolveOptimizerWorkerBootstrapPath('asset-paths.js'));
importScripts(AssetPaths.resolve('calculation-runtime-paths.js'));
importScripts(...getWorkerCalculationRuntimeScriptPaths(path => AssetPaths.resolve(path)));

self.addEventListener('message', event => {
  const { requestId, type, state, search } = event.data || {};
  if (type !== 'findBestRangeValueForIrr') return;

  try {
    const result = Calc.findBestRangeValueForIrr(state, search, {
      onProgress(progress) {
        self.postMessage({
          requestId,
          messageType: 'progress',
          progress,
        });
      },
    });
    self.postMessage({ requestId, messageType: 'result', result });
  } catch (error) {
    self.postMessage({
      requestId,
      messageType: 'error',
      error: {
        message: error?.message || 'Optimizer worker failed.',
      },
    });
  }
});
