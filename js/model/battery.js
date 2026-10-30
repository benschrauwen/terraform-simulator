/* ============================================
   Battery storage and chemical-plant dispatch
   ============================================
   Shared battery primitives (parameters, power-limited per-step
   charge/discharge, periodic start-SoC settling, capex/life) used by both
   dispatch models, plus the chemical-plant dispatch over the annual hourly
   solar series: solar first feeds the process, the battery covers
   shortfalls, surplus charges the battery and the rest is clipped. The
   annual dispatch is the single basis for chemical energy, clipping,
   operating hours and process sizing; average-day series are display
   aggregations of it. */

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

/* Battery power rating (kW) at the AC/DC terminal: capacity / duration. */
export function getBatteryPowerKW(state) {
  if (!hasBatteryStorage(state)) return 0;
  const durationHours = clampNumber(state?.batteryDurationHours, 0.25, 24, DEFAULT_STATE.batteryDurationHours);
  return (Math.max(0, state.batteryCapacityMWh || 0) * 1000) / durationHours;
}

/* Mutable battery for the hour-by-hour annual dispatch loops: capacity,
   one-way efficiencies (sqrt of round trip), hourly self-discharge retention,
   per-step power limits (energy drawn while charging, delivered while
   discharging), state of charge and throughput counters. */
export function createAnnualBattery(state, startSocKWh = 0, stepHours = 1) {
  const capacityKWh = hasBatteryStorage(state) ? Math.max(0, (state.batteryCapacityMWh || 0) * 1000) : 0;
  const rtEff = capacityKWh > 0 ? Math.max(0, Math.min(1, (state.batteryEfficiency || 0) / 100)) : 1;
  const oneWayEff = capacityKWh > 0 ? Math.sqrt(Math.max(rtEff, 1e-9)) : 1;
  const maxStepKWh = getBatteryPowerKW(state) * stepHours;
  return {
    capacityKWh,
    chargeEff: oneWayEff,
    dischargeEff: oneWayEff,
    maxChargeInputKWh: maxStepKWh,
    maxDischargeOutputKWh: maxStepKWh,
    leakageRetentionPerStep: getBatteryLeakageRetention(stepHours),
    socKWh: Math.max(0, Math.min(capacityKWh, startSocKWh)),
    chargeThroughputKWh: 0,
    dischargeThroughputKWh: 0,
    leakageKWh: 0,
  };
}

/* Whether a dispatch can ever put energy into the battery: storage that
   holds nothing (0% efficiency) or a year without solar settles at empty. */
export function batteryReceivesEnergy(state, annualSolar, solarScale = 1) {
  const totalKWh = Number.isFinite(annualSolar?.totalKWh)
    ? annualSolar.totalKWh
    : sumSeries(annualSolar?.hourlyKW || []);
  return hasBatteryStorage(state) && (state.batteryEfficiency || 0) > 0 && solarScale > 0 && totalKWh > 0;
}

export function applyBatteryLeakage(battery) {
  if (battery.socKWh > 1e-9) {
    const retainedKWh = Math.max(0, battery.socKWh * battery.leakageRetentionPerStep);
    battery.leakageKWh += battery.socKWh - retainedKWh;
    battery.socKWh = retainedKWh;
  }
}

/* Discharges up to `shortfallKWh` to a load within the power limit; returns
   the energy delivered. */
export function dischargeBattery(battery, shortfallKWh) {
  const deliveredKWh = Math.max(0, Math.min(
    shortfallKWh,
    battery.socKWh * battery.dischargeEff,
    battery.maxDischargeOutputKWh
  ));
  battery.socKWh = Math.max(0, battery.socKWh - (deliveredKWh / battery.dischargeEff));
  battery.dischargeThroughputKWh += deliveredKWh;
  return deliveredKWh;
}

/* Charges from `surplusKWh` of input energy within the power limit; returns
   the energy stored (after charge losses). The input drawn is
   stored / chargeEff. */
export function chargeBattery(battery, surplusKWh) {
  const inputKWh = Math.min(surplusKWh, battery.maxChargeInputKWh);
  const storedKWh = Math.max(0, Math.min(battery.capacityKWh - battery.socKWh, inputKWh * battery.chargeEff));
  battery.socKWh += storedKWh;
  battery.chargeThroughputKWh += storedKWh;
  return storedKWh;
}

/* Re-runs an annual dispatch preview from its own end SoC until the year is
   periodic (end SoC == start SoC within tolerance). `runPreview(startSocKWh)`
   must return `{ endSocKWh }`. With no storage, or no energy ever reaching
   the battery, the periodic state is empty: start there instead of
   discharging a phantom initial charge. */
export function settleAnnualStartSoc(capacityKWh, runPreview, { hasInput = true } = {}) {
  if (!(capacityKWh > 0) || !hasInput) return { startSocKWh: 0, settleIterations: 0 };
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

function sumSeries(series) {
  let total = 0;
  for (let i = 0; i < series.length; i++) total += Number(series[i]) || 0;
  return total;
}

export const batteryMethods = {
  getChemicalSizingFraction(state) {
    return clampNumber(state?.chemicalSizingPercent, 0, 100, DEFAULT_STATE.chemicalSizingPercent) / 100;
  },

  getBatteryLeakageRetention,
  getBatteryPowerKW,

  /* One pass of the chemical dispatch from `startSocKWh`. `solarScale`
     multiplies the solar series (PV degradation) without copying it. */
  simulateChemicalDispatchPass(state, annualSolar, processPowerKW, startSocKWh, options = {}) {
    const captureSeries = Boolean(options.captureSeries);
    const captureDailySummaries = captureSeries || Boolean(options.captureDailySummaries);
    const solarScale = Number.isFinite(options.solarScale) ? Math.max(0, options.solarScale) : 1;
    const source = Array.isArray(annualSolar?.hourlyKW) ? annualSolar.hourlyKW : [];
    const hours = source.length;
    const summaryWindowHours = Math.max(1e-6, annualSolar?.windowHours || 24);
    const summaryBinCount = Math.max(1, Math.round(annualSolar?.windowBinCount || 24));
    const summaryWindowCount = captureDailySummaries ? Math.max(1, Math.ceil((hours / summaryWindowHours) - 1e-9)) : 0;
    const targetProcessKW = Math.max(0, Number(processPowerKW) || 0);
    const opThresholdKW = targetProcessKW * MODEL_ASSUMPTIONS.processOperatingThresholdFraction;
    const battery = createAnnualBattery(state, startSocKWh);
    const battCapKWh = battery.capacityKWh;
    const chemicalHourlyKW = captureSeries ? new Array(hours).fill(0) : [];
    const batteryChargeHourlyKW = captureSeries ? new Array(hours).fill(0) : [];
    const clippedHourlyKW = captureSeries ? new Array(hours).fill(0) : [];
    const dailyChemicalSummaryKWh = captureDailySummaries && !captureSeries ? new Array(summaryWindowCount).fill(0) : [];
    let minSocKWh = battery.socKWh;
    let maxSocKWh = battery.socKWh;
    let solarKWh = 0;
    let directKWh = 0;
    let chargeInputTotalKWh = 0;
    let chemicalKWh = 0;
    let clippedSolarKWh = 0;
    let chemicalPeakKW = 0;
    let chemicalOpHours = 0;

    for (let hour = 0; hour < hours; hour++) {
      applyBatteryLeakage(battery);

      const generatedKWh = Math.max(0, Number(source[hour]) || 0) * solarScale;
      const directToChemicalKWh = Math.min(targetProcessKW, generatedKWh);
      let deliveredKWh = directToChemicalKWh;

      if (battCapKWh > 0 && deliveredKWh + 1e-9 < targetProcessKW && battery.socKWh > 1e-9) {
        deliveredKWh += dischargeBattery(battery, targetProcessKW - deliveredKWh);
      }

      let surplusKWh = generatedKWh - directToChemicalKWh;
      let chargeInputKWh = 0;
      if (battCapKWh > 0 && surplusKWh > 1e-9 && battery.socKWh < battCapKWh - 1e-9) {
        chargeInputKWh = Math.min(surplusKWh, chargeBattery(battery, surplusKWh) / battery.chargeEff);
        surplusKWh -= chargeInputKWh;
      }
      const clippedKWh = Math.max(0, surplusKWh);

      solarKWh += generatedKWh;
      directKWh += directToChemicalKWh;
      chargeInputTotalKWh += chargeInputKWh;
      chemicalKWh += deliveredKWh;
      clippedSolarKWh += clippedKWh;
      if (deliveredKWh > chemicalPeakKW) chemicalPeakKW = deliveredKWh;
      if (battery.socKWh < minSocKWh) minSocKWh = battery.socKWh;
      if (battery.socKWh > maxSocKWh) maxSocKWh = battery.socKWh;
      if (targetProcessKW > 0 && deliveredKWh >= opThresholdKW - 1e-6) chemicalOpHours += 1;

      if (captureSeries) {
        chemicalHourlyKW[hour] = deliveredKWh;
        batteryChargeHourlyKW[hour] = chargeInputKWh;
        clippedHourlyKW[hour] = clippedKWh;
      } else if (captureDailySummaries) {
        this.accumulateSeriesStepBySpanHours(dailyChemicalSummaryKWh, summaryWindowHours, hour, deliveredKWh);
      }
    }

    const dailyChemicalKWh = captureSeries
      ? this.aggregateSeriesBySpanHours(chemicalHourlyKW, summaryWindowHours)
      : dailyChemicalSummaryKWh;
    return {
      hours,
      loadKW: 0,
      solarKWh,
      directToChemicalKWh: directKWh,
      chargeInputKWh: chargeInputTotalKWh,
      chemicalHourlyKW,
      clippedHourlyKW,
      batteryChargeHourlyKW,
      chemicalKWh,
      clippedSolarKWh,
      dailyChemicalKWh,
      dailyClippedKWh: captureSeries ? this.aggregateSeriesBySpanHours(clippedHourlyKW, summaryWindowHours) : [],
      dailyBatteryChargeKWh: captureSeries ? this.aggregateSeriesBySpanHours(batteryChargeHourlyKW, summaryWindowHours) : [],
      dailyAiKWh: dailyChemicalKWh.map(() => 0),
      averageDayChemicalKW: captureSeries ? this.averageSeriesByCyclePhase(chemicalHourlyKW, summaryWindowHours, summaryBinCount) : [],
      averageDayClippedKW: captureSeries ? this.averageSeriesByCyclePhase(clippedHourlyKW, summaryWindowHours, summaryBinCount) : [],
      averageDayBatteryChargeKW: captureSeries ? this.averageSeriesByCyclePhase(batteryChargeHourlyKW, summaryWindowHours, summaryBinCount) : [],
      averageDayAiKW: captureSeries ? new Array(summaryBinCount).fill(0) : [],
      aiHourlyKW: captureSeries ? new Array(hours).fill(0) : [],
      aiServedKWh: 0,
      aiShortfallKWh: 0,
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
      leakageKWh: battery.leakageKWh,
    };
  },

  /* Periodic-year chemical dispatch at a fixed process capacity. */
  simulateAnnualChemicalDispatch(state, annualSolar, processPowerKW, options = {}) {
    const captureSeries = options.captureSeries !== false;
    const solarScale = Number.isFinite(options.solarScale) ? options.solarScale : 1;
    const capacityKWh = createAnnualBattery(state).capacityKWh;
    const { startSocKWh, settleIterations } = settleAnnualStartSoc(
      capacityKWh,
      start => this.simulateChemicalDispatchPass(state, annualSolar, processPowerKW, start, { solarScale }),
      { hasInput: batteryReceivesEnergy(state, annualSolar, solarScale) }
    );
    const captured = this.simulateChemicalDispatchPass(state, annualSolar, processPowerKW, startSocKWh, {
      captureSeries,
      captureDailySummaries: options.captureDailySummaries,
      solarScale,
    });
    return {
      ...captured,
      settleIterations,
      settleDeltaKWh: Math.abs(captured.endSocKWh - captured.startSocKWh),
    };
  },

  /* 100% chemical sizing: the smallest constant process capacity that clips
     no solar over the periodic annual dispatch with this battery. Without
     storage that is the annual solar peak; with storage, bisection (clipping
     is non-increasing in capacity) to 1e-4 of the peak. */
  findFullCaptureProcessKW(state, annualSolar) {
    const source = Array.isArray(annualSolar?.hourlyKW) ? annualSolar.hourlyKW : [];
    let peakKW = 0;
    for (let i = 0; i < source.length; i++) if (source[i] > peakKW) peakKW = source[i];
    if (peakKW <= 0 || !hasBatteryStorage(state)) {
      return { processPowerKW: peakKW, dispatch: null };
    }

    const totalKWh = annualSolar.totalKWh ?? sumSeries(source);
    const clipToleranceKWh = Math.max(1e-3, totalKWh * 1e-6);
    const dispatchAt = processKW => this.simulateAnnualChemicalDispatch(state, annualSolar, processKW, {
      captureSeries: false,
    });
    let lo = 0;
    let hi = peakKW;
    let best = null;
    while ((hi - lo) > peakKW * 1e-4) {
      const mid = (lo + hi) / 2;
      const dispatch = dispatchAt(mid);
      if (dispatch.clippedSolarKWh <= clipToleranceKWh) {
        hi = mid;
        best = dispatch;
      } else {
        lo = mid;
      }
    }
    return { processPowerKW: hi, dispatch: best || dispatchAt(hi) };
  },

  /* Chemical-only plant on the annual dispatch basis (Earth year; Mars
     orbital year, annualized). Returns { storage, chemicalSupply, dispatch,
     lifetimeEnergy }. */
  calculateBattery(state, solar, annualSolar, options = {}) {
    const includeSeries = options.includeSeries !== false;
    const cyclesPerYear = this.getBodyConfig(state.body || 'earth').cyclesPerEarthYear;
    const dispatchBasis = options.dispatchBasis || this.getAnnualDispatchBasis(state, solar, annualSolar, {
      includeWindowSummaries: includeSeries,
    });
    const dispatchSolar = dispatchBasis.solar;
    const annualizationFactor = dispatchBasis.annualizationFactor;
    const chemicalSizingFraction = this.getChemicalSizingFraction(state);
    const fullCapture = this.findFullCaptureProcessKW(state, dispatchSolar);
    const processPowerKW = fullCapture.processPowerKW * chemicalSizingFraction;
    const finalDispatch = this.simulateAnnualChemicalDispatch(state, dispatchSolar, processPowerKW, {
      captureSeries: includeSeries,
      captureDailySummaries: true,
    });
    const fullCaptureChemicalKWh = fullCapture.dispatch
      ? fullCapture.dispatch.chemicalKWh
      : (dispatchSolar.totalKWh ?? sumSeries(dispatchSolar.hourlyKW || []));
    const dispatch = {
      ...finalDispatch,
      fullCaptureChemicalKW: fullCapture.processPowerKW,
      fullCaptureChemicalKWh,
      chemicalSizingPercent: state.chemicalSizingPercent ?? DEFAULT_STATE.chemicalSizingPercent,
    };
    const { capex, lifetimeYears } = getBatteryCapexAndLife(state, cyclesPerYear);
    const lifetimeEnergy = this.buildLifetimeEnergyProfile(state, {
      year1: { aiServedKWh: 0, chemicalKWh: dispatch.chemicalKWh, clippedKWh: dispatch.clippedSolarKWh, reliability: 1 },
      annualizationFactor,
      solarKWh: dispatchSolar.totalKWh ?? sumSeries(dispatchSolar.hourlyKW || []),
      evaluate: solarScale => {
        const degraded = this.simulateAnnualChemicalDispatch(state, dispatchSolar, processPowerKW, {
          captureSeries: false,
          solarScale,
        });
        return { aiServedKWh: 0, chemicalKWh: degraded.chemicalKWh, clippedKWh: degraded.clippedSolarKWh, reliability: 1 };
      },
    });

    return {
      storage: this.buildAnnualStorageSummary(state, dispatch, capex, lifetimeYears),
      chemicalSupply: this.buildAnnualChemicalSupplySummary(dispatch, solar, cyclesPerYear, annualizationFactor, {
        includeSeries,
      }),
      dispatch: this.attachAnnualDispatchDisplaySeries(state, dispatchSolar, dispatch, dispatchBasis.horizonLabel, {
        includeDisplaySeries: includeSeries,
        includeSolarSummary: includeSeries,
      }),
      lifetimeEnergy,
    };
  },
};
