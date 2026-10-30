/* NPV-vs-price sensitivity charts, one per product that the current build
   actually sells. NPV is a straight line in a product's price (see
   model/break-even.js), so the x-axis is linear and the zero crossing, the
   break-even price, is marked where the line meets NPV = 0. */

import { solveLinearZero } from '../../model/break-even.js';
import { Calc } from '../../model/index.js';
import { FormatNumbers } from '../format-numbers.js';
import { axisGrid, axisTicks, axisTitle, clearChartUnavailable, ensureChartRuntime } from './chart-utils.js';

const wholeDollarLabel = value => `$${FormatNumbers.fixed(value, 0)}`;
const centsLabel = value => `$${FormatNumbers.fixed(value, 2)}`;
// A break-even beyond this multiple of the top swept price is only named, not plotted.
const MAX_PLOTTED_BREAK_EVEN_MULTIPLE = 4;
const BREAK_EVEN_COLOR = '#e2e8f0';

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
      formatPrice: value => `${centsLabel(value)}/MCF`,
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
      formatPrice: value => `${wholeDollarLabel(value)}/t`,
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
      formatPrice: value => `${centsLabel(value)}/1M`,
    },
  ];
}

/* Break-even on a swept NPV line: the exact zero of the line through the
   sweep's end points (NPV is linear in price). Returns { price, inSweep }
   or null when the line is flat. */
export function findSweepBreakEven(series) {
  const points = (series || []).filter(point => Number.isFinite(point?.x) && Number.isFinite(point?.npv));
  if (points.length < 2) return null;
  const first = points[0];
  const last = points[points.length - 1];
  const price = solveLinearZero(first.x, first.npv, last.x, last.npv);
  if (price === null) return null;
  const xs = points.map(point => point.x);
  return { price, inSweep: price >= Math.min(...xs) && price <= Math.max(...xs) };
}

/** Vertical dashed line + label at the break-even price, or a corner note when it is off the plot. */
const breakEvenMarkerPlugin = {
  id: 'sensitivityBreakEven',
  afterDatasetsDraw(chart, args, options) {
    const { price, text, plotted } = options || {};
    if (!text) return;
    const { ctx, chartArea, scales } = chart;
    ctx.save();
    ctx.font = '9px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillStyle = BREAK_EVEN_COLOR;
    ctx.textBaseline = 'top';
    ctx.strokeStyle = BREAK_EVEN_COLOR;
    ctx.lineWidth = 1;
    const zeroY = scales.y.getPixelForValue(0);
    const zeroVisible = zeroY >= chartArea.top && zeroY <= chartArea.bottom;
    if (zeroVisible) {
      // The NPV = 0 axis, faint, so the crossing reads at a glance.
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.moveTo(chartArea.left, zeroY);
      ctx.lineTo(chartArea.right, zeroY);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    const x = plotted && Number.isFinite(price) ? scales.x.getPixelForValue(price) : NaN;
    if (x >= chartArea.left - 0.5 && x <= chartArea.right + 0.5) {
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(x, chartArea.top);
      ctx.lineTo(x, chartArea.bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      if (zeroVisible) {
        ctx.beginPath();
        ctx.arc(x, zeroY, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      // NPV rises with price, so the line leaves the crossing's top-left and
      // bottom-right clear: label top-left if it fits, else bottom-right.
      if (x - 4 - ctx.measureText(text).width >= chartArea.left) {
        ctx.textAlign = 'right';
        ctx.fillText(text, x - 4, chartArea.top + 2);
      } else {
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText(text, x + 4, chartArea.bottom - 2);
      }
    } else {
      // Off the plot: note it top-left, which a rising line leaves clear.
      ctx.textAlign = 'left';
      ctx.fillText(text, chartArea.left + 4, chartArea.top + 2);
    }
    ctx.restore();
  },
};

function createSensitivityChart(canvas, config, series, breakEven) {
  return new Chart(canvas, {
    type: 'line',
    data: {
      datasets: [
        {
          label: 'NPV',
          data: series.map(point => ({ x: point.x, y: point.npv })),
          borderColor: config.lineColor,
          backgroundColor: config.lineColor,
          // Straight segments: NPV is exactly linear in price.
          tension: 0,
          pointRadius: series.map(point => (point.breakEven ? 0 : 3)),
          borderWidth: 2,
        },
      ],
    },
    plugins: [breakEvenMarkerPlugin],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        sensitivityBreakEven: breakEven,
        tooltip: {
          callbacks: {
            title(items) {
              const x = items[0]?.parsed?.x;
              return Number.isFinite(x) ? config.formatPrice(x) : '';
            },
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
          type: 'linear',
          title: axisTitle(config.axisLabel),
          ticks: axisTicks({ callback: value => config.formatLabel(Number(value)), maxTicksLimit: 8 }),
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

/* Sweep NPV over the config's prices and place the break-even: on the line
   when it falls inside the sweep; otherwise, when it is above zero and
   within a few times the top price, extend the sweep to it with one more
   run so the line actually reaches NPV = 0. */
function buildSensitivitySeries(state, config) {
  let series = Calc.runSensitivity(state, config.paramKey, config.prices);
  const found = findSweepBreakEven(series);
  if (!found) return { series, breakEven: { text: '' } };
  const { price } = found;
  const maxPrice = config.prices[config.prices.length - 1];
  let plotted = found.inSweep;
  if (!plotted && price >= 0 && price <= maxPrice * MAX_PLOTTED_BREAK_EVEN_MULTIPLE) {
    const [extra] = Calc.runSensitivity(state, config.paramKey, [price]);
    if (extra) {
      series = [...series, { ...extra, breakEven: true }].sort((a, b) => a.x - b.x);
      plotted = true;
    }
  }
  let text = `Break-even ${config.formatPrice(price)}`;
  if (price < 0) text = 'Break-even < $0 (NPV > 0 at $0)';
  else if (!plotted) text = `Break-even ${config.formatPrice(price)} (off scale)`;
  return { series, breakEven: { price, plotted, text } };
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

      const { series, breakEven } = buildSensitivitySeries(this.state, config);
      this.charts[config.chartKey] = createSensitivityChart(canvas, config, series, breakEven);
    });

    if (emptyState) emptyState.hidden = visibleChartCount > 0;
  },
};
