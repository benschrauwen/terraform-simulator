/* ============================================
   App — owns the state, boots the UI, and orchestrates recalculation.
   Everything else is mixed in from the focused modules listed at the bottom.
   ============================================ */

import { METHANE_MARKET_PRESETS, PLANETARY_BODIES } from '../data/reference-data.js';
import { Calc } from '../model/index.js';
import { PolicyModel } from '../model/policy.js';
import { DEFAULT_STATE } from '../state/schema.js';
import { chartMethods } from './charts/index.js';
import { controlMethods } from './controls.js';
import { dayViewMethods } from './day-view.js';
import { layoutMethods } from './layout.js';
import { moduleControlMethods } from './module-controls.js';
import { optimizerMethods } from './optimizer-client.js';
import { rendererMethods } from './renderers/index.js';
import { selectOptionMethods } from './select-options.js';
import { shareMethods } from './share.js';
import { siteControlMethods } from './site-controls.js';
import { siteMapMethods } from './site-map.js';
import { solarCostControlMethods } from './solar-cost-controls.js';
import { sliderMarkerMethods } from './slider-markers.js';
import { tooltipMethods } from './tooltips.js';
import { uiStateMethods } from './ui-state.js';

export class App {
  constructor() {
    this.state = { ...DEFAULT_STATE };
    this.charts = {};
    this.chartKeys = {};
    this.rangeBindings = new Map();
    this.controlSpecs = [];
    this.sliderMarkerBindings = [];
    this.siteMap = null;
    this.siteMapOverlay = null;
    this.siteMapModuleLayer = null;
    this.siteMapMarker = null;
    this.siteMapTileLayer = null;
    this.optimizerWorker = null;
    this.optimizerRequestId = 0;
    this.optimizerRequests = new Map();
    this.pendingRecalculateFrame = null;
    this.pendingRecalculateOptions = null;
    this.pendingSensitivityTimer = null;
    this.pendingSensitivityResults = null;
    this.sensitivityDebounceMs = 180;
    this.shareFeedbackTimer = null;
    this.shareUrlSyncTimer = null;
    this.pendingShareFeedback = null;
    this.skipInitialSavedSitePersist = true;
    this.init();
  }

  init() {
    this.initSharedState();
    this.populatePresets();
    this.renderPolicyInputs();
    this.renderModuleControls();
    this.renderExploratoryMarketControls();
    this.renderExploratoryOmControls();
    this.bindControls();
    this.bindShareControls();
    this.createHoverTooltip();
    this.bindHoverTooltips();
    this.initSliderMarkers();
    this.bindSectionToggles();
    this.bindMobilePaneControls();
    this.initSiteMap();
    this.syncBatteryEnabledState();
    this.syncStateToControls();
    this.syncDynamicVisibility();
    this.syncDerivedFeedControls();
    this.recalculate();
  }

  getBodyConfig(bodyKey = this.state.body) {
    return PLANETARY_BODIES[bodyKey] || PLANETARY_BODIES.earth;
  }

  getCycleRateUnit(r) {
    return `${r.solar.cycleUnitCompact}`;
  }

  getPolicyConfig() {
    return PolicyModel.getScheme(this.state.policyMode);
  }

  getMethaneMarketConfig() {
    return METHANE_MARKET_PRESETS[this.state.methaneMarketPreset] || METHANE_MARKET_PRESETS.terraform_commodity;
  }

  enforceModuleDependencies() {
    this.state = Calc.enforceModuleDependencies(this.state);
    this.syncStateToControls();
  }

  syncBatteryEnabledState() {
    this.state.batteryEnabled = Number.isFinite(this.state.batteryCapacityMWh) && this.state.batteryCapacityMWh > 1e-9;
  }

  applyNormalizedState(normalizedState) {
    if (!normalizedState || typeof normalizedState !== 'object') return;
    const changed = Object.keys(normalizedState).some(key => this.state[key] !== normalizedState[key]);
    if (!changed) return;
    this.state = { ...normalizedState };
    this.syncStateToControls();
    this.syncDynamicVisibility();
  }

  requestRecalculate(options = {}) {
    const includeSensitivity = options.includeSensitivity !== false;

    if (this.pendingRecalculateOptions) {
      this.pendingRecalculateOptions.includeSensitivity ||= includeSensitivity;
    } else {
      this.pendingRecalculateOptions = { includeSensitivity };
    }

    if (this.pendingRecalculateFrame !== null) return;

    this.pendingRecalculateFrame = window.requestAnimationFrame(() => {
      const pendingOptions = this.pendingRecalculateOptions || {};
      this.pendingRecalculateFrame = null;
      this.pendingRecalculateOptions = null;
      this.recalculate(pendingOptions);
    });
  }

  scheduleSensitivityUpdate(results = this.lastResults) {
    this.pendingSensitivityResults = results;
    clearTimeout(this.pendingSensitivityTimer);
    this.pendingSensitivityTimer = window.setTimeout(() => {
      this.pendingSensitivityTimer = null;
      const pendingResults = this.pendingSensitivityResults || this.lastResults;
      this.pendingSensitivityResults = null;
      if (pendingResults) this.updateSensitivityCharts(pendingResults);
    }, this.sensitivityDebounceMs);
  }

  flushSensitivityUpdate(results = this.lastResults) {
    clearTimeout(this.pendingSensitivityTimer);
    this.pendingSensitivityTimer = null;
    this.pendingSensitivityResults = null;
    if (results) this.updateSensitivityCharts(results);
  }

  showCalculationError(error) {
    console.error('Calculation error', error);
    document.getElementById('metricCapex').textContent = '—';
    document.getElementById('metricRevenue').textContent = '—';
    document.getElementById('metricPayback').textContent = '—';
    document.getElementById('metricIRR').textContent = '—';
    const viability = document.getElementById('metricViability');
    const label = document.getElementById('metricViabilityValue');
    viability.classList.remove('viable', 'marginal', 'not-viable');
    viability.classList.add('not-viable');
    label.textContent = 'Calculation error';
  }

  recalculate(options = {}) {
    const includeSensitivity = options.includeSensitivity !== false;
    if (this.pendingRecalculateFrame !== null) {
      window.cancelAnimationFrame(this.pendingRecalculateFrame);
      this.pendingRecalculateFrame = null;
      this.pendingRecalculateOptions = null;
    }
    this.syncBatteryEnabledState();
    this.syncPlanetaryUI();
    this.syncDerivedFeedControls();
    try {
      const r = Calc.calculateAll(this.state);
      this.applyNormalizedState(r.state);
      this.lastResults = r;
      this.updateInfoDisplays(r);
      this.syncAiSizingControls(r);
      this.updateDiagram(r);
      this.updateSiteMap(r);
      this.updateProduction(r);
      this.updateEconomics(r);
      this.updateHeaderMetrics(r);
      this.updatePlantScore(r);
      this.updateCharts(r);
      if (includeSensitivity) this.flushSensitivityUpdate(r);
      else this.scheduleSensitivityUpdate(r);
      this.updateImpact(r);
      this.scheduleShareStateUrlSync();
    } catch (error) {
      this.showCalculationError(error);
    }
  }
}

// The App behaviour is split across mixin objects; each method runs with the
// App instance as `this`, so they can call one another as `this.method()`.
Object.assign(
  App.prototype,
  shareMethods,
  selectOptionMethods,
  controlMethods,
  siteControlMethods,
  solarCostControlMethods,
  moduleControlMethods,
  optimizerMethods,
  uiStateMethods,
  dayViewMethods,
  layoutMethods,
  tooltipMethods,
  sliderMarkerMethods,
  siteMapMethods,
  rendererMethods,
  chartMethods,
);
