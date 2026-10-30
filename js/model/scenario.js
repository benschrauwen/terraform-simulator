/* ============================================
   Scenario orchestration
   ============================================
   Normalizes the state and runs the full pipeline: solar -> annual series ->
   dispatch (battery or AI) -> process allocation -> products -> economics.
   `fastMode` skips display-only series for the optimizer and IRR sweeps. */

import { CHEMISTRY } from '../data/reference-data.js';
import { ModuleCatalog } from './module-catalog.js';

export const scenarioMethods = {
  calculateScenario(state, options = {}) {
    const fastMode = Boolean(options.fastMode);
    const normalizedState = this.normalizeState(state);
    const exploratoryEnabled = ModuleCatalog.getExploratoryModules().some(
      module => Boolean(normalizedState[`${module.id}Enabled`])
    );
    const bufferedModuleEnabled = ModuleCatalog.getAll().some(module => {
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
};
