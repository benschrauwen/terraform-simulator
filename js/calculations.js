/* ============================================
   Calculations: Solar, Processes, Economics
   ============================================ */

const Calc = {

  getBodyConfig(bodyKey) {
    return PLANETARY_BODIES[bodyKey] || PLANETARY_BODIES.earth;
  },

  getNearbyPreset(lat, lon, bodyKey = 'earth') {
    return LOCATION_PRESETS.find(loc =>
      (loc.body || 'earth') === bodyKey &&
      Math.abs(lat - loc.lat) < 2 && Math.abs(lon - loc.lon) < 3
    );
  },

  estimateGHI(lat, lon, bodyKey = 'earth') {
    const preset = this.getNearbyPreset(lat, lon, bodyKey);
    if (preset) return preset.ghi;
    if (bodyKey !== 'earth') return 0;

    const absLat = Math.abs(lat);
    let baseGHI;
    if (absLat <= 10) baseGHI = 1950;
    else if (absLat <= 20) baseGHI = 2100 + (20 - absLat) * 10;
    else if (absLat <= 30) baseGHI = 2000 + (30 - absLat) * 10;
    else if (absLat <= 40) baseGHI = 1700 - (absLat - 30) * 20;
    else if (absLat <= 50) baseGHI = 1400 - (absLat - 40) * 35;
    else if (absLat <= 60) baseGHI = 1050 - (absLat - 50) * 25;
    else baseGHI = 800 - (absLat - 60) * 15;

    if (absLat >= 18 && absLat <= 35) {
      const isArid = (lon > -120 && lon < -100 && lat > 25) ||
        (lon > -15 && lon < 50 && lat > 15 && lat < 35) ||
        (lon > 65 && lon < 80 && lat > 22 && lat < 30) ||
        (lon > 115 && lon < 135 && lat < -18 && lat > -28);
      if (isArid) baseGHI *= 1.15;
    }

    return Math.round(Math.max(600, Math.min(2900, baseGHI)));
  },

  estimateBaseYield(lat, lon, ghi, bodyKey = 'earth') {
    const preset = this.getNearbyPreset(lat, lon, bodyKey);
    if (preset) return preset.baseYield;
    if (bodyKey !== 'earth') return Math.round(Math.max(0, ghi));
    return Math.round(ghi * MODEL_ASSUMPTIONS.fallbackYieldFromGhi);
  },

  getResourceSource(state, preset) {
    if (state.siteYieldSource === 'manual') return 'Manual annual yield';
    if (state.siteYieldSource === 'planetary-custom') return 'Carry-over annual yield (planetary custom site; no latitude heuristic)';
    if (preset) {
      return (state.body || 'earth') === 'earth'
        ? 'Preset annual yield (cloud/weather-adjusted benchmark)'
        : 'Preset annual yield (planetary benchmark)';
    }
    return 'Estimated annual yield (latitude/GHI heuristic, not a cloud dataset)';
  },

  getSolarGeometry(state, body, mountingKey) {
    const profileModel = state.solarProfileModel || state.body || 'earth';
    if ((state.body || 'earth') === 'earth') {
      if (state.dayMode === 'specific') {
        return SolarGeometry.dailyProfile(state.latitude, state.dayOfYear, mountingKey);
      }
      return SolarGeometry.annualAverageProfile(state.latitude, mountingKey);
    }

    let solarGeo;
    if (profileModel === 'lunar-pel') {
      solarGeo = SolarGeometry.lunarPolarIlluminationProfile({
        cycleHours: body.cycleHours,
        illuminatedFraction: 0.85,
      });
    } else if ((state.body || 'earth') === 'mars' || profileModel === 'mars-average') {
      solarGeo = SolarGeometry.planetaryAnnualAverageProfile({
        latitude: state.latitude,
        orbitalDays: 668.6,
        axialTiltDeg: 25.19,
        cycleHours: body.cycleHours,
        solarConstant: 590,
        diffuseFraction: 0.05,
      });
    } else if ((state.body || 'earth') === 'moon') {
      solarGeo = SolarGeometry.planetaryAnnualAverageProfile({
        latitude: state.latitude,
        orbitalDays: 29.53,
        axialTiltDeg: 1.54,
        cycleHours: body.cycleHours,
        solarConstant: 1361,
        diffuseFraction: 0,
      });
    } else {
      solarGeo = SolarGeometry.annualAverageProfile(state.latitude, mountingKey);
    }

    const shaped = SolarGeometry.applyMountingShape(solarGeo.rawProfile, mountingKey, body.cycleHours);
    return {
      ...solarGeo,
      ...shaped,
      peakIrradiance: Math.max(...shaped.rawProfile, 0),
      dailyInsolation: shaped.dailyInsolation,
    };
  },

  getSunHours(ghi) {
    return ghi / 365;
  },

  getCloudinessFactor(region, ghi, bodyKey = 'earth') {
    if (bodyKey !== 'earth') return 0;
    if (region === 'cloudy') return 1.0;
    if (region === 'tropical') return 0.55;
    if (region === 'temperate') return 0.30;
    if (region === 'desert') return 0.05;

    if (ghi <= 1000) return 0.95;
    if (ghi <= 1400) return 0.70;
    if (ghi <= 1800) return 0.40;
    return 0.10;
  },

  getMountingYieldMultiplier(state, preset, ghi) {
    const mounting = MOUNTING_TYPES[state.mountingType];
    if (!mounting) return 1;
    if ((state.body || 'earth') !== 'earth' || state.mountingType === 'fixed') {
      return mounting.yieldMult;
    }

    const latitudeFactor = Math.max(0, Math.min(1, (Math.abs(state.latitude) - 20) / 25));
    const cloudiness = this.getCloudinessFactor(preset?.region, ghi, state.body || 'earth');

    if (state.mountingType === 'ew') {
      return mounting.yieldMult + (cloudiness * 0.08) - (latitudeFactor * 0.02);
    }

    if (state.mountingType === 'single') {
      return mounting.yieldMult + (latitudeFactor * 0.05) - (cloudiness * 0.18);
    }

    if (state.mountingType === 'dual') {
      return mounting.yieldMult + (latitudeFactor * 0.07) - (cloudiness * 0.15);
    }

    return mounting.yieldMult;
  },

  crf(rate, years) {
    if (!isFinite(rate) || !isFinite(years) || years <= 0) return 0;
    if (rate === 0) return 1 / years;
    return (rate * Math.pow(1 + rate, years)) / (Math.pow(1 + rate, years) - 1);
  },

  getBatteryLeakageRetention(stepHours) {
    const monthlyLeakage = Math.max(0, Math.min(0.999999, MODEL_ASSUMPTIONS.batteryMonthlyLeakage || 0));
    if (!Number.isFinite(stepHours) || stepHours <= 0 || monthlyLeakage <= 0) return 1;
    const averageMonthHours = (365 * 24) / 12;
    return Math.pow(1 - monthlyLeakage, stepHours / averageMonthHours);
  },

  scaleCapex(referenceCapex, actualThroughput, referenceThroughput, exponent = 0.75) {
    if (!referenceCapex || !actualThroughput || !referenceThroughput) return 0;
    const normalized = Math.max(0.25, actualThroughput / referenceThroughput);
    return referenceCapex * Math.pow(normalized, exponent);
  },

  getSolarDegradationFactor(degradationPercent, year) {
    if (!Number.isFinite(year) || year <= 1) return 1;
    const annualRetention = Math.max(0, 1 - (Math.max(0, degradationPercent || 0) / 100));
    return Math.pow(annualRetention, year - 1);
  },

  getAverageSolarDegradationFactor(degradationPercent, years) {
    if (!Number.isFinite(years) || years <= 0) return 1;
    let totalFactor = 0;
    for (let year = 1; year <= years; year++) {
      totalFactor += this.getSolarDegradationFactor(degradationPercent, year);
    }
    return totalFactor / years;
  },

  getPolicyDurationFactor(policy, year) {
    if (!policy || !Number.isFinite(policy.durationYears) || policy.durationYears <= 0) return 1;
    return year <= policy.durationYears ? 1 : 0;
  },

  buildReplacementSchedule(analysisHorizonYears, assets) {
    const byYear = {};
    const entries = [];

    for (const asset of assets) {
      if (!asset || !Number.isFinite(asset.cost) || asset.cost <= 0) continue;
      if (!Number.isFinite(asset.lifeYears) || asset.lifeYears <= 0) continue;

      let replacementAt = asset.lifeYears;
      while (replacementAt < analysisHorizonYears - 1e-9) {
        const year = Math.max(1, Math.ceil(replacementAt - 1e-9));
        if (!byYear[year]) {
          byYear[year] = {
            year,
            total: 0,
            items: [],
          };
          entries.push(byYear[year]);
        }

        byYear[year].total += asset.cost;
        byYear[year].items.push({
          key: asset.key,
          label: asset.label,
          cost: asset.cost,
          lifeYears: asset.lifeYears,
          scheduledAtYear: replacementAt,
        });

        replacementAt += asset.lifeYears;
      }
    }

    entries.sort((a, b) => a.year - b.year);

    return {
      byYear,
      entries,
      total: entries.reduce((sum, entry) => sum + entry.total, 0),
    };
  },

  calculateSolar(state) {
    const bodyKey = state.body || 'earth';
    const body = this.getBodyConfig(bodyKey);
    const ghi = this.estimateGHI(state.latitude, state.longitude, bodyKey);
    const preset = this.getNearbyPreset(state.latitude, state.longitude, bodyKey);
    const mounting = MOUNTING_TYPES[state.mountingType];
    const baseYield = state.siteYieldMwhPerMwdcYear || this.estimateBaseYield(state.latitude, state.longitude, ghi, bodyKey);
    const yieldMult = this.getMountingYieldMultiplier(state, preset, ghi);
    const siteYield = baseYield * yieldMult;
    const annualMWh = state.systemSizeMW * siteYield;
    const dailyMWh = annualMWh / body.cyclesPerEarthYear;
    const peakPowerKW = state.systemSizeMW * 1000;
    const totalPanelCost = state.systemSizeMW * 1e6 * state.panelCostPerW;
    const totalBOSCost = state.systemSizeMW * 1e6 * state.bosCostPerW;

    const panelArea = (state.systemSizeMW * 1e6) / ((state.panelEfficiency / 100) * 1000);
    const landArea = panelArea / mounting.landPacking;
    const acres = landArea / 4047;
    const landCapex = acres * (state.landCostPerAcre || 0);
    const sitePrepCapex = acres * (state.sitePrepCostPerAcre || 0);
    const totalSolarCapex = totalPanelCost + totalBOSCost + landCapex + sitePrepCapex;

    const rate = state.discountRate / 100;
    const annualizedSolar = totalSolarCapex * this.crf(rate, state.solarAssetLife);
    const solarOmFrac = (state.solarOmPercent ?? 1.5) / 100;
    const annualSolarOm = (totalPanelCost + totalBOSCost) * solarOmFrac;
    const lifetimeAverageAnnualMWh = annualMWh * this.getAverageSolarDegradationFactor(
      state.panelDegradationAnnual,
      state.solarAssetLife
    );
    const lcoe = lifetimeAverageAnnualMWh > 0 ? (annualizedSolar + annualSolarOm) / lifetimeAverageAnnualMWh : 0;

    const solarGeo = this.getSolarGeometry(state, body, state.mountingType);
    const binHours = body.cycleHours / solarGeo.profile.length;

    return {
      bodyKey,
      bodyLabel: body.label,
      cycleHours: body.cycleHours,
      cyclesPerYear: body.cyclesPerEarthYear,
      cycleUnit: body.cycleUnit,
      cycleUnitCompact: body.cycleUnitCompact,
      hoursPerCycleLabel: body.hoursPerCycleLabel,
      chartLabelMode: body.chartLabelMode,
      chartNote: body.chartNote,
      supportsSpecificDay: body.supportsSpecificDay,
      binHours,
      ghi,
      baseYield,
      yieldMult,
      siteYield,
      panelDegradationAnnual: state.panelDegradationAnnual,
      yieldSource: this.getResourceSource(state, preset),
      sunHours: parseFloat(solarGeo.dayLengthHours.toFixed(1)),
      capacityFactor: annualMWh / (state.systemSizeMW * 8760),
      annualMWh,
      lifetimeAverageAnnualMWh,
      dailyMWh,
      dailyKWh: dailyMWh * 1000,
      peakPowerKW,
      panelAreaM2: panelArea,
      landAreaM2: landArea,
      acres,
      solarCapex: totalPanelCost,
      moduleCapex: totalPanelCost,
      bosCapex: totalBOSCost,
      landCapex,
      sitePrepCapex,
      totalSolarCapex,
      annualizedSolar,
      annualSolarOm,
      lcoe,
      hourlyProfile: solarGeo.profile,
      mounting,
      solarGeo,
    };
  },

  calculateBattery(state, solar) {
    const stepCount = solar.hourlyProfile.length;
    const stepHours = solar.binHours;
    const solarKW = solar.hourlyProfile.map(v => Math.min((v * solar.dailyKWh) / stepHours, solar.peakPowerKW));
    if (!state.batteryEnabled) {
      return {
        enabled: false,
        effectiveCF: solar.capacityFactor,
        dailyOpHours: solar.sunHours,
        capex: 0,
        battCapKWh: 0,
        dailyAvailableKWh: solar.dailyKWh,
        hourlyProfile: solar.hourlyProfile,
        hourlyKW: solarKW,
        batteryChargeHourlyKW: new Array(stepCount).fill(0),
        processPowerKW: solar.peakPowerKW,
        baseloadKW: solar.peakPowerKW,
        annualizedCapex: 0,
        lifetimeYears: 0,
      };
    }

    const battCapKWh = state.batteryCapacityMWh * 1000;
    const rtEff = Math.max(0, Math.min(1, state.batteryEfficiency / 100));
    const oneWayEff = Math.sqrt(rtEff);
    const chargeEff = Math.max(oneWayEff, 1e-9);
    const dischargeEff = Math.max(oneWayEff, 1e-9);
    const leakageRetentionPerStep = this.getBatteryLeakageRetention(stepHours);
    const maxSolarKW = Math.max(...solarKW, 0);
    const averageSolarKW = solar.cycleHours > 0 ? solar.dailyKWh / solar.cycleHours : 0;

    const simulateCycle = (processKW, startSocKWh, captureSeries = false) => {
      const output = captureSeries ? new Array(stepCount).fill(0) : [];
      const batteryChargeKW = captureSeries ? new Array(stepCount).fill(0) : [];
      let socKWh = Math.max(0, Math.min(battCapKWh, startSocKWh));
      let minSocKWh = socKWh;
      let maxSocKWh = socKWh;
      let chemicalKWh = 0;
      let curtailedKWh = 0;

      for (let h = 0; h < stepCount; h++) {
        if (socKWh > 1e-9) {
          socKWh = Math.max(0, socKWh * leakageRetentionPerStep);
        }
        const processCapKWh = processKW * stepHours;
        const generatedKWh = solarKW[h] * stepHours;
        const directToChemicalKWh = Math.min(processCapKWh, generatedKWh);
        let deliveredKWh = directToChemicalKWh;

        if (deliveredKWh + 1e-9 < processCapKWh && socKWh > 1e-9) {
          const dischargeToLoadKWh = Math.min(processCapKWh - deliveredKWh, socKWh * dischargeEff);
          deliveredKWh += dischargeToLoadKWh;
          socKWh -= dischargeToLoadKWh / dischargeEff;
        }

        let solarAvailableKWh = generatedKWh - directToChemicalKWh;
        if (solarAvailableKWh > 1e-9 && socKWh < battCapKWh - 1e-9) {
          const storedKWh = Math.min(battCapKWh - socKWh, solarAvailableKWh * chargeEff);
          const chargeInputKWh = Math.min(solarAvailableKWh, storedKWh / chargeEff);
          socKWh += storedKWh;
          solarAvailableKWh -= chargeInputKWh;
          if (captureSeries) batteryChargeKW[h] = chargeInputKWh / stepHours;
        }

        chemicalKWh += deliveredKWh;
        curtailedKWh += Math.max(0, solarAvailableKWh);
        minSocKWh = Math.min(minSocKWh, socKWh);
        maxSocKWh = Math.max(maxSocKWh, socKWh);

        if (captureSeries) {
          output[h] = deliveredKWh / stepHours;
        }
      }

      return {
        output,
        batteryChargeKW,
        chemicalKWh,
        curtailedKWh,
        utilizedCapacityKWh: Math.max(0, maxSocKWh - minSocKWh),
        endSocKWh: socKWh,
      };
    };

    const simulateProcessCapacity = processKW => {
      const targetKW = Math.max(averageSolarKW, Math.min(processKW, maxSolarKW));
      const settleTolKWh = Math.max(1e-3, battCapKWh * 1e-6);
      let startBatteryKWh = battCapKWh;

      // Starting full yields the least spare headroom; once this converges,
      // the last cycle represents the repeatable battery-supported dispatch.
      for (let i = 0; i < 256; i++) {
        const cycle = simulateCycle(targetKW, startBatteryKWh, false);
        if (Math.abs(cycle.endSocKWh - startBatteryKWh) <= settleTolKWh) {
          startBatteryKWh = cycle.endSocKWh;
          break;
        }
        startBatteryKWh = cycle.endSocKWh;
      }

      const settledCycle = simulateCycle(targetKW, startBatteryKWh, true);
      return {
        output: settledCycle.output,
        batteryChargeKW: settledCycle.batteryChargeKW,
        processPowerKW: targetKW,
        chemicalKWh: settledCycle.chemicalKWh,
        curtailedKWh: settledCycle.curtailedKWh,
        capturesAllSolar: settledCycle.curtailedKWh <= Math.max(1e-3, solar.dailyKWh * 1e-6),
        utilizedCapacityKWh: settledCycle.utilizedCapacityKWh,
        startBatteryKWh,
        endBatteryKWh: settledCycle.endSocKWh,
      };
    };

    let lo = Math.min(averageSolarKW, maxSolarKW);
    let hi = maxSolarKW;
    let bestPlan = simulateProcessCapacity(maxSolarKW);

    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      const plan = simulateProcessCapacity(mid);
      if (plan.capturesAllSolar) {
        bestPlan = plan;
        hi = mid;
      } else {
        lo = mid;
      }
    }

    const hourlyKW = bestPlan.output;
    const processPowerKW = bestPlan.processPowerKW;
    const totalDelivered = bestPlan.chemicalKWh;
    const normalizedProfile = totalDelivered > 0
      ? hourlyKW.map(v => (v * stepHours) / totalDelivered)
      : solar.hourlyProfile;
    const extendedHours = processPowerKW > 0
      ? hourlyKW.reduce((sum, value) => sum + (value >= processPowerKW * 0.05 ? stepHours : 0), 0)
      : 0;
    const effectiveCF = processPowerKW > 0
      ? totalDelivered / (processPowerKW * solar.cycleHours)
      : 0;
    const capex = battCapKWh * state.batteryCostPerKWh;
    const lifetimeYears = Math.max(1, Math.min(MODEL_ASSUMPTIONS.batteryNominalLifeYears, state.batteryCycles / solar.cyclesPerYear));
    const annualizedCapex = capex * this.crf(state.discountRate / 100, lifetimeYears);

    return {
      enabled: true,
      effectiveCF,
      dailyOpHours: extendedHours.toFixed(1),
      capex,
      battCapKWh,
      dailyAvailableKWh: totalDelivered,
      hourlyProfile: normalizedProfile,
      hourlyKW,
      batteryChargeHourlyKW: bestPlan.batteryChargeKW,
      processPowerKW,
      baseloadKW: processPowerKW,
      clipKW: processPowerKW,
      utilizedCapacityKWh: bestPlan.utilizedCapacityKWh,
      startBatteryKWh: bestPlan.startBatteryKWh,
      annualizedCapex,
      lifetimeYears,
    };
  },

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

  getProductMix(state) {
    const methaneEnabled = Boolean(state.sabatierEnabled);
    const methanolEnabled = Boolean(state.methanolEnabled);
    const bothEnabled = methaneEnabled && methanolEnabled;
    const methaneShare = bothEnabled
      ? Math.max(0, Math.min(1, state.methaneFeedstockSplit / 100))
      : methaneEnabled ? 1 : 0;
    const methanolShare = bothEnabled
      ? 1 - methaneShare
      : methanolEnabled ? 1 : 0;

    return {
      methaneEnabled,
      methanolEnabled,
      bothEnabled,
      methaneShare,
      methanolShare,
    };
  },

  getDownstreamDemand(state) {
    const mix = this.getProductMix(state);
    let h2MassDemand = 0;
    let co2MassDemand = 0;

    if (mix.methaneShare > 0) {
      h2MassDemand += mix.methaneShare * CHEMISTRY.sabatier.h2MassPerKgCH4;
      co2MassDemand += mix.methaneShare * CHEMISTRY.sabatier.co2MassPerKgCH4;
    }
    if (mix.methanolShare > 0) {
      h2MassDemand += mix.methanolShare * CHEMISTRY.methanol.h2MassPerKgMeOH;
      co2MassDemand += mix.methanolShare * CHEMISTRY.methanol.co2MassPerKgMeOH;
    }

    let label = 'configured product mix';
    if (mix.methaneShare > 0 && mix.methanolShare === 0) {
      label = 'methane';
    } else if (mix.methanolShare > 0 && mix.methaneShare === 0) {
      label = 'methanol';
    } else if (mix.methaneShare === 0 && mix.methanolShare === 0) {
      h2MassDemand = CHEMISTRY.sabatier.h2MassPerKgCH4;
      co2MassDemand = CHEMISTRY.sabatier.co2MassPerKgCH4;
      label = 'default methane case';
    }

    return {
      mix,
      label,
      h2MassDemand,
      co2MassDemand,
      h2PowerDemand: h2MassDemand * state.electrolyzerEfficiency,
      co2PowerDemand: co2MassDemand * state.dacEnergy / 1000,
    };
  },

  getBalancedAllocation(state) {
    const downstreamDemand = this.getDownstreamDemand(state);
    const totalPowerDemand = downstreamDemand.h2PowerDemand + downstreamDemand.co2PowerDemand;
    const electrolyzerShare = totalPowerDemand > 0
      ? downstreamDemand.h2PowerDemand / totalPowerDemand
      : 0.5;

    return {
      source: 'auto',
      label: downstreamDemand.label,
      electrolyzer: electrolyzerShare,
      dac: 1 - electrolyzerShare,
    };
  },

  calculateElectrolyzer(state, availablePowerKW, dailyKWh, allocation) {
    const cyclesPerYear = this.getBodyConfig(state.body || 'earth').cyclesPerEarthYear;
    if (!state.electrolyzerEnabled) {
      return {
        enabled: false,
        allocKW: 0,
        allocPct: 0,
        dailyKWh: 0,
        h2DailyKg: 0,
        h2AnnualKg: 0,
        h2AnnualTons: 0,
        waterDailyKg: 0,
        lhvEfficiency: 0,
        capex: 0,
      };
    }

    const allocKW = availablePowerKW * allocation.electrolyzer;
    const dailyElecKWh = dailyKWh * allocation.electrolyzer;
    const h2DailyKg = dailyElecKWh / state.electrolyzerEfficiency;
    const h2AnnualKg = h2DailyKg * cyclesPerYear;

    return {
      enabled: true,
      allocKW,
      allocPct: allocation.electrolyzer * 100,
      dailyKWh: dailyElecKWh,
      h2DailyKg,
      h2AnnualKg,
      h2AnnualTons: h2AnnualKg / 1000,
      waterDailyKg: h2DailyKg * CHEMISTRY.electrolysis.waterPerKgH2,
      lhvEfficiency: (CHEMISTRY.electrolysis.h2EnergyContent / state.electrolyzerEfficiency) * 100,
      capex: allocKW * state.electrolyzerCapex,
    };
  },

  calculateDAC(state, availablePowerKW, dailyKWh, allocation) {
    const cyclesPerYear = this.getBodyConfig(state.body || 'earth').cyclesPerEarthYear;
    if (!state.dacEnabled) {
      return {
        enabled: false,
        allocKW: 0,
        allocPct: 0,
        dailyKWh: 0,
        co2DailyKg: 0,
        co2AnnualKg: 0,
        co2AnnualTons: 0,
        capex: 0,
      };
    }

    const allocKW = availablePowerKW * allocation.dac;
    const dailyDACKWh = dailyKWh * allocation.dac;
    const co2DailyKg = (dailyDACKWh / state.dacEnergy) * 1000;
    const co2AnnualKg = co2DailyKg * cyclesPerYear;
    const co2AnnualTons = co2AnnualKg / 1000;

    return {
      enabled: true,
      allocKW,
      allocPct: allocation.dac * 100,
      dailyKWh: dailyDACKWh,
      co2DailyKg,
      co2AnnualKg,
      co2AnnualTons,
      capex: co2AnnualTons * state.dacCapex,
    };
  },

  calculateSabatier(state, h2AvailableKg, co2AvailableKg, opHours, peakH2SizingKgPerHour = 0, peakCO2SizingKgPerHour = 0) {
    const body = this.getBodyConfig(state.body || 'earth');
    if (!state.sabatierEnabled || h2AvailableKg <= 0 || co2AvailableKg <= 0) {
      return {
        id: 'sabatier',
        enabled: false,
        modeled: false,
        title: 'Methane (Sabatier)',
        family: 'air-water-chemistry',
        maturity: 'Supported',
        ch4DailyKg: 0,
        ch4DailyMCF: 0,
        ch4AnnualKg: 0,
        ch4AnnualMCF: 0,
        h2Consumed: 0,
        co2Consumed: 0,
        waterProducedDaily: 0,
        designH2FeedKgPerHour: 0,
        designCO2FeedKgPerHour: 0,
        designFeedKgPerHour: 0,
        designHourlyRate: 0,
        averageUtilization: 0,
        operatingUtilization: 0,
        capex: 0,
      };
    }

    const c = CHEMISTRY.sabatier;
    const conv = state.sabatierConversion / 100;
    const ch4FromH2 = h2AvailableKg / c.h2MassPerKgCH4;
    const ch4FromCO2 = co2AvailableKg / c.co2MassPerKgCH4;
    const grossCh4DailyKg = Math.min(ch4FromH2, ch4FromCO2);
    const ch4DailyKg = grossCh4DailyKg * conv;
    const ch4DailyMCF = ch4DailyKg / c.ch4PerMCF;
    const hourlyRate = opHours > 0 ? ch4DailyMCF / opHours : 0;
    const peakCh4FromH2 = peakH2SizingKgPerHour / c.h2MassPerKgCH4;
    const peakCh4FromCO2 = peakCO2SizingKgPerHour / c.co2MassPerKgCH4;
    const designGrossCh4KgPerHour = Math.min(peakCh4FromH2, peakCh4FromCO2);
    const designH2FeedKgPerHour = designGrossCh4KgPerHour * c.h2MassPerKgCH4;
    const designCO2FeedKgPerHour = designGrossCh4KgPerHour * c.co2MassPerKgCH4;
    const designFeedKgPerHour = designH2FeedKgPerHour + designCO2FeedKgPerHour;
    const designHourlyRate = (designGrossCh4KgPerHour * conv) / c.ch4PerMCF;
    const averageGrossFeedKgPerHour = opHours > 0
      ? (grossCh4DailyKg * (c.h2MassPerKgCH4 + c.co2MassPerKgCH4)) / opHours
      : 0;
    const averageUtilization = designFeedKgPerHour > 0
      ? Math.min(1, ((grossCh4DailyKg * (c.h2MassPerKgCH4 + c.co2MassPerKgCH4)) / body.cycleHours) / designFeedKgPerHour)
      : 0;
    const operatingUtilization = designFeedKgPerHour > 0
      ? Math.min(1, averageGrossFeedKgPerHour / designFeedKgPerHour)
      : 0;
    return {
      id: 'sabatier',
      enabled: true,
      modeled: true,
      title: 'Methane (Sabatier)',
      family: 'air-water-chemistry',
      maturity: 'Supported',
      ch4DailyKg,
      ch4DailyMCF,
      ch4AnnualKg: ch4DailyKg * body.cyclesPerEarthYear,
      ch4AnnualMCF: ch4DailyMCF * body.cyclesPerEarthYear,
      h2Consumed: ch4DailyKg * c.h2MassPerKgCH4,
      co2Consumed: ch4DailyKg * c.co2MassPerKgCH4,
      waterProducedDaily: ch4DailyKg * c.waterPerKgCH4,
      designH2FeedKgPerHour,
      designCO2FeedKgPerHour,
      designFeedKgPerHour,
      limitingReagent: ch4FromH2 < ch4FromCO2 ? 'H2' : 'CO2',
      hourlyRate,
      designHourlyRate,
      averageUtilization,
      operatingUtilization,
      capex: state.sabatierCapex * designFeedKgPerHour,
    };
  },

  calculateMethanol(state, h2AvailableKg, co2AvailableKg, opHours, peakH2SizingKgPerHour = 0, peakCO2SizingKgPerHour = 0) {
    const body = this.getBodyConfig(state.body || 'earth');
    if (!state.methanolEnabled || h2AvailableKg <= 0 || co2AvailableKg <= 0) {
      return {
        id: 'methanol',
        enabled: false,
        modeled: false,
        title: 'Methanol',
        family: 'air-water-chemistry',
        maturity: 'Supported',
        dailyKg: 0,
        annualKg: 0,
        annualTons: 0,
        dailyLiters: 0,
        h2Consumed: 0,
        co2Consumed: 0,
        waterProducedDaily: 0,
        designH2FeedKgPerHour: 0,
        designCO2FeedKgPerHour: 0,
        designFeedKgPerHour: 0,
        designHourlyOutputKg: 0,
        averageUtilization: 0,
        operatingUtilization: 0,
        capex: 0,
      };
    }

    const c = CHEMISTRY.methanol;
    const eff = state.methanolEfficiency / 100;
    const grossDailyKg = Math.min(
      h2AvailableKg / c.h2MassPerKgMeOH,
      co2AvailableKg / c.co2MassPerKgMeOH
    );
    const dailyKg = grossDailyKg * eff;
    const peakMeohFromH2 = peakH2SizingKgPerHour / c.h2MassPerKgMeOH;
    const peakMeohFromCO2 = peakCO2SizingKgPerHour / c.co2MassPerKgMeOH;
    const designGrossKgPerHour = Math.min(peakMeohFromH2, peakMeohFromCO2);
    const designH2FeedKgPerHour = designGrossKgPerHour * c.h2MassPerKgMeOH;
    const designCO2FeedKgPerHour = designGrossKgPerHour * c.co2MassPerKgMeOH;
    const designFeedKgPerHour = designH2FeedKgPerHour + designCO2FeedKgPerHour;
    const designHourlyOutputKg = designGrossKgPerHour * eff;
    const averageGrossFeedKgPerHour = opHours > 0
      ? (grossDailyKg * (c.h2MassPerKgMeOH + c.co2MassPerKgMeOH)) / opHours
      : 0;
    const averageUtilization = designFeedKgPerHour > 0
      ? Math.min(1, ((grossDailyKg * (c.h2MassPerKgMeOH + c.co2MassPerKgMeOH)) / body.cycleHours) / designFeedKgPerHour)
      : 0;
    const operatingUtilization = designFeedKgPerHour > 0
      ? Math.min(1, averageGrossFeedKgPerHour / designFeedKgPerHour)
      : 0;
    return {
      id: 'methanol',
      enabled: true,
      modeled: true,
      title: 'Methanol',
      family: 'air-water-chemistry',
      maturity: 'Supported',
      dailyKg,
      annualKg: dailyKg * body.cyclesPerEarthYear,
      annualTons: (dailyKg * body.cyclesPerEarthYear) / 1000,
      dailyLiters: dailyKg / c.density,
      h2Consumed: dailyKg * c.h2MassPerKgMeOH,
      co2Consumed: dailyKg * c.co2MassPerKgMeOH,
      waterProducedDaily: dailyKg * c.waterPerKgMeOH,
      designH2FeedKgPerHour,
      designCO2FeedKgPerHour,
      designFeedKgPerHour,
      designHourlyOutputKg,
      averageUtilization,
      operatingUtilization,
      capex: state.methanolCapex * designFeedKgPerHour,
    };
  },

  calculateSupportedProducts(state, materialFlows, opHours) {
    const pipeline = MODULE_REGISTRY
      .filter(module => module.kind === 'product' && module.maturity === 'Supported' && state[`${module.id}Enabled`])
      .sort((a, b) => (a.order || 999) - (b.order || 999));

    const downstreamDemand = this.getDownstreamDemand(state);
    const {
      mix,
      h2MassDemand,
      co2MassDemand,
    } = downstreamDemand;
    const productShares = {
      sabatier: {
        h2: h2MassDemand > 0
          ? (mix.methaneShare * CHEMISTRY.sabatier.h2MassPerKgCH4) / h2MassDemand
          : 0,
        co2: co2MassDemand > 0
          ? (mix.methaneShare * CHEMISTRY.sabatier.co2MassPerKgCH4) / co2MassDemand
          : 0,
      },
      methanol: {
        h2: h2MassDemand > 0
          ? (mix.methanolShare * CHEMISTRY.methanol.h2MassPerKgMeOH) / h2MassDemand
          : 0,
        co2: co2MassDemand > 0
          ? (mix.methanolShare * CHEMISTRY.methanol.co2MassPerKgMeOH) / co2MassDemand
          : 0,
      },
    };

    const supportedModules = [];
    const outputs = {};
    let h2Remaining = materialFlows.h2DailyKg;
    let co2Remaining = materialFlows.co2DailyKg;

    for (const module of pipeline) {
      const shares = productShares[module.id] || { h2: 0, co2: 0 };
      const allocatedH2DailyKg = materialFlows.h2DailyKg * shares.h2;
      const allocatedCO2DailyKg = materialFlows.co2DailyKg * shares.co2;
      const allocatedPeakH2KgPerHour = (materialFlows.h2SizingPeakKgPerHour || 0) * shares.h2;
      const allocatedPeakCO2KgPerHour = (materialFlows.co2SizingPeakKgPerHour || 0) * shares.co2;
      let result;
      if (module.id === 'sabatier') {
        result = this.calculateSabatier(
          state,
          allocatedH2DailyKg,
          allocatedCO2DailyKg,
          opHours,
          allocatedPeakH2KgPerHour,
          allocatedPeakCO2KgPerHour
        );
      } else if (module.id === 'methanol') {
        result = this.calculateMethanol(
          state,
          allocatedH2DailyKg,
          allocatedCO2DailyKg,
          opHours,
          allocatedPeakH2KgPerHour,
          allocatedPeakCO2KgPerHour
        );
      } else {
        continue;
      }

      supportedModules.push(result);
      outputs[module.id] = result;
      if (result.enabled) {
        h2Remaining -= result.h2Consumed || 0;
        co2Remaining -= result.co2Consumed || 0;
      }
    }

    return {
      supportedModules,
      outputs,
      h2Remaining,
      co2Remaining,
    };
  },

  calculateExploratoryModules(state) {
    return MODULE_REGISTRY
      .filter(module => module.maturity === 'Exploratory')
      .map(module => ({
        ...module,
        enabled: Boolean(state[`${module.id}Enabled`]),
        route: state[`${module.id}Route`] || module.routeOptions[0]?.value || 'unspecified',
        modeled: false,
        excludedFromEconomics: true,
      }));
  },

  getMethaneSalePrice(state) {
    return state.methanePrice;
  },

  getPolicyCredits(state, context) {
    const {
      electrolyzer,
      dac,
      co2Surplus = 0,
    } = context;
    const mode = state.policyMode;
    const policy = POLICY_OPTIONS[mode] || POLICY_OPTIONS.none;
    const cyclesPerYear = this.getBodyConfig(state.body || 'earth').cyclesPerEarthYear;
    const h2Credit = policy.useCustomH2
      ? (state.customH2Credit || 0)
      : (policy.h2Credit || 0);
    const co2Credit = policy.useCustomCo2
      ? (state.customCo2Credit || 0)
      : (policy.co2Credit || 0);
    const eligibleH2Kg = electrolyzer.enabled ? electrolyzer.h2AnnualKg : 0;
    const capturedCo2Tons = dac.enabled ? dac.co2AnnualTons : 0;
    const surplusCo2Tons = Math.max(0, co2Surplus || 0) * cyclesPerYear / 1000;
    const utilizedCo2Tons = Math.max(0, capturedCo2Tons - surplusCo2Tons);
    let eligibleCo2Tons = capturedCo2Tons;

    if (mode === 'us_45q_utilization') {
      eligibleCo2Tons = utilizedCo2Tons;
    } else if (mode === 'us_45q_sequestration') {
      eligibleCo2Tons = surplusCo2Tons;
    }

    const h2Value = eligibleH2Kg * h2Credit;
    const co2Value = eligibleCo2Tons * co2Credit;
    const total = h2Value + co2Value;

    return {
      mode,
      label: policy.label,
      total,
      applicability: policy.applicability,
      basis: policy.basis,
      note: policy.note,
      stackingRule: policy.stackingRule,
      h2Credit,
      co2Credit,
      h2Value,
      co2Value,
      durationYears: Number.isFinite(policy.durationYears) ? policy.durationYears : null,
      eligibleH2Kg,
      eligibleCo2Tons,
      capturedCo2Tons,
      utilizedCo2Tons,
      surplusCo2Tons,
    };
  },

  calculateEconomics(state, context) {
    const {
      solar, battery, ai, electrolyzer, dac, sabatier, methanol,
      h2Surplus, co2Surplus, exploratoryModules,
    } = context;

    const rate = state.discountRate / 100;
    const batteryLifeYears = battery.enabled ? battery.lifetimeYears : 0;

    const capex = {
      solar: solar.totalSolarCapex,
      battery: battery.capex,
      ai: ai.capex,
      electrolyzer: electrolyzer.capex,
      dac: dac.capex,
      sabatier: sabatier.capex,
      methanol: methanol.capex,
    };
    const capexBreakdown = {
      solarModules: solar.moduleCapex,
      solarBos: solar.bosCapex,
      solarLand: solar.landCapex,
      solarSitePrep: solar.sitePrepCapex,
    };
    const totalCapex = Object.values(capex).reduce((sum, value) => sum + value, 0);
    const replacementSchedule = this.buildReplacementSchedule(state.analysisHorizonYears, [
      { key: 'solar', label: 'Solar', cost: capex.solar, lifeYears: state.solarAssetLife },
      { key: 'battery', label: 'Battery', cost: capex.battery, lifeYears: batteryLifeYears },
      { key: 'ai', label: 'AI datacenter', cost: capex.ai, lifeYears: ai.assetLifeYears },
      { key: 'electrolyzer', label: 'Electrolyzer', cost: capex.electrolyzer, lifeYears: state.electrolyzerAssetLife },
      { key: 'dac', label: 'DAC', cost: capex.dac, lifeYears: state.dacAssetLife },
      { key: 'sabatier', label: 'Methane reactor', cost: capex.sabatier, lifeYears: state.sabatierAssetLife },
      { key: 'methanol', label: 'Methanol reactor', cost: capex.methanol, lifeYears: state.methanolAssetLife },
    ]);

    const annualizedCapex = {
      solar: capex.solar * this.crf(rate, state.solarAssetLife),
      battery: battery.enabled ? capex.battery * this.crf(rate, batteryLifeYears) : 0,
      ai: ai.enabled ? capex.ai * this.crf(rate, ai.assetLifeYears) : 0,
      electrolyzer: capex.electrolyzer * this.crf(rate, state.electrolyzerAssetLife),
      dac: capex.dac * this.crf(rate, state.dacAssetLife),
      sabatier: capex.sabatier * this.crf(rate, state.sabatierAssetLife),
      methanol: capex.methanol * this.crf(rate, state.methanolAssetLife),
    };

    const batteryOmFrac = (state.batteryOmPercent ?? 1.5) / 100;
    const processOmFrac = (state.processOmPercent ?? 3) / 100;
    const annualOM = solar.annualSolarOm +
      (battery.capex * batteryOmFrac) +
      (ai.annualOM || 0) +
      ((electrolyzer.capex + dac.capex + sabatier.capex + methanol.capex) * processOmFrac);

    const methaneSalePrice = this.getMethaneSalePrice(state);
    const policy = this.getPolicyCredits(state, { electrolyzer, dac, co2Surplus });
    const revenue = {
      ai: ai.enabled ? ai.annualRevenue : 0,
      methane: sabatier.enabled ? sabatier.ch4AnnualMCF * methaneSalePrice : 0,
      hydrogen: 0,
      methanol: methanol.enabled ? methanol.annualTons * state.methanolPrice : 0,
      policyCredits: policy.total,
    };

    const totalAnnualRevenue = Object.values(revenue).reduce((sum, value) => sum + value, 0);
    const annualizedCapexTotal = Object.values(annualizedCapex).reduce((sum, value) => sum + value, 0);
    const annualCost = annualizedCapexTotal + annualOM;
    const annualProfit = totalAnnualRevenue - annualCost;
    const annualOperatingCashFlow = totalAnnualRevenue - annualOM;
    const yearlyCashFlows = [];
    let npv = -totalCapex;
    for (let year = 1; year <= state.analysisHorizonYears; year++) {
      const degradationFactor = this.getSolarDegradationFactor(state.panelDegradationAnnual, year);
      const policyDurationFactor = this.getPolicyDurationFactor(policy, year);
      const yearlyRevenue = {
        ai: revenue.ai * degradationFactor,
        methane: revenue.methane * degradationFactor,
        hydrogen: revenue.hydrogen * degradationFactor,
        methanol: revenue.methanol * degradationFactor,
        policyCredits: revenue.policyCredits * degradationFactor * policyDurationFactor,
      };
      const totalYearRevenue = Object.values(yearlyRevenue).reduce((sum, value) => sum + value, 0);
      const operatingCashFlow = totalYearRevenue - annualOM;
      const replacementEvent = replacementSchedule.byYear[year];
      const replacementOutflow = replacementEvent ? replacementEvent.total : 0;
      const netCashFlow = operatingCashFlow - replacementOutflow;
      const yearProfit = totalYearRevenue - annualCost;
      const cumulativeOperatingBefore = year === 1
        ? -totalCapex
        : yearlyCashFlows[yearlyCashFlows.length - 1].cumulativeOperatingCash;
      const cumulativeOperatingAfter = cumulativeOperatingBefore + operatingCashFlow;
      const cumulativeNetBefore = year === 1
        ? -totalCapex
        : yearlyCashFlows[yearlyCashFlows.length - 1].cumulativeNetCash;
      const cumulativeNetAfter = cumulativeNetBefore + netCashFlow;

      yearlyCashFlows.push({
        year,
        degradationFactor,
        policyDurationFactor,
        revenue: yearlyRevenue,
        totalRevenue: totalYearRevenue,
        annualProfit: yearProfit,
        operatingCashFlow,
        replacementOutflow,
        replacementItems: replacementEvent ? replacementEvent.items : [],
        netCashFlow,
        cumulativeOperatingCash: cumulativeOperatingAfter,
        cumulativeNetCash: cumulativeNetAfter,
      });

      npv += netCashFlow / Math.pow(1 + rate, year);
    }

    const cumulativeProfit = yearlyCashFlows.reduce((sum, entry) => sum + entry.annualProfit, 0);
    const cumulativeOperatingCashFlow = yearlyCashFlows.reduce((sum, entry) => sum + entry.operatingCashFlow, 0);
    const cumulativeNetCashFlow = yearlyCashFlows.reduce((sum, entry) => sum + entry.netCashFlow, 0);
    const averageAnnualRevenue = yearlyCashFlows.length > 0
      ? yearlyCashFlows.reduce((sum, entry) => sum + entry.totalRevenue, 0) / yearlyCashFlows.length
      : 0;
    const averageAnnualProfit = yearlyCashFlows.length > 0 ? cumulativeProfit / yearlyCashFlows.length : 0;
    const finalYearAnnualRevenue = yearlyCashFlows.length > 0
      ? yearlyCashFlows[yearlyCashFlows.length - 1].totalRevenue
      : totalAnnualRevenue;
    const finalYearAnnualProfit = yearlyCashFlows.length > 0
      ? yearlyCashFlows[yearlyCashFlows.length - 1].annualProfit
      : annualProfit;
    const finalCumulativeNetCash = yearlyCashFlows.length > 0
      ? yearlyCashFlows[yearlyCashFlows.length - 1].cumulativeNetCash
      : -totalCapex;
    let paybackYears = totalCapex <= 0 ? 0 : Infinity;
    if (totalCapex > 0 && finalCumulativeNetCash >= 0) {
      for (let i = 0; i < yearlyCashFlows.length; i++) {
        const entry = yearlyCashFlows[i];
        const cumulativeBefore = i === 0 ? -totalCapex : yearlyCashFlows[i - 1].cumulativeNetCash;
        const staysPaidBack = yearlyCashFlows.slice(i).every(flow => flow.cumulativeNetCash >= -1e-6);
        if (staysPaidBack && entry.netCashFlow > 0 && cumulativeBefore < 0 && entry.cumulativeNetCash >= 0) {
          paybackYears = (entry.year - 1) + ((-cumulativeBefore) / entry.netCashFlow);
          break;
        }
      }
    }
    const roi = totalCapex > 0 ? (finalCumulativeNetCash / totalCapex) * 100 : 0;

    const irr = this.approximateIRR([
      -totalCapex,
      ...yearlyCashFlows.map(entry => entry.netCashFlow),
    ]);

    const aiCoreAnnualCost = ai.enabled
      ? annualizedCapex.solar + annualizedCapex.battery + annualizedCapex.ai + solar.annualSolarOm + (battery.capex * batteryOmFrac) + (ai.annualOM || 0)
      : 0;

    return {
      capex,
      capexBreakdown,
      annualizedCapex,
      totalCapex,
      annualOM,
      annualCost,
      annualizedCapexTotal,
      annualOperatingCashFlow,
      revenue,
      totalAnnualRevenue,
      annualProfit,
      replacementSchedule: replacementSchedule.entries,
      totalReplacementOutflows: replacementSchedule.total,
      averageAnnualRevenue,
      averageAnnualProfit,
      finalYearAnnualRevenue,
      finalYearAnnualProfit,
      cumulativeOperatingCashFlow,
      cumulativeNetCashFlow,
      finalCumulativeNetCash,
      methaneSalePrice,
      policy,
      paybackYears,
      npv,
      roi,
      irr,
      yearlyCashFlows,
      aiCoreAnnualCost,
      costPerMToken: ai.enabled && ai.annualTokensM > 0 ? aiCoreAnnualCost / ai.annualTokensM : 0,
      tokenMarginPerM: ai.enabled && ai.annualTokensM > 0 ? (state.aiTokenPricePerM || 0) - (aiCoreAnnualCost / ai.annualTokensM) : 0,
      costPerKgH2: electrolyzer.enabled && electrolyzer.h2AnnualKg > 0 ? annualCost / electrolyzer.h2AnnualKg : 0,
      costPerTonCO2: dac.enabled && dac.co2AnnualTons > 0 ? annualCost / dac.co2AnnualTons : 0,
      costPerMCF: sabatier.enabled && sabatier.ch4AnnualMCF > 0 ? annualCost / sabatier.ch4AnnualMCF : 0,
      excludedModules: exploratoryModules.filter(module => module.enabled).map(module => module.label),
    };
  },

  approximateIRR(cashFlows) {
    if (!Array.isArray(cashFlows) || cashFlows.length < 2 || cashFlows[0] >= 0) return NaN;
    if (!cashFlows.slice(1).some(value => value > 0)) return NaN;

    const npvAt = rate => {
      let npv = 0;
      for (let year = 0; year < cashFlows.length; year++) {
        npv += cashFlows[year] / Math.pow(1 + rate, year);
      }
      return npv;
    };

    let lo = -0.99;
    let hi = 0.25;
    let npvLo = npvAt(lo);
    let npvHi = npvAt(hi);

    while (npvLo * npvHi > 0 && hi < 100) {
      hi = hi < 1 ? (hi * 2) + 0.25 : hi * 2;
      npvHi = npvAt(hi);
    }

    if (!Number.isFinite(npvLo) || !Number.isFinite(npvHi) || npvLo * npvHi > 0) {
      return NaN;
    }

    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      const npvMid = npvAt(mid);
      if (npvMid === 0) return mid * 100;
      if (npvLo * npvMid > 0) {
        lo = mid;
        npvLo = npvMid;
      } else {
        hi = mid;
        npvHi = npvMid;
      }
    }

    return ((lo + hi) / 2) * 100;
  },

  calculateEnvironmental(solar, dac, sabatier, methanol, electrolyzer) {
    const co2Captured = dac.enabled ? dac.co2AnnualTons : 0;
    const co2Displaced = sabatier.enabled
      ? sabatier.ch4AnnualMCF * MODEL_ASSUMPTIONS.fossilGasEmissionsPerMCF
      : 0;
    const waterConsumedDaily = electrolyzer.enabled ? electrolyzer.waterDailyKg : 0;
    const waterProducedDaily = (sabatier.waterProducedDaily || 0) + (methanol.waterProducedDaily || 0);

    return {
      co2Captured,
      co2Displaced,
      totalCO2Benefit: co2Captured + co2Displaced,
      waterConsumedDaily,
      waterRecycledDaily: waterProducedDaily,
      waterProducedDaily,
      netWaterDaily: Math.max(0, waterConsumedDaily - waterProducedDaily),
      landAcres: solar.acres,
      homesServed: sabatier.enabled ? sabatier.ch4AnnualMCF / 65 : 0,
      landProductivityVsCorn: sabatier.enabled ? 20 : 0,
    };
  },

  calculateAll(state) {
    const solar = this.calculateSolar(state);
    const annualSolar = this.buildAnnualSolarSeries(state, solar);
    const ai = this.calculateAICompute(state, solar, annualSolar);
    const battery = ai.enabled ? ai.batterySummary : this.calculateBattery(state, solar);
    const cyclesPerYear = this.getBodyConfig(state.body || 'earth').cyclesPerEarthYear;
    const effectiveDailyKWh = ai.enabled
      ? ai.chemicalAnnualKWh / Math.max(cyclesPerYear, 1)
      : (battery.enabled ? battery.dailyAvailableKWh : solar.dailyKWh);
    const effectivePeakKW = ai.enabled
      ? ai.chemicalPeakKW
      : (battery.enabled ? Math.max(...battery.hourlyKW, 0) : solar.peakPowerKW);
    const opHours = ai.enabled
      ? ai.chemicalDailyOpHours
      : parseFloat(battery.enabled ? battery.dailyOpHours : solar.sunHours);
    const allocation = this.getBalancedAllocation(state);
    const reactorSizingPeakKW = effectivePeakKW;

    const electrolyzer = this.calculateElectrolyzer(state, effectivePeakKW, effectiveDailyKWh, allocation);
    const dac = this.calculateDAC(state, effectivePeakKW, effectiveDailyKWh, allocation);

    const productFlow = this.calculateSupportedProducts(
      state,
      {
        h2DailyKg: electrolyzer.h2DailyKg || 0,
        co2DailyKg: dac.co2DailyKg || 0,
        h2SizingPeakKgPerHour: state.electrolyzerEnabled
          ? (reactorSizingPeakKW * allocation.electrolyzer) / state.electrolyzerEfficiency
          : 0,
        co2SizingPeakKgPerHour: state.dacEnabled
          ? ((reactorSizingPeakKW * allocation.dac) / state.dacEnergy) * 1000
          : 0,
      },
      opHours
    );

    const sabatier = productFlow.outputs.sabatier || this.calculateSabatier({ ...state, sabatierEnabled: false }, 0, 0, opHours);
    const methanol = productFlow.outputs.methanol || this.calculateMethanol({ ...state, methanolEnabled: false }, 0, 0, opHours);
    const exploratoryModules = this.calculateExploratoryModules(state);

    const economics = this.calculateEconomics(state, {
      solar,
      battery,
      ai,
      electrolyzer,
      dac,
      sabatier,
      methanol,
      h2Surplus: productFlow.h2Remaining,
      co2Surplus: productFlow.co2Remaining,
      exploratoryModules,
    });
    const environmental = this.calculateEnvironmental(solar, dac, sabatier, methanol, electrolyzer);

    return {
      solar,
      annualSolar,
      battery,
      ai,
      annualDispatch: ai.dispatch,
      allocation,
      electrolyzer,
      dac,
      sabatier,
      methanol,
      supportedModules: productFlow.supportedModules,
      exploratoryModules,
      economics,
      environmental,
      h2Surplus: productFlow.h2Remaining,
      co2Surplus: productFlow.co2Remaining,
      effectiveDailyKWh,
      opHours,
    };
  },

  runSensitivity(baseState, paramKey, values) {
    return values.map(val => {
      const modified = { ...baseState, [paramKey]: val };
      const result = this.calculateAll(modified);
      return {
        x: val,
        npv: result.economics.npv,
        payback: result.economics.paybackYears,
        roi: result.economics.roi,
      };
    });
  },
};
