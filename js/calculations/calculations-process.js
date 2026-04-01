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

  getSupportedProductWeights(state) {
    const mix = this.getProductMix(state);
    if (mix.methaneShare === 0 && mix.methanolShare === 0) {
      return {
        mix,
        label: 'default methane case',
        sabatier: 100,
        methanol: 0,
      };
    }

    return {
      mix,
      label: mix.bothEnabled
        ? 'configured product mix'
        : mix.methaneShare > 0
          ? 'methane'
          : 'methanol',
      sabatier: mix.methaneShare * 100,
      methanol: mix.methanolShare * 100,
    };
  },

  getExploratoryRouteConfig(moduleId, route) {
    const library = EXPLORATORY_ROUTE_LIBRARY[moduleId]?.routes || {};
    if (library[route]) return library[route];
    const fallbackRoute = Object.keys(library)[0];
    return fallbackRoute ? library[fallbackRoute] : null;
  },

  getExploratoryCapexControlConfig(moduleId, route) {
    const routeConfig = this.getExploratoryRouteConfig(moduleId, route);
    const defaultValue = routeConfig?.capexPerAnnualUnit || 0;
    const unitLabel = routeConfig?.capexUnit === 'm3pd' ? '$/m3/day' : '$/tpa';
    const step = defaultValue >= 5000 ? 100 : defaultValue >= 1000 ? 50 : defaultValue >= 250 ? 10 : 5;
    const min = Math.max(step, Math.floor((defaultValue * 0.25) / step) * step);
    const max = Math.max(min + step, Math.ceil((defaultValue * 4) / step) * step);
    return {
      min,
      max,
      step,
      defaultValue,
      unitLabel,
    };
  },

  getExploratoryPriorityWeight(state, moduleId) {
    return this.clampNumber(
      state?.[`${moduleId}PriorityWeight`],
      0,
      100,
      DEFAULT_STATE?.[`${moduleId}PriorityWeight`] ?? 100
    );
  },

  buildWeightedShareMap(entries = []) {
    const totalWeight = entries.reduce((sum, entry) => sum + Math.max(0, entry.weight || 0), 0);
    if (totalWeight <= 0) return {};

    return entries.reduce((shares, entry) => {
      shares[entry.id] = Math.max(0, entry.weight || 0) / totalWeight;
      return shares;
    }, {});
  },

  buildProcessAllocationPlan(state) {
    const supported = this.getSupportedProductWeights(state);
    const mtgMethanolSplit = state.mtgEnabled
      ? this.clampNumber(state.mtgMethanolSplit, 0, 100, DEFAULT_STATE.mtgMethanolSplit) / 100
      : 0;

    const exploratoryModules = MODULE_REGISTRY
      .filter(module => module.maturity === 'Exploratory')
      .map(module => {
        const enabled = Boolean(state[`${module.id}Enabled`]);
        const route = state[`${module.id}Route`] || module.routeOptions[0]?.value || 'unspecified';
        const routeConfig = this.getExploratoryRouteConfig(module.id, route);
        const priorityWeight = this.getExploratoryPriorityWeight(state, module.id);
        const effectivePriorityWeight = enabled
          ? module.id === 'mtg'
            ? priorityWeight * mtgMethanolSplit
            : priorityWeight
          : 0;

        return {
          ...module,
          enabled,
          route,
          routeConfig,
          priorityWeight,
          effectivePriorityWeight,
        };
      });

    const h2Consumers = [];
    const co2Consumers = [];
    const exploratoryPowerDemandProxies = {};
    const exploratoryPowerWeightEntries = [];

    if (supported.sabatier > 0 && state.sabatierEnabled) {
      h2Consumers.push({
        id: 'sabatier',
        weight: supported.sabatier,
        inputKgPerUnit: CHEMISTRY.sabatier.h2MassPerKgCH4 * 1000,
      });
      co2Consumers.push({
        id: 'sabatier',
        weight: supported.sabatier,
        inputKgPerUnit: CHEMISTRY.sabatier.co2MassPerKgCH4 * 1000,
      });
    }
    if (supported.methanol > 0 && state.methanolEnabled) {
      h2Consumers.push({
        id: 'methanol',
        weight: supported.methanol,
        inputKgPerUnit: CHEMISTRY.methanol.h2MassPerKgMeOH * 1000,
      });
      co2Consumers.push({
        id: 'methanol',
        weight: supported.methanol,
        inputKgPerUnit: CHEMISTRY.methanol.co2MassPerKgMeOH * 1000,
      });
    }

    exploratoryModules.forEach(module => {
      const routeConfig = module.routeConfig;
      if (!module.enabled || !routeConfig) {
        exploratoryPowerDemandProxies[module.id] = 0;
        return;
      }

      const h2KgPerUnit = routeConfig.feedstocks?.h2Kg || 0;
      const co2KgPerUnit = routeConfig.feedstocks?.co2Kg || 0;
      if (h2KgPerUnit > 0) {
        h2Consumers.push({
          id: module.id,
          weight: module.effectivePriorityWeight,
          inputKgPerUnit: h2KgPerUnit,
        });
      }
      if (co2KgPerUnit > 0) {
        co2Consumers.push({
          id: module.id,
          weight: module.effectivePriorityWeight,
          inputKgPerUnit: co2KgPerUnit,
        });
      }

      exploratoryPowerDemandProxies[module.id] = module.effectivePriorityWeight * (routeConfig.electricityKwhPerUnit || 0);
      exploratoryPowerWeightEntries.push({
        id: module.id,
        weight: module.effectivePriorityWeight,
      });
    });

    const h2PowerDemand = h2Consumers.reduce(
      (sum, consumer) => sum + consumer.weight * consumer.inputKgPerUnit * state.electrolyzerEfficiency,
      0
    );
    const co2PowerDemand = co2Consumers.reduce(
      (sum, consumer) => sum + consumer.weight * consumer.inputKgPerUnit * (state.dacEnergy / 1000),
      0
    );
    const exploratoryPowerDemand = Object.values(exploratoryPowerDemandProxies).reduce((sum, value) => sum + value, 0);
    const totalPowerDemand = h2PowerDemand + co2PowerDemand + exploratoryPowerDemand;
    const exploratoryPoolShare = totalPowerDemand > 0 ? exploratoryPowerDemand / totalPowerDemand : 0;
    const exploratoryWithinPoolShares = this.buildWeightedShareMap(exploratoryPowerWeightEntries);
    const exploratoryPowerShares = exploratoryModules.reduce((shares, module) => {
      shares[module.id] = exploratoryPoolShare * (exploratoryWithinPoolShares[module.id] || 0);
      return shares;
    }, {});

    return {
      label: exploratoryPowerDemand > 0 ? `${supported.label} + exploratory demand` : supported.label,
      supported,
      exploratoryModules,
      feedShares: {
        h2: this.buildWeightedShareMap(h2Consumers),
        co2: this.buildWeightedShareMap(co2Consumers),
        methanol: this.buildWeightedShareMap([
          ...(state.methanolEnabled ? [{ id: 'methanolExport', weight: Math.max(0, 1 - mtgMethanolSplit) }] : []),
          ...(state.mtgEnabled ? [{ id: 'mtg', weight: Math.max(0, mtgMethanolSplit) }] : []),
        ]),
      },
      powerProxy: {
        electrolyzer: h2PowerDemand,
        dac: co2PowerDemand,
        exploratoryTotal: exploratoryPowerDemand,
        total: totalPowerDemand,
      },
      powerShares: {
        electrolyzer: totalPowerDemand > 0 ? h2PowerDemand / totalPowerDemand : 0.5,
        dac: totalPowerDemand > 0 ? co2PowerDemand / totalPowerDemand : 0.5,
        exploratory: exploratoryPowerShares,
      },
    };
  },

  getDownstreamDemand(state) {
    const allocationPlan = this.buildProcessAllocationPlan(state);
    return {
      mix: allocationPlan.supported.mix,
      label: allocationPlan.label,
      h2PowerDemand: allocationPlan.powerProxy.electrolyzer,
      co2PowerDemand: allocationPlan.powerProxy.dac,
      exploratoryPowerDemand: allocationPlan.powerProxy.exploratoryTotal,
    };
  },

  getBalancedAllocation(state) {
    const allocationPlan = this.buildProcessAllocationPlan(state);
    return {
      source: 'auto',
      label: allocationPlan.label,
      electrolyzer: allocationPlan.powerShares.electrolyzer,
      dac: allocationPlan.powerShares.dac,
      exploratory: allocationPlan.powerShares.exploratory,
      feedShares: allocationPlan.feedShares,
      supported: allocationPlan.supported,
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
        designHourlyOutputKg: 0,
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
    const designHourlyOutputKg = designGrossCh4KgPerHour * conv;
    const designHourlyRate = designHourlyOutputKg / c.ch4PerMCF;
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
      designHourlyOutputKg,
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
        grossDailyKg: 0,
        annualKg: 0,
        grossAnnualKg: 0,
        annualTons: 0,
        grossAnnualTons: 0,
        dailyLiters: 0,
        grossDailyLiters: 0,
        exportDailyKg: 0,
        exportAnnualKg: 0,
        exportAnnualTons: 0,
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
    const annualKg = dailyKg * body.cyclesPerEarthYear;
    return {
      id: 'methanol',
      enabled: true,
      modeled: true,
      title: 'Methanol',
      family: 'air-water-chemistry',
      maturity: 'Supported',
      dailyKg,
      grossDailyKg: dailyKg,
      annualKg,
      grossAnnualKg: annualKg,
      annualTons: annualKg / 1000,
      grossAnnualTons: annualKg / 1000,
      dailyLiters: dailyKg / c.density,
      grossDailyLiters: dailyKg / c.density,
      exportDailyKg: dailyKg,
      exportAnnualKg: annualKg,
      exportAnnualTons: annualKg / 1000,
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

  calculateSupportedProducts(state, materialFlows, opHours, allocationPlan, options = {}) {
    const includeSupportedModules = options.includeSupportedModules !== false;
    const h2Shares = allocationPlan?.feedShares?.h2 || {};
    const co2Shares = allocationPlan?.feedShares?.co2 || {};

    const sabatier = this.calculateSabatier(
      state,
      (materialFlows.h2DailyKg || 0) * (h2Shares.sabatier || 0),
      (materialFlows.co2DailyKg || 0) * (co2Shares.sabatier || 0),
      opHours,
      (materialFlows.h2SizingPeakKgPerHour || 0) * (h2Shares.sabatier || 0),
      (materialFlows.co2SizingPeakKgPerHour || 0) * (co2Shares.sabatier || 0)
    );

    const methanol = this.calculateMethanol(
      state,
      (materialFlows.h2DailyKg || 0) * (h2Shares.methanol || 0),
      (materialFlows.co2DailyKg || 0) * (co2Shares.methanol || 0),
      opHours,
      (materialFlows.h2SizingPeakKgPerHour || 0) * (h2Shares.methanol || 0),
      (materialFlows.co2SizingPeakKgPerHour || 0) * (co2Shares.methanol || 0)
    );

    return {
      supportedModules: includeSupportedModules ? [sabatier, methanol] : [],
      outputs: { sabatier, methanol },
      h2Remaining: Math.max(0, (materialFlows.h2DailyKg || 0) - (sabatier.h2Consumed || 0) - (methanol.h2Consumed || 0)),
      co2Remaining: Math.max(0, (materialFlows.co2DailyKg || 0) - (sabatier.co2Consumed || 0) - (methanol.co2Consumed || 0)),
    };
  },

  calculateExploratoryOutputUnits(routeConfig, dailyKWh, allocations = {}) {
    if (!routeConfig || !Number.isFinite(dailyKWh) || dailyKWh <= 0) return 0;

    const limits = [];
    if (routeConfig.electricityKwhPerUnit > 0) {
      limits.push(dailyKWh / routeConfig.electricityKwhPerUnit);
    }

    const feedstocks = routeConfig.feedstocks || {};
    if (feedstocks.h2Kg > 0) limits.push((allocations.h2Kg || 0) / feedstocks.h2Kg);
    if (feedstocks.co2Kg > 0) limits.push((allocations.co2Kg || 0) / feedstocks.co2Kg);
    if (feedstocks.methanolKg > 0) limits.push((allocations.methanolKg || 0) / feedstocks.methanolKg);

    if (!limits.length) return 0;
    return Math.max(0, Math.min(...limits.filter(Number.isFinite)));
  },

  calculateExploratoryCapex(routeConfig, capexBasis, outputDailyUnits, annualOutputUnits, realizedCapacityFactor) {
    if (!routeConfig || outputDailyUnits <= 0 || annualOutputUnits <= 0) return 0;
    const effectiveCf = Math.max(0.05, Math.min(1, realizedCapacityFactor || 0));
    const cyclingPenalty = routeConfig.cyclingPenalty || 1;
    const baseCapex = Number.isFinite(capexBasis) ? capexBasis : (routeConfig.capexPerAnnualUnit || 0);

    if (routeConfig.capexUnit === 'm3pd') {
      const nameplateUnitsPerDay = outputDailyUnits / effectiveCf;
      return nameplateUnitsPerDay * baseCapex * cyclingPenalty;
    }

    const nameplateAnnualUnits = annualOutputUnits / effectiveCf;
    return nameplateAnnualUnits * baseCapex * cyclingPenalty;
  },

  calculateExploratoryModules(state, context = {}) {
    const {
      allocationPlan,
      materialFlows = {},
      supportedOutputs = {},
      effectivePeakKW = 0,
      effectiveDailyKWh = 0,
      peakDailyKWh = 0,
      opHours = 0,
    } = context;
    const body = this.getBodyConfig(state.body || 'earth');
    const cyclesPerYear = body.cyclesPerEarthYear;
    const cycleHours = body.cycleHours;
    const h2Shares = allocationPlan?.feedShares?.h2 || {};
    const co2Shares = allocationPlan?.feedShares?.co2 || {};
    const methanolShares = allocationPlan?.feedShares?.methanol || {};
    const grossMethanolDailyKg = supportedOutputs?.methanol?.grossDailyKg || supportedOutputs?.methanol?.dailyKg || 0;
    const peakDayScale = effectiveDailyKWh > 0 && peakDailyKWh > 0
      ? Math.max(1, peakDailyKWh / effectiveDailyKWh)
      : 1;

    return MODULE_REGISTRY
      .filter(module => module.maturity === 'Exploratory')
      .map(module => {
        const enabled = Boolean(state[`${module.id}Enabled`]);
        const route = state[`${module.id}Route`] || module.routeOptions[0]?.value || 'unspecified';
        const routeConfig = this.getExploratoryRouteConfig(module.id, route);
        const capexBasis = Number(state[`${module.id}CapexBasis`]);
        const omPercent = Number(state.exploratoryOmPercent);
        const powerShare = allocationPlan?.powerShares?.exploratory?.[module.id] || 0;
        const allocKW = effectivePeakKW * powerShare;
        const dailyKWh = effectiveDailyKWh * powerShare;
        const realizedCapacityFactor = allocKW > 0 && cycleHours > 0
          ? Math.max(0, Math.min(1, dailyKWh / (allocKW * cycleHours)))
          : 0;
        const allocations = {
          h2Kg: (materialFlows.h2DailyKg || 0) * (h2Shares[module.id] || 0),
          co2Kg: (materialFlows.co2DailyKg || 0) * (co2Shares[module.id] || 0),
          methanolKg: module.id === 'mtg' ? grossMethanolDailyKg * (methanolShares.mtg || 0) : 0,
        };
        const outputDailyUnits = enabled
          ? this.calculateExploratoryOutputUnits(routeConfig, dailyKWh, allocations)
          : 0;
        const peakOutputDailyUnits = outputDailyUnits * peakDayScale;
        const annualOutputUnits = outputDailyUnits * cyclesPerYear;
        const h2Consumed = outputDailyUnits * (routeConfig?.feedstocks?.h2Kg || 0);
        const co2Consumed = outputDailyUnits * (routeConfig?.feedstocks?.co2Kg || 0);
        const methanolConsumed = outputDailyUnits * (routeConfig?.feedstocks?.methanolKg || 0);

        return {
          ...module,
          enabled,
          route,
          routeLabel: module.routeOptions.find(option => option.value === route)?.label || route,
          routeConfig,
          modeled: enabled,
          excludedFromEconomics: false,
          allocKW,
          dailyKWh,
          realizedCapacityFactor,
          outputDailyUnits,
          peakOutputDailyUnits,
          annualOutputUnits,
          outputLabel: routeConfig?.outputLabel || module.label,
          outputUnit: routeConfig?.outputUnit || 't',
          capex: this.calculateExploratoryCapex(routeConfig, capexBasis, outputDailyUnits, annualOutputUnits, realizedCapacityFactor),
          capexBasisUnit: routeConfig?.capexUnit || 'tpa',
          capexBasis: Number.isFinite(capexBasis) ? capexBasis : (routeConfig?.capexPerAnnualUnit || 0),
          omPercent: Number.isFinite(omPercent) ? omPercent : 4,
          feedstockSummary: routeConfig?.feedstockSummary || 'Needs power',
          h2Consumed,
          co2Consumed,
          methanolConsumed,
          diagramInputs: {
            electricity: true,
            ...(routeConfig?.diagramInputs || module.diagramInputs || {}),
          },
        };
      });
  },
});
