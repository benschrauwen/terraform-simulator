/* ============================================
   AI datacenter dispatch
   ============================================
   Annual hour-by-hour dispatch of solar + battery to a constant AI load, with
   the residual feeding the chemical plant. Sizes either the largest AI load
   that meets the reliability target with the given battery, or the smallest
   battery that lets a user-set load meet it, and summarizes storage and
   chemical supply. */

import { MODEL_ASSUMPTIONS } from '../data/assumptions.js';
import { AI_COMPUTE_DEFAULTS } from '../data/reference-data.js';
import { hasBatteryStorage } from '../state/normalize.js';
import { DEFAULT_STATE } from '../state/schema.js';
import {
  applyBatteryLeakage,
  batteryReceivesEnergy,
  chargeBattery,
  createAnnualBattery,
  dischargeBattery,
  getBatteryCapexAndLife,
  getEquivalentFullCyclesPerYear,
  settleAnnualStartSoc,
} from './battery.js';
import { crf } from './finance.js';
import { clampNumber } from '../util.js';

function withBatteryMWh(state, batteryMWh) {
  return { ...state, batteryCapacityMWh: batteryMWh, batteryEnabled: batteryMWh > 1e-9 };
}

export const aiComputeMethods = {
  getAiBatteryHeuristicMWh(state) {
    if (!state?.aiComputeEnabled || hasBatteryStorage(state)) return 0;
    const annualSolarMWh = this.calculateSolar(state).annualMWh || 0;
    return clampNumber((annualSolarMWh / 1000) * MODEL_ASSUMPTIONS.aiBatterySeedMWhPerSolarGWh, 0, 1e9, 0);
  },

  simulateAnnualDispatchPass(state, annualSolar, loadKW, startSocKWh, options = {}) {
    const captureSeries = Boolean(options.captureSeries);
    const captureDailySummaries = captureSeries || Boolean(options.captureDailySummaries);
    const chemicalCapacityKW = Number.isFinite(options.chemicalCapacityKW) ? Math.max(0, options.chemicalCapacityKW) : null;
    const opThresholdKW = Number.isFinite(options.opThresholdKW)
      ? Math.max(0, options.opThresholdKW)
      : (chemicalCapacityKW !== null && chemicalCapacityKW > 0 ? chemicalCapacityKW * MODEL_ASSUMPTIONS.processOperatingThresholdFraction : null);
    const source = Array.isArray(annualSolar?.hourlyKW) ? annualSolar.hourlyKW : [];
    const solarScale = Number.isFinite(options.solarScale) ? Math.max(0, options.solarScale) : 1;
    const hours = source.length;
    const summaryWindowHours = Math.max(1e-6, annualSolar?.windowHours || 24);
    const summaryBinCount = Math.max(1, Math.round(annualSolar?.windowBinCount || 24));
    const summaryWindowCount = captureDailySummaries
      ? Math.max(1, Math.ceil((hours / summaryWindowHours) - 1e-9))
      : 0;
    const battery = createAnnualBattery(state, startSocKWh);
    const battCapKWh = battery.capacityKWh;
    const aiHourlyKW = captureSeries ? new Array(hours).fill(0) : [];
    const chemicalHourlyKW = captureSeries ? new Array(hours).fill(0) : [];
    const batteryChargeHourlyKW = captureSeries ? new Array(hours).fill(0) : [];
    const clippedHourlyKW = captureSeries ? new Array(hours).fill(0) : [];
    const dailyAiSummaryKWh = captureDailySummaries && !captureSeries ? new Array(summaryWindowCount).fill(0) : [];
    const dailyBatteryChargeSummaryKWh = captureDailySummaries && !captureSeries ? new Array(summaryWindowCount).fill(0) : [];
    const dailyChemicalSummaryKWh = captureDailySummaries && !captureSeries ? new Array(summaryWindowCount).fill(0) : [];
    const dailyClippedSummaryKWh = captureDailySummaries && !captureSeries ? new Array(summaryWindowCount).fill(0) : [];
    let minSocKWh = battery.socKWh;
    let maxSocKWh = battery.socKWh;

    let solarKWh = 0;
    let chargeInputKWh = 0;
    let aiServedKWh = 0;
    let aiShortfallKWh = 0;
    let chemicalKWh = 0;
    let clippedSolarKWh = 0;
    let fullPowerHours = 0;
    let curtailedHours = 0;
    let chemicalPeakKW = 0;
    let chemicalOpHours = 0;

    for (let hour = 0; hour < hours; hour++) {
      applyBatteryLeakage(battery);

      let solarKW = source[hour] * solarScale;
      solarKWh += solarKW;
      let aiServed = Math.min(loadKW, solarKW);
      solarKW -= aiServed;

      if (loadKW - aiServed > 1e-9 && battCapKWh > 0 && battery.socKWh > 1e-9) {
        aiServed += dischargeBattery(battery, loadKW - aiServed);
      }

      let chargeFromSolarKW = 0;
      if (solarKW > 1e-9 && battCapKWh > 0 && battery.socKWh < battCapKWh - 1e-9) {
        chargeFromSolarKW = Math.min(solarKW, chargeBattery(battery, solarKW) / battery.chargeEff);
        solarKW -= chargeFromSolarKW;
        chargeInputKWh += chargeFromSolarKW;
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
      minSocKWh = Math.min(minSocKWh, battery.socKWh);
      maxSocKWh = Math.max(maxSocKWh, battery.socKWh);

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
        ? chemicalHourlyKW.reduce((sum, value) => sum + (value >= chemicalPeakKW * MODEL_ASSUMPTIONS.processOperatingThresholdFraction ? 1 : 0), 0)
      : chemicalOpHours;

    return {
      hours,
      loadKW,
      solarKWh,
      chargeInputKWh,
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
      chargeThroughputKWh: battery.chargeThroughputKWh,
      dischargeThroughputKWh: battery.dischargeThroughputKWh,
      leakageKWh: battery.leakageKWh,
      startSocKWh: Math.max(0, Math.min(battCapKWh, startSocKWh)),
      endSocKWh: battery.socKWh,
      minSocKWh,
      maxSocKWh,
      utilizedCapacityKWh: Math.max(0, maxSocKWh - minSocKWh),
    };
  },

  /* Periodic-year dispatch at a constant AI load. With no chemical cap the
     operating-hour threshold depends on the (unknown) residual peak, so
     op hours need a second pass; sizing searches skip it (`skipOpHours`). */
  simulateAnnualDispatchWithConstantAiLoad(state, annualSolar, loadKW, options = {}) {
    const captureSeries = options.captureSeries !== false;
    const captureDailySummaries = Boolean(options.captureDailySummaries);
    const chemicalCapacityKW = Number.isFinite(options.chemicalCapacityKW) ? Math.max(0, options.chemicalCapacityKW) : null;
    const solarScale = Number.isFinite(options.solarScale) ? Math.max(0, options.solarScale) : 1;
    const passOptions = { chemicalCapacityKW, solarScale };

    const finalizeDispatch = dispatch => {
      const needsSecondPass = !captureSeries && !options.skipOpHours &&
        chemicalCapacityKW === null && dispatch.chemicalPeakKW > 0;
      if (!needsSecondPass) {
        return { ...dispatch, chemicalCapacityKW: chemicalCapacityKW ?? dispatch.chemicalPeakKW };
      }
      const summarized = this.simulateAnnualDispatchPass(state, annualSolar, loadKW, dispatch.startSocKWh, {
        ...passOptions,
        captureSeries: false,
        opThresholdKW: dispatch.chemicalPeakKW * MODEL_ASSUMPTIONS.processOperatingThresholdFraction,
      });
      return {
        ...dispatch,
        chemicalOpHours: summarized.chemicalOpHours,
        chemicalCapacityKW: dispatch.chemicalPeakKW,
      };
    };

    const { startSocKWh, settleIterations } = settleAnnualStartSoc(
      createAnnualBattery(state).capacityKWh,
      start => this.simulateAnnualDispatchPass(state, annualSolar, loadKW, start, { ...passOptions, captureSeries: false }),
      { hasInput: batteryReceivesEnergy(state, annualSolar, solarScale) }
    );

    const captured = this.simulateAnnualDispatchPass(state, annualSolar, loadKW, startSocKWh, {
      ...passOptions,
      captureSeries,
      captureDailySummaries,
    });
    return finalizeDispatch({
      ...captured,
      settleIterations: hasBatteryStorage(state) ? settleIterations : 1,
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

  buildAnnualStorageSummary(state, dispatch, batteryCapex, batteryLifeYears, equivalentFullCyclesPerYear = 0) {
    const batteryEnabled = hasBatteryStorage(state);
    return {
      enabled: batteryEnabled,
      capex: batteryEnabled ? batteryCapex : 0,
      battCapKWh: batteryEnabled ? (state.batteryCapacityMWh || 0) * 1000 : 0,
      annualizedCapex: batteryEnabled ? batteryCapex * crf(state.discountRate / 100, batteryLifeYears) : 0,
      lifetimeYears: batteryEnabled ? batteryLifeYears : 0,
      equivalentFullCyclesPerYear: batteryEnabled ? equivalentFullCyclesPerYear : 0,
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
      sizingPercent: dispatch.chemicalSizingPercent,
      baseloadKW: dispatch.loadKW || 0,
      clipKW: Math.max(0, fullCapturePowerKW - processPowerKW),
    };
  },

  /* Largest constant AI load (kW) whose full-power hour share meets the
     target with the state's battery: doubling to bracket, then bisection. */
  solveMaxAiLoadKW(state, dispatchSolar, targetReliability) {
    const hours = Array.isArray(dispatchSolar?.hourlyKW) ? dispatchSolar.hourlyKW.length : 0;
    const sizingDispatch = loadKW => this.simulateAnnualDispatchWithConstantAiLoad(state, dispatchSolar, loadKW, {
      captureSeries: false,
      skipOpHours: true,
    });

    const averageSolarKW = (dispatchSolar.totalKWh || 0) / Math.max(hours, 1);
    const peakSolarKW = Array.isArray(dispatchSolar?.hourlyKW) ? Math.max(...dispatchSolar.hourlyKW, 0) : 0;
    let lo = 0;
    let hi = Math.max(1, averageSolarKW / targetReliability, peakSolarKW);
    let best = sizingDispatch(0);

    while (hi < 1e9) {
      const upperBoundDispatch = sizingDispatch(hi);
      if (upperBoundDispatch.fullPowerReliability < targetReliability) {
        break;
      }
      best = upperBoundDispatch;
      lo = hi;
      hi *= 2;
    }

    // Reliability is a step function of the load; resolve it to 1e-5 of the
    // search span (well below any displayed precision).
    const loadToleranceKW = Math.max(1e-6, hi * 1e-5);
    while (hi - lo > loadToleranceKW) {
      const mid = (lo + hi) / 2;
      const dispatch = sizingDispatch(mid);
      if (dispatch.fullPowerReliability >= targetReliability) {
        best = dispatch;
        lo = mid;
      } else {
        hi = mid;
      }
    }

    return best.loadKW;
  },

  /* Largest battery the fixed-load sizing considers: this many full
     day-night cycles of the IT load (aiFixedLoadMaxAutonomyCycles). */
  getAiFixedLoadMaxBatteryMWh(state, loadKW) {
    const cycleHours = this.getBodyConfig(state.body || 'earth').cycleHours;
    return (Math.max(0, loadKW) * cycleHours * MODEL_ASSUMPTIONS.aiFixedLoadMaxAutonomyCycles) / 1000;
  },

  /* "Set load" sizing: the smallest battery (MWh, at the state's duration,
     efficiency and leakage) whose settled annual dispatch keeps the constant
     `loadKW` at full rate for at least the target share of hours.
     Reliability rises with capacity (more energy carried and, at a fixed
     duration, more power), so bisection applies. Past the autonomy cap the
     load is infeasible (energy- or power-limited); the result then carries
     the capped battery and the largest load that the capped sizing can
     serve (feasibility scales with load / solar, so that is a bisection too). */
  sizeAiBatteryForLoad(state, dispatchSolar, loadKW, targetReliability) {
    const reliabilityAt = (load, batteryMWh) => this.simulateAnnualDispatchWithConstantAiLoad(
      withBatteryMWh(state, batteryMWh), dispatchSolar, load, { captureSeries: false, skipOpHours: true }
    ).fullPowerReliability;
    const maxBatteryMWh = this.getAiFixedLoadMaxBatteryMWh(state, loadKW);
    const sizing = { loadKW, maxBatteryMWh, batteryMWh: 0, feasible: true, maxFeasibleLoadKW: loadKW };

    if (!(loadKW > 0) || reliabilityAt(loadKW, 0) >= targetReliability) return sizing;

    if (reliabilityAt(loadKW, maxBatteryMWh) < targetReliability) {
      let lo = 0;
      let hi = loadKW;
      while (hi - lo > Math.max(1e-6, loadKW * 1e-4)) {
        const mid = (lo + hi) / 2;
        if (reliabilityAt(mid, this.getAiFixedLoadMaxBatteryMWh(state, mid)) >= targetReliability) lo = mid;
        else hi = mid;
      }
      return { ...sizing, batteryMWh: maxBatteryMWh, feasible: false, maxFeasibleLoadKW: lo };
    }

    // Resolve the capacity to 1e-4 of itself (the reliability is a step
    // function of capacity, so the smallest passing size is a threshold).
    let lo = 0;
    let hi = maxBatteryMWh;
    while (hi - lo > Math.max(1e-6, hi * 1e-4)) {
      const mid = (lo + hi) / 2;
      if (reliabilityAt(loadKW, mid) >= targetReliability) hi = mid;
      else lo = mid;
    }
    return { ...sizing, batteryMWh: hi };
  },

  /* The AI design: in "max" mode (default) the largest constant AI load
     whose full-power hour share meets the target with the state's battery;
     in "fixed" mode the user's load with the smallest battery that meets
     the target (the state's own battery is left untouched). Both run on the
     year-1 (clear-sky-equivalent) annual series, then size the residual
     chemical plant, then re-dispatch the same fixed design on degraded
     solar for the per-year energy vectors. Only called with AI enabled. */
  calculateAICompute(rawState, solar, annualSolar, options = {}) {
    const captureDispatchSeries = options.captureDispatchSeries !== false;
    const includeDisplayDispatchSeries = options.includeDisplayDispatchSeries !== false;
    const captureDailySummaries = Boolean(options.captureDailySummaries);
    const chemicalSizingFraction = this.getChemicalSizingFraction(rawState);
    const cyclesPerYear = this.getBodyConfig(rawState.body || 'earth').cyclesPerEarthYear;
    const dispatchBasis = options.dispatchBasis || this.getAnnualDispatchBasis(rawState, solar, annualSolar, {
      includeWindowSummaries: captureDispatchSeries || includeDisplayDispatchSeries,
    });
    const dispatchSolar = dispatchBasis.solar;
    const annualizationFactor = dispatchBasis.annualizationFactor;
    const dispatchHorizonLabel = dispatchBasis.horizonLabel;
    const targetReliability = Math.max(0.0001, Math.min(0.99999, (rawState.aiReliabilityTarget || DEFAULT_STATE.aiReliabilityTarget) / 100));
    const fixedLoad = rawState.aiSizingMode === 'fixed';
    const batterySizing = fixedLoad
      ? this.sizeAiBatteryForLoad(rawState, dispatchSolar, rawState.aiLoadKW, targetReliability)
      : null;
    // The design state: the sized battery replaces the state's own for every
    // dispatch, capex and replacement below.
    const state = batterySizing ? withBatteryMWh(rawState, batterySizing.batteryMWh) : rawState;
    const designLoadKW = fixedLoad
      ? rawState.aiLoadKW
      : this.solveMaxAiLoadKW(state, dispatchSolar, targetReliability);
    const fullCaptureDispatch = this.simulateAnnualDispatchWithConstantAiLoad(state, dispatchSolar, designLoadKW, {
      captureSeries: false,
      skipOpHours: true,
    });
    const chemicalCapacityKW = (fullCaptureDispatch.chemicalPeakKW || 0) * chemicalSizingFraction;
    const finalDispatch = {
      ...this.simulateAnnualDispatchWithConstantAiLoad(state, dispatchSolar, designLoadKW, {
        captureSeries: captureDispatchSeries,
        captureDailySummaries: captureDailySummaries || !captureDispatchSeries,
        chemicalCapacityKW,
      }),
      fullCaptureChemicalKW: fullCaptureDispatch.chemicalPeakKW || 0,
      fullCaptureChemicalKWh: fullCaptureDispatch.chemicalKWh || 0,
      chemicalSizingPercent: state.chemicalSizingPercent,
    };
    const lifetimeEnergy = this.buildLifetimeEnergyProfile(state, {
      year1: {
        aiServedKWh: finalDispatch.aiServedKWh,
        chemicalKWh: finalDispatch.chemicalKWh,
        clippedKWh: finalDispatch.clippedSolarKWh,
        reliability: finalDispatch.fullPowerReliability,
      },
      annualizationFactor,
      solarKWh: dispatchSolar.totalKWh || 0,
      evaluate: solarScale => {
        const degraded = this.simulateAnnualDispatchWithConstantAiLoad(state, dispatchSolar, designLoadKW, {
          captureSeries: false,
          skipOpHours: true,
          chemicalCapacityKW,
          solarScale,
        });
        return {
          aiServedKWh: degraded.aiServedKWh,
          chemicalKWh: degraded.chemicalKWh,
          clippedKWh: degraded.clippedSolarKWh,
          reliability: degraded.fullPowerReliability,
        };
      },
    });
    const {
      capex: batteryCapex,
      lifetimeYears: batteryLifeYears,
      equivalentFullCyclesPerYear: batteryCyclesPerYear,
    } = getBatteryCapexAndLife(state, getEquivalentFullCyclesPerYear(state, finalDispatch, annualizationFactor));
    const annualAiServedKWh = finalDispatch.aiServedKWh * annualizationFactor;
    const annualChemicalKWh = finalDispatch.chemicalKWh * annualizationFactor;
    const annualTokensM = (annualAiServedKWh / 1000) * (state.aiMillionTokensPerMWh || 0);
    const gpuCapexPerKW = state.aiGpuCapexPerKW;
    const capex = designLoadKW * gpuCapexPerKW;
    const annualizedCapex = capex * crf(state.discountRate / 100, state.aiAssetLifeYears);
    const annualOM = capex * ((AI_COMPUTE_DEFAULTS.omPercent || 0) / 100);
    const minReliabilityYearIndex = lifetimeEnergy.aiReliabilityByYear.indexOf(lifetimeEnergy.minAiReliability);

    return {
      enabled: true,
      reliabilityTarget: targetReliability * 100,
      // Reliability is measured against a modeled year in which every day
      // has the clear-sky shape scaled to the site's annual yield: multi-day
      // weather (cloudy spells) is not modeled.
      reliabilityBasis: 'clear-sky-equivalent',
      sizingMode: fixedLoad ? 'fixed' : 'max',
      // "Set load" only: whether the sized battery meets the target, and the
      // sizing itself (battery, cap, largest feasible load).
      loadFeasible: batterySizing ? batterySizing.feasible : true,
      batterySizing,
      designLoadKW,
      annualAiServedKWh,
      annualTokensM,
      annualRevenue: annualTokensM * (state.aiTokenPricePerM || 0),
      tokensPerKWYearM: designLoadKW > 0 ? annualTokensM / designLoadKW : 0,
      utilization: finalDispatch.utilization,
      fullPowerReliability: finalDispatch.fullPowerReliability,
      lateLifeReliability: lifetimeEnergy.minAiReliability,
      lateLifeReliabilityYear: minReliabilityYearIndex >= 0 ? minReliabilityYearIndex + 1 : 1,
      lateLifeSolarFactor: lifetimeEnergy.minSolarFactor,
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
      assetLifeYears: state.aiAssetLifeYears,
      dispatch: this.attachAnnualDispatchDisplaySeries(state, dispatchSolar, finalDispatch, dispatchHorizonLabel, {
        includeDisplaySeries: includeDisplayDispatchSeries,
        includeSolarSummary: captureDispatchSeries || includeDisplayDispatchSeries,
      }),
      storage: this.buildAnnualStorageSummary(state, finalDispatch, batteryCapex, batteryLifeYears, batteryCyclesPerYear),
      chemicalSupply: this.buildAnnualChemicalSupplySummary(finalDispatch, solar, cyclesPerYear, annualizationFactor, {
        includeSeries: captureDispatchSeries,
      }),
      lifetimeEnergy,
    };
  },

  buildDisabledAiSummary(state) {
    return {
      enabled: false,
      reliabilityTarget: Math.max(0.0001, Math.min(0.99999, (state.aiReliabilityTarget || DEFAULT_STATE.aiReliabilityTarget) / 100)) * 100,
      sizingMode: state.aiSizingMode === 'fixed' ? 'fixed' : 'max',
      loadFeasible: true,
      batterySizing: null,
      designLoadKW: 0,
      annualTokensM: 0,
      annualRevenue: 0,
      tokensPerKWYearM: 0,
      utilization: 0,
      fullPowerReliability: 1,
      lateLifeReliability: 1,
      lateLifeReliabilityYear: 1,
      lateLifeSolarFactor: 1,
      batterySeededMWh: 0,
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
      assetLifeYears: state.aiAssetLifeYears,
      dispatch: null,
      storage: null,
      chemicalSupply: null,
      lifetimeEnergy: null,
    };
  },
};
