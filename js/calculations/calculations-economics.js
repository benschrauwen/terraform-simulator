/* Economics, policy, environment, orchestration */

Object.assign(Calc, {
  getMethaneSalePrice(state) {
    return state.methanePrice;
  },

  getPolicyCredits(state, context) {
    return PolicyModel.evaluate(state, context);
  },

  buildFinancingModel(state, totalCapex) {
    const enabled = Boolean(state.financingEnabled);
    const debtSharePercent = enabled ? Math.max(0, Math.min(90, state.debtSharePercent || 0)) : 0;
    const debtInterestRate = enabled ? Math.max(0, state.debtInterestRate || 0) : 0;
    const debtTermYears = enabled
      ? Math.max(1, Math.min(Math.round(state.analysisHorizonYears || 1), Math.round(state.debtTermYears || 1)))
      : 0;
    const upfrontFeePercent = enabled ? Math.max(0, state.debtFeePercent || 0) : 0;
    const debtAmount = totalCapex * (debtSharePercent / 100);
    const equityCapex = Math.max(0, totalCapex - debtAmount);
    const upfrontFee = debtAmount * (upfrontFeePercent / 100);
    const debtSchedule = this.buildDebtSchedule(
      debtAmount,
      debtInterestRate / 100,
      debtTermYears,
      state.analysisHorizonYears
    );

    return {
      enabled,
      debtSharePercent,
      debtInterestRate,
      debtTermYears,
      upfrontFeePercent,
      debtAmount,
      equityCapex,
      upfrontFee,
      equityUpfront: equityCapex + upfrontFee,
      annualDebtService: debtSchedule.annualDebtService,
      totalInterest: debtSchedule.totalInterest,
      totalPrincipal: debtSchedule.totalPrincipal,
      totalDebtService: debtSchedule.totalDebtService,
      byYear: debtSchedule.byYear,
      schedule: debtSchedule.schedule,
    };
  },

  buildCashFlowTimeline(totalCapex, financing, yearlyCashFlows, policy = {}) {
    const financed = Boolean(financing?.enabled);
    const safeTotalCapex = Math.max(0, Number(totalCapex) || 0);
    const safeUpfrontPolicySupport = Math.max(0, Number(policy?.upfrontSupport) || 0);
    const safeNetCapexAtClose = Math.max(0, safeTotalCapex - safeUpfrontPolicySupport);
    const safeEquityUpfront = financed
      ? Math.max(0, Number(financing?.equityUpfront) || 0)
      : safeNetCapexAtClose;
    const safeDebtAmount = financed
      ? Math.max(0, Number(financing?.debtAmount) || 0)
      : 0;
    const labels = ['Close'];
    const annualRevenue = [safeUpfrontPolicySupport];
    const annualMarketRevenue = [0];
    const annualPolicyCredits = [safeUpfrontPolicySupport];
    const annualOperatingCost = [0];
    const replacementCapex = [0];
    const annualDebtService = [0];
    const projectCashFlow = [-safeNetCapexAtClose];
    const equityCashFlow = [-safeEquityUpfront];
    const cumulativeProjectCash = [-safeNetCapexAtClose];
    const cumulativeEquityCash = [-safeEquityUpfront];
    const sponsorSupportNeeded = [0];
    const debtStartingBalance = [safeDebtAmount];
    const debtEndingBalance = [safeDebtAmount];

    (Array.isArray(yearlyCashFlows) ? yearlyCashFlows : []).forEach(entry => {
      const revenue = Number.isFinite(entry?.totalRevenue) ? entry.totalRevenue : 0;
      const policyCredits = Number.isFinite(entry?.revenue?.policyCredits) ? entry.revenue.policyCredits : 0;
      const marketRevenue = revenue - policyCredits;
      const operatingCash = Number.isFinite(entry?.operatingCashFlow) ? entry.operatingCashFlow : 0;
      const operatingCost = Math.max(0, revenue - operatingCash);
      const replacements = Math.max(0, Number(entry?.replacementOutflow) || 0);
      const debtService = financed ? Math.max(0, Number(entry?.debtService) || 0) : 0;
      const projectCash = Number.isFinite(entry?.netCashFlow) ? entry.netCashFlow : 0;
      const equityCash = financed
        ? (Number.isFinite(entry?.equityCashFlow) ? entry.equityCashFlow : projectCash)
        : projectCash;
      const cumulativeProject = Number.isFinite(entry?.cumulativeNetCash)
        ? entry.cumulativeNetCash
        : (cumulativeProjectCash[cumulativeProjectCash.length - 1] + projectCash);
      const cumulativeEquity = financed
        ? (Number.isFinite(entry?.cumulativeEquityCash)
            ? entry.cumulativeEquityCash
            : (cumulativeEquityCash[cumulativeEquityCash.length - 1] + equityCash))
        : cumulativeProject;

      labels.push(`Year ${entry?.year ?? labels.length}`);
      annualRevenue.push(revenue);
      annualMarketRevenue.push(marketRevenue);
      annualPolicyCredits.push(policyCredits);
      annualOperatingCost.push(operatingCost);
      replacementCapex.push(replacements);
      annualDebtService.push(debtService);
      projectCashFlow.push(projectCash);
      equityCashFlow.push(equityCash);
      cumulativeProjectCash.push(cumulativeProject);
      cumulativeEquityCash.push(cumulativeEquity);
      sponsorSupportNeeded.push(financed ? Math.max(0, Number(entry?.sponsorSupportNeeded) || 0) : 0);
      debtStartingBalance.push(financed ? Math.max(0, Number(entry?.debtStartingBalance) || 0) : 0);
      debtEndingBalance.push(financed ? Math.max(0, Number(entry?.debtEndingBalance) || 0) : 0);
    });

    return {
      labels,
      annualRevenue,
      annualMarketRevenue,
      annualPolicyCredits,
      annualOperatingCost,
      replacementCapex,
      annualDebtService,
      projectCashFlow,
      equityCashFlow,
      cumulativeProjectCash,
      cumulativeEquityCash,
      sponsorSupportNeeded,
      debtStartingBalance,
      debtEndingBalance,
      financed,
      hasDebtService: financed && annualDebtService.some(value => value > 1e-9),
      hasPolicyCredits: annualPolicyCredits.some(value => Math.abs(value) > 1e-9),
      hasReplacements: replacementCapex.some(value => value > 1e-9),
      hasSponsorSupport: financed && sponsorSupportNeeded.some(value => value > 1e-9),
      totalCapex: safeTotalCapex,
      netCapexAtClose: safeNetCapexAtClose,
      upfrontPolicySupport: safeUpfrontPolicySupport,
      debtAmount: safeDebtAmount,
      equityUpfront: safeEquityUpfront,
    };
  },

  calculateEconomics(state, context) {
    const {
      solar, storage, chemicalSupply, ai, electrolyzer, dac, sabatier, methanol,
      exploratoryModules,
    } = context;

    const rate = state.discountRate / 100;
    const batteryLifeYears = storage.enabled ? storage.lifetimeYears : 0;
    const exploratoryDetails = (exploratoryModules || [])
      .filter(module => module.enabled && module.modeled && (module.capex > 0 || module.annualOutputUnits > 0))
      .map(module => {
        const marketConfig = EXPLORATORY_MARKET_CONFIG[module.id] || {};
        const priceKey = `${module.id}Price`;
        const unitPrice = state[priceKey] ?? marketConfig.defaultValue ?? 0;
        const assetLifeYears = module.routeConfig?.assetLifeYears || 10;
        return {
          id: module.id,
          label: module.label,
          outputLabel: module.outputLabel || module.label,
          routeLabel: module.routeLabel || module.route,
          capex: module.capex || 0,
          capexBasis: module.capexBasis || 0,
          capexBasisUnit: module.capexBasisUnit || 'tpa',
          assetLifeYears,
          annualizedCapex: (module.capex || 0) * this.crf(rate, assetLifeYears),
          omPercent: module.omPercent || 0,
          annualOM: (module.capex || 0) * ((module.omPercent || 0) / 100),
          annualOutputUnits: module.annualOutputUnits || 0,
          outputUnit: module.outputUnit || 't',
          unitPrice,
          annualRevenue: (module.annualOutputUnits || 0) * unitPrice,
        };
      });
    const exploratoryCapex = exploratoryDetails.reduce((sum, module) => sum + module.capex, 0);
    const exploratoryAnnualOM = exploratoryDetails.reduce((sum, module) => sum + module.annualOM, 0);
    const exploratoryRevenue = exploratoryDetails.reduce((sum, module) => sum + module.annualRevenue, 0);

    const capex = {
      solar: solar.totalSolarCapex,
      battery: storage.capex,
      ai: ai.capex,
      electrolyzer: electrolyzer.capex,
      dac: dac.capex,
      sabatier: sabatier.capex,
      methanol: methanol.capex,
      exploratory: exploratoryCapex,
    };
    const capexBreakdown = {
      solarModules: solar.moduleCapex,
      solarBos: solar.bosCapex,
      solarLand: solar.landCapex,
      solarSitePrep: solar.sitePrepCapex,
    };
    const totalCapex = Object.values(capex).reduce((sum, value) => sum + value, 0);
    const policy = this.getPolicyCredits(state, {
      solar,
      electrolyzer,
      dac,
      capex,
    });
    const netCapexAtClose = Math.max(0, totalCapex - (policy.upfrontSupport || 0));
    const financing = this.buildFinancingModel(state, netCapexAtClose);
    const replacementSchedule = this.buildReplacementSchedule(state.analysisHorizonYears, [
      { key: 'solar', label: 'Solar', cost: capex.solar, lifeYears: state.solarAssetLife },
      { key: 'battery', label: 'Battery', cost: capex.battery, lifeYears: batteryLifeYears },
      { key: 'ai', label: 'AI datacenter', cost: capex.ai, lifeYears: ai.assetLifeYears },
      { key: 'electrolyzer', label: 'Electrolyzer', cost: capex.electrolyzer, lifeYears: state.electrolyzerAssetLife },
      { key: 'dac', label: 'DAC', cost: capex.dac, lifeYears: state.dacAssetLife },
      { key: 'sabatier', label: 'Methane reactor', cost: capex.sabatier, lifeYears: state.sabatierAssetLife },
      { key: 'methanol', label: 'Methanol reactor', cost: capex.methanol, lifeYears: state.methanolAssetLife },
      ...exploratoryDetails.map(module => ({
        key: `exploratory-${module.id}`,
        label: `${module.label} block`,
        cost: module.capex,
        lifeYears: module.assetLifeYears,
      })),
    ]);
    const exploratoryUpfrontSupport = Math.max(0, Number(policy.upfrontSupportByCapexKey?.exploratory) || 0);
    let remainingExploratorySupport = exploratoryUpfrontSupport;
    exploratoryDetails.forEach((module, index) => {
      const moduleCapex = Math.max(0, Number(module.capex) || 0);
      const value = index === (exploratoryDetails.length - 1)
        ? Math.max(0, remainingExploratorySupport)
        : (
            exploratoryCapex > 0
              ? (exploratoryUpfrontSupport * moduleCapex) / exploratoryCapex
              : 0
          );
      remainingExploratorySupport -= value;
      module.upfrontSupport = value;
      module.netCapexAtClose = Math.max(0, moduleCapex - value);
      module.annualizedCapex = module.netCapexAtClose * this.crf(rate, module.assetLifeYears);
    });
    const netCapexByKey = {
      solar: Math.max(0, capex.solar - (policy.upfrontSupportByCapexKey?.solar || 0)),
      battery: Math.max(0, capex.battery - (policy.upfrontSupportByCapexKey?.battery || 0)),
      ai: Math.max(0, capex.ai - (policy.upfrontSupportByCapexKey?.ai || 0)),
      electrolyzer: Math.max(0, capex.electrolyzer - (policy.upfrontSupportByCapexKey?.electrolyzer || 0)),
      dac: Math.max(0, capex.dac - (policy.upfrontSupportByCapexKey?.dac || 0)),
      sabatier: Math.max(0, capex.sabatier - (policy.upfrontSupportByCapexKey?.sabatier || 0)),
      methanol: Math.max(0, capex.methanol - (policy.upfrontSupportByCapexKey?.methanol || 0)),
      exploratory: Math.max(0, capex.exploratory - exploratoryUpfrontSupport),
    };
    const exploratoryAnnualizedCapex = exploratoryDetails.reduce((sum, module) => sum + module.annualizedCapex, 0);

    const annualizedCapex = {
      solar: netCapexByKey.solar * this.crf(rate, state.solarAssetLife),
      battery: storage.enabled ? netCapexByKey.battery * this.crf(rate, batteryLifeYears) : 0,
      ai: ai.enabled ? netCapexByKey.ai * this.crf(rate, ai.assetLifeYears) : 0,
      electrolyzer: netCapexByKey.electrolyzer * this.crf(rate, state.electrolyzerAssetLife),
      dac: netCapexByKey.dac * this.crf(rate, state.dacAssetLife),
      sabatier: netCapexByKey.sabatier * this.crf(rate, state.sabatierAssetLife),
      methanol: netCapexByKey.methanol * this.crf(rate, state.methanolAssetLife),
      exploratory: exploratoryAnnualizedCapex,
    };

    const batteryOmFrac = (state.batteryOmPercent ?? 1.5) / 100;
    const processOmFrac = (state.processOmPercent ?? 3) / 100;
    const annualOM = solar.annualSolarOm +
      (storage.capex * batteryOmFrac) +
      (ai.annualOM || 0) +
      ((electrolyzer.capex + dac.capex + sabatier.capex + methanol.capex) * processOmFrac) +
      exploratoryAnnualOM;

    const methaneSalePrice = this.getMethaneSalePrice(state);
    const revenue = {
      ai: ai.enabled ? ai.annualRevenue : 0,
      methane: sabatier.enabled ? sabatier.ch4AnnualMCF * methaneSalePrice : 0,
      hydrogen: 0,
      methanol: methanol.enabled ? (methanol.exportAnnualTons ?? methanol.annualTons) * state.methanolPrice : 0,
      exploratory: exploratoryRevenue,
      policyCredits: policy.total,
    };

    const totalAnnualRevenue = Object.values(revenue).reduce((sum, value) => sum + value, 0);
    const annualizedCapexTotal = Object.values(annualizedCapex).reduce((sum, value) => sum + value, 0);
    const annualCost = annualizedCapexTotal + annualOM;
    const annualProfit = totalAnnualRevenue - annualCost;
    const annualOperatingCashFlow = totalAnnualRevenue - annualOM;
    const yearlyCashFlows = [];
    let npv = -netCapexAtClose;
    let equityNpv = -financing.equityUpfront;
    let sponsorSupportTotal = 0;
    let peakSponsorSupport = 0;
    let peakSponsorSupportYear = null;
    const uncoveredDebtServiceYears = [];
    for (let year = 1; year <= state.analysisHorizonYears; year++) {
      const degradationFactor = this.getSolarDegradationFactor(state.panelDegradationAnnual, year);
      const policyDurationFactor = this.getPolicyDurationFactor(policy, year);
      const yearlyRevenue = {
        ai: revenue.ai * degradationFactor,
        methane: revenue.methane * degradationFactor,
        hydrogen: revenue.hydrogen * degradationFactor,
        methanol: revenue.methanol * degradationFactor,
        exploratory: revenue.exploratory * degradationFactor,
        policyCredits: revenue.policyCredits * degradationFactor * policyDurationFactor,
      };
      const totalYearRevenue = Object.values(yearlyRevenue).reduce((sum, value) => sum + value, 0);
      const operatingCashFlow = totalYearRevenue - annualOM;
      const replacementEvent = replacementSchedule.byYear[year];
      const replacementOutflow = replacementEvent ? replacementEvent.total : 0;
      const netCashFlow = operatingCashFlow - replacementOutflow;
      const debtEntry = financing.byYear[year] || {
        startingBalance: 0,
        endingBalance: 0,
        interest: 0,
        principalPaid: 0,
        debtService: 0,
      };
      const sponsorSupportNeeded = Math.max(0, debtEntry.debtService - operatingCashFlow);
      if (sponsorSupportNeeded > 1e-9) {
        sponsorSupportTotal += sponsorSupportNeeded;
        uncoveredDebtServiceYears.push(year);
        if (sponsorSupportNeeded > peakSponsorSupport) {
          peakSponsorSupport = sponsorSupportNeeded;
          peakSponsorSupportYear = year;
        }
      }
      const equityCashFlow = netCashFlow - debtEntry.debtService;
      const yearProfit = totalYearRevenue - annualCost;
      const cumulativeOperatingBefore = year === 1
        ? -netCapexAtClose
        : yearlyCashFlows[yearlyCashFlows.length - 1].cumulativeOperatingCash;
      const cumulativeOperatingAfter = cumulativeOperatingBefore + operatingCashFlow;
      const cumulativeNetBefore = year === 1
        ? -netCapexAtClose
        : yearlyCashFlows[yearlyCashFlows.length - 1].cumulativeNetCash;
      const cumulativeNetAfter = cumulativeNetBefore + netCashFlow;
      const cumulativeEquityBefore = year === 1
        ? -financing.equityUpfront
        : yearlyCashFlows[yearlyCashFlows.length - 1].cumulativeEquityCash;
      const cumulativeEquityAfter = cumulativeEquityBefore + equityCashFlow;

      yearlyCashFlows.push({
        year,
        degradationFactor,
        policyDurationFactor,
        revenue: yearlyRevenue,
        totalRevenue: totalYearRevenue,
        annualProfit: yearProfit,
        operatingCashFlow,
        replacementOutflow,
        replacementItems: replacementEvent ? replacementEvent.items : [],
        netCashFlow,
        cumulativeOperatingCash: cumulativeOperatingAfter,
        cumulativeNetCash: cumulativeNetAfter,
        debtStartingBalance: debtEntry.startingBalance,
        debtEndingBalance: debtEntry.endingBalance,
        debtInterest: debtEntry.interest,
        debtPrincipal: debtEntry.principalPaid,
        debtService: debtEntry.debtService,
        sponsorSupportNeeded,
        equityCashFlow,
        cumulativeEquityCash: cumulativeEquityAfter,
      });

      npv += netCashFlow / Math.pow(1 + rate, year);
      equityNpv += equityCashFlow / Math.pow(1 + rate, year);
    }

    const cumulativeProfit = yearlyCashFlows.reduce((sum, entry) => sum + entry.annualProfit, 0);
    const cumulativeOperatingCashFlow = yearlyCashFlows.reduce((sum, entry) => sum + entry.operatingCashFlow, 0);
    const cumulativeNetCashFlow = yearlyCashFlows.reduce((sum, entry) => sum + entry.netCashFlow, 0);
    const cumulativeEquityCashFlow = yearlyCashFlows.reduce((sum, entry) => sum + entry.equityCashFlow, 0);
    const averageAnnualRevenue = yearlyCashFlows.length > 0
      ? yearlyCashFlows.reduce((sum, entry) => sum + entry.totalRevenue, 0) / yearlyCashFlows.length
      : 0;
    const averageAnnualProfit = yearlyCashFlows.length > 0 ? cumulativeProfit / yearlyCashFlows.length : 0;
    const finalYearAnnualRevenue = yearlyCashFlows.length > 0
      ? yearlyCashFlows[yearlyCashFlows.length - 1].totalRevenue
      : totalAnnualRevenue;
    const finalYearAnnualProfit = yearlyCashFlows.length > 0
      ? yearlyCashFlows[yearlyCashFlows.length - 1].annualProfit
      : annualProfit;
    const finalCumulativeNetCash = yearlyCashFlows.length > 0
      ? yearlyCashFlows[yearlyCashFlows.length - 1].cumulativeNetCash
      : -netCapexAtClose;
    const finalCumulativeEquityCash = yearlyCashFlows.length > 0
      ? yearlyCashFlows[yearlyCashFlows.length - 1].cumulativeEquityCash
      : -financing.equityUpfront;
    const paybackYears = this.calculateSimplePaybackYears(
      netCapexAtClose,
      yearlyCashFlows.map(entry => entry.netCashFlow)
    );
    const sustainedPaybackYears = this.calculateSustainedPaybackYears(
      netCapexAtClose,
      yearlyCashFlows.map(entry => entry.netCashFlow)
    );
    const equityPaybackYears = this.calculateSimplePaybackYears(
      financing.equityUpfront,
      yearlyCashFlows.map(entry => entry.equityCashFlow)
    );
    const sustainedEquityPaybackYears = this.calculateSustainedPaybackYears(
      financing.equityUpfront,
      yearlyCashFlows.map(entry => entry.equityCashFlow)
    );
    const roi = netCapexAtClose > 0 ? (finalCumulativeNetCash / netCapexAtClose) * 100 : 0;

    const projectIrr = this.approximateIRR([
      -netCapexAtClose,
      ...yearlyCashFlows.map(entry => entry.netCashFlow),
    ], rate);
    const equityIrr = financing.enabled
      ? this.approximateIRR([
        -financing.equityUpfront,
        ...yearlyCashFlows.map(entry => entry.equityCashFlow),
      ], rate)
      : projectIrr;
    const irr = financing.enabled ? equityIrr : projectIrr;
    const financingSummary = {
      ...financing,
      canFullyCoverDebtService: uncoveredDebtServiceYears.length === 0,
      uncoveredDebtServiceYears,
      uncoveredDebtServiceYearCount: uncoveredDebtServiceYears.length,
      firstUncoveredDebtServiceYear: uncoveredDebtServiceYears[0] || null,
      sponsorSupportTotal,
      peakSponsorSupport,
      peakSponsorSupportYear,
    };
    const cashFlowTimeline = this.buildCashFlowTimeline(totalCapex, financingSummary, yearlyCashFlows, policy);

    const aiCoreAnnualCost = ai.enabled
      ? annualizedCapex.solar + annualizedCapex.battery + annualizedCapex.ai + solar.annualSolarOm + (storage.capex * batteryOmFrac) + (ai.annualOM || 0)
      : 0;
    const bufferedElectricityAnnualCost = solar.annualizedSolar +
      solar.annualSolarOm +
      (storage.annualizedCapex || 0) +
      (storage.capex * batteryOmFrac);
    const bufferedElectricityAnnualDeliveredMWh = (
      ai.enabled
        ? ((ai.annualAiServedKWh || 0) + (ai.chemicalAnnualKWh || 0))
        : ((chemicalSupply.dailyAvailableKWh || 0) * (solar.cyclesPerYear || 0))
    ) / 1000;
    const bufferedElectricityLifetimeAverageAnnualMWh = bufferedElectricityAnnualDeliveredMWh *
      this.getAverageSolarDegradationFactor(state.panelDegradationAnnual, state.solarAssetLife);
    const bufferedElectricityCostPerMWh = bufferedElectricityLifetimeAverageAnnualMWh > 0
      ? bufferedElectricityAnnualCost / bufferedElectricityLifetimeAverageAnnualMWh
      : 0;

    return {
      capex,
      capexBreakdown,
      annualizedCapex,
      totalCapex,
      netCapexAtClose,
      annualOM,
      annualCost,
      annualizedCapexTotal,
      annualOperatingCashFlow,
      revenue,
      totalAnnualRevenue,
      annualProfit,
      replacementSchedule: replacementSchedule.entries,
      totalReplacementOutflows: replacementSchedule.total,
      averageAnnualRevenue,
      averageAnnualProfit,
      finalYearAnnualRevenue,
      finalYearAnnualProfit,
      cumulativeOperatingCashFlow,
      cumulativeNetCashFlow,
      cumulativeEquityCashFlow,
      finalCumulativeNetCash,
      finalCumulativeEquityCash,
      methaneSalePrice,
      policy,
      financing: financingSummary,
      paybackYears,
      sustainedPaybackYears,
      equityPaybackYears,
      sustainedEquityPaybackYears,
      npv,
      equityNpv,
      roi,
      projectIrr,
      equityIrr,
      irr,
      yearlyCashFlows,
      cashFlowTimeline,
      aiCoreAnnualCost,
      bufferedElectricityAnnualCost,
      bufferedElectricityAnnualDeliveredMWh,
      bufferedElectricityLifetimeAverageAnnualMWh,
      bufferedElectricityCostPerMWh,
      costPerMToken: ai.enabled && ai.annualTokensM > 0 ? aiCoreAnnualCost / ai.annualTokensM : 0,
      tokenMarginPerM: ai.enabled && ai.annualTokensM > 0 ? (state.aiTokenPricePerM || 0) - (aiCoreAnnualCost / ai.annualTokensM) : 0,
      costPerKgH2: electrolyzer.enabled && electrolyzer.h2AnnualKg > 0 ? annualCost / electrolyzer.h2AnnualKg : 0,
      costPerTonCO2: dac.enabled && dac.co2AnnualTons > 0 ? annualCost / dac.co2AnnualTons : 0,
      costPerMCF: sabatier.enabled && sabatier.ch4AnnualMCF > 0 ? annualCost / sabatier.ch4AnnualMCF : 0,
      exploratoryDetails,
      modeledExploratoryModules: exploratoryDetails.map(module => module.label),
      excludedModules: [],
    };
  },

  calculateEnvironmental(solar, dac, sabatier, methanol, electrolyzer) {
    const co2Captured = dac.enabled ? dac.co2AnnualTons : 0;
    const co2Displaced = sabatier.enabled
      ? sabatier.ch4AnnualMCF * MODEL_ASSUMPTIONS.fossilGasEmissionsPerMCF
      : 0;
    const waterConsumedDaily = electrolyzer.enabled ? electrolyzer.waterDailyKg : 0;
    const waterProducedDaily = (sabatier.waterProducedDaily || 0) + (methanol.waterProducedDaily || 0);

    return {
      co2Captured,
      co2Displaced,
      totalCO2Benefit: co2Captured + co2Displaced,
      waterConsumedDaily,
      waterRecycledDaily: waterProducedDaily,
      waterProducedDaily,
      netWaterDaily: Math.max(0, waterConsumedDaily - waterProducedDaily),
      landAcres: solar.acres,
      landProductivityVsCorn: sabatier.enabled ? 20 : 0,
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

  calculateScenario(state, options = {}) {
    const fastMode = Boolean(options.fastMode);
    const normalizedState = this.normalizeState(state);
    const exploratoryEnabled = MODULE_REGISTRY.some(
      module => module.maturity === 'Exploratory' && Boolean(normalizedState[`${module.id}Enabled`])
    );
    const bufferedModuleEnabled = MODULE_REGISTRY.some(module => {
      if (!normalizedState[`${module.id}Enabled`]) return false;
      return this.isModuleFeedBufferEnabled(
        normalizedState,
        module.id,
        normalizedState[`${module.id}Route`]
      );
    });
    const includeAnnualSolar = !fastMode || normalizedState.aiComputeEnabled || exploratoryEnabled || bufferedModuleEnabled;
    const includeAnnualSolarWindowSummaries = !fastMode;
    const includeDispatchSeries = !fastMode;
    const includeDisplayDispatchSeries = !fastMode;
    const includeBatterySeries = !fastMode;
    const includeSupportedModules = !fastMode;
    const includeExploratoryModules = !fastMode || exploratoryEnabled;
    const includeEnvironmental = !fastMode;
    const solar = this.calculateSolar(normalizedState);
    const annualSolar = includeAnnualSolar
      ? this.buildAnnualSolarSeries(normalizedState, solar, {
          includeWindowSummaries: includeAnnualSolarWindowSummaries,
        })
      : null;
    const shouldRunAiModel = normalizedState.aiComputeEnabled || !fastMode || exploratoryEnabled || bufferedModuleEnabled;
    const ai = shouldRunAiModel
      ? this.calculateAICompute(normalizedState, solar, annualSolar, {
          captureDispatchSeries: includeDispatchSeries,
          captureDailySummaries: bufferedModuleEnabled,
          includeDisplayDispatchSeries,
        })
      : this.buildDisabledAiSummary(normalizedState);
    const batterySummary = ai.enabled
      ? null
      : this.calculateBattery(normalizedState, solar, {
          includeSeries: includeBatterySeries,
        });
    const storage = ai.enabled ? ai.storage : batterySummary.storage;
    const chemicalSupply = ai.enabled ? ai.chemicalSupply : batterySummary.chemicalSupply;
    const annualChemicalDisplayDispatch = (!ai.enabled &&
      includeDisplayDispatchSeries &&
      normalizedState.body === 'earth' &&
      annualSolar &&
      Array.isArray(annualSolar.hourlyKW) &&
      annualSolar.hourlyKW.length)
      ? {
          ...this.simulateAnnualChemicalDispatch(
            normalizedState,
            annualSolar,
            chemicalSupply.processPowerKW,
            { captureSeries: true }
          ),
          dayLabels: annualSolar.dayLabels || [],
        }
      : null;
    const cyclesPerYear = this.getBodyConfig(normalizedState.body || 'earth').cyclesPerEarthYear;
    const effectiveDailyKWh = ai.enabled
      ? ai.chemicalAnnualKWh / Math.max(cyclesPerYear, 1)
      : chemicalSupply.dailyAvailableKWh;
    const peakChemicalDailyKWh = Array.isArray(ai.dispatch?.dailyChemicalKWh) && ai.dispatch.dailyChemicalKWh.length
      ? Math.max(...ai.dispatch.dailyChemicalKWh, 0)
      : effectiveDailyKWh;
    const peakDayScale = effectiveDailyKWh > 0 && peakChemicalDailyKWh > 0
      ? Math.max(1, peakChemicalDailyKWh / effectiveDailyKWh)
      : 1;
    const effectivePeakKW = chemicalSupply.processPowerKW;
    const peakSizingKW = Math.max(
      effectivePeakKW,
      Number.isFinite(ai.dispatch?.chemicalPeakKW) ? ai.dispatch.chemicalPeakKW : 0
    );
    const opHours = ai.enabled
      ? ai.chemicalDailyOpHours
      : chemicalSupply.dailyOpHours;
    const allocationPlan = this.buildProcessAllocationPlan(normalizedState);
    const allocation = {
      source: 'auto',
      label: allocationPlan.label,
      electrolyzer: allocationPlan.powerShares.electrolyzer,
      dac: allocationPlan.powerShares.dac,
      exploratory: allocationPlan.powerShares.exploratory,
      feedShares: allocationPlan.feedShares,
      supported: allocationPlan.supported,
    };
    const reactorSizingPeakKW = effectivePeakKW;

    const electrolyzer = this.calculateElectrolyzer(normalizedState, effectivePeakKW, effectiveDailyKWh, allocation);
    const dac = this.calculateDAC(normalizedState, effectivePeakKW, effectiveDailyKWh, allocation);

    const productFlow = this.calculateSupportedProducts(
      normalizedState,
      {
        h2DailyKg: electrolyzer.h2DailyKg || 0,
        co2DailyKg: dac.co2DailyKg || 0,
        peakH2DailyKg: (electrolyzer.h2DailyKg || 0) * peakDayScale,
        peakCO2DailyKg: (dac.co2DailyKg || 0) * peakDayScale,
        h2SizingPeakKgPerHour: normalizedState.electrolyzerEnabled
          ? (reactorSizingPeakKW * allocation.electrolyzer) / normalizedState.electrolyzerEfficiency
          : 0,
        co2SizingPeakKgPerHour: normalizedState.dacEnabled
          ? ((reactorSizingPeakKW * allocation.dac) / normalizedState.dacEnergy) * 1000
          : 0,
      },
      opHours,
      allocationPlan,
      { includeSupportedModules }
    );

    const sabatier = productFlow.outputs.sabatier || this.calculateSabatier({ ...normalizedState, sabatierEnabled: false }, 0, 0, opHours);
    const methanol = productFlow.outputs.methanol || this.calculateMethanol({ ...normalizedState, methanolEnabled: false }, 0, 0, opHours);
    const exploratoryModules = includeExploratoryModules
      ? this.calculateExploratoryModules(normalizedState, {
          allocationPlan,
          materialFlows: {
            h2DailyKg: electrolyzer.h2DailyKg || 0,
            co2DailyKg: dac.co2DailyKg || 0,
          },
          peakMaterialFlows: {
            h2KgPerHour: normalizedState.electrolyzerEnabled
              ? (peakSizingKW * allocation.electrolyzer) / normalizedState.electrolyzerEfficiency
              : 0,
            co2KgPerHour: normalizedState.dacEnabled
              ? ((peakSizingKW * allocation.dac) / normalizedState.dacEnergy) * 1000
              : 0,
            methanolKgPerHour: (productFlow.outputs?.methanol?.designHourlyOutputKg || 0) * (
              productFlow.outputs?.methanol?.bufferEnabled
                ? 1
                : (effectivePeakKW > 0 ? peakSizingKW / effectivePeakKW : 1)
            ),
          },
          supportedOutputs: productFlow.outputs,
          effectivePeakKW: reactorSizingPeakKW,
          peakSizingKW,
          effectiveDailyKWh,
          peakDailyKWh: peakChemicalDailyKWh,
          opHours,
        })
      : [];
    const exploratoryH2Consumed = exploratoryModules.reduce((sum, module) => sum + (module.h2Consumed || 0), 0);
    const exploratoryCo2Consumed = exploratoryModules.reduce((sum, module) => sum + (module.co2Consumed || 0), 0);
    const exploratoryMethanolConsumed = exploratoryModules.reduce((sum, module) => sum + (module.methanolConsumed || 0), 0);
    if (methanol.enabled) {
      const exportedDailyKg = Math.max(0, (methanol.grossDailyKg || methanol.dailyKg || 0) - exploratoryMethanolConsumed);
      methanol.exportDailyKg = exportedDailyKg;
      methanol.exportAnnualKg = exportedDailyKg * cyclesPerYear;
      methanol.exportAnnualTons = methanol.exportAnnualKg / 1000;
      methanol.dailyKg = exportedDailyKg;
      methanol.annualKg = methanol.exportAnnualKg;
      methanol.annualTons = methanol.exportAnnualTons;
      methanol.dailyLiters = exportedDailyKg / CHEMISTRY.methanol.density;
    }
    const h2Surplus = Math.max(0, (electrolyzer.h2DailyKg || 0) - (sabatier.h2Consumed || 0) - (methanol.h2Consumed || 0) - exploratoryH2Consumed);
    const co2Surplus = Math.max(0, (dac.co2DailyKg || 0) - (sabatier.co2Consumed || 0) - (methanol.co2Consumed || 0) - exploratoryCo2Consumed);

    const economics = this.calculateEconomics(normalizedState, {
      solar,
      storage,
      chemicalSupply,
      ai,
      electrolyzer,
      dac,
      sabatier,
      methanol,
      h2Surplus,
      co2Surplus,
      exploratoryModules,
    });
    const environmental = includeEnvironmental
      ? this.calculateEnvironmental(solar, dac, sabatier, methanol, electrolyzer)
      : null;

    return {
      state: normalizedState,
      solar,
      annualSolar,
      storage,
      chemicalSupply,
      ai,
      annualDispatch: ai.dispatch || null,
      annualChemicalDisplayDispatch,
      allocation,
      electrolyzer,
      dac,
      sabatier,
      methanol,
      supportedModules: includeSupportedModules ? [sabatier, methanol] : [],
      exploratoryModules,
      economics,
      environmental,
      h2Surplus,
      co2Surplus,
      effectiveDailyKWh,
      opHours,
    };
  },

  calculateAll(state) {
    return this.calculateScenario(state);
  },

  calculateIrr(state) {
    return this.calculateScenario(state, { fastMode: true }).economics.irr;
  },

  runSensitivity(baseState, paramKey, values) {
    return values.map(val => {
      const modified = { ...baseState, [paramKey]: val };
      const result = this.calculateAll(modified);
      return {
        x: val,
        npv: result.economics.npv,
        payback: result.economics.paybackYears,
        roi: result.economics.roi,
      };
    });
  },
});
