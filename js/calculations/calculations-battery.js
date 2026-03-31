/* Battery firming */

Object.assign(Calc, {
  calculateBattery(state, solar) {
    const stepCount = solar.hourlyProfile.length;
    const stepHours = solar.binHours;
    const solarKW = solar.hourlyProfile.map(v => Math.min((v * solar.dailyKWh) / stepHours, solar.peakPowerKW));
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
    if (!batteryEnabled) {
      return {
        enabled: false,
        effectiveCF: directEffectiveCF,
        dailyOpHours: directOpHours.toFixed(1),
        capex: 0,
        battCapKWh: 0,
        dailyAvailableKWh: solar.dailyKWh,
        hourlyProfile: solar.hourlyProfile,
        hourlyKW: solarKW,
        batteryChargeHourlyKW: new Array(stepCount).fill(0),
        processPowerKW: directProcessPeakKW,
        baseloadKW: directProcessPeakKW,
        clipKW: directProcessPeakKW,
        annualizedCapex: 0,
        lifetimeYears: 0,
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
});
