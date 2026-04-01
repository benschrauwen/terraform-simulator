importScripts(
  'solar-geometry.js?v=20260401-opt-progress',
  'constants.js?v=20260401-opt-progress',
  'calculations/calculations-core.js?v=20260401-opt-progress',
  'calculations/calculations-solar.js?v=20260401-opt-progress',
  'calculations/calculations-battery.js?v=20260401-opt-progress',
  'calculations/calculations-series-ai.js?v=20260401-opt-progress',
  'calculations/calculations-process.js?v=20260401-opt-progress',
  'calculations/calculations-economics.js?v=20260401-opt-progress'
);

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
