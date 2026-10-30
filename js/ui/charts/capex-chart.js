/* Installed CAPEX breakdown doughnut */

import { FormatNumbers } from '../format-numbers.js';
import { CHART_THEME, ensureChartRuntime } from './chart-utils.js';

const OTHER_SLICE_COLOR = '#64748b';

/** Merge CAPEX segments under 2% of total into "Other" when there are many categories. */
function compactCapexChartData(labels, values, colors) {
  const n = labels.length;
  if (n <= 1) return { labels, values, colors };
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0) return { labels, values, colors };
  const minVal = total * 0.02;
  const kept = [];
  let other = 0;
  for (let i = 0; i < n; i++) {
    const v = values[i];
    if (v < minVal && n >= 5) {
      other += v;
    } else {
      kept.push({ label: labels[i], value: v, color: colors[i] });
    }
  }
  if (other > 0) {
    kept.push({ label: 'Other', value: other, color: OTHER_SLICE_COLOR });
  }
  return {
    labels: kept.map(x => x.label),
    values: kept.map(x => x.value),
    colors: kept.map(x => x.color),
  };
}

// Fixed colors for the core items (solar by its parts); exploratory routes
// cycle through EXPLORATORY_COLORS.
const CAPEX_COLORS = {
  solarModules: '#f59e0b',
  solarBos: '#fbbf24',
  solarSitePrep: '#22c55e',
  land: '#84cc16',
  battery: '#6366f1',
  ai: '#38bdf8',
  electrolyzer: '#06b6d4',
  dac: '#8b5cf6',
  sabatier: '#10b981',
  methanol: '#f97316',
  feedBuffers: '#a3a3a3',
};
const EXPLORATORY_COLORS = ['#e879f9', '#f472b6', '#fb7185', '#c084fc', '#2dd4bf', '#facc15', '#a78bfa', '#4ade80'];

/** Doughnut slices from economics.capexItems (solar split into its parts);
    they sum to economics.totalCapex. */
export function capexChartSlices(economics) {
  let exploratoryIndex = 0;
  const slices = (economics.capexItems || [])
    .flatMap(item => item.parts || [item])
    .filter(item => item.capex > 0)
    .map(item => ({
      label: item.label,
      value: item.capex,
      color: CAPEX_COLORS[item.key] || EXPLORATORY_COLORS[exploratoryIndex++ % EXPLORATORY_COLORS.length],
    }));
  return compactCapexChartData(
    slices.map(slice => slice.label),
    slices.map(slice => slice.value),
    slices.map(slice => slice.color)
  );
}

export const capexChartMethods = {
  updateEconChart(r) {
    if (!ensureChartRuntime(this, 'econ', 'econChart')) return;

    const compact = capexChartSlices(r.economics);
    const borderW = compact.labels.length > 7 ? 1 : 2;

    if (this.charts.econ) this.charts.econ.destroy();
    this.charts.econ = new Chart(document.getElementById('econChart'), {
      type: 'doughnut',
      data: {
        labels: compact.labels,
        datasets: [{
          data: compact.values,
          backgroundColor: compact.colors,
          borderColor: '#1a2236',
          borderWidth: borderW,
          hoverBorderWidth: borderW,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { bottom: 2 } },
        plugins: {
          legend: {
            position: 'bottom',
            align: 'center',
            labels: {
              color: CHART_THEME.legendText,
              font: { size: 9 },
              padding: 8,
              boxWidth: 10,
              boxHeight: 10,
            },
          },
          title: {
            display: true,
            text: 'Installed CAPEX Breakdown',
            color: CHART_THEME.legendText,
            font: { size: 11 },
            padding: { bottom: 10 },
          },
          tooltip: {
            callbacks: {
              label(ctx) {
                return `${ctx.label}: ${FormatNumbers.formatMoney(ctx.raw)}`;
              },
            },
          },
        },
      },
    });
  },
};
