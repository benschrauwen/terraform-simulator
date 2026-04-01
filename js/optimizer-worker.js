importScripts(
  'solar-geometry.js?v=20260401-chem-clipping',
  'constants.js?v=20260401-chem-clipping',
  'calculations/calculations-core.js?v=20260401-chem-clipping',
  'calculations/calculations-solar.js?v=20260401-chem-clipping',
  'calculations/calculations-battery.js?v=20260401-chem-clipping',
  'calculations/calculations-series-ai.js?v=20260401-chem-clipping',
  'calculations/calculations-process.js?v=20260401-chem-clipping',
  'calculations/calculations-economics.js?v=20260401-chem-clipping'
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
