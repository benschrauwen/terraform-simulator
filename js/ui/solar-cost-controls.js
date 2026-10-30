/* Solar cost basis select: applies a preset's module and BOS price, and shows
   which preset (if any) the current sliders match, like the equipment presets. */

import { SOLAR_COST_PRESETS, getSolarCostPresetValues } from '../data/reference-data.js';

export const solarCostControlMethods = {
  /** Preset whose module and BOS prices match the current state, else 'custom'. */
  getSelectedSolarCostPreset(state = this.state) {
    const match = Object.keys(SOLAR_COST_PRESETS).find(presetId => {
      const values = getSolarCostPresetValues(presetId, state.mountingType);
      return Math.abs(state.panelCostPerW - values.panelCostPerW) <= 1e-6
        && Math.abs(state.bosCostPerW - values.bosCostPerW) <= 1e-6;
    });
    return match || 'custom';
  },

  bindSolarCostPresetControl() {
    this.on('solarCostPreset', 'change', value => {
      if (value === 'custom') {
        this.syncSolarCostPresetControl();
        return;
      }
      Object.assign(this.state, getSolarCostPresetValues(value, this.state.mountingType));
      this.syncStateToControls();
    });
  },

  syncSolarCostPresetControl() {
    const select = document.getElementById('solarCostPreset');
    if (select) select.value = this.getSelectedSolarCostPreset();
  },
};
