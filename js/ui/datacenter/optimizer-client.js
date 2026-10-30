/* Datacenter design optimizer client: runs model/datacenter/optimizer.js in a module worker
   (js/workers/datacenter-optimizer-worker.js) with progress messages, and on the main thread when
   workers are unavailable or the worker fails. Same request/response protocol as the plant
   builder's optimizer client. */

import { compareArchitectures, optimizeDatacenterDesign } from '../../model/datacenter/index.js';

const MAIN_THREAD = {
  optimizeDatacenterDesign,
  compareDatacenterArchitectures: compareArchitectures,
};

export const datacenterOptimizerClientMethods = {
  /**
   * Run `type` ('optimizeDatacenterDesign' | 'compareDatacenterArchitectures') for `state`;
   * resolves with the optimizer result. onProgress({ percent, stage, architecture?, evaluations }).
   */
  async requestDatacenterOptimization(type, state, options = {}, onProgress = null) {
    if (!MAIN_THREAD[type]) throw new Error(`Unknown optimizer request: ${type}`);
    if (typeof Worker === 'function') {
      try {
        return await this.postDatacenterOptimizerRequest(type, state, options, onProgress);
      } catch (error) {
        console.warn('Datacenter optimizer worker failed, running on the main thread.', error);
      }
    }
    return MAIN_THREAD[type](state, { ...options, onProgress });
  },

  getDatacenterOptimizerWorker() {
    if (this.datacenterOptimizerWorker) return this.datacenterOptimizerWorker;
    this.datacenterOptimizerRequests ||= new Map();
    const worker = new Worker(new URL('../../workers/datacenter-optimizer-worker.js', import.meta.url), { type: 'module' });
    worker.addEventListener('message', event => {
      const { requestId, messageType, progress, result, error } = event.data || {};
      const pending = this.datacenterOptimizerRequests.get(requestId);
      if (!pending) return;
      if (messageType === 'progress') {
        pending.onProgress?.(progress || {});
        return;
      }
      this.datacenterOptimizerRequests.delete(requestId);
      if (error) pending.reject(new Error(error.message || 'Datacenter optimizer worker failed.'));
      else pending.resolve(result || null);
    });
    worker.addEventListener('error', event => {
      const workerError = event?.error || new Error(event?.message || 'Datacenter optimizer worker crashed.');
      this.datacenterOptimizerRequests.forEach(({ reject }) => reject(workerError));
      this.datacenterOptimizerRequests.clear();
      this.datacenterOptimizerWorker = null;
    });
    this.datacenterOptimizerWorker = worker;
    return worker;
  },

  postDatacenterOptimizerRequest(type, state, options, onProgress) {
    const worker = this.getDatacenterOptimizerWorker();
    this.datacenterOptimizerRequestId = (this.datacenterOptimizerRequestId || 0) + 1;
    const requestId = this.datacenterOptimizerRequestId;
    return new Promise((resolve, reject) => {
      this.datacenterOptimizerRequests.set(requestId, { resolve, reject, onProgress });
      try {
        worker.postMessage({ requestId, type, state: { ...state }, options });
      } catch (error) {
        this.datacenterOptimizerRequests.delete(requestId);
        reject(error);
      }
    });
  },
};
