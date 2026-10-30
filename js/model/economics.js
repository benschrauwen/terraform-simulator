/* ============================================
   Project economics and environmental summary
   ============================================
   Capex, O&M, revenue, policy support, yearly cash flows, NPV/IRR/payback,
   and levelized cost metrics for a computed scenario. */

import { MODEL_ASSUMPTIONS } from '../data/assumptions.js';
import { CHEMISTRY } from '../data/reference-data.js';
import {
  analyzeIRR,
  buildCashFlowTimeline,
  buildFinancingModel,
  buildReplacementSchedule,
  calculateMIRR,
  calculateSimplePaybackYears,
  calculateSustainedPaybackYears,
  crf,
  getPolicyDurationFactor,
  getSolarFactorForYear,
} from './finance.js';
import { ModuleCatalog } from '../data/module-catalog.js';
import { PolicyModel } from './policy.js';

/* Constant output with the same present value as year-1 output x the
   per-year factors over the horizon: sum f_y / (1 + r)^y x CRF(r, N).
   Missing factors count as 1. */
function getLevelizedOutputFactor(factorsByYear, rate, horizonYears) {
  let presentFactor = 0;
  for (let year = 1; year <= horizonYears; year++) {
    const factor = Array.isArray(factorsByYear) && Number.isFinite(factorsByYear[year - 1]) ? factorsByYear[year - 1] : 1;
    presentFactor += factor / Math.pow(1 + rate, year);
  }
  return presentFactor * crf(rate, horizonYears);
}

/* Installed assets. Exploratory route details (price, O&M, revenue), the
   core capex blocks in a fixed order (sums and schedules follow it;
   `active: false` blocks carry no capital charge) and capexItems, the one
   list of every installed-CAPEX item: the total, the 'total' policy basis,
   the CAPEX rows and the CAPEX chart all iterate it, so nothing can be
   counted in one and missed in another. Land never wears out: no
   replacement, annual charge capital x r instead of CRF, and returned at
   cost as salvage (see solar.js). */
function buildCapitalAssets(state, { solar, storage, ai, electrolyzer, dac, sabatier, methanol, exploratoryModules = [], feedBuffers }) {
  const exploratoryDetails = exploratoryModules
    .filter(module => module.enabled && module.modeled && (module.capex > 0 || module.annualOutputUnits > 0))
    .map(module => {
      const marketConfig = ModuleCatalog.getMarketConfig(module.id, module.route) || {};
      const unitPrice = state[`${module.id}Price`] ?? marketConfig.defaultValue ?? 0;
      return {
        id: module.id,
        label: module.label,
        outputLabel: module.outputLabel || module.label,
        routeLabel: module.routeLabel || module.route,
        capex: module.capex || 0,
        capexBasis: module.capexBasis || 0,
        capexBasisUnit: module.capexBasisUnit || 'tpa',
        assetLifeYears: module.routeConfig?.assetLifeYears || MODEL_ASSUMPTIONS.exploratoryAssetLifeYears,
        omPercent: module.omPercent || 0,
        annualOM: (module.capex || 0) * ((module.omPercent || 0) / 100),
        annualOutputUnits: module.annualOutputUnits || 0,
        outputUnit: module.outputUnit || 't',
        unitPrice,
        annualRevenue: (module.annualOutputUnits || 0) * unitPrice,
      };
    });

  const coreAssets = [
    {
      key: 'solar',
      label: 'Solar',
      capex: solar.depreciableSolarCapex,
      replacementCost: solar.solarReplacementCapex,
      lifeYears: state.solarAssetLife,
      active: true,
      parts: [
        { key: 'solarModules', label: 'Solar modules', capex: solar.moduleCapex },
        { key: 'solarBos', label: 'Solar structure + install BOS', capex: solar.bosCapex },
        { key: 'solarSitePrep', label: 'Site prep', capex: solar.sitePrepCapex },
      ],
    },
    { key: 'land', label: 'Land', capex: solar.landCapex, lifeYears: Infinity, salvageAtCost: true, perpetual: true, active: true },
    { key: 'battery', label: 'Battery', capex: storage.capex, lifeYears: storage.enabled ? storage.lifetimeYears : 0, active: storage.enabled },
    { key: 'ai', label: 'AI datacenter', capex: ai.capex, lifeYears: ai.assetLifeYears, active: ai.enabled },
    { key: 'electrolyzer', label: 'Electrolyzer', capex: electrolyzer.capex, lifeYears: state.electrolyzerAssetLife, active: true },
    { key: 'dac', label: 'DAC', capex: dac.capex, lifeYears: state.dacAssetLife, active: true },
    { key: 'sabatier', label: 'Methane reactor', capex: sabatier.capex, lifeYears: state.sabatierAssetLife, active: true },
    { key: 'methanol', label: 'Methanol reactor', capex: methanol.capex, lifeYears: state.methanolAssetLife, active: true },
    { key: 'feedBuffers', label: 'Feed buffer storage', capex: feedBuffers.capex, lifeYears: MODEL_ASSUMPTIONS.feedBufferAssetLifeYears, active: true },
  ];
  const capexItems = [
    ...coreAssets.map(({ key, label, capex, parts }) => ({ key, label, capex, parts })),
    ...exploratoryDetails.map(module => ({
      key: `exploratory-${module.id}`,
      label: module.label,
      routeLabel: module.routeLabel,
      capex: module.capex,
    })),
  ];
  const capex = {
    ...Object.fromEntries(coreAssets.map(asset => [asset.key, asset.capex])),
    exploratory: exploratoryDetails.reduce((sum, module) => sum + module.capex, 0),
  };
  return {
    exploratoryDetails,
    coreAssets,
    capexItems,
    capex,
    totalCapex: capexItems.reduce((sum, item) => sum + item.capex, 0),
  };
}

/* Year-by-year project, debt and equity cash flows. Each revenue stream
   follows the energy that produces it on the re-dispatched degraded (and
   repowered) array: AI revenue the AI-served energy, product revenue the
   delivered chemical energy, policy credits their output basis, and policy
   credits stop after the support period. Salvage (straight-line residual
   value, land at cost) returns in the final year. */
function buildYearlyCashFlows({ horizonYears, rate, revenue, annualOM, annualCost, replacementSchedule, financing, netCapexAtClose, policy, yearFactors }) {
  const yearlyCashFlows = [];
  let npv = -netCapexAtClose;
  let equityNpv = -financing.equityUpfront;
  for (let year = 1; year <= horizonYears; year++) {
    const { degradationFactor, aiFactor, chemicalFactor, policyFactor } = yearFactors(year);
    const policyDurationFactor = getPolicyDurationFactor(policy, year);
    const yearlyRevenue = Object.fromEntries(Object.entries(revenue).map(([key, value]) => {
      if (key === 'policyCredits') return [key, value * policyFactor * policyDurationFactor];
      if (key === 'ai') return [key, value * aiFactor];
      return [key, value * chemicalFactor];
    }));
    const totalYearRevenue = Object.values(yearlyRevenue).reduce((sum, value) => sum + value, 0);
    const operatingCashFlow = totalYearRevenue - annualOM;
    const replacementEvent = replacementSchedule.byYear[year];
    const replacementOutflow = replacementEvent ? replacementEvent.total : 0;
    const salvageValue = year === horizonYears ? replacementSchedule.salvage.total : 0;
    const netCashFlow = operatingCashFlow - replacementOutflow + salvageValue;
    const debtEntry = financing.byYear[year] || {
      startingBalance: 0,
      endingBalance: 0,
      interest: 0,
      principalPaid: 0,
      debtService: 0,
      scheduledDebtService: 0,
      balloonPayment: 0,
    };
    const equityCashFlow = netCashFlow - debtEntry.debtService;
    // Cash available for debt service (CFADS) is operating cash before
    // major replacement CAPEX: lenders fund repowerings and battery swaps
    // from reserve / maintenance accounts, not from the year's debt cover,
    // so a replacement year no longer reads as DSCR -2x. DSCR uses the
    // scheduled payment; a horizon balloon is repaid from final-year cash
    // including salvage. The replacement still hits equity cash: any
    // negative equity year after close, whether from debt service or a
    // replacement, needs extra sponsor cash.
    const cashAvailableForDebtService = operatingCashFlow;
    const scheduledDebtService = debtEntry.scheduledDebtService ?? debtEntry.debtService;
    const dscr = financing.enabled && scheduledDebtService > 1e-9
      ? cashAvailableForDebtService / scheduledDebtService
      : null;
    const previous = yearlyCashFlows[yearlyCashFlows.length - 1];

    yearlyCashFlows.push({
      year,
      degradationFactor,
      policyDurationFactor,
      revenue: yearlyRevenue,
      totalRevenue: totalYearRevenue,
      annualProfit: totalYearRevenue - annualCost,
      operatingCashFlow,
      replacementOutflow,
      replacementItems: replacementEvent ? replacementEvent.items : [],
      salvageValue,
      salvageItems: salvageValue > 0 ? replacementSchedule.salvage.items : [],
      netCashFlow,
      cumulativeOperatingCash: (previous ? previous.cumulativeOperatingCash : -netCapexAtClose) + operatingCashFlow,
      cumulativeNetCash: (previous ? previous.cumulativeNetCash : -netCapexAtClose) + netCashFlow,
      debtStartingBalance: debtEntry.startingBalance,
      debtEndingBalance: debtEntry.endingBalance,
      debtInterest: debtEntry.interest,
      debtPrincipal: debtEntry.principalPaid,
      debtService: debtEntry.debtService,
      balloonPayment: debtEntry.balloonPayment || 0,
      cashAvailableForDebtService,
      dscr,
      sponsorSupportNeeded: financing.enabled ? Math.max(0, -equityCashFlow) : 0,
      equityCashFlow,
      cumulativeEquityCash: (previous ? previous.cumulativeEquityCash : -financing.equityUpfront) + equityCashFlow,
    });

    npv += netCashFlow / Math.pow(1 + rate, year);
    equityNpv += equityCashFlow / Math.pow(1 + rate, year);
  }
  return { yearlyCashFlows, npv, equityNpv };
}

/* Horizon summaries of the yearly cash flows: cumulative and levelized
   totals, payback, ROI, IRR / MIRR (project and equity) and the debt
   coverage / sponsor-support summary of the financing. Exported for the
   datacenter model, which builds yearly entries with the same fields. */
export function summarizeReturns({ rate, horizonCrf, netCapexAtClose, financing, yearlyCashFlows, totalAnnualRevenue, annualCost, totalCapex, policy }) {
  const discountFactor = year => Math.pow(1 + rate, -year);
  const total = select => yearlyCashFlows.reduce((sum, entry) => sum + select(entry), 0);
  const last = yearlyCashFlows[yearlyCashFlows.length - 1];
  const pvRevenue = total(entry => entry.totalRevenue * discountFactor(entry.year));
  const pvPolicyCredits = total(entry => (entry.revenue.policyCredits || 0) * discountFactor(entry.year));
  const levelizedAnnualRevenue = pvRevenue * horizonCrf;
  const annualProfit = levelizedAnnualRevenue - annualCost;
  const cumulativeProfit = total(entry => entry.annualProfit);
  const finalCumulativeNetCash = last ? last.cumulativeNetCash : -netCapexAtClose;

  // Payback counts cash actually earned: operating cash minus replacement
  // CAPEX, without the final-year salvage. Salvage is a book value at the
  // horizon, not cash recovered from operations; counting it let a short
  // horizon "pay back" in its last year on the residual value alone.
  // Infinity = not recovered within the horizon.
  const paybackCashFlows = yearlyCashFlows.map(entry => entry.netCashFlow - entry.salvageValue);
  const equityPaybackCashFlows = yearlyCashFlows.map(entry => entry.equityCashFlow - entry.salvageValue);
  // With no net investment at close (e.g. a 100% grant) ROI and IRR are
  // undefined; payback stays 0 (nothing to recover) and NPV carries the case.
  const noNetInvestment = !(netCapexAtClose > 0);

  const projectCashFlowSeries = [-netCapexAtClose, ...yearlyCashFlows.map(entry => entry.netCashFlow)];
  const equityCashFlowSeries = [-financing.equityUpfront, ...yearlyCashFlows.map(entry => entry.equityCashFlow)];
  const projectIrrAnalysis = analyzeIRR(projectCashFlowSeries);
  const equityIrrAnalysis = financing.enabled ? analyzeIRR(equityCashFlowSeries) : projectIrrAnalysis;
  const irrAnalysis = financing.enabled ? equityIrrAnalysis : projectIrrAnalysis;
  // MIRR finances outflows and reinvests inflows at the discount rate.
  const projectMirr = calculateMIRR(projectCashFlowSeries, rate, rate);
  const equityMirr = financing.enabled ? calculateMIRR(equityCashFlowSeries, rate, rate) : projectMirr;

  const sponsorYears = yearlyCashFlows.filter(entry => entry.sponsorSupportNeeded > 1e-9);
  const peakSponsorEntry = sponsorYears.reduce((peak, entry) => (entry.sponsorSupportNeeded > (peak?.sponsorSupportNeeded || 0) ? entry : peak), null);
  const dscrValues = yearlyCashFlows.filter(entry => entry.dscr !== null);
  const uncoveredDebtServiceYears = sponsorYears.map(entry => entry.year);
  const financingSummary = {
    ...financing,
    canFullyCoverDebtService: uncoveredDebtServiceYears.length === 0,
    uncoveredDebtServiceYears,
    uncoveredDebtServiceYearCount: uncoveredDebtServiceYears.length,
    firstUncoveredDebtServiceYear: uncoveredDebtServiceYears[0] || null,
    sponsorSupportTotal: sponsorYears.reduce((sum, entry) => sum + entry.sponsorSupportNeeded, 0),
    peakSponsorSupport: peakSponsorEntry ? peakSponsorEntry.sponsorSupportNeeded : 0,
    peakSponsorSupportYear: peakSponsorEntry ? peakSponsorEntry.year : null,
    minDscr: dscrValues.length ? Math.min(...dscrValues.map(entry => entry.dscr)) : null,
    minDscrYear: dscrValues.length
      ? dscrValues.reduce((min, entry) => (entry.dscr < min.dscr ? entry : min)).year
      : null,
    averageDscr: dscrValues.length
      ? dscrValues.reduce((sum, entry) => sum + entry.dscr, 0) / dscrValues.length
      : null,
    dscrBelowOneYears: dscrValues.filter(entry => entry.dscr < 1).map(entry => entry.year),
  };

  return {
    levelizedAnnualRevenue,
    levelizedPolicyCredits: pvPolicyCredits * horizonCrf,
    annualProfit,
    cumulativeOperatingCashFlow: total(entry => entry.operatingCashFlow),
    cumulativeNetCashFlow: total(entry => entry.netCashFlow),
    cumulativeEquityCashFlow: total(entry => entry.equityCashFlow),
    averageAnnualRevenue: yearlyCashFlows.length ? total(entry => entry.totalRevenue) / yearlyCashFlows.length : 0,
    averageAnnualProfit: yearlyCashFlows.length ? cumulativeProfit / yearlyCashFlows.length : 0,
    finalYearAnnualRevenue: last ? last.totalRevenue : totalAnnualRevenue,
    finalYearAnnualProfit: last ? last.annualProfit : annualProfit,
    finalCumulativeNetCash,
    finalCumulativeEquityCash: last ? last.cumulativeEquityCash : -financing.equityUpfront,
    paybackYears: calculateSimplePaybackYears(netCapexAtClose, paybackCashFlows),
    sustainedPaybackYears: calculateSustainedPaybackYears(netCapexAtClose, paybackCashFlows),
    equityPaybackYears: calculateSimplePaybackYears(financing.equityUpfront, equityPaybackCashFlows),
    sustainedEquityPaybackYears: calculateSustainedPaybackYears(financing.equityUpfront, equityPaybackCashFlows),
    roi: noNetInvestment ? NaN : (finalCumulativeNetCash / netCapexAtClose) * 100,
    noNetInvestment,
    projectIrr: projectIrrAnalysis.irr,
    equityIrr: equityIrrAnalysis.irr,
    irr: irrAnalysis.irr,
    projectIrrAnalysis: { status: projectIrrAnalysis.status, label: projectIrrAnalysis.label, reason: projectIrrAnalysis.reason },
    equityIrrAnalysis: { status: equityIrrAnalysis.status, label: equityIrrAnalysis.label, reason: equityIrrAnalysis.reason },
    irrStatus: irrAnalysis.status,
    projectMirr,
    equityMirr,
    mirr: financing.enabled ? equityMirr : projectMirr,
    financing: financingSummary,
    cashFlowTimeline: buildCashFlowTimeline(totalCapex, financingSummary, yearlyCashFlows, policy),
  };
}

export const economicsMethods = {
  getPolicyCredits(state, context) {
    return PolicyModel.evaluate(state, context);
  },

  /* Per-year multipliers on year-1 revenue streams from the lifetime energy
     vectors (falls back to plain PV degradation without them). Policy
     credits on solar output follow delivered (unclipped) solar energy;
     credits on hydrogen or CO2 output follow chemical energy; the custom
     composite blends its solar and product components by their year-1
     values. */
  getYearlyEnergyFactors(state, lifetimeEnergy, policy) {
    const at = (series, year, fallback) => {
      const value = Array.isArray(series) ? series[year - 1] : undefined;
      return Number.isFinite(value) ? value : fallback;
    };
    const components = policy?.componentValues || {};
    const solarComponent = Math.max(0, components.solar || 0);
    const productComponent = Math.max(0, (components.hydrogen || 0) + (components.co2 || 0));
    const outputBasis = String(policy?.outputBasis || '');
    // Solar credits follow delivered (unclipped) generation.
    const solarKWh = lifetimeEnergy?.solarKWhByYear;
    const clippedKWh = lifetimeEnergy?.clippedKWhByYear;
    const deliveredKWh = year => (Array.isArray(solarKWh) && Array.isArray(clippedKWh)
      ? (solarKWh[year - 1] ?? NaN) - (clippedKWh[year - 1] ?? NaN)
      : NaN);
    const deliveredYear1 = deliveredKWh(1);
    return year => {
      const degradationFactor = at(
        lifetimeEnergy?.solarFactorByYear,
        year,
        getSolarFactorForYear(state.panelDegradationAnnual, year, state.solarAssetLife)
      );
      const aiFactor = at(lifetimeEnergy?.aiServedFactorByYear, year, degradationFactor);
      const chemicalFactor = at(lifetimeEnergy?.chemicalFactorByYear, year, degradationFactor);
      const deliveredRatio = deliveredYear1 > 0 ? deliveredKWh(year) / deliveredYear1 : NaN;
      const deliveredSolarFactor = Number.isFinite(deliveredRatio) ? Math.max(0, deliveredRatio) : degradationFactor;
      let policyFactor = deliveredSolarFactor;
      if (solarComponent + productComponent > 0) {
        policyFactor = ((solarComponent * deliveredSolarFactor) + (productComponent * chemicalFactor)) /
          (solarComponent + productComponent);
      } else if (outputBasis === 'hydrogen_kg' || outputBasis === 'co2_ton') {
        policyFactor = chemicalFactor;
      }
      return { degradationFactor, aiFactor, chemicalFactor, deliveredSolarFactor, policyFactor };
    };
  },

  /* Year-1 output that earns output-based support: solar delivered to the
     plant (generation minus clipping, from the annual dispatch), H2 and
     CO2 actually converted into products (production minus vented surplus). */
  getQualifyingOutput({ solar, chemicalSupply, electrolyzer, dac, h2Surplus = 0, co2Surplus = 0, lifetimeEnergy }) {
    const cyclesPerYear = solar?.cyclesPerYear || 0;
    const solarYear1KWh = lifetimeEnergy?.solarKWhByYear?.[0];
    const clippedYear1KWh = lifetimeEnergy?.clippedKWhByYear?.[0];
    const grossSolarMWh = Math.max(0, solar?.annualMWh || 0);
    const clippedMWh = Number.isFinite(clippedYear1KWh)
      ? clippedYear1KWh / 1000
      : ((chemicalSupply?.clippedDailyKWh || 0) * cyclesPerYear) / 1000;
    // Clipping is measured on the dispatch series; scale it onto the
    // reported generation if the two differ.
    const clippedShare = Number.isFinite(solarYear1KWh) && solarYear1KWh > 0
      ? Math.max(0, Math.min(1, clippedYear1KWh / solarYear1KWh))
      : (grossSolarMWh > 0 ? Math.max(0, Math.min(1, clippedMWh / grossSolarMWh)) : 0);
    const h2AnnualKg = electrolyzer?.enabled ? Math.max(0, electrolyzer.h2AnnualKg || 0) : 0;
    const co2AnnualTons = dac?.enabled ? Math.max(0, dac.co2AnnualTons || 0) : 0;
    return {
      solarDeliveredMWh: grossSolarMWh * (1 - clippedShare),
      solarClippedShare: clippedShare,
      h2Kg: Math.max(0, h2AnnualKg - (h2Surplus * cyclesPerYear)),
      co2Tons: Math.max(0, co2AnnualTons - ((co2Surplus * cyclesPerYear) / 1000)),
    };
  },

  /* Levelized unit costs by cost cascade instead of dividing the whole
     plant's cost by each product. Power (solar, land, battery and their
     O&M) goes to the chemical plant; in AI mode the battery (it discharges
     only to the AI load) goes wholly to AI and solar + land are split by
     the AI-served vs chemical energy shares, so AI and chemicals never both
     pay for the same asset. Chemical power is split by the electrolyzer /
     DAC power shares; H2 and CO2 costs flow to each reactor by its feed
     share (so vented feed is borne by the product that vents it);
     feed-buffer storage by each module's share of buffer value. Costs use
     per-asset CRF charges (net of upfront support such as an ITC) + O&M;
     outputs are levelized with the chemical-energy (AI: AI-served) factor
     over the horizon. Operating credits are excluded. */
  allocateUnitCosts(state, {
    annualizedCapex, solarLandAnnualCost, batteryAnnualCost, exploratoryAnnualCost = 0,
    ai, electrolyzer, dac, sabatier, methanol, feedBuffers, allocation, lifetimeEnergy, rate,
  }) {
    const processOmFrac = state.processOmPercent / 100;
    const horizonYears = state.analysisHorizonYears;
    const levelizedOutputFactor = getLevelizedOutputFactor(lifetimeEnergy?.chemicalFactorByYear, rate, horizonYears);
    const aiKWh = ai?.enabled ? (ai.annualAiServedKWh || 0) : 0;
    const chemicalKWh = ai?.enabled ? (ai.chemicalAnnualKWh || 0) : 1;
    const chemicalPowerShare = chemicalKWh + aiKWh > 0 ? chemicalKWh / (chemicalKWh + aiKWh) : 0;
    const chemicalPowerCost = ai?.enabled
      ? solarLandAnnualCost * chemicalPowerShare
      : solarLandAnnualCost + batteryAnnualCost;
    const aiPowerCost = ai?.enabled
      ? batteryAnnualCost + (solarLandAnnualCost * (1 - chemicalPowerShare))
      : 0;
    const aiAnnualCost = ai?.enabled ? aiPowerCost + (annualizedCapex.ai || 0) + (ai.annualOM || 0) : 0;
    const assetCost = (key, capexValue) => (annualizedCapex[key] || 0) + ((capexValue || 0) * processOmFrac);

    const h2AnnualCost = electrolyzer.enabled
      ? chemicalPowerCost * (allocation?.electrolyzer || 0) + assetCost('electrolyzer', electrolyzer.capex)
      : 0;
    const co2AnnualCost = dac.enabled
      ? chemicalPowerCost * (allocation?.dac || 0) + assetCost('dac', dac.capex)
      : 0;
    const bufferValue = module => ((module?.bufferH2Kg || 0) * Math.max(0, state.h2BufferCostPerKg || 0)) +
      (((module?.bufferCO2Kg || 0) / 1000) * Math.max(0, state.co2BufferCostPerTon || 0));
    const bufferAnnualCost = assetCost('feedBuffers', feedBuffers?.capex);
    const bufferShare = module => ((feedBuffers?.capex || 0) > 0 ? bufferValue(module) / feedBuffers.capex : 0);
    const reactorAnnualCost = (module, key) => (module?.enabled
      ? (h2AnnualCost * (allocation?.feedShares?.h2?.[key] || 0)) +
        (co2AnnualCost * (allocation?.feedShares?.co2?.[key] || 0)) +
        assetCost(key, module.capex) +
        (bufferAnnualCost * bufferShare(module))
      : 0);
    const sabatierAnnualCost = reactorAnnualCost(sabatier, 'sabatier');
    const methanolAnnualCost = reactorAnnualCost(methanol, 'methanol');
    const perUnit = (cost, annualOutput) => (annualOutput > 0 && levelizedOutputFactor > 0
      ? cost / (annualOutput * levelizedOutputFactor)
      : 0);

    // Block-level split of the asset-life annual cost: AI + chemical plant
    // (its power share plus every process block) = the whole plant.
    const chemicalPlantAnnualCost = chemicalPowerCost +
      assetCost('electrolyzer', electrolyzer.capex) +
      assetCost('dac', dac.capex) +
      assetCost('sabatier', sabatier.capex) +
      assetCost('methanol', methanol.capex) +
      bufferAnnualCost +
      exploratoryAnnualCost;

    return {
      levelizedOutputFactor,
      chemicalPowerShare: ai?.enabled ? chemicalPowerShare : 1,
      chemicalPowerCost,
      aiPowerCost,
      aiAnnualCost,
      chemicalPlantAnnualCost,
      h2AnnualCost,
      co2AnnualCost,
      sabatierAnnualCost,
      methanolAnnualCost,
      costPerKgH2: perUnit(h2AnnualCost, electrolyzer.enabled ? electrolyzer.h2AnnualKg : 0),
      costPerTonCO2: perUnit(co2AnnualCost, dac.enabled ? dac.co2AnnualTons : 0),
      costPerMCF: perUnit(sabatierAnnualCost, sabatier.enabled ? sabatier.ch4AnnualMCF : 0),
      costPerTonMethanol: perUnit(methanolAnnualCost, methanol.enabled ? methanol.reactorAnnualTons : 0),
    };
  },

  calculateEconomics(state, context) {
    const {
      solar, storage, chemicalSupply, ai, electrolyzer, dac, sabatier, methanol,
      lifetimeEnergy, h2Surplus = 0, co2Surplus = 0, feedBuffers = { capex: 0 }, allocation = null,
    } = context;

    const rate = state.discountRate / 100;
    const horizonYears = state.analysisHorizonYears;
    const { exploratoryDetails: grossExploratoryDetails, coreAssets, capexItems, capex, totalCapex } =
      buildCapitalAssets(state, { ...context, feedBuffers });
    const qualifying = this.getQualifyingOutput({ solar, chemicalSupply, electrolyzer, dac, h2Surplus, co2Surplus, lifetimeEnergy });
    const policy = this.getPolicyCredits(state, { solar, electrolyzer, dac, capexItems, qualifying });
    const netCapexAtClose = Math.max(0, totalCapex - (policy.upfrontSupport || 0));
    const financing = buildFinancingModel(state, netCapexAtClose);
    const replacementSchedule = buildReplacementSchedule(horizonYears, [
      ...coreAssets.filter(asset => asset.active).map(asset => ({
        key: asset.key,
        label: asset.label,
        cost: asset.capex,
        replacementCost: asset.replacementCost,
        lifeYears: asset.lifeYears,
        salvageAtCost: asset.salvageAtCost,
      })),
      ...grossExploratoryDetails.map(module => ({
        key: `exploratory-${module.id}`,
        label: `${module.label} block`,
        cost: module.capex,
        lifeYears: module.assetLifeYears,
      })),
    ]);

    // Capital charges on the asset lives, net of upfront support (e.g. an
    // ITC or grant, allocated by capexItems key); land at capital x r.
    const supportByKey = policy.upfrontSupportByCapexKey || {};
    const exploratoryDetails = grossExploratoryDetails.map(module => {
      const upfrontSupport = supportByKey[`exploratory-${module.id}`] || 0;
      const netCapex = Math.max(0, module.capex - upfrontSupport);
      return { ...module, upfrontSupport, netCapexAtClose: netCapex, annualizedCapex: netCapex * crf(rate, module.assetLifeYears) };
    });
    const annualizedCapex = {
      ...Object.fromEntries(coreAssets.map(asset => [
        asset.key,
        asset.active
          ? Math.max(0, asset.capex - (supportByKey[asset.key] || 0)) * (asset.perpetual ? Math.max(0, rate) : crf(rate, asset.lifeYears))
          : 0,
      ])),
      exploratory: exploratoryDetails.reduce((sum, module) => sum + module.annualizedCapex, 0),
    };

    const batteryOmFrac = state.batteryOmPercent / 100;
    const processOmFrac = state.processOmPercent / 100;
    const exploratoryAnnualOM = exploratoryDetails.reduce((sum, module) => sum + module.annualOM, 0);
    const annualOM = solar.annualSolarOm +
      (storage.capex * batteryOmFrac) +
      (ai.annualOM || 0) +
      ((electrolyzer.capex + dac.capex + sabatier.capex + methanol.capex + feedBuffers.capex) * processOmFrac) +
      exploratoryAnnualOM;

    const methaneSalePrice = state.methanePrice;
    const revenue = {
      ai: ai.enabled ? ai.annualRevenue : 0,
      methane: sabatier.enabled ? sabatier.ch4AnnualMCF * methaneSalePrice : 0,
      methanol: methanol.enabled ? methanol.exportAnnualTons * state.methanolPrice : 0,
      exploratory: exploratoryDetails.reduce((sum, module) => sum + module.annualRevenue, 0),
      policyCredits: policy.total,
    };

    const totalAnnualRevenue = Object.values(revenue).reduce((sum, value) => sum + value, 0);
    const annualizedCapexTotal = Object.values(annualizedCapex).reduce((sum, value) => sum + value, 0);
    // Levelized over the analysis horizon N: an annuity with the same present
    // value. The capital charge covers net CAPEX at close plus discounted
    // replacements minus discounted salvage, so levelized profit equals
    // NPV x CRF(r, N) exactly. The per-asset CRF build above (asset lives)
    // is kept as the cost breakdown; the difference is replacement timing,
    // salvage and the horizon.
    const horizonCrf = crf(rate, horizonYears);
    const discountFactor = year => Math.pow(1 + rate, -year);
    const pvReplacements = replacementSchedule.entries.reduce((sum, entry) => sum + (entry.total * discountFactor(entry.year)), 0);
    const pvSalvage = replacementSchedule.salvage.total * discountFactor(horizonYears);
    const levelizedCapitalCharge = (netCapexAtClose + pvReplacements - pvSalvage) * horizonCrf;
    const annualCost = levelizedCapitalCharge + annualOM;
    const { yearlyCashFlows, npv, equityNpv } = buildYearlyCashFlows({
      horizonYears,
      rate,
      revenue,
      annualOM,
      annualCost,
      replacementSchedule,
      financing,
      netCapexAtClose,
      policy,
      yearFactors: this.getYearlyEnergyFactors(state, lifetimeEnergy, policy),
    });
    const returns = summarizeReturns({
      rate, horizonCrf, netCapexAtClose, financing, yearlyCashFlows, totalAnnualRevenue, annualCost, totalCapex, policy,
    });

    // Power cost for the unit-cost cascade: same capital basis as the rest
    // of the economics, annualized net of any upfront support (e.g. a 48E
    // ITC), land at capital x r.
    const solarLandAnnualCost = annualizedCapex.solar + annualizedCapex.land + solar.annualSolarOm;
    const batteryAnnualCost = annualizedCapex.battery + (storage.capex * batteryOmFrac);
    // Buffered LCOE is a technology cost like the solar LCOE: gross of
    // incentives (solar.annualizedSolar includes land x r; the storage
    // charge is its gross capex x CRF over the battery life). Its energy is
    // the delivered (chemical + AI-served) energy levelized with the
    // lifetime-energy factors over the horizon, like the unit costs, so
    // clipping that shrinks as the array degrades is counted.
    const bufferedElectricityAnnualCost = (solar.annualizedSolar || 0) + solar.annualSolarOm +
      (storage.annualizedCapex || 0) + (storage.capex * batteryOmFrac);
    const bufferedElectricityAnnualDeliveredMWh = (
      ai.enabled
        ? ((ai.annualAiServedKWh || 0) + (ai.chemicalAnnualKWh || 0))
        : ((chemicalSupply.dailyAvailableKWh || 0) * (solar.cyclesPerYear || 0))
    ) / 1000;
    const deliveredKWhByYear = (lifetimeEnergy?.chemicalKWhByYear || []).map(
      (chemicalKWh, index) => chemicalKWh + (ai.enabled ? (lifetimeEnergy.aiServedKWhByYear?.[index] || 0) : 0)
    );
    const deliveredFactorByYear = deliveredKWhByYear.map(value => (deliveredKWhByYear[0] > 0 ? value / deliveredKWhByYear[0] : 1));
    const bufferedElectricityLevelizedAnnualMWh = bufferedElectricityAnnualDeliveredMWh *
      getLevelizedOutputFactor(deliveredFactorByYear, rate, horizonYears);
    const bufferedElectricityCostPerMWh = bufferedElectricityLevelizedAnnualMWh > 0
      ? bufferedElectricityAnnualCost / bufferedElectricityLevelizedAnnualMWh
      : 0;

    const unitCosts = this.allocateUnitCosts(state, {
      annualizedCapex,
      solarLandAnnualCost,
      batteryAnnualCost,
      exploratoryAnnualCost: annualizedCapex.exploratory + exploratoryAnnualOM,
      ai,
      electrolyzer,
      dac,
      sabatier,
      methanol,
      feedBuffers,
      allocation,
      lifetimeEnergy,
      rate,
    });
    const aiCoreAnnualCost = unitCosts.aiAnnualCost;
    // Tokens follow the AI-served energy over the years, levelized like the
    // chemical outputs.
    const levelizedAnnualTokensM = ai.enabled
      ? (ai.annualTokensM || 0) * getLevelizedOutputFactor(lifetimeEnergy?.aiServedFactorByYear, rate, horizonYears)
      : 0;
    const costPerMToken = levelizedAnnualTokensM > 0 ? aiCoreAnnualCost / levelizedAnnualTokensM : 0;

    return {
      ...returns,
      capex,
      capexItems,
      annualizedCapex,
      totalCapex,
      netCapexAtClose,
      annualOM,
      annualCost,
      levelizedAnnualCost: annualCost,
      levelizedCapitalCharge,
      assetLifeAnnualCost: annualizedCapexTotal + annualOM,
      capitalChargeTimingAdjustment: levelizedCapitalCharge - annualizedCapexTotal,
      levelizedAnnualProfit: returns.annualProfit,
      horizonCrf,
      annualizedCapexTotal,
      annualOperatingCashFlow: totalAnnualRevenue - annualOM,
      revenue,
      totalAnnualRevenue,
      replacementSchedule: replacementSchedule.entries,
      totalReplacementOutflows: replacementSchedule.total,
      salvageValue: replacementSchedule.salvage.total,
      salvageItems: replacementSchedule.salvage.items,
      methaneSalePrice,
      policy,
      npv,
      equityNpv,
      discountRatePercent: state.discountRate,
      yearlyCashFlows,
      aiCoreAnnualCost,
      bufferedElectricityAnnualCost,
      bufferedElectricityAnnualDeliveredMWh,
      bufferedElectricityLevelizedAnnualMWh,
      bufferedElectricityCostPerMWh,
      costPerMToken,
      tokenMarginPerM: costPerMToken > 0 ? (state.aiTokenPricePerM || 0) - costPerMToken : 0,
      unitCosts,
      costPerKgH2: unitCosts.costPerKgH2,
      costPerTonCO2: unitCosts.costPerTonCO2,
      costPerMCF: unitCosts.costPerMCF,
      costPerTonMethanol: unitCosts.costPerTonMethanol,
      feedBuffers,
      exploratoryDetails,
      modeledExploratoryModules: exploratoryDetails.map(module => module.label),
      excludedModules: [],
    };
  },

  /* CO2 accounting without double counting. Captured CO2 is either bound
     in products or vented; carbon bound in a fuel returns to air when the
     fuel is burned, so capture itself is not avoidance. Net avoided is the
     fossil combustion CO2 the fuels displace (methane at 0.0528 t/MCF, i.e.
     19.25 kg CH4 x 44/16; methanol and MTG hydrocarbons by their carbon),
     excluding upstream emissions and methane leakage. Nothing is stored
     permanently in this plant. Exploratory non-fuel routes are reported in
     "bound" but not credited as avoided. */
  calculateEnvironmental(solar, dac, sabatier, methanol, electrolyzer, context = {}) {
    const { exploratoryModules = [], co2Surplus = 0 } = context;
    const cyclesPerYear = solar?.cyclesPerYear || 0;
    const toTonsPerYear = dailyKg => (dailyKg * cyclesPerYear) / 1000;
    const co2Captured = dac.enabled ? dac.co2AnnualTons : 0;
    const exploratoryCo2DailyKg = exploratoryModules.reduce((sum, module) => sum + (module.co2Consumed || 0), 0);
    const co2BoundInProducts = toTonsPerYear((sabatier.co2Consumed || 0) + (methanol.co2Consumed || 0) + exploratoryCo2DailyKg);
    const co2Vented = dac.enabled ? toTonsPerYear(co2Surplus) : 0;
    const methaneDisplaced = sabatier.enabled
      ? sabatier.ch4AnnualMCF * MODEL_ASSUMPTIONS.fossilGasEmissionsPerMCF
      : 0;
    // All methanol carbon (exported, or converted to MTG hydrocarbons)
    // displaces the same fossil carbon: 1.374 t CO2 per t methanol.
    const methanolDisplaced = methanol.enabled
      ? toTonsPerYear(methanol.reactorDailyKg * CHEMISTRY.methanol.co2MassPerKgMeOH)
      : 0;
    const co2NetAvoided = methaneDisplaced + methanolDisplaced;
    // Feed water incl. purification rejects, not just the stoichiometric 9 kg/kg.
    const waterConsumedDaily = electrolyzer.enabled ? (electrolyzer.feedWaterDailyKg ?? electrolyzer.waterDailyKg) : 0;
    const waterProducedDaily = (sabatier.waterProducedDaily || 0) + (methanol.waterProducedDaily || 0);

    return {
      co2Captured,
      co2BoundInProducts,
      co2Vented,
      co2Displaced: co2NetAvoided,
      co2NetAvoided,
      waterConsumedDaily,
      waterRecycledDaily: waterProducedDaily,
      waterProducedDaily,
      netWaterDaily: Math.max(0, waterConsumedDaily - waterProducedDaily),
      landAcres: solar.acres,
    };
  },
};
