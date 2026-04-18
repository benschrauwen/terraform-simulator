/* Control binding and control sync helpers attached to App */

const AppControlMethods = {
  bindControls() {
    AppControlMethods.bindLoadConfigTabs.call(this);

    document.querySelectorAll('.day-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        if (tab.disabled) return;
        this.state.dayMode = tab.dataset.mode;
        this.refreshDaySpecificViews();
      });
    });

    AppControlMethods.bindRange.call(this, 'dayOfYear', 'dayOfYear', value => {
      const day = parseInt(value, 10);
      return `${SolarGeometry.dayToDateString(day)}${SolarGeometry.notableDay(day)}`;
    }, { skipRecalculate: true });

    document.querySelectorAll('.day-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        const day = parseInt(btn.dataset.day, 10);
        this.state.dayOfYear = day;
        AppControlMethods.syncRangeDisplay.call(this, 'dayOfYear', day);
        this.refreshDaySpecificViews();
      });
    });

    AppControlMethods.on.call(this, 'locationPreset', 'change', value => {
      this.skipInitialSavedSitePersist = false;
      if (value === 'custom') {
        this.state.locationPresetIsCustom = true;
        this.state.customSiteLabel = '';
        AppControlMethods.syncStateToControls.call(this);
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
        AppControlMethods.syncStateToControls.call(this);
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
      AppControlMethods.syncStateToControls.call(this);
    });

    AppControlMethods.bindNumber.call(this, 'latitude', 'latitude', () => AppControlMethods.handleLocationEdited.call(this));
    AppControlMethods.bindNumber.call(this, 'longitude', 'longitude', () => AppControlMethods.handleLocationEdited.call(this));
    AppControlMethods.bindNumber.call(this, 'siteYield', 'siteYieldMwhPerMwdcYear', () => {
      this.state.siteYieldSource = 'manual';
      this.state.locationPresetIsCustom = true;
      this.state.customSiteLabel = '';
      const locPresetEl = document.getElementById('locationPreset');
      if (locPresetEl) locPresetEl.value = 'custom';
    });

    AppControlMethods.bindRange.call(this, 'systemSize', 'systemSizeMW', value => this.formatSystemSizeMW(value));
    AppControlMethods.bindRange.call(this, 'panelEfficiency', 'panelEfficiency', value => `${FormatNumbers.fixed(parseFloat(value), 1)}%`);
    AppControlMethods.bindRange.call(this, 'panelCost', 'panelCostPerW', value => `$${FormatNumbers.fixed(parseFloat(value), 2)}/W`);
    AppControlMethods.bindRange.call(this, 'panelDegradationAnnual', 'panelDegradationAnnual', value => `${FormatNumbers.fixed(parseFloat(value), 2)}%/yr`);
    AppControlMethods.on.call(this, 'mountingType', 'change', value => {
      this.state.mountingType = value;
      this.state.bosCostPerW = MOUNTING_TYPES[value].typicalBOS;
      AppControlMethods.syncStateToControls.call(this);
    });
    AppControlMethods.bindRange.call(this, 'bosCost', 'bosCostPerW', value => `$${FormatNumbers.fixed(parseFloat(value), 2)}/W`);
    AppControlMethods.bindRange.call(this, 'landCost', 'landCostPerAcre', value => `$${Math.round(parseFloat(value)).toLocaleString()}/acre`);
    AppControlMethods.bindRange.call(this, 'sitePrepCost', 'sitePrepCostPerAcre', value => `$${Math.round(parseFloat(value)).toLocaleString()}/acre`);

    AppControlMethods.bindRange.call(this, 'batteryCapacity', 'batteryCapacityMWh', value => `${FormatNumbers.fixed(parseFloat(value), 1)} MWh`, () => {
      this.syncBatteryEnabledState();
    });
    AppControlMethods.bindRange.call(this, 'batteryCost', 'batteryCostPerKWh', value => `$${FormatNumbers.fixed(parseInt(value, 10), 0)}/kWh`);
    AppControlMethods.bindRange.call(this, 'batteryEfficiency', 'batteryEfficiency', value => `${FormatNumbers.fixed(parseInt(value, 10), 0)}%`);
    AppControlMethods.bindRange.call(this, 'batteryCycles', 'batteryCycles', value => parseInt(value, 10).toLocaleString());
    AppControlMethods.bindRange.call(this, 'chemicalSizingPercent', 'chemicalSizingPercent', value => this.formatChemicalSizingPercent(value));

    AppControlMethods.on.call(this, 'aiComputeEnabled', 'change', (_, el) => {
      this.state.aiComputeEnabled = el.checked;
      document.getElementById('aiComputeConfig').classList.toggle('active', el.checked);
      window.requestAnimationFrame(() => this.positionSliderMarkers());
    });
    AppControlMethods.on.call(this, 'aiReliabilityTarget', 'change', value => {
      this.state.aiReliabilityTarget = parseFloat(value);
    });
    AppControlMethods.bindRange.call(this, 'aiGpuCapexPerKW', 'aiGpuCapexPerKW', value => `$${Math.round(parseFloat(value)).toLocaleString()}/kW`);
    AppControlMethods.bindRange.call(this, 'aiTokenPrice', 'aiTokenPricePerM', value => `$${FormatNumbers.fixed(parseFloat(value), 2)} / 1M tokens`);
    AppControlMethods.bindRange.call(this, 'aiTokensPerMWh', 'aiMillionTokensPerMWh', value => `${Math.round(parseFloat(value)).toLocaleString()} M tokens/MWh`);
    AppControlMethods.bindRange.call(this, 'aiAssetLifeYears', 'aiAssetLifeYears', value => `${FormatNumbers.fixed(parseInt(value, 10), 0)} years`);

    AppControlMethods.bindModuleControls.call(this);

    AppControlMethods.bindRange.call(this, 'methaneFeedstockSplit', 'methaneFeedstockSplit', value => this.formatMethaneFeedstockSplit(value));
    AppControlMethods.bindRange.call(this, 'mtgMethanolSplit', 'mtgMethanolSplit', value => this.formatMtgMethanolSplit(value));
    AppControlMethods.on.call(this, 'methaneMarketPreset', 'change', value => {
      this.state.methaneMarketPreset = value;
      this.syncDynamicVisibility();
    });
    AppControlMethods.bindRange.call(this, 'methanePrice', 'methanePrice', value => `$${FormatNumbers.fixed(parseFloat(value), 2)}/MCF`);
    AppControlMethods.bindRange.call(this, 'methanolPrice', 'methanolPrice', value => `$${FormatNumbers.fixed(parseInt(value, 10), 0)}/ton`);
    ModuleCatalog.getExploratoryModules()
      .filter(module => ModuleCatalog.hasMarket(module.id, this.state[`${module.id}Route`] || ModuleCatalog.getDefaultRoute(module)))
      .forEach(module => {
        const priceKey = `${module.id}Price`;
        AppControlMethods.bindRange.call(this, priceKey, priceKey, value => this.formatModuleMarketValue(module.id, value));
      });
    AppControlMethods.bindRange.call(this, 'exploratoryOmPercent', 'exploratoryOmPercent', value => this.formatExploratoryOmPercent(value));

    AppControlMethods.on.call(this, 'policyMode', 'change', value => {
      this.state.policyMode = value;
      this.renderPolicyInputs();
      this.syncDynamicVisibility();
    });
    AppControlMethods.bindRange.call(this, 'solarAssetLife', 'solarAssetLife', value => `${FormatNumbers.fixed(parseInt(value, 10), 0)} years`);
    AppControlMethods.bindRange.call(this, 'analysisHorizonYears', 'analysisHorizonYears', value => `${FormatNumbers.fixed(parseInt(value, 10), 0)} years`);
    AppControlMethods.bindRange.call(this, 'discountRate', 'discountRate', value => `${FormatNumbers.fixed(parseFloat(value), 1)}%`);
    AppControlMethods.on.call(this, 'financingEnabled', 'change', (_, el) => {
      this.state.financingEnabled = el.checked;
      document.getElementById('financingConfig').classList.toggle('active', el.checked);
    });
    AppControlMethods.bindRange.call(this, 'debtShare', 'debtSharePercent', value => `${FormatNumbers.fixed(parseInt(value, 10), 0)}%`);
    AppControlMethods.bindRange.call(this, 'debtInterestRate', 'debtInterestRate', value => `${FormatNumbers.fixed(parseFloat(value), 2)}%`);
    AppControlMethods.bindRange.call(this, 'debtTermYears', 'debtTermYears', value => `${FormatNumbers.fixed(parseInt(value, 10), 0)} years`);
    AppControlMethods.bindRange.call(this, 'debtFeePercent', 'debtFeePercent', value => `${FormatNumbers.fixed(parseFloat(value), 2)}%`);

    AppControlMethods.bindRange.call(this, 'solarOmPercent', 'solarOmPercent', value => `${FormatNumbers.fixed(parseFloat(value), 1)}%/yr`);
    AppControlMethods.bindRange.call(this, 'processOmPercent', 'processOmPercent', value => `${FormatNumbers.fixed(parseFloat(value), 1)}%/yr`);
    AppControlMethods.bindRange.call(this, 'batteryOmPercent', 'batteryOmPercent', value => `${FormatNumbers.fixed(parseFloat(value), 1)}%/yr`);
    AppControlMethods.bindSavedSitePresetControls.call(this);
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
          if (result.error === 'empty' && typeof AppShareStateMethods.setShareFeedback === 'function') {
            AppShareStateMethods.setShareFeedback.call(this, 'Enter a name to save', 'error');
          }
          return;
        }
        this.state.locationPresetIsCustom = false;
        this.state.customSiteLabel = result.preset.name;
        nameInput.value = '';
        this.populateLocationPresetSelect();
        AppControlMethods.syncStateToControls.call(this);
        this.recalculate();
        if (typeof AppShareStateMethods.setShareFeedback === 'function') {
          AppShareStateMethods.setShareFeedback.call(this, 'Site saved', 'success');
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
        AppControlMethods.syncStateToControls.call(this);
        this.recalculate();
        if (typeof AppShareStateMethods.setShareFeedback === 'function') {
          AppShareStateMethods.setShareFeedback.call(this, 'Removed from my sites', 'success');
        }
      });
    }
  },

  bindLoadConfigTabs() {
    document.querySelectorAll('.load-config-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        this.state.loadConfigTab = tab.dataset.loadTab || 'chemicals';
        AppControlMethods.syncLoadConfigTabs.call(this);
      });
    });
    AppControlMethods.syncLoadConfigTabs.call(this);
  },

  syncLoadConfigTabs() {
    const activeTab = this.state.loadConfigTab || 'chemicals';
    document.querySelectorAll('.load-config-tab').forEach(tab => {
      const isActive = tab.dataset.loadTab === activeTab;
      tab.classList.toggle('active', isActive);
      tab.setAttribute('aria-selected', String(isActive));
    });
    document.querySelectorAll('.load-config-panel').forEach(panel => {
      panel.classList.toggle('active', panel.dataset.loadPanel === activeTab);
    });
    // Sliders are `display:none` when their load tab is inactive; marker positions need width
    // from layout after the panel becomes visible.
    window.requestAnimationFrame(() => this.positionSliderMarkers());
  },

  bindModuleControls() {
    ModuleCatalog.getAll().forEach(module => {
      const enabledKey = `${module.id}Enabled`;
      AppControlMethods.on.call(this, enabledKey, 'change', (_, el) => {
        this.state[enabledKey] = el.checked;
        this.enforceModuleDependencies();
        this.syncDerivedFeedControls();
      });
      AppControlMethods.on.call(this, `${module.id}BufferEnabled`, 'change', (_, el) => {
        this.state[`${module.id}BufferEnabled`] = el.checked;
      });

      if (ModuleCatalog.hasPresets(module)) {
        AppControlMethods.on.call(this, `${module.id}Preset`, 'change', value => {
          if (value === 'custom') {
            AppControlMethods.syncModulePresetControl.call(this, module.id);
            return;
          }
          AppControlMethods.applyModulePreset.call(this, module.id, value);
        });
      }

      ModuleCatalog.getConfigFields(module).forEach(config => {
        const extra = ModuleCatalog.isPresetConfigField(module, config.key)
          ? { onInput: () => AppControlMethods.syncModulePresetControl.call(this, module.id) }
          : undefined;
        AppControlMethods.bindRange.call(
          this,
          config.key,
          config.key,
          value => this.formatConfigValue(config.unit, value),
          extra
        );
      });

      const assetLifeKey = ModuleCatalog.getAssetLifeKey(module);
      if (assetLifeKey) {
        AppControlMethods.bindRange.call(this, assetLifeKey, assetLifeKey, value => `${FormatNumbers.fixed(parseInt(value, 10), 0)} years`);
      }

      if (ModuleCatalog.hasRoutes(module)) {
        AppControlMethods.on.call(this, `${module.id}Route`, 'change', value => {
          this.state[`${module.id}Route`] = value;
          this.syncModuleCapexControl(module.id);
          this.syncModuleMarketControl(module.id);
          this.enforceModuleDependencies();
          this.syncDynamicVisibility();
          this.syncDerivedFeedControls();
        });
      }

      if (module.exploratory) {
        AppControlMethods.bindRange.call(
          this,
          `${module.id}CapexBasis`,
          `${module.id}CapexBasis`,
          value => this.formatExploratoryCapexBasis(module.id, value)
        );
        AppControlMethods.bindRange.call(
          this,
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
      AppControlMethods.syncStateToControls.call(this);
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
      AppControlMethods.syncRangeDisplay.call(this, id, actualValue, formatter);
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
      AppControlMethods.syncModulePresetControl.call(this, moduleId);
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
      AppControlMethods.syncRangeDisplay.call(this, stateKey, value);
    });

    AppControlMethods.syncModulePresetControl.call(this, moduleId);
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
      AppControlMethods.syncRangeDisplay.call(this, binding.id, stateValue, binding.formatter);
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
      AppControlMethods.syncModulePresetControl.call(this, module.id);
    });

    document.getElementById('aiComputeConfig').classList.toggle('active', this.state.aiComputeEnabled);
    document.getElementById('financingConfig').classList.toggle('active', this.state.financingEnabled);
    if (typeof this.renderPolicyInputs === 'function') {
      this.renderPolicyInputs();
    }
    AppControlMethods.syncLoadConfigTabs.call(this);
  },

  syncRangeDisplay(id, value, formatter) {
    const display = document.getElementById(`${id}Value`);
    const binding = formatter || this.rangeBindings.find(item => item.id === id)?.formatter;
    if (display && binding) display.textContent = binding(value);
  },
};

window.AppControlMethods = AppControlMethods;
