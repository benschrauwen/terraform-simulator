/* ============================================
   Solar resource and PV plant
   ============================================
   Site resource estimates (GHI, yield, cloudiness), mounting-dependent yield,
   layout and BOS adjustments, plant capex/LCOE and the representative
   cycle profile for each planetary body. */

import {
  ARID_GHI_REGIONS,
  CLOUDINESS_BY_GHI,
  CLOUDINESS_BY_REGION,
  GHI_ESTIMATE_RANGE,
  GHI_LATITUDE_BANDS,
  MODEL_ASSUMPTIONS,
  SOLAR_LAYOUT_REFERENCE,
  SQUARE_METERS_PER_ACRE,
} from '../data/assumptions.js';
import {
  LOCATION_PRESETS,
  MOUNTING_TYPES,
  PLANETARY_BODIES,
} from '../data/reference-data.js';
import { crf, getLevelizedSolarDegradationFactor } from './finance.js';
import { SolarGeometry } from './solar-geometry.js';
import { clampNumber } from './util.js';

function isInAridRegion(lat, lon) {
  return ARID_GHI_REGIONS.boxes.some(box =>
    lon > box.minLon && lon < box.maxLon && lat > box.minLat && lat < box.maxLat
  );
}

export const solarMethods = {
  getBodyConfig(bodyKey) {
    return PLANETARY_BODIES[bodyKey] || PLANETARY_BODIES.earth;
  },

  /* Nearest preset of the body within 2 deg latitude / 3 deg longitude. */
  getNearbyPreset(lat, lon, bodyKey = 'earth') {
    let nearest;
    let nearestDistance = Infinity;
    LOCATION_PRESETS.forEach(loc => {
      if ((loc.body || 'earth') !== bodyKey) return;
      const dLat = Math.abs(lat - loc.lat);
      const dLon = Math.abs(lon - loc.lon);
      if (!(dLat < 2 && dLon < 3)) return;
      const distance = Math.hypot(dLat, dLon * Math.cos(((lat + loc.lat) / 2) * SolarGeometry.DEG));
      if (distance < nearestDistance) {
        nearest = loc;
        nearestDistance = distance;
      }
    });
    return nearest;
  },

  estimateGHI(lat, lon, bodyKey = 'earth') {
    const preset = this.getNearbyPreset(lat, lon, bodyKey);
    if (preset) return preset.ghi;
    if (bodyKey !== 'earth') return 0;

    const absLat = Math.abs(lat);
    const band = GHI_LATITUDE_BANDS.find(entry => absLat <= entry.maxAbsLatitude)
      || GHI_LATITUDE_BANDS[GHI_LATITUDE_BANDS.length - 1];
    let baseGHI = band.ghi0 + (absLat - band.atAbsLatitude) * band.slope;

    if (
      absLat >= ARID_GHI_REGIONS.minAbsLatitude &&
      absLat <= ARID_GHI_REGIONS.maxAbsLatitude &&
      isInAridRegion(lat, lon)
    ) {
      baseGHI *= ARID_GHI_REGIONS.multiplier;
    }

    return Math.round(Math.max(GHI_ESTIMATE_RANGE.min, Math.min(GHI_ESTIMATE_RANGE.max, baseGHI)));
  },

  /* Base yield (fixed optimal-tilt reference) for a site: the preset value,
     else GHI x modeled optimal-tilt plane-of-array gain x a typical
     performance ratio. */
  estimateBaseYield(lat, lon, ghi, bodyKey = 'earth') {
    const preset = this.getNearbyPreset(lat, lon, bodyKey);
    if (preset) return preset.baseYield;
    if (bodyKey !== 'earth') return Math.round(Math.max(0, ghi));
    const sky = this.getEarthSkyModel(lat, preset, ghi);
    const tilted = SolarGeometry.sampledAnnualPlaneOfArrayKWh(lat, 'fixed', sky);
    const horizontal = SolarGeometry.sampledAnnualPlaneOfArrayKWh(lat, 'fixed', { ...sky, fixedTiltDeg: 0 });
    const tiltGain = horizontal > 0 ? tilted / horizontal : 1;
    return Math.round(Math.max(0, ghi) * tiltGain * MODEL_ASSUMPTIONS.fallbackPerformanceRatio);
  },

  /* Annual diffuse fraction (DIF/GHI): measured for presets, else from the
     cloudiness heuristic. */
  getSiteDiffuseFraction(preset, ghi) {
    if (Number.isFinite(preset?.diffuseFraction)) return preset.diffuseFraction;
    const cloudiness = this.getCloudinessFactor(preset?.region, ghi, 'earth');
    return clampNumber(
      MODEL_ASSUMPTIONS.clearSkyDiffuseFraction + (cloudiness * MODEL_ASSUMPTIONS.diffuseFractionPerCloudiness),
      0.1,
      0.9
    );
  },

  /* Earth sky/mounting options shared by the yield multipliers and the
     hourly profiles: beam transmittance matching the site's diffuse
     fraction, the modeled optimal fixed tilt, and the tracker row spacing. */
  getEarthSkyModel(latitude, preset, ghi, groundCoverageRatio = 0) {
    const safeLatitude = clampNumber(latitude, -90, 90, 0);
    const diffuseFraction = this.getSiteDiffuseFraction(preset, ghi);
    const beamTransmittance = SolarGeometry.beamTransmittanceForDiffuseFraction(safeLatitude, diffuseFraction);
    return {
      diffuseFraction,
      beamTransmittance,
      fixedTiltDeg: SolarGeometry.optimalFixedTiltDeg(safeLatitude, beamTransmittance),
      groundCoverageRatio,
    };
  },

  getSolarGeometry(state, body, mountingKey, skyModel = null) {
    const profileModel = state.solarProfileModel || state.body || 'earth';
    if ((state.body || 'earth') === 'earth') {
      return SolarGeometry.annualAverageProfile(state.latitude, mountingKey, skyModel || {});
    }

    let solarGeo;
    if (profileModel === 'lunar-pel') {
      return SolarGeometry.lunarPolarIlluminationProfile({
        cycleHours: body.cycleHours,
        illuminatedFraction: MODEL_ASSUMPTIONS.lunarPolarIlluminatedFraction,
        mountingKey,
      });
    } else if ((state.body || 'earth') === 'mars' || profileModel === 'mars-average') {
      solarGeo = SolarGeometry.planetaryAnnualAverageProfile({
        ...PLANETARY_BODIES.mars.orbit,
        latitude: state.latitude,
        cycleHours: body.cycleHours,
      });
    } else if ((state.body || 'earth') === 'moon') {
      solarGeo = SolarGeometry.planetaryAnnualAverageProfile({
        ...PLANETARY_BODIES.moon.orbit,
        latitude: state.latitude,
        cycleHours: body.cycleHours,
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

  getWinterNoonElevation(latitude) {
    const safeLatitude = Number.isFinite(latitude) ? latitude : 0;
    const winterDeclination = safeLatitude >= 0 ? -23.44 : 23.44;
    return Math.max(6, 90 - Math.abs(safeLatitude - winterDeclination));
  },

  getCloudinessFactor(region, ghi, bodyKey = 'earth') {
    if (bodyKey !== 'earth') return 0;
    if (typeof region === 'string' && Object.hasOwn(CLOUDINESS_BY_REGION, region)) {
      return CLOUDINESS_BY_REGION[region];
    }

    const tier = CLOUDINESS_BY_GHI.find(entry => ghi <= entry.maxGhi)
      || CLOUDINESS_BY_GHI[CLOUDINESS_BY_GHI.length - 1];
    return tier.cloudiness;
  },

  getEarthLocationFactors(state, preset, ghi, bodyKey = 'earth') {
    const safeLatitude = Number.isFinite(state?.latitude) ? state.latitude : 0;
    return {
      absLat: Math.abs(safeLatitude),
      cloudiness: this.getCloudinessFactor(preset?.region, ghi, bodyKey),
      winterNoonElevationDeg: this.getWinterNoonElevation(safeLatitude),
    };
  },

  /* Annual yield of the selected mounting relative to the base-yield
     reference mounting. Earth: ratio of modeled annual plane-of-array
     insolation (same sky model and hourly series the dispatch uses) vs a
     fixed array at the modeled optimal tilt. Lunar PEL: vs sun-pointing
     vertical panels. Other off-Earth profiles: MOUNTING_TYPES table. */
  getMountingYieldMultiplier(state, preset, ghi, skyModel = null) {
    const mounting = MOUNTING_TYPES[state.mountingType];
    if (!mounting) return 1;
    const bodyKey = state.body || 'earth';
    if (bodyKey === 'moon' && state.solarProfileModel === 'lunar-pel') {
      return SolarGeometry.lunarPolarMountingFactor(state.mountingType, MODEL_ASSUMPTIONS.lunarPolarIlluminatedFraction);
    }
    if (bodyKey !== 'earth') return mounting.yieldMult;
    if (state.mountingType === 'fixed') return 1;

    const sky = skyModel || this.getEarthSkyModel(state.latitude, preset, ghi);
    const latitude = clampNumber(state.latitude, -90, 90, 0);
    const reference = SolarGeometry.annualHourlyPlaneOfArray(latitude, 'fixed', { ...sky, groundCoverageRatio: 0 });
    const mounted = SolarGeometry.annualHourlyPlaneOfArray(latitude, state.mountingType, this.getMountingSkyOptions(state.mountingType, sky));
    return reference.sum > 0 ? mounted.sum / reference.sum : 1;
  },

  /* Only single-axis trackers backtrack, so only they depend on row spacing. */
  getMountingSkyOptions(mountingKey, skyModel) {
    return {
      ...skyModel,
      groundCoverageRatio: mountingKey === 'single' ? (skyModel?.groundCoverageRatio || 0) : 0,
    };
  },

  /* The hourly series caps every step at nameplate. When the requested
     yield cannot fit under that cap during modeled daylight, the series
     delivers less than requested: carry the deliverable energy through the
     solar summary (instead of silently inventing the difference) and warn. */
  reconcileSolarWithDispatchSeries(solar, dispatchBasis) {
    const series = dispatchBasis?.solar;
    if (!series || series.targetReachable !== false || !(solar.annualMWh > 0)) {
      return { ...solar, requestedAnnualMWh: solar.annualMWh, warnings: [] };
    }
    const deliverableMWh = ((series.totalKWh || 0) * (dispatchBasis.annualizationFactor || 1)) / 1000;
    const ratio = Math.max(0, Math.min(1, deliverableMWh / solar.annualMWh));
    const cappedSiteYield = solar.siteYield * ratio;
    return {
      ...solar,
      requestedAnnualMWh: solar.annualMWh,
      annualMWh: solar.annualMWh * ratio,
      siteYield: cappedSiteYield,
      dailyMWh: solar.dailyMWh * ratio,
      dailyKWh: solar.dailyKWh * ratio,
      capacityFactor: solar.capacityFactor * ratio,
      levelizedAnnualMWh: solar.levelizedAnnualMWh * ratio,
      lcoe: ratio > 0 ? solar.lcoe / ratio : 0,
      warnings: [{
        key: 'solar-yield-capped',
        message: `The requested yield (${Math.round(solar.siteYield).toLocaleString('en-US')} MWh/MWdc-yr for this mounting) exceeds what the array can deliver at nameplate during modeled daylight; output is capped at ${Math.round(cappedSiteYield).toLocaleString('en-US')} MWh/MWdc-yr.`,
      }],
    };
  },

  describeBaseYieldReference(state, skyModel) {
    const bodyKey = state.body || 'earth';
    if (bodyKey === 'moon' && state.solarProfileModel === 'lunar-pel') return 'vertical sun-tracking panels';
    if (bodyKey === 'earth' && skyModel) return `fixed tilt, equator-facing at ${Math.round(skyModel.fixedTiltDeg)}°`;
    return 'fixed tilt, equator-facing';
  },

  getLocationAdjustedGroundCoverageRatio(state, preset, ghi, mounting) {
    const baseGroundCoverageRatio = Math.max(0.05, Math.min(mounting?.groundCoverageRatio || 0.35, 0.95));
    if ((state.body || 'earth') !== 'earth') {
      return {
        baseGroundCoverageRatio,
        groundCoverageRatio: baseGroundCoverageRatio,
        layoutSpacingMultiplier: 1,
      };
    }

    const locationFactors = this.getEarthLocationFactors(state, preset, ghi, state.body || 'earth');
    const sunAngleRatio = SOLAR_LAYOUT_REFERENCE.winterNoonElevationDeg / Math.max(locationFactors.winterNoonElevationDeg, 6);
    const spacingFromLatitude = Math.pow(sunAngleRatio, mounting?.spacingLatitudeSensitivity || 0);
    const cloudinessDelta = locationFactors.cloudiness - SOLAR_LAYOUT_REFERENCE.cloudiness;
    const cloudinessRelief = Math.max(0.88, 1 - ((mounting?.spacingCloudRelief || 0) * cloudinessDelta));
    const layoutSpacingMultiplier = Math.max(0.82, Math.min(spacingFromLatitude * cloudinessRelief, 1.35));
    const groundCoverageRatio = Math.max(0.05, Math.min(baseGroundCoverageRatio / layoutSpacingMultiplier, 0.95));

    return {
      baseGroundCoverageRatio,
      groundCoverageRatio,
      layoutSpacingMultiplier,
    };
  },

  getLocationAdjustedBosCostPerW(state, preset, ghi, mounting, layoutSpacingMultiplier = 1) {
    const baseBosCostPerW = Math.max(0, state.bosCostPerW ?? mounting?.typicalBOS ?? 0);
    if ((state.body || 'earth') !== 'earth') {
      return {
        baseBosCostPerW,
        bosCostPerW: baseBosCostPerW,
        bosLocationMultiplier: 1,
      };
    }

    const locationFactors = this.getEarthLocationFactors(state, preset, ghi, state.body || 'earth');
    const layoutShift = layoutSpacingMultiplier - 1;
    const winterPenalty = Math.max(
      0,
      (SOLAR_LAYOUT_REFERENCE.winterNoonElevationDeg - locationFactors.winterNoonElevationDeg) /
      SOLAR_LAYOUT_REFERENCE.winterNoonElevationDeg
    );
    const cloudinessPenalty = Math.max(0, locationFactors.cloudiness - SOLAR_LAYOUT_REFERENCE.cloudiness);
    const bosLocationMultiplier = Math.max(
      0.85,
      Math.min(
        1 +
          ((mounting?.bosLayoutSensitivity || 0) * layoutShift) +
          ((mounting?.bosLatitudeSensitivity || 0) * winterPenalty) +
          ((mounting?.bosCloudSensitivity || 0) * cloudinessPenalty),
        1.25
      )
    );

    return {
      baseBosCostPerW,
      bosCostPerW: baseBosCostPerW * bosLocationMultiplier,
      bosLocationMultiplier,
    };
  },

  calculateSolar(state) {
    const bodyKey = state.body || 'earth';
    const body = this.getBodyConfig(bodyKey);
    const ghi = this.estimateGHI(state.latitude, state.longitude, bodyKey);
    const preset = this.getNearbyPreset(state.latitude, state.longitude, bodyKey);
    const mounting = MOUNTING_TYPES[state.mountingType];
    const coverageModel = this.getLocationAdjustedGroundCoverageRatio(state, preset, ghi, mounting);
    const groundCoverageRatio = coverageModel.groundCoverageRatio;
    const skyModel = bodyKey === 'earth'
      ? this.getEarthSkyModel(state.latitude, preset, ghi, groundCoverageRatio)
      : null;
    // An explicit 0 is a valid (if empty) yield; only a missing value falls back.
    const baseYield = Number.isFinite(state.siteYieldMwhPerMwdcYear)
      ? Math.max(0, state.siteYieldMwhPerMwdcYear)
      : this.estimateBaseYield(state.latitude, state.longitude, ghi, bodyKey);
    const yieldMult = this.getMountingYieldMultiplier(state, preset, ghi, skyModel);
    const siteYield = baseYield * yieldMult;
    const annualMWh = state.systemSizeMW * siteYield;
    const dailyMWh = annualMWh / body.cyclesPerEarthYear;
    const peakPowerKW = state.systemSizeMW * 1000;
    const baseBosCostPerW = Math.max(0, state.bosCostPerW ?? mounting.typicalBOS ?? 0);
    const totalPanelCost = state.systemSizeMW * 1e6 * state.panelCostPerW;

    const panelArea = (state.systemSizeMW * 1e6) / ((state.panelEfficiency / 100) * 1000);
    const landArea = panelArea / groundCoverageRatio;
    const acres = landArea / SQUARE_METERS_PER_ACRE;
    const bosModel = this.getLocationAdjustedBosCostPerW(
      state,
      preset,
      ghi,
      mounting,
      coverageModel.layoutSpacingMultiplier
    );
    const totalBOSCost = state.systemSizeMW * 1e6 * bosModel.bosCostPerW;
    const landCapex = acres * (state.landCostPerAcre || 0);
    const sitePrepCapex = acres * (state.sitePrepCostPerAcre || 0);
    // Land is not energy property and does not wear out: it is never
    // replaced, stays out of the solar (48E) basis, carries an annual charge
    // of capital x r (its opportunity cost; the land is recovered at the end)
    // and is returned at cost as salvage. Site prep is part of the installed
    // solar basis and is depreciated with the array, but a repowering reuses
    // the prepared site, so only modules + BOS are replaced.
    const depreciableSolarCapex = totalPanelCost + totalBOSCost + sitePrepCapex;
    const solarReplacementCapex = totalPanelCost + totalBOSCost;
    const totalSolarCapex = depreciableSolarCapex + landCapex;

    const rate = state.discountRate / 100;
    const annualizedLand = landCapex * Math.max(0, rate);
    const annualizedSolar = (depreciableSolarCapex * crf(rate, state.solarAssetLife)) + annualizedLand;
    const solarOmFrac = state.solarOmPercent / 100;
    const annualSolarOm = (totalPanelCost + totalBOSCost) * solarOmFrac;
    // Levelized (discounted) energy over the array life, matching the CRF
    // capital charge in the numerator.
    const levelizedAnnualMWh = annualMWh * getLevelizedSolarDegradationFactor(
      state.panelDegradationAnnual,
      state.solarAssetLife,
      rate
    );
    const lcoe = levelizedAnnualMWh > 0 ? (annualizedSolar + annualSolarOm) / levelizedAnnualMWh : 0;

    const solarGeo = this.getSolarGeometry(
      state,
      body,
      state.mountingType,
      skyModel ? this.getMountingSkyOptions(state.mountingType, skyModel) : null
    );
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
      baseYieldReference: this.describeBaseYieldReference(state, skyModel),
      yieldMult,
      siteYield,
      skyModel: skyModel ? this.getMountingSkyOptions(state.mountingType, skyModel) : null,
      panelDegradationAnnual: state.panelDegradationAnnual,
      sunHours: parseFloat(solarGeo.dayLengthHours.toFixed(1)),
      capacityFactor: state.systemSizeMW > 0 ? annualMWh / (state.systemSizeMW * 8760) : 0,
      annualMWh,
      levelizedAnnualMWh,
      dailyMWh,
      dailyKWh: dailyMWh * 1000,
      peakPowerKW,
      panelAreaM2: panelArea,
      landAreaM2: landArea,
      acres,
      baseGroundCoverageRatio: coverageModel.baseGroundCoverageRatio,
      groundCoverageRatio,
      layoutSpacingMultiplier: coverageModel.layoutSpacingMultiplier,
      solarCapex: totalPanelCost,
      moduleCapex: totalPanelCost,
      baseBosCostPerW,
      bosCostPerW: bosModel.bosCostPerW,
      bosLocationMultiplier: bosModel.bosLocationMultiplier,
      bosCapex: totalBOSCost,
      landCapex,
      sitePrepCapex,
      depreciableSolarCapex,
      solarReplacementCapex,
      totalSolarCapex,
      annualizedLand,
      annualizedSolar,
      annualSolarOm,
      lcoe,
      hourlyProfile: solarGeo.profile,
      mounting,
      solarGeo,
    };
  },
};
