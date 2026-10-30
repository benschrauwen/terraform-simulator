/* "What drives NPV": one-at-a-time tornado. Each row is one input moved from
   its low to its high bound (js/data/sensitivity-variables.js) with every
   other input at its current value; bars run from the current NPV to the NPV
   at each bound. Reruns the model (js/model/tornado.js), so the App refreshes
   it with the debounced sensitivity update rather than on every slider tick. */

import { formatSensitivityValue } from '../../data/sensitivity-variables.js';
import { runTornado } from '../../model/tornado.js';
import { FormatNumbers } from '../format-numbers.js';
import {
  CHART_THEME,
  axisGrid,
  axisTicks,
  axisTitle,
  clearChartUnavailable,
  ensureChartRuntime,
  legendLabels,
} from './chart-utils.js';

const LOW_COLOR = '#38bdf8';
const HIGH_COLOR = '#f59e0b';
const BASE_LINE_COLOR = '#e2e8f0';
const ZERO_LINE_COLOR = '#f87171';
const ROW_LABEL_COLOR = '#cbd5e1';
const LABEL_BACKDROP_COLOR = '#13171b';
const ROW_HEIGHT_PX = 34;
const BAR_THICKNESS_PX = 12;
const CHART_CHROME_PX = 70;

/**
 * Floating-bar spans for one row. Each bar runs from the base NPV to the NPV
 * at its bound; when both bounds land on the same side of the base, the
 * farther one starts where the nearer one ends so neither hides the other.
 */
export function getTornadoSpans(bar, baseNpv) {
  const lowSide = Math.sign(bar.lowNpv - baseNpv);
  const highSide = Math.sign(bar.highNpv - baseNpv);
  if (lowSide === 0 || highSide === 0 || lowSide !== highSide) {
    return { low: [baseNpv, bar.lowNpv], high: [baseNpv, bar.highNpv] };
  }
  const lowIsNearer = Math.abs(bar.lowNpv - baseNpv) <= Math.abs(bar.highNpv - baseNpv);
  return lowIsNearer
    ? { low: [baseNpv, bar.lowNpv], high: [bar.lowNpv, bar.highNpv] }
    : { low: [bar.highNpv, bar.lowNpv], high: [baseNpv, bar.highNpv] };
}

/** Row label, e.g. "Methane price ($10/MCF → $30/MCF)": the input, then its low → high bounds. */
export function getTornadoRowLabel(bar) {
  return `${bar.label} (${getTornadoRange(bar)})`;
}

function getTornadoRange(bar) {
  const range = `${formatSensitivityValue(bar.variable, bar.lowValue)} → ${formatSensitivityValue(bar.variable, bar.highValue)}`;
  const position = getCurrentPosition(bar);
  return position ? `${range} · now ${position}` : range;
}

/**
 * Where the current value sits when it is on or past a bound, because that
 * side's bar then has no length (moving to that bound changes nothing) or
 * points the "wrong" way. Null when the current value is strictly inside.
 */
export function getCurrentPosition(bar) {
  const current = Number(bar.baseValue);
  const low = Math.min(bar.lowValue, bar.highValue);
  const high = Math.max(bar.lowValue, bar.highValue);
  const tolerance = 1e-9 * Math.max(1, Math.abs(current));
  if (!Number.isFinite(current)) return null;
  if (Math.abs(current - high) <= tolerance) return 'at high';
  if (Math.abs(current - low) <= tolerance) return 'at low';
  if (current > high) return `above (${formatSensitivityValue(bar.variable, current)})`;
  if (current < low) return `below (${formatSensitivityValue(bar.variable, current)})`;
  return null;
}

/** Text clipped with an ellipsis to fit `maxWidth` pixels in the current font. */
function fitText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let end = text.length;
  while (end > 1 && ctx.measureText(`${text.slice(0, end)}…`).width > maxWidth) end -= 1;
  return `${text.slice(0, end)}…`;
}

/* Row labels sit above their bars across the full plot width, so the bars
   keep the narrow results panel's width instead of sharing it with a
   y-axis label column. */
const rowLabelPlugin = {
  id: 'tornadoRowLabels',
  afterDatasetsDraw(chart, args, options) {
    const { ctx, chartArea, scales } = chart;
    const yScale = scales.y;
    if (!yScale) return;
    const width = chartArea.right - chartArea.left;
    ctx.save();
    ctx.font = '9px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.textBaseline = 'bottom';
    (options.bars || []).forEach((bar, index) => {
      const y = yScale.getPixelForValue(index) - BAR_THICKNESS_PX / 2 - 2;
      const name = fitText(ctx, bar.label, width);
      const textWidth = Math.min(width, ctx.measureText(`${name}  ${getTornadoRange(bar)}`).width);
      // Mask the reference lines behind the text (card background, --bg-surface).
      ctx.fillStyle = LABEL_BACKDROP_COLOR;
      ctx.fillRect(chartArea.left, y - 10, textWidth + 2, 10);
      ctx.fillStyle = ROW_LABEL_COLOR;
      ctx.fillText(name, chartArea.left, y);
      const nameWidth = ctx.measureText(`${name}  `).width;
      if (name !== bar.label || nameWidth >= width) return;
      ctx.fillStyle = CHART_THEME.axisText;
      ctx.fillText(fitText(ctx, getTornadoRange(bar), width - nameWidth), chartArea.left + nameWidth, y);
    });
    ctx.restore();
  },
};

/** Vertical reference lines at the current NPV and, when it is on the axis, NPV = 0. */
const referenceLinePlugin = {
  id: 'tornadoReferenceLines',
  beforeDatasetsDraw(chart, args, options) {
    const { ctx, chartArea, scales } = chart;
    const xScale = scales.x;
    if (!xScale) return;
    const lines = [
      { value: options.baseNpv, color: BASE_LINE_COLOR, dash: [] },
      { value: 0, color: ZERO_LINE_COLOR, dash: [4, 3] },
    ];
    ctx.save();
    lines.forEach(line => {
      if (!Number.isFinite(line.value) || line.value < xScale.min || line.value > xScale.max) return;
      const x = xScale.getPixelForValue(line.value);
      ctx.strokeStyle = line.color;
      ctx.setLineDash(line.dash);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, chartArea.top);
      ctx.lineTo(x, chartArea.bottom);
      ctx.stroke();
    });
    ctx.restore();
  },
};

function describeBound(bar, which) {
  const value = which === 'low' ? bar.lowValue : bar.highValue;
  const npv = which === 'low' ? bar.lowNpv : bar.highNpv;
  return `${which === 'low' ? 'Low' : 'High'}: ${formatSensitivityValue(bar.variable, value)} → NPV ${FormatNumbers.formatMoney(npv)}`;
}

function createTornadoChart(canvas, tornado) {
  const { bars, baseNpv } = tornado;
  const spans = bars.map(bar => getTornadoSpans(bar, baseNpv));
  return new Chart(canvas, {
    type: 'bar',
    data: {
      labels: bars.map(getTornadoRowLabel),
      datasets: [
        {
          label: 'Input at low bound',
          bound: 'low',
          data: spans.map(span => span.low),
          backgroundColor: LOW_COLOR,
          borderSkipped: false,
          grouped: false,
          barThickness: BAR_THICKNESS_PX,
        },
        {
          label: 'Input at high bound',
          bound: 'high',
          data: spans.map(span => span.high),
          backgroundColor: HIGH_COLOR,
          borderSkipped: false,
          grouped: false,
          barThickness: BAR_THICKNESS_PX,
        },
      ],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { position: 'bottom', labels: legendLabels({ boxWidth: 10 }) },
        tornadoReferenceLines: { baseNpv },
        tornadoRowLabels: { bars },
        tooltip: {
          callbacks: {
            title(items) {
              return bars[items[0]?.dataIndex]?.label || '';
            },
            label(ctx) {
              const bar = bars[ctx.dataIndex];
              return bar ? describeBound(bar, ctx.dataset.bound) : '';
            },
            afterBody(items) {
              const bar = bars[items[0]?.dataIndex];
              if (!bar) return '';
              return `Current: ${formatSensitivityValue(bar.variable, bar.baseValue)} → NPV ${FormatNumbers.formatMoney(baseNpv)}`;
            },
          },
        },
      },
      scales: {
        x: {
          beginAtZero: false,
          grace: '4%',
          title: axisTitle('NPV ($)'),
          ticks: axisTicks({ callback: value => FormatNumbers.formatMoney(Number(value)), maxTicksLimit: 6 }),
          grid: axisGrid(),
        },
        // Labels are drawn above each bar by rowLabelPlugin.
        y: {
          ticks: { display: false },
          grid: { display: false },
        },
      },
    },
    plugins: [referenceLinePlugin, rowLabelPlugin],
  });
}

function describeTopDrivers(tornado) {
  const top = tornado.bars.slice(0, 3).map(bar => `${bar.label} (${FormatNumbers.formatMoney(bar.swing)} swing)`);
  return `NPV tornado. Current NPV ${FormatNumbers.formatMoney(tornado.baseNpv)}. Largest drivers: ${top.join(', ')}.`;
}

export const tornadoChartMethods = {
  updateTornadoChart(r = this.lastResults) {
    const card = document.getElementById('tornadoCard');
    const canvas = document.getElementById('tornadoChart');

    if (this.charts.tornado) {
      this.charts.tornado.destroy();
      delete this.charts.tornado;
    }
    if (!card || !canvas) return;

    // A page with its own model (the datacenter app) supplies runTornadoModel.
    const runModel = this.runTornadoModel ? state => this.runTornadoModel(state) : runTornado;
    const tornado = r ? runModel(r.state || this.state) : null;
    this.lastTornado = tornado;
    card.hidden = !tornado?.bars.length;
    if (card.hidden) {
      clearChartUnavailable('tornadoChart');
      return;
    }
    if (!ensureChartRuntime(this, 'tornado', 'tornadoChart')) return;

    const wrapper = canvas.closest('.chart-wrapper');
    if (wrapper) wrapper.style.height = `${tornado.bars.length * ROW_HEIGHT_PX + CHART_CHROME_PX}px`;
    canvas.setAttribute('aria-label', describeTopDrivers(tornado));
    this.charts.tornado = createTornadoChart(canvas, tornado);
  },
};
