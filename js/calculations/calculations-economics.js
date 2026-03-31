/* Economics, policy, environment, orchestration */

Object.assign(Calc, {
  getMethaneSalePrice(state) {
    return state.methanePrice;
  },

  getPolicyCredits(state, context) {
    const {
      electrolyzer,
      dac,
      co2Surplus = 0,
    } = context;
    const mode = state.policyMode;
    const policy = POLICY_OPTIONS[mode] || POLICY_OPTIONS.none;
    const cyclesPerYear = this.getBodyConfig(state.body || 'earth').cyclesPerEarthYear;
    const h2Credit = policy.useCustomH2
      ? (state.customH2Credit || 0)
      : (policy.h2Credit || 0);
    const co2Credit = policy.useCustomCo2
      ? (state.customCo2Credit || 0)
      : (policy.co2Credit || 0);
    const eligibleH2Kg = electrolyzer.enabled ? electrolyzer.h2AnnualKg : 0;
    const capturedCo2Tons = dac.enabled ? dac.co2AnnualTons : 0;
    const surplusCo2Tons = Math.max(0, co2Surplus || 0) * cyclesPerYear / 1000;
    const utilizedCo2Tons = Math.max(0, capturedCo2Tons - surplusCo2Tons);
    let eligibleCo2Tons = capturedCo2Tons;

    if (mode === 'us_45q_utilization') {
      eligibleCo2Tons = utilizedCo2Tons;
    } else if (mode === 'us_45q_sequestration') {
      eligibleCo2Tons = surplusCo2Tons;
    }

    const h2Value = eligibleH2Kg * h2Credit;
    const co2Value = eligibleCo2Tons * co2Credit;
    const total = h2Value + co2Value;

    return {
      mode,
      label: policy.label,
      total,
      applicability: policy.applicability,
      basis: policy.basis,
      note: policy.note,
      stackingRule: policy.stackingRule,
      h2Credit,
      co2Credit,
      h2Value,
      co2Value,
      durationYears: Number.isFinite(policy.durationYears) ? policy.durationYears : null,
      eligibleH2Kg,
      eligibleCo2Tons,
      capturedCo2Tons,
      utilizedCo2Tons,
      surplusCo2Tons,
    };
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

  calculateEconomics(state, context) {
    const {
      solar, storage, ai, electrolyzer, dac, sabatier, methanol,
      h2Surplus, co2Surplus, exploratoryModules,
    } = context;

    const rate = state.discountRate / 100;
    const batteryLifeYears = storage.enabled ? storage.lifetimeYears : 0;

    const capex = {
      solar: solar.totalSolarCapex,
      battery: storage.capex,
      ai: ai.capex,
      electrolyzer: electrolyzer.capex,
      dac: dac.capex,
      sabatier: sabatier.capex,
      methanol: methanol.capex,
    };
    const capexBreakdown = {
      solarModules: solar.moduleCapex,
      solarBos: solar.bosCapex,
      solarLand: solar.landCapex,
      solarSitePrep: solar.sitePrepCapex,
    };
    const totalCapex = Object.values(capex).reduce((sum, value) => sum + value, 0);
    const financing = this.buildFinancingModel(state, totalCapex);
    const replacementSchedule = this.buildReplacementSchedule(state.analysisHorizonYears, [
      { key: 'solar', label: 'Solar', cost: capex.solar, lifeYears: state.solarAssetLife },
      { key: 'battery', label: 'Battery', cost: capex.battery, lifeYears: batteryLifeYears },
      { key: 'ai', label: 'AI datacenter', cost: capex.ai, lifeYears: ai.assetLifeYears },
      { key: 'electrolyzer', label: 'Electrolyzer', cost: capex.electrolyzer, lifeYears: state.electrolyzerAssetLife },
      { key: 'dac', label: 'DAC', cost: capex.dac, lifeYears: state.dacAssetLife },
      { key: 'sabatier', label: 'Methane reactor', cost: capex.sabatier, lifeYears: state.sabatierAssetLife },
      { key: 'methanol', label: 'Methanol reactor', cost: capex.methanol, lifeYears: state.methanolAssetLife },
    ]);

    const annualizedCapex = {
      solar: capex.solar * this.crf(rate, state.solarAssetLife),
      battery: storage.enabled ? capex.battery * this.crf(rate, batteryLifeYears) : 0,
      ai: ai.enabled ? capex.ai * this.crf(rate, ai.assetLifeYears) : 0,
      electrolyzer: capex.electrolyzer * this.crf(rate, state.electrolyzerAssetLife),
      dac: capex.dac * this.crf(rate, state.dacAssetLife),
      sabatier: capex.sabatier * this.crf(rate, state.sabatierAssetLife),
      methanol: capex.methanol * this.crf(rate, state.methanolAssetLife),
    };

    const batteryOmFrac = (state.batteryOmPercent ?? 1.5) / 100;
    const processOmFrac = (state.processOmPercent ?? 3) / 100;
    const annualOM = solar.annualSolarOm +
      (storage.capex * batteryOmFrac) +
      (ai.annualOM || 0) +
      ((electrolyzer.capex + dac.capex + sabatier.capex + methanol.capex) * processOmFrac);

    const methaneSalePrice = this.getMethaneSalePrice(state);
    const policy = this.getPolicyCredits(state, { electrolyzer, dac, co2Surplus });
    const revenue = {
      ai: ai.enabled ? ai.annualRevenue : 0,
      methane: sabatier.enabled ? sabatier.ch4AnnualMCF * methaneSalePrice : 0,
      hydrogen: 0,
      methanol: methanol.enabled ? methanol.annualTons * state.methanolPrice : 0,
      policyCredits: policy.total,
    };

    const totalAnnualRevenue = Object.values(revenue).reduce((sum, value) => sum + value, 0);
    const annualizedCapexTotal = Object.values(annualizedCapex).reduce((sum, value) => sum + value, 0);
    const annualCost = annualizedCapexTotal + annualOM;
    const annualProfit = totalAnnualRevenue - annualCost;
    const annualOperatingCashFlow = totalAnnualRevenue - annualOM;
    const yearlyCashFlows = [];
    let npv = -totalCapex;
    let equityNpv = -financing.equityUpfront;
    for (let year = 1; year <= state.analysisHorizonYears; year++) {
      const degradationFactor = this.getSolarDegradationFactor(state.panelDegradationAnnual, year);
      const policyDurationFactor = this.getPolicyDurationFactor(policy, year);
      const yearlyRevenue = {
        ai: revenue.ai * degradationFactor,
        methane: revenue.methane * degradationFactor,
        hydrogen: revenue.hydrogen * degradationFactor,
        methanol: revenue.methanol * degradationFactor,
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
      const equityCashFlow = netCashFlow - debtEntry.debtService;
      const yearProfit = totalYearRevenue - annualCost;
      const cumulativeOperatingBefore = year === 1
        ? -totalCapex
        : yearlyCashFlows[yearlyCashFlows.length - 1].cumulativeOperatingCash;
      const cumulativeOperatingAfter = cumulativeOperatingBefore + operatingCashFlow;
      const cumulativeNetBefore = year === 1
        ? -totalCapex
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
      : -totalCapex;
    const finalCumulativeEquityCash = yearlyCashFlows.length > 0
      ? yearlyCashFlows[yearlyCashFlows.length - 1].cumulativeEquityCash
      : -financing.equityUpfront;
    const paybackYears = this.calculateSimplePaybackYears(
      totalCapex,
      yearlyCashFlows.map(entry => entry.netCashFlow)
    );
    const sustainedPaybackYears = this.calculateSustainedPaybackYears(
      totalCapex,
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
    const roi = totalCapex > 0 ? (finalCumulativeNetCash / totalCapex) * 100 : 0;

    const projectIrr = this.approximateIRR([
      -totalCapex,
      ...yearlyCashFlows.map(entry => entry.netCashFlow),
    ]);
    const equityIrr = financing.enabled
      ? this.approximateIRR([
        -financing.equityUpfront,
        ...yearlyCashFlows.map(entry => entry.equityCashFlow),
      ])
      : projectIrr;
    const irr = financing.enabled ? equityIrr : projectIrr;

    const aiCoreAnnualCost = ai.enabled
      ? annualizedCapex.solar + annualizedCapex.battery + annualizedCapex.ai + solar.annualSolarOm + (storage.capex * batteryOmFrac) + (ai.annualOM || 0)
      : 0;

    return {
      capex,
      capexBreakdown,
      annualizedCapex,
      totalCapex,
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
      financing,
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
      aiCoreAnnualCost,
      costPerMToken: ai.enabled && ai.annualTokensM > 0 ? aiCoreAnnualCost / ai.annualTokensM : 0,
      tokenMarginPerM: ai.enabled && ai.annualTokensM > 0 ? (state.aiTokenPricePerM || 0) - (aiCoreAnnualCost / ai.annualTokensM) : 0,
      costPerKgH2: electrolyzer.enabled && electrolyzer.h2AnnualKg > 0 ? annualCost / electrolyzer.h2AnnualKg : 0,
      costPerTonCO2: dac.enabled && dac.co2AnnualTons > 0 ? annualCost / dac.co2AnnualTons : 0,
      costPerMCF: sabatier.enabled && sabatier.ch4AnnualMCF > 0 ? annualCost / sabatier.ch4AnnualMCF : 0,
      excludedModules: exploratoryModules.filter(module => module.enabled).map(module => module.label),
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

  calculateAll(state) {
    const normalizedState = this.normalizeState(state);
    const solar = this.calculateSolar(normalizedState);
    const annualSolar = this.buildAnnualSolarSeries(normalizedState, solar);
    const ai = this.calculateAICompute(normalizedState, solar, annualSolar);
    const batteryResult = ai.enabled ? null : this.calculateBattery(normalizedState, solar);
    const storage = ai.enabled ? ai.storage : batteryResult.storage;
    const chemicalSupply = ai.enabled ? ai.chemicalSupply : batteryResult.chemicalSupply;
    const cyclesPerYear = this.getBodyConfig(normalizedState.body || 'earth').cyclesPerEarthYear;
    const effectiveDailyKWh = ai.enabled
      ? ai.chemicalAnnualKWh / Math.max(cyclesPerYear, 1)
      : chemicalSupply.dailyAvailableKWh;
    const effectivePeakKW = chemicalSupply.processPowerKW;
    const opHours = ai.enabled
      ? ai.chemicalDailyOpHours
      : chemicalSupply.dailyOpHours;
    const allocation = this.getBalancedAllocation(normalizedState);
    const reactorSizingPeakKW = effectivePeakKW;

    const electrolyzer = this.calculateElectrolyzer(normalizedState, effectivePeakKW, effectiveDailyKWh, allocation);
    const dac = this.calculateDAC(normalizedState, effectivePeakKW, effectiveDailyKWh, allocation);

    const productFlow = this.calculateSupportedProducts(
      normalizedState,
      {
        h2DailyKg: electrolyzer.h2DailyKg || 0,
        co2DailyKg: dac.co2DailyKg || 0,
        h2SizingPeakKgPerHour: normalizedState.electrolyzerEnabled
          ? (reactorSizingPeakKW * allocation.electrolyzer) / normalizedState.electrolyzerEfficiency
          : 0,
        co2SizingPeakKgPerHour: normalizedState.dacEnabled
          ? ((reactorSizingPeakKW * allocation.dac) / normalizedState.dacEnergy) * 1000
          : 0,
      },
      opHours
    );

    const sabatier = productFlow.outputs.sabatier || this.calculateSabatier({ ...normalizedState, sabatierEnabled: false }, 0, 0, opHours);
    const methanol = productFlow.outputs.methanol || this.calculateMethanol({ ...normalizedState, methanolEnabled: false }, 0, 0, opHours);
    const exploratoryModules = this.calculateExploratoryModules(normalizedState);

    const economics = this.calculateEconomics(normalizedState, {
      solar,
      storage,
      chemicalSupply,
      ai,
      electrolyzer,
      dac,
      sabatier,
      methanol,
      h2Surplus: productFlow.h2Remaining,
      co2Surplus: productFlow.co2Remaining,
      exploratoryModules,
    });
    const environmental = this.calculateEnvironmental(solar, dac, sabatier, methanol, electrolyzer);

    return {
      state: normalizedState,
      solar,
      annualSolar,
      storage,
      chemicalSupply,
      ai,
      annualDispatch: ai.dispatch,
      allocation,
      electrolyzer,
      dac,
      sabatier,
      methanol,
      supportedModules: productFlow.supportedModules,
      exploratoryModules,
      economics,
      environmental,
      h2Surplus: productFlow.h2Remaining,
      co2Surplus: productFlow.co2Remaining,
      effectiveDailyKWh,
      opHours,
    };
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
