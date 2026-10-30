/* Chart mixins attached to App, one module per chart.

   Adding a chart: a module here exporting { updateXChart(r) { ... } } that
   draws into its own <canvas> (via ensureChartRuntime), an entry in
   RESULT_CHARTS, and the canvas in index.html. App.recalculate calls
   updateCharts(r) once per result. The sensitivity charts rerun the model
   and are debounced by the App, so they are mixed in but not listed. */

import { annualDispatchChartMethods } from './annual-dispatch-chart.js';
import { capexChartMethods } from './capex-chart.js';
import { economicsTimelineChartMethods } from './economics-timeline-chart.js';
import { marketLadderChartMethods } from './market-ladder-chart.js';
import { powerChartMethods } from './power-chart.js';
import { sensitivityChartMethods } from './sensitivity-chart.js';

// [method mixin, name of its per-result update method], in draw order.
export const RESULT_CHARTS = [
  [powerChartMethods, 'updatePowerChart'],
  [annualDispatchChartMethods, 'updateAnnualDispatchChart'],
  [economicsTimelineChartMethods, 'updateEconomicsTimelineChart'],
  [marketLadderChartMethods, 'updateMarketLadderChart'],
  [capexChartMethods, 'updateEconChart'],
];

export const chartMethods = Object.assign({}, ...RESULT_CHARTS.map(([methods]) => methods), sensitivityChartMethods, {
  /** Redraw every per-result chart from one calculation result. */
  updateCharts(r) {
    RESULT_CHARTS.forEach(([, update]) => this[update](r));
  },
});
