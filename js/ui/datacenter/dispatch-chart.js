/* Power dispatch chart (Chart.js): a typical day of a chosen month (MW by hour) or the whole
   year as daily energy (MWh/day), stacked by source. Above zero: what supplies the facility;
   below zero: where surplus goes (battery charging, export, curtailment); the line is the
   facility load. Reads result.dispatch.typicalDays / hourly (full-mode results only). */

import { axisGrid, axisTicks, axisTitle, ensureChartRuntime, legendLabels } from '../charts/chart-utils.js';
import { fixed, formatMW, formatMWh, formatPercent } from './format.js';

export const DISPATCH_SERIES = [
  { key: 'nuclearMW', label: 'Nuclear', color: '#9b7fd1', sign: 1 },
  { key: 'solarMW', label: 'Solar', color: '#e0a83e', sign: 1 },
  { key: 'gridMW', label: 'Grid', color: '#5f7fb8', sign: 1 },
  { key: 'gasMW', label: 'Gas', color: '#c56f3c', sign: 1 },
  { key: 'batteryDischargeMW', label: 'Battery discharge', color: '#4fb39b', sign: 1 },
  { key: 'unservedMW', label: 'Unserved', color: '#e5484d', sign: 1 },
  { key: 'batteryChargeMW', label: 'Battery charging', color: 'rgba(79, 179, 155, 0.45)', sign: -1 },
  { key: 'exportMW', label: 'Export', color: 'rgba(143, 182, 232, 0.6)', sign: -1 },
  { key: 'curtailedMW', label: 'Curtailed', color: 'rgba(107, 114, 128, 0.7)', sign: -1 },
];

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function dayLabels() {
  const labels = [];
  MONTH_DAYS.forEach((days, month) => {
    for (let d = 1; d <= days; d++) labels.push(`${MONTHS[month].slice(0, 3)} ${d}`);
  });
  return labels;
}

function dailySums(series) {
  const days = Math.floor(series.length / 24);
  return Array.from({ length: days }, (_, day) => {
    let sum = 0;
    for (let h = 0; h < 24; h++) sum += series[day * 24 + h];
    return sum;
  });
}

/** { labels, unit, series: { key: values[] }, load: values[] } for a view. */
export function selectDispatchData(dispatch, view) {
  if (view.mode === 'year') {
    const hourly = dispatch?.hourly;
    if (!hourly) return null;
    const series = Object.fromEntries(DISPATCH_SERIES.map(({ key }) => [key, dailySums(hourly[key] || [])]));
    return { labels: dayLabels(), unit: 'MWh/day', series, load: dailySums(hourly.loadMW) };
  }
  const days = dispatch?.typicalDays;
  if (!days) return null;
  const pick = key => {
    const entry = days[key];
    if (!entry) return new Array(24).fill(0);
    return view.month === 'avg' ? entry.average : entry.byMonth[Number(view.month)];
  };
  return {
    labels: Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`),
    unit: 'MW',
    series: Object.fromEntries(DISPATCH_SERIES.map(({ key }) => [key, Array.from(pick(key))])),
    load: Array.from(pick('loadMW')),
  };
}

function describeDispatch(r, view) {
  const a = r.dispatch.annual;
  const shares = Object.entries(a.sharesOfServed)
    .filter(([, share]) => share > 0.0005)
    .sort((x, y) => y[1] - x[1])
    .map(([source, share]) => `${source} ${formatPercent(share * 100, share < 0.01 ? 2 : 0)}`)
    .join(', ');
  const when = view.mode === 'year'
    ? 'Daily energy over the year'
    : `Typical ${view.month === 'avg' ? 'day, averaged over the year' : `${MONTHS[Number(view.month)]} day`} (local standard time; the model repeats one typical day per month)`;
  const parts = [
    `${when}. Above zero: supply by source; below zero: surplus to battery charging, export or curtailment; the line is the facility load (peak ${formatMW(r.load.peakFacilityMW)}).`,
    shares ? `Share of load served: ${shares}.` : '',
  ];
  if (a.unservedMWh > 0) parts.push(`Unserved: ${formatMWh(a.unservedMWh)}/yr over ${fixed(r.reliability.unservedHours, 0)} hours.`);
  if (a.curtailedMWh > 0) parts.push(`Curtailed: ${formatMWh(a.curtailedMWh)}/yr.`);
  return parts.filter(Boolean).join(' ');
}

export const dispatchChartMethods = {
  bindDispatchControls() {
    this.dispatchView = { mode: 'day', month: '6' };
    const mode = document.getElementById('dispatchMode');
    const month = document.getElementById('dispatchMonth');
    if (mode) {
      mode.value = this.dispatchView.mode;
      mode.addEventListener('change', () => {
        this.dispatchView.mode = mode.value;
        if (month) month.disabled = mode.value === 'year';
        this.updateDispatchChart(this.lastResults);
      });
    }
    if (month) {
      month.value = this.dispatchView.month;
      month.addEventListener('change', () => {
        this.dispatchView.month = month.value;
        this.updateDispatchChart(this.lastResults);
      });
    }
  },

  updateDispatchChart(r) {
    const canvas = document.getElementById('dispatchChart');
    if (!r || !canvas) return;
    const view = this.dispatchView || { mode: 'day', month: 'avg' };
    const data = selectDispatchData(r.dispatch, view);
    const note = document.getElementById('dispatchNote');
    if (note) note.textContent = data ? describeDispatch(r, view) : '';
    if (!data || !ensureChartRuntime(this, 'dispatch', 'dispatchChart')) return;

    const datasets = DISPATCH_SERIES
      .filter(({ key }) => data.series[key].some(value => Math.abs(value) > 1e-6))
      .map(series => ({
        type: 'bar',
        label: series.label,
        data: data.series[series.key].map(value => value * series.sign),
        backgroundColor: series.color,
        borderWidth: 0,
        stack: 'energy',
        barPercentage: 1,
        categoryPercentage: view.mode === 'year' ? 1 : 0.92,
        order: 2,
      }));
    datasets.push({
      type: 'line',
      label: 'Facility load',
      data: data.load,
      borderColor: '#e2e8f0',
      borderWidth: 1.5,
      pointRadius: 0,
      stack: 'load',
      order: 1,
      fill: false,
      stepped: view.mode === 'day' ? 'middle' : false,
    });

    const key = JSON.stringify([view, data.unit, datasets.map(d => [d.label, d.data])]);
    if (this.chartKeys.dispatch === key && this.charts.dispatch) return;
    if (this.charts.dispatch) this.charts.dispatch.destroy();
    const format = value => (data.unit === 'MW' ? formatMW(Math.abs(value)) : formatMWh(Math.abs(value)));
    this.charts.dispatch = new Chart(canvas, {
      data: { labels: data.labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { labels: legendLabels({ boxWidth: 10 }) },
          tooltip: {
            filter: ctx => Math.abs(ctx.parsed.y || 0) > 1e-6,
            callbacks: { label: ctx => `${ctx.dataset.label}: ${format(ctx.parsed.y)}${data.unit === 'MW' ? '' : '/day'}` },
          },
        },
        scales: {
          x: { stacked: true, ticks: axisTicks({ maxTicksLimit: 12 }), grid: axisGrid(), title: axisTitle(view.mode === 'year' ? 'Day of year' : 'Hour (local standard time)') },
          y: { stacked: true, ticks: axisTicks({ callback: value => format(Number(value)) }), grid: axisGrid(), title: axisTitle(data.unit) },
        },
      },
    });
    this.chartKeys.dispatch = key;
  },
};
