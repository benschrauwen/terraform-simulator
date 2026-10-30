/* Chart mixins attached to App, one module per chart.

   Adding a chart: a module here exporting { updateXChart(r) { ... } } that
   draws into its own <canvas> (via ensureChartRuntime), an entry in
   RESULT_CHARTS, and the canvas in index.html. App.recalculate calls
   updateCharts(r) once per result. The sensitivity charts (price curves and
   the NPV tornado) rerun the model and are debounced by the App through
   updateSensitivityCharts, so they are mixed in but not listed. */

import { annualDispatchChartMethods } from './annual-dispatch-chart.js';
import { capexChartMethods } from './capex-chart.js';
import { economicsTimelineChartMethods } from './economics-timeline-chart.js';
import { marketLadderChartMethods } from './market-ladder-chart.js';
import { powerChartMethods } from './power-chart.js';
import { sensitivityChartMethods } from './sensitivity-chart.js';
import { tornadoChartMethods } from './tornado-chart.js';

// [method mixin, name of its per-result update method], in draw order.
export const RESULT_CHARTS = [
  [powerChartMethods, 'updatePowerChart'],
  [annualDispatchChartMethods, 'updateAnnualDispatchChart'],
  [economicsTimelineChartMethods, 'updateEconomicsTimelineChart'],
  [marketLadderChartMethods, 'updateMarketLadderChart'],
  [capexChartMethods, 'updateEconChart'],
];

export const chartMethods = Object.assign({}, ...RESULT_CHARTS.map(([methods]) => methods), sensitivityChartMethods, tornadoChartMethods, {
  /** Redraw every per-result chart from one calculation result. */
  updateCharts(r) {
    RESULT_CHARTS.forEach(([, update]) => this[update](r));
  },

  /** Redraw the model-rerunning sensitivity charts (called debounced by the App). */
  updateSensitivityCharts(r) {
    this.updateTornadoChart(r);
    this.updateSensitivityChart(r);
  },
});
