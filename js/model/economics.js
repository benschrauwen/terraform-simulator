/* ============================================
   Project economics and environmental summary
   ============================================
   Capex, O&M, revenue, policy support, yearly cash flows, NPV/IRR/payback,
   and levelized cost metrics for a computed scenario. */

import { MODEL_ASSUMPTIONS } from '../data/reference-data.js';
import { ModuleCatalog } from './module-catalog.js';
import { PolicyModel } from './policy.js';

export const economicsMethods = {
  getMethaneSalePrice(state) {
    return state.methanePrice;
  },

  getPolicyCredits(state, context) {
    return PolicyModel.evaluate(state, context);
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
        const marketConfig = ModuleCatalog.getMarketConfig(module.id, module.route) || {};
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
};
