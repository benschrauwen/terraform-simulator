/* Control binding and control sync helpers attached to App */

import {
  LOCATION_PRESETS,
  MOUNTING_TYPES,
} from '../data/reference-data.js';
import { Calc } from '../model/index.js';
import { ModuleCatalog } from '../model/module-catalog.js';
import { SolarGeometry } from '../model/solar-geometry.js';
import { SavedSitePresets } from '../state/saved-site-presets.js';
import {
  APP_CONTROL_SYNC_FIELDS,
  SOLAR_PROFILE_DEFAULTS_BY_BODY,
} from '../state/schema.js';
import { FormatNumbers } from './format-numbers.js';

export const controlMethods = {
  bindControls() {
    this.bindLoadConfigTabs();

    document.querySelectorAll('.day-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        if (tab.disabled) return;
        this.state.dayMode = tab.dataset.mode;
        this.refreshDaySpecificViews();
      });
    });

    this.bindRange('dayOfYear', 'dayOfYear', value => {
      const day = parseInt(value, 10);
      return `${SolarGeometry.dayToDateString(day)}${SolarGeometry.notableDay(day)}`;
    }, { skipRecalculate: true });

    document.querySelectorAll('.day-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        const day = parseInt(btn.dataset.day, 10);
        this.state.dayOfYear = day;
        this.syncRangeDisplay('dayOfYear', day);
        this.refreshDaySpecificViews();
      });
    });

    this.on('locationPreset', 'change', value => {
      this.skipInitialSavedSitePersist = false;
      if (value === 'custom') {
        this.state.locationPresetIsCustom = true;
        this.state.customSiteLabel = '';
        this.syncStateToControls();
        return;
      }

      const savedId =
        typeof SavedSitePresets !== 'undefined' && SavedSitePresets.parseOptionValue
          ? SavedSitePresets.parseOptionValue(value)
          : null;
      if (savedId) {
        const preset = SavedSitePresets.getById(savedId);
        if (!preset) return;
        const snapshot =
          typeof SavedSitePresets.loadAppStateForSite === 'function'
            ? SavedSitePresets.loadAppStateForSite(savedId)
            : null;
        if (snapshot && typeof Calc !== 'undefined' && Calc.normalizeState) {
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

    this.bindNumber('latitude', 'latitude', () => this.handleLocationEdited());
    this.bindNumber('longitude', 'longitude', () => this.handleLocationEdited());
    this.bindNumber('siteYield', 'siteYieldMwhPerMwdcYear', () => {
      this.state.siteYieldSource = 'manual';
      this.state.locationPresetIsCustom = true;
      this.state.customSiteLabel = '';
      const locPresetEl = document.getElementById('locationPreset');
      if (locPresetEl) locPresetEl.value = 'custom';
    });

    this.bindRange('systemSize', 'systemSizeMW', value => this.formatSystemSizeMW(value));
    this.bindRange('panelEfficiency', 'panelEfficiency', value => `${FormatNumbers.fixed(parseFloat(value), 1)}%`);
    this.bindRange('panelCost', 'panelCostPerW', value => `$${FormatNumbers.fixed(parseFloat(value), 2)}/W`);
    this.bindRange('panelDegradationAnnual', 'panelDegradationAnnual', value => `${FormatNumbers.fixed(parseFloat(value), 2)}%/yr`);
    this.on('mountingType', 'change', value => {
      this.state.mountingType = value;
      this.state.bosCostPerW = MOUNTING_TYPES[value].typicalBOS;
      this.syncStateToControls();
    });
    this.bindRange('bosCost', 'bosCostPerW', value => `$${FormatNumbers.fixed(parseFloat(value), 2)}/W`);
    this.bindRange('landCost', 'landCostPerAcre', value => `$${Math.round(parseFloat(value)).toLocaleString()}/acre`);
    this.bindRange('sitePrepCost', 'sitePrepCostPerAcre', value => `$${Math.round(parseFloat(value)).toLocaleString()}/acre`);

    this.bindRange('batteryCapacity', 'batteryCapacityMWh', value => `${FormatNumbers.fixed(parseFloat(value), 1)} MWh`, () => {
      this.syncBatteryEnabledState();
    });
    this.bindRange('batteryCost', 'batteryCostPerKWh', value => `$${FormatNumbers.fixed(parseInt(value, 10), 0)}/kWh`);
    this.bindRange('batteryEfficiency', 'batteryEfficiency', value => `${FormatNumbers.fixed(parseInt(value, 10), 0)}%`);
    this.bindRange('batteryCycles', 'batteryCycles', value => parseInt(value, 10).toLocaleString());
    this.bindRange('chemicalSizingPercent', 'chemicalSizingPercent', value => this.formatChemicalSizingPercent(value));

    this.on('aiComputeEnabled', 'change', (_, el) => {
      this.state.aiComputeEnabled = el.checked;
      document.getElementById('aiComputeConfig').classList.toggle('active', el.checked);
      window.requestAnimationFrame(() => this.positionSliderMarkers());
    });
    this.on('aiReliabilityTarget', 'change', value => {
      this.state.aiReliabilityTarget = parseFloat(value);
    });
    this.bindRange('aiGpuCapexPerKW', 'aiGpuCapexPerKW', value => `$${Math.round(parseFloat(value)).toLocaleString()}/kW`);
    this.bindRange('aiTokenPrice', 'aiTokenPricePerM', value => `$${FormatNumbers.fixed(parseFloat(value), 2)} / 1M tokens`);
    this.bindRange('aiTokensPerMWh', 'aiMillionTokensPerMWh', value => `${Math.round(parseFloat(value)).toLocaleString()} M tokens/MWh`);
    this.bindRange('aiAssetLifeYears', 'aiAssetLifeYears', value => `${FormatNumbers.fixed(parseInt(value, 10), 0)} years`);

    this.bindModuleControls();

    this.bindRange('methaneFeedstockSplit', 'methaneFeedstockSplit', value => this.formatMethaneFeedstockSplit(value));
    this.bindRange('mtgMethanolSplit', 'mtgMethanolSplit', value => this.formatMtgMethanolSplit(value));
    this.on('methaneMarketPreset', 'change', value => {
      this.state.methaneMarketPreset = value;
      this.syncDynamicVisibility();
    });
    this.bindRange('methanePrice', 'methanePrice', value => `$${FormatNumbers.fixed(parseFloat(value), 2)}/MCF`);
    this.bindRange('methanolPrice', 'methanolPrice', value => `$${FormatNumbers.fixed(parseInt(value, 10), 0)}/ton`);
    ModuleCatalog.getExploratoryModules()
      .filter(module => ModuleCatalog.hasMarket(module.id, this.state[`${module.id}Route`] || ModuleCatalog.getDefaultRoute(module)))
      .forEach(module => {
        const priceKey = `${module.id}Price`;
        this.bindRange(priceKey, priceKey, value => this.formatModuleMarketValue(module.id, value));
      });
    this.bindRange('exploratoryOmPercent', 'exploratoryOmPercent', value => this.formatExploratoryOmPercent(value));

    this.on('policyMode', 'change', value => {
      this.state.policyMode = value;
      this.renderPolicyInputs();
      this.syncDynamicVisibility();
    });
    this.bindRange('solarAssetLife', 'solarAssetLife', value => `${FormatNumbers.fixed(parseInt(value, 10), 0)} years`);
    this.bindRange('analysisHorizonYears', 'analysisHorizonYears', value => `${FormatNumbers.fixed(parseInt(value, 10), 0)} years`);
    this.bindRange('discountRate', 'discountRate', value => `${FormatNumbers.fixed(parseFloat(value), 1)}%`);
    this.on('financingEnabled', 'change', (_, el) => {
      this.state.financingEnabled = el.checked;
      document.getElementById('financingConfig').classList.toggle('active', el.checked);
    });
    this.bindRange('debtShare', 'debtSharePercent', value => `${FormatNumbers.fixed(parseInt(value, 10), 0)}%`);
    this.bindRange('debtInterestRate', 'debtInterestRate', value => `${FormatNumbers.fixed(parseFloat(value), 2)}%`);
    this.bindRange('debtTermYears', 'debtTermYears', value => `${FormatNumbers.fixed(parseInt(value, 10), 0)} years`);
    this.bindRange('debtFeePercent', 'debtFeePercent', value => `${FormatNumbers.fixed(parseFloat(value), 2)}%`);

    this.bindRange('solarOmPercent', 'solarOmPercent', value => `${FormatNumbers.fixed(parseFloat(value), 1)}%/yr`);
    this.bindRange('processOmPercent', 'processOmPercent', value => `${FormatNumbers.fixed(parseFloat(value), 1)}%/yr`);
    this.bindRange('batteryOmPercent', 'batteryOmPercent', value => `${FormatNumbers.fixed(parseFloat(value), 1)}%/yr`);
    this.bindSavedSitePresetControls();
    this.bindOptimizeButtons();
  },

  bindSavedSitePresetControls() {
    const saveBtn = document.getElementById('saveSitePresetButton');
    const nameInput = document.getElementById('saveSitePresetName');
    const removeBtn = document.getElementById('removeSavedSitePresetButton');

    if (saveBtn && nameInput) {
      const runSave = () => {
        if (typeof SavedSitePresets === 'undefined') return;
        const result = SavedSitePresets.addFromState(this.state, nameInput.value);
        if (!result.ok) {
          if (result.error === 'empty' && typeof this.setShareFeedback === 'function') {
            this.setShareFeedback('Enter a name to save', 'error');
          }
          return;
        }
        this.state.locationPresetIsCustom = false;
        this.state.customSiteLabel = result.preset.name;
        nameInput.value = '';
        this.populateLocationPresetSelect();
        this.syncStateToControls();
        this.recalculate();
        if (typeof this.setShareFeedback === 'function') {
          this.setShareFeedback('Site saved', 'success');
        }
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
        if (typeof this.scheduleShareStateUrlSync === 'function') {
          this.scheduleShareStateUrlSync();
        }
      });
    }

    if (removeBtn) {
      removeBtn.addEventListener('click', () => {
        if (typeof SavedSitePresets === 'undefined') return;
        const sel = document.getElementById('locationPreset');
        const id = SavedSitePresets.parseOptionValue(sel?.value || '');
        if (!id || !SavedSitePresets.removeById(id)) return;
        this.state.locationPresetIsCustom = true;
        this.state.customSiteLabel = '';
        this.populateLocationPresetSelect();
        this.syncStateToControls();
        this.recalculate();
        if (typeof this.setShareFeedback === 'function') {
          this.setShareFeedback('Removed from my sites', 'success');
        }
      });
    }
  },

  bindLoadConfigTabs() {
    const tabs = Array.from(document.querySelectorAll('.load-config-tab'));
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        this.selectLoadConfigTab(tab);
      });
      tab.addEventListener('keydown', event => {
        const availableTabs = tabs.filter(item => !item.disabled);
        if (!availableTabs.length) return;

        const currentIndex = availableTabs.indexOf(tab);
        const keyActions = {
          ArrowRight: () => availableTabs[(currentIndex + 1) % availableTabs.length],
          ArrowDown: () => availableTabs[(currentIndex + 1) % availableTabs.length],
          ArrowLeft: () => availableTabs[(currentIndex - 1 + availableTabs.length) % availableTabs.length],
          ArrowUp: () => availableTabs[(currentIndex - 1 + availableTabs.length) % availableTabs.length],
          Home: () => availableTabs[0],
          End: () => availableTabs[availableTabs.length - 1],
        };
        const nextTab = keyActions[event.key]?.();
        if (!nextTab) return;

        event.preventDefault();
        this.selectLoadConfigTab(nextTab, { focus: true });
      });
    });
    this.syncLoadConfigTabs();
  },

  selectLoadConfigTab(tab, { focus = false } = {}) {
    if (!tab || tab.disabled) return;
    this.state.loadConfigTab = tab.dataset.loadTab || 'chemicals';
    this.syncLoadConfigTabs();
    if (focus && typeof tab.focus === 'function') tab.focus();
  },

  syncLoadConfigTabs() {
    const activeTab = this.state.loadConfigTab || 'chemicals';
    document.querySelectorAll('.load-config-tab').forEach(tab => {
      const isActive = tab.dataset.loadTab === activeTab;
      tab.classList.toggle('active', isActive);
      tab.setAttribute('aria-selected', String(isActive));
      tab.setAttribute('tabindex', isActive ? '0' : '-1');
    });
    document.querySelectorAll('.load-config-panel').forEach(panel => {
      const isActive = panel.dataset.loadPanel === activeTab;
      panel.classList.toggle('active', isActive);
      panel.hidden = !isActive;
      panel.setAttribute('aria-hidden', String(!isActive));
    });
    // Sliders are `display:none` when their load tab is inactive; marker positions need width
    // from layout after the panel becomes visible.
    window.requestAnimationFrame(() => this.positionSliderMarkers());
  },

  bindModuleControls() {
    ModuleCatalog.getAll().forEach(module => {
      const enabledKey = `${module.id}Enabled`;
      this.on(enabledKey, 'change', (_, el) => {
        this.state[enabledKey] = el.checked;
        this.enforceModuleDependencies();
        this.syncDerivedFeedControls();
      });
      this.on(`${module.id}BufferEnabled`, 'change', (_, el) => {
        this.state[`${module.id}BufferEnabled`] = el.checked;
      });

      if (ModuleCatalog.hasPresets(module)) {
        this.on(`${module.id}Preset`, 'change', value => {
          if (value === 'custom') {
            this.syncModulePresetControl(module.id);
            return;
          }
          this.applyModulePreset(module.id, value);
        });
      }

      ModuleCatalog.getConfigFields(module).forEach(config => {
        const extra = ModuleCatalog.isPresetConfigField(module, config.key)
          ? { onInput: () => this.syncModulePresetControl(module.id) }
          : undefined;
        this.bindRange(
          config.key,
          config.key,
          value => this.formatConfigValue(config.unit, value),
          extra
        );
      });

      const assetLifeKey = ModuleCatalog.getAssetLifeKey(module);
      if (assetLifeKey) {
        this.bindRange(assetLifeKey, assetLifeKey, value => `${FormatNumbers.fixed(parseInt(value, 10), 0)} years`);
      }

      if (ModuleCatalog.hasRoutes(module)) {
        this.on(`${module.id}Route`, 'change', value => {
          this.state[`${module.id}Route`] = value;
          this.syncModuleCapexControl(module.id);
          this.syncModuleMarketControl(module.id);
          this.enforceModuleDependencies();
          this.syncDynamicVisibility();
          this.syncDerivedFeedControls();
        });
      }

      if (module.exploratory) {
        this.bindRange(
          `${module.id}CapexBasis`,
          `${module.id}CapexBasis`,
          value => this.formatExploratoryCapexBasis(module.id, value)
        );
        this.bindRange(
          `${module.id}PriorityWeight`,
          `${module.id}PriorityWeight`,
          value => this.formatExploratoryPriorityWeight(value)
        );
      }
    });
  },

  handleLocationEdited() {
    this.state.locationPresetIsCustom = true;
    this.state.customSiteLabel = '';
    const locPresetEl = document.getElementById('locationPreset');
    if (locPresetEl) locPresetEl.value = 'custom';
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

  on(id, event, handler) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener(event, () => {
      handler(el.value, el);
      this.recalculate();
    });
  },

  bindRange(id, stateKey, formatter, extra) {
    const el = document.getElementById(id);
    if (!el) return;

    const extraConfig = typeof extra === 'function' ? { onInput: extra } : (extra || {});
    this.rangeBindings.push({ id, stateKey, formatter });
    el.addEventListener('input', () => {
      const sliderValue = parseFloat(el.value);
      const actualValue = el.dataset.scale === 'log' ? Math.pow(10, sliderValue) : sliderValue;
      this.state[stateKey] = actualValue;
      this.syncRangeDisplay(id, actualValue, formatter);
      if (extraConfig.onInput) extraConfig.onInput();
      this.syncDynamicVisibility();
      if (extraConfig.skipRecalculate) {
        this.refreshDaySpecificViews();
      } else {
        this.requestRecalculate({ includeSensitivity: false });
      }
    });
  },

  applyModulePreset(moduleId, presetValue) {
    const preset = ModuleCatalog.getPreset(moduleId, presetValue);
    if (!preset) {
      this.syncModulePresetControl(moduleId);
      return;
    }

    Object.entries(preset.values || {}).forEach(([stateKey, value]) => {
      this.state[stateKey] = value;
      const input = document.getElementById(stateKey);
      if (input) {
        input.value = input.dataset.scale === 'log' && Number.isFinite(value) && value > 0
          ? String(Math.log10(value))
          : String(value);
      }
      this.syncRangeDisplay(stateKey, value);
    });

    this.syncModulePresetControl(moduleId);
  },

  syncModulePresetControl(moduleId) {
    const select = document.getElementById(`${moduleId}Preset`);
    if (!select || typeof this.getSelectedModulePreset !== 'function') return;
    select.value = this.getSelectedModulePreset(moduleId);
  },

  bindNumber(id, stateKey, extra) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', () => {
      this.state[stateKey] = parseFloat(el.value);
      if (extra) extra();
      this.recalculate();
    });
  },

  syncStateToControls() {
    APP_CONTROL_SYNC_FIELDS.checkboxes.forEach(({ id, stateKey = id }) => {
      const el = document.getElementById(id);
      if (el) el.checked = Boolean(this.state[stateKey]);
    });

    APP_CONTROL_SYNC_FIELDS.selects.forEach(({ id, stateKey = id }) => {
      const el = document.getElementById(id);
      if (el) el.value = this.state[stateKey];
    });

    APP_CONTROL_SYNC_FIELDS.numbers.forEach(({ id, stateKey = id }) => {
      const el = document.getElementById(id);
      if (el) el.value = this.state[stateKey];
    });

    const locPresetSelect = document.getElementById('locationPreset');
    if (locPresetSelect) {
      if (this.state.locationPresetIsCustom) {
        locPresetSelect.value = 'custom';
      } else {
        let nextValue = 'custom';
        let matchedSaved = false;
        if (typeof SavedSitePresets !== 'undefined') {
          const savedId = SavedSitePresets.findIdMatchingState(this.state);
          if (savedId) {
            matchedSaved = true;
            nextValue = SavedSitePresets.optionValueForId(savedId);
          }
        }
        const namedSite = (this.state.customSiteLabel || '').trim().length > 0;
        if (!matchedSaved) {
          if (namedSite) {
            nextValue = 'custom';
            this.state.locationPresetIsCustom = true;
          } else {
            const presetIndex = LOCATION_PRESETS.findIndex(loc =>
              (loc.body || 'earth') === (this.state.body || 'earth') &&
              Math.abs(loc.lat - this.state.latitude) < 0.1 &&
              Math.abs(loc.lon - this.state.longitude) < 0.1
            );
            if (presetIndex >= 0) {
              nextValue = String(presetIndex);
            }
          }
        }
        locPresetSelect.value = nextValue;
      }
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
    if (removeWrap && typeof SavedSitePresets !== 'undefined') {
      const sel = document.getElementById('locationPreset');
      removeWrap.hidden = !SavedSitePresets.parseOptionValue(sel?.value || '');
    } else if (removeWrap) {
      removeWrap.hidden = true;
    }

    const labelNote = document.getElementById('customSiteLabelNote');
    if (labelNote) {
      const sel = document.getElementById('locationPreset');
      const label = (this.state.customSiteLabel || '').trim();
      const showSharedLabel = Boolean(label && sel && sel.value === 'custom');
      if (showSharedLabel) {
        labelNote.textContent = `Site name (from link): ${label}`;
        labelNote.hidden = false;
      } else {
        labelNote.textContent = '';
        labelNote.hidden = true;
      }
    }

    this.rangeBindings.forEach(binding => {
      const el = document.getElementById(binding.id);
      if (!el) return;
      const stateValue = this.state[binding.stateKey];
      const numericState = parseFloat(stateValue);
      el.value = el.dataset.scale === 'log' && Number.isFinite(numericState) && numericState > 0
        ? Math.log10(numericState)
        : stateValue;
      this.syncRangeDisplay(binding.id, stateValue, binding.formatter);
    });

    ModuleCatalog.getAll().forEach(module => {
      const enabledEl = document.getElementById(`${module.id}Enabled`);
      if (enabledEl) enabledEl.checked = Boolean(this.state[`${module.id}Enabled`]);
      const bufferEl = document.getElementById(`${module.id}BufferEnabled`);
      if (bufferEl) bufferEl.checked = Boolean(this.state[`${module.id}BufferEnabled`]);
      const configEl = document.getElementById(`${module.id}Config`);
      if (configEl) configEl.classList.toggle('active', Boolean(this.state[`${module.id}Enabled`]));
      const routeEl = document.getElementById(`${module.id}Route`);
      if (routeEl && this.state[`${module.id}Route`]) routeEl.value = this.state[`${module.id}Route`];
      this.syncModulePresetControl(module.id);
    });

    document.getElementById('aiComputeConfig').classList.toggle('active', this.state.aiComputeEnabled);
    document.getElementById('financingConfig').classList.toggle('active', this.state.financingEnabled);
    if (typeof this.renderPolicyInputs === 'function') {
      this.renderPolicyInputs();
    }
    this.syncLoadConfigTabs();
  },

  syncRangeDisplay(id, value, formatter) {
    const display = document.getElementById(`${id}Value`);
    const binding = formatter || this.rangeBindings.find(item => item.id === id)?.formatter;
    if (display && binding) display.textContent = binding(value);
  },
};
