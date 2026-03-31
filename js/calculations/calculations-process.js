/* Electrolyzer, DAC, products */

Object.assign(Calc, {
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
});
