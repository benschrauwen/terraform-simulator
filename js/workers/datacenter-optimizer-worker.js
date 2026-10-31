/* Module worker: runs the datacenter design optimizer (model/datacenter/optimizer.js) off the main
   thread. Messages: { requestId, type: 'optimizeDatacenterDesign' | 'compareDatacenterArchitectures'
   | 'optimizeDatacenterSite' | 'solarSweepPoint', state, options } (optimizeDatacenterSite takes
   options.siteId, solarSweepPoint options.point { kind, id, pricePerW }) -> { requestId, messageType: 'progress' | 'result' | 'error', ... }. The plant
   builder's optimizer-worker.js is separate and unchanged. */

import { compareArchitectures, optimizeDatacenterDesign, optimizeForSite, solarSweepPoint } from '../model/datacenter/index.js';

const HANDLERS = {
  optimizeDatacenterDesign,
  compareDatacenterArchitectures: compareArchitectures,
  optimizeDatacenterSite: (state, { siteId, ...options }) => optimizeForSite(state, siteId, options),
  solarSweepPoint: (state, { point, ...options }) => solarSweepPoint(state, point, options),
};

self.addEventListener('message', event => {
  const { requestId, type, state, options } = event.data || {};
  const handler = HANDLERS[type];
  if (!handler) return;

  try {
    const result = handler(state, {
      ...(options || {}),
      onProgress(progress) {
        self.postMessage({ requestId, messageType: 'progress', progress });
      },
    });
    self.postMessage({ requestId, messageType: 'result', result });
  } catch (error) {
    self.postMessage({
      requestId,
      messageType: 'error',
      error: { message: error?.message || 'Datacenter optimizer worker failed.' },
    });
  }
});
