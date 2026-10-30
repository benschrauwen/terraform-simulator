/* ============================================
   Project economics and environmental summary
   ============================================
   Capex, O&M, revenue, policy support, yearly cash flows, NPV/IRR/payback,
   and levelized cost metrics for a computed scenario. */

import { MODEL_ASSUMPTIONS } from '../data/assumptions.js';
import { DEFAULT_STATE } from '../state/schema.js';
import {
  analyzeIRR,
  buildCashFlowTimeline,
  buildFinancingModel,
  buildReplacementSchedule,
  calculateMIRR,
  calculateSimplePaybackYears,
  calculateSustainedPaybackYears,
  crf,
  getAverageSolarDegradationFactor,
  getPolicyDurationFactor,
  getSolarFactorForYear,
} from './finance.js';
import { ModuleCatalog } from './module-catalog.js';
import { PolicyModel, allocateUpfrontSupport } from './policy.js';

export const economicsMethods = {
  getPolicyCredits(state, context) {
    return PolicyModel.evaluate(state, context);
  },

  /* Per-year multipliers on year-1 revenue streams from the lifetime energy
     vectors (falls back to plain PV degradation without them). Policy
     credits on solar output follow the solar factor; credits on hydrogen or
     CO2 output follow chemical energy; the custom composite blends its
     solar and product components by their year-1 values. */
  getYearlyEnergyFactors(state, lifetimeEnergy, policy) {
    const at = (series, year, fallback) => {
      const value = Array.isArray(series) ? series[year - 1] : undefined;
      return Number.isFinite(value) ? value : fallback;
    };
    const components = policy?.componentValues || {};
    const solarComponent = Math.max(0, components.solar || 0);
    const productComponent = Math.max(0, (components.hydrogen || 0) + (components.co2 || 0));
    const outputBasis = String(policy?.outputBasis || '');
    return year => {
      const degradationFactor = at(
        lifetimeEnergy?.solarFactorByYear,
        year,
        getSolarFactorForYear(state.panelDegradationAnnual, year, state.solarAssetLife)
      );
      const aiFactor = at(lifetimeEnergy?.aiServedFactorByYear, year, degradationFactor);
      const chemicalFactor = at(lifetimeEnergy?.chemicalFactorByYear, year, degradationFactor);
      let policyFactor = degradationFactor;
      if (solarComponent + productComponent > 0) {
        policyFactor = ((solarComponent * degradationFactor) + (productComponent * chemicalFactor)) /
          (solarComponent + productComponent);
      } else if (outputBasis === 'hydrogen_kg' || outputBasis === 'co2_ton') {
        policyFactor = chemicalFactor;
      }
      return { degradationFactor, aiFactor, chemicalFactor, policyFactor };
    };
  },

  calculateEconomics(state, context) {
    const {
      solar, storage, chemicalSupply, ai, electrolyzer, dac, sabatier, methanol,
      exploratoryModules, lifetimeEnergy,
    } = context;

    const rate = state.discountRate / 100;
    const batteryLifeYears = storage.enabled ? storage.lifetimeYears : 0;
    const exploratoryDetails = (exploratoryModules || [])
      .filter(module => module.enabled && module.modeled && (module.capex > 0 || module.annualOutputUnits > 0))
      .map(module => {
        const marketConfig = ModuleCatalog.getMarketConfig(module.id, module.route) || {};
        const priceKey = `${module.id}Price`;
        const unitPrice = state[priceKey] ?? marketConfig.defaultValue ?? 0;
        const assetLifeYears = module.routeConfig?.assetLifeYears || MODEL_ASSUMPTIONS.exploratoryAssetLifeYears;
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
    // Land never wears out: no replacement, annual charge capital x r
    // instead of CRF, and returned at cost as salvage (see solar.js).
    const coreAssets = [
      {
        key: 'solar',
        label: 'Solar',
        capex: solar.depreciableSolarCapex ?? solar.totalSolarCapex,
        replacementCost: solar.solarReplacementCapex,
        lifeYears: state.solarAssetLife,
        active: true,
      },
      { key: 'land', label: 'Land', capex: solar.landCapex || 0, lifeYears: Infinity, salvageAtCost: true, perpetual: true, active: true },
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
      solarSitePrep: solar.sitePrepCapex,
      solarLand: solar.landCapex,
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
      ...coreAssets.filter(asset => asset.active).map(asset => ({
        key: asset.key,
        label: asset.label,
        cost: asset.capex,
        replacementCost: asset.replacementCost,
        lifeYears: asset.lifeYears,
        salvageAtCost: asset.salvageAtCost,
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
        asset.active
          ? netCapexByKey[asset.key] * (asset.perpetual ? Math.max(0, rate) : crf(rate, asset.lifeYears))
          : 0,
      ])),
      exploratory: exploratoryAnnualizedCapex,
    };

    const batteryOmFrac = (state.batteryOmPercent ?? DEFAULT_STATE.batteryOmPercent) / 100;
    const processOmFrac = (state.processOmPercent ?? DEFAULT_STATE.processOmPercent) / 100;
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
    const yearFactors = this.getYearlyEnergyFactors(state, lifetimeEnergy, policy);
    for (let year = 1; year <= state.analysisHorizonYears; year++) {
      const { degradationFactor, aiFactor, chemicalFactor, policyFactor } = yearFactors(year);
      const policyDurationFactor = getPolicyDurationFactor(policy, year);
      // Each stream follows the energy that produces it on the re-dispatched
      // degraded (and repowered) array: AI revenue the AI-served energy,
      // product revenue the delivered chemical energy, policy credits their
      // output basis. Policy credits also stop after the support period.
      const yearlyRevenue = Object.fromEntries(Object.entries(revenue).map(([key, value]) => {
        if (key === 'policyCredits') return [key, value * policyFactor * policyDurationFactor];
        if (key === 'ai') return [key, value * aiFactor];
        return [key, value * chemicalFactor];
      }));
      const totalYearRevenue = Object.values(yearlyRevenue).reduce((sum, value) => sum + value, 0);
      const operatingCashFlow = totalYearRevenue - annualOM;
      const replacementEvent = replacementSchedule.byYear[year];
      const replacementOutflow = replacementEvent ? replacementEvent.total : 0;
      // Straight-line residual value of every asset (land at cost) returns
      // in the final year, so a late replacement is not charged in full.
      const salvageValue = year === state.analysisHorizonYears ? replacementSchedule.salvage.total : 0;
      const netCashFlow = operatingCashFlow - replacementOutflow + salvageValue;
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
        salvageValue,
        salvageItems: salvageValue > 0 ? replacementSchedule.salvage.items : [],
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
    // With no net investment at close (e.g. a 100% grant) ROI and IRR are
    // undefined; payback stays 0 (nothing to recover) and NPV carries the case.
    const noNetInvestment = !(netCapexAtClose > 0);
    const roi = noNetInvestment ? NaN : (finalCumulativeNetCash / netCapexAtClose) * 100;

    const projectCashFlowSeries = [-netCapexAtClose, ...yearlyCashFlows.map(entry => entry.netCashFlow)];
    const equityCashFlowSeries = [-financing.equityUpfront, ...yearlyCashFlows.map(entry => entry.equityCashFlow)];
    const projectIrrAnalysis = analyzeIRR(projectCashFlowSeries);
    const equityIrrAnalysis = financing.enabled ? analyzeIRR(equityCashFlowSeries) : projectIrrAnalysis;
    const projectIrr = projectIrrAnalysis.irr;
    const equityIrr = equityIrrAnalysis.irr;
    const irr = financing.enabled ? equityIrr : projectIrr;
    const irrAnalysis = financing.enabled ? equityIrrAnalysis : projectIrrAnalysis;
    // MIRR finances outflows and reinvests inflows at the discount rate.
    const projectMirr = calculateMIRR(projectCashFlowSeries, rate, rate);
    const equityMirr = financing.enabled ? calculateMIRR(equityCashFlowSeries, rate, rate) : projectMirr;
    const mirr = financing.enabled ? equityMirr : projectMirr;
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
      ? annualizedCapex.solar + annualizedCapex.land + annualizedCapex.battery + annualizedCapex.ai + solar.annualSolarOm + (storage.capex * batteryOmFrac) + (ai.annualOM || 0)
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
      salvageValue: replacementSchedule.salvage.total,
      salvageItems: replacementSchedule.salvage.items,
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
      discountRatePercent: state.discountRate,
      roi,
      noNetInvestment,
      projectIrr,
      equityIrr,
      irr,
      projectIrrAnalysis: { status: projectIrrAnalysis.status, label: projectIrrAnalysis.label, reason: projectIrrAnalysis.reason },
      equityIrrAnalysis: { status: equityIrrAnalysis.status, label: equityIrrAnalysis.label, reason: equityIrrAnalysis.reason },
      irrStatus: irrAnalysis.status,
      projectMirr,
      equityMirr,
      mirr,
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
      landProductivityVsCorn: sabatier.enabled ? MODEL_ASSUMPTIONS.landProductivityVsCornFactor : 0,
    };
  },
};
