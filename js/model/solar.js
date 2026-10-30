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
  MOUNTING_YIELD_ADJUSTMENTS,
  SOLAR_LAYOUT_REFERENCE,
  SQUARE_METERS_PER_ACRE,
} from '../data/assumptions.js';
import {
  LOCATION_PRESETS,
  MOUNTING_TYPES,
  PLANETARY_BODIES,
} from '../data/reference-data.js';
import { DEFAULT_STATE } from '../state/schema.js';
import { crf, getAverageSolarDegradationFactor } from './finance.js';
import { SolarGeometry } from './solar-geometry.js';

function isInAridRegion(lat, lon) {
  return ARID_GHI_REGIONS.boxes.some(box =>
    lon > box.minLon && lon < box.maxLon && lat > box.minLat && lat < box.maxLat
  );
}

export const solarMethods = {
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

  estimateBaseYield(lat, lon, ghi, bodyKey = 'earth') {
    const preset = this.getNearbyPreset(lat, lon, bodyKey);
    if (preset) return preset.baseYield;
    if (bodyKey !== 'earth') return Math.round(Math.max(0, ghi));
    return Math.round(ghi * MODEL_ASSUMPTIONS.fallbackYieldFromGhi);
  },

  getSolarGeometry(state, body, mountingKey) {
    const profileModel = state.solarProfileModel || state.body || 'earth';
    if ((state.body || 'earth') === 'earth') {
      return SolarGeometry.annualAverageProfile(state.latitude, mountingKey);
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

  getMountingYieldMultiplier(state, preset, ghi) {
    const mounting = MOUNTING_TYPES[state.mountingType];
    if (!mounting) return 1;
    if ((state.body || 'earth') !== 'earth' || state.mountingType === 'fixed') {
      return mounting.yieldMult;
    }

    const latitudeFactor = Math.max(0, Math.min(1, (Math.abs(state.latitude) - 20) / 25));
    const cloudiness = this.getCloudinessFactor(preset?.region, ghi, state.body || 'earth');

    const adjustment = Object.hasOwn(MOUNTING_YIELD_ADJUSTMENTS, state.mountingType)
      ? MOUNTING_YIELD_ADJUSTMENTS[state.mountingType]
      : null;
    if (!adjustment) return mounting.yieldMult;

    return mounting.yieldMult +
      (latitudeFactor * adjustment.latitudeSlope) +
      (cloudiness * adjustment.cloudinessSlope);
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
    const baseYield = state.siteYieldMwhPerMwdcYear || this.estimateBaseYield(state.latitude, state.longitude, ghi, bodyKey);
    const yieldMult = this.getMountingYieldMultiplier(state, preset, ghi);
    const siteYield = baseYield * yieldMult;
    const annualMWh = state.systemSizeMW * siteYield;
    const dailyMWh = annualMWh / body.cyclesPerEarthYear;
    const peakPowerKW = state.systemSizeMW * 1000;
    const baseBosCostPerW = Math.max(0, state.bosCostPerW ?? mounting.typicalBOS ?? 0);
    const totalPanelCost = state.systemSizeMW * 1e6 * state.panelCostPerW;

    const panelArea = (state.systemSizeMW * 1e6) / ((state.panelEfficiency / 100) * 1000);
    const coverageModel = this.getLocationAdjustedGroundCoverageRatio(state, preset, ghi, mounting);
    const groundCoverageRatio = coverageModel.groundCoverageRatio;
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
    const totalSolarCapex = totalPanelCost + totalBOSCost + landCapex + sitePrepCapex;

    const rate = state.discountRate / 100;
    const annualizedSolar = totalSolarCapex * crf(rate, state.solarAssetLife);
    const solarOmFrac = (state.solarOmPercent ?? DEFAULT_STATE.solarOmPercent) / 100;
    const annualSolarOm = (totalPanelCost + totalBOSCost) * solarOmFrac;
    const lifetimeAverageAnnualMWh = annualMWh * getAverageSolarDegradationFactor(
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
      totalSolarCapex,
      annualizedSolar,
      annualSolarOm,
      lcoe,
      hourlyProfile: solarGeo.profile,
      mounting,
      solarGeo,
    };
  },
};
