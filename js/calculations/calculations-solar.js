/* Solar resource and PV plant */

Object.assign(Calc, {
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
});
