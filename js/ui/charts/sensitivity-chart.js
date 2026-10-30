/* NPV-vs-price sensitivity charts, one per product that the current build actually sells */

import { Calc } from '../../model/index.js';
import { FormatNumbers } from '../format-numbers.js';
import { axisGrid, axisTicks, axisTitle, clearChartUnavailable, ensureChartRuntime } from './chart-utils.js';

const wholeDollarLabel = value => `$${FormatNumbers.fixed(value, 0)}`;

function getSensitivityConfigs(r) {
  return [
    {
      chartKey: 'sensitivityMethane',
      wrapperId: 'sensitivityMethaneCard',
      canvasId: 'sensitivityMethaneChart',
      paramKey: 'methanePrice',
      prices: [2, 3, 4, 6, 8, 10, 15, 20, 25, 30],
      axisLabel: 'Methane price ($/MCF)',
      lineColor: '#10b981',
      active: Boolean(r?.sabatier?.enabled) && (r?.sabatier?.ch4AnnualMCF || 0) > 0,
      formatLabel: wholeDollarLabel,
    },
    {
      chartKey: 'sensitivityMethanol',
      wrapperId: 'sensitivityMethanolCard',
      canvasId: 'sensitivityMethanolChart',
      paramKey: 'methanolPrice',
      prices: [100, 200, 300, 400, 600, 800, 1000, 1200],
      axisLabel: 'Methanol price ($/ton)',
      lineColor: '#f97316',
      active: Boolean(r?.methanol?.enabled) && (r?.methanol?.annualTons || 0) > 0,
      formatLabel: wholeDollarLabel,
    },
    {
      chartKey: 'sensitivityAi',
      wrapperId: 'sensitivityAiCard',
      canvasId: 'sensitivityAiChart',
      paramKey: 'aiTokenPricePerM',
      prices: [0.5, 1, 2, 3, 5, 8, 12, 16],
      axisLabel: 'AI token price ($ / 1M tokens)',
      lineColor: '#38bdf8',
      active: Boolean(r?.ai?.enabled) && (r?.ai?.annualTokensM || 0) > 0,
      formatLabel: value => `$${Number.isInteger(value) ? FormatNumbers.fixed(value, 0) : FormatNumbers.fixed(value, 2)}`,
    },
  ];
}

function createSensitivityChart(canvas, config, series) {
  return new Chart(canvas, {
    type: 'line',
    data: {
      labels: config.prices.map(config.formatLabel),
      datasets: [
        {
          label: 'NPV',
          data: series.map(point => point.npv),
          borderColor: config.lineColor,
          tension: 0.3,
          pointRadius: 3,
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label(ctx) {
              const y = ctx.parsed.y;
              if (!Number.isFinite(y)) return ctx.dataset.label;
              return `${ctx.dataset.label}: ${FormatNumbers.formatMoney(y)}`;
            },
          },
        },
      },
      scales: {
        x: {
          title: axisTitle(config.axisLabel),
          ticks: axisTicks(),
          grid: axisGrid(),
        },
        y: {
          title: axisTitle('NPV ($)'),
          ticks: axisTicks({ callback: value => FormatNumbers.formatMoney(Number(value)) }),
          grid: axisGrid(),
        },
      },
    },
  });
}

export const sensitivityChartMethods = {
  updateSensitivityChart(r = this.lastResults) {
    const emptyState = document.getElementById('sensitivityEmptyState');

    if (this.charts.sensitivity) {
      this.charts.sensitivity.destroy();
      delete this.charts.sensitivity;
    }

    let visibleChartCount = 0;

    getSensitivityConfigs(r).forEach(config => {
      const wrapper = document.getElementById(config.wrapperId);
      const canvas = document.getElementById(config.canvasId);

      if (wrapper) wrapper.hidden = !config.active;
      if (this.charts[config.chartKey]) {
        this.charts[config.chartKey].destroy();
        delete this.charts[config.chartKey];
      }
      if (!config.active || !canvas) {
        clearChartUnavailable(config.canvasId);
        return;
      }

      visibleChartCount += 1;
      if (!ensureChartRuntime(this, config.chartKey, config.canvasId)) return;

      const series = Calc.runSensitivity(this.state, config.paramKey, config.prices);
      this.charts[config.chartKey] = createSensitivityChart(canvas, config, series);
    });

    if (emptyState) emptyState.hidden = visibleChartCount > 0;
  },
};
