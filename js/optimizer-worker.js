const OPTIMIZER_WORKER_VERSION = '20260401-maintainability';

importScripts(`calculation-runtime-paths.js?v=${OPTIMIZER_WORKER_VERSION}`);
importScripts(...getWorkerCalculationRuntimeScriptPaths(`?v=${OPTIMIZER_WORKER_VERSION}`));

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
