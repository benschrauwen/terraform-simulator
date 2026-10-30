/* ============================================
   Project economics and environmental summary
   ============================================
   Capex, O&M, revenue, policy support, yearly cash flows, NPV/IRR/payback,
   and levelized cost metrics for a computed scenario. */

import { MODEL_ASSUMPTIONS } from '../data/reference-data.js';
import {
  approximateIRR,
  buildCashFlowTimeline,
  buildFinancingModel,
  buildReplacementSchedule,
  calculateSimplePaybackYears,
  calculateSustainedPaybackYears,
  crf,
  getAverageSolarDegradationFactor,
  getPolicyDurationFactor,
  getSolarDegradationFactor,
} from './finance.js';
import { ModuleCatalog } from './module-catalog.js';
import { PolicyModel, allocateUpfrontSupport } from './policy.js';

export const economicsMethods = {
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
          annualizedCapex: (module.capex || 0) * crf(rate, assetLifeYears),
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

    // Core capex blocks in a fixed order (sums, schedules and charts follow
    // it). `active: false` blocks carry no annualized capex. Exploratory
    // routes are appended per module.
    const coreAssets = [
      { key: 'solar', label: 'Solar', capex: solar.totalSolarCapex, lifeYears: state.solarAssetLife, active: true },
      { key: 'battery', label: 'Battery', capex: storage.capex, lifeYears: batteryLifeYears, active: storage.enabled },
      { key: 'ai', label: 'AI datacenter', capex: ai.capex, lifeYears: ai.assetLifeYears, active: ai.enabled },
      { key: 'electrolyzer', label: 'Electrolyzer', capex: electrolyzer.capex, lifeYears: state.electrolyzerAssetLife, active: true },
      { key: 'dac', label: 'DAC', capex: dac.capex, lifeYears: state.dacAssetLife, active: true },
      { key: 'sabatier', label: 'Methane reactor', capex: sabatier.capex, lifeYears: state.sabatierAssetLife, active: true },
      { key: 'methanol', label: 'Methanol reactor', capex: methanol.capex, lifeYears: state.methanolAssetLife, active: true },
    ];
    const capex = {
      ...Object.fromEntries(coreAssets.map(asset => [asset.key, asset.capex])),
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
    const financing = buildFinancingModel(state, netCapexAtClose);
    const replacementSchedule = buildReplacementSchedule(state.analysisHorizonYears, [
      ...coreAssets.map(asset => ({
        key: asset.key,
        label: asset.label,
        cost: asset.capex,
        lifeYears: asset.lifeYears,
      })),
      ...exploratoryDetails.map(module => ({
        key: `exploratory-${module.id}`,
        label: `${module.label} block`,
        cost: module.capex,
        lifeYears: module.assetLifeYears,
      })),
    ]);
    const exploratoryUpfrontSupport = Math.max(0, Number(policy.upfrontSupportByCapexKey?.exploratory) || 0);
    const exploratorySupportById = allocateUpfrontSupport(
      exploratoryUpfrontSupport,
      Object.fromEntries(exploratoryDetails.map(module => [module.id, module.capex]))
    );
    exploratoryDetails.forEach(module => {
      const moduleCapex = Math.max(0, Number(module.capex) || 0);
      module.upfrontSupport = exploratorySupportById[module.id];
      module.netCapexAtClose = Math.max(0, moduleCapex - module.upfrontSupport);
      module.annualizedCapex = module.netCapexAtClose * crf(rate, module.assetLifeYears);
    });
    const netCapexByKey = {
      ...Object.fromEntries(coreAssets.map(asset => [
        asset.key,
        Math.max(0, asset.capex - (policy.upfrontSupportByCapexKey?.[asset.key] || 0)),
      ])),
      exploratory: Math.max(0, capex.exploratory - exploratoryUpfrontSupport),
    };
    const exploratoryAnnualizedCapex = exploratoryDetails.reduce((sum, module) => sum + module.annualizedCapex, 0);

    const annualizedCapex = {
      ...Object.fromEntries(coreAssets.map(asset => [
        asset.key,
        asset.active ? netCapexByKey[asset.key] * crf(rate, asset.lifeYears) : 0,
      ])),
      exploratory: exploratoryAnnualizedCapex,
    };

    const batteryOmFrac = (state.batteryOmPercent ?? 1.5) / 100;
    const processOmFrac = (state.processOmPercent ?? 3) / 100;
    const annualOM = solar.annualSolarOm +
      (storage.capex * batteryOmFrac) +
      (ai.annualOM || 0) +
      ((electrolyzer.capex + dac.capex + sabatier.capex + methanol.capex) * processOmFrac) +
      exploratoryAnnualOM;

    const methaneSalePrice = state.methanePrice;
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
      const degradationFactor = getSolarDegradationFactor(state.panelDegradationAnnual, year);
      const policyDurationFactor = getPolicyDurationFactor(policy, year);
      // Every stream scales with PV degradation; policy credits also stop
      // after the scheme's support period.
      const yearlyRevenue = Object.fromEntries(Object.entries(revenue).map(([key, value]) => [
        key,
        key === 'policyCredits'
          ? value * degradationFactor * policyDurationFactor
          : value * degradationFactor,
      ]));
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
    const paybackYears = calculateSimplePaybackYears(
      netCapexAtClose,
      yearlyCashFlows.map(entry => entry.netCashFlow)
    );
    const sustainedPaybackYears = calculateSustainedPaybackYears(
      netCapexAtClose,
      yearlyCashFlows.map(entry => entry.netCashFlow)
    );
    const equityPaybackYears = calculateSimplePaybackYears(
      financing.equityUpfront,
      yearlyCashFlows.map(entry => entry.equityCashFlow)
    );
    const sustainedEquityPaybackYears = calculateSustainedPaybackYears(
      financing.equityUpfront,
      yearlyCashFlows.map(entry => entry.equityCashFlow)
    );
    const roi = netCapexAtClose > 0 ? (finalCumulativeNetCash / netCapexAtClose) * 100 : 0;

    const projectIrr = approximateIRR([
      -netCapexAtClose,
      ...yearlyCashFlows.map(entry => entry.netCashFlow),
    ], rate);
    const equityIrr = financing.enabled
      ? approximateIRR([
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
    const cashFlowTimeline = buildCashFlowTimeline(totalCapex, financingSummary, yearlyCashFlows, policy);

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
      getAverageSolarDegradationFactor(state.panelDegradationAnnual, state.solarAssetLife);
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
