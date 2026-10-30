/* ============================================
   Scenario orchestration
   ============================================
   Normalizes the state and runs the full pipeline: solar -> annual series ->
   dispatch (battery or AI) -> process allocation -> products -> economics.
   `fastMode` skips display-only series for the optimizer and IRR sweeps. */

import { MODEL_ASSUMPTIONS } from '../data/assumptions.js';
import { ModuleCatalog } from './module-catalog.js';
import { methanolExportFields } from './process.js';

export const scenarioMethods = {
  calculateScenario(state, options = {}) {
    const fastMode = Boolean(options.fastMode);
    const normalizedState = this.normalizeState(state);
    const exploratoryEnabled = ModuleCatalog.getExploratoryModules().some(
      module => Boolean(normalizedState[`${module.id}Enabled`])
    );
    const includeSeries = !fastMode;
    const includeSupportedModules = !fastMode;
    const includeExploratoryModules = !fastMode || exploratoryEnabled;
    const includeEnvironmental = !fastMode;
    const solarModel = this.calculateSolar(normalizedState);
    // The annual hourly dispatch is the single basis for delivered energy,
    // clipping, operating hours and sizing in every mode (Earth year; Mars
    // orbital year, annualized; Moon repeated local cycle).
    const annualSolar = this.buildAnnualSolarSeries(normalizedState, solarModel, {
      includeWindowSummaries: includeSeries,
    });
    const dispatchBasis = this.getAnnualDispatchBasis(normalizedState, solarModel, annualSolar, {
      includeWindowSummaries: includeSeries,
    });
    const solar = this.reconcileSolarWithDispatchSeries(solarModel, dispatchBasis);
    const supply = normalizedState.aiComputeEnabled
      ? this.calculateAICompute(normalizedState, solar, annualSolar, {
          dispatchBasis,
          captureDispatchSeries: includeSeries,
          captureDailySummaries: true,
          includeDisplayDispatchSeries: includeSeries,
        })
      : this.calculateBattery(normalizedState, solar, annualSolar, {
          dispatchBasis,
          includeSeries,
        });
    const ai = normalizedState.aiComputeEnabled
      ? {
          ...supply,
          batterySeededMWh: this.getSeededAiBatteryMWh(state, normalizedState, solarModel.annualMWh),
        }
      : this.buildDisabledAiSummary(normalizedState);
    const { storage, chemicalSupply, lifetimeEnergy } = supply;
    const annualDispatch = supply.dispatch || null;
    const cyclesPerYear = this.getBodyConfig(normalizedState.body || 'earth').cyclesPerEarthYear;
    const effectiveDailyKWh = chemicalSupply.dailyAvailableKWh;
    const dailyChemicalKWh = Array.isArray(annualDispatch?.dailyChemicalKWh) ? annualDispatch.dailyChemicalKWh : [];
    const peakChemicalDailyKWh = dailyChemicalKWh.length
      ? Math.max(...dailyChemicalKWh, 0)
      : effectiveDailyKWh;
    const peakDayScale = effectiveDailyKWh > 0 && peakChemicalDailyKWh > 0
      ? Math.max(1, peakChemicalDailyKWh / effectiveDailyKWh)
      : 1;
    const effectivePeakKW = chemicalSupply.processPowerKW;
    const peakSizingKW = Math.max(
      effectivePeakKW,
      Number.isFinite(annualDispatch?.chemicalPeakKW) ? annualDispatch.chemicalPeakKW : 0
    );
    const opHours = chemicalSupply.dailyOpHours;
    const allocationPlan = this.buildProcessAllocationPlan(normalizedState);
    const allocation = this.getAllocationFromPlan(allocationPlan);
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
      allocationPlan
    );

    const { sabatier, methanol: reactorMethanol } = productFlow.outputs;
    const exploratoryModules = includeExploratoryModules
      ? this.calculateExploratoryModules(normalizedState, {
          allocationPlan,
          dailyFeedsKg: {
            h2Kg: electrolyzer.h2DailyKg || 0,
            co2Kg: dac.co2DailyKg || 0,
            methanolKg: reactorMethanol.reactorDailyKg,
          },
          peakFeedsKgPerHour: {
            h2Kg: normalizedState.electrolyzerEnabled
              ? (peakSizingKW * allocation.electrolyzer) / normalizedState.electrolyzerEfficiency
              : 0,
            co2Kg: normalizedState.dacEnabled
              ? ((peakSizingKW * allocation.dac) / normalizedState.dacEnergy) * 1000
              : 0,
            methanolKg: reactorMethanol.designHourlyOutputKg * (
              reactorMethanol.bufferEnabled
                ? 1
                : (effectivePeakKW > 0 ? peakSizingKW / effectivePeakKW : 1)
            ),
          },
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
    const methanol = reactorMethanol.enabled
      ? { ...reactorMethanol, ...methanolExportFields(Math.max(0, reactorMethanol.reactorDailyKg - exploratoryMethanolConsumed), cyclesPerYear) }
      : reactorMethanol;
    const feedBuffers = this.calculateFeedBufferStorage(normalizedState, [sabatier, methanol, ...exploratoryModules]);
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
      feedBuffers,
      allocation,
      lifetimeEnergy,
    });
    const environmental = includeEnvironmental
      ? this.calculateEnvironmental(solar, dac, sabatier, methanol, electrolyzer, { exploratoryModules, co2Surplus })
      : null;

    return {
      state: normalizedState,
      solar,
      annualSolar,
      storage,
      chemicalSupply,
      ai,
      annualDispatch,
      lifetimeEnergy,
      warnings: [...(solar.warnings || [])],
      allocation,
      electrolyzer,
      dac,
      sabatier,
      methanol,
      supportedModules: includeSupportedModules ? [sabatier, methanol] : [],
      exploratoryModules,
      feedBuffers,
      economics,
      environmental,
      h2Surplus,
      co2Surplus,
      effectiveDailyKWh,
      opHours,
    };
  },

  /* AI sizing needs storage, so normalizeState seeds a battery when AI is
     enabled with none. Report the seeded size (also once the UI has written
     it back into its state) so the UI can say where the battery came from. */
  getSeededAiBatteryMWh(rawState, normalizedState, annualSolarMWh) {
    if (!normalizedState.aiComputeEnabled) return 0;
    const batteryMWh = normalizedState.batteryCapacityMWh || 0;
    const requested = Number(rawState?.batteryCapacityMWh);
    if (!(Number.isFinite(requested) && requested > 1e-9)) return batteryMWh;
    const seedMWh = (Math.max(0, annualSolarMWh || 0) / 1000) * MODEL_ASSUMPTIONS.aiBatterySeedMWhPerSolarGWh;
    return seedMWh > 0 && Math.abs(batteryMWh - seedMWh) <= seedMWh * 1e-9 ? batteryMWh : 0;
  },

  calculateAll(state) {
    return this.calculateScenario(state);
  },

  calculateIrr(state) {
    return this.calculateScenario(state, { fastMode: true }).economics.irr;
  },

  /* Headline return metrics for the optimizer (fast path): IRR (NaN when
     there is no single meaningful root), MIRR and NPV. */
  calculateReturnMetrics(state) {
    const economics = this.calculateScenario(state, { fastMode: true }).economics;
    return { irr: economics.irr, mirr: economics.mirr, npv: economics.npv };
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
