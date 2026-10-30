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

function capexSlices(e) {
  const solarBreakdown = e.capexBreakdown || {};
  return [
    ['Solar modules', solarBreakdown.solarModules || 0, '#f59e0b'],
    ['Solar BOS', solarBreakdown.solarBos || 0, '#fbbf24'],
    ['Site prep', solarBreakdown.solarSitePrep || 0, '#22c55e'],
    ['Land', solarBreakdown.solarLand || 0, '#84cc16'],
    ['Battery', e.capex.battery, '#6366f1'],
    ['AI datacenter', e.capex.ai, '#38bdf8'],
    ['Electrolyzer', e.capex.electrolyzer, '#06b6d4'],
    ['DAC', e.capex.dac, '#8b5cf6'],
    ['Methane', e.capex.sabatier, '#10b981'],
    ['Methanol', e.capex.methanol, '#f97316'],
    ['Feed buffers', e.capex.feedBuffers || 0, '#a3a3a3'],
  ].filter(([, value]) => value > 0);
}

export const capexChartMethods = {
  updateEconChart(r) {
    if (!ensureChartRuntime(this, 'econ', 'econChart')) return;

    const slices = capexSlices(r.economics);
    const compact = compactCapexChartData(
      slices.map(([label]) => label),
      slices.map(([, value]) => value),
      slices.map(([, , color]) => color)
    );
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
