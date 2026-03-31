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

  buildMarsSeasonalSolarSeries(state, solar, totalHours, seriesKWhTarget) {
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

    return {
      bodyKey,
      hourlyKW,
      dayLabels: this.buildAnnualWindowLabels(bodyKey, windowCount, cycleHours, hourlyKW.length),
      dailyKWh: this.aggregateSeriesBySpanHours(hourlyKW, cycleHours),
      averageDayKW: this.averageSeriesByCyclePhase(hourlyKW, cycleHours, binCount),
      totalKWh: hourlyKW.reduce((sum, value) => sum + value, 0),
      windowHours: cycleHours,
      windowBinCount: binCount,
      seasonalVariation: true,
    };
  },

  buildMarsOrbitalDispatchBasis(state, solar) {
    const body = this.getBodyConfig('mars');
    const orbitalSols = 668.6;
    const annualizationFactor = Math.max(1e-9, Math.max(body.cyclesPerEarthYear || 0, 1) / orbitalSols);
    return {
      solar: this.buildMarsSeasonalSolarSeries(
        state,
        solar,
        orbitalSols * Math.max(1e-6, body.cycleHours || 24.66),
        Math.max(0, (solar.annualMWh || 0) * 1000) / annualizationFactor
      ),
      annualizationFactor,
      horizonLabel: 'orbital-year',
    };
  },

  getAnnualDispatchBasis(state, solar, annualSolar) {
    if ((state.body || 'earth') === 'mars') return this.buildMarsOrbitalDispatchBasis(state, solar);
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

  buildAnnualSolarSeries(state, solar) {
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
      return {
        bodyKey,
        hourlyKW,
        dayLabels: this.buildAnnualWindowLabels(bodyKey, 365, windowHours, hourlyKW.length),
        dailyKWh: this.aggregateSeriesByWindow(hourlyKW, windowHours),
        averageDayKW: this.averageHourlyByWindow(hourlyKW, windowHours),
        totalKWh: hourlyKW.reduce((sum, value) => sum + value, 0),
        windowHours,
        windowBinCount: 24,
        seasonalVariation: true,
      };
    }

    const cycleHours = Math.max(1e-6, body.cycleHours || 24);
    const binCount = Math.max(1, solar.hourlyProfile.length);
    const totalHours = 24 * 365;

    if (bodyKey === 'mars') {
      return this.buildMarsSeasonalSolarSeries(state, solar, totalHours, annualKWhTarget);
    }

    const normalized = this.sampleRepeatingProfileByHour(solar.hourlyProfile, cycleHours, totalHours);
    const hourlyKW = this.scaleRawSeriesToAnnualEnergy(normalized, annualKWhTarget, peakKW);
    const windowCount = Math.ceil(hourlyKW.length / cycleHours);
    return {
      bodyKey,
      hourlyKW,
      dayLabels: this.buildAnnualWindowLabels(bodyKey, windowCount, cycleHours, hourlyKW.length),
      dailyKWh: this.aggregateSeriesBySpanHours(hourlyKW, cycleHours),
      averageDayKW: this.averageSeriesByCyclePhase(hourlyKW, cycleHours, binCount),
      totalKWh: hourlyKW.reduce((sum, value) => sum + value, 0),
      windowHours: cycleHours,
      windowBinCount: binCount,
      seasonalVariation: false,
    };
  },

  simulateAnnualDispatchPass(state, annualSolar, loadKW, startSocKWh, captureSeries = false) {
    const source = Array.isArray(annualSolar?.hourlyKW) ? annualSolar.hourlyKW : [];
    const hours = source.length;
    const summaryWindowHours = Math.max(1e-6, annualSolar?.windowHours || 24);
    const summaryBinCount = Math.max(1, Math.round(annualSolar?.windowBinCount || 24));
    const batteryEnabled = this.hasBatteryStorage(state);
    const battCapKWh = batteryEnabled ? Math.max(0, (state.batteryCapacityMWh || 0) * 1000) : 0;
    const rtEff = battCapKWh > 0 ? Math.max(0, Math.min(1, (state.batteryEfficiency || 0) / 100)) : 1;
    const chargeEff = battCapKWh > 0 ? Math.sqrt(Math.max(rtEff, 1e-9)) : 1;
    const dischargeEff = battCapKWh > 0 ? Math.sqrt(Math.max(rtEff, 1e-9)) : 1;
    const leakageRetentionPerStep = this.getBatteryLeakageRetention(1);
    const aiHourlyKW = captureSeries ? new Array(hours).fill(0) : [];
    const chemicalHourlyKW = captureSeries ? new Array(hours).fill(0) : [];
    const batteryChargeHourlyKW = captureSeries ? new Array(hours).fill(0) : [];
    let socKWh = Math.max(0, Math.min(battCapKWh, startSocKWh));
    let minSocKWh = socKWh;
    let maxSocKWh = socKWh;

    let aiServedKWh = 0;
    let aiShortfallKWh = 0;
    let chemicalKWh = 0;
    let fullPowerHours = 0;
    let curtailedHours = 0;
    let chargeThroughputKWh = 0;
    let dischargeThroughputKWh = 0;

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

      if (solarKW > 1e-9 && battCapKWh > 0 && socKWh < battCapKWh - 1e-9) {
        const storedKWh = Math.min(battCapKWh - socKWh, solarKW * chargeEff);
        const chargeFromSolarKW = storedKWh / chargeEff;
        socKWh += storedKWh;
        solarKW -= chargeFromSolarKW;
        chargeThroughputKWh += storedKWh;
        if (captureSeries) {
          batteryChargeHourlyKW[hour] = chargeFromSolarKW;
        }
      }

      const chemicalKW = Math.max(0, solarKW);
      aiServedKWh += aiServed;
      aiShortfallKWh += Math.max(0, loadKW - aiServed);
      chemicalKWh += chemicalKW;
      minSocKWh = Math.min(minSocKWh, socKWh);
      maxSocKWh = Math.max(maxSocKWh, socKWh);

      if (loadKW <= 1e-9 || aiServed >= loadKW - 1e-6) fullPowerHours += 1;
      else curtailedHours += 1;

      if (captureSeries) {
        aiHourlyKW[hour] = aiServed;
        chemicalHourlyKW[hour] = chemicalKW;
      }
    }

    const demandKWh = loadKW * hours;
    const dailyAiKWh = captureSeries ? this.aggregateSeriesBySpanHours(aiHourlyKW, summaryWindowHours) : [];
    const dailyBatteryChargeKWh = captureSeries ? this.aggregateSeriesBySpanHours(batteryChargeHourlyKW, summaryWindowHours) : [];
    const dailyChemicalKWh = captureSeries ? this.aggregateSeriesBySpanHours(chemicalHourlyKW, summaryWindowHours) : [];
    const averageDayAiKW = captureSeries ? this.averageSeriesByCyclePhase(aiHourlyKW, summaryWindowHours, summaryBinCount) : [];
    const averageDayBatteryChargeKW = captureSeries ? this.averageSeriesByCyclePhase(batteryChargeHourlyKW, summaryWindowHours, summaryBinCount) : [];
    const averageDayChemicalKW = captureSeries ? this.averageSeriesByCyclePhase(chemicalHourlyKW, summaryWindowHours, summaryBinCount) : [];
    const chemicalPeakKW = captureSeries ? Math.max(...chemicalHourlyKW, 0) : 0;
    const chemicalOpHours = chemicalPeakKW > 0
      ? chemicalHourlyKW.reduce((sum, value) => sum + (value >= chemicalPeakKW * 0.05 ? 1 : 0), 0)
      : 0;

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
      startSocKWh: Math.max(0, Math.min(battCapKWh, startSocKWh)),
      endSocKWh: socKWh,
      minSocKWh,
      maxSocKWh,
      utilizedCapacityKWh: Math.max(0, maxSocKWh - minSocKWh),
    };
  },

  simulateAnnualDispatchWithConstantAiLoad(state, annualSolar, loadKW) {
    const batteryEnabled = this.hasBatteryStorage(state);
    const battCapKWh = batteryEnabled ? Math.max(0, (state.batteryCapacityMWh || 0) * 1000) : 0;
    const settleTolKWh = Math.max(1e-3, battCapKWh * 1e-6);

    if (!batteryEnabled) {
      return {
        ...this.simulateAnnualDispatchPass(state, annualSolar, loadKW, 0, true),
        settleIterations: 1,
        settleDeltaKWh: 0,
      };
    }

    let startSocKWh = battCapKWh * 0.5;
    let settleIterations = 0;

    for (; settleIterations < 24; settleIterations++) {
      const preview = this.simulateAnnualDispatchPass(state, annualSolar, loadKW, startSocKWh, false);
      const settleDeltaKWh = Math.abs(preview.endSocKWh - startSocKWh);
      startSocKWh = preview.endSocKWh;
      if (settleDeltaKWh <= settleTolKWh) {
        break;
      }
    }

    const captured = this.simulateAnnualDispatchPass(state, annualSolar, loadKW, startSocKWh, true);
    return {
      ...captured,
      settleIterations: settleIterations + 1,
      settleDeltaKWh: Math.abs(captured.endSocKWh - captured.startSocKWh),
    };
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

  attachAnnualDispatchDisplaySeries(state, dispatchSolar, dispatch, horizonLabel = 'earth-year') {
    const mergedDispatch = {
      ...dispatch,
      dayLabels: dispatchSolar.dayLabels || dispatch.dayLabels || [],
      averageDaySolarKW: dispatchSolar.averageDayKW || [],
      dispatchBasisLabel: horizonLabel,
    };
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

  buildAnnualChemicalSupplySummary(dispatch, solar, cyclesPerYear, annualizationFactor = 1) {
    const totalAverageDayKW = (dispatch.averageDayChemicalKW || []).reduce((sum, value) => sum + value, 0);
    const annualizedChemicalKWh = (dispatch.chemicalKWh || 0) * annualizationFactor;
    const annualizedChemicalOpHours = (dispatch.chemicalOpHours || 0) * annualizationFactor;
    return {
      effectiveCF: dispatch.chemicalPeakKW > 0
        ? dispatch.chemicalKWh / (dispatch.chemicalPeakKW * Math.max(dispatch.aiHourlyKW.length, 1))
        : 0,
      dailyOpHours: annualizedChemicalOpHours / Math.max(cyclesPerYear, 1),
      dailyAvailableKWh: annualizedChemicalKWh / Math.max(cyclesPerYear, 1),
      hourlyProfile: totalAverageDayKW > 0
        ? dispatch.averageDayChemicalKW.map(value => value / totalAverageDayKW)
        : solar.hourlyProfile,
      hourlyKW: dispatch.averageDayChemicalKW || [],
      batteryChargeHourlyKW: dispatch.averageDayBatteryChargeKW || [],
      processPowerKW: dispatch.chemicalPeakKW || 0,
      baseloadKW: dispatch.loadKW || 0,
      clipKW: 0,
    };
  },

  calculateAICompute(state, solar, annualSolar) {
    const cyclesPerYear = this.getBodyConfig(state.body || 'earth').cyclesPerEarthYear;
    const dispatchBasis = this.getAnnualDispatchBasis(state, solar, annualSolar);
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
    const disabledDispatch = this.simulateAnnualDispatchWithConstantAiLoad(state, dispatchSolar, 0);

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
        dispatch: this.attachAnnualDispatchDisplaySeries(state, dispatchSolar, disabledDispatch, dispatchHorizonLabel),
        storage: this.buildAnnualStorageSummary(state, disabledDispatch, batteryCapex, batteryLifeYears),
        chemicalSupply: this.buildAnnualChemicalSupplySummary(disabledDispatch, solar, cyclesPerYear, annualizationFactor),
      };
    }

    const averageSolarKW = (dispatchSolar.totalKWh || 0) / Math.max(hours, 1);
    const peakSolarKW = Array.isArray(dispatchSolar?.hourlyKW) ? Math.max(...dispatchSolar.hourlyKW, 0) : 0;
    let lo = 0;
    let hi = Math.max(1, averageSolarKW / targetReliability, peakSolarKW);
    let best = this.simulateAnnualDispatchWithConstantAiLoad(state, dispatchSolar, 0);

    while (hi < 1e9) {
      const upperBoundDispatch = this.simulateAnnualDispatchWithConstantAiLoad(state, dispatchSolar, hi);
      if (upperBoundDispatch.fullPowerReliability < targetReliability) {
        break;
      }
      best = upperBoundDispatch;
      lo = hi;
      hi *= 2;
    }

    for (let i = 0; i < 50; i++) {
      const mid = (lo + hi) / 2;
      const dispatch = this.simulateAnnualDispatchWithConstantAiLoad(state, dispatchSolar, mid);
      if (dispatch.fullPowerReliability >= targetReliability) {
        best = dispatch;
        lo = mid;
      } else {
        hi = mid;
      }
    }

    const annualAiServedKWh = best.aiServedKWh * annualizationFactor;
    const annualChemicalKWh = best.chemicalKWh * annualizationFactor;
    const annualTokensM = (annualAiServedKWh / 1000) * (state.aiMillionTokensPerMWh || 0);
    const gpuCapexPerKW = state.aiGpuCapexPerKW ?? AI_COMPUTE_DEFAULTS.capexPerKW;
    const capex = best.loadKW * gpuCapexPerKW;
    const annualizedCapex = capex * this.crf(state.discountRate / 100, state.aiAssetLifeYears || AI_COMPUTE_DEFAULTS.assetLifeYears);
    const annualOM = capex * ((AI_COMPUTE_DEFAULTS.omPercent || 0) / 100);

    return {
      enabled: true,
      reliabilityTarget: targetReliability * 100,
      designLoadKW: best.loadKW,
      annualTokensM,
      annualRevenue: annualTokensM * (state.aiTokenPricePerM || 0),
      tokensPerKWYearM: best.loadKW > 0 ? annualTokensM / best.loadKW : 0,
      utilization: best.utilization,
      fullPowerReliability: best.fullPowerReliability,
      fullPowerHours: best.fullPowerHours * annualizationFactor,
      curtailedHours: best.curtailedHours * annualizationFactor,
      averageDailyTokensM: annualTokensM / Math.max(cyclesPerYear, 1),
      averageDailyChemicalMWh: annualChemicalKWh / Math.max(cyclesPerYear, 1) / 1000,
      chemicalAnnualKWh: annualChemicalKWh,
      chemicalPeakKW: best.chemicalPeakKW,
      chemicalDailyOpHours: (best.chemicalOpHours * annualizationFactor) / Math.max(cyclesPerYear, 1),
      capex,
      annualizedCapex,
      annualOM,
      assetLifeYears: state.aiAssetLifeYears || AI_COMPUTE_DEFAULTS.assetLifeYears,
      dispatch: this.attachAnnualDispatchDisplaySeries(state, dispatchSolar, best, dispatchHorizonLabel),
      storage: this.buildAnnualStorageSummary(state, best, batteryCapex, batteryLifeYears),
      chemicalSupply: this.buildAnnualChemicalSupplySummary(best, solar, cyclesPerYear, annualizationFactor),
    };
  },
});
