/* ============================================
   Battery storage
   ============================================
   Shared battery primitives (parameters, per-step charge/discharge, annual
   start-SoC settling, capex/life) used by both dispatch models, plus the
   chemical-plant dispatch: solar first feeds the process, the battery covers
   shortfalls, and surplus charges the battery. */

import { MODEL_ASSUMPTIONS } from '../data/assumptions.js';
import { hasBatteryStorage } from '../state/normalize.js';
import { DEFAULT_STATE } from '../state/schema.js';
import { crf } from './finance.js';
import { clampNumber } from './util.js';

export function getBatteryLeakageRetention(stepHours) {
  const monthlyLeakage = Math.max(0, Math.min(0.999999, MODEL_ASSUMPTIONS.batteryMonthlyLeakage || 0));
  if (!Number.isFinite(stepHours) || stepHours <= 0 || monthlyLeakage <= 0) return 1;
  const averageMonthHours = (365 * 24) / 12;
  return Math.pow(1 - monthlyLeakage, stepHours / averageMonthHours);
}

/* Mutable battery for the hour-by-hour annual dispatch loops: capacity,
   one-way efficiencies (sqrt of round trip), hourly self-discharge retention,
   state of charge and throughput counters. */
export function createAnnualBattery(state, startSocKWh = 0) {
  const capacityKWh = hasBatteryStorage(state) ? Math.max(0, (state.batteryCapacityMWh || 0) * 1000) : 0;
  const rtEff = capacityKWh > 0 ? Math.max(0, Math.min(1, (state.batteryEfficiency || 0) / 100)) : 1;
  const oneWayEff = capacityKWh > 0 ? Math.sqrt(Math.max(rtEff, 1e-9)) : 1;
  return {
    capacityKWh,
    chargeEff: oneWayEff,
    dischargeEff: oneWayEff,
    leakageRetentionPerStep: getBatteryLeakageRetention(1),
    socKWh: Math.max(0, Math.min(capacityKWh, startSocKWh)),
    chargeThroughputKWh: 0,
    dischargeThroughputKWh: 0,
  };
}

export function applyBatteryLeakage(battery) {
  if (battery.socKWh > 1e-9) {
    battery.socKWh = Math.max(0, battery.socKWh * battery.leakageRetentionPerStep);
  }
}

/* Discharges up to `shortfallKWh` to a load; returns the energy delivered. */
export function dischargeBattery(battery, shortfallKWh) {
  const deliveredKWh = Math.min(shortfallKWh, battery.socKWh * battery.dischargeEff);
  battery.socKWh -= deliveredKWh / battery.dischargeEff;
  battery.dischargeThroughputKWh += deliveredKWh;
  return deliveredKWh;
}

/* Charges from `surplusKWh` of input energy; returns the energy stored
   (after charge losses). The input drawn is stored / chargeEff. */
export function chargeBattery(battery, surplusKWh) {
  const storedKWh = Math.min(battery.capacityKWh - battery.socKWh, surplusKWh * battery.chargeEff);
  battery.socKWh += storedKWh;
  battery.chargeThroughputKWh += storedKWh;
  return storedKWh;
}

/* Re-runs an annual dispatch preview from its own end SoC until the year is
   periodic (end SoC == start SoC within tolerance). `runPreview(startSocKWh)`
   must return `{ endSocKWh }`. */
export function settleAnnualStartSoc(capacityKWh, runPreview) {
  let startSocKWh = capacityKWh * MODEL_ASSUMPTIONS.batteryStartSocFraction;
  let settleIterations = 0;
  const settleTolKWh = Math.max(1e-3, capacityKWh * 1e-6);

  for (; settleIterations < 24; settleIterations++) {
    const preview = runPreview(startSocKWh);
    const settleDeltaKWh = Math.abs(preview.endSocKWh - startSocKWh);
    startSocKWh = preview.endSocKWh;
    if (settleDeltaKWh <= settleTolKWh) {
      break;
    }
  }

  return { startSocKWh, settleIterations: settleIterations + 1 };
}

/* Installed battery capex and replacement life: cycle-limited, capped at the
   nominal calendar life. */
export function getBatteryCapexAndLife(state, cyclesPerYear) {
  if (!hasBatteryStorage(state)) return { capex: 0, lifetimeYears: 0 };
  return {
    capex: Math.max(0, (state.batteryCapacityMWh || 0) * 1000 * (state.batteryCostPerKWh || 0)),
    lifetimeYears: Math.max(
      1,
      Math.min(MODEL_ASSUMPTIONS.batteryNominalLifeYears, (state.batteryCycles || 0) / Math.max(1, cyclesPerYear))
    ),
  };
}

export const batteryMethods = {
  getChemicalSizingFraction(state) {
    return clampNumber(state?.chemicalSizingPercent, 0, 100, DEFAULT_STATE.chemicalSizingPercent) / 100;
  },

  getBatteryLeakageRetention,

  simulateAnnualChemicalDispatch(state, annualSolar, processPowerKW, options = {}) {
    const captureSeries = options.captureSeries !== false;
    const source = Array.isArray(annualSolar?.hourlyKW) ? annualSolar.hourlyKW : [];
    const hours = source.length;
    const summaryWindowHours = Math.max(1e-6, annualSolar?.windowHours || 24);
    const summaryBinCount = Math.max(1, Math.round(annualSolar?.windowBinCount || 24));
    const batteryEnabled = hasBatteryStorage(state);
    const battCapKWh = createAnnualBattery(state).capacityKWh;
    const targetProcessKW = Math.max(0, Number(processPowerKW) || 0);
    const opThresholdKW = targetProcessKW > 0 ? targetProcessKW * MODEL_ASSUMPTIONS.processOperatingThresholdFraction : null;

    const runPass = (startSocKWh, includeSeries = captureSeries) => {
      const chemicalHourlyKW = includeSeries ? new Array(hours).fill(0) : [];
      const batteryChargeHourlyKW = includeSeries ? new Array(hours).fill(0) : [];
      const clippedHourlyKW = includeSeries ? new Array(hours).fill(0) : [];
      const battery = createAnnualBattery(state, startSocKWh);
      let minSocKWh = battery.socKWh;
      let maxSocKWh = battery.socKWh;
      let chemicalKWh = 0;
      let clippedSolarKWh = 0;
      let chemicalPeakKW = 0;
      let chemicalOpHours = 0;

      for (let hour = 0; hour < hours; hour++) {
        applyBatteryLeakage(battery);

        const processCapKWh = targetProcessKW;
        const generatedKWh = Math.max(0, Number(source[hour]) || 0);
        const directToChemicalKWh = Math.min(processCapKWh, generatedKWh);
        let deliveredKWh = directToChemicalKWh;

        if (deliveredKWh + 1e-9 < processCapKWh && battery.socKWh > 1e-9) {
          deliveredKWh += dischargeBattery(battery, processCapKWh - deliveredKWh);
        }

        let solarAvailableKWh = generatedKWh - directToChemicalKWh;
        if (solarAvailableKWh > 1e-9 && battery.socKWh < battCapKWh - 1e-9) {
          const storedKWh = chargeBattery(battery, solarAvailableKWh);
          const chargeInputKWh = Math.min(solarAvailableKWh, storedKWh / battery.chargeEff);
          solarAvailableKWh -= chargeInputKWh;
          if (includeSeries) batteryChargeHourlyKW[hour] = chargeInputKWh;
        }

        chemicalKWh += deliveredKWh;
        clippedSolarKWh += Math.max(0, solarAvailableKWh);
        chemicalPeakKW = Math.max(chemicalPeakKW, deliveredKWh);
        minSocKWh = Math.min(minSocKWh, battery.socKWh);
        maxSocKWh = Math.max(maxSocKWh, battery.socKWh);
        if (opThresholdKW !== null && deliveredKWh >= opThresholdKW - 1e-6) {
          chemicalOpHours += 1;
        }

        if (includeSeries) {
          chemicalHourlyKW[hour] = deliveredKWh;
          clippedHourlyKW[hour] = Math.max(0, solarAvailableKWh);
        }
      }

      const dailyChemicalKWh = includeSeries ? this.aggregateSeriesBySpanHours(chemicalHourlyKW, summaryWindowHours) : [];
      const dailyClippedKWh = includeSeries ? this.aggregateSeriesBySpanHours(clippedHourlyKW, summaryWindowHours) : [];
      const averageDayChemicalKW = includeSeries ? this.averageSeriesByCyclePhase(chemicalHourlyKW, summaryWindowHours, summaryBinCount) : [];
      const averageDayClippedKW = includeSeries ? this.averageSeriesByCyclePhase(clippedHourlyKW, summaryWindowHours, summaryBinCount) : [];
      const averageDayBatteryChargeKW = includeSeries ? this.averageSeriesByCyclePhase(batteryChargeHourlyKW, summaryWindowHours, summaryBinCount) : [];

      return {
        hours,
        chemicalHourlyKW,
        clippedHourlyKW,
        batteryChargeHourlyKW,
        chemicalKWh,
        clippedSolarKWh,
        dailyChemicalKWh,
        dailyClippedKWh,
        averageDayChemicalKW,
        averageDayClippedKW,
        averageDayBatteryChargeKW,
        chemicalPeakKW,
        chemicalCapacityKW: targetProcessKW,
        chemicalOpHours,
        startSocKWh: Math.max(0, Math.min(battCapKWh, startSocKWh)),
        endSocKWh: battery.socKWh,
        minSocKWh,
        maxSocKWh,
        utilizedCapacityKWh: Math.max(0, maxSocKWh - minSocKWh),
        chargeThroughputKWh: battery.chargeThroughputKWh,
        dischargeThroughputKWh: battery.dischargeThroughputKWh,
      };
    };

    if (!batteryEnabled) {
      return {
        ...runPass(0),
        settleIterations: 1,
        settleDeltaKWh: 0,
      };
    }

    const { startSocKWh, settleIterations } = settleAnnualStartSoc(
      battCapKWh,
      start => runPass(start, false)
    );
    const captured = runPass(startSocKWh);
    return {
      ...captured,
      settleIterations,
      settleDeltaKWh: Math.abs(captured.endSocKWh - captured.startSocKWh),
    };
  },

  calculateBattery(state, solar, options = {}) {
    const includeSeries = options.includeSeries !== false;
    const stepCount = solar.hourlyProfile.length;
    const stepHours = solar.binHours;
    const solarKW = solar.hourlyProfile.map(v => Math.min((v * solar.dailyKWh) / stepHours, solar.peakPowerKW));
    const chemicalSizingFraction = this.getChemicalSizingFraction(state);
    // Keep the zero-storage case on the same basis as the battery-backed case:
    // size process equipment from the modeled direct-solar peak, not PV nameplate.
    const directProcessPeakKW = Math.max(...solarKW, 0);
    const directOpHours = directProcessPeakKW > 0
      ? solarKW.reduce((sum, value) => sum + (value >= directProcessPeakKW * MODEL_ASSUMPTIONS.processOperatingThresholdFraction ? stepHours : 0), 0)
      : 0;
    const directEffectiveCF = directProcessPeakKW > 0
      ? solar.dailyKWh / (directProcessPeakKW * solar.cycleHours)
      : 0;
    const batteryEnabled = hasBatteryStorage(state);

    const buildStorageSummary = summary => ({
      enabled: Boolean(summary.enabled),
      capex: summary.capex || 0,
      battCapKWh: summary.battCapKWh || 0,
      annualizedCapex: summary.annualizedCapex || 0,
      lifetimeYears: summary.lifetimeYears || 0,
      utilizedCapacityKWh: summary.utilizedCapacityKWh || 0,
      startBatteryKWh: summary.startBatteryKWh || 0,
      endBatteryKWh: summary.endBatteryKWh || 0,
      minBatteryKWh: summary.minBatteryKWh || 0,
      maxBatteryKWh: summary.maxBatteryKWh || 0,
      chargeThroughputKWh: summary.chargeThroughputKWh || 0,
      dischargeThroughputKWh: summary.dischargeThroughputKWh || 0,
      settleDeltaKWh: summary.settleDeltaKWh || 0,
    });

    const buildChemicalSupply = summary => ({
      effectiveCF: summary.effectiveCF || 0,
      dailyOpHours: summary.dailyOpHours || 0,
      dailyAvailableKWh: summary.dailyAvailableKWh || 0,
      clippedDailyKWh: summary.clippedDailyKWh || 0,
      hourlyProfile: includeSeries ? (summary.hourlyProfile || []) : [],
      hourlyKW: includeSeries ? (summary.hourlyKW || []) : [],
      clippedHourlyKW: includeSeries ? (summary.clippedHourlyKW || []) : [],
      batteryChargeHourlyKW: includeSeries ? (summary.batteryChargeHourlyKW || []) : [],
      processPowerKW: summary.processPowerKW || 0,
      fullCapturePowerKW: summary.fullCapturePowerKW || summary.processPowerKW || 0,
      fullCaptureDailyKWh: summary.fullCaptureDailyKWh || summary.dailyAvailableKWh || 0,
      capturedSolarFraction: summary.capturedSolarFraction ?? 1,
      sizingPercent: summary.sizingPercent ?? (state.chemicalSizingPercent ?? 100),
      baseloadKW: summary.baseloadKW || 0,
      clipKW: summary.clipKW || 0,
    });

    if (!batteryEnabled) {
      const processPowerKW = directProcessPeakKW * chemicalSizingFraction;
      const hourlyKW = solarKW.map(value => Math.min(value, processPowerKW));
      const clippedHourlyKW = solarKW.map((value, index) => Math.max(0, value - hourlyKW[index]));
      const dailyAvailableKWh = hourlyKW.reduce((sum, value) => sum + (value * stepHours), 0);
      const clippedDailyKWh = clippedHourlyKW.reduce((sum, value) => sum + (value * stepHours), 0);
      const dailyOpHours = processPowerKW > 0
        ? hourlyKW.reduce((sum, value) => sum + (value >= processPowerKW * MODEL_ASSUMPTIONS.processOperatingThresholdFraction ? stepHours : 0), 0)
        : 0;
      const effectiveCF = processPowerKW > 0
        ? dailyAvailableKWh / (processPowerKW * solar.cycleHours)
        : 0;
      const normalizedProfile = includeSeries && dailyAvailableKWh > 0
        ? hourlyKW.map(value => (value * stepHours) / dailyAvailableKWh)
        : [];
      return {
        storage: buildStorageSummary({
          enabled: false,
        }),
        chemicalSupply: buildChemicalSupply({
          effectiveCF: chemicalSizingFraction >= (1 - 1e-9) ? directEffectiveCF : effectiveCF,
          dailyOpHours: chemicalSizingFraction >= (1 - 1e-9) ? directOpHours : dailyOpHours,
          dailyAvailableKWh: chemicalSizingFraction >= (1 - 1e-9) ? solar.dailyKWh : dailyAvailableKWh,
          clippedDailyKWh: chemicalSizingFraction >= (1 - 1e-9) ? 0 : clippedDailyKWh,
          hourlyProfile: chemicalSizingFraction >= (1 - 1e-9)
            ? (includeSeries ? solar.hourlyProfile : [])
            : normalizedProfile,
          hourlyKW: includeSeries ? hourlyKW : [],
          clippedHourlyKW: includeSeries ? clippedHourlyKW : [],
          batteryChargeHourlyKW: includeSeries ? new Array(stepCount).fill(0) : [],
          processPowerKW,
          fullCapturePowerKW: directProcessPeakKW,
          fullCaptureDailyKWh: solar.dailyKWh,
          capturedSolarFraction: solar.dailyKWh > 0 ? dailyAvailableKWh / solar.dailyKWh : 1,
          baseloadKW: processPowerKW,
          clipKW: Math.max(0, directProcessPeakKW - processPowerKW),
          sizingPercent: state.chemicalSizingPercent ?? 100,
        }),
      };
    }

    const battCapKWh = Math.max(0, (state.batteryCapacityMWh || 0) * 1000);
    const rtEff = Math.max(0, Math.min(1, state.batteryEfficiency / 100));
    const oneWayEff = Math.max(Math.sqrt(rtEff), 1e-9);
    const leakageRetentionPerStep = getBatteryLeakageRetention(stepHours);
    const maxSolarKW = Math.max(...solarKW, 0);
    const averageSolarKW = solar.cycleHours > 0 ? solar.dailyKWh / solar.cycleHours : 0;

    const simulateCycle = (processKW, startSocKWh, captureSeries = false) => {
      const output = captureSeries ? new Array(stepCount).fill(0) : [];
      const batteryChargeKW = captureSeries ? new Array(stepCount).fill(0) : [];
      const clippedHourlyKW = captureSeries ? new Array(stepCount).fill(0) : [];
      const battery = {
        capacityKWh: battCapKWh,
        chargeEff: oneWayEff,
        dischargeEff: oneWayEff,
        leakageRetentionPerStep,
        socKWh: Math.max(0, Math.min(battCapKWh, startSocKWh)),
        chargeThroughputKWh: 0,
        dischargeThroughputKWh: 0,
      };
      let minSocKWh = battery.socKWh;
      let maxSocKWh = battery.socKWh;
      let chemicalKWh = 0;
      let curtailedKWh = 0;
      let activeProcessHours = 0;

      for (let h = 0; h < stepCount; h++) {
        applyBatteryLeakage(battery);
        const processCapKWh = processKW * stepHours;
        const generatedKWh = solarKW[h] * stepHours;
        const directToChemicalKWh = Math.min(processCapKWh, generatedKWh);
        let deliveredKWh = directToChemicalKWh;

        if (deliveredKWh + 1e-9 < processCapKWh && battery.socKWh > 1e-9) {
          deliveredKWh += dischargeBattery(battery, processCapKWh - deliveredKWh);
        }

        let solarAvailableKWh = generatedKWh - directToChemicalKWh;
        if (solarAvailableKWh > 1e-9 && battery.socKWh < battCapKWh - 1e-9) {
          const storedKWh = chargeBattery(battery, solarAvailableKWh);
          const chargeInputKWh = Math.min(solarAvailableKWh, storedKWh / battery.chargeEff);
          solarAvailableKWh -= chargeInputKWh;
          if (captureSeries) batteryChargeKW[h] = chargeInputKWh / stepHours;
        }

        chemicalKWh += deliveredKWh;
        curtailedKWh += Math.max(0, solarAvailableKWh);
        minSocKWh = Math.min(minSocKWh, battery.socKWh);
        maxSocKWh = Math.max(maxSocKWh, battery.socKWh);
        if (processKW > 1e-9 && (deliveredKWh / stepHours) >= (processKW * MODEL_ASSUMPTIONS.processOperatingThresholdFraction)) {
          activeProcessHours += stepHours;
        }

        if (captureSeries) {
          output[h] = deliveredKWh / stepHours;
          clippedHourlyKW[h] = Math.max(0, solarAvailableKWh / stepHours);
        }
      }

      return {
        output,
        batteryChargeKW,
        clippedHourlyKW,
        chemicalKWh,
        curtailedKWh,
        utilizedCapacityKWh: Math.max(0, maxSocKWh - minSocKWh),
        endSocKWh: battery.socKWh,
        minSocKWh,
        maxSocKWh,
        activeProcessHours,
        chargeThroughputKWh: battery.chargeThroughputKWh,
        dischargeThroughputKWh: battery.dischargeThroughputKWh,
      };
    };

    const simulateProcessCapacity = (processKW, options = {}) => {
      const clampToFullCaptureBounds = options.clampToFullCaptureBounds !== false;
      const minProcessKW = clampToFullCaptureBounds ? averageSolarKW : 0;
      const boundedTargetKW = Number.isFinite(processKW) ? Math.min(processKW, maxSolarKW) : 0;
      const targetKW = Math.max(minProcessKW, Math.max(0, boundedTargetKW));
      const settleTolKWh = Math.max(1e-3, battCapKWh * 1e-6);
      let startBatteryKWh = battCapKWh;
      let settledPreview = null;

      // Starting full yields the least spare headroom; once this converges,
      // the last cycle represents the repeatable battery-supported dispatch.
      for (let i = 0; i < 64; i++) {
        const cycle = simulateCycle(targetKW, startBatteryKWh, false);
        settledPreview = cycle;
        if (Math.abs(cycle.endSocKWh - startBatteryKWh) <= settleTolKWh) {
          startBatteryKWh = cycle.endSocKWh;
          break;
        }
        startBatteryKWh = cycle.endSocKWh;
      }

      const settledCycle = simulateCycle(targetKW, startBatteryKWh, includeSeries);
      return {
        output: settledCycle.output,
        batteryChargeKW: settledCycle.batteryChargeKW,
        clippedHourlyKW: settledCycle.clippedHourlyKW,
        processPowerKW: targetKW,
        chemicalKWh: settledCycle.chemicalKWh,
        curtailedKWh: settledCycle.curtailedKWh,
        capturesAllSolar: settledCycle.curtailedKWh <= Math.max(1e-3, solar.dailyKWh * 1e-6),
        utilizedCapacityKWh: settledCycle.utilizedCapacityKWh,
        startBatteryKWh,
        endBatteryKWh: settledCycle.endSocKWh,
        minBatteryKWh: settledCycle.minSocKWh,
        maxBatteryKWh: settledCycle.maxSocKWh,
        chargeThroughputKWh: settledCycle.chargeThroughputKWh,
        dischargeThroughputKWh: settledCycle.dischargeThroughputKWh,
        activeProcessHours: settledCycle.activeProcessHours,
        settleDeltaKWh: Math.abs(settledCycle.endSocKWh - startBatteryKWh),
        settledPreviewEndBatteryKWh: settledPreview ? settledPreview.endSocKWh : startBatteryKWh,
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

    const fullCapturePlan = bestPlan;
    const actualPlan = chemicalSizingFraction >= (1 - 1e-9)
      ? fullCapturePlan
      : simulateProcessCapacity(fullCapturePlan.processPowerKW * chemicalSizingFraction, {
          clampToFullCaptureBounds: false,
        });

    const hourlyKW = actualPlan.output;
    const processPowerKW = actualPlan.processPowerKW;
    const totalDelivered = actualPlan.chemicalKWh;
    const normalizedProfile = includeSeries && totalDelivered > 0
      ? hourlyKW.map(v => (v * stepHours) / totalDelivered)
      : [];
    const extendedHours = actualPlan.activeProcessHours || 0;
    const effectiveCF = processPowerKW > 0
      ? totalDelivered / (processPowerKW * solar.cycleHours)
      : 0;
    const clippedDailyKWh = actualPlan.curtailedKWh || 0;
    const fullCaptureDailyKWh = fullCapturePlan.chemicalKWh || 0;
    const { capex, lifetimeYears } = getBatteryCapexAndLife(state, solar.cyclesPerYear);
    const annualizedCapex = capex * crf(state.discountRate / 100, lifetimeYears);

    return {
      storage: buildStorageSummary({
        enabled: true,
        capex,
        battCapKWh,
        annualizedCapex,
        lifetimeYears,
        utilizedCapacityKWh: actualPlan.utilizedCapacityKWh,
        startBatteryKWh: actualPlan.startBatteryKWh,
        endBatteryKWh: actualPlan.endBatteryKWh,
        minBatteryKWh: actualPlan.minBatteryKWh,
        maxBatteryKWh: actualPlan.maxBatteryKWh,
        chargeThroughputKWh: actualPlan.chargeThroughputKWh,
        dischargeThroughputKWh: actualPlan.dischargeThroughputKWh,
        settleDeltaKWh: actualPlan.settleDeltaKWh,
      }),
      chemicalSupply: buildChemicalSupply({
        effectiveCF,
        dailyOpHours: extendedHours,
        dailyAvailableKWh: totalDelivered,
        clippedDailyKWh,
        hourlyProfile: normalizedProfile,
        hourlyKW: includeSeries ? hourlyKW : [],
        clippedHourlyKW: includeSeries ? actualPlan.clippedHourlyKW : [],
        batteryChargeHourlyKW: includeSeries ? actualPlan.batteryChargeKW : [],
        processPowerKW,
        fullCapturePowerKW: fullCapturePlan.processPowerKW,
        fullCaptureDailyKWh,
        capturedSolarFraction: fullCaptureDailyKWh > 0 ? totalDelivered / fullCaptureDailyKWh : 1,
        sizingPercent: state.chemicalSizingPercent ?? 100,
        baseloadKW: processPowerKW,
        clipKW: Math.max(0, fullCapturePlan.processPowerKW - processPowerKW),
      }),
    };
  },
};
