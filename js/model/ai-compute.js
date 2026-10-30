/* ============================================
   AI datacenter dispatch
   ============================================
   Annual hour-by-hour dispatch of solar + battery to a constant AI load, with
   the residual feeding the chemical plant. Sizes the largest AI load that
   meets the reliability target and summarizes storage and chemical supply. */

import { AI_COMPUTE_DEFAULTS, MODEL_ASSUMPTIONS } from '../data/reference-data.js';
import { DEFAULT_STATE } from '../state/schema.js';

export const aiComputeMethods = {
  getAiBatteryHeuristicMWh(state) {
    if (!state?.aiComputeEnabled || this.hasBatteryStorage(state)) return 0;
    const annualSolarMWh = this.calculateSolar(state).annualMWh || 0;
    return this.clampNumber(annualSolarMWh / 1000, 0, 1e9, 0);
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
        annualAiServedKWh: 0,
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
      annualAiServedKWh,
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

  buildDisabledAiSummary(state) {
    return {
      enabled: false,
      reliabilityTarget: Math.max(0.0001, Math.min(0.99999, (state.aiReliabilityTarget || 99.9) / 100)) * 100,
      designLoadKW: 0,
      annualTokensM: 0,
      annualRevenue: 0,
      tokensPerKWYearM: 0,
      utilization: 0,
      fullPowerReliability: 1,
      fullPowerHours: 0,
      curtailedHours: 0,
      averageDailyTokensM: 0,
      averageDailyChemicalMWh: 0,
      chemicalAnnualKWh: 0,
      chemicalPeakKW: 0,
      chemicalDailyOpHours: 0,
      capex: 0,
      annualizedCapex: 0,
      annualOM: 0,
      assetLifeYears: state.aiAssetLifeYears || AI_COMPUTE_DEFAULTS.assetLifeYears,
      dispatch: null,
      storage: null,
      chemicalSupply: null,
    };
  },
};
