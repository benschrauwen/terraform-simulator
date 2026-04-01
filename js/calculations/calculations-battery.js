/* Battery firming */

Object.assign(Calc, {
  simulateAnnualChemicalDispatch(state, annualSolar, processPowerKW, options = {}) {
    const captureSeries = options.captureSeries !== false;
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
    const targetProcessKW = Math.max(0, Number(processPowerKW) || 0);
    const opThresholdKW = targetProcessKW > 0 ? targetProcessKW * 0.05 : null;

    const runPass = (startSocKWh, includeSeries = captureSeries) => {
      const chemicalHourlyKW = includeSeries ? new Array(hours).fill(0) : [];
      const batteryChargeHourlyKW = includeSeries ? new Array(hours).fill(0) : [];
      const clippedHourlyKW = includeSeries ? new Array(hours).fill(0) : [];
      let socKWh = Math.max(0, Math.min(battCapKWh, startSocKWh));
      let minSocKWh = socKWh;
      let maxSocKWh = socKWh;
      let chemicalKWh = 0;
      let clippedSolarKWh = 0;
      let chemicalPeakKW = 0;
      let chemicalOpHours = 0;
      let chargeThroughputKWh = 0;
      let dischargeThroughputKWh = 0;

      for (let hour = 0; hour < hours; hour++) {
        if (socKWh > 1e-9) {
          socKWh = Math.max(0, socKWh * leakageRetentionPerStep);
        }

        const processCapKWh = targetProcessKW;
        const generatedKWh = Math.max(0, Number(source[hour]) || 0);
        const directToChemicalKWh = Math.min(processCapKWh, generatedKWh);
        let deliveredKWh = directToChemicalKWh;

        if (deliveredKWh + 1e-9 < processCapKWh && socKWh > 1e-9) {
          const dischargeToLoadKWh = Math.min(processCapKWh - deliveredKWh, socKWh * dischargeEff);
          deliveredKWh += dischargeToLoadKWh;
          socKWh -= dischargeToLoadKWh / dischargeEff;
          dischargeThroughputKWh += dischargeToLoadKWh;
        }

        let solarAvailableKWh = generatedKWh - directToChemicalKWh;
        if (solarAvailableKWh > 1e-9 && socKWh < battCapKWh - 1e-9) {
          const storedKWh = Math.min(battCapKWh - socKWh, solarAvailableKWh * chargeEff);
          const chargeInputKWh = Math.min(solarAvailableKWh, storedKWh / chargeEff);
          socKWh += storedKWh;
          solarAvailableKWh -= chargeInputKWh;
          chargeThroughputKWh += storedKWh;
          if (includeSeries) batteryChargeHourlyKW[hour] = chargeInputKWh;
        }

        chemicalKWh += deliveredKWh;
        clippedSolarKWh += Math.max(0, solarAvailableKWh);
        chemicalPeakKW = Math.max(chemicalPeakKW, deliveredKWh);
        minSocKWh = Math.min(minSocKWh, socKWh);
        maxSocKWh = Math.max(maxSocKWh, socKWh);
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
        endSocKWh: socKWh,
        minSocKWh,
        maxSocKWh,
        utilizedCapacityKWh: Math.max(0, maxSocKWh - minSocKWh),
        chargeThroughputKWh,
        dischargeThroughputKWh,
      };
    };

    if (!batteryEnabled) {
      return {
        ...runPass(0),
        settleIterations: 1,
        settleDeltaKWh: 0,
      };
    }

    let startSocKWh = battCapKWh * 0.5;
    let settleIterations = 0;
    const settleTolKWh = Math.max(1e-3, battCapKWh * 1e-6);

    for (; settleIterations < 24; settleIterations++) {
      const preview = runPass(startSocKWh, false);
      const settleDeltaKWh = Math.abs(preview.endSocKWh - startSocKWh);
      startSocKWh = preview.endSocKWh;
      if (settleDeltaKWh <= settleTolKWh) {
        break;
      }
    }

    const captured = runPass(startSocKWh);
    return {
      ...captured,
      settleIterations: settleIterations + 1,
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
      ? solarKW.reduce((sum, value) => sum + (value >= directProcessPeakKW * 0.05 ? stepHours : 0), 0)
      : 0;
    const directEffectiveCF = directProcessPeakKW > 0
      ? solar.dailyKWh / (directProcessPeakKW * solar.cycleHours)
      : 0;
    const batteryEnabled = this.hasBatteryStorage(state);

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
        ? hourlyKW.reduce((sum, value) => sum + (value >= processPowerKW * 0.05 ? stepHours : 0), 0)
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
    const oneWayEff = Math.sqrt(rtEff);
    const chargeEff = Math.max(oneWayEff, 1e-9);
    const dischargeEff = Math.max(oneWayEff, 1e-9);
    const leakageRetentionPerStep = this.getBatteryLeakageRetention(stepHours);
    const maxSolarKW = Math.max(...solarKW, 0);
    const averageSolarKW = solar.cycleHours > 0 ? solar.dailyKWh / solar.cycleHours : 0;

    const simulateCycle = (processKW, startSocKWh, captureSeries = false) => {
      const output = captureSeries ? new Array(stepCount).fill(0) : [];
      const batteryChargeKW = captureSeries ? new Array(stepCount).fill(0) : [];
      const clippedHourlyKW = captureSeries ? new Array(stepCount).fill(0) : [];
      let socKWh = Math.max(0, Math.min(battCapKWh, startSocKWh));
      let minSocKWh = socKWh;
      let maxSocKWh = socKWh;
      let chemicalKWh = 0;
      let curtailedKWh = 0;
      let chargeThroughputKWh = 0;
      let dischargeThroughputKWh = 0;
      let activeProcessHours = 0;

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
          dischargeThroughputKWh += dischargeToLoadKWh;
        }

        let solarAvailableKWh = generatedKWh - directToChemicalKWh;
        if (solarAvailableKWh > 1e-9 && socKWh < battCapKWh - 1e-9) {
          const storedKWh = Math.min(battCapKWh - socKWh, solarAvailableKWh * chargeEff);
          const chargeInputKWh = Math.min(solarAvailableKWh, storedKWh / chargeEff);
          socKWh += storedKWh;
          solarAvailableKWh -= chargeInputKWh;
          chargeThroughputKWh += storedKWh;
          if (captureSeries) batteryChargeKW[h] = chargeInputKWh / stepHours;
        }

        chemicalKWh += deliveredKWh;
        curtailedKWh += Math.max(0, solarAvailableKWh);
        minSocKWh = Math.min(minSocKWh, socKWh);
        maxSocKWh = Math.max(maxSocKWh, socKWh);
        if (processKW > 1e-9 && (deliveredKWh / stepHours) >= (processKW * 0.05)) {
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
        endSocKWh: socKWh,
        minSocKWh,
        maxSocKWh,
        activeProcessHours,
        chargeThroughputKWh,
        dischargeThroughputKWh,
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
    const capex = battCapKWh * state.batteryCostPerKWh;
    const lifetimeYears = Math.max(1, Math.min(MODEL_ASSUMPTIONS.batteryNominalLifeYears, state.batteryCycles / solar.cyclesPerYear));
    const annualizedCapex = capex * this.crf(state.discountRate / 100, lifetimeYears);

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
});
