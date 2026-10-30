/* Module worker: runs the IRR optimizer search off the main thread. */

import { Calc } from '../model/index.js';

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
