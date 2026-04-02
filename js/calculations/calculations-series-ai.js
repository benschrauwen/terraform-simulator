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

  aggregateSeriesBySpanHours(series, spanHours) {
    if (!Array.isArray(series) || !series.length || !Number.isFinite(spanHours) || spanHours <= 0) return [];
    const epsilon = 1e-9;
    const totalHours = series.length;
    const windowCount = Math.max(1, Math.ceil((totalHours / spanHours) - epsilon));
    const output = new Array(windowCount).fill(0);
    let bucket = 0;
    let bucketEnd = spanHours;

    for (let hour = 0; hour < totalHours; hour++) {
      const value = Number(series[hour]) || 0;
      let segmentStart = hour;
      const segmentEnd = hour + 1;

      while (segmentStart < segmentEnd - epsilon && bucket < windowCount) {
        while (bucket < windowCount && bucketEnd <= segmentStart + epsilon) {
          bucket += 1;
          bucketEnd = (bucket + 1) * spanHours;
        }
        if (bucket >= windowCount) break;

        const overlapEnd = Math.min(segmentEnd, bucketEnd);
        const overlapHours = overlapEnd - segmentStart;
        if (overlapHours > epsilon) {
          output[bucket] += value * overlapHours;
        }
        segmentStart = overlapEnd;
      }
    }

    return output;
  },

  accumulateSeriesStepBySpanHours(output, spanHours, stepIndex, value) {
    if (!Array.isArray(output) || !output.length || !Number.isFinite(spanHours) || spanHours <= 0 || !Number.isFinite(stepIndex)) {
      return;
    }

    const epsilon = 1e-9;
    const safeValue = Number(value) || 0;
    let segmentStart = stepIndex;
    const segmentEnd = stepIndex + 1;
    let bucket = Math.max(0, Math.floor(segmentStart / spanHours));
    let bucketEnd = (bucket + 1) * spanHours;

    while (segmentStart < segmentEnd - epsilon && bucket < output.length) {
      while (bucket < output.length && bucketEnd <= segmentStart + epsilon) {
        bucket += 1;
        bucketEnd = (bucket + 1) * spanHours;
      }
      if (bucket >= output.length) break;

      const overlapEnd = Math.min(segmentEnd, bucketEnd);
      const overlapHours = overlapEnd - segmentStart;
      if (overlapHours > epsilon) {
        output[bucket] += safeValue * overlapHours;
      }
      segmentStart = overlapEnd;
    }
  },

  averageSeriesByCyclePhase(series, cycleHours, binCount) {
    if (!Array.isArray(series) || !series.length || !Number.isFinite(cycleHours) || cycleHours <= 0 || !Number.isFinite(binCount) || binCount <= 0) {
      return [];
    }

    const safeBinCount = Math.max(1, Math.round(binCount));
    const sums = new Array(safeBinCount).fill(0);
    const counts = new Array(safeBinCount).fill(0);
    series.forEach((value, index) => {
      const phase = ((index + 0.5) / cycleHours) % 1;
      const bucket = Math.max(0, Math.min(safeBinCount - 1, Math.floor(phase * safeBinCount)));
      sums[bucket] += value;
      counts[bucket] += 1;
    });
    return sums.map((value, index) => counts[index] > 0 ? value / counts[index] : 0);
  },

  getAnnualWindowLabelPrefix(bodyKey) {
    if (bodyKey === 'earth') return 'Day';
    const body = this.getBodyConfig(bodyKey);
    if ((body.cycleUnitCompact || '').toLowerCase() === 'sol') return 'Sol';
    if ((body.cycleUnitCompact || '').toLowerCase() === 'day') return 'Day';
    return 'Cycle';
  },

  buildAnnualWindowLabels(bodyKey, windowCount, spanHours, totalHours) {
    if (!Number.isFinite(windowCount) || windowCount <= 0) return [];
    if (bodyKey === 'earth') {
      return Array.from({ length: windowCount }, (_, index) => SolarGeometry.dayToDateString(index + 1));
    }

    const coveredBeforeLast = Math.max(0, windowCount - 1) * spanHours;
    const lastWindowHours = Math.max(0, totalHours - coveredBeforeLast);
    const hasPartialLastWindow = windowCount > 0 && lastWindowHours < spanHours - 1e-6;
    const labelPrefix = this.getAnnualWindowLabelPrefix(bodyKey);
    return Array.from({ length: windowCount }, (_, index) => {
      const partialSuffix = hasPartialLastWindow && index === windowCount - 1 ? ' (partial)' : '';
      return `${labelPrefix} ${index + 1}${partialSuffix}`;
    });
  },

  buildMarsSeasonalSolarSeries(state, solar, totalHours, seriesKWhTarget, options = {}) {
    const includeWindowSummaries = options.includeWindowSummaries !== false;
    const bodyKey = 'mars';
    const body = this.getBodyConfig(bodyKey);
    const cycleHours = Math.max(1e-6, body.cycleHours || 24.66);
    const safeTotalHours = Math.max(1, Math.round(Number(totalHours) || 0));
    const binCount = Math.max(1, solar.hourlyProfile.length);
    const peakKW = Math.max(0, solar.peakPowerKW || 0);
    const cycleCount = Math.max(1, Math.ceil((safeTotalHours / cycleHours) - 1e-9));
    const dailyProfiles = Array.from({ length: cycleCount }, (_, index) => {
      const geo = SolarGeometry.planetaryDailyProfile({
        latitude: state.latitude,
        seasonalDay: index + 1,
        orbitalDays: 668.6,
        axialTiltDeg: 24.936,
        cycleHours,
        solarConstant: 590,
        diffuseFraction: 0,
        eccentricity: 0.093377,
        perihelionLsDeg: 248,
        bins: binCount,
      });
      return SolarGeometry.applyMountingShape(geo.rawProfile, state.mountingType, cycleHours).rawProfile;
    });
    const normalized = this.sampleProfileSequenceByHour(dailyProfiles, cycleHours, safeTotalHours);
    const hourlyKW = this.scaleRawSeriesToAnnualEnergy(normalized, Math.max(0, Number(seriesKWhTarget) || 0), peakKW);
    const windowCount = Math.ceil(hourlyKW.length / cycleHours);
    const totalKWh = hourlyKW.reduce((sum, value) => sum + value, 0);

    return {
      bodyKey,
      hourlyKW,
      dayLabels: includeWindowSummaries ? this.buildAnnualWindowLabels(bodyKey, windowCount, cycleHours, hourlyKW.length) : [],
      dailyKWh: includeWindowSummaries ? this.aggregateSeriesBySpanHours(hourlyKW, cycleHours) : [],
      averageDayKW: includeWindowSummaries ? this.averageSeriesByCyclePhase(hourlyKW, cycleHours, binCount) : [],
      totalKWh,
      windowHours: cycleHours,
      windowBinCount: binCount,
      seasonalVariation: true,
    };
  },

  buildMarsOrbitalDispatchBasis(state, solar, options = {}) {
    const body = this.getBodyConfig('mars');
    const orbitalSols = 668.6;
    const annualizationFactor = Math.max(1e-9, Math.max(body.cyclesPerEarthYear || 0, 1) / orbitalSols);
    return {
      solar: this.buildMarsSeasonalSolarSeries(
        state,
        solar,
        orbitalSols * Math.max(1e-6, body.cycleHours || 24.66),
        Math.max(0, (solar.annualMWh || 0) * 1000) / annualizationFactor,
        options
      ),
      annualizationFactor,
      horizonLabel: 'orbital-year',
    };
  },

  getAnnualDispatchBasis(state, solar, annualSolar, options = {}) {
    if ((state.body || 'earth') === 'mars') return this.buildMarsOrbitalDispatchBasis(state, solar, options);
    return {
      solar: annualSolar,
      annualizationFactor: 1,
      horizonLabel: 'earth-year',
    };
  },

  sampleRepeatingProfileByHour(profile, cycleHours, totalHours) {
    if (!Array.isArray(profile) || !profile.length || !Number.isFinite(cycleHours) || cycleHours <= 0 || !Number.isFinite(totalHours) || totalHours <= 0) {
      return [];
    }

    const epsilon = 1e-9;
    const binCount = profile.length;
    const binHours = cycleHours / binCount;
    const hourCount = Math.max(1, Math.round(totalHours));

    return Array.from({ length: hourCount }, (_, hour) => {
      let value = 0;
      let segmentStart = hour;
      const segmentEnd = hour + 1;

      while (segmentStart < segmentEnd - epsilon) {
        let cyclePos = segmentStart % cycleHours;
        if (cyclePos < 0) cyclePos += cycleHours;
        if (cyclePos >= cycleHours - epsilon) cyclePos = 0;

        const binPhase = Math.max(0, Math.min(cycleHours - epsilon, cyclePos + epsilon));
        const bin = Math.max(0, Math.min(binCount - 1, Math.floor(binPhase / binHours)));
        const binEnd = Math.min(cycleHours, (bin + 1) * binHours);
        const overlapEnd = Math.min(segmentEnd, segmentStart + (binEnd - cyclePos));
        const overlapHours = overlapEnd - segmentStart;
        if (overlapHours > epsilon) {
          value += (Number(profile[bin]) || 0) * overlapHours;
        }
        segmentStart = overlapEnd;
      }

      return value;
    });
  },

  sampleProfileSequenceByHour(profiles, cycleHours, totalHours) {
    if (!Array.isArray(profiles) || !profiles.length || !Number.isFinite(cycleHours) || cycleHours <= 0 || !Number.isFinite(totalHours) || totalHours <= 0) {
      return [];
    }

    const epsilon = 1e-9;
    const hourCount = Math.max(1, Math.round(totalHours));
    const profileCount = profiles.length;

    return Array.from({ length: hourCount }, (_, hour) => {
      let value = 0;
      let segmentStart = hour;
      const segmentEnd = hour + 1;

      while (segmentStart < segmentEnd - epsilon) {
        const cycleIndex = Math.max(0, Math.min(profileCount - 1, Math.floor((segmentStart + epsilon) / cycleHours)));
        const profile = Array.isArray(profiles[cycleIndex]) && profiles[cycleIndex].length ? profiles[cycleIndex] : [0];
        const binCount = profile.length;
        const binHours = cycleHours / binCount;
        const cycleStart = cycleIndex * cycleHours;
        let cyclePos = segmentStart - cycleStart;
        if (cyclePos < 0) cyclePos = 0;
        if (cyclePos >= cycleHours - epsilon) cyclePos = 0;

        const binPhase = Math.max(0, Math.min(cycleHours - epsilon, cyclePos + epsilon));
        const bin = Math.max(0, Math.min(binCount - 1, Math.floor(binPhase / binHours)));
        const binEnd = Math.min(cycleHours, (bin + 1) * binHours);
        const overlapEnd = Math.min(segmentEnd, cycleStart + binEnd);
        const overlapHours = overlapEnd - segmentStart;
        if (overlapHours > epsilon) {
          value += (Number(profile[bin]) || 0) * overlapHours;
        }
        segmentStart = overlapEnd;
      }

      return value;
    });
  },

  buildAnnualSolarSeries(state, solar, options = {}) {
    const includeWindowSummaries = options.includeWindowSummaries !== false;
    const bodyKey = state.body || 'earth';
    const body = this.getBodyConfig(bodyKey);
    const annualKWhTarget = Math.max(0, (solar.annualMWh || 0) * 1000);
    const peakKW = Math.max(0, solar.peakPowerKW || 0);

    if (bodyKey === 'earth') {
      const rawHourly = [];
      for (let day = 1; day <= 365; day++) {
        const geo = SolarGeometry.dailyProfile(state.latitude, day, state.mountingType);
        geo.rawProfile.forEach(value => rawHourly.push(Math.max(0, value)));
      }
      const hourlyKW = this.scaleRawSeriesToAnnualEnergy(rawHourly, annualKWhTarget, peakKW);
      const windowHours = 24;
      const totalKWh = hourlyKW.reduce((sum, value) => sum + value, 0);
      return {
        bodyKey,
        hourlyKW,
        dayLabels: includeWindowSummaries ? this.buildAnnualWindowLabels(bodyKey, 365, windowHours, hourlyKW.length) : [],
        dailyKWh: includeWindowSummaries ? this.aggregateSeriesByWindow(hourlyKW, windowHours) : [],
        averageDayKW: includeWindowSummaries ? this.averageHourlyByWindow(hourlyKW, windowHours) : [],
        totalKWh,
        windowHours,
        windowBinCount: 24,
        seasonalVariation: true,
      };
    }

    const cycleHours = Math.max(1e-6, body.cycleHours || 24);
    const binCount = Math.max(1, solar.hourlyProfile.length);
    const totalHours = 24 * 365;

    if (bodyKey === 'mars') {
      return this.buildMarsSeasonalSolarSeries(state, solar, totalHours, annualKWhTarget, options);
    }

    const normalized = this.sampleRepeatingProfileByHour(solar.hourlyProfile, cycleHours, totalHours);
    const hourlyKW = this.scaleRawSeriesToAnnualEnergy(normalized, annualKWhTarget, peakKW);
    const windowCount = Math.ceil(hourlyKW.length / cycleHours);
    const totalKWh = hourlyKW.reduce((sum, value) => sum + value, 0);
    return {
      bodyKey,
      hourlyKW,
      dayLabels: includeWindowSummaries ? this.buildAnnualWindowLabels(bodyKey, windowCount, cycleHours, hourlyKW.length) : [],
      dailyKWh: includeWindowSummaries ? this.aggregateSeriesBySpanHours(hourlyKW, cycleHours) : [],
      averageDayKW: includeWindowSummaries ? this.averageSeriesByCyclePhase(hourlyKW, cycleHours, binCount) : [],
      totalKWh,
      windowHours: cycleHours,
      windowBinCount: binCount,
      seasonalVariation: false,
    };
  },

  simulateAnnualDispatchPass(state, annualSolar, loadKW, startSocKWh, options = {}) {
    const captureSeries = Boolean(options.captureSeries);
    const captureDailySummaries = captureSeries || Boolean(options.captureDailySummaries);
    const chemicalCapacityKW = Number.isFinite(options.chemicalCapacityKW) ? Math.max(0, options.chemicalCapacityKW) : null;
    const opThresholdKW = Number.isFinite(options.opThresholdKW)
      ? Math.max(0, options.opThresholdKW)
      : (chemicalCapacityKW !== null && chemicalCapacityKW > 0 ? chemicalCapacityKW * 0.05 : null);
    const source = Array.isArray(annualSolar?.hourlyKW) ? annualSolar.hourlyKW : [];
    const hours = source.length;
    const summaryWindowHours = Math.max(1e-6, annualSolar?.windowHours || 24);
    const summaryBinCount = Math.max(1, Math.round(annualSolar?.windowBinCount || 24));
    const summaryWindowCount = captureDailySummaries
      ? Math.max(1, Math.ceil((hours / summaryWindowHours) - 1e-9))
      : 0;
    const batteryEnabled = this.hasBatteryStorage(state);
    const battCapKWh = batteryEnabled ? Math.max(0, (state.batteryCapacityMWh || 0) * 1000) : 0;
    const rtEff = battCapKWh > 0 ? Math.max(0, Math.min(1, (state.batteryEfficiency || 0) / 100)) : 1;
    const chargeEff = battCapKWh > 0 ? Math.sqrt(Math.max(rtEff, 1e-9)) : 1;
    const dischargeEff = battCapKWh > 0 ? Math.sqrt(Math.max(rtEff, 1e-9)) : 1;
    const leakageRetentionPerStep = this.getBatteryLeakageRetention(1);
    const aiHourlyKW = captureSeries ? new Array(hours).fill(0) : [];
    const chemicalHourlyKW = captureSeries ? new Array(hours).fill(0) : [];
    const batteryChargeHourlyKW = captureSeries ? new Array(hours).fill(0) : [];
    const clippedHourlyKW = captureSeries ? new Array(hours).fill(0) : [];
    const dailyAiSummaryKWh = captureDailySummaries && !captureSeries ? new Array(summaryWindowCount).fill(0) : [];
    const dailyBatteryChargeSummaryKWh = captureDailySummaries && !captureSeries ? new Array(summaryWindowCount).fill(0) : [];
    const dailyChemicalSummaryKWh = captureDailySummaries && !captureSeries ? new Array(summaryWindowCount).fill(0) : [];
    const dailyClippedSummaryKWh = captureDailySummaries && !captureSeries ? new Array(summaryWindowCount).fill(0) : [];
    let socKWh = Math.max(0, Math.min(battCapKWh, startSocKWh));
    let minSocKWh = socKWh;
    let maxSocKWh = socKWh;

    let aiServedKWh = 0;
    let aiShortfallKWh = 0;
    let chemicalKWh = 0;
    let clippedSolarKWh = 0;
    let fullPowerHours = 0;
    let curtailedHours = 0;
    let chargeThroughputKWh = 0;
    let dischargeThroughputKWh = 0;
    let chemicalPeakKW = 0;
    let chemicalOpHours = 0;

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
        dischargeThroughputKWh += dischargeToAi;
      }

      let chargeFromSolarKW = 0;
      if (solarKW > 1e-9 && battCapKWh > 0 && socKWh < battCapKWh - 1e-9) {
        const storedKWh = Math.min(battCapKWh - socKWh, solarKW * chargeEff);
        chargeFromSolarKW = storedKWh / chargeEff;
        socKWh += storedKWh;
        solarKW -= chargeFromSolarKW;
        chargeThroughputKWh += storedKWh;
        if (captureSeries) {
          batteryChargeHourlyKW[hour] = chargeFromSolarKW;
        }
      }

      const residualChemicalKW = Math.max(0, solarKW);
      const chemicalKW = chemicalCapacityKW === null
        ? residualChemicalKW
        : Math.min(residualChemicalKW, chemicalCapacityKW);
      const clippedKW = Math.max(0, residualChemicalKW - chemicalKW);
      aiServedKWh += aiServed;
      aiShortfallKWh += Math.max(0, loadKW - aiServed);
      chemicalKWh += chemicalKW;
      clippedSolarKWh += clippedKW;
      chemicalPeakKW = Math.max(chemicalPeakKW, chemicalKW);
      minSocKWh = Math.min(minSocKWh, socKWh);
      maxSocKWh = Math.max(maxSocKWh, socKWh);

      if (opThresholdKW !== null && opThresholdKW > 1e-9 && chemicalKW >= opThresholdKW - 1e-6) {
        chemicalOpHours += 1;
      }

      if (loadKW <= 1e-9 || aiServed >= loadKW - 1e-6) fullPowerHours += 1;
      else curtailedHours += 1;

      if (captureSeries) {
        aiHourlyKW[hour] = aiServed;
        chemicalHourlyKW[hour] = chemicalKW;
        clippedHourlyKW[hour] = clippedKW;
      } else if (captureDailySummaries) {
        this.accumulateSeriesStepBySpanHours(dailyAiSummaryKWh, summaryWindowHours, hour, aiServed);
        this.accumulateSeriesStepBySpanHours(dailyBatteryChargeSummaryKWh, summaryWindowHours, hour, chargeFromSolarKW);
        this.accumulateSeriesStepBySpanHours(dailyChemicalSummaryKWh, summaryWindowHours, hour, chemicalKW);
        this.accumulateSeriesStepBySpanHours(dailyClippedSummaryKWh, summaryWindowHours, hour, clippedKW);
      }
    }

    const demandKWh = loadKW * hours;
    const dailyAiKWh = captureSeries ? this.aggregateSeriesBySpanHours(aiHourlyKW, summaryWindowHours) : dailyAiSummaryKWh;
    const dailyBatteryChargeKWh = captureSeries ? this.aggregateSeriesBySpanHours(batteryChargeHourlyKW, summaryWindowHours) : dailyBatteryChargeSummaryKWh;
    const dailyChemicalKWh = captureSeries ? this.aggregateSeriesBySpanHours(chemicalHourlyKW, summaryWindowHours) : dailyChemicalSummaryKWh;
    const dailyClippedKWh = captureSeries ? this.aggregateSeriesBySpanHours(clippedHourlyKW, summaryWindowHours) : dailyClippedSummaryKWh;
    const averageDayAiKW = captureSeries ? this.averageSeriesByCyclePhase(aiHourlyKW, summaryWindowHours, summaryBinCount) : [];
    const averageDayBatteryChargeKW = captureSeries ? this.averageSeriesByCyclePhase(batteryChargeHourlyKW, summaryWindowHours, summaryBinCount) : [];
    const averageDayChemicalKW = captureSeries ? this.averageSeriesByCyclePhase(chemicalHourlyKW, summaryWindowHours, summaryBinCount) : [];
    const averageDayClippedKW = captureSeries ? this.averageSeriesByCyclePhase(clippedHourlyKW, summaryWindowHours, summaryBinCount) : [];
    const resolvedChemicalOpHours = captureSeries && opThresholdKW !== null && opThresholdKW > 1e-9
      ? chemicalHourlyKW.reduce((sum, value) => sum + (value >= opThresholdKW - 1e-6 ? 1 : 0), 0)
      : captureSeries && chemicalPeakKW > 0
        ? chemicalHourlyKW.reduce((sum, value) => sum + (value >= chemicalPeakKW * 0.05 ? 1 : 0), 0)
      : chemicalOpHours;

    return {
      hours,
      loadKW,
      aiHourlyKW,
      chemicalHourlyKW,
      clippedHourlyKW,
      aiServedKWh,
      aiShortfallKWh,
      chemicalKWh,
      clippedSolarKWh,
      demandKWh,
      utilization: demandKWh > 0 ? aiServedKWh / demandKWh : 0,
      fullPowerReliability: hours > 0 ? fullPowerHours / hours : 1,
      fullPowerHours,
      curtailedHours,
      dailyAiKWh,
      dailyBatteryChargeKWh,
      dailyChemicalKWh,
      dailyClippedKWh,
      averageDayAiKW,
      averageDayBatteryChargeKW,
      averageDayChemicalKW,
      averageDayClippedKW,
      batteryChargeHourlyKW,
      chemicalPeakKW,
      chemicalCapacityKW: chemicalCapacityKW ?? chemicalPeakKW,
      chemicalOpHours: resolvedChemicalOpHours,
      chargeThroughputKWh,
      dischargeThroughputKWh,
      startSocKWh: Math.max(0, Math.min(battCapKWh, startSocKWh)),
      endSocKWh: socKWh,
      minSocKWh,
      maxSocKWh,
      utilizedCapacityKWh: Math.max(0, maxSocKWh - minSocKWh),
    };
  },

  simulateAnnualDispatchWithConstantAiLoad(state, annualSolar, loadKW, options = {}) {
    const captureSeries = options.captureSeries !== false;
    const captureDailySummaries = Boolean(options.captureDailySummaries);
    const chemicalCapacityKW = Number.isFinite(options.chemicalCapacityKW) ? Math.max(0, options.chemicalCapacityKW) : null;
    const batteryEnabled = this.hasBatteryStorage(state);
    const battCapKWh = batteryEnabled ? Math.max(0, (state.batteryCapacityMWh || 0) * 1000) : 0;
    const settleTolKWh = Math.max(1e-3, battCapKWh * 1e-6);

    const finalizeDispatch = dispatch => {
      const resolvedOpThresholdKW = Number.isFinite(options.opThresholdKW)
        ? Math.max(0, options.opThresholdKW)
        : (chemicalCapacityKW !== null && chemicalCapacityKW > 0
            ? chemicalCapacityKW * 0.05
            : (dispatch.chemicalPeakKW > 0 ? dispatch.chemicalPeakKW * 0.05 : null));
      if (captureSeries || resolvedOpThresholdKW === null) {
        return {
          ...dispatch,
          chemicalCapacityKW: chemicalCapacityKW ?? dispatch.chemicalPeakKW,
        };
      }
      const summarized = this.simulateAnnualDispatchPass(state, annualSolar, loadKW, dispatch.startSocKWh, {
        captureSeries: false,
        chemicalCapacityKW,
        opThresholdKW: resolvedOpThresholdKW,
      });
      return {
        ...dispatch,
        chemicalOpHours: summarized.chemicalOpHours,
        chemicalCapacityKW: chemicalCapacityKW ?? dispatch.chemicalPeakKW,
      };
    };

    if (!batteryEnabled) {
      return finalizeDispatch({
        ...this.simulateAnnualDispatchPass(state, annualSolar, loadKW, 0, {
          captureSeries,
          captureDailySummaries,
          chemicalCapacityKW,
        }),
        settleIterations: 1,
        settleDeltaKWh: 0,
      });
    }

    let startSocKWh = battCapKWh * 0.5;
    let settleIterations = 0;

    for (; settleIterations < 24; settleIterations++) {
      const preview = this.simulateAnnualDispatchPass(state, annualSolar, loadKW, startSocKWh, {
        captureSeries: false,
        chemicalCapacityKW,
      });
      const settleDeltaKWh = Math.abs(preview.endSocKWh - startSocKWh);
      startSocKWh = preview.endSocKWh;
      if (settleDeltaKWh <= settleTolKWh) {
        break;
      }
    }

    const captured = this.simulateAnnualDispatchPass(state, annualSolar, loadKW, startSocKWh, {
      captureSeries,
      captureDailySummaries,
      chemicalCapacityKW,
    });
    return finalizeDispatch({
      ...captured,
      settleIterations: settleIterations + 1,
      settleDeltaKWh: Math.abs(captured.endSocKWh - captured.startSocKWh),
    });
  },

  buildAnnualDispatchDisplaySeries(state, dispatch) {
    if ((state.body || 'earth') !== 'mars') return null;
    const dayLabels = dispatch.dayLabels || [];
    const dailyAiKWh = dispatch.dailyAiKWh || [];
    const dailyChemicalKWh = dispatch.dailyChemicalKWh || [];
    if (!dayLabels.length || dayLabels.length !== dailyAiKWh.length || dayLabels.length !== dailyChemicalKWh.length) return null;

    return {
      dayLabels,
      dailyAiKWh,
      dailyChemicalKWh,
    };
  },

  attachAnnualDispatchDisplaySeries(state, dispatchSolar, dispatch, horizonLabel = 'earth-year', options = {}) {
    const includeDisplaySeries = options.includeDisplaySeries !== false;
    const includeSolarSummary = options.includeSolarSummary !== false;
    const mergedDispatch = {
      ...dispatch,
      dayLabels: includeSolarSummary ? (dispatchSolar.dayLabels || dispatch.dayLabels || []) : [],
      averageDaySolarKW: includeSolarSummary ? (dispatchSolar.averageDayKW || []) : [],
      dispatchBasisLabel: horizonLabel,
    };
    if (!includeDisplaySeries) return mergedDispatch;

    const displaySeries = this.buildAnnualDispatchDisplaySeries(state, mergedDispatch);
    if (!displaySeries) return mergedDispatch;

    return {
      ...mergedDispatch,
      displayDayLabels: displaySeries.dayLabels,
      displayDailyAiKWh: displaySeries.dailyAiKWh,
      displayDailyChemicalKWh: displaySeries.dailyChemicalKWh,
    };
  },

  buildAnnualStorageSummary(state, dispatch, batteryCapex, batteryLifeYears) {
    const batteryEnabled = this.hasBatteryStorage(state);
    return {
      enabled: batteryEnabled,
      capex: batteryEnabled ? batteryCapex : 0,
      battCapKWh: batteryEnabled ? (state.batteryCapacityMWh || 0) * 1000 : 0,
      annualizedCapex: batteryEnabled ? batteryCapex * this.crf(state.discountRate / 100, batteryLifeYears) : 0,
      lifetimeYears: batteryEnabled ? batteryLifeYears : 0,
      utilizedCapacityKWh: batteryEnabled ? (dispatch.utilizedCapacityKWh || 0) : 0,
      startBatteryKWh: batteryEnabled ? (dispatch.startSocKWh || 0) : 0,
      endBatteryKWh: batteryEnabled ? (dispatch.endSocKWh || 0) : 0,
      minBatteryKWh: batteryEnabled ? (dispatch.minSocKWh || 0) : 0,
      maxBatteryKWh: batteryEnabled ? (dispatch.maxSocKWh || 0) : 0,
      chargeThroughputKWh: batteryEnabled ? (dispatch.chargeThroughputKWh || 0) : 0,
      dischargeThroughputKWh: batteryEnabled ? (dispatch.dischargeThroughputKWh || 0) : 0,
      settleDeltaKWh: batteryEnabled ? (dispatch.settleDeltaKWh || 0) : 0,
    };
  },

  buildAnnualChemicalSupplySummary(dispatch, solar, cyclesPerYear, annualizationFactor = 1, options = {}) {
    const includeSeries = options.includeSeries !== false;
    const totalAverageDayKW = includeSeries
      ? (dispatch.averageDayChemicalKW || []).reduce((sum, value) => sum + value, 0)
      : 0;
    const processPowerKW = Number.isFinite(dispatch.chemicalCapacityKW)
      ? Math.max(0, dispatch.chemicalCapacityKW)
      : (dispatch.chemicalPeakKW || 0);
    const annualizedChemicalKWh = (dispatch.chemicalKWh || 0) * annualizationFactor;
    const annualizedClippedKWh = (dispatch.clippedSolarKWh || 0) * annualizationFactor;
    const annualizedFullCaptureChemicalKWh = (dispatch.fullCaptureChemicalKWh || dispatch.chemicalKWh || 0) * annualizationFactor;
    const annualizedChemicalOpHours = (dispatch.chemicalOpHours || 0) * annualizationFactor;
    const fullCapturePowerKW = Number.isFinite(dispatch.fullCaptureChemicalKW)
      ? Math.max(0, dispatch.fullCaptureChemicalKW)
      : processPowerKW;
    return {
      effectiveCF: processPowerKW > 0
        ? dispatch.chemicalKWh / (processPowerKW * Math.max(dispatch.hours || dispatch.aiHourlyKW.length, 1))
        : 0,
      dailyOpHours: annualizedChemicalOpHours / Math.max(cyclesPerYear, 1),
      dailyAvailableKWh: annualizedChemicalKWh / Math.max(cyclesPerYear, 1),
      clippedDailyKWh: annualizedClippedKWh / Math.max(cyclesPerYear, 1),
      hourlyProfile: includeSeries && totalAverageDayKW > 0
        ? dispatch.averageDayChemicalKW.map(value => value / totalAverageDayKW)
        : [],
      hourlyKW: includeSeries ? (dispatch.averageDayChemicalKW || []) : [],
      clippedHourlyKW: includeSeries ? (dispatch.averageDayClippedKW || []) : [],
      batteryChargeHourlyKW: includeSeries ? (dispatch.averageDayBatteryChargeKW || []) : [],
      processPowerKW,
      fullCapturePowerKW,
      fullCaptureDailyKWh: annualizedFullCaptureChemicalKWh / Math.max(cyclesPerYear, 1),
      capturedSolarFraction: annualizedFullCaptureChemicalKWh > 0
        ? annualizedChemicalKWh / annualizedFullCaptureChemicalKWh
        : 1,
      sizingPercent: dispatch.chemicalSizingPercent ?? DEFAULT_STATE.chemicalSizingPercent,
      baseloadKW: dispatch.loadKW || 0,
      clipKW: Math.max(0, fullCapturePowerKW - processPowerKW),
    };
  },

  calculateAICompute(state, solar, annualSolar, options = {}) {
    const captureDispatchSeries = options.captureDispatchSeries !== false;
    const includeDisplayDispatchSeries = options.includeDisplayDispatchSeries !== false;
    const captureDailySummaries = Boolean(options.captureDailySummaries);
    const chemicalSizingFraction = this.getChemicalSizingFraction(state);
    const cyclesPerYear = this.getBodyConfig(state.body || 'earth').cyclesPerEarthYear;
    const dispatchBasis = this.getAnnualDispatchBasis(state, solar, annualSolar, {
      includeWindowSummaries: captureDispatchSeries || includeDisplayDispatchSeries,
    });
    const dispatchSolar = dispatchBasis.solar;
    const annualizationFactor = dispatchBasis.annualizationFactor;
    const dispatchHorizonLabel = dispatchBasis.horizonLabel;
    const hours = Array.isArray(dispatchSolar?.hourlyKW) ? dispatchSolar.hourlyKW.length : 0;
    const targetReliability = Math.max(0.0001, Math.min(0.99999, (state.aiReliabilityTarget || 99.9) / 100));
    const batteryEnabled = this.hasBatteryStorage(state);
    const batteryCapex = batteryEnabled ? Math.max(0, (state.batteryCapacityMWh || 0) * 1000 * (state.batteryCostPerKWh || 0)) : 0;
    const batteryLifeYears = batteryEnabled
      ? Math.max(1, Math.min(MODEL_ASSUMPTIONS.batteryNominalLifeYears, (state.batteryCycles || 0) / Math.max(1, cyclesPerYear)))
      : 0;
    const disabledDispatch = this.simulateAnnualDispatchWithConstantAiLoad(state, dispatchSolar, 0, {
      captureSeries: captureDispatchSeries,
      captureDailySummaries,
    });

    if (!state.aiComputeEnabled || hours <= 0) {
      const annualChemicalKWh = disabledDispatch.chemicalKWh * annualizationFactor;
      return {
        enabled: false,
        reliabilityTarget: targetReliability * 100,
        designLoadKW: 0,
        annualTokensM: 0,
        annualRevenue: 0,
        tokensPerKWYearM: 0,
        utilization: 0,
        fullPowerReliability: 1,
        fullPowerHours: hours * annualizationFactor,
        curtailedHours: 0,
        averageDailyTokensM: 0,
        averageDailyChemicalMWh: annualChemicalKWh / Math.max(cyclesPerYear, 1) / 1000,
        chemicalAnnualKWh: annualChemicalKWh,
        chemicalPeakKW: disabledDispatch.chemicalPeakKW,
        chemicalDailyOpHours: (disabledDispatch.chemicalOpHours * annualizationFactor) / Math.max(cyclesPerYear, 1),
        capex: 0,
        annualizedCapex: 0,
        annualOM: 0,
        assetLifeYears: state.aiAssetLifeYears || AI_COMPUTE_DEFAULTS.assetLifeYears,
        dispatch: this.attachAnnualDispatchDisplaySeries(state, dispatchSolar, disabledDispatch, dispatchHorizonLabel, {
          includeDisplaySeries: includeDisplayDispatchSeries,
          includeSolarSummary: captureDispatchSeries || includeDisplayDispatchSeries,
        }),
        storage: this.buildAnnualStorageSummary(state, disabledDispatch, batteryCapex, batteryLifeYears),
        chemicalSupply: this.buildAnnualChemicalSupplySummary(disabledDispatch, solar, cyclesPerYear, annualizationFactor, {
          includeSeries: captureDispatchSeries,
        }),
      };
    }

    const averageSolarKW = (dispatchSolar.totalKWh || 0) / Math.max(hours, 1);
    const peakSolarKW = Array.isArray(dispatchSolar?.hourlyKW) ? Math.max(...dispatchSolar.hourlyKW, 0) : 0;
    let lo = 0;
    let hi = Math.max(1, averageSolarKW / targetReliability, peakSolarKW);
    let best = this.simulateAnnualDispatchWithConstantAiLoad(state, dispatchSolar, 0, { captureSeries: false });

    while (hi < 1e9) {
      const upperBoundDispatch = this.simulateAnnualDispatchWithConstantAiLoad(state, dispatchSolar, hi, { captureSeries: false });
      if (upperBoundDispatch.fullPowerReliability < targetReliability) {
        break;
      }
      best = upperBoundDispatch;
      lo = hi;
      hi *= 2;
    }

    for (let i = 0; i < 50; i++) {
      const mid = (lo + hi) / 2;
      const dispatch = this.simulateAnnualDispatchWithConstantAiLoad(state, dispatchSolar, mid, { captureSeries: false });
      if (dispatch.fullPowerReliability >= targetReliability) {
        best = dispatch;
        lo = mid;
      } else {
        hi = mid;
      }
    }

    const fullCaptureDispatch = this.simulateAnnualDispatchWithConstantAiLoad(state, dispatchSolar, best.loadKW, {
      captureSeries: false,
    });
    const chemicalCapacityKW = (fullCaptureDispatch.chemicalPeakKW || 0) * chemicalSizingFraction;
    const finalDispatch = {
      ...this.simulateAnnualDispatchWithConstantAiLoad(state, dispatchSolar, best.loadKW, {
        captureSeries: captureDispatchSeries,
        captureDailySummaries,
        chemicalCapacityKW,
      }),
      fullCaptureChemicalKW: fullCaptureDispatch.chemicalPeakKW || 0,
      fullCaptureChemicalKWh: fullCaptureDispatch.chemicalKWh || 0,
      chemicalSizingPercent: state.chemicalSizingPercent ?? DEFAULT_STATE.chemicalSizingPercent,
    };
    const annualAiServedKWh = finalDispatch.aiServedKWh * annualizationFactor;
    const annualChemicalKWh = finalDispatch.chemicalKWh * annualizationFactor;
    const annualTokensM = (annualAiServedKWh / 1000) * (state.aiMillionTokensPerMWh || 0);
    const gpuCapexPerKW = state.aiGpuCapexPerKW ?? AI_COMPUTE_DEFAULTS.capexPerKW;
    const capex = finalDispatch.loadKW * gpuCapexPerKW;
    const annualizedCapex = capex * this.crf(state.discountRate / 100, state.aiAssetLifeYears || AI_COMPUTE_DEFAULTS.assetLifeYears);
    const annualOM = capex * ((AI_COMPUTE_DEFAULTS.omPercent || 0) / 100);

    return {
      enabled: true,
      reliabilityTarget: targetReliability * 100,
      designLoadKW: finalDispatch.loadKW,
      annualTokensM,
      annualRevenue: annualTokensM * (state.aiTokenPricePerM || 0),
      tokensPerKWYearM: finalDispatch.loadKW > 0 ? annualTokensM / finalDispatch.loadKW : 0,
      utilization: finalDispatch.utilization,
      fullPowerReliability: finalDispatch.fullPowerReliability,
      fullPowerHours: finalDispatch.fullPowerHours * annualizationFactor,
      curtailedHours: finalDispatch.curtailedHours * annualizationFactor,
      averageDailyTokensM: annualTokensM / Math.max(cyclesPerYear, 1),
      averageDailyChemicalMWh: annualChemicalKWh / Math.max(cyclesPerYear, 1) / 1000,
      chemicalAnnualKWh: annualChemicalKWh,
      chemicalPeakKW: finalDispatch.chemicalCapacityKW ?? finalDispatch.chemicalPeakKW,
      chemicalDailyOpHours: (finalDispatch.chemicalOpHours * annualizationFactor) / Math.max(cyclesPerYear, 1),
      capex,
      annualizedCapex,
      annualOM,
      assetLifeYears: state.aiAssetLifeYears || AI_COMPUTE_DEFAULTS.assetLifeYears,
      dispatch: this.attachAnnualDispatchDisplaySeries(state, dispatchSolar, finalDispatch, dispatchHorizonLabel, {
        includeDisplaySeries: includeDisplayDispatchSeries,
        includeSolarSummary: captureDispatchSeries || includeDisplayDispatchSeries,
      }),
      storage: this.buildAnnualStorageSummary(state, finalDispatch, batteryCapex, batteryLifeYears),
      chemicalSupply: this.buildAnnualChemicalSupplySummary(finalDispatch, solar, cyclesPerYear, annualizationFactor, {
        includeSeries: captureDispatchSeries,
      }),
    };
  },
});
