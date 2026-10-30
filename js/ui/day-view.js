/* Earth "Specific Day" display: slices the annual hourly dispatch down to the selected day */

import { SolarGeometry } from '../model/solar-geometry.js';

const HOURS_PER_DAY = 24;

const sumSeries = series => series.reduce((sum, value) => sum + (Number(value) || 0), 0);
const orZeroDay = series => (series.length === HOURS_PER_DAY ? series : new Array(HOURS_PER_DAY).fill(0));

export const dayViewMethods = {
  getSelectedEarthDayIndex() {
    return Math.max(0, Math.min(364, (this.state.dayOfYear || 1) - 1));
  },

  getSelectedDayLabel() {
    return `${SolarGeometry.dayToDateString(this.state.dayOfYear)}${SolarGeometry.notableDay(this.state.dayOfYear)}`;
  },

  sliceSelectedEarthDaySeries(series) {
    if (!Array.isArray(series) || !series.length) return [];
    const start = this.getSelectedEarthDayIndex() * HOURS_PER_DAY;
    const slice = series.slice(start, start + HOURS_PER_DAY);
    return slice.length === HOURS_PER_DAY ? slice : [];
  },

  getDisplaySolarGeometry(r = this.lastResults) {
    if (r?.solar?.bodyKey === 'earth' && this.state.dayMode === 'specific') {
      return SolarGeometry.dailyProfile(this.state.latitude, this.state.dayOfYear, this.state.mountingType, r.solar.skyModel || {});
    }
    return r?.solar?.solarGeo || null;
  },

  /** Hourly series for the selected Earth day, or null outside Earth specific-day mode. */
  getSelectedDayDisplayContext(r = this.lastResults) {
    if (!r || r.solar.bodyKey !== 'earth' || this.state.dayMode !== 'specific') return null;

    const solarHourlyKW = this.sliceSelectedEarthDaySeries(r.annualSolar?.hourlyKW);
    if (solarHourlyKW.length !== HOURS_PER_DAY) return null;

    const dispatch = r.annualDispatch;
    if (!dispatch) return null;

    const chemicalHourlyKW = this.sliceSelectedEarthDaySeries(dispatch.chemicalHourlyKW);
    if (chemicalHourlyKW.length !== HOURS_PER_DAY) return null;

    const aiHourlyKW = r.ai.enabled ? this.sliceSelectedEarthDaySeries(dispatch.aiHourlyKW) : [];

    return {
      selectedDayIndex: this.getSelectedEarthDayIndex(),
      selectedDayLabel: this.getSelectedDayLabel(),
      solarHourlyKW,
      aiHourlyKW,
      batteryChargeHourlyKW: orZeroDay(this.sliceSelectedEarthDaySeries(dispatch.batteryChargeHourlyKW)),
      chemicalHourlyKW,
      clippedHourlyKW: orZeroDay(this.sliceSelectedEarthDaySeries(dispatch.clippedHourlyKW)),
      aiDailyKWh: aiHourlyKW.length === HOURS_PER_DAY ? sumSeries(aiHourlyKW) : 0,
      chemicalDailyKWh: sumSeries(chemicalHourlyKW),
    };
  },

  /** Results with daily flows rescaled to the selected day, for the system diagram. */
  buildDiagramDisplayResults(r = this.lastResults) {
    const displayContext = this.getSelectedDayDisplayContext(r);
    if (!displayContext) return r;

    const baseDailyKWh = Math.max(0, r.effectiveDailyKWh || 0);
    const dailyScale = baseDailyKWh > 1e-9 ? displayContext.chemicalDailyKWh / baseDailyKWh : 0;
    const scaleMetric = value => Number.isFinite(value) ? value * dailyScale : value;
    const scaleFields = (module, fields) => {
      if (!module) return module;
      const scaled = { ...module };
      fields.forEach(field => {
        scaled[field] = scaleMetric(module[field]);
      });
      return scaled;
    };
    const scaleSupportedModule = module => scaleFields(module, [
      'ch4DailyKg', 'ch4DailyMCF', 'h2Consumed', 'co2Consumed', 'waterProducedDaily',
      'dailyKg', 'reactorDailyKg', 'dailyLiters', 'reactorDailyLiters', 'exportDailyKg',
    ]);
    const scaleExploratoryModule = module => scaleFields(module, [
      'dailyKWh', 'outputDailyUnits', 'h2Consumed', 'co2Consumed', 'methanolConsumed',
    ]);
    const aiUtilization = r.ai.enabled && r.ai.designLoadKW > 0
      ? Math.max(0, Math.min(1, displayContext.aiDailyKWh / (r.ai.designLoadKW * HOURS_PER_DAY)))
      : r.ai.utilization;

    return {
      ...r,
      ai: r.ai.enabled ? { ...r.ai, utilization: aiUtilization } : r.ai,
      electrolyzer: scaleFields(r.electrolyzer, ['dailyKWh', 'h2DailyKg', 'waterDailyKg', 'feedWaterDailyKg']),
      dac: scaleFields(r.dac, ['dailyKWh', 'co2DailyKg']),
      sabatier: scaleSupportedModule(r.sabatier),
      methanol: scaleSupportedModule(r.methanol),
      supportedModules: (r.supportedModules || []).map(scaleSupportedModule),
      exploratoryModules: (r.exploratoryModules || []).map(scaleExploratoryModule),
      h2Surplus: scaleMetric(r.h2Surplus),
      co2Surplus: scaleMetric(r.co2Surplus),
    };
  },

  refreshDaySpecificViews() {
    this.syncPlanetaryUI();
    if (!this.lastResults) {
      this.recalculate();
      return;
    }
    this.updateInfoDisplays(this.lastResults);
    this.updateDiagram(this.lastResults);
    this.updatePowerChart(this.lastResults);
    this.scheduleShareStateUrlSync();
  },
};
