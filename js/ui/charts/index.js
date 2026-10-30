/* Chart mixins attached to App, one module per chart */

import { annualDispatchChartMethods } from './annual-dispatch-chart.js';
import { capexChartMethods } from './capex-chart.js';
import { economicsTimelineChartMethods } from './economics-timeline-chart.js';
import { powerChartMethods } from './power-chart.js';
import { sensitivityChartMethods } from './sensitivity-chart.js';

export const chartMethods = {
  ...powerChartMethods,
  ...annualDispatchChartMethods,
  ...economicsTimelineChartMethods,
  ...capexChartMethods,
  ...sensitivityChartMethods,
};
