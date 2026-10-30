/* Power profile chart: solar, AI, battery charging and chemical load over one (average or selected) day/cycle */

import { FormatNumbers } from '../format-numbers.js';
import { axisGrid, axisTicks, axisTitle, ensureChartRuntime, legendLabels } from './chart-utils.js';

function line(label, data, borderColor, backgroundColor, { fill = false, tension = 0.35 } = {}) {
  return { label, data, borderColor, backgroundColor, fill, tension, pointRadius: 0, borderWidth: 2 };
}

/** The series to plot: the selected Earth day, the average AI dispatch day, or the representative chemical cycle. */
function selectPowerSeries(r, dayContext, { showSpecificDay, aiMode, useOrbitalMarsAiBasis }) {
  if (showSpecificDay) {
    return {
      solar: dayContext.solarHourlyKW,
      ai: aiMode ? dayContext.aiHourlyKW : [],
      batteryCharge: dayContext.batteryChargeHourlyKW,
      chemical: dayContext.chemicalHourlyKW,
      clipped: dayContext.clippedHourlyKW,
    };
  }

  if (aiMode) {
    const dispatch = r.ai.dispatch;
    const useOrbitalSolar = useOrbitalMarsAiBasis &&
      Array.isArray(dispatch?.averageDaySolarKW) &&
      dispatch.averageDaySolarKW.length;
    return {
      solar: useOrbitalSolar ? dispatch.averageDaySolarKW : (r.annualSolar.averageDayKW || []),
      ai: dispatch?.averageDayAiKW || [],
      batteryCharge: dispatch?.averageDayBatteryChargeKW || [],
      chemical: dispatch?.averageDayChemicalKW || [],
      clipped: dispatch?.averageDayClippedKW || [],
    };
  }

  const solar = r.solar.hourlyProfile.map(v => Math.min((v * r.solar.dailyKWh) / r.solar.binHours, r.solar.peakPowerKW));
  return {
    solar,
    ai: [],
    batteryCharge: r.chemicalSupply.batteryChargeHourlyKW || [],
    chemical: r.chemicalSupply.hourlyKW || solar,
    clipped: r.chemicalSupply.clippedHourlyKW || [],
  };
}

function describePowerChart(r, { aiMode, showSpecificDay, hasClipping, useOrbitalMarsAiBasis, selectedDayLabel }) {
  const isEarth = r.solar.bodyKey === 'earth';
  const cycleUnit = r.solar.cycleUnit;
  const sizingPercent = FormatNumbers.fixed(r.chemicalSupply?.sizingPercent ?? 100, 0);

  let dayLabel;
  if (showSpecificDay) dayLabel = `— ${selectedDayLabel}`;
  else if (aiMode) dayLabel = isEarth ? '— Yearly Dispatch Average' : `— Average ${cycleUnit}`;
  else dayLabel = isEarth ? '— Annual Average' : `— Average local ${cycleUnit}`;

  const noteParts = [];
  if (aiMode) {
    const averageLead = isEarth
      ? 'Average hour-of-day dispatch across the modeled year.'
      : useOrbitalMarsAiBasis
        ? `Average dispatch across one modeled Mars year, mapped onto a representative ${cycleUnit}.`
        : `Average dispatch across the modeled Earth year, mapped onto a representative ${cycleUnit}.`;
    noteParts.push(r.storage.enabled
      ? (showSpecificDay
          ? 'Hourly dispatch for the selected day using the annual AI load sizing. AI is served first, battery charging is shown separately, and residual chemistry runs up to the configured chemical nameplate.'
          : `${averageLead} AI is served first, battery charging is shown separately, and residual chemistry runs up to the configured chemical nameplate.`)
      : (showSpecificDay
          ? 'Hourly dispatch for the selected day using the annual AI load sizing. AI is served first, and residual chemistry runs up to the configured chemical nameplate.'
          : `${averageLead} AI is served first; residual chemistry runs up to the configured chemical nameplate.`));
    if (hasClipping) {
      noteParts.push(`Residual chemistry is capped at ${sizingPercent}% of the full-capture peak, so the red band shows clipped solar above the chemical nameplate.`);
    }
  } else if (r.storage.enabled) {
    noteParts.push(hasClipping
      ? (showSpecificDay
          ? `Battery-backed dispatch for the selected day. The chemical plant is capped at ${sizingPercent}% of the full-capture peak, so the red band shows solar clipped once the battery and plant are both full.`
          : `Representative battery-backed dispatch for the modeled cycle. The chemical plant is capped at ${sizingPercent}% of the full-capture peak, so the red band shows solar clipped once the battery and plant are both full.`)
      : (showSpecificDay
          ? 'Battery-backed dispatch for the selected day. The chemical plant is sized to the lowest peak load that still absorbs the modeled solar energy; excess solar charges the battery and stored energy extends operation later in the day.'
          : 'Representative battery-backed dispatch for the modeled cycle. The chemical plant is sized to the lowest peak load that still absorbs the modeled solar energy; excess solar charges the battery and stored energy extends operation later in the cycle.'));
    if (r.solar.chartNote) noteParts.push(r.solar.chartNote);
  } else {
    noteParts.push(hasClipping
      ? (showSpecificDay
          ? `Chemical load for the selected day with no battery shifting. The plant is capped at ${sizingPercent}% of the full-capture peak, and the red band shows the clipped midday solar.`
          : `Representative chemical load with no battery shifting. The plant is capped at ${sizingPercent}% of the full-capture peak, and the red band shows the clipped solar.`)
      : (showSpecificDay
          ? 'Chemical load for the selected day with no battery shifting. The process follows the solar profile directly.'
          : 'Representative chemical load with no battery shifting. The process follows the solar profile directly.'));
    if (r.solar.chartNote) noteParts.push(r.solar.chartNote);
  }
  if (isEarth && showSpecificDay) {
    noteParts.push('Specific-day views only change the displayed day profile; sizing and annual economics stay tied to the annual model.');
  } else if (!aiMode && isEarth) {
    noteParts.push('Daily chart shape varies by mounting type; annual economics still follow the annual yield input.');
  }

  return { dayLabel, note: noteParts.join(' ') };
}

function createPowerChart(canvas, labels, datasets, xAxisTitle) {
  return new Chart(canvas, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: legendLabels({
            filter(item, chartData) {
              return !chartData.datasets[item.datasetIndex]?.hiddenFromLegend;
            },
          }),
        },
        tooltip: {
          filter(ctx) {
            return !ctx.dataset.hiddenFromTooltip;
          },
          callbacks: {
            label(ctx) {
              const clippingValues = ctx.dataset.clippingValues;
              const rawValue = Array.isArray(clippingValues)
                ? clippingValues[ctx.dataIndex]
                : ctx.parsed.y;
              if (!Number.isFinite(rawValue)) return ctx.dataset.label;
              const dec = Math.abs(rawValue) >= 100 ? 0 : 1;
              return `${ctx.dataset.label}: ${FormatNumbers.fixed(rawValue, dec)}`;
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
          ticks: axisTicks({ callback: v => FormatNumbers.fixed(v, Math.abs(v) >= 1000 ? 0 : 1) }),
          grid: axisGrid(),
          beginAtZero: true,
          title: axisTitle('kW'),
        },
      },
    },
  });
}

export const powerChartMethods = {
  getPowerChartLabels(r) {
    const count = r.solar.hourlyProfile.length;
    if (r.solar.chartLabelMode === 'days') {
      return Array.from({ length: count }, (_, i) => `${FormatNumbers.fixed((i * r.solar.cycleHours) / count / 24, 1)}d`);
    }

    return Array.from({ length: count }, (_, i) => {
      const t = (i * r.solar.cycleHours) / count;
      const hours = Math.floor(t);
      const minutes = Math.round((t - hours) * 60);
      return `${hours}:${minutes.toString().padStart(2, '0')}`;
    });
  },

  updatePowerChart(r) {
    const aiMode = r.ai.enabled;
    const useOrbitalMarsAiBasis = aiMode && r.solar.bodyKey === 'mars' && r.ai.dispatch?.dispatchBasisLabel === 'orbital-year';
    const dayContext = this.getSelectedDayDisplayContext(r);
    const showSpecificDay = Boolean(dayContext) &&
      dayContext.solarHourlyKW.length === 24 &&
      dayContext.chemicalHourlyKW.length === 24 &&
      (!aiMode || dayContext.aiHourlyKW.length === 24);
    const series = selectPowerSeries(r, dayContext, { showSpecificDay, aiMode, useOrbitalMarsAiBasis });

    const { dayLabel, note } = describePowerChart(r, {
      aiMode,
      showSpecificDay,
      hasClipping: series.clipped.some(value => (value || 0) > 1e-6),
      useOrbitalMarsAiBasis,
      selectedDayLabel: dayContext?.selectedDayLabel || this.getSelectedDayLabel(),
    });
    document.getElementById('powerChartDayLabel').textContent = dayLabel;
    const powerChartNote = document.getElementById('powerChartNote');
    if (powerChartNote) powerChartNote.textContent = note;

    const xAxisTitle = showSpecificDay
      ? 'Hour of day'
      : (r.solar.chartLabelMode === 'days' ? 'Earth days into local cycle' : 'Local solar time');
    const labels = showSpecificDay
      ? Array.from({ length: series.solar.length }, (_, i) => `${i}:00`)
      : this.getPowerChartLabels(r);
    const clippedData = series.clipped.length === labels.length
      ? series.clipped.map(value => Math.max(0, value || 0))
      : new Array(labels.length).fill(0);
    const showClippingSeries = clippedData.some(value => value > 1e-6);
    const showBatteryChargeSeries = r.storage.enabled &&
      series.batteryCharge.length === labels.length &&
      series.batteryCharge.some(value => value > 1e-6);
    const chartKey = JSON.stringify({
      dayLabel,
      labels,
      aiMode,
      batteryEnabled: r.storage.enabled,
      solarData: series.solar,
      aiData: series.ai,
      clippedData: showClippingSeries ? clippedData : [],
      batteryChargeData: showBatteryChargeSeries ? series.batteryCharge : [],
      chemicalData: series.chemical,
    });

    if (!ensureChartRuntime(this, 'power', 'powerChart')) return;
    if (this.chartKeys.power === chartKey && this.charts.power) return;

    // Clipping is drawn as a band between the retained solar (an invisible floor) and full solar.
    const clippingDatasets = showClippingSeries ? [
      {
        label: '__clipping-floor__',
        data: series.solar.map((value, index) => Math.max(0, value - clippedData[index])),
        borderColor: 'rgba(0, 0, 0, 0)',
        backgroundColor: 'rgba(0, 0, 0, 0)',
        fill: false,
        tension: 0.35,
        pointRadius: 0,
        borderWidth: 0,
        hiddenFromLegend: true,
        hiddenFromTooltip: true,
      },
      {
        label: 'Clipped solar (kW)',
        data: series.solar,
        clippingValues: clippedData,
        borderColor: 'rgba(239, 68, 68, 0)',
        backgroundColor: 'rgba(239, 68, 68, 0.22)',
        fill: '-1',
        tension: 0.35,
        pointRadius: 0,
        borderWidth: 0,
      },
    ] : [];
    const datasets = [
      ...clippingDatasets,
      line('Solar output (kW)', series.solar, '#f59e0b', 'rgba(245, 158, 11, 0.1)', { fill: !showClippingSeries, tension: 0.4 }),
      ...(aiMode ? [line('AI served (kW)', series.ai, '#38bdf8', 'rgba(56, 189, 248, 0.08)')] : []),
      ...(showBatteryChargeSeries ? [line('Battery charging (kW)', series.batteryCharge, '#6366f1', 'rgba(99, 102, 241, 0.1)')] : []),
      line(
        aiMode ? 'Residual chemical load (kW)' : 'Chemical load (kW)',
        series.chemical,
        '#10b981',
        'rgba(16, 185, 129, 0.16)',
        { fill: true }
      ),
    ];

    if (!this.charts.power) {
      this.charts.power = createPowerChart(document.getElementById('powerChart'), labels, datasets, xAxisTitle);
    } else {
      this.charts.power.data.labels = labels;
      this.charts.power.data.datasets = datasets;
      this.charts.power.options.scales.x.title.text = xAxisTitle;
      this.charts.power.update();
    }

    this.chartKeys.power = chartKey;
  },
};
