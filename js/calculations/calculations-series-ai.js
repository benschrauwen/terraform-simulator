/* Annual series scaling and AI dispatch */

Object.assign(Calc, {
  scaleRawSeriesToAnnualEnergy(rawSeries, annualKWhTarget, peakKW) {
    if (!Array.isArray(rawSeries) || !rawSeries.length || !Number.isFinite(annualKWhTarget) || annualKWhTarget <= 0 || !Number.isFinite(peakKW) || peakKW <= 0) {
      return Array.isArray(rawSeries) ? rawSeries.map(() => 0) : [];
    }

    const safeSeries = rawSeries.map(value => Math.max(0, Number(value) || 0));
    const maxRaw = Math.max(...safeSeries, 0);
    if (maxRaw <= 0) return safeSeries.map(() => 0);

    const producedAt = scale => safeSeries.reduce((sum, value) => sum + Math.min(value * scale, peakKW), 0);
    let lo = 0;
    let hi = Math.max(peakKW / maxRaw, annualKWhTarget / safeSeries.reduce((sum, value) => sum + value, 0), 1e-6);

    while (producedAt(hi) < annualKWhTarget && hi < 1e9) {
      hi *= 2;
    }

    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (producedAt(mid) < annualKWhTarget) lo = mid;
      else hi = mid;
    }

    const scale = (lo + hi) / 2;
    return safeSeries.map(value => Math.min(value * scale, peakKW));
  },

  aggregateSeriesByWindow(series, windowSize) {
    if (!Array.isArray(series) || !series.length || !Number.isFinite(windowSize) || windowSize <= 0) return [];
    const output = [];
    for (let start = 0; start < series.length; start += windowSize) {
      output.push(series.slice(start, start + windowSize).reduce((sum, value) => sum + value, 0));
    }
    return output;
  },

  averageHourlyByWindow(series, windowSize) {
    if (!Array.isArray(series) || !series.length || !Number.isFinite(windowSize) || windowSize <= 0) return [];
    const output = new Array(windowSize).fill(0);
    const counts = new Array(windowSize).fill(0);
    series.forEach((value, index) => {
      const bucket = index % windowSize;
      output[bucket] += value;
      counts[bucket] += 1;
    });
    return output.map((value, index) => counts[index] > 0 ? value / counts[index] : 0);
  },

  buildAnnualSolarSeries(state, solar) {
    const bodyKey = state.body || 'earth';
    const annualKWhTarget = Math.max(0, (solar.annualMWh || 0) * 1000);
    const peakKW = Math.max(0, solar.peakPowerKW || 0);

    if (bodyKey === 'earth') {
      const rawHourly = [];
      const dayLabels = [];
      for (let day = 1; day <= 365; day++) {
        const geo = SolarGeometry.dailyProfile(state.latitude, day, state.mountingType);
        geo.rawProfile.forEach(value => rawHourly.push(Math.max(0, value)));
        dayLabels.push(SolarGeometry.dayToDateString(day));
      }
      const hourlyKW = this.scaleRawSeriesToAnnualEnergy(rawHourly, annualKWhTarget, peakKW);
      return {
        bodyKey,
        hourlyKW,
        dayLabels,
        dailyKWh: this.aggregateSeriesByWindow(hourlyKW, 24),
        averageDayKW: this.averageHourlyByWindow(hourlyKW, 24),
        totalKWh: hourlyKW.reduce((sum, value) => sum + value, 0),
      };
    }

    const sampleLength = 24;
    const normalized = Array.from({ length: 24 * 365 }, (_, hour) => {
      const t = (hour / (24 * 365)) * solar.hourlyProfile.length;
      const idx = Math.floor(t) % Math.max(1, solar.hourlyProfile.length);
      return Math.max(0, solar.hourlyProfile[idx] || 0);
    });
    const hourlyKW = this.scaleRawSeriesToAnnualEnergy(normalized, annualKWhTarget, peakKW);
    return {
      bodyKey,
      hourlyKW,
      dayLabels: Array.from({ length: Math.ceil(hourlyKW.length / sampleLength) }, (_, index) => `Day ${index + 1}`),
      dailyKWh: this.aggregateSeriesByWindow(hourlyKW, sampleLength),
      averageDayKW: this.averageHourlyByWindow(hourlyKW, sampleLength),
      totalKWh: hourlyKW.reduce((sum, value) => sum + value, 0),
    };
  },

  simulateAnnualDispatchWithConstantAiLoad(state, annualSolar, loadKW) {
    const source = Array.isArray(annualSolar?.hourlyKW) ? annualSolar.hourlyKW : [];
    const hours = source.length;
    const battCapKWh = state.batteryEnabled ? Math.max(0, (state.batteryCapacityMWh || 0) * 1000) : 0;
    const rtEff = battCapKWh > 0 ? Math.max(0, Math.min(1, (state.batteryEfficiency || 0) / 100)) : 1;
    const chargeEff = battCapKWh > 0 ? Math.sqrt(Math.max(rtEff, 1e-9)) : 1;
    const dischargeEff = battCapKWh > 0 ? Math.sqrt(Math.max(rtEff, 1e-9)) : 1;
    const leakageRetentionPerStep = this.getBatteryLeakageRetention(1);
    const aiHourlyKW = new Array(hours).fill(0);
    const chemicalHourlyKW = new Array(hours).fill(0);
    const batteryChargeHourlyKW = new Array(hours).fill(0);
    let socKWh = battCapKWh * 0.5;

    let aiServedKWh = 0;
    let aiShortfallKWh = 0;
    let chemicalKWh = 0;
    let fullPowerHours = 0;
    let curtailedHours = 0;
    let chargeThroughputKWh = 0;
    let dischargeThroughputKWh = 0;

    for (let pass = 0; pass < 2; pass++) {
      for (let hour = 0; hour < hours; hour++) {
        if (socKWh > 1e-9) {
          socKWh = Math.max(0, socKWh * leakageRetentionPerStep);
        }
        let solarKW = source[hour];
        let aiServed = Math.min(loadKW, solarKW);
        solarKW -= aiServed;

        if (loadKW - aiServed > 1e-9 && battCapKWh > 0 && socKWh > 1e-9) {
          const batteryDeliverable = socKWh * dischargeEff;
          const dischargeToAi = Math.min(loadKW - aiServed, batteryDeliverable);
          aiServed += dischargeToAi;
          socKWh -= dischargeToAi / dischargeEff;
          if (pass === 1) dischargeThroughputKWh += dischargeToAi;
        }

        if (solarKW > 1e-9 && battCapKWh > 0 && socKWh < battCapKWh - 1e-9) {
          const storedKWh = Math.min(battCapKWh - socKWh, solarKW * chargeEff);
          const chargeFromSolarKW = storedKWh / chargeEff;
          socKWh += storedKWh;
          solarKW -= chargeFromSolarKW;
          if (pass === 1) {
            batteryChargeHourlyKW[hour] = chargeFromSolarKW;
            chargeThroughputKWh += storedKWh;
          }
        }

        if (pass === 1) {
          const chemicalKW = Math.max(0, solarKW);
          aiHourlyKW[hour] = aiServed;
          chemicalHourlyKW[hour] = chemicalKW;
          aiServedKWh += aiServed;
          aiShortfallKWh += Math.max(0, loadKW - aiServed);
          chemicalKWh += chemicalKW;
          if (loadKW <= 1e-9 || aiServed >= loadKW - 1e-6) fullPowerHours += 1;
          else curtailedHours += 1;
        }
      }
    }

    const dailyAiKWh = this.aggregateSeriesByWindow(aiHourlyKW, 24);
    const dailyBatteryChargeKWh = this.aggregateSeriesByWindow(batteryChargeHourlyKW, 24);
    const dailyChemicalKWh = this.aggregateSeriesByWindow(chemicalHourlyKW, 24);
    const averageDayAiKW = this.averageHourlyByWindow(aiHourlyKW, 24);
    const averageDayBatteryChargeKW = this.averageHourlyByWindow(batteryChargeHourlyKW, 24);
    const averageDayChemicalKW = this.averageHourlyByWindow(chemicalHourlyKW, 24);
    const chemicalPeakKW = Math.max(...chemicalHourlyKW, 0);
    const chemicalOpHours = chemicalPeakKW > 0
      ? chemicalHourlyKW.reduce((sum, value) => sum + (value >= chemicalPeakKW * 0.05 ? 1 : 0), 0)
      : 0;
    const demandKWh = loadKW * hours;

    return {
      loadKW,
      aiHourlyKW,
      chemicalHourlyKW,
      aiServedKWh,
      aiShortfallKWh,
      chemicalKWh,
      demandKWh,
      utilization: demandKWh > 0 ? aiServedKWh / demandKWh : 0,
      fullPowerReliability: hours > 0 ? fullPowerHours / hours : 1,
      fullPowerHours,
      curtailedHours,
      dailyAiKWh,
      dailyBatteryChargeKWh,
      dailyChemicalKWh,
      averageDayAiKW,
      averageDayBatteryChargeKW,
      averageDayChemicalKW,
      batteryChargeHourlyKW,
      chemicalPeakKW,
      chemicalOpHours,
      chargeThroughputKWh,
      dischargeThroughputKWh,
      endSocKWh: socKWh,
    };
  },

  calculateAICompute(state, solar, annualSolar) {
    const cyclesPerYear = this.getBodyConfig(state.body || 'earth').cyclesPerEarthYear;
    const hours = Array.isArray(annualSolar?.hourlyKW) ? annualSolar.hourlyKW.length : 0;
    const targetUtilization = Math.max(0.5, Math.min(0.99999, (state.aiReliabilityTarget || 99.9) / 100));
    const batteryCapex = state.batteryEnabled ? Math.max(0, (state.batteryCapacityMWh || 0) * 1000 * (state.batteryCostPerKWh || 0)) : 0;
    const batteryLifeYears = state.batteryEnabled
      ? Math.max(1, Math.min(MODEL_ASSUMPTIONS.batteryNominalLifeYears, (state.batteryCycles || 0) / Math.max(1, cyclesPerYear)))
      : 0;
    const disabledDispatch = this.simulateAnnualDispatchWithConstantAiLoad(state, annualSolar, 0);

    const makeBatterySummary = dispatch => ({
      enabled: Boolean(state.batteryEnabled),
      effectiveCF: dispatch.chemicalPeakKW > 0 ? dispatch.chemicalKWh / (dispatch.chemicalPeakKW * Math.max(hours, 1)) : 0,
      dailyOpHours: (dispatch.chemicalOpHours / Math.max(cyclesPerYear, 1)).toFixed(1),
      capex: batteryCapex,
      battCapKWh: state.batteryEnabled ? (state.batteryCapacityMWh || 0) * 1000 : 0,
      dailyAvailableKWh: dispatch.chemicalKWh / Math.max(cyclesPerYear, 1),
      hourlyProfile: dispatch.averageDayChemicalKW.reduce((sum, value) => sum + value, 0) > 0
        ? dispatch.averageDayChemicalKW.map(value => value / dispatch.averageDayChemicalKW.reduce((sum, current) => sum + current, 0))
        : solar.hourlyProfile,
      hourlyKW: dispatch.averageDayChemicalKW,
      processPowerKW: dispatch.chemicalPeakKW,
      baseloadKW: dispatch.loadKW,
      clipKW: 0,
      utilizedCapacityKWh: state.batteryEnabled ? (state.batteryCapacityMWh || 0) * 1000 : 0,
      startBatteryKWh: state.batteryEnabled ? ((state.batteryCapacityMWh || 0) * 1000) * 0.5 : 0,
      annualizedCapex: state.batteryEnabled ? batteryCapex * this.crf(state.discountRate / 100, batteryLifeYears) : 0,
      lifetimeYears: batteryLifeYears,
      chargeThroughputKWh: dispatch.chargeThroughputKWh,
      dischargeThroughputKWh: dispatch.dischargeThroughputKWh,
    });

    if (!state.aiComputeEnabled || hours <= 0) {
      return {
        enabled: false,
        reliabilityTarget: targetUtilization * 100,
        designLoadKW: 0,
        annualTokensM: 0,
        annualRevenue: 0,
        tokensPerKWYearM: 0,
        utilization: 0,
        fullPowerReliability: 1,
        fullPowerHours: hours,
        curtailedHours: 0,
        averageDailyTokensM: 0,
        averageDailyChemicalMWh: disabledDispatch.chemicalKWh / Math.max(cyclesPerYear, 1) / 1000,
        chemicalAnnualKWh: disabledDispatch.chemicalKWh,
        chemicalPeakKW: disabledDispatch.chemicalPeakKW,
        chemicalDailyOpHours: disabledDispatch.chemicalOpHours / Math.max(cyclesPerYear, 1),
        capex: 0,
        annualizedCapex: 0,
        annualOM: 0,
        assetLifeYears: state.aiAssetLifeYears || AI_COMPUTE_DEFAULTS.assetLifeYears,
        dispatch: {
          ...disabledDispatch,
          dayLabels: annualSolar.dayLabels || [],
        },
        batterySummary: makeBatterySummary(disabledDispatch),
      };
    }

    const averageSolarKW = (annualSolar.totalKWh || 0) / Math.max(hours, 1);
    let lo = 0;
    let hi = averageSolarKW / targetUtilization;
    let best = this.simulateAnnualDispatchWithConstantAiLoad(state, annualSolar, 0);

    for (let i = 0; i < 50; i++) {
      const mid = (lo + hi) / 2;
      const dispatch = this.simulateAnnualDispatchWithConstantAiLoad(state, annualSolar, mid);
      if (dispatch.utilization >= targetUtilization) {
        best = dispatch;
        lo = mid;
      } else {
        hi = mid;
      }
    }

    const annualTokensM = (best.aiServedKWh / 1000) * (state.aiMillionTokensPerMWh || 0);
    const gpuCapexPerKW = state.aiGpuCapexPerKW ?? AI_COMPUTE_DEFAULTS.capexPerKW;
    const capex = best.loadKW * gpuCapexPerKW;
    const annualizedCapex = capex * this.crf(state.discountRate / 100, state.aiAssetLifeYears || AI_COMPUTE_DEFAULTS.assetLifeYears);
    const annualOM = capex * ((AI_COMPUTE_DEFAULTS.omPercent || 0) / 100);

    return {
      enabled: true,
      reliabilityTarget: targetUtilization * 100,
      designLoadKW: best.loadKW,
      annualTokensM,
      annualRevenue: annualTokensM * (state.aiTokenPricePerM || 0),
      tokensPerKWYearM: best.loadKW > 0 ? annualTokensM / best.loadKW : 0,
      utilization: best.utilization,
      fullPowerReliability: best.fullPowerReliability,
      fullPowerHours: best.fullPowerHours,
      curtailedHours: best.curtailedHours,
      averageDailyTokensM: annualTokensM / Math.max(cyclesPerYear, 1),
      averageDailyChemicalMWh: best.chemicalKWh / Math.max(cyclesPerYear, 1) / 1000,
      chemicalAnnualKWh: best.chemicalKWh,
      chemicalPeakKW: best.chemicalPeakKW,
      chemicalDailyOpHours: best.chemicalOpHours / Math.max(cyclesPerYear, 1),
      capex,
      annualizedCapex,
      annualOM,
      assetLifeYears: state.aiAssetLifeYears || AI_COMPUTE_DEFAULTS.assetLifeYears,
      dispatch: {
        ...best,
        dayLabels: annualSolar.dayLabels || [],
      },
      batterySummary: makeBatterySummary(best),
    };
  },
});
