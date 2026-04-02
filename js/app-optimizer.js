/* Optimizer helpers attached to App */

const APP_OPTIMIZER_WORKER_VERSION = '20260402-maintainability';

const APP_IRR_OPTIMIZER_BUTTONS = [
  {
    buttonId: 'optimizeBatteryCapacity',
    inputId: 'batteryCapacity',
    stateKey: 'batteryCapacityMWh',
    maxCoarseSamples: 257,
    maxTopRegions: 5,
  },
  {
    buttonId: 'optimizeChemicalSizing',
    inputId: 'chemicalSizingPercent',
    stateKey: 'chemicalSizingPercent',
    maxCoarseSamples: 101,
    maxTopRegions: 5,
  },
  {
    buttonId: 'optimizeMethaneFeedstockSplit',
    inputId: 'methaneFeedstockSplit',
    stateKey: 'methaneFeedstockSplit',
    maxCoarseSamples: 101,
    maxTopRegions: 5,
  },
];

const AppOptimizerMethods = {
  bindOptimizeButtons() {
    APP_IRR_OPTIMIZER_BUTTONS.forEach(({ buttonId, ...options }) => {
      AppOptimizerMethods.bindIrrOptimizerButton.call(this, buttonId, options);
    });
  },

  bindIrrOptimizerButton(buttonId, options) {
    const button = document.getElementById(buttonId);
    if (!button) return;
    AppOptimizerMethods.captureOptimizerButtonDefaults.call(this, button);

    button.addEventListener('click', async event => {
      event.preventDefault();
      if (button.disabled) return;

      button.disabled = true;
      AppOptimizerMethods.setOptimizerButtonProgress.call(this, button, { percent: 0, stage: 'start' });
      try {
        await new Promise(resolve => window.requestAnimationFrame(resolve));
        const bestValue = await AppOptimizerMethods.findBestRangeValueForIrr.call(
          this,
          options,
          progress => AppOptimizerMethods.setOptimizerButtonProgress.call(this, button, progress)
        );
        if (!Number.isFinite(bestValue)) return;

        const input = document.getElementById(options.inputId);
        if (!input) return;

        input.value = String(bestValue);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
      } finally {
        button.disabled = false;
        AppOptimizerMethods.resetOptimizerButton.call(this, button);
      }
    });
  },

  captureOptimizerButtonDefaults(button) {
    if (!button) return;
    if (!button.dataset.defaultLabel) button.dataset.defaultLabel = (button.textContent || '').trim() || 'optimize';
    if (!button.dataset.defaultTitle) button.dataset.defaultTitle = button.getAttribute('title') || '';
  },

  setOptimizerButtonProgress(button, progress = {}) {
    if (!button) return;
    AppOptimizerMethods.captureOptimizerButtonDefaults.call(this, button);

    const defaultLabel = button.dataset.defaultLabel || 'optimize';
    const boundedPercent = Number.isFinite(progress.percent)
      ? Math.max(0, Math.min(100, Math.round(progress.percent)))
      : null;

    button.dataset.optimizing = 'true';
    if (boundedPercent === null) {
      button.style.removeProperty('--optimize-progress');
      button.textContent = '...';
    } else {
      button.style.setProperty('--optimize-progress', `${boundedPercent}%`);
      button.textContent = `${boundedPercent}%`;
    }

    const progressText = boundedPercent === null ? 'in progress' : `${boundedPercent}% complete`;
    button.setAttribute('aria-label', `${defaultLabel} ${progressText}`);
    button.setAttribute('title', `${button.dataset.defaultTitle || defaultLabel} (${progressText})`);
  },

  resetOptimizerButton(button) {
    if (!button) return;
    AppOptimizerMethods.captureOptimizerButtonDefaults.call(this, button);
    button.textContent = button.dataset.defaultLabel || 'optimize';
    button.removeAttribute('data-optimizing');
    button.style.removeProperty('--optimize-progress');
    button.removeAttribute('aria-label');
    if (button.dataset.defaultTitle) button.setAttribute('title', button.dataset.defaultTitle);
    else button.removeAttribute('title');
  },

  async findBestRangeValueForIrr(
    { inputId, stateKey, maxCoarseSamples = 257, maxTopRegions = 5 },
    onProgress = null
  ) {
    const input = document.getElementById(inputId);
    if (!input) return null;

    const min = parseFloat(input.min);
    const max = parseFloat(input.max);
    const step = parseFloat(input.step) || 1;
    if (![min, max, step].every(Number.isFinite) || step <= 0 || max < min) return null;

    const search = {
      stateKey,
      min,
      max,
      step,
      currentValue: parseFloat(input.value),
      maxCoarseSamples,
      maxTopRegions,
    };

    if (typeof Worker === 'function') {
      try {
        const workerResult = await AppOptimizerMethods.requestOptimizerWorkerSearch.call(this, search, onProgress);
        return workerResult?.bestValue ?? null;
      } catch (error) {
        console.warn('Optimizer worker failed, falling back to Calc on the main thread.', error);
      }
    }

    if (typeof Calc.findBestRangeValueForIrr !== 'function') return null;
    const fallbackResult = Calc.findBestRangeValueForIrr(this.state, search, { onProgress });
    return fallbackResult?.bestValue ?? null;
  },

  getOptimizerWorker() {
    if (this.optimizerWorker) return this.optimizerWorker;

    this.optimizerWorker = new Worker(`js/optimizer-worker.js?v=${APP_OPTIMIZER_WORKER_VERSION}`);
    this.optimizerWorker.addEventListener('message', event => {
      const { requestId, messageType, progress, result, error } = event.data || {};
      const pending = this.optimizerRequests.get(requestId);
      if (!pending) return;
      if (messageType === 'progress') {
        pending.onProgress?.(progress || {});
        return;
      }

      this.optimizerRequests.delete(requestId);
      if (error) {
        pending.reject(new Error(error.message || 'Optimizer worker failed.'));
      } else {
        pending.resolve(result || null);
      }
    });
    this.optimizerWorker.addEventListener('error', event => {
      const workerError = event?.error || new Error(event?.message || 'Optimizer worker crashed.');
      this.optimizerRequests.forEach(({ reject }) => reject(workerError));
      this.optimizerRequests.clear();
      this.optimizerWorker = null;
    });

    return this.optimizerWorker;
  },

  requestOptimizerWorkerSearch(search, onProgress = null) {
    const worker = AppOptimizerMethods.getOptimizerWorker.call(this);
    const requestId = ++this.optimizerRequestId;
    return new Promise((resolve, reject) => {
      this.optimizerRequests.set(requestId, { resolve, reject, onProgress });
      worker.postMessage({
        requestId,
        type: 'findBestRangeValueForIrr',
        state: this.state,
        search,
      });
    });
  },
};

window.AppOptimizerMethods = AppOptimizerMethods;
