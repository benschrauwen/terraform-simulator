/* ============================================
   Process chain
   ============================================
   Power/feed allocation across modules, electrolyzer and DAC output, the
   supported H2 + CO2 reactors (Sabatier methane, methanol), and the generic
   exploratory routes driven by data/modules.js. */

import { MODEL_ASSUMPTIONS } from '../data/assumptions.js';
import { CHEMISTRY } from '../data/reference-data.js';
import { DEFAULT_STATE } from '../state/schema.js';
import { ModuleCatalog } from './module-catalog.js';
import { clampNumber } from './util.js';

/* Sizes a two-feed (H2 + CO2) catalytic reactor. `h2PerKg` / `co2PerKg` are
   the kg of each feed per kg of product and `conversion` the yield fraction.
   Daily quantities are per cycle (day, sol, lunar cycle). Without a feed
   buffer the reactor is sized for the hourly peak feed; with one, for the
   cycle-average feed of the peak day, running the whole cycle. */
function sizeTwoFeedReactor({
  h2PerKg,
  co2PerKg,
  conversion,
  bufferEnabled,
  cycleHours,
  opHours,
  h2AvailableKg,
  co2AvailableKg,
  peakH2SizingKgPerHour,
  peakCO2SizingKgPerHour,
  peakH2DailyKg,
  peakCO2DailyKg,
}) {
  const productFromH2 = h2AvailableKg / h2PerKg;
  const productFromCO2 = co2AvailableKg / co2PerKg;
  const grossDailyKg = Math.min(productFromH2, productFromCO2);
  const dailyKg = grossDailyKg * conversion;
  const peakProductFromH2 = peakH2SizingKgPerHour / h2PerKg;
  const peakProductFromCO2 = peakCO2SizingKgPerHour / co2PerKg;
  const sizingPeakH2DailyKg = Math.max(h2AvailableKg, Number.isFinite(peakH2DailyKg) ? peakH2DailyKg : 0);
  const sizingPeakCO2DailyKg = Math.max(co2AvailableKg, Number.isFinite(peakCO2DailyKg) ? peakCO2DailyKg : 0);
  const bufferedPeakProductFromH2 = cycleHours > 0
    ? (sizingPeakH2DailyKg / cycleHours) / h2PerKg
    : 0;
  const bufferedPeakProductFromCO2 = cycleHours > 0
    ? (sizingPeakCO2DailyKg / cycleHours) / co2PerKg
    : 0;
  const designGrossKgPerHour = bufferEnabled
    ? Math.min(bufferedPeakProductFromH2, bufferedPeakProductFromCO2)
    : Math.min(peakProductFromH2, peakProductFromCO2);
  const designH2FeedKgPerHour = designGrossKgPerHour * h2PerKg;
  const designCO2FeedKgPerHour = designGrossKgPerHour * co2PerKg;
  const designFeedKgPerHour = designH2FeedKgPerHour + designCO2FeedKgPerHour;
  const designHourlyOutputKg = designGrossKgPerHour * conversion;
  const designRunHours = bufferEnabled ? cycleHours : opHours;
  const grossDailyFeedKg = grossDailyKg * (h2PerKg + co2PerKg);
  const averageGrossFeedKgPerHour = designRunHours > 0
    ? grossDailyFeedKg / designRunHours
    : 0;
  const averageUtilization = designFeedKgPerHour > 0
    ? Math.min(1, (grossDailyFeedKg / cycleHours) / designFeedKgPerHour)
    : 0;
  const operatingUtilization = designFeedKgPerHour > 0
    ? Math.min(1, averageGrossFeedKgPerHour / designFeedKgPerHour)
    : 0;

  // Buffered reactors run at a constant rate across the cycle while feed
  // arrives only during operating hours. With feed flat over opHours, the
  // largest inventory is the peak-day feed x (1 - opHours / cycleHours).
  const bufferFraction = bufferEnabled && cycleHours > 0
    ? Math.max(0, Math.min(1, 1 - (opHours / cycleHours)))
    : 0;

  return {
    productFromH2,
    productFromCO2,
    dailyKg,
    bufferH2Kg: sizingPeakH2DailyKg * bufferFraction,
    bufferCO2Kg: sizingPeakCO2DailyKg * bufferFraction,
    designH2FeedKgPerHour,
    designCO2FeedKgPerHour,
    designFeedKgPerHour,
    designHourlyOutputKg,
    designRunHours,
    averageUtilization,
    operatingUtilization,
  };
}

export const processMethods = {
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

  getExploratoryPriorityWeight(state, moduleId) {
    return clampNumber(
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
      ? clampNumber(state.mtgMethanolSplit, 0, 100, DEFAULT_STATE.mtgMethanolSplit) / 100
      : 0;

    const exploratoryModules = ModuleCatalog.getExploratoryModules()
      .map(module => {
        const enabled = Boolean(state[`${module.id}Enabled`]);
        const route = state[`${module.id}Route`] || ModuleCatalog.getDefaultRoute(module) || 'unspecified';
        const routeConfig = this.getModuleRouteConfig(module.id, route);
        const priorityWeight = this.getExploratoryPriorityWeight(state, module.id);
        // MTG competes for no H2 or CO2: its throughput is the methanol
        // diverted to it, so its weight is those product units (methanol
        // weight x reactor conversion x diverted share / kg MeOH per unit),
        // not a priority. Weighting it by priority handed it power for up to
        // ~6x the gasoline its methanol can make.
        const methanolKgPerUnit = routeConfig?.feedstocks?.methanolKg || 0;
        const effectivePriorityWeight = enabled
          ? module.id === 'mtg'
            ? (methanolKgPerUnit > 0
                ? (supported.methanol * (clampNumber(state.methanolEfficiency, 0, 100, DEFAULT_STATE.methanolEfficiency) / 100) *
                  mtgMethanolSplit * 1000) / methanolKgPerUnit
                : 0)
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
    });

    // A consumer's weight is a share of gross product units, so its feed
    // demand is weight x kg of feed per unit. Splitting H2 and CO2 by that
    // same product (the one the electrolyzer/DAC power proxies below use)
    // hands every consumer its feeds in stoichiometric ratio; splitting by
    // weight alone strands whichever feed a consumer needs less of.
    const toFeedDemandEntries = consumers => consumers.map(consumer => ({
      id: consumer.id,
      weight: Math.max(0, consumer.weight || 0) * Math.max(0, consumer.inputKgPerUnit || 0),
    }));

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
    // Each route's power share is its own demand (weight x kWh per unit),
    // the same product its feed shares use, so power and feeds limit its
    // output at the same point. Splitting the route pool by weight alone
    // gave low-intensity routes power they had no feed for and starved
    // high-intensity ones, stranding their H2 / CO2.
    const exploratoryPowerShares = exploratoryModules.reduce((shares, module) => {
      shares[module.id] = totalPowerDemand > 0 ? (exploratoryPowerDemandProxies[module.id] || 0) / totalPowerDemand : 0;
      return shares;
    }, {});

    return {
      label: exploratoryPowerDemand > 0 ? `${supported.label} + exploratory demand` : supported.label,
      supported,
      exploratoryModules,
      feedShares: {
        h2: this.buildWeightedShareMap(toFeedDemandEntries(h2Consumers)),
        co2: this.buildWeightedShareMap(toFeedDemandEntries(co2Consumers)),
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

  getBalancedAllocation(state) {
    return this.getAllocationFromPlan(this.buildProcessAllocationPlan(state));
  },

  /* The power-share view of an allocation plan used by the process blocks. */
  getAllocationFromPlan(allocationPlan) {
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
        feedWaterDailyKg: 0,
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
      feedWaterDailyKg: h2DailyKg * MODEL_ASSUMPTIONS.electrolysisFeedWaterPerKgH2,
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
        referenceCapacityTpy: 0,
        capex: 0,
      };
    }

    const allocKW = availablePowerKW * allocation.dac;
    const dailyDACKWh = dailyKWh * allocation.dac;
    const co2DailyKg = (dailyDACKWh / state.dacEnergy) * 1000;
    const co2AnnualKg = co2DailyKg * cyclesPerYear;
    const co2AnnualTons = co2AnnualKg / 1000;
    // Hardware is priced on nameplate (DAC peak kW), expressed as t/yr at the
    // reference utilization, not on the site's realized output.
    const referenceCapacityTpy = (allocKW * 8760 * MODEL_ASSUMPTIONS.dacCapexReferenceUtilization) / state.dacEnergy;

    return {
      enabled: true,
      allocKW,
      allocPct: allocation.dac * 100,
      dailyKWh: dailyDACKWh,
      co2DailyKg,
      co2AnnualKg,
      co2AnnualTons,
      referenceCapacityTpy,
      capex: referenceCapacityTpy * state.dacCapex,
    };
  },

  calculateSabatier(
    state,
    h2AvailableKg,
    co2AvailableKg,
    opHours,
    peakH2SizingKgPerHour = 0,
    peakCO2SizingKgPerHour = 0,
    peakH2DailyKg = h2AvailableKg,
    peakCO2DailyKg = co2AvailableKg
  ) {
    const body = this.getBodyConfig(state.body || 'earth');
    if (!state.sabatierEnabled || h2AvailableKg <= 0 || co2AvailableKg <= 0) {
      return {
        id: 'sabatier',
        enabled: false,
        bufferEnabled: false,
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
        designOutputKW: 0,
        designHourlyRate: 0,
        averageUtilization: 0,
        operatingUtilization: 0,
        bufferH2Kg: 0,
        bufferCO2Kg: 0,
        capex: 0,
      };
    }

    const c = CHEMISTRY.sabatier;
    const bufferEnabled = this.isModuleFeedBufferEnabled(state, 'sabatier');
    const reactor = sizeTwoFeedReactor({
      h2PerKg: c.h2MassPerKgCH4,
      co2PerKg: c.co2MassPerKgCH4,
      conversion: state.sabatierConversion / 100,
      bufferEnabled,
      cycleHours: body.cycleHours,
      opHours,
      h2AvailableKg,
      co2AvailableKg,
      peakH2SizingKgPerHour,
      peakCO2SizingKgPerHour,
      peakH2DailyKg,
      peakCO2DailyKg,
    });
    const ch4DailyKg = reactor.dailyKg;
    const designOutputKW = reactor.designHourlyOutputKg * c.ch4LhvKwhPerKg;
    const ch4DailyMCF = ch4DailyKg / c.ch4PerMCF;
    return {
      id: 'sabatier',
      enabled: true,
      bufferEnabled,
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
      designH2FeedKgPerHour: reactor.designH2FeedKgPerHour,
      designCO2FeedKgPerHour: reactor.designCO2FeedKgPerHour,
      designFeedKgPerHour: reactor.designFeedKgPerHour,
      designHourlyOutputKg: reactor.designHourlyOutputKg,
      designOutputKW,
      limitingReagent: reactor.productFromH2 < reactor.productFromCO2 ? 'H2' : 'CO2',
      hourlyRate: reactor.designRunHours > 0 ? ch4DailyMCF / reactor.designRunHours : 0,
      designHourlyRate: reactor.designHourlyOutputKg / c.ch4PerMCF,
      averageUtilization: reactor.averageUtilization,
      operatingUtilization: reactor.operatingUtilization,
      bufferH2Kg: reactor.bufferH2Kg,
      bufferCO2Kg: reactor.bufferCO2Kg,
      capex: state.sabatierCapex * designOutputKW,
    };
  },

  calculateMethanol(
    state,
    h2AvailableKg,
    co2AvailableKg,
    opHours,
    peakH2SizingKgPerHour = 0,
    peakCO2SizingKgPerHour = 0,
    peakH2DailyKg = h2AvailableKg,
    peakCO2DailyKg = co2AvailableKg
  ) {
    const body = this.getBodyConfig(state.body || 'earth');
    if (!state.methanolEnabled || h2AvailableKg <= 0 || co2AvailableKg <= 0) {
      return {
        id: 'methanol',
        enabled: false,
        bufferEnabled: false,
        modeled: false,
        title: 'Methanol',
        family: 'air-water-chemistry',
        maturity: 'Supported',
        dailyKg: 0,
        reactorDailyKg: 0,
        annualKg: 0,
        reactorAnnualKg: 0,
        annualTons: 0,
        reactorAnnualTons: 0,
        dailyLiters: 0,
        reactorDailyLiters: 0,
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
        bufferH2Kg: 0,
        bufferCO2Kg: 0,
        capex: 0,
      };
    }

    const c = CHEMISTRY.methanol;
    const bufferEnabled = this.isModuleFeedBufferEnabled(state, 'methanol');
    const reactor = sizeTwoFeedReactor({
      h2PerKg: c.h2MassPerKgMeOH,
      co2PerKg: c.co2MassPerKgMeOH,
      conversion: state.methanolEfficiency / 100,
      bufferEnabled,
      cycleHours: body.cycleHours,
      opHours,
      h2AvailableKg,
      co2AvailableKg,
      peakH2SizingKgPerHour,
      peakCO2SizingKgPerHour,
      peakH2DailyKg,
      peakCO2DailyKg,
    });
    const dailyKg = reactor.dailyKg;
    const annualKg = dailyKg * body.cyclesPerEarthYear;
    return {
      id: 'methanol',
      enabled: true,
      bufferEnabled,
      modeled: true,
      title: 'Methanol',
      family: 'air-water-chemistry',
      maturity: 'Supported',
      // reactor*: methanol leaving the reactor (after conversion losses);
      // daily/annual*: methanol exported after any MTG offtake (the
      // scenario lowers these once MTG consumption is known).
      dailyKg,
      reactorDailyKg: dailyKg,
      annualKg,
      reactorAnnualKg: annualKg,
      annualTons: annualKg / 1000,
      reactorAnnualTons: annualKg / 1000,
      dailyLiters: dailyKg / c.density,
      reactorDailyLiters: dailyKg / c.density,
      exportDailyKg: dailyKg,
      exportAnnualKg: annualKg,
      exportAnnualTons: annualKg / 1000,
      h2Consumed: dailyKg * c.h2MassPerKgMeOH,
      co2Consumed: dailyKg * c.co2MassPerKgMeOH,
      waterProducedDaily: dailyKg * c.waterPerKgMeOH,
      designH2FeedKgPerHour: reactor.designH2FeedKgPerHour,
      designCO2FeedKgPerHour: reactor.designCO2FeedKgPerHour,
      designFeedKgPerHour: reactor.designFeedKgPerHour,
      designHourlyOutputKg: reactor.designHourlyOutputKg,
      averageUtilization: reactor.averageUtilization,
      operatingUtilization: reactor.operatingUtilization,
      bufferH2Kg: reactor.bufferH2Kg,
      bufferCO2Kg: reactor.bufferCO2Kg,
      capex: state.methanolCapex * reactor.designFeedKgPerHour,
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
      (materialFlows.co2SizingPeakKgPerHour || 0) * (co2Shares.sabatier || 0),
      ((materialFlows.peakH2DailyKg ?? materialFlows.h2DailyKg) || 0) * (h2Shares.sabatier || 0),
      ((materialFlows.peakCO2DailyKg ?? materialFlows.co2DailyKg) || 0) * (co2Shares.sabatier || 0)
    );

    const methanol = this.calculateMethanol(
      state,
      (materialFlows.h2DailyKg || 0) * (h2Shares.methanol || 0),
      (materialFlows.co2DailyKg || 0) * (co2Shares.methanol || 0),
      opHours,
      (materialFlows.h2SizingPeakKgPerHour || 0) * (h2Shares.methanol || 0),
      (materialFlows.co2SizingPeakKgPerHour || 0) * (co2Shares.methanol || 0),
      ((materialFlows.peakH2DailyKg ?? materialFlows.h2DailyKg) || 0) * (h2Shares.methanol || 0),
      ((materialFlows.peakCO2DailyKg ?? materialFlows.co2DailyKg) || 0) * (co2Shares.methanol || 0)
    );

    return {
      supportedModules: includeSupportedModules ? [sabatier, methanol] : [],
      outputs: { sabatier, methanol },
      h2Remaining: Math.max(0, (materialFlows.h2DailyKg || 0) - (sabatier.h2Consumed || 0) - (methanol.h2Consumed || 0)),
      co2Remaining: Math.max(0, (materialFlows.co2DailyKg || 0) - (sabatier.co2Consumed || 0) - (methanol.co2Consumed || 0)),
    };
  },

  /* Feed-buffer storage: working H2 (kg) and CO2 (t) inventory of every
     buffered consumer, priced per unit of working capacity. */
  calculateFeedBufferStorage(state, consumers = []) {
    const h2WorkingKg = consumers.reduce((sum, consumer) => sum + (consumer?.bufferH2Kg || 0), 0);
    const co2WorkingTons = consumers.reduce((sum, consumer) => sum + (consumer?.bufferCO2Kg || 0), 0) / 1000;
    const h2Capex = h2WorkingKg * Math.max(0, Number(state.h2BufferCostPerKg) || 0);
    const co2Capex = co2WorkingTons * Math.max(0, Number(state.co2BufferCostPerTon) || 0);
    return {
      h2WorkingKg,
      co2WorkingTons,
      h2Capex,
      co2Capex,
      capex: h2Capex + co2Capex,
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

  calculateExploratoryPeakOutputRate(routeConfig, peakAllocKW, peakAllocations = {}) {
    if (!routeConfig || !Number.isFinite(peakAllocKW) || peakAllocKW <= 0) return 0;

    const limits = [];
    if (routeConfig.electricityKwhPerUnit > 0) {
      limits.push(peakAllocKW / routeConfig.electricityKwhPerUnit);
    }

    const feedstocks = routeConfig.feedstocks || {};
    if (feedstocks.h2Kg > 0) limits.push((peakAllocations.h2KgPerHour || 0) / feedstocks.h2Kg);
    if (feedstocks.co2Kg > 0) limits.push((peakAllocations.co2KgPerHour || 0) / feedstocks.co2Kg);
    if (feedstocks.methanolKg > 0) limits.push((peakAllocations.methanolKgPerHour || 0) / feedstocks.methanolKg);

    if (!limits.length) return 0;
    return Math.max(0, Math.min(...limits.filter(Number.isFinite)));
  },

  calculateExploratoryBufferedOutputRate(routeConfig, peakAllocKW, dailyAllocations = {}, cycleHours = 0) {
    if (!routeConfig || !Number.isFinite(cycleHours) || cycleHours <= 0) return 0;
    return this.calculateExploratoryPeakOutputRate(routeConfig, peakAllocKW, {
      h2KgPerHour: (dailyAllocations.h2Kg || 0) / cycleHours,
      co2KgPerHour: (dailyAllocations.co2Kg || 0) / cycleHours,
      methanolKgPerHour: (dailyAllocations.methanolKg || 0) / cycleHours,
    });
  },

  calculateExploratoryCapex(routeConfig, capexBasis, peakOutputUnitsPerHour, cycleHours, cyclesPerYear) {
    if (!routeConfig || peakOutputUnitsPerHour <= 0 || cycleHours <= 0 || cyclesPerYear <= 0) return 0;
    const cyclingPenalty = routeConfig.cyclingPenalty || 1;
    const baseCapex = Number.isFinite(capexBasis) ? capexBasis : (routeConfig.capexPerAnnualUnit || 0);
    // Capacity is priced on the hardware's nameplate rate, which does not
    // depend on the local day: $/m3/day is per 24 h of operation, $/t-yr per
    // Earth year (cycle hours x cycles per Earth year ~ 8,760 h on every
    // body). Pricing m3/day on one local cycle made lunar desalination
    // ~29.5x (708.7 h / 24 h) and Martian 2.75% too expensive.
    if (routeConfig.capexUnit === 'm3pd') {
      return peakOutputUnitsPerHour * 24 * baseCapex * cyclingPenalty;
    }

    const nameplateAnnualUnits = peakOutputUnitsPerHour * cycleHours * cyclesPerYear;
    return nameplateAnnualUnits * baseCapex * cyclingPenalty;
  },

  calculateExploratoryModules(state, context = {}) {
    const {
      allocationPlan,
      materialFlows = {},
      peakMaterialFlows = {},
      supportedOutputs = {},
      effectivePeakKW = 0,
      peakSizingKW = 0,
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
    const reactorMethanolDailyKg = supportedOutputs?.methanol?.reactorDailyKg || supportedOutputs?.methanol?.dailyKg || 0;
    const peakDayScale = effectiveDailyKWh > 0 && peakDailyKWh > 0
      ? Math.max(1, peakDailyKWh / effectiveDailyKWh)
      : 1;

    return ModuleCatalog.getExploratoryModules()
      .map(module => {
        const enabled = Boolean(state[`${module.id}Enabled`]);
        const route = state[`${module.id}Route`] || ModuleCatalog.getDefaultRoute(module) || 'unspecified';
        const routeConfig = this.getModuleRouteConfig(module.id, route);
        const capexBasis = Number(state[`${module.id}CapexBasis`]);
        const omPercent = Number(state.exploratoryOmPercent);
        const powerShare = allocationPlan?.powerShares?.exploratory?.[module.id] || 0;
        const allocKW = effectivePeakKW * powerShare;
        const peakAllocKW = Math.max(effectivePeakKW, peakSizingKW) * powerShare;
        const dailyKWh = effectiveDailyKWh * powerShare;
        const peakDayKWh = dailyKWh * peakDayScale;
        const bufferEnabled = this.isModuleFeedBufferEnabled(state, module.id, route);
        const allocations = {
          h2Kg: (materialFlows.h2DailyKg || 0) * (h2Shares[module.id] || 0),
          co2Kg: (materialFlows.co2DailyKg || 0) * (co2Shares[module.id] || 0),
          methanolKg: module.id === 'mtg' ? reactorMethanolDailyKg * (methanolShares.mtg || 0) : 0,
        };
        const peakDayAllocations = {
          h2Kg: allocations.h2Kg * peakDayScale,
          co2Kg: allocations.co2Kg * peakDayScale,
          methanolKg: allocations.methanolKg * peakDayScale,
        };
        const peakAllocations = {
          h2KgPerHour: (peakMaterialFlows.h2KgPerHour || 0) * (h2Shares[module.id] || 0),
          co2KgPerHour: (peakMaterialFlows.co2KgPerHour || 0) * (co2Shares[module.id] || 0),
          methanolKgPerHour: module.id === 'mtg' ? (peakMaterialFlows.methanolKgPerHour || 0) * (methanolShares.mtg || 0) : 0,
        };
        const outputDailyUnits = enabled
          ? this.calculateExploratoryOutputUnits(routeConfig, dailyKWh, allocations)
          : 0;
        const peakOutputUnitsPerHour = enabled
          ? this.calculateExploratoryPeakOutputRate(routeConfig, peakAllocKW, peakAllocations)
          : 0;
        const peakOutputDailyUnits = enabled
          ? this.calculateExploratoryOutputUnits(routeConfig, peakDayKWh, peakDayAllocations)
          : 0;
        const capexSizingOutputUnitsPerHour = enabled
          ? (
              bufferEnabled
                ? this.calculateExploratoryBufferedOutputRate(routeConfig, peakAllocKW, peakDayAllocations, cycleHours)
                : peakOutputUnitsPerHour
            )
          : 0;
        const annualOutputUnits = outputDailyUnits * cyclesPerYear;
        const realizedCapacityFactor = capexSizingOutputUnitsPerHour > 0 && cycleHours > 0
          ? Math.max(0, Math.min(1, outputDailyUnits / (capexSizingOutputUnitsPerHour * cycleHours)))
          : 0;
        // H2/CO2 inventory a buffered route holds (see sizeTwoFeedReactor);
        // methanol is a liquid and its tankage is treated as negligible.
        const bufferFraction = enabled && bufferEnabled && cycleHours > 0
          ? Math.max(0, Math.min(1, 1 - (opHours / cycleHours)))
          : 0;
        const h2Consumed = outputDailyUnits * (routeConfig?.feedstocks?.h2Kg || 0);
        const co2Consumed = outputDailyUnits * (routeConfig?.feedstocks?.co2Kg || 0);
        const methanolConsumed = outputDailyUnits * (routeConfig?.feedstocks?.methanolKg || 0);

        return {
          ...module,
          enabled,
          route,
          routeLabel: ModuleCatalog.getRouteOptions(module).find(option => option.value === route)?.label || route,
          routeConfig,
          modeled: enabled,
          bufferEnabled,
          excludedFromEconomics: false,
          allocKW,
          dailyKWh,
          realizedCapacityFactor,
          outputDailyUnits,
          peakOutputUnitsPerHour,
          capexSizingOutputUnitsPerHour,
          peakOutputDailyUnits,
          annualOutputUnits,
          outputLabel: routeConfig?.outputLabel || module.label,
          outputUnit: routeConfig?.outputUnit || 't',
          capex: this.calculateExploratoryCapex(
            routeConfig,
            capexBasis,
            capexSizingOutputUnitsPerHour,
            cycleHours,
            cyclesPerYear
          ),
          capexBasisUnit: routeConfig?.capexUnit || 'tpa',
          capexBasis: Number.isFinite(capexBasis) ? capexBasis : (routeConfig?.capexPerAnnualUnit || 0),
          omPercent: Number.isFinite(omPercent) ? omPercent : DEFAULT_STATE.exploratoryOmPercent,
          feedstockSummary: routeConfig?.feedstockSummary || 'Needs power',
          h2Consumed,
          co2Consumed,
          methanolConsumed,
          bufferH2Kg: peakDayAllocations.h2Kg * bufferFraction,
          bufferCO2Kg: peakDayAllocations.co2Kg * bufferFraction,
          diagramInputs: {
            electricity: true,
            ...(routeConfig?.diagramInputs || module.diagramInputs || {}),
          },
        };
      });
  },
};
