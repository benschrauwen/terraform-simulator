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
    if (!state.batteryEnabled) {
      return {
        enabled: false,
        effectiveCF: solar.capacityFactor,
        dailyOpHours: solar.sunHours,
        capex: 0,
        battCapKWh: 0,
        dailyAvailableKWh: solar.dailyKWh,
        hourlyProfile: solar.hourlyProfile,
        hourlyKW: solar.hourlyProfile.map(v => Math.min((v * solar.dailyKWh) / stepHours, solar.peakPowerKW)),
        processPowerKW: solar.peakPowerKW,
        annualizedCapex: 0,
        lifetimeYears: 0,
      };
    }

    const battCapKWh = state.batteryCapacityMWh * 1000;
    const rtEff = Math.max(0, Math.min(1, state.batteryEfficiency / 100));
    const oneWayEff = Math.sqrt(rtEff);
    const dischargeEff = Math.max(oneWayEff, 1e-9);
    const solarKW = solar.hourlyProfile.map(v => Math.min((v * solar.dailyKWh) / stepHours, solar.peakPowerKW));
    const maxSolarKW = Math.max(...solarKW, 0);
    const nightHours = Array.from({ length: stepCount }, (_, h) => {
      const hourMidpoint = (h + 0.5) * stepHours;
      return hourMidpoint < solar.solarGeo.sunrise || hourMidpoint >= solar.solarGeo.sunset;
    });
    const evaluateDispatch = (nightKW, clipKW) => {
      const output = new Array(stepCount).fill(0);
      let cumulativeBatteryKWh = 0;
      let minBatteryKWh = 0;
      let maxBatteryKWh = 0;

      for (let h = 0; h < stepCount; h++) {
        const solarInputKW = solarKW[h];
        let deliveredKW = solarInputKW;
        let batteryDeltaKWh = 0;

        // Preserve the daytime ramp, shave only the solar peak, and redeploy
        // that stored energy into true night hours.
        if (solarInputKW > clipKW) {
          deliveredKW = clipKW;
          batteryDeltaKWh = (solarInputKW - clipKW) * oneWayEff * stepHours;
        }

        if (nightHours[h] && deliveredKW < nightKW) {
          batteryDeltaKWh -= ((nightKW - deliveredKW) * stepHours) / dischargeEff;
          deliveredKW = nightKW;
        }

        output[h] = deliveredKW;
        cumulativeBatteryKWh += batteryDeltaKWh;
        minBatteryKWh = Math.min(minBatteryKWh, cumulativeBatteryKWh);
        maxBatteryKWh = Math.max(maxBatteryKWh, cumulativeBatteryKWh);
      }

      return {
        output,
        netBatteryDeltaKWh: cumulativeBatteryKWh,
        requiredCapacityKWh: maxBatteryKWh - minBatteryKWh,
        startBatteryKWh: -minBatteryKWh,
      };
    };

    const solveDispatchForNightPower = nightKW => {
      const targetNightKW = Math.max(0, Math.min(nightKW, maxSolarKW));
      const tightClip = evaluateDispatch(targetNightKW, targetNightKW);

      if (tightClip.netBatteryDeltaKWh < -1e-6) return null;

      let lo = targetNightKW;
      let hi = maxSolarKW;
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        const net = evaluateDispatch(targetNightKW, mid).netBatteryDeltaKWh;
        if (net >= 0) lo = mid;
        else hi = mid;
      }

      const clipKW = (lo + hi) / 2;
      return {
        floorKW: targetNightKW,
        clipKW,
        ...evaluateDispatch(targetNightKW, clipKW),
      };
    };

    let floorLo = 0;
    let floorHi = maxSolarKW;
    let bestPlan = solveDispatchForNightPower(0) || {
      floorKW: 0,
      clipKW: maxSolarKW,
      ...evaluateDispatch(0, maxSolarKW),
    };

    for (let i = 0; i < 40; i++) {
      const mid = (floorLo + floorHi) / 2;
      const plan = solveDispatchForNightPower(mid);
      if (plan && plan.requiredCapacityKWh <= battCapKWh + 1e-6) {
        bestPlan = plan;
        floorLo = mid;
      } else {
        floorHi = mid;
      }
    }

    const hourlyKW = bestPlan.output;
    const processPowerKW = Math.max(...hourlyKW, 0);

    const totalDelivered = hourlyKW.reduce((sum, v) => sum + (v * stepHours), 0);
    const normalizedProfile = totalDelivered > 0
      ? hourlyKW.map(v => (v * stepHours) / totalDelivered)
      : solar.hourlyProfile;
    const supportThresholdKW = Math.max(1, processPowerKW * 0.05);
    const extendedHours = processPowerKW > 0
      ? hourlyKW.reduce((sum, v) => sum + (v >= supportThresholdKW ? stepHours : 0), 0)
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
      processPowerKW,
      baseloadKW: bestPlan.floorKW,
      clipKW: bestPlan.clipKW,
      utilizedCapacityKWh: bestPlan.requiredCapacityKWh,
      startBatteryKWh: bestPlan.startBatteryKWh,
      annualizedCapex,
      lifetimeYears,
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
      solar, battery, electrolyzer, dac, sabatier, methanol,
      h2Surplus, co2Surplus, exploratoryModules,
    } = context;

    const rate = state.discountRate / 100;
    const batteryLifeYears = battery.enabled ? battery.lifetimeYears : 0;

    const capex = {
      solar: solar.totalSolarCapex,
      battery: battery.capex,
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
      { key: 'electrolyzer', label: 'Electrolyzer', cost: capex.electrolyzer, lifeYears: state.electrolyzerAssetLife },
      { key: 'dac', label: 'DAC', cost: capex.dac, lifeYears: state.dacAssetLife },
      { key: 'sabatier', label: 'Methane reactor', cost: capex.sabatier, lifeYears: state.sabatierAssetLife },
      { key: 'methanol', label: 'Methanol reactor', cost: capex.methanol, lifeYears: state.methanolAssetLife },
    ]);

    const annualizedCapex = {
      solar: capex.solar * this.crf(rate, state.solarAssetLife),
      battery: battery.enabled ? capex.battery * this.crf(rate, batteryLifeYears) : 0,
      electrolyzer: capex.electrolyzer * this.crf(rate, state.electrolyzerAssetLife),
      dac: capex.dac * this.crf(rate, state.dacAssetLife),
      sabatier: capex.sabatier * this.crf(rate, state.sabatierAssetLife),
      methanol: capex.methanol * this.crf(rate, state.methanolAssetLife),
    };

    const batteryOmFrac = (state.batteryOmPercent ?? 1.5) / 100;
    const processOmFrac = (state.processOmPercent ?? 3) / 100;
    const annualOM = solar.annualSolarOm +
      (battery.capex * batteryOmFrac) +
      ((electrolyzer.capex + dac.capex + sabatier.capex + methanol.capex) * processOmFrac);

    const methaneSalePrice = this.getMethaneSalePrice(state);
    const policy = this.getPolicyCredits(state, { electrolyzer, dac, co2Surplus });
    const revenue = {
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
    const battery = this.calculateBattery(state, solar);
    const effectiveDailyKWh = battery.enabled ? battery.dailyAvailableKWh : solar.dailyKWh;
    const effectivePeakKW = battery.enabled
      ? Math.max(...battery.hourlyKW, 0)
      : solar.peakPowerKW;
    const opHours = parseFloat(battery.enabled ? battery.dailyOpHours : solar.sunHours);
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
      battery,
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
