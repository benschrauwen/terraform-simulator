/* Annual dispatch chart: AI vs chemical energy per day/cycle across the modeled year */

import { FormatNumbers } from '../format-numbers.js';
import { axisGrid, axisTicks, axisTitle, ensureChartRuntime, legendLabels } from './chart-utils.js';

const capitalize = text => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

function describeAnnualDispatch(r, { useFullOrbitalMarsSeries, useRepresentativeCycleSeries }) {
  const isEarth = r.solar.bodyKey === 'earth';
  if (r.ai.enabled) {
    if (isEarth) return 'Daily delivered energy over the modeled year. AI gets first call on solar and battery support; chemistry only runs on the residual energy left over.';
    if (useFullOrbitalMarsSeries) return 'Sol-by-sol delivered energy over one modeled Mars year. AI gets first call on solar and battery support; chemistry only runs on the residual energy left over. Annual economics elsewhere remain normalized to an Earth year.';
    if (useRepresentativeCycleSeries) return 'Representative full-cycle delivered energy over the modeled Earth year. The current off-Earth solar model uses an average local cycle, so the chart repeats the modeled cycle-equivalent energy instead of implying seasonality.';
    return 'Cycle-by-cycle delivered energy over the modeled Earth year. The off-Earth seasonal shape reflects the modeled orbital geometry before AI claims first call on the power.';
  }
  if (isEarth) return 'Daily seasonal solar energy over the modeled year. Enable AI Compute to see how the datacenter carves out a high-reliability constant load before chemistry absorbs the residual.';
  if (useFullOrbitalMarsSeries) return 'Sol-by-sol solar energy over one modeled Mars year. Annual economics elsewhere remain normalized to an Earth year.';
  if (useRepresentativeCycleSeries) return 'Representative full-cycle solar energy over the modeled Earth year. The current off-Earth solar model uses an average local cycle, so the chart repeats the modeled cycle-equivalent energy instead of implying seasonality.';
  return 'Cycle-by-cycle solar energy over the modeled Earth year. The off-Earth seasonal shape reflects the modeled orbital geometry before any AI load is applied.';
}

/** Daily (or per-cycle) AI and chemical energy in MWh, with labels, ready to plot. */
function selectAnnualDispatchSeries(r) {
  const dispatch = r.annualDispatch || {};
  const displayDayLabels = dispatch.displayDayLabels || [];
  const displayAiSeriesKWh = dispatch.displayDailyAiKWh || [];
  const displayChemicalSeriesKWh = dispatch.displayDailyChemicalKWh || [];
  const useDisplaySeries = displayDayLabels.length > 0 &&
    displayDayLabels.length === displayAiSeriesKWh.length &&
    displayDayLabels.length === displayChemicalSeriesKWh.length;
  const rawDayLabels = useDisplaySeries ? displayDayLabels : (dispatch.dayLabels || []);
  const rawAiSeries = (useDisplaySeries ? displayAiSeriesKWh : (dispatch.dailyAiKWh || [])).map(value => value / 1000);
  const rawChemicalSeries = (useDisplaySeries ? displayChemicalSeriesKWh : (dispatch.dailyChemicalKWh || [])).map(value => value / 1000);

  const useFullOrbitalMarsSeries = r.solar.bodyKey === 'mars' &&
    (useDisplaySeries || dispatch.dispatchBasisLabel === 'orbital-year');
  const useRepresentativeCycleSeries = r.solar.bodyKey !== 'earth' && !r.annualSolar?.seasonalVariation;
  const hideTrailingPartial = !useFullOrbitalMarsSeries &&
    r.solar.bodyKey !== 'earth' &&
    rawDayLabels.length > 1 &&
    /\(partial\)$/.test(String(rawDayLabels[rawDayLabels.length - 1] || ''));
  const trim = series => (hideTrailingPartial ? series.slice(0, -1) : series);

  const labels = trim(rawDayLabels).map(label => {
    const match = /^Day (\d+)$/.exec(String(label));
    if (match) return `Day ${FormatNumbers.fixed(parseInt(match[1], 10), 0)}`;
    return label;
  });
  const aiSeries = trim(rawAiSeries);
  const chemicalSeries = trim(rawChemicalSeries);

  // Off-Earth average-cycle models have no seasonality: show the mean cycle (skipping the warm-up cycle).
  const representativeSliceStart = useRepresentativeCycleSeries && aiSeries.length > 1 ? 1 : 0;
  const representativeMean = series => {
    const source = series.slice(representativeSliceStart);
    if (!source.length) return 0;
    return source.reduce((sum, value) => sum + value, 0) / source.length;
  };
  const flatten = series => (useRepresentativeCycleSeries ? series.map(() => representativeMean(series)) : series);

  return {
    labels,
    aiSeries: flatten(aiSeries),
    chemicalSeries: flatten(chemicalSeries),
    useFullOrbitalMarsSeries,
    useRepresentativeCycleSeries,
  };
}

function areaLine(label, data, borderColor, backgroundColor) {
  return { label, data, borderColor, backgroundColor, fill: true, tension: 0.25, pointRadius: 0, borderWidth: 2 };
}

export const annualDispatchChartMethods = {
  updateAnnualDispatchChart(r) {
    const series = selectAnnualDispatchSeries(r);
    const { labels } = series;
    const labelUnit = r.solar.bodyKey === 'earth' ? 'day' : r.solar.cycleUnitCompact;
    const xAxisTitle = series.useFullOrbitalMarsSeries
      ? 'Sol of Mars year'
      : (r.solar.bodyKey === 'earth'
          ? 'Day of year'
          : `${capitalize(String(r.solar.cycleUnitCompact || 'cycle'))} of year`);
    const yAxisTitle = `MWh/${labelUnit}`;

    const annualDispatchNote = document.getElementById('annualDispatchNote');
    if (annualDispatchNote) annualDispatchNote.textContent = describeAnnualDispatch(r, series);

    const chartKey = JSON.stringify({
      labels,
      aiEnabled: r.ai.enabled,
      aiSeries: series.aiSeries,
      chemicalSeries: series.chemicalSeries,
    });
    if (!ensureChartRuntime(this, 'annualDispatch', 'annualDispatchChart')) return;
    if (this.chartKeys.annualDispatch === chartKey && this.charts.annualDispatch) return;

    const datasets = [
      areaLine(`AI energy (MWh/${labelUnit})`, series.aiSeries, '#38bdf8', 'rgba(56, 189, 248, 0.2)'),
      areaLine(`Chemical energy (MWh/${labelUnit})`, series.chemicalSeries, '#10b981', 'rgba(16, 185, 129, 0.18)'),
    ];

    if (!this.charts.annualDispatch) {
      this.charts.annualDispatch = new Chart(document.getElementById('annualDispatchChart'), {
        type: 'line',
        data: { labels, datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { labels: legendLabels() },
            tooltip: {
              callbacks: {
                label(ctx) {
                  const y = ctx.parsed.y;
                  if (!Number.isFinite(y)) return ctx.dataset.label;
                  return `${ctx.dataset.label}: ${FormatNumbers.fixed(y, 2)}`;
                },
              },
            },
          },
          scales: {
            x: {
              ticks: axisTicks({ maxTicksLimit: 12 }),
              grid: axisGrid(),
              title: axisTitle(xAxisTitle),
            },
            y: {
              ticks: axisTicks({ callback: v => FormatNumbers.fixed(v, 2) }),
              grid: axisGrid(),
              beginAtZero: true,
              title: axisTitle(yAxisTitle),
            },
          },
        },
      });
    } else {
      this.charts.annualDispatch.data.labels = labels;
      this.charts.annualDispatch.data.datasets = datasets;
      this.charts.annualDispatch.options.scales.x.title.text = xAxisTitle;
      this.charts.annualDispatch.options.scales.y.title.text = yAxisTitle;
      this.charts.annualDispatch.update();
    }

    this.chartKeys.annualDispatch = chartKey;
  },
};
