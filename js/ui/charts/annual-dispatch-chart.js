/* Annual dispatch chart: daily energy by use (AI, chemical direct or via battery, unused solar) against the chemical plant's around-the-clock capacity */

import { FormatNumbers } from '../format-numbers.js';
import { axisGrid, axisTicks, axisTitle, ensureChartRuntime, legendLabels } from './chart-utils.js';

const capitalize = text => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
const percent = value => `${FormatNumbers.fixed(value * 100, 0)}%`;
const kw = value => `${FormatNumbers.fixed(value, value < 100 ? 1 : 0)} kW`;

function describeBody(r, { useFullOrbitalMarsSeries, useRepresentativeCycleSeries }) {
  if (r.solar.bodyKey === 'earth') return '';
  if (useFullOrbitalMarsSeries) return ' Sol by sol over one Mars year; annual economics elsewhere are normalized to an Earth year.';
  if (useRepresentativeCycleSeries) return ' The off-Earth model uses an average local cycle, so every cycle repeats the same energy.';
  return ' The off-Earth seasonal shape follows the modeled orbital geometry.';
}

/**
 * Explains the trade-off the chart shows: a plant sized to the sunniest hour
 * follows the sun at low utilization (fine for cheap process equipment), while
 * storage lets a smaller, more expensive plant run closer to its nameplate.
 */
function describeAnnualDispatch(r, series) {
  const dispatch = r.annualDispatch || {};
  const supply = r.chemicalSupply || {};
  const capacityKW = dispatch.chemicalCapacityKW || supply.processPowerKW || 0;
  const utilization = supply.effectiveCF || 0;
  const batteryShare = dispatch.chemicalKWh > 0 ? (dispatch.dischargeThroughputKWh || 0) / dispatch.chemicalKWh : 0;
  const curtailed = isMaterialCurtailment(dispatch);
  const body = describeBody(r, series);

  if (r.ai.enabled) {
    return 'Energy per day: the AI load gets first call on solar and the battery (which serves only the AI load); '
      + `the chemical plant (${kw(capacityKW)}, dashed line = running around the clock) runs on what is left, at ${percent(utilization)} utilization.`
      + (curtailed ? ' Grey is solar neither can use.' : '') + body;
  }

  const plant = `The dashed line is the ${kw(capacityKW)} chemical plant running around the clock; it averages ${percent(utilization)} utilization.`;
  const tradeOff = dispatch.chargeThroughputKWh > 0
    ? ` The battery supplies ${percent(batteryShare)} of the plant's energy, which lets a smaller plant run longer each day. `
      + 'More storage shrinks the plant and raises utilization but adds battery cost; the battery optimizer finds the best balance for IRR.'
    : ' Without storage the plant follows the sun, sized to the sunniest hour: right for cheap process equipment. '
      + 'If process CAPEX is high, a battery lets a smaller plant run more hours; try the battery optimizer to see if it pays.';
  return `Energy into the chemical plant per day, straight from solar or shifted through the battery${curtailed ? ', with solar the plant cannot absorb in grey' : ''}. `
    + plant + tradeOff + body;
}

/** Daily (or per-cycle) energy in MWh by use, aligned with the labels, ready to stack. */
function selectAnnualDispatchSeries(r) {
  const dispatch = r.annualDispatch || {};
  const displayDayLabels = dispatch.displayDayLabels || [];
  const displayAiSeriesKWh = dispatch.displayDailyAiKWh || [];
  const displayChemicalSeriesKWh = dispatch.displayDailyChemicalKWh || [];
  const useDisplaySeries = displayDayLabels.length > 0 &&
    displayDayLabels.length === displayAiSeriesKWh.length &&
    displayDayLabels.length === displayChemicalSeriesKWh.length;
  const rawDayLabels = useDisplaySeries ? displayDayLabels : (dispatch.dayLabels || []);
  const toMWh = values => values.map(value => value / 1000);
  // Battery and curtailment splits exist on the dispatch day grid only; the Mars
  // orbital display series has its own grid, so there they read as zero.
  const aligned = values => (Array.isArray(values) && values.length === rawDayLabels.length
    ? toMWh(values)
    : rawDayLabels.map(() => 0));
  const rawAiSeries = toMWh(useDisplaySeries ? displayAiSeriesKWh : (dispatch.dailyAiKWh || []));
  const rawChemicalSeries = toMWh(useDisplaySeries ? displayChemicalSeriesKWh : (dispatch.dailyChemicalKWh || []));
  const rawFromBatterySeries = useDisplaySeries ? rawDayLabels.map(() => 0) : aligned(dispatch.dailyChemicalFromBatteryKWh);
  const rawCurtailedSeries = useDisplaySeries ? rawDayLabels.map(() => 0) : aligned(dispatch.dailyClippedKWh);

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

  // Off-Earth average-cycle models have no seasonality: show the mean cycle (skipping the warm-up cycle).
  const representativeSliceStart = useRepresentativeCycleSeries && labels.length > 1 ? 1 : 0;
  const representativeMean = series => {
    const source = series.slice(representativeSliceStart);
    if (!source.length) return 0;
    return source.reduce((sum, value) => sum + value, 0) / source.length;
  };
  const prepare = series => {
    const trimmed = trim(series);
    return useRepresentativeCycleSeries ? trimmed.map(() => representativeMean(trimmed)) : trimmed;
  };

  const chemicalSeries = prepare(rawChemicalSeries);
  const fromBatterySeries = prepare(rawFromBatterySeries);
  const windowHours = r.annualSolar?.windowHours || 24;
  const capacityMWh = ((r.annualDispatch?.chemicalCapacityKW || r.chemicalSupply?.processPowerKW || 0) * windowHours) / 1000;
  return {
    labels,
    aiSeries: prepare(rawAiSeries),
    chemicalDirectSeries: chemicalSeries.map((value, index) => Math.max(0, value - (fromBatterySeries[index] || 0))),
    chemicalFromBatterySeries: fromBatterySeries,
    curtailedSeries: prepare(rawCurtailedSeries),
    capacitySeries: labels.map(() => capacityMWh),
    useFullOrbitalMarsSeries,
    useRepresentativeCycleSeries,
  };
}

const hasEnergy = series => series.some(value => value > 1e-9);

// The 100% sizing search leaves rounding-level clipping; only show curtailment above 0.1% of solar.
const MATERIAL_CURTAILMENT_SHARE = 0.001;
function isMaterialCurtailment(dispatch) {
  return (dispatch.clippedSolarKWh || 0) > MATERIAL_CURTAILMENT_SHARE * (dispatch.solarKWh || dispatch.chemicalKWh || 0);
}

function stackedArea(label, data, borderColor, backgroundColor, fill) {
  return { label, data, borderColor, backgroundColor, fill, stack: 'energy', tension: 0.25, pointRadius: 0, borderWidth: 1.5 };
}

/** Stacked uses of solar per day (only those present), plus the plant's around-the-clock capacity. */
function buildDatasets(series, labelUnit, showCurtailment) {
  const unit = `MWh/${labelUnit}`;
  const layers = [
    [series.aiSeries, `AI load (${unit})`, '#38bdf8', 'rgba(56, 189, 248, 0.25)'],
    [series.chemicalDirectSeries, `Chemical, direct from solar (${unit})`, '#10b981', 'rgba(16, 185, 129, 0.25)'],
    [series.chemicalFromBatterySeries, `Chemical, from battery (${unit})`, '#a855f7', 'rgba(168, 85, 247, 0.3)'],
    [series.curtailedSeries, `Solar not used (${unit})`, '#64748b', 'rgba(100, 116, 139, 0.18)'],
  ].filter(([data], index) => index === 1 || (index === 3 ? showCurtailment : hasEnergy(data)));

  const datasets = layers.map(([data, label, border, background], index) =>
    stackedArea(label, data, border, background, index === 0 ? 'origin' : '-1'));
  if (hasEnergy(series.capacitySeries)) {
    datasets.push({
      label: `Chemical plant at full output, 24 h (${unit})`,
      data: series.capacitySeries,
      borderColor: '#f59e0b',
      borderDash: [6, 4],
      borderWidth: 1.5,
      pointRadius: 0,
      fill: false,
      stack: 'capacity',
    });
  }
  return datasets;
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

    const datasets = buildDatasets(series, labelUnit, isMaterialCurtailment(r.annualDispatch || {}));
    const chartKey = JSON.stringify({ labels, datasets: datasets.map(dataset => [dataset.label, dataset.data]) });
    if (!ensureChartRuntime(this, 'annualDispatch', 'annualDispatchChart')) return;
    if (this.chartKeys.annualDispatch === chartKey && this.charts.annualDispatch) return;

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
              stacked: true,
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
