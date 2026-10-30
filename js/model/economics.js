/* ============================================
   Project economics and environmental summary
   ============================================
   Capex, O&M, revenue, policy support, yearly cash flows, NPV/IRR/payback,
   and levelized cost metrics for a computed scenario. */

import { MODEL_ASSUMPTIONS } from '../data/assumptions.js';
import { CHEMISTRY } from '../data/reference-data.js';
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
  getPolicyDurationFactor,
  getSolarFactorForYear,
} from './finance.js';
import { ModuleCatalog } from './module-catalog.js';
import { PolicyModel, allocateUpfrontSupport } from './policy.js';

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
    const processOmFrac = (state.processOmPercent ?? DEFAULT_STATE.processOmPercent) / 100;
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
      costPerTonMethanol: perUnit(methanolAnnualCost, methanol.enabled ? (methanol.reactorAnnualTons ?? methanol.annualTons) : 0),
    };
  },

  calculateEconomics(state, context) {
    const {
      solar, storage, chemicalSupply, ai, electrolyzer, dac, sabatier, methanol,
      exploratoryModules, lifetimeEnergy, h2Surplus = 0, co2Surplus = 0,
      feedBuffers = { capex: 0 }, allocation = null,
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
      {
        key: 'feedBuffers',
        label: 'Feed buffer storage',
        capex: feedBuffers.capex || 0,
        lifeYears: MODEL_ASSUMPTIONS.feedBufferAssetLifeYears,
        active: true,
      },
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
    const qualifying = this.getQualifyingOutput({ solar, chemicalSupply, electrolyzer, dac, h2Surplus, co2Surplus, lifetimeEnergy });
    const policy = this.getPolicyCredits(state, {
      solar,
      electrolyzer,
      dac,
      capex,
      qualifying,
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
      ((electrolyzer.capex + dac.capex + sabatier.capex + methanol.capex + (feedBuffers.capex || 0)) * processOmFrac) +
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
    // Levelized over the analysis horizon N: an annuity with the same present
    // value. The capital charge covers net CAPEX at close plus discounted
    // replacements minus discounted salvage, so levelized profit equals
    // NPV x CRF(r, N) exactly. The per-asset CRF build above (asset lives)
    // is kept as the cost breakdown; the difference is replacement timing,
    // salvage and the horizon.
    const horizonYears = state.analysisHorizonYears;
    const horizonCrf = crf(rate, horizonYears);
    const discountFactor = year => Math.pow(1 + rate, -year);
    const pvReplacements = replacementSchedule.entries.reduce((sum, entry) => sum + (entry.total * discountFactor(entry.year)), 0);
    const pvSalvage = replacementSchedule.salvage.total * discountFactor(horizonYears);
    const levelizedCapitalCharge = (netCapexAtClose + pvReplacements - pvSalvage) * horizonCrf;
    const assetLifeAnnualCost = annualizedCapexTotal + annualOM;
    const annualCost = levelizedCapitalCharge + annualOM;
    const annualOperatingCashFlow = totalAnnualRevenue - annualOM;
    const yearlyCashFlows = [];
    let npv = -netCapexAtClose;
    let equityNpv = -financing.equityUpfront;
    let sponsorSupportTotal = 0;
    let peakSponsorSupport = 0;
    let peakSponsorSupportYear = null;
    const uncoveredDebtServiceYears = [];
    const dscrValues = [];
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
        scheduledDebtService: 0,
        balloonPayment: 0,
      };
      const equityCashFlow = netCashFlow - debtEntry.debtService;
      // Cash available for debt service (CFADS) is operating cash before
      // major replacement CAPEX: lenders fund repowerings and battery swaps
      // from reserve / maintenance accounts, not from the year's debt
      // cover, so a replacement year no longer reads as DSCR -2x. DSCR uses
      // the scheduled payment; a horizon balloon is repaid from final-year
      // cash including salvage. The replacement still hits equity cash: any
      // negative equity year after close, whether from debt service or a
      // replacement, needs extra sponsor cash.
      const cashAvailableForDebtService = operatingCashFlow;
      const scheduledDebtService = debtEntry.scheduledDebtService ?? debtEntry.debtService;
      const dscr = financing.enabled && scheduledDebtService > 1e-9
        ? cashAvailableForDebtService / scheduledDebtService
        : null;
      if (dscr !== null) dscrValues.push({ year, dscr });
      const sponsorSupportNeeded = financing.enabled ? Math.max(0, -equityCashFlow) : 0;
      if (sponsorSupportNeeded > 1e-9) {
        sponsorSupportTotal += sponsorSupportNeeded;
        uncoveredDebtServiceYears.push(year);
        if (sponsorSupportNeeded > peakSponsorSupport) {
          peakSponsorSupport = sponsorSupportNeeded;
          peakSponsorSupportYear = year;
        }
      }
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
        balloonPayment: debtEntry.balloonPayment || 0,
        cashAvailableForDebtService,
        dscr,
        sponsorSupportNeeded,
        equityCashFlow,
        cumulativeEquityCash: cumulativeEquityAfter,
      });

      npv += netCashFlow / Math.pow(1 + rate, year);
      equityNpv += equityCashFlow / Math.pow(1 + rate, year);
    }

    const pvRevenue = yearlyCashFlows.reduce((sum, entry) => sum + (entry.totalRevenue * discountFactor(entry.year)), 0);
    const pvPolicyCredits = yearlyCashFlows.reduce((sum, entry) => sum + ((entry.revenue.policyCredits || 0) * discountFactor(entry.year)), 0);
    const levelizedAnnualRevenue = pvRevenue * horizonCrf;
    const levelizedPolicyCredits = pvPolicyCredits * horizonCrf;
    const annualProfit = levelizedAnnualRevenue - annualCost;
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
    // Payback counts cash actually earned: operating cash minus replacement
    // CAPEX, without the final-year salvage. Salvage is a book value at the
    // horizon, not cash recovered from operations; counting it let a short
    // horizon "pay back" in its last year on the residual value alone.
    // Infinity = not recovered within the horizon.
    const paybackCashFlows = yearlyCashFlows.map(entry => entry.netCashFlow - entry.salvageValue);
    const equityPaybackCashFlows = yearlyCashFlows.map(entry => entry.equityCashFlow - entry.salvageValue);
    const paybackYears = calculateSimplePaybackYears(netCapexAtClose, paybackCashFlows);
    const sustainedPaybackYears = calculateSustainedPaybackYears(netCapexAtClose, paybackCashFlows);
    const equityPaybackYears = calculateSimplePaybackYears(financing.equityUpfront, equityPaybackCashFlows);
    const sustainedEquityPaybackYears = calculateSustainedPaybackYears(financing.equityUpfront, equityPaybackCashFlows);
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
      minDscr: dscrValues.length ? Math.min(...dscrValues.map(entry => entry.dscr)) : null,
      minDscrYear: dscrValues.length
        ? dscrValues.reduce((min, entry) => (entry.dscr < min.dscr ? entry : min)).year
        : null,
      averageDscr: dscrValues.length
        ? dscrValues.reduce((sum, entry) => sum + entry.dscr, 0) / dscrValues.length
        : null,
      dscrBelowOneYears: dscrValues.filter(entry => entry.dscr < 1).map(entry => entry.year),
    };
    const cashFlowTimeline = buildCashFlowTimeline(totalCapex, financingSummary, yearlyCashFlows, policy);

    // Power cost for the unit-cost cascade: same capital basis as the rest
    // of the economics, annualized net of any upfront support (e.g. a 48E
    // ITC), land at capital x r.
    const solarLandAnnualCost = (annualizedCapex.solar || 0) + (annualizedCapex.land || 0) + solar.annualSolarOm;
    const batteryAnnualCost = (annualizedCapex.battery || 0) + (storage.capex * batteryOmFrac);
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
      getLevelizedOutputFactor(deliveredFactorByYear, rate, state.analysisHorizonYears);
    const bufferedElectricityCostPerMWh = bufferedElectricityLevelizedAnnualMWh > 0
      ? bufferedElectricityAnnualCost / bufferedElectricityLevelizedAnnualMWh
      : 0;

    const unitCosts = this.allocateUnitCosts(state, {
      annualizedCapex,
      solarLandAnnualCost,
      batteryAnnualCost,
      exploratoryAnnualCost: (annualizedCapex.exploratory || 0) + exploratoryAnnualOM,
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
      ? (ai.annualTokensM || 0) * getLevelizedOutputFactor(lifetimeEnergy?.aiServedFactorByYear, rate, state.analysisHorizonYears)
      : 0;
    const costPerMToken = levelizedAnnualTokensM > 0 ? aiCoreAnnualCost / levelizedAnnualTokensM : 0;

    return {
      capex,
      capexBreakdown,
      annualizedCapex,
      totalCapex,
      netCapexAtClose,
      annualOM,
      annualCost,
      levelizedAnnualCost: annualCost,
      levelizedCapitalCharge,
      assetLifeAnnualCost,
      capitalChargeTimingAdjustment: levelizedCapitalCharge - annualizedCapexTotal,
      levelizedAnnualRevenue,
      levelizedPolicyCredits,
      levelizedAnnualProfit: annualProfit,
      horizonCrf,
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
      ? toTonsPerYear((methanol.reactorDailyKg ?? methanol.dailyKg ?? 0) * CHEMISTRY.methanol.co2MassPerKgMeOH)
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
