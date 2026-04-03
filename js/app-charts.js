/* Chart helpers attached to App */

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
    kept.push({ label: 'Other', value: other, color: '#64748b' });
  }
  return {
    labels: kept.map(x => x.label),
    values: kept.map(x => x.value),
    colors: kept.map(x => x.color),
  };
}

function normalizeAxisValue(value) {
  return Math.abs(value) < 1e-9 ? 0 : value;
}

function getAxisExtents(values, paddingFraction = 0.08) {
  let positive = 0;
  let negative = 0;
  let hasFiniteValue = false;

  (Array.isArray(values) ? values : []).forEach(value => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return;
    hasFiniteValue = true;
    if (numeric > positive) positive = numeric;
    if (numeric < 0) negative = Math.max(negative, -numeric);
  });

  if (!hasFiniteValue || (positive === 0 && negative === 0)) {
    return { positive: 1, negative: 0 };
  }

  return {
    positive: positive > 0 ? positive * (1 + paddingFraction) : 0,
    negative: negative > 0 ? negative * (1 + paddingFraction) : 0,
  };
}

function getZeroRatio(extents) {
  const totalSpan = extents.positive + extents.negative;
  return totalSpan > 0 ? extents.negative / totalSpan : 0;
}

function getAlignedZeroRatio(primaryExtents, secondaryExtents) {
  if (primaryExtents.negative === 0 && secondaryExtents.negative === 0) return 0;
  if (primaryExtents.positive === 0 && secondaryExtents.positive === 0) return 1;

  const ratios = [getZeroRatio(primaryExtents), getZeroRatio(secondaryExtents)].sort((a, b) => a - b);
  const [lowRatio, highRatio] = ratios;

  if (Math.abs(highRatio - lowRatio) < 1e-9) return highRatio;
  return highRatio / (1 + highRatio - lowRatio);
}

function getBoundsForZeroRatio(extents, zeroRatio) {
  if (zeroRatio <= 0) {
    return {
      min: 0,
      max: normalizeAxisValue(extents.positive || 1),
    };
  }

  if (zeroRatio >= 1) {
    return {
      min: normalizeAxisValue(-(extents.negative || 1)),
      max: 0,
    };
  }

  const totalSpan = Math.max(
    extents.negative > 0 ? extents.negative / zeroRatio : 0,
    extents.positive > 0 ? extents.positive / (1 - zeroRatio) : 0,
    1
  );

  return {
    min: normalizeAxisValue(-zeroRatio * totalSpan),
    max: normalizeAxisValue((1 - zeroRatio) * totalSpan),
  };
}

function getStackedAxisValues(datasets, labelCount) {
  const positiveTotals = Array.from({ length: labelCount }, () => 0);
  const negativeTotals = Array.from({ length: labelCount }, () => 0);

  (Array.isArray(datasets) ? datasets : []).forEach(dataset => {
    const values = Array.isArray(dataset?.data) ? dataset.data : [];
    for (let index = 0; index < labelCount; index += 1) {
      const numeric = Number(values[index]);
      if (!Number.isFinite(numeric)) continue;
      if (numeric >= 0) positiveTotals[index] += numeric;
      else negativeTotals[index] += numeric;
    }
  });

  return positiveTotals.concat(negativeTotals);
}

// Keep dual-axis zero baselines visually locked so both scales cross at the same gridline.
function getAlignedZeroBounds(primaryDatasets, secondaryDatasets, labelCount) {
  const primaryValues = getStackedAxisValues(primaryDatasets, labelCount);
  const secondaryValues = [];

  (Array.isArray(secondaryDatasets) ? secondaryDatasets : []).forEach(dataset => {
    const values = Array.isArray(dataset?.data) ? dataset.data : [];
    values.forEach(value => {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) secondaryValues.push(numeric);
    });
  });

  const primaryExtents = getAxisExtents(primaryValues);
  const secondaryExtents = getAxisExtents(secondaryValues);
  const zeroRatio = getAlignedZeroRatio(primaryExtents, secondaryExtents);

  return {
    primary: getBoundsForZeroRatio(primaryExtents, zeroRatio),
    secondary: getBoundsForZeroRatio(secondaryExtents, zeroRatio),
  };
}

window.AppChartMethods = {
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
    const chemicalSizingPercent = r.chemicalSupply?.sizingPercent ?? 100;
    const useOrbitalMarsAiBasis = aiMode && r.solar.bodyKey === 'mars' && r.ai.dispatch?.dispatchBasisLabel === 'orbital-year';
    const dayDisplayContext = this.getSelectedDayDisplayContext(r);
    const selectedDayLabel = dayDisplayContext?.selectedDayLabel || this.getSelectedDayLabel();
    const averageAiDayLabel = r.solar.bodyKey === 'earth'
      ? '— Yearly Dispatch Average'
      : `— Average ${r.solar.cycleUnit}`;
    const averageAiDispatchLead = r.solar.bodyKey === 'earth'
      ? 'Average hour-of-day dispatch across the modeled year.'
      : useOrbitalMarsAiBasis
        ? `Average dispatch across one modeled Mars year, mapped onto a representative ${r.solar.cycleUnit}.`
        : `Average dispatch across the modeled Earth year, mapped onto a representative ${r.solar.cycleUnit}.`;
    const showSpecificDay = Boolean(dayDisplayContext) &&
      dayDisplayContext.solarHourlyKW.length === 24 &&
      dayDisplayContext.chemicalHourlyKW.length === 24 &&
      (!aiMode || dayDisplayContext.aiHourlyKW.length === 24);
    const displayedClippingCandidate = showSpecificDay
      ? dayDisplayContext.clippedHourlyKW
      : aiMode
        ? (r.ai.dispatch?.averageDayClippedKW || [])
        : (r.chemicalSupply.clippedHourlyKW || []);
    const hasDisplayedClipping = displayedClippingCandidate.some(value => (value || 0) > 1e-6);
    const dayLabel = aiMode
      ? (showSpecificDay ? `— ${selectedDayLabel}` : averageAiDayLabel)
      : showSpecificDay
        ? `— ${selectedDayLabel}`
        : r.solar.bodyKey === 'earth'
          ? '— Annual Average'
          : `— Average local ${r.solar.cycleUnit}`;
    document.getElementById('powerChartDayLabel').textContent = dayLabel;
    const powerChartNote = document.getElementById('powerChartNote');
    if (powerChartNote) {
      const noteParts = [];
      if (aiMode) {
        noteParts.push(r.storage.enabled
          ? (showSpecificDay
              ? 'Hourly dispatch for the selected day using the annual AI load sizing. AI is served first, battery charging is shown separately, and residual chemistry runs up to the configured chemical nameplate.'
              : `${averageAiDispatchLead} AI is served first, battery charging is shown separately, and residual chemistry runs up to the configured chemical nameplate.`)
          : (showSpecificDay
              ? 'Hourly dispatch for the selected day using the annual AI load sizing. AI is served first, and residual chemistry runs up to the configured chemical nameplate.'
              : `${averageAiDispatchLead} AI is served first; residual chemistry runs up to the configured chemical nameplate.`));
        if (hasDisplayedClipping) {
          noteParts.push(`Residual chemistry is capped at ${FormatNumbers.fixed(chemicalSizingPercent, 0)}% of the full-capture peak, so the red band shows clipped solar above the chemical nameplate.`);
        }
      } else if (r.storage.enabled) {
        noteParts.push(hasDisplayedClipping
          ? (showSpecificDay
              ? `Battery-backed dispatch for the selected day. The chemical plant is capped at ${FormatNumbers.fixed(chemicalSizingPercent, 0)}% of the full-capture peak, so the red band shows solar clipped once the battery and plant are both full.`
              : `Representative battery-backed dispatch for the modeled cycle. The chemical plant is capped at ${FormatNumbers.fixed(chemicalSizingPercent, 0)}% of the full-capture peak, so the red band shows solar clipped once the battery and plant are both full.`)
          : (showSpecificDay
              ? 'Battery-backed dispatch for the selected day. The chemical plant is sized to the lowest peak load that still absorbs the modeled solar energy; excess solar charges the battery and stored energy extends operation later in the day.'
              : 'Representative battery-backed dispatch for the modeled cycle. The chemical plant is sized to the lowest peak load that still absorbs the modeled solar energy; excess solar charges the battery and stored energy extends operation later in the cycle.'));
        if (r.solar.chartNote) noteParts.push(r.solar.chartNote);
      } else {
        noteParts.push(hasDisplayedClipping
          ? (showSpecificDay
              ? `Chemical load for the selected day with no battery shifting. The plant is capped at ${FormatNumbers.fixed(chemicalSizingPercent, 0)}% of the full-capture peak, and the red band shows the clipped midday solar.`
              : `Representative chemical load with no battery shifting. The plant is capped at ${FormatNumbers.fixed(chemicalSizingPercent, 0)}% of the full-capture peak, and the red band shows the clipped solar.`)
          : (showSpecificDay
              ? 'Chemical load for the selected day with no battery shifting. The process follows the solar profile directly.'
              : 'Representative chemical load with no battery shifting. The process follows the solar profile directly.'));
        if (r.solar.chartNote) noteParts.push(r.solar.chartNote);
      }
      if (r.solar.bodyKey === 'earth' && showSpecificDay) {
        noteParts.push('Specific-day views only change the displayed day profile; sizing and annual economics stay tied to the annual model.');
      } else if (!aiMode && r.solar.bodyKey === 'earth') {
        noteParts.push('Daily chart shape varies by mounting type; annual economics still follow the annual yield input.');
      }
      powerChartNote.textContent = noteParts.join(' ');
    }

    const averageAiSolarData = useOrbitalMarsAiBasis &&
      Array.isArray(r.ai.dispatch?.averageDaySolarKW) &&
      r.ai.dispatch.averageDaySolarKW.length
      ? r.ai.dispatch.averageDaySolarKW
      : (r.annualSolar.averageDayKW || []);
    const solarData = aiMode
      ? (showSpecificDay ? dayDisplayContext.solarHourlyKW : averageAiSolarData)
      : (showSpecificDay
          ? dayDisplayContext.solarHourlyKW
          : r.solar.hourlyProfile.map(v => Math.min((v * r.solar.dailyKWh) / r.solar.binHours, r.solar.peakPowerKW)));
    const powerXAxisTitle = showSpecificDay
      ? 'Hour of day'
      : (r.solar.chartLabelMode === 'days' ? 'Earth days into local cycle' : 'Local solar time');
    const labels = showSpecificDay
      ? Array.from({ length: solarData.length }, (_, i) => `${i}:00`)
      : this.getPowerChartLabels(r);
    const aiData = aiMode
      ? (showSpecificDay ? dayDisplayContext.aiHourlyKW : (r.ai.dispatch.averageDayAiKW || []))
      : [];
    const batteryChargeData = aiMode
      ? (showSpecificDay ? dayDisplayContext.batteryChargeHourlyKW : (r.ai.dispatch.averageDayBatteryChargeKW || []))
      : (showSpecificDay ? dayDisplayContext.batteryChargeHourlyKW : (r.chemicalSupply.batteryChargeHourlyKW || []));
    const chemicalData = aiMode
      ? (showSpecificDay ? dayDisplayContext.chemicalHourlyKW : (r.ai.dispatch.averageDayChemicalKW || []))
      : (showSpecificDay ? dayDisplayContext.chemicalHourlyKW : (r.chemicalSupply.hourlyKW || solarData));
    const clippingCandidateData = aiMode
      ? (showSpecificDay ? dayDisplayContext.clippedHourlyKW : (r.ai.dispatch.averageDayClippedKW || []))
      : (showSpecificDay ? dayDisplayContext.clippedHourlyKW : (r.chemicalSupply.clippedHourlyKW || []));
    const clippedData = clippingCandidateData.length === labels.length
      ? clippingCandidateData.map(value => Math.max(0, value || 0))
      : new Array(labels.length).fill(0);
    const showClippingSeries = clippedData.some(value => value > 1e-6);
    const retainedSolarData = showClippingSeries
      ? solarData.map((value, index) => Math.max(0, value - clippedData[index]))
      : [];
    const showBatteryChargeSeries = r.storage.enabled &&
      batteryChargeData.length === labels.length &&
      batteryChargeData.some(value => value > 1e-6);
    const chartKey = JSON.stringify({
      dayLabel,
      labels,
      aiMode,
      batteryEnabled: r.storage.enabled,
      solarData,
      aiData,
      clippedData: showClippingSeries ? clippedData : [],
      batteryChargeData: showBatteryChargeSeries ? batteryChargeData : [],
      chemicalData,
    });

    if (this.chartKeys.power === chartKey && this.charts.power) return;

    const datasets = [
      ...(showClippingSeries ? [
        {
          label: '__clipping-floor__',
          data: retainedSolarData,
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
          data: solarData,
          clippingValues: clippedData,
          borderColor: 'rgba(239, 68, 68, 0)',
          backgroundColor: 'rgba(239, 68, 68, 0.22)',
          fill: '-1',
          tension: 0.35,
          pointRadius: 0,
          borderWidth: 0,
        },
      ] : []),
      {
        label: 'Solar output (kW)',
        data: solarData,
        borderColor: '#f59e0b',
        backgroundColor: 'rgba(245, 158, 11, 0.1)',
        fill: !showClippingSeries,
        tension: 0.4,
        pointRadius: 0,
        borderWidth: 2,
      },
      ...(aiMode ? [
        {
          label: 'AI served (kW)',
          data: aiData,
          borderColor: '#38bdf8',
          backgroundColor: 'rgba(56, 189, 248, 0.08)',
          fill: false,
          tension: 0.35,
          pointRadius: 0,
          borderWidth: 2,
        },
        ...(showBatteryChargeSeries ? [{
          label: 'Battery charging (kW)',
          data: batteryChargeData,
          borderColor: '#6366f1',
          backgroundColor: 'rgba(99, 102, 241, 0.1)',
          fill: false,
          tension: 0.35,
          pointRadius: 0,
          borderWidth: 2,
        }] : []),
        {
          label: 'Residual chemical load (kW)',
          data: chemicalData,
          borderColor: '#10b981',
          backgroundColor: 'rgba(16, 185, 129, 0.16)',
          fill: true,
          tension: 0.35,
          pointRadius: 0,
          borderWidth: 2,
        },
      ] : [
        ...(showBatteryChargeSeries ? [{
          label: 'Battery charging (kW)',
          data: batteryChargeData,
          borderColor: '#6366f1',
          backgroundColor: 'rgba(99, 102, 241, 0.1)',
          fill: false,
          tension: 0.35,
          pointRadius: 0,
          borderWidth: 2,
        }] : []),
        {
          label: 'Chemical load (kW)',
          data: chemicalData,
          borderColor: '#10b981',
          backgroundColor: 'rgba(16, 185, 129, 0.16)',
          fill: true,
          tension: 0.35,
          pointRadius: 0,
          borderWidth: 2,
        },
      ]),
    ];

    if (!this.charts.power) {
      this.charts.power = new Chart(document.getElementById('powerChart'), {
        type: 'line',
        data: { labels, datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              labels: {
                color: '#94a3b8',
                font: { size: 10 },
                filter(item, chartData) {
                  return !chartData.datasets[item.datasetIndex]?.hiddenFromLegend;
                },
              },
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
              ticks: { color: '#64748b', font: { size: 9 }, maxTicksLimit: 12 },
              grid: { color: '#1e293b' },
              title: {
                display: true,
                text: powerXAxisTitle,
                color: '#64748b',
                font: { size: 10 },
              },
            },
            y: {
              ticks: {
                color: '#64748b',
                font: { size: 9 },
                callback: v => FormatNumbers.fixed(v, Math.abs(v) >= 1000 ? 0 : 1),
              },
              grid: { color: '#1e293b' },
              beginAtZero: true,
              title: { display: true, text: 'kW', color: '#64748b', font: { size: 10 } },
            },
          },
        },
      });
    } else {
      this.charts.power.data.labels = labels;
      this.charts.power.data.datasets = datasets;
      this.charts.power.options.scales.x.title.text = powerXAxisTitle;
      this.charts.power.update();
    }

    this.chartKeys.power = chartKey;
  },

  updateAnnualDispatchChart(r) {
    const displayDayLabels = r.annualDispatch?.displayDayLabels || [];
    const displayAiSeriesKWh = r.annualDispatch?.displayDailyAiKWh || [];
    const displayChemicalSeriesKWh = r.annualDispatch?.displayDailyChemicalKWh || [];
    const useDisplaySeries = displayDayLabels.length > 0 &&
      displayDayLabels.length === displayAiSeriesKWh.length &&
      displayDayLabels.length === displayChemicalSeriesKWh.length;
    const rawDayLabels = useDisplaySeries ? displayDayLabels : (r.annualDispatch?.dayLabels || []);
    const rawAiSeries = (useDisplaySeries ? displayAiSeriesKWh : (r.annualDispatch?.dailyAiKWh || [])).map(value => value / 1000);
    const rawChemicalSeries = (useDisplaySeries ? displayChemicalSeriesKWh : (r.annualDispatch?.dailyChemicalKWh || [])).map(value => value / 1000);
    const useFullOrbitalMarsSeries = r.solar.bodyKey === 'mars' &&
      (useDisplaySeries || r.annualDispatch?.dispatchBasisLabel === 'orbital-year');
    const useRepresentativeCycleSeries = r.solar.bodyKey !== 'earth' && !r.annualSolar?.seasonalVariation;
    const hideTrailingPartial = !useFullOrbitalMarsSeries &&
      r.solar.bodyKey !== 'earth' &&
      rawDayLabels.length > 1 &&
      /\(partial\)$/.test(String(rawDayLabels[rawDayLabels.length - 1] || ''));
    const labelUnit = r.solar.bodyKey === 'earth' ? 'day' : r.solar.cycleUnitCompact;
    const xAxisTitle = useFullOrbitalMarsSeries
      ? 'Sol of Mars year'
      : (r.solar.bodyKey === 'earth'
          ? 'Day of year'
          : `${String(r.solar.cycleUnitCompact || 'cycle').charAt(0).toUpperCase()}${String(r.solar.cycleUnitCompact || 'cycle').slice(1)} of year`);
    const labels = (hideTrailingPartial ? rawDayLabels.slice(0, -1) : rawDayLabels).map(label => {
      const match = /^Day (\d+)$/.exec(String(label));
      if (match) return `Day ${FormatNumbers.fixed(parseInt(match[1], 10), 0)}`;
      return label;
    });
    const aiSeries = hideTrailingPartial ? rawAiSeries.slice(0, -1) : rawAiSeries;
    const chemicalSeries = hideTrailingPartial ? rawChemicalSeries.slice(0, -1) : rawChemicalSeries;
    const representativeSliceStart = useRepresentativeCycleSeries && aiSeries.length > 1 ? 1 : 0;
    const representativeMean = series => {
      const source = series.slice(representativeSliceStart);
      if (!source.length) return 0;
      return source.reduce((sum, value) => sum + value, 0) / source.length;
    };
    const displayedAiSeries = useRepresentativeCycleSeries
      ? aiSeries.map(() => representativeMean(aiSeries))
      : aiSeries;
    const displayedChemicalSeries = useRepresentativeCycleSeries
      ? chemicalSeries.map(() => representativeMean(chemicalSeries))
      : chemicalSeries;
    const annualDispatchNote = document.getElementById('annualDispatchNote');
    if (annualDispatchNote) {
      annualDispatchNote.textContent = r.ai.enabled
        ? (r.solar.bodyKey === 'earth'
            ? 'Daily delivered energy over the modeled year. AI gets first call on solar and battery support; chemistry only runs on the residual energy left over.'
            : useFullOrbitalMarsSeries
              ? 'Sol-by-sol delivered energy over one modeled Mars year. AI gets first call on solar and battery support; chemistry only runs on the residual energy left over. Annual economics elsewhere remain normalized to an Earth year.'
            : useRepresentativeCycleSeries
              ? 'Representative full-cycle delivered energy over the modeled Earth year. The current off-Earth solar model uses an average local cycle, so the chart repeats the modeled cycle-equivalent energy instead of implying seasonality.'
              : 'Cycle-by-cycle delivered energy over the modeled Earth year. The off-Earth seasonal shape reflects the modeled orbital geometry before AI claims first call on the power.')
        : (r.solar.bodyKey === 'earth'
            ? 'Daily seasonal solar energy over the modeled year. Enable AI Compute to see how the datacenter carves out a high-reliability constant load before chemistry absorbs the residual.'
            : useFullOrbitalMarsSeries
              ? 'Sol-by-sol solar energy over one modeled Mars year. Annual economics elsewhere remain normalized to an Earth year.'
            : useRepresentativeCycleSeries
              ? 'Representative full-cycle solar energy over the modeled Earth year. The current off-Earth solar model uses an average local cycle, so the chart repeats the modeled cycle-equivalent energy instead of implying seasonality.'
              : 'Cycle-by-cycle solar energy over the modeled Earth year. The off-Earth seasonal shape reflects the modeled orbital geometry before any AI load is applied.');
    }

    const chartKey = JSON.stringify({
      labels,
      aiEnabled: r.ai.enabled,
      aiSeries: displayedAiSeries,
      chemicalSeries: displayedChemicalSeries,
    });
    if (this.chartKeys.annualDispatch === chartKey && this.charts.annualDispatch) return;

    const datasets = [
      {
        label: `AI energy (MWh/${labelUnit})`,
        data: displayedAiSeries,
        borderColor: '#38bdf8',
        backgroundColor: 'rgba(56, 189, 248, 0.2)',
        fill: true,
        tension: 0.25,
        pointRadius: 0,
        borderWidth: 2,
      },
      {
        label: `Chemical energy (MWh/${labelUnit})`,
        data: displayedChemicalSeries,
        borderColor: '#10b981',
        backgroundColor: 'rgba(16, 185, 129, 0.18)',
        fill: true,
        tension: 0.25,
        pointRadius: 0,
        borderWidth: 2,
      },
    ];

    if (!this.charts.annualDispatch) {
      this.charts.annualDispatch = new Chart(document.getElementById('annualDispatchChart'), {
        type: 'line',
        data: { labels, datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { labels: { color: '#94a3b8', font: { size: 10 } } },
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
              ticks: { color: '#64748b', font: { size: 9 }, maxTicksLimit: 12 },
              grid: { color: '#1e293b' },
              title: { display: true, text: xAxisTitle, color: '#64748b', font: { size: 10 } },
            },
            y: {
              ticks: {
                color: '#64748b',
                font: { size: 9 },
                callback: v => FormatNumbers.fixed(v, 2),
              },
              grid: { color: '#1e293b' },
              beginAtZero: true,
              title: { display: true, text: `MWh/${labelUnit}`, color: '#64748b', font: { size: 10 } },
            },
          },
        },
      });
    } else {
      this.charts.annualDispatch.data.labels = labels;
      this.charts.annualDispatch.data.datasets = datasets;
      this.charts.annualDispatch.options.scales.x.title.text = xAxisTitle;
      this.charts.annualDispatch.options.scales.y.title.text = `MWh/${labelUnit}`;
      this.charts.annualDispatch.update();
    }

    this.chartKeys.annualDispatch = chartKey;
  },

  updateEconomicsTimelineChart(r) {
    const timeline = r.economics?.cashFlowTimeline;
    const canvas = document.getElementById('economicsTimelineChart');
    if (!timeline || !canvas) return;

    const modeMeta = document.getElementById('economicsTimelineMode');
    if (modeMeta) {
      modeMeta.textContent = timeline.financed ? '— Project + sponsor cash' : '— Unlevered project cash';
    }

    const note = document.getElementById('economicsTimelineNote');
    if (note) {
      const noteParts = [
        timeline.financed
          ? (timeline.hasPolicyCredits
              ? 'Bars show annual market revenue, incentive support, fixed O&M, scheduled replacements, and debt service when financing is enabled.'
              : 'Bars show annual revenue, fixed O&M, scheduled replacements, and debt service when financing is enabled.')
          : (timeline.hasPolicyCredits
              ? 'Bars show annual market revenue, incentive support, fixed O&M, and any scheduled replacement CAPEX.'
              : 'Bars show annual revenue, fixed O&M, and any scheduled replacement CAPEX.'),
        timeline.financed
          ? 'The dashed green line starts at upfront CAPEX and tracks cumulative project cash before financing; the solid blue line starts at sponsor cash at close and tracks cumulative equity cash after debt service.'
          : 'The green line starts at upfront CAPEX at close and tracks cumulative project cash through the selected analysis horizon.',
      ];
      if ((timeline.upfrontPolicySupport || 0) > 1e-9) {
        noteParts.push('If the selected scheme includes upfront capex support, the close bucket shows that support while the cumulative cash line starts from the net CAPEX at close.');
      }
      if (timeline.financed && timeline.hasSponsorSupport) {
        const uncoveredYears = r.economics.financing?.uncoveredDebtServiceYearCount || 0;
        noteParts.push(
          `Debt service exceeds operating cash flow in ${uncoveredYears === 1 ? '1 year' : `${FormatNumbers.fixed(uncoveredYears, 0)} years`}; hover financed years to inspect sponsor support and remaining debt balance.`
        );
      } else if (timeline.financed && timeline.hasDebtService) {
        noteParts.push('Hover financed years to compare project cash, sponsor equity cash, and remaining debt balance.');
      }
      note.textContent = noteParts.join(' ');
    }

    const datasets = [
      {
        type: 'bar',
        label: timeline.hasPolicyCredits ? 'Market revenue' : 'Revenue',
        data: timeline.hasPolicyCredits ? timeline.annualMarketRevenue : timeline.annualRevenue,
        yAxisID: 'yAnnual',
        stack: 'cash-items',
        backgroundColor: 'rgba(16, 185, 129, 0.55)',
        borderColor: '#10b981',
        borderWidth: 1,
        borderRadius: 3,
        maxBarThickness: 18,
      },
      ...(timeline.hasPolicyCredits ? [{
        type: 'bar',
        label: 'Incentive support',
        data: timeline.annualPolicyCredits,
        yAxisID: 'yAnnual',
        stack: 'cash-items',
        backgroundColor: 'rgba(250, 204, 21, 0.58)',
        borderColor: '#facc15',
        borderWidth: 1,
        borderRadius: 3,
        maxBarThickness: 18,
      }] : []),
      {
        type: 'bar',
        label: 'O&M',
        data: timeline.annualOperatingCost.map(value => -value),
        yAxisID: 'yAnnual',
        stack: 'cash-items',
        backgroundColor: 'rgba(148, 163, 184, 0.55)',
        borderColor: '#94a3b8',
        borderWidth: 1,
        borderRadius: 3,
        maxBarThickness: 18,
      },
      ...(timeline.hasReplacements ? [{
        type: 'bar',
        label: 'Replacement CAPEX',
        data: timeline.replacementCapex.map(value => -value),
        yAxisID: 'yAnnual',
        stack: 'cash-items',
        backgroundColor: 'rgba(199, 115, 121, 0.62)',
        borderColor: '#c77379',
        borderWidth: 1,
        borderRadius: 3,
        maxBarThickness: 18,
      }] : []),
      ...(timeline.hasDebtService ? [{
        type: 'bar',
        label: 'Debt service',
        data: timeline.annualDebtService.map(value => -value),
        yAxisID: 'yAnnual',
        stack: 'cash-items',
        backgroundColor: 'rgba(95, 127, 184, 0.6)',
        borderColor: '#5f7fb8',
        borderWidth: 1,
        borderRadius: 3,
        maxBarThickness: 18,
      }] : []),
      {
        type: 'line',
        label: 'Cumulative project cash',
        data: timeline.cumulativeProjectCash,
        yAxisID: 'yCumulative',
        borderColor: '#34d399',
        backgroundColor: 'rgba(52, 211, 153, 0.08)',
        borderWidth: 2,
        borderDash: timeline.financed ? [6, 4] : [],
        tension: 0.2,
        fill: false,
        pointRadius: 0,
        pointHoverRadius: 3,
      },
      ...(timeline.financed ? [{
        type: 'line',
        label: 'Cumulative equity cash',
        data: timeline.cumulativeEquityCash,
        yAxisID: 'yCumulative',
        borderColor: '#60a5fa',
        backgroundColor: 'rgba(96, 165, 250, 0.08)',
        borderWidth: 2,
        tension: 0.2,
        fill: false,
        pointRadius: 0,
        pointHoverRadius: 3,
      }] : []),
    ];

    const chartKey = JSON.stringify({
      labels: timeline.labels,
      annualRevenue: timeline.annualRevenue,
      annualMarketRevenue: timeline.annualMarketRevenue,
      annualPolicyCredits: timeline.annualPolicyCredits,
      annualOperatingCost: timeline.annualOperatingCost,
      replacementCapex: timeline.replacementCapex,
      annualDebtService: timeline.annualDebtService,
      cumulativeProjectCash: timeline.cumulativeProjectCash,
      cumulativeEquityCash: timeline.financed ? timeline.cumulativeEquityCash : [],
    });
    if (this.chartKeys.econTimeline === chartKey && this.charts.econTimeline) return;

    const annualDatasets = datasets.filter(dataset => dataset.yAxisID === 'yAnnual');
    const cumulativeDatasets = datasets.filter(dataset => dataset.yAxisID === 'yCumulative');
    const alignedZeroBounds = getAlignedZeroBounds(annualDatasets, cumulativeDatasets, timeline.labels.length);

    if (this.charts.econTimeline) this.charts.econTimeline.destroy();
    this.charts.econTimeline = new Chart(canvas, {
      data: {
        labels: timeline.labels,
        datasets,
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false,
        },
        plugins: {
          legend: {
            labels: {
              color: '#94a3b8',
              font: { size: 10 },
            },
          },
          tooltip: {
            filter(ctx) {
              return Math.abs(ctx.parsed.y || 0) > 1e-9;
            },
            callbacks: {
              label(ctx) {
                const value = ctx.parsed.y;
                return `${ctx.dataset.label}: ${FormatNumbers.formatMoney(value)}`;
              },
              footer(items) {
                if (!items.length) return '';
                const index = items[0].dataIndex;
                const lines = [];

                if (index === 0) {
                  lines.push(`Gross upfront CAPEX: ${FormatNumbers.formatMoney(timeline.totalCapex)}`);
                  if ((timeline.upfrontPolicySupport || 0) > 1e-9) {
                    lines.push(`Upfront incentive support: ${FormatNumbers.formatMoney(timeline.upfrontPolicySupport)}`);
                    lines.push(`Net project cash at close: ${FormatNumbers.formatMoney(timeline.projectCashFlow[index])}`);
                  }
                  if (timeline.financed) {
                    lines.push(`Sponsor cash at close: ${FormatNumbers.formatMoney(timeline.equityCashFlow[index])}`);
                    if (timeline.debtAmount > 0) {
                      lines.push(`Debt funded at close: ${FormatNumbers.formatMoney(timeline.debtAmount)}`);
                    }
                  }
                  return lines;
                }

                lines.push(`Project cash: ${FormatNumbers.formatMoney(timeline.projectCashFlow[index])}`);
                if (timeline.financed) {
                  lines.push(`Equity cash: ${FormatNumbers.formatMoney(timeline.equityCashFlow[index])}`);
                  const sponsorSupport = timeline.sponsorSupportNeeded[index] || 0;
                  if (sponsorSupport > 1e-9) {
                    lines.push(`Sponsor support needed: ${FormatNumbers.formatMoney(sponsorSupport)}`);
                  }
                  const debtEndingBalance = timeline.debtEndingBalance[index] || 0;
                  if (debtEndingBalance > 1e-9) {
                    lines.push(`Debt balance end-year: ${FormatNumbers.formatMoney(debtEndingBalance)}`);
                  }
                }
                return lines;
              },
            },
          },
        },
        scales: {
          x: {
            stacked: true,
            ticks: {
              color: '#64748b',
              font: { size: 9 },
              maxTicksLimit: 10,
            },
            grid: { color: '#1e293b' },
            title: {
              display: true,
              text: 'Analysis year',
              color: '#64748b',
              font: { size: 10 },
            },
          },
          yAnnual: {
            position: 'left',
            stacked: true,
            min: alignedZeroBounds.primary.min,
            max: alignedZeroBounds.primary.max,
            ticks: {
              color: '#64748b',
              font: { size: 9 },
              callback: value => FormatNumbers.formatMoney(Number(value)),
            },
            grid: { color: '#1e293b' },
            title: {
              display: true,
              text: 'Annual cash items ($/yr)',
              color: '#64748b',
              font: { size: 10 },
            },
          },
          yCumulative: {
            position: 'right',
            min: alignedZeroBounds.secondary.min,
            max: alignedZeroBounds.secondary.max,
            ticks: {
              color: '#64748b',
              font: { size: 9 },
              callback: value => FormatNumbers.formatMoney(Number(value)),
            },
            grid: { drawOnChartArea: false },
            title: {
              display: true,
              text: 'Cumulative cash ($)',
              color: '#64748b',
              font: { size: 10 },
            },
          },
        },
      },
    });

    this.chartKeys.econTimeline = chartKey;
  },

  updateEconChart(r) {
    const e = r.economics;
    const solarBreakdown = e.capexBreakdown || {};
    const labels = [];
    const values = [];
    const colors = [];
    if ((solarBreakdown.solarModules || 0) > 0) { labels.push('Solar modules'); values.push(solarBreakdown.solarModules); colors.push('#f59e0b'); }
    if ((solarBreakdown.solarBos || 0) > 0) { labels.push('Solar BOS'); values.push(solarBreakdown.solarBos); colors.push('#fbbf24'); }
    if ((solarBreakdown.solarLand || 0) > 0) { labels.push('Land'); values.push(solarBreakdown.solarLand); colors.push('#84cc16'); }
    if ((solarBreakdown.solarSitePrep || 0) > 0) { labels.push('Site prep'); values.push(solarBreakdown.solarSitePrep); colors.push('#22c55e'); }
    if (e.capex.battery > 0) { labels.push('Battery'); values.push(e.capex.battery); colors.push('#6366f1'); }
    if (e.capex.ai > 0) { labels.push('AI datacenter'); values.push(e.capex.ai); colors.push('#38bdf8'); }
    if (e.capex.electrolyzer > 0) { labels.push('Electrolyzer'); values.push(e.capex.electrolyzer); colors.push('#06b6d4'); }
    if (e.capex.dac > 0) { labels.push('DAC'); values.push(e.capex.dac); colors.push('#8b5cf6'); }
    if (e.capex.sabatier > 0) { labels.push('Methane'); values.push(e.capex.sabatier); colors.push('#10b981'); }
    if (e.capex.methanol > 0) { labels.push('Methanol'); values.push(e.capex.methanol); colors.push('#f97316'); }

    const compact = compactCapexChartData(labels, values, colors);
    const sliceCount = compact.labels.length;
    const borderW = sliceCount > 7 ? 1 : 2;

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
              color: '#94a3b8',
              font: { size: 9 },
              padding: 8,
              boxWidth: 10,
              boxHeight: 10,
            },
          },
          title: {
            display: true,
            text: 'Installed CAPEX Breakdown',
            color: '#94a3b8',
            font: { size: 11 },
            padding: { bottom: 10 },
          },
          tooltip: {
            callbacks: {
              label(ctx) {
                const v = ctx.raw;
                return `${ctx.label}: ${FormatNumbers.formatMoney(v)}`;
              },
            },
          },
        },
      },
    });
  },

  updateSensitivityChart(r = this.lastResults) {
    const emptyState = document.getElementById('sensitivityEmptyState');
    const sensitivityConfigs = [
      {
        chartKey: 'sensitivityMethane',
        wrapperId: 'sensitivityMethaneCard',
        canvasId: 'sensitivityMethaneChart',
        paramKey: 'methanePrice',
        prices: [2, 3, 4, 6, 8, 10, 15, 20, 25, 30],
        axisLabel: 'Methane price ($/MCF)',
        lineColor: '#10b981',
        active: Boolean(r?.sabatier?.enabled) && (r?.sabatier?.ch4AnnualMCF || 0) > 0,
        formatLabel: value => `$${FormatNumbers.fixed(value, 0)}`,
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
        formatLabel: value => `$${FormatNumbers.fixed(value, 0)}`,
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

    if (this.charts.sensitivity) {
      this.charts.sensitivity.destroy();
      delete this.charts.sensitivity;
    }

    let visibleChartCount = 0;

    sensitivityConfigs.forEach(config => {
      const wrapper = document.getElementById(config.wrapperId);
      const canvas = document.getElementById(config.canvasId);

      if (wrapper) wrapper.hidden = !config.active;
      if (this.charts[config.chartKey]) {
        this.charts[config.chartKey].destroy();
        delete this.charts[config.chartKey];
      }
      if (!config.active || !canvas) return;

      visibleChartCount += 1;
      const series = Calc.runSensitivity(this.state, config.paramKey, config.prices);
      this.charts[config.chartKey] = new Chart(canvas, {
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
              title: {
                display: true,
                text: config.axisLabel,
                color: '#64748b',
                font: { size: 10 },
              },
              ticks: { color: '#64748b', font: { size: 9 } },
              grid: { color: '#1e293b' },
            },
            y: {
              title: { display: true, text: 'NPV ($)', color: '#64748b', font: { size: 10 } },
              ticks: {
                color: '#64748b',
                font: { size: 9 },
                callback: value => FormatNumbers.formatMoney(Number(value)),
              },
              grid: { color: '#1e293b' },
            },
          },
        },
      });
    });

    if (emptyState) emptyState.hidden = visibleChartCount > 0;
  },
};
