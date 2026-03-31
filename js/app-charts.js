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
    const specificAiDaySelected = aiMode && r.solar.bodyKey === 'earth' && this.state.dayMode === 'specific';
    const selectedDayIndex = Math.max(0, Math.min(364, (this.state.dayOfYear || 1) - 1));
    const selectedDayLabel = `${SolarGeometry.dayToDateString(this.state.dayOfYear)}${SolarGeometry.notableDay(this.state.dayOfYear)}`;
    const sliceSelectedDay = series => {
      if (!Array.isArray(series) || !series.length) return [];
      const start = selectedDayIndex * 24;
      const slice = series.slice(start, start + 24);
      return slice.length === 24 ? slice : [];
    };
    const specificSolarData = sliceSelectedDay(r.annualSolar?.hourlyKW);
    const specificAiData = sliceSelectedDay(r.ai.dispatch?.aiHourlyKW);
    const specificBatteryChargeData = sliceSelectedDay(r.ai.dispatch?.batteryChargeHourlyKW);
    const specificChemicalData = sliceSelectedDay(r.ai.dispatch?.chemicalHourlyKW);
    const showSpecificAiDay = specificAiDaySelected &&
      specificSolarData.length === 24 &&
      specificAiData.length === 24 &&
      specificChemicalData.length === 24;
    const dayLabel = aiMode
      ? (showSpecificAiDay ? `— ${selectedDayLabel}` : '— Yearly Dispatch Average')
      : (r.solar.bodyKey === 'earth' && this.state.dayMode === 'specific')
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
          ? (showSpecificAiDay
              ? 'Hourly dispatch for the selected day using the annual AI load sizing. AI is served first, battery charging is shown separately, and chemistry only runs on residual solar left after charging.'
              : 'Average hour-of-day dispatch across the modeled year. AI is served first, battery charging is shown separately, and chemicals only consume residual energy left after charging.')
          : (showSpecificAiDay
              ? 'Hourly dispatch for the selected day using the annual AI load sizing. AI is served first, and chemistry only runs on residual solar left after AI demand.'
              : 'Average hour-of-day dispatch across the modeled year. AI is served first; chemicals only consume residual energy.'));
      } else if (r.storage.enabled) {
        noteParts.push(r.solar.bodyKey === 'earth' && this.state.dayMode === 'specific'
          ? 'Battery-backed dispatch for the selected day. The chemical plant is sized to the lowest peak load that still absorbs the modeled solar energy; excess solar charges the battery and stored energy extends operation later in the day.'
          : 'Representative battery-backed dispatch for the modeled cycle. The chemical plant is sized to the lowest peak load that still absorbs the modeled solar energy; excess solar charges the battery and stored energy extends operation later in the cycle.');
        if (r.solar.chartNote) noteParts.push(r.solar.chartNote);
      } else {
        noteParts.push(r.solar.bodyKey === 'earth' && this.state.dayMode === 'specific'
          ? 'Chemical load for the selected day with no battery shifting. The process follows the solar profile directly.'
          : 'Representative chemical load with no battery shifting. The process follows the solar profile directly.');
        if (r.solar.chartNote) noteParts.push(r.solar.chartNote);
      }
      if (!aiMode && r.solar.bodyKey === 'earth') {
        noteParts.push('Daily chart shape varies by mounting type; annual economics still follow the annual yield input.');
      }
      powerChartNote.textContent = noteParts.join(' ');
    }

    const solarData = aiMode
      ? (showSpecificAiDay ? specificSolarData : (r.annualSolar.averageDayKW || []))
      : r.solar.hourlyProfile.map(v => Math.min((v * r.solar.dailyKWh) / r.solar.binHours, r.solar.peakPowerKW));
    const labels = aiMode
      ? Array.from({ length: solarData.length }, (_, i) => `${i}:00`)
      : this.getPowerChartLabels(r);
    const aiData = aiMode
      ? (showSpecificAiDay ? specificAiData : (r.ai.dispatch.averageDayAiKW || []))
      : [];
    const batteryChargeData = aiMode
      ? (showSpecificAiDay ? specificBatteryChargeData : (r.ai.dispatch.averageDayBatteryChargeKW || []))
      : (r.chemicalSupply.batteryChargeHourlyKW || []);
    const chemicalData = aiMode
      ? (showSpecificAiDay ? specificChemicalData : (r.ai.dispatch.averageDayChemicalKW || []))
      : (r.chemicalSupply.hourlyKW || solarData);
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
      batteryChargeData: showBatteryChargeSeries ? batteryChargeData : [],
      chemicalData,
    });

    if (this.chartKeys.power === chartKey && this.charts.power) return;

    const datasets = [
      {
        label: 'Solar output (kW)',
        data: solarData,
        borderColor: '#f59e0b',
        backgroundColor: 'rgba(245, 158, 11, 0.1)',
        fill: true,
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
            legend: { labels: { color: '#94a3b8', font: { size: 10 } } },
            tooltip: {
              callbacks: {
                label(ctx) {
                  const y = ctx.parsed.y;
                  if (!Number.isFinite(y)) return ctx.dataset.label;
                  const dec = Math.abs(y) >= 100 ? 0 : 1;
                  return `${ctx.dataset.label}: ${FormatNumbers.fixed(y, dec)}`;
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
                text: aiMode ? 'Hour of day' : (r.solar.chartLabelMode === 'days' ? 'Earth days into local cycle' : 'Local solar time'),
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
      this.charts.power.options.scales.x.title.text = aiMode ? 'Hour of day' : (r.solar.chartLabelMode === 'days' ? 'Earth days into local cycle' : 'Local solar time');
      this.charts.power.update();
    }

    this.chartKeys.power = chartKey;
  },

  updateAnnualDispatchChart(r) {
    const rawDayLabels = r.annualDispatch?.dayLabels || [];
    const labels = rawDayLabels.map(label => {
      const match = /^Day (\d+)$/.exec(String(label));
      if (match) return `Day ${FormatNumbers.fixed(parseInt(match[1], 10), 0)}`;
      return label;
    });
    const aiSeries = (r.annualDispatch?.dailyAiKWh || []).map(value => value / 1000);
    const chemicalSeries = (r.annualDispatch?.dailyChemicalKWh || []).map(value => value / 1000);
    const annualDispatchNote = document.getElementById('annualDispatchNote');
    if (annualDispatchNote) {
      annualDispatchNote.textContent = r.ai.enabled
        ? 'Daily delivered energy over the modeled year. AI gets first call on solar and battery support; chemistry only runs on the residual energy left over.'
        : 'Daily seasonal solar energy over the modeled year. Enable AI Compute to see how the datacenter carves out a high-reliability constant load before chemistry absorbs the residual.';
    }

    const chartKey = JSON.stringify({
      labels,
      aiEnabled: r.ai.enabled,
      aiSeries,
      chemicalSeries,
    });
    if (this.chartKeys.annualDispatch === chartKey && this.charts.annualDispatch) return;

    const datasets = [
      {
        label: 'AI energy (MWh/day)',
        data: aiSeries,
        borderColor: '#38bdf8',
        backgroundColor: 'rgba(56, 189, 248, 0.2)',
        fill: true,
        tension: 0.25,
        pointRadius: 0,
        borderWidth: 2,
      },
      {
        label: 'Chemical energy (MWh/day)',
        data: chemicalSeries,
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
              title: { display: true, text: 'Day of year', color: '#64748b', font: { size: 10 } },
            },
            y: {
              ticks: {
                color: '#64748b',
                font: { size: 9 },
                callback: v => FormatNumbers.fixed(v, 2),
              },
              grid: { color: '#1e293b' },
              beginAtZero: true,
              title: { display: true, text: 'MWh/day', color: '#64748b', font: { size: 10 } },
            },
          },
        },
      });
    } else {
      this.charts.annualDispatch.data.labels = labels;
      this.charts.annualDispatch.data.datasets = datasets;
      this.charts.annualDispatch.update();
    }

    this.chartKeys.annualDispatch = chartKey;
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
