/* ============================================
   DatacenterApp: the Abundance Stack datacenter power & cooling page
   ============================================
   Owns the state (DATACENTER_DEFAULT_STATE, or the share link in the URL
   hash), boots the UI and recalculates. Like the plant builder's App, all
   behaviour lives in mixins Object.assign-ed onto the prototype: the
   generic ones (control binding, section toggles and mobile panes,
   tooltips, slider markers, cash-flow table, economics timeline, tornado
   chart) plus the datacenter ones in this folder. A slider drag recalculates
   once per animation frame; the sensitivity panel (tornado, break-even)
   reruns the model, so it refreshes debounced. */

import { economicsTimelineChartMethods } from '../charts/economics-timeline-chart.js';
import { capexSplitMethods } from './capex-split.js';
import { calculateDatacenterScenario, DATACENTER_DEFAULT_STATE } from '../../model/datacenter/index.js';
import { controlBindingMethods } from '../control-binding.js';
import { layoutMethods } from '../layout.js';
import { cashFlowTableMethods } from '../renderers/cash-flow-table.js';
import { sliderMarkerMethods } from '../slider-markers.js';
import { tooltipMethods } from '../tooltips.js';
import { buildDatacenterCsvHeader, DATACENTER_CASH_FLOW_LABELS, DATACENTER_CASH_FLOW_TOOLTIPS, DATACENTER_TIMELINE_TEXT } from './cash-flow.js';
import { datacenterControlMethods } from './controls.js';
import { dispatchChartMethods } from './dispatch-chart.js';
import { datacenterOptimizerClientMethods } from './optimizer-client.js';
import { datacenterOptimizerMethods } from './optimizer-panel.js';
import { plantMapMethods } from './plant-map.js';
import { resultMethods } from './results.js';
import { datacenterSensitivityMethods } from './sensitivity.js';
import { datacenterShareMethods } from './share.js';
import { DATACENTER_SLIDER_MARKERS } from './slider-markers.js';
import { viewMethods } from './views.js';

export class DatacenterApp {
  constructor() {
    this.state = { ...DATACENTER_DEFAULT_STATE };
    this.charts = {};
    this.chartKeys = {};
    this.rangeBindings = new Map();
    this.controlSpecs = [];
    this.sliderMarkerBindings = [];
    this.pendingRecalculateFrame = null;
    this.pendingRecalculateOptions = null;
    this.pendingSensitivityTimer = null;
    this.sensitivityDebounceMs = 250;
    this.shareFeedbackTimer = null;
    this.shareUrlSyncTimer = null;
    // Hooks read by the shared mixins.
    this.sliderMarkerDefinitions = DATACENTER_SLIDER_MARKERS;
    this.cashFlowColumnTooltips = DATACENTER_CASH_FLOW_TOOLTIPS;
    this.cashFlowColumnLabels = DATACENTER_CASH_FLOW_LABELS;
    this.cashFlowCsvFilePrefix = 'datacenter-cash-flows';
    this.economicsTimelineText = DATACENTER_TIMELINE_TEXT;
    this.init();
  }

  init() {
    this.initSharedState();
    this.renderDatacenterControls();
    this.bindDatacenterControls();
    this.bindShareControls();
    this.bindFlowTabs();
    this.bindLayoutTabs();
    this.bindDispatchControls();
    this.bindCashFlowControls();
    this.bindOptimizerPanel();
    this.createHoverTooltip();
    this.bindHoverTooltips();
    this.initSliderMarkers();
    this.bindSectionToggles();
    this.bindMobilePaneControls();
    this.syncStateToControls();
    this.recalculate();
  }

  buildCashFlowCsvHeader(r, shareUrl) {
    return buildDatacenterCsvHeader(r, shareUrl);
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
      const pending = this.pendingRecalculateOptions || {};
      this.pendingRecalculateFrame = null;
      this.pendingRecalculateOptions = null;
      this.recalculate(pending);
    });
  }

  scheduleSensitivityUpdate(results = this.lastResults, delayMs = this.sensitivityDebounceMs) {
    this.pendingSensitivityResults = results;
    clearTimeout(this.pendingSensitivityTimer);
    this.pendingSensitivityTimer = window.setTimeout(() => {
      this.pendingSensitivityTimer = null;
      const pending = this.pendingSensitivityResults || this.lastResults;
      this.pendingSensitivityResults = null;
      this.updateSensitivityCharts(pending);
    }, delayMs);
  }

  showCalculationError(error) {
    console.error('Calculation error', error);
    const header = document.getElementById('headerMetrics');
    if (header) header.textContent = 'Calculation error';
  }

  recalculate(options = {}) {
    if (this.pendingRecalculateFrame !== null) {
      window.cancelAnimationFrame(this.pendingRecalculateFrame);
      this.pendingRecalculateFrame = null;
      this.pendingRecalculateOptions = null;
    }
    let r;
    try {
      r = calculateDatacenterScenario(this.state);
    } catch (error) {
      this.showCalculationError(error);
      return;
    }
    // The model clamps and fills the state; keep the controls (values, dependent bounds and
    // option labels, visibility) in step with it.
    this.state = { ...r.state };
    this.syncStateToControls();
    this.lastResults = r;
    this.updateInfoBlocks(r);
    this.updateResultsPanel(r);
    this.updatePlantLayout(r);
    this.updateFlows(r);
    this.updateTimeline(r);
    this.updateDispatchChart(r);
    this.updateCapexSplit(r);
    this.updateEconomicsTimelineChart(r);
    this.updateCashFlowTable(r);
    // The sensitivity panel reruns the model: debounced while a slider moves, and deferred
    // a moment otherwise so the first paint is not held up.
    this.scheduleSensitivityUpdate(r, options.includeSensitivity === false ? this.sensitivityDebounceMs : 30);
    this.scheduleShareStateUrlSync();
    this.updateOptimizerStaleness();
  }
}

Object.assign(
  DatacenterApp.prototype,
  controlBindingMethods,
  datacenterControlMethods,
  datacenterShareMethods,
  layoutMethods,
  tooltipMethods,
  sliderMarkerMethods,
  cashFlowTableMethods,
  economicsTimelineChartMethods,
  capexSplitMethods,
  datacenterSensitivityMethods,
  dispatchChartMethods,
  datacenterOptimizerClientMethods,
  datacenterOptimizerMethods,
  viewMethods,
  plantMapMethods,
  resultMethods,
);
