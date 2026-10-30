/* Site selection: location presets, saved "my sites", and manual location edits */

import { LOCATION_PRESETS } from '../data/reference-data.js';
import { Calc } from '../model/index.js';
import { SavedSitePresets } from '../state/saved-site-presets.js';
import { SOLAR_PROFILE_DEFAULTS_BY_BODY } from '../state/schema.js';
import { FormatNumbers } from './format-numbers.js';

function markLocationPresetCustom() {
  const locPresetEl = document.getElementById('locationPreset');
  if (locPresetEl) locPresetEl.value = 'custom';
}

export const siteControlMethods = {
  populateLocationPresetSelect() {
    const sel = document.getElementById('locationPreset');
    if (!sel) return;

    sel.innerHTML = '';

    const catalogGroup = document.createElement('optgroup');
    catalogGroup.label = 'Reference';
    LOCATION_PRESETS.forEach((loc, i) => {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = `${loc.name} (${FormatNumbers.fixed(loc.baseYield, 0)} MWh/MWdc-yr)`;
      catalogGroup.appendChild(opt);
    });
    sel.appendChild(catalogGroup);

    const saved = SavedSitePresets.list();
    if (saved.length) {
      const mine = document.createElement('optgroup');
      mine.label = 'My sites';
      saved.forEach(preset => {
        const opt = document.createElement('option');
        opt.value = SavedSitePresets.optionValueForId(preset.id);
        opt.textContent = `${preset.name} (${FormatNumbers.fixed(preset.siteYieldMwhPerMwdcYear, 0)} MWh/MWdc-yr)`;
        mine.appendChild(opt);
      });
      sel.appendChild(mine);
    }

    const customOpt = document.createElement('option');
    customOpt.value = 'custom';
    customOpt.textContent = 'Custom location';
    sel.appendChild(customOpt);
  },

  bindLocationPresetControl() {
    this.on('locationPreset', 'change', value => {
      this.skipInitialSavedSitePersist = false;
      if (value === 'custom') {
        this.state.locationPresetIsCustom = true;
        this.state.customSiteLabel = '';
        this.syncStateToControls();
        return;
      }

      const savedId = SavedSitePresets.parseOptionValue(value);
      if (savedId) {
        this.applySavedSitePreset(savedId);
        return;
      }

      this.state.locationPresetIsCustom = false;
      this.state.customSiteLabel = '';
      const loc = LOCATION_PRESETS[parseInt(value, 10)];
      if (!loc) return;
      this.state.body = loc.body || 'earth';
      this.state.solarProfileModel = loc.profile || this.state.body;
      this.state.latitude = loc.lat;
      this.state.longitude = loc.lon;
      this.state.siteYieldMwhPerMwdcYear = loc.baseYield;
      this.state.siteYieldSource = 'preset';
      this.syncStateToControls();
    });
  },

  applySavedSitePreset(savedId) {
    const preset = SavedSitePresets.getById(savedId);
    if (!preset) return;
    const snapshot = SavedSitePresets.loadAppStateForSite(savedId);
    if (snapshot) {
      this.state = Calc.normalizeState(snapshot);
    } else {
      this.state.locationPresetIsCustom = false;
      this.state.body = preset.body;
      this.state.solarProfileModel =
        preset.solarProfileModel || SOLAR_PROFILE_DEFAULTS_BY_BODY[preset.body] || this.state.body;
      this.state.latitude = preset.lat;
      this.state.longitude = preset.lon;
      this.state.siteYieldMwhPerMwdcYear = preset.siteYieldMwhPerMwdcYear;
      this.state.siteYieldSource = preset.siteYieldSource;
      this.state.customSiteLabel = preset.name;
    }
    this.syncStateToControls();
  },

  bindSavedSitePresetControls() {
    const saveBtn = document.getElementById('saveSitePresetButton');
    const nameInput = document.getElementById('saveSitePresetName');
    const removeBtn = document.getElementById('removeSavedSitePresetButton');

    if (saveBtn && nameInput) {
      const runSave = () => {
        const result = SavedSitePresets.addFromState(this.state, nameInput.value);
        if (!result.ok) {
          if (result.error === 'empty') this.setShareFeedback('Enter a name to save', 'error');
          return;
        }
        this.state.locationPresetIsCustom = false;
        this.state.customSiteLabel = result.preset.name;
        nameInput.value = '';
        this.populateLocationPresetSelect();
        this.syncStateToControls();
        this.recalculate();
        this.setShareFeedback('Site saved', 'success');
      };
      saveBtn.addEventListener('click', runSave);
      nameInput.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
          event.preventDefault();
          runSave();
        }
      });
      nameInput.addEventListener('input', () => {
        if (!this.state.locationPresetIsCustom) return;
        this.state.customSiteLabel = nameInput.value
          .replace(/[\u0000-\u001F\u007F]/g, '')
          .slice(0, 80);
        this.scheduleShareStateUrlSync();
      });
    }

    if (removeBtn) {
      removeBtn.addEventListener('click', () => {
        const sel = document.getElementById('locationPreset');
        const id = SavedSitePresets.parseOptionValue(sel?.value || '');
        if (!id || !SavedSitePresets.removeById(id)) return;
        this.state.locationPresetIsCustom = true;
        this.state.customSiteLabel = '';
        this.populateLocationPresetSelect();
        this.syncStateToControls();
        this.recalculate();
        this.setShareFeedback('Removed from my sites', 'success');
      });
    }
  },

  handleLocationEdited() {
    this.state.locationPresetIsCustom = true;
    this.state.customSiteLabel = '';
    markLocationPresetCustom();
    if ((this.state.body || 'earth') !== 'earth') {
      if (this.state.siteYieldSource !== 'manual') {
        this.state.siteYieldSource = 'planetary-custom';
      }
      return;
    }
    if (this.state.siteYieldSource !== 'manual') {
      const ghi = Calc.estimateGHI(this.state.latitude, this.state.longitude, this.state.body || 'earth');
      this.state.siteYieldMwhPerMwdcYear = Calc.estimateBaseYield(
        this.state.latitude,
        this.state.longitude,
        ghi,
        this.state.body || 'earth'
      );
      this.state.siteYieldSource = 'estimated';
      this.syncStateToControls();
    }
  },

  handleSiteYieldEdited() {
    this.state.siteYieldSource = 'manual';
    this.state.locationPresetIsCustom = true;
    this.state.customSiteLabel = '';
    markLocationPresetCustom();
  },

  /** Pick the location preset option that matches the state and sync the saved-site widgets. */
  syncLocationControls() {
    const locPresetSelect = document.getElementById('locationPreset');
    if (locPresetSelect) {
      locPresetSelect.value = this.getLocationPresetOptionValue();
    }

    const saveWrap = document.getElementById('saveSitePresetWrap');
    if (saveWrap) {
      saveWrap.hidden = !this.state.locationPresetIsCustom;
    }

    const saveNameInput = document.getElementById('saveSitePresetName');
    if (saveNameInput && this.state.locationPresetIsCustom && document.activeElement !== saveNameInput) {
      const next = this.state.customSiteLabel || '';
      if (saveNameInput.value !== next) {
        saveNameInput.value = next;
      }
    }

    const removeWrap = document.getElementById('removeSavedSiteWrap');
    if (removeWrap) {
      removeWrap.hidden = !SavedSitePresets.parseOptionValue(locPresetSelect?.value || '');
    }

    const labelNote = document.getElementById('customSiteLabelNote');
    if (labelNote) {
      const label = (this.state.customSiteLabel || '').trim();
      const showSharedLabel = Boolean(label && locPresetSelect && locPresetSelect.value === 'custom');
      labelNote.textContent = showSharedLabel ? `Site name (from link): ${label}` : '';
      labelNote.hidden = !showSharedLabel;
    }
  },

  /** May flip `locationPresetIsCustom` on when a named site matches no saved preset. */
  getLocationPresetOptionValue() {
    if (this.state.locationPresetIsCustom) return 'custom';

    const savedId = SavedSitePresets.findIdMatchingState(this.state);
    if (savedId) return SavedSitePresets.optionValueForId(savedId);

    if ((this.state.customSiteLabel || '').trim().length > 0) {
      this.state.locationPresetIsCustom = true;
      return 'custom';
    }

    const presetIndex = LOCATION_PRESETS.findIndex(loc =>
      (loc.body || 'earth') === (this.state.body || 'earth') &&
      Math.abs(loc.lat - this.state.latitude) < 0.1 &&
      Math.abs(loc.lon - this.state.longitude) < 0.1
    );
    return presetIndex >= 0 ? String(presetIndex) : 'custom';
  },
};
