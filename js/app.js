/* ============================================
   App — Main controller, UI binding, charts
   ============================================ */

class App {
  constructor() {
    this.state = { ...DEFAULT_STATE };
    this.charts = {};
    this.chartKeys = {};
    this.rangeBindings = [];
    this.sliderMarkerBindings = [];
    this.siteMap = null;
    this.siteMapOverlay = null;
    this.siteMapModuleLayer = null;
    this.siteMapMarker = null;
    this.optimizerWorker = null;
    this.optimizerRequestId = 0;
    this.optimizerRequests = new Map();
    this.pendingRecalculateFrame = null;
    this.pendingRecalculateOptions = null;
    this.pendingSensitivityTimer = null;
    this.pendingSensitivityResults = null;
    this.sensitivityDebounceMs = 180;
    this.shareFeedbackTimer = null;
    this.shareUrlSyncTimer = null;
    this.pendingShareFeedback = null;
    this.init();
  }

  init() {
    this.initSharedState();
    this.populatePresets();
    this.renderPolicyInputs();
    this.renderModuleControls();
    this.renderExploratoryMarketControls();
    this.renderExploratoryOmControls();
    this.bindControls();
    this.bindShareControls();
    this.createHoverTooltip();
    this.bindHoverTooltips();
    this.initSliderMarkers();
    this.bindSectionToggles();
    this.bindMobilePaneControls();
    this.initSiteMap();
    this.syncBatteryEnabledState();
    this.syncStateToControls();
    this.syncDynamicVisibility();
    this.syncDerivedFeedControls();
    this.recalculate();
  }

  getBodyConfig(bodyKey = this.state.body) {
    return PLANETARY_BODIES[bodyKey] || PLANETARY_BODIES.earth;
  }

  getCycleRateUnit(r) {
    return `${r.solar.cycleUnitCompact}`;
  }

  getPolicyConfig() {
    return PolicyModel.getScheme(this.state.policyMode);
  }

  getMethaneMarketConfig() {
    return METHANE_MARKET_PRESETS[this.state.methaneMarketPreset] || METHANE_MARKET_PRESETS.terraform_commodity;
  }

  getSelectedModulePreset(moduleId, state = this.state) {
    return ModuleCatalog.getMatchingPreset(moduleId, state)?.value || 'custom';
  }

  getPowerChartLabels(r) {
    return AppChartMethods.getPowerChartLabels.call(this, r);
  }

  syncPlanetaryUI() {
    return AppUiStateMethods.syncPlanetaryUI.call(this);
  }

  populatePresets() {
    const sel = document.getElementById('locationPreset');
    LOCATION_PRESETS.forEach((loc, i) => {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = `${loc.name} (${FormatNumbers.fixed(loc.baseYield, 0)} MWh/MWdc-yr)`;
      sel.appendChild(opt);
    });

    const mountSel = document.getElementById('mountingType');
    mountSel.innerHTML = Object.entries(MOUNTING_TYPES).map(([key, value]) =>
      `<option value="${key}">${value.label}</option>`
    ).join('');

    const aiReliabilitySel = document.getElementById('aiReliabilityTarget');
    if (aiReliabilitySel) {
      aiReliabilitySel.innerHTML = AI_RELIABILITY_OPTIONS.map(option =>
        `<option value="${option.value}">${option.label}</option>`
      ).join('');
    }

    const policySel = document.getElementById('policyMode');
    if (policySel) {
      policySel.innerHTML = PolicyModel.getSelectGroups().map(group => {
        if (group.label === 'Baseline' && group.options.length === 1) {
          return `<option value="${group.options[0].id}">${group.options[0].label}</option>`;
        }
        const optionsHtml = group.options
          .map(option => `<option value="${option.id}">${option.label}</option>`)
          .join('');
        return `<optgroup label="${group.label}">${optionsHtml}</optgroup>`;
      }).join('');
    }
  }

  renderModuleControls() {
    const supported = ModuleCatalog.getSupportedModules();
    const supportedHtml = supported.map(module => this.renderSupportedModule(module)).join('');
    document.getElementById('supportedModuleList').innerHTML = supportedHtml;

    const grouped = ModuleCatalog.groupByFamily(ModuleCatalog.getExploratoryModules());

    const exploratoryHtml = Object.entries(grouped).map(([family, modules]) => `
      <div class="module-family">
        <div class="module-family-title">${ModuleCatalog.getFamilyLabel(family)}</div>
        ${modules.map(module => this.renderExploratoryModule(module)).join('')}
      </div>
    `).join('');

    document.getElementById('exploratoryModuleGroups').innerHTML = exploratoryHtml;
  }

  renderExploratoryMarketControls() {
    const container = document.getElementById('exploratoryMarketControls');
    if (!container) return;

    const controls = ModuleCatalog.getExploratoryModules()
      .map(module => {
        const marketConfig = ModuleCatalog.getMarketConfig(module.id, this.state[`${module.id}Route`]);
        if (!marketConfig) return '';
        const priceKey = `${module.id}Price`;
        const currentValue = this.state[priceKey] ?? marketConfig.defaultValue;
        return `
          <div id="${module.id}MarketWrap" class="market-exploratory-group" style="display:none;">
            <div class="module-note-title">${module.label}</div>
            <label>
              <span id="${module.id}MarketLabel">${marketConfig.label} (${marketConfig.unitLabel})</span>
              <input type="range" id="${priceKey}" min="${marketConfig.min}" max="${marketConfig.max}" step="${marketConfig.step}" value="${currentValue}">
              <span class="range-value" id="${priceKey}Value">${this.formatModuleMarketValue(module.id, currentValue)}</span>
            </label>
          </div>
        `;
      })
      .join('');

    container.innerHTML = controls;
  }

  renderPolicyInputs() {
    const container = document.getElementById('policyInputControls');
    if (!container) return;

    const policy = this.getPolicyConfig();
    const inputs = PolicyModel.getInputDetails(this.state, policy);

    if (!inputs.length) {
      container.innerHTML = `
        <div class="field-note compact-note">
          This scheme does not need a user-entered support parameter in the current model.
        </div>
      `;
      return;
    }

    container.innerHTML = inputs.map(input => `
      <label>
        ${input.label}
        <input
          type="range"
          id="${input.key}"
          min="${input.min}"
          max="${input.max}"
          step="${input.step}"
          value="${input.value}"
        >
        <span class="range-value" id="${input.key}Value">${input.formattedValue}</span>
      </label>
    `).join('');

    inputs.forEach(input => {
      const el = document.getElementById(input.key);
      if (!el) return;
      el.addEventListener('input', () => {
        this.state[input.key] = parseFloat(el.value);
        const display = document.getElementById(`${input.key}Value`);
        if (display) {
          display.textContent = PolicyModel.formatInputValue(input, el.value);
        }
        this.syncDynamicVisibility();
        this.requestRecalculate({ includeSensitivity: false });
      });
    });
  }

  renderExploratoryOmControls() {
    const container = document.getElementById('exploratoryOmControls');
    if (!container) return;

    container.innerHTML = `
      <div id="exploratoryOmWrap" class="market-exploratory-group" style="display:none;">
        <div class="module-note-title">Shared exploratory plants</div>
        <label>
          Exploratory M&amp;O (% CAPEX / yr)
          <input type="range" id="exploratoryOmPercent" min="0" max="20" step="0.5" value="${this.state.exploratoryOmPercent ?? 4}">
          <span class="range-value" id="exploratoryOmPercentValue">${this.formatExploratoryOmPercent(this.state.exploratoryOmPercent ?? 4)}</span>
        </label>
      </div>
    `;
  }

  renderModuleBufferControl(module, route = null) {
    if (!Calc.hasModuleFeedBufferSupport(module.id)) return '';

    const bufferKey = `${module.id}BufferEnabled`;
    const wrapId = `${module.id}BufferWrap`;
    const showControl = Calc.moduleSupportsFeedBuffer(module.id, route);
    return `
      <div id="${wrapId}"${showControl ? '' : ' style="display:none;"'}>
        <label class="toggle-label">
          <input type="checkbox" id="${bufferKey}" ${this.state[bufferKey] ? 'checked' : ''}>
          <span>${Calc.getModuleFeedBufferLabel(module.id, route)}</span>
        </label>
      </div>
    `;
  }

  renderSupportedModule(module) {
    const selectedPreset = this.getSelectedModulePreset(module.id);
    const presetControl = ModuleCatalog.hasPresets(module)
      ? `
        <label>Preset
          <select id="${module.id}Preset">
            <option value="custom" ${selectedPreset === 'custom' ? 'selected' : ''}>Custom values</option>
            ${ModuleCatalog.getPresets(module).map(preset => `
              <option value="${preset.value}" ${selectedPreset === preset.value ? 'selected' : ''}>${preset.label}</option>
            `).join('')}
          </select>
        </label>
      `
      : '';
    const configs = module.configs.map(config => `
      <label>${config.label}
        <input type="range" id="${config.key}" min="${config.min}" max="${config.max}" step="${config.step}" value="${this.state[config.key]}">
        <span class="range-value" id="${config.key}Value">${this.formatConfigValue(config.unit, this.state[config.key])}</span>
      </label>
    `).join('');
    const assetLifeKey = ModuleCatalog.getAssetLifeKey(module);
    const assetLifeControl = assetLifeKey ? `
      <label>Asset Life (years)
        <input type="range" id="${assetLifeKey}" min="3" max="20" step="1" value="${this.state[assetLifeKey]}">
        <span class="range-value" id="${assetLifeKey}Value">${FormatNumbers.fixed(parseInt(this.state[assetLifeKey], 10), 0)} years</span>
      </label>
    ` : '';
    const bufferControl = this.renderModuleBufferControl(module);

    const allocNote = (module.id === 'electrolyzer' || module.id === 'dac')
      ? `<div class="info-row"><span>Power share:</span><span id="${module.id}AllocMode" class="highlight">Auto-balanced</span></div>`
      : '';

    return `
      <div class="process-card ${module.kind === 'product' ? 'product-card' : ''}" data-process="${module.id}">
        <div class="process-header">
          <label class="toggle-label">
            <input type="checkbox" id="${module.id}Enabled" ${this.state[`${module.id}Enabled`] ? 'checked' : ''}>
            <span>${module.label}</span>
          </label>
          <span class="maturity-badge supported">${module.exploratory ? 'Exploratory' : 'Supported'}</span>
        </div>
        <div class="process-config disabled-group ${this.state[`${module.id}Enabled`] ? 'active' : ''}" id="${module.id}Config">
          ${presetControl}
          ${configs}
          ${assetLifeControl}
          ${bufferControl}
          ${allocNote}
        </div>
      </div>
    `;
  }

  renderExploratoryModule(module) {
    const routeOptions = ModuleCatalog.getRouteOptions(module).map(option =>
      `<option value="${option.value}" ${this.state[`${module.id}Route`] === option.value ? 'selected' : ''}>${option.label}</option>`
    ).join('');
    const priorityKey = `${module.id}PriorityWeight`;
    const capexKey = `${module.id}CapexBasis`;
    const capexControl = Calc.getModuleCapexControlConfig(module.id, this.state[`${module.id}Route`]);
    const priorityControl = `
      <label>Shared Pool Priority
        <input type="range" id="${priorityKey}" min="0" max="100" step="5" value="${this.state[priorityKey] ?? 100}">
        <span class="range-value" id="${priorityKey}Value">${this.formatExploratoryPriorityWeight(this.state[priorityKey] ?? 100)}</span>
      </label>
    `;
    const capexBlock = `
      <label>
        <span id="${module.id}CapexBasisLabel">CAPEX (${capexControl.unitLabel})</span>
        <input type="range" id="${capexKey}" min="${capexControl.min}" max="${capexControl.max}" step="${capexControl.step}" value="${this.state[capexKey] ?? capexControl.defaultValue}">
        <span class="range-value" id="${capexKey}Value">${this.formatExploratoryCapexBasis(module.id, this.state[capexKey] ?? capexControl.defaultValue)}</span>
      </label>
    `;
    const bufferControl = this.renderModuleBufferControl(module, this.state[`${module.id}Route`]);
    const extraControls = module.id === 'mtg' ? `
      <div id="mtgMethanolSplitControl">
        <label>Methanol Diverted to MTG
          <input type="range" id="mtgMethanolSplit" min="0" max="100" step="1" value="${this.state.mtgMethanolSplit}">
          <span class="range-value" id="mtgMethanolSplitValue">${this.formatMtgMethanolSplit(this.state.mtgMethanolSplit)}</span>
        </label>
      </div>
    ` : '';

    return `
      <div class="process-card exploratory-card" data-process="${module.id}">
        <div class="process-header">
          <label class="toggle-label">
            <input type="checkbox" id="${module.id}Enabled" ${this.state[`${module.id}Enabled`] ? 'checked' : ''}>
            <span>${module.label}</span>
          </label>
          <span class="maturity-badge exploratory">${module.exploratory ? 'Exploratory' : 'Supported'}</span>
        </div>
        <div class="process-config disabled-group ${this.state[`${module.id}Enabled`] ? 'active' : ''}" id="${module.id}Config">
          <label>Route Choice
            <select id="${module.id}Route">${routeOptions}</select>
          </label>
          ${bufferControl}
          ${capexBlock}
          ${priorityControl}
          ${extraControls}
          <div class="field-note compact-note">
            Shared power and modeled feedstock pools normalize from the active exploratory priority sliders. Active exploratory outputs now carry route CAPEX, O&amp;M, and sale-price assumptions into ROI.
          </div>
          <div class="missing-assumptions">
            <div class="module-note-title">Key missing assumptions</div>
            <ul class="missing-list">
              ${ModuleCatalog.getMissingInputs(module).map(item => `<li>${item}</li>`).join('')}
            </ul>
          </div>
        </div>
      </div>
    `;
  }

  bindControls() {
    return AppControlMethods.bindControls.call(this);
  }

  initSharedState() {
    return AppShareStateMethods.initSharedState.call(this);
  }

  bindShareControls() {
    return AppShareStateMethods.bindShareControls.call(this);
  }

  scheduleShareStateUrlSync() {
    return AppShareStateMethods.scheduleShareStateUrlSync.call(this);
  }

  syncShareStateUrl() {
    return AppShareStateMethods.syncShareStateUrl.call(this);
  }

  resetState() {
    return AppShareStateMethods.resetState.call(this);
  }

  bindLoadConfigTabs() {
    return AppControlMethods.bindLoadConfigTabs.call(this);
  }

  syncLoadConfigTabs() {
    return AppControlMethods.syncLoadConfigTabs.call(this);
  }

  bindModuleControls() {
    return AppControlMethods.bindModuleControls.call(this);
  }

  enforceModuleDependencies() {
    this.state = Calc.enforceModuleDependencies(this.state);
    this.syncStateToControls();
  }

  handleLocationEdited() {
    return AppControlMethods.handleLocationEdited.call(this);
  }

  on(id, event, handler) {
    return AppControlMethods.on.call(this, id, event, handler);
  }

  bindRange(id, stateKey, formatter, extra) {
    return AppControlMethods.bindRange.call(this, id, stateKey, formatter, extra);
  }

  requestRecalculate(options = {}) {
    const includeSensitivity = options.includeSensitivity !== false;

    if (this.pendingRecalculateOptions) {
      this.pendingRecalculateOptions.includeSensitivity ||= includeSensitivity;
    } else {
      this.pendingRecalculateOptions = { includeSensitivity };
    }

    if (this.pendingRecalculateFrame !== null) return;

    this.pendingRecalculateFrame = window.requestAnimationFrame(() => {
      const pendingOptions = this.pendingRecalculateOptions || {};
      this.pendingRecalculateFrame = null;
      this.pendingRecalculateOptions = null;
      this.recalculate(pendingOptions);
    });
  }

  scheduleSensitivityUpdate(results = this.lastResults) {
    this.pendingSensitivityResults = results;
    clearTimeout(this.pendingSensitivityTimer);
    this.pendingSensitivityTimer = window.setTimeout(() => {
      this.pendingSensitivityTimer = null;
      const pendingResults = this.pendingSensitivityResults || this.lastResults;
      this.pendingSensitivityResults = null;
      if (pendingResults) this.updateSensitivityChart(pendingResults);
    }, this.sensitivityDebounceMs);
  }

  flushSensitivityUpdate(results = this.lastResults) {
    clearTimeout(this.pendingSensitivityTimer);
    this.pendingSensitivityTimer = null;
    this.pendingSensitivityResults = null;
    if (results) this.updateSensitivityChart(results);
  }

  bindOptimizeButtons() {
    return AppOptimizerMethods.bindOptimizeButtons.call(this);
  }

  bindIrrOptimizerButton(buttonId, options) {
    return AppOptimizerMethods.bindIrrOptimizerButton.call(this, buttonId, options);
  }

  captureOptimizerButtonDefaults(button) {
    return AppOptimizerMethods.captureOptimizerButtonDefaults.call(this, button);
  }

  setOptimizerButtonProgress(button, progress = {}) {
    return AppOptimizerMethods.setOptimizerButtonProgress.call(this, button, progress);
  }

  resetOptimizerButton(button) {
    return AppOptimizerMethods.resetOptimizerButton.call(this, button);
  }

  async findBestRangeValueForIrr(
    { inputId, stateKey, maxCoarseSamples = 257, maxTopRegions = 5 },
    onProgress = null
  ) {
    return AppOptimizerMethods.findBestRangeValueForIrr.call(
      this,
      { inputId, stateKey, maxCoarseSamples, maxTopRegions },
      onProgress
    );
  }

  getOptimizerWorker() {
    return AppOptimizerMethods.getOptimizerWorker.call(this);
  }

  requestOptimizerWorkerSearch(search, onProgress = null) {
    return AppOptimizerMethods.requestOptimizerWorkerSearch.call(this, search, onProgress);
  }

  syncBatteryEnabledState() {
    this.state.batteryEnabled = Number.isFinite(this.state.batteryCapacityMWh) && this.state.batteryCapacityMWh > 1e-9;
  }

  applyNormalizedState(normalizedState) {
    if (!normalizedState || typeof normalizedState !== 'object') return;
    const changed = Object.keys(normalizedState).some(key => this.state[key] !== normalizedState[key]);
    if (!changed) return;
    this.state = { ...normalizedState };
    this.syncStateToControls();
    this.syncDynamicVisibility();
  }

  showCalculationError(error) {
    console.error('Calculation error', error);
    document.getElementById('metricCapex').textContent = '—';
    document.getElementById('metricRevenue').textContent = '—';
    document.getElementById('metricPayback').textContent = '—';
    document.getElementById('metricIRR').textContent = '—';
    const viability = document.getElementById('metricViability');
    const label = document.getElementById('metricViabilityValue');
    viability.classList.remove('viable', 'marginal', 'not-viable');
    viability.classList.add('not-viable');
    label.textContent = 'Calculation error';
  }

  bindNumber(id, stateKey, extra) {
    return AppControlMethods.bindNumber.call(this, id, stateKey, extra);
  }

  bindSectionToggles() {
    document.querySelectorAll('.section-header').forEach(header => {
      header.addEventListener('click', () => {
        const section = header.closest('.config-section, .results-section');
        section.classList.toggle('open');
        window.requestAnimationFrame(() => this.positionSliderMarkers());
      });
    });
  }

  bindMobilePaneControls() {
    this.mobileLayoutQuery = window.matchMedia('(max-width: 900px)');
    this.mobilePaneButtons = Array.from(document.querySelectorAll('.mobile-pane-toggle'));
    this.mobilePanels = Array.from(document.querySelectorAll('.config-panel, .diagram-area, .results-panel'));

    this.mobilePaneButtons.forEach(button => {
      button.addEventListener('click', () => {
        const panelId = button.dataset.panelTarget;
        if (!panelId) return;
        const nextPanelId = this.activeMobilePanelId === panelId
          ? this.getDefaultMobilePanelId()
          : panelId;
        this.setMobilePanel(nextPanelId);
      });
    });

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        this.setMobilePanel(this.getDefaultMobilePanelId());
      }
    });

    const handleLayoutChange = () => {
      if (!this.isMobileViewport()) {
        this.activeMobilePanelId = null;
      } else if (!this.mobilePanels.some(panel => panel.id === this.activeMobilePanelId)) {
        this.activeMobilePanelId = this.getDefaultMobilePanelId();
      }
      this.syncMobilePaneState();
    };

    if (this.mobileLayoutQuery?.addEventListener) {
      this.mobileLayoutQuery.addEventListener('change', handleLayoutChange);
    } else if (this.mobileLayoutQuery?.addListener) {
      this.mobileLayoutQuery.addListener(handleLayoutChange);
    }

    this.syncMobilePaneState();
  }

  isMobileViewport() {
    return window.innerWidth <= 900;
  }

  getDefaultMobilePanelId() {
    return 'diagramArea';
  }

  setMobilePanel(panelId) {
    const nextPanelId = this.isMobileViewport()
      ? (panelId || this.getDefaultMobilePanelId())
      : null;
    const panelChanged = nextPanelId !== this.activeMobilePanelId;
    this.activeMobilePanelId = nextPanelId;
    this.syncMobilePaneState();
    if (panelChanged && this.isMobileViewport()) {
      document.getElementById('mobilePaneBar')?.scrollIntoView({ block: 'start' });
    }
  }

  syncMobilePaneState() {
    const activeId = this.isMobileViewport()
      ? (this.activeMobilePanelId || this.getDefaultMobilePanelId())
      : null;

    this.mobilePanels.forEach(panel => {
      const isActive = panel.id === activeId;
      panel.classList.toggle('mobile-open', isActive);
      panel.setAttribute('aria-hidden', this.isMobileViewport() ? String(!isActive) : 'false');
    });

    this.mobilePaneButtons.forEach(button => {
      const isActive = button.dataset.panelTarget === activeId;
      button.classList.toggle('active', isActive);
      button.setAttribute('aria-expanded', String(isActive));
    });

    window.requestAnimationFrame(() => this.positionSliderMarkers());
  }

  createHoverTooltip() {
    if (this.hoverTooltip) return;

    this.hoverTooltip = document.createElement('div');
    this.hoverTooltip.className = 'hover-tooltip';
    document.body.appendChild(this.hoverTooltip);

    window.addEventListener('scroll', () => this.hideHoverTooltip(), true);
    window.addEventListener('resize', () => {
      this.hideHoverTooltip();
      this.positionSliderMarkers();
    });
  }

  bindHoverTooltips() {
    if (this.hoverTooltipBindingsAttached) return;
    this.hoverTooltipBindingsAttached = true;

    const resolveTooltipTarget = rawTarget => {
      const element = rawTarget && typeof rawTarget.closest === 'function'
        ? rawTarget
        : rawTarget?.parentElement;
      if (!element || typeof element.closest !== 'function') return null;
      return element.closest('[data-tooltip]');
    };

    document.addEventListener('mouseover', event => {
      const target = resolveTooltipTarget(event.target);
      if (!target?.dataset.tooltip) return;
      if (target.contains(event.relatedTarget)) return;
      this.showHoverTooltip(target, target.dataset.tooltip);
    });

    document.addEventListener('mouseout', event => {
      const target = resolveTooltipTarget(event.target);
      if (!target) return;
      if (target.contains(event.relatedTarget)) return;
      this.hideHoverTooltip();
    });

    document.addEventListener('focusin', event => {
      const target = resolveTooltipTarget(event.target);
      if (!target?.dataset.tooltip) return;
      this.showHoverTooltip(target, target.dataset.tooltip);
    });

    document.addEventListener('focusout', event => {
      const target = resolveTooltipTarget(event.target);
      if (!target) return;
      this.hideHoverTooltip();
    });
  }

  initSliderMarkers() {
    this.sliderMarkerBindings = [];

    Object.entries(SLIDER_MARKERS).forEach(([id, markers]) => {
      const input = document.getElementById(id);
      if (!input) return;

      const wrap = this.ensureRangeInputWrap(input);
      let markerLayer = wrap.querySelector('.slider-markers');
      if (!markerLayer) {
        markerLayer = document.createElement('div');
        markerLayer.className = 'slider-markers';
        wrap.appendChild(markerLayer);
      }

      const min = parseFloat(input.min);
      const max = parseFloat(input.max);
      if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return;

      const formatter = this.rangeBindings.find(binding => binding.id === id)?.formatter;
      markerLayer.innerHTML = '';

      markers.forEach(marker => {
        if (marker.value < min || marker.value > max) return;

        const markerButton = document.createElement('button');
        markerButton.type = 'button';
        markerButton.className = 'slider-marker';

        const valueText = formatter ? formatter(marker.value) : String(marker.value);
        const tooltipText = `${valueText} - ${marker.label}`;
        markerButton.dataset.tooltip = tooltipText;
        markerButton.setAttribute('aria-label', tooltipText);

        markerButton.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          input.value = String(marker.value);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.focus();
        });

        markerLayer.appendChild(markerButton);
        this.sliderMarkerBindings.push({ input, markerButton, min, max, value: marker.value });
      });
    });

    this.positionSliderMarkers();
  }

  ensureRangeInputWrap(input) {
    if (input.parentElement?.classList.contains('range-input-wrap')) {
      return input.parentElement;
    }

    const wrap = document.createElement('div');
    wrap.className = 'range-input-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    return wrap;
  }

  positionSliderMarkers() {
    this.sliderMarkerBindings.forEach(({ input, markerButton, min, max, value }) => {
      const width = input.getBoundingClientRect().width;
      if (!width || max <= min) return;

      const thumbSize = this.getRangeThumbSize(input);
      const ratio = (value - min) / (max - min);
      const left = (thumbSize / 2) + (ratio * Math.max(0, width - thumbSize));
      markerButton.style.left = `${left}px`;
    });
  }

  getRangeThumbSize(input) {
    const cssValue = getComputedStyle(input).getPropertyValue('--range-thumb-size').trim();
    const parsed = parseFloat(cssValue);
    return Number.isFinite(parsed) ? parsed : 14;
  }

  showHoverTooltip(target, text) {
    if (!this.hoverTooltip || !text) return;

    this.hoverTooltip.textContent = text;
    this.hoverTooltip.classList.add('visible');

    const rect = target.getBoundingClientRect();
    const tooltipRect = this.hoverTooltip.getBoundingClientRect();
    const margin = 8;
    const left = Math.min(
      window.innerWidth - tooltipRect.width - margin,
      Math.max(margin, rect.left + (rect.width / 2) - (tooltipRect.width / 2))
    );
    const preferredTop = rect.top - tooltipRect.height - 10;
    const top = preferredTop >= margin
      ? preferredTop
      : Math.min(window.innerHeight - tooltipRect.height - margin, rect.bottom + 10);

    this.hoverTooltip.style.left = `${left}px`;
    this.hoverTooltip.style.top = `${top}px`;
  }

  hideHoverTooltip() {
    if (!this.hoverTooltip) return;
    this.hoverTooltip.classList.remove('visible');
  }

  initSiteMap() {
    return AppSiteMapMethods.initSiteMap.call(this);
  }

  showSiteMapMessage(message, noteText) {
    return AppSiteMapMethods.showSiteMapMessage.call(this, message, noteText);
  }

  showSiteMap(noteText) {
    return AppSiteMapMethods.showSiteMap.call(this, noteText);
  }

  getSquareBounds(lat, lon, sideMeters, minSideMeters = 20) {
    return AppSiteMapMethods.getSquareBounds.call(this, lat, lon, sideMeters, minSideMeters);
  }

  formatArea(areaM2) {
    return AppSiteMapMethods.formatArea.call(this, areaM2);
  }

  formatDistance(meters) {
    return AppSiteMapMethods.formatDistance.call(this, meters);
  }

  hexToRgba(hex, alpha) {
    return AppSiteMapMethods.hexToRgba.call(this, hex, alpha);
  }

  getSiteFootprintColor(id) {
    return AppSiteMapMethods.getSiteFootprintColor.call(this, id);
  }

  getSiteFootprintAbbreviation(id) {
    return AppSiteMapMethods.getSiteFootprintAbbreviation.call(this, id);
  }

  buildSiteFootprintEstimate(r) {
    return AppSiteMapMethods.buildSiteFootprintEstimate.call(this, r);
  }

  renderSiteFootprintEstimate() {
    return AppSiteMapMethods.renderSiteFootprintEstimate.call(this);
  }

  offsetLatLon(lat, lon, offsetXMeters, offsetYMeters) {
    return AppSiteMapMethods.offsetLatLon.call(this, lat, lon, offsetXMeters, offsetYMeters);
  }

  clearSiteMapModuleSquares() {
    return AppSiteMapMethods.clearSiteMapModuleSquares.call(this);
  }

  renderSiteMapModuleSquares(lat, lon, footprint) {
    return AppSiteMapMethods.renderSiteMapModuleSquares.call(this, lat, lon, footprint);
  }

  formatSystemSizeMW(v) {
    const mw = parseFloat(v);
    if (!Number.isFinite(mw)) return '—';
    if (mw >= 1000) return `${FormatNumbers.fixed(mw / 1000, 2)} GW`;
    return `${FormatNumbers.fixed(mw, 1)} MW`;
  }

  syncStateToControls() {
    return AppControlMethods.syncStateToControls.call(this);
  }

  syncRangeDisplay(id, value, formatter) {
    return AppControlMethods.syncRangeDisplay.call(this, id, value, formatter);
  }

  formatMethaneFeedstockSplit(value) {
    const methaneShare = Math.max(0, Math.min(100, parseFloat(value)));
    const methanolShare = Math.max(0, 100 - methaneShare);
    return `${FormatNumbers.fixed(methaneShare, 0)}% methane / ${FormatNumbers.fixed(methanolShare, 0)}% methanol`;
  }

  formatChemicalSizingPercent(value) {
    const percent = Math.max(0, Math.min(100, parseFloat(value)));
    return `${FormatNumbers.fixed(percent, 0)}% of full-capture peak`;
  }

  formatExploratoryPriorityWeight(value) {
    return `${FormatNumbers.fixed(parseFloat(value), 0)} weight`;
  }

  formatExploratoryCapexBasis(moduleId, value) {
    const capexConfig = Calc.getModuleCapexControlConfig(moduleId, this.state[`${moduleId}Route`]);
    const digits = capexConfig.step < 1 ? 2 : 0;
    return `$${FormatNumbers.fixed(parseFloat(value), digits)}/${capexConfig.unitLabel.replace('$/', '')}`;
  }

  formatExploratoryOmPercent(value) {
    return `${FormatNumbers.fixed(parseFloat(value), 1)}%/yr`;
  }

  getSelectedEarthDayIndex() {
    return Math.max(0, Math.min(364, (this.state.dayOfYear || 1) - 1));
  }

  getSelectedDayLabel() {
    return `${SolarGeometry.dayToDateString(this.state.dayOfYear)}${SolarGeometry.notableDay(this.state.dayOfYear)}`;
  }

  sliceSelectedEarthDaySeries(series) {
    if (!Array.isArray(series) || !series.length) return [];
    const start = this.getSelectedEarthDayIndex() * 24;
    const slice = series.slice(start, start + 24);
    return slice.length === 24 ? slice : [];
  }

  getDisplaySolarGeometry(r = this.lastResults) {
    if (r?.solar?.bodyKey === 'earth' && this.state.dayMode === 'specific') {
      return SolarGeometry.dailyProfile(this.state.latitude, this.state.dayOfYear, this.state.mountingType);
    }
    return r?.solar?.solarGeo || null;
  }

  getSelectedDayDisplayContext(r = this.lastResults) {
    if (!r || r.solar.bodyKey !== 'earth' || this.state.dayMode !== 'specific') return null;

    const solarHourlyKW = this.sliceSelectedEarthDaySeries(r.annualSolar?.hourlyKW);
    if (solarHourlyKW.length !== 24) return null;

    const dispatch = r.ai.enabled ? r.ai.dispatch : r.annualChemicalDisplayDispatch;
    if (!dispatch) return null;

    const chemicalHourlyKW = this.sliceSelectedEarthDaySeries(dispatch.chemicalHourlyKW);
    if (chemicalHourlyKW.length !== 24) return null;

    const aiHourlyKW = r.ai.enabled ? this.sliceSelectedEarthDaySeries(dispatch.aiHourlyKW) : [];
    const batteryChargeHourlyKW = this.sliceSelectedEarthDaySeries(dispatch.batteryChargeHourlyKW);
    const clippedHourlyKW = this.sliceSelectedEarthDaySeries(dispatch.clippedHourlyKW);
    const sumSeries = series => series.reduce((sum, value) => sum + (Number(value) || 0), 0);

    return {
      selectedDayIndex: this.getSelectedEarthDayIndex(),
      selectedDayLabel: this.getSelectedDayLabel(),
      solarHourlyKW,
      aiHourlyKW,
      batteryChargeHourlyKW: batteryChargeHourlyKW.length === 24 ? batteryChargeHourlyKW : new Array(24).fill(0),
      chemicalHourlyKW,
      clippedHourlyKW: clippedHourlyKW.length === 24 ? clippedHourlyKW : new Array(24).fill(0),
      aiDailyKWh: aiHourlyKW.length === 24 ? sumSeries(aiHourlyKW) : 0,
      chemicalDailyKWh: sumSeries(chemicalHourlyKW),
    };
  }

  buildDiagramDisplayResults(r = this.lastResults) {
    const displayContext = this.getSelectedDayDisplayContext(r);
    if (!displayContext) return r;

    const baseDailyKWh = Math.max(0, r.effectiveDailyKWh || 0);
    const dailyScale = baseDailyKWh > 1e-9 ? displayContext.chemicalDailyKWh / baseDailyKWh : 0;
    const scaleMetric = value => Number.isFinite(value) ? value * dailyScale : value;
    const scaleSupportedModule = module => {
      if (!module) return module;
      return {
        ...module,
        ch4DailyKg: scaleMetric(module.ch4DailyKg),
        ch4DailyMCF: scaleMetric(module.ch4DailyMCF),
        h2Consumed: scaleMetric(module.h2Consumed),
        co2Consumed: scaleMetric(module.co2Consumed),
        waterProducedDaily: scaleMetric(module.waterProducedDaily),
        dailyKg: scaleMetric(module.dailyKg),
        grossDailyKg: scaleMetric(module.grossDailyKg),
        dailyLiters: scaleMetric(module.dailyLiters),
        grossDailyLiters: scaleMetric(module.grossDailyLiters),
        exportDailyKg: scaleMetric(module.exportDailyKg),
      };
    };
    const scaleExploratoryModule = module => {
      if (!module) return module;
      return {
        ...module,
        dailyKWh: scaleMetric(module.dailyKWh),
        outputDailyUnits: scaleMetric(module.outputDailyUnits),
        h2Consumed: scaleMetric(module.h2Consumed),
        co2Consumed: scaleMetric(module.co2Consumed),
        methanolConsumed: scaleMetric(module.methanolConsumed),
      };
    };
    const aiUtilization = r.ai.enabled && r.ai.designLoadKW > 0
      ? Math.max(0, Math.min(1, displayContext.aiDailyKWh / (r.ai.designLoadKW * 24)))
      : r.ai.utilization;

    return {
      ...r,
      ai: r.ai.enabled ? { ...r.ai, utilization: aiUtilization } : r.ai,
      electrolyzer: r.electrolyzer ? {
        ...r.electrolyzer,
        dailyKWh: scaleMetric(r.electrolyzer.dailyKWh),
        h2DailyKg: scaleMetric(r.electrolyzer.h2DailyKg),
        waterDailyKg: scaleMetric(r.electrolyzer.waterDailyKg),
      } : r.electrolyzer,
      dac: r.dac ? {
        ...r.dac,
        dailyKWh: scaleMetric(r.dac.dailyKWh),
        co2DailyKg: scaleMetric(r.dac.co2DailyKg),
      } : r.dac,
      sabatier: scaleSupportedModule(r.sabatier),
      methanol: scaleSupportedModule(r.methanol),
      supportedModules: (r.supportedModules || []).map(scaleSupportedModule),
      exploratoryModules: (r.exploratoryModules || []).map(scaleExploratoryModule),
      h2Surplus: scaleMetric(r.h2Surplus),
      co2Surplus: scaleMetric(r.co2Surplus),
    };
  }

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
  }

  formatMtgMethanolSplit(value) {
    const mtgShare = Math.max(0, Math.min(100, parseFloat(value)));
    const exportShare = Math.max(0, 100 - mtgShare);
    return `${FormatNumbers.fixed(mtgShare, 0)}% MTG / ${FormatNumbers.fixed(exportShare, 0)}% export`;
  }

  formatModuleMarketValue(moduleId, value) {
    const marketConfig = ModuleCatalog.getMarketConfig(moduleId, this.state[`${moduleId}Route`]);
    if (!marketConfig) return `$${FormatNumbers.fixed(parseFloat(value), 2)}`;
    const digits = marketConfig.step < 1 ? 2 : 0;
    return `$${FormatNumbers.fixed(parseFloat(value), digits)}/${marketConfig.unitLabel.replace('$/', '')}`;
  }

  formatExploratorySalePrice(moduleId, value) {
    return this.formatModuleMarketValue(moduleId, value);
  }

  syncDynamicVisibility() {
    return AppUiStateMethods.syncDynamicVisibility.call(this);
  }

  syncModuleCapexControl(moduleId) {
    return AppUiStateMethods.syncModuleCapexControl.call(this, moduleId);
  }

  syncExploratoryCapexControl(moduleId) {
    return this.syncModuleCapexControl(moduleId);
  }

  syncModuleMarketControl(moduleId) {
    return AppUiStateMethods.syncModuleMarketControl.call(this, moduleId);
  }

  syncDerivedFeedControls() {
    return AppUiStateMethods.syncDerivedFeedControls.call(this);
  }

  recalculate(options = {}) {
    const includeSensitivity = options.includeSensitivity !== false;
    if (this.pendingRecalculateFrame !== null) {
      window.cancelAnimationFrame(this.pendingRecalculateFrame);
      this.pendingRecalculateFrame = null;
      this.pendingRecalculateOptions = null;
    }
    this.syncBatteryEnabledState();
    this.syncPlanetaryUI();
    this.syncDerivedFeedControls();
    try {
      const r = Calc.calculateAll(this.state);
      this.applyNormalizedState(r.state);
      this.lastResults = r;
      this.updateInfoDisplays(r);
      this.updateDiagram(r);
      this.updateSiteMap(r);
      this.updateProduction(r);
      this.updateEconomics(r);
      this.updateHeaderMetrics(r);
      this.updatePlantScore(r);
      this.updatePowerChart(r);
      this.updateAnnualDispatchChart(r);
      this.updateEconomicsTimelineChart(r);
      this.updateEconChart(r);
      if (includeSensitivity) this.flushSensitivityUpdate(r);
      else this.scheduleSensitivityUpdate(r);
      this.updateImpact(r);
      this.scheduleShareStateUrlSync();
    } catch (error) {
      this.showCalculationError(error);
    }
  }

  updateInfoDisplays(r) {
    return AppRendererMethods.updateInfoDisplays.call(this, r);
  }

  updateHeaderMetrics(r) {
    return AppRendererMethods.updateHeaderMetrics.call(this, r);
  }

  updatePlantScore(r) {
    return AppRendererMethods.updatePlantScore.call(this, r);
  }

  updateDiagram(r) {
    return AppRendererMethods.updateDiagram.call(this, r);
  }

  updateSiteMap(r) {
    return AppSiteMapMethods.updateSiteMap.call(this, r);
  }

  updateProduction(r) {
    return AppRendererMethods.updateProduction.call(this, r);
  }

  prodItem(cls, _icon, label, value, unit) {
    return AppRendererMethods.prodItem.call(this, cls, _icon, label, value, unit);
  }

  updateEconomics(r) {
    return AppRendererMethods.updateEconomics.call(this, r);
  }

  econRow(label, value, cls = '', title = '') {
    return AppRendererMethods.econRow.call(this, label, value, cls, title);
  }

  updateImpact(r) {
    return AppRendererMethods.updateImpact.call(this, r);
  }

  updatePowerChart(r) {
    return AppChartMethods.updatePowerChart.call(this, r);
  }

  updateAnnualDispatchChart(r) {
    return AppChartMethods.updateAnnualDispatchChart.call(this, r);
  }

  updateEconomicsTimelineChart(r) {
    return AppChartMethods.updateEconomicsTimelineChart.call(this, r);
  }

  updateEconChart(r) {
    return AppChartMethods.updateEconChart.call(this, r);
  }

  updateSensitivityChart(r = this.lastResults) {
    return AppChartMethods.updateSensitivityChart.call(this, r);
  }

  formatConfigValue(unit, value) {
    return AppRendererMethods.formatConfigValue.call(this, unit, value);
  }

  formatMoney(val) {
    return AppRendererMethods.formatMoney.call(this, val);
  }

  formatIrr(val) {
    return AppRendererMethods.formatIrr.call(this, val);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => window.app.recalculate(), 200);
  });
});
