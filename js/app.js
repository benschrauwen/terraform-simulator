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
    this.init();
  }

  init() {
    this.populatePresets();
    this.renderModuleControls();
    this.renderExploratoryMarketControls();
    this.renderExploratoryOmControls();
    this.bindControls();
    this.createSliderTooltip();
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
    return POLICY_OPTIONS[this.state.policyMode] || POLICY_OPTIONS.none;
  }

  getMethaneMarketConfig() {
    return METHANE_MARKET_PRESETS[this.state.methaneMarketPreset] || METHANE_MARKET_PRESETS.terraform_commodity;
  }

  getPowerChartLabels(r) {
    return AppChartMethods.getPowerChartLabels.call(this, r);
  }

  syncPlanetaryUI() {
    const body = this.getBodyConfig();
    const averageTab = document.querySelector('.day-tab[data-mode="average"]');
    const specificTab = document.querySelector('.day-tab[data-mode="specific"]');
    const specificControls = document.getElementById('daySpecificControls');
    const dayModeNote = document.getElementById('dayModeNote');
    const irradianceLabel = document.getElementById('irradianceLabel');
    const sunHoursLabel = document.getElementById('sunHoursLabel');
    const opHoursLabel = document.getElementById('dailyOpHoursLabel');
    const siteYieldNote = document.getElementById('siteYieldNote');
    const powerChartNote = document.getElementById('powerChartNote');

    if (!body.supportsSpecificDay && this.state.dayMode === 'specific') {
      this.state.dayMode = 'average';
    }

    document.querySelectorAll('.day-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.mode === this.state.dayMode);
    });

    if (averageTab) averageTab.disabled = false;
    if (specificTab) {
      specificTab.disabled = !body.supportsSpecificDay;
      specificTab.classList.toggle('disabled', !body.supportsSpecificDay);
    }
    if (specificControls) {
      specificControls.style.display = body.supportsSpecificDay && this.state.dayMode === 'specific' ? 'block' : 'none';
    }
    if (dayModeNote) {
      dayModeNote.textContent = body.supportsSpecificDay
        ? ''
        : `${body.label} uses an average local solar cycle; specific Earth calendar days are disabled.`;
    }
    if (irradianceLabel) {
      irradianceLabel.textContent = body.label === 'Earth' ? 'GHI:' : 'Annual irradiation:';
    }
    if (sunHoursLabel) {
      sunHoursLabel.textContent = body.label === 'Earth' ? 'Avg Sun Hours:' : 'Illumination / cycle:';
    }
    if (opHoursLabel) {
      opHoursLabel.textContent = body.label === 'Earth' ? 'Daily Op Hours:' : 'Op Hours / Cycle:';
    }
    if (siteYieldNote) {
      siteYieldNote.innerHTML = body.label === 'Earth'
        ? `This is the long-run annual PV output per MWdc. For a more accurate site-specific number, use a
            cloud/weather-adjusted source such as
            <a href="https://joint-research-centre.ec.europa.eu/pvgis-online-tool_en" target="_blank" rel="noopener noreferrer">PVGIS</a>
            or
            <a href="https://globalsolaratlas.info/" target="_blank" rel="noopener noreferrer">Global Solar Atlas PVOUT</a>.`
        : body.siteYieldNote;
    }
    if (powerChartNote) {
      powerChartNote.textContent = body.chartNote || '';
    }
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
  }

  renderModuleControls() {
    const supported = MODULE_REGISTRY.filter(module => module.maturity === 'Supported');
    const supportedHtml = supported.map(module => this.renderSupportedModule(module)).join('');
    document.getElementById('supportedModuleList').innerHTML = supportedHtml;

    const familyLabels = {
      'air-water-chemistry': 'Air and water chemistry',
      'carbon-solids': 'Carbon solids',
      'calcination-minerals': 'Calcination and mineral decomposition',
      'oxide-reduction': 'Oxide reduction and metallurgy',
      'water-systems': 'Water systems',
    };

    const grouped = {};
    MODULE_REGISTRY.filter(module => module.maturity === 'Exploratory').forEach(module => {
      grouped[module.family] = grouped[module.family] || [];
      grouped[module.family].push(module);
    });

    const exploratoryHtml = Object.entries(grouped).map(([family, modules]) => `
      <div class="module-family">
        <div class="module-family-title">${familyLabels[family] || family}</div>
        ${modules.map(module => this.renderExploratoryModule(module)).join('')}
      </div>
    `).join('');

    document.getElementById('exploratoryModuleGroups').innerHTML = exploratoryHtml;
  }

  renderExploratoryMarketControls() {
    const container = document.getElementById('exploratoryMarketControls');
    if (!container) return;

    const controls = MODULE_REGISTRY
      .filter(module => module.maturity === 'Exploratory')
      .map(module => {
        const marketConfig = EXPLORATORY_MARKET_CONFIG[module.id];
        if (!marketConfig) return '';
        const priceKey = `${module.id}Price`;
        const currentValue = this.state[priceKey] ?? marketConfig.defaultValue;
        return `
          <div id="${module.id}MarketWrap" class="market-exploratory-group" style="display:none;">
            <div class="module-note-title">${module.label}</div>
            <label>
              ${marketConfig.label} (${marketConfig.unitLabel})
              <input type="range" id="${priceKey}" min="${marketConfig.min}" max="${marketConfig.max}" step="${marketConfig.step}" value="${currentValue}">
              <span class="range-value" id="${priceKey}Value">${this.formatExploratorySalePrice(module.id, currentValue)}</span>
            </label>
          </div>
        `;
      })
      .join('');

    container.innerHTML = controls;
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

  renderSupportedModule(module) {
    const configs = module.configs.map(config => `
      <label>${config.label}
        <input type="range" id="${config.key}" min="${config.min}" max="${config.max}" step="${config.step}" value="${this.state[config.key]}">
        <span class="range-value" id="${config.key}Value">${this.formatConfigValue(config.unit, this.state[config.key])}</span>
      </label>
    `).join('');
    const assetLifeKey = module.assetLifeKey;
    const assetLifeControl = assetLifeKey ? `
      <label>Asset Life (years)
        <input type="range" id="${assetLifeKey}" min="3" max="20" step="1" value="${this.state[assetLifeKey]}">
        <span class="range-value" id="${assetLifeKey}Value">${FormatNumbers.fixed(parseInt(this.state[assetLifeKey], 10), 0)} years</span>
      </label>
    ` : '';

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
          <span class="maturity-badge supported">${module.maturity}</span>
        </div>
        <div class="process-config disabled-group ${this.state[`${module.id}Enabled`] ? 'active' : ''}" id="${module.id}Config">
          ${configs}
          ${assetLifeControl}
          ${allocNote}
        </div>
      </div>
    `;
  }

  renderExploratoryModule(module) {
    const routeOptions = module.routeOptions.map(option =>
      `<option value="${option.value}" ${this.state[`${module.id}Route`] === option.value ? 'selected' : ''}>${option.label}</option>`
    ).join('');
    const priorityKey = `${module.id}PriorityWeight`;
    const capexKey = `${module.id}CapexBasis`;
    const capexControl = Calc.getExploratoryCapexControlConfig(module.id, this.state[`${module.id}Route`]);
    const priorityControl = `
      <label>Shared Pool Priority
        <input type="range" id="${priorityKey}" min="0" max="100" step="5" value="${this.state[priorityKey] ?? 100}">
        <span class="range-value" id="${priorityKey}Value">${this.formatExploratoryPriorityWeight(this.state[priorityKey] ?? 100)}</span>
      </label>
    `;
    const capexBlock = `
      <label>
        <span id="${module.id}CapexBasisLabel">Block CAPEX (${capexControl.unitLabel})</span>
        <input type="range" id="${capexKey}" min="${capexControl.min}" max="${capexControl.max}" step="${capexControl.step}" value="${this.state[capexKey] ?? capexControl.defaultValue}">
        <span class="range-value" id="${capexKey}Value">${this.formatExploratoryCapexBasis(module.id, this.state[capexKey] ?? capexControl.defaultValue)}</span>
      </label>
    `;
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
          <span class="maturity-badge exploratory">${module.maturity}</span>
        </div>
        <div class="process-config disabled-group ${this.state[`${module.id}Enabled`] ? 'active' : ''}" id="${module.id}Config">
          <label>Route Choice
            <select id="${module.id}Route">${routeOptions}</select>
          </label>
          ${capexBlock}
          ${priorityControl}
          ${extraControls}
          <div class="field-note compact-note">
            Shared power and modeled feedstock pools normalize from the active exploratory priority sliders. Active exploratory outputs now carry route CAPEX, O&amp;M, and sale-price assumptions into ROI.
          </div>
          <div class="missing-assumptions">
            <div class="module-note-title">Key missing assumptions</div>
            <ul class="missing-list">
              ${module.missingInputs.map(item => `<li>${item}</li>`).join('')}
            </ul>
          </div>
        </div>
      </div>
    `;
  }

  bindControls() {
    this.bindLoadConfigTabs();

    document.querySelectorAll('.day-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        if (tab.disabled) return;
        document.querySelectorAll('.day-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this.state.dayMode = tab.dataset.mode;
        document.getElementById('daySpecificControls').style.display = tab.dataset.mode === 'specific' ? 'block' : 'none';
        this.recalculate();
      });
    });

    this.bindRange('dayOfYear', 'dayOfYear', v => {
      const day = parseInt(v, 10);
      return `${SolarGeometry.dayToDateString(day)}${SolarGeometry.notableDay(day)}`;
    });

    document.querySelectorAll('.day-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        const day = parseInt(btn.dataset.day, 10);
        this.state.dayOfYear = day;
        this.syncRangeDisplay('dayOfYear', day);
        this.recalculate();
      });
    });

    this.on('locationPreset', 'change', val => {
      if (val === 'custom') return;
      const loc = LOCATION_PRESETS[parseInt(val, 10)];
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
      document.getElementById('locationPreset').value = 'custom';
    });

    this.bindRange('systemSize', 'systemSizeMW', v => this.formatSystemSizeMW(v));
    this.bindRange('panelEfficiency', 'panelEfficiency', v => `${FormatNumbers.fixed(parseFloat(v), 1)}%`);
    this.bindRange('panelCost', 'panelCostPerW', v => `$${FormatNumbers.fixed(parseFloat(v), 2)}/W`);
    this.bindRange('panelDegradationAnnual', 'panelDegradationAnnual', v => `${FormatNumbers.fixed(parseFloat(v), 2)}%/yr`);
    this.on('mountingType', 'change', val => {
      this.state.mountingType = val;
      this.state.bosCostPerW = MOUNTING_TYPES[val].typicalBOS;
      this.syncStateToControls();
    });
    this.bindRange('bosCost', 'bosCostPerW', v => `$${FormatNumbers.fixed(parseFloat(v), 2)}/W`);
    this.bindRange('landCost', 'landCostPerAcre', v => `$${Math.round(parseFloat(v)).toLocaleString()}/acre`);
    this.bindRange('sitePrepCost', 'sitePrepCostPerAcre', v => `$${Math.round(parseFloat(v)).toLocaleString()}/acre`);

    this.bindRange('batteryCapacity', 'batteryCapacityMWh', v => `${FormatNumbers.fixed(parseFloat(v), 1)} MWh`, () => {
      this.syncBatteryEnabledState();
    });
    this.bindRange('batteryCost', 'batteryCostPerKWh', v => `$${FormatNumbers.fixed(parseInt(v, 10), 0)}/kWh`);
    this.bindRange('batteryEfficiency', 'batteryEfficiency', v => `${FormatNumbers.fixed(parseInt(v, 10), 0)}%`);
    this.bindRange('batteryCycles', 'batteryCycles', v => parseInt(v, 10).toLocaleString());

    this.on('aiComputeEnabled', 'change', (_, el) => {
      this.state.aiComputeEnabled = el.checked;
      document.getElementById('aiComputeConfig').classList.toggle('active', el.checked);
      window.requestAnimationFrame(() => this.positionSliderMarkers());
    });
    this.on('aiReliabilityTarget', 'change', val => {
      this.state.aiReliabilityTarget = parseFloat(val);
    });
    this.bindRange('aiGpuCapexPerKW', 'aiGpuCapexPerKW', v => `$${Math.round(parseFloat(v)).toLocaleString()}/kW`);
    this.bindRange('aiTokenPrice', 'aiTokenPricePerM', v => `$${FormatNumbers.fixed(parseFloat(v), 2)} / 1M tokens`);
    this.bindRange('aiTokensPerMWh', 'aiMillionTokensPerMWh', v => `${Math.round(parseFloat(v)).toLocaleString()} M tokens/MWh`);
    this.bindRange('aiAssetLifeYears', 'aiAssetLifeYears', v => `${FormatNumbers.fixed(parseInt(v, 10), 0)} years`);

    this.bindModuleControls();

    this.bindRange('methaneFeedstockSplit', 'methaneFeedstockSplit', v => this.formatMethaneFeedstockSplit(v));
    this.bindRange('mtgMethanolSplit', 'mtgMethanolSplit', v => this.formatMtgMethanolSplit(v));
    this.on('methaneMarketPreset', 'change', val => {
      this.state.methaneMarketPreset = val;
      this.syncDynamicVisibility();
    });
    this.bindRange('methanePrice', 'methanePrice', v => `$${FormatNumbers.fixed(parseFloat(v), 2)}/MCF`);
    this.bindRange('methanolPrice', 'methanolPrice', v => `$${FormatNumbers.fixed(parseInt(v, 10), 0)}/ton`);
    MODULE_REGISTRY
      .filter(module => module.maturity === 'Exploratory' && EXPLORATORY_MARKET_CONFIG[module.id])
      .forEach(module => {
        const priceKey = `${module.id}Price`;
        this.bindRange(priceKey, priceKey, v => this.formatExploratorySalePrice(module.id, v));
      });
    this.bindRange('exploratoryOmPercent', 'exploratoryOmPercent', v => this.formatExploratoryOmPercent(v));

    this.on('policyMode', 'change', val => {
      this.state.policyMode = val;
      this.syncDynamicVisibility();
    });
    this.bindRange('customH2Credit', 'customH2Credit', v => `$${FormatNumbers.fixed(parseFloat(v), 2)}/kg`);
    this.bindRange('customCo2Credit', 'customCo2Credit', v => `$${FormatNumbers.fixed(parseInt(v, 10), 0)}/ton`);
    this.bindRange('solarAssetLife', 'solarAssetLife', v => `${FormatNumbers.fixed(parseInt(v, 10), 0)} years`);
    this.bindRange('analysisHorizonYears', 'analysisHorizonYears', v => `${FormatNumbers.fixed(parseInt(v, 10), 0)} years`);
    this.bindRange('discountRate', 'discountRate', v => `${FormatNumbers.fixed(parseFloat(v), 1)}%`);
    this.on('financingEnabled', 'change', (_, el) => {
      this.state.financingEnabled = el.checked;
      document.getElementById('financingConfig').classList.toggle('active', el.checked);
    });
    this.bindRange('debtShare', 'debtSharePercent', v => `${FormatNumbers.fixed(parseInt(v, 10), 0)}%`);
    this.bindRange('debtInterestRate', 'debtInterestRate', v => `${FormatNumbers.fixed(parseFloat(v), 2)}%`);
    this.bindRange('debtTermYears', 'debtTermYears', v => `${FormatNumbers.fixed(parseInt(v, 10), 0)} years`);
    this.bindRange('debtFeePercent', 'debtFeePercent', v => `${FormatNumbers.fixed(parseFloat(v), 2)}%`);

    this.bindRange('solarOmPercent', 'solarOmPercent', v => `${FormatNumbers.fixed(parseFloat(v), 1)}%/yr`);
    this.bindRange('processOmPercent', 'processOmPercent', v => `${FormatNumbers.fixed(parseFloat(v), 1)}%/yr`);
    this.bindRange('batteryOmPercent', 'batteryOmPercent', v => `${FormatNumbers.fixed(parseFloat(v), 1)}%/yr`);
    this.bindOptimizeButtons();
  }

  bindLoadConfigTabs() {
    document.querySelectorAll('.load-config-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        this.state.loadConfigTab = tab.dataset.loadTab || 'chemicals';
        this.syncLoadConfigTabs();
      });
    });
    this.syncLoadConfigTabs();
  }

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
  }

  bindModuleControls() {
    MODULE_REGISTRY.forEach(module => {
      const enabledKey = `${module.id}Enabled`;
      this.on(enabledKey, 'change', (_, el) => {
        this.state[enabledKey] = el.checked;
        this.enforceModuleDependencies();
        this.syncDerivedFeedControls();
      });

      if (module.maturity === 'Supported') {
        module.configs.forEach(config => {
          this.bindRange(config.key, config.key, v => this.formatConfigValue(config.unit, v));
        });
        if (module.assetLifeKey) {
          this.bindRange(module.assetLifeKey, module.assetLifeKey, v => `${FormatNumbers.fixed(parseInt(v, 10), 0)} years`);
        }
      } else {
        this.on(`${module.id}Route`, 'change', val => {
          this.state[`${module.id}Route`] = val;
          this.syncExploratoryCapexControl(module.id);
          this.enforceModuleDependencies();
          this.syncDynamicVisibility();
          this.syncDerivedFeedControls();
        });
        this.bindRange(
          `${module.id}CapexBasis`,
          `${module.id}CapexBasis`,
          v => this.formatExploratoryCapexBasis(module.id, v)
        );
        this.bindRange(
          `${module.id}PriorityWeight`,
          `${module.id}PriorityWeight`,
          v => this.formatExploratoryPriorityWeight(v)
        );
      }
    });
  }

  enforceModuleDependencies() {
    this.state = Calc.enforceModuleDependencies(this.state);
    this.syncStateToControls();
  }

  handleLocationEdited() {
    document.getElementById('locationPreset').value = 'custom';
    if ((this.state.body || 'earth') !== 'earth') {
      if (this.state.siteYieldSource !== 'manual') {
        this.state.siteYieldSource = 'planetary-custom';
      }
      return;
    }
    if (this.state.siteYieldSource !== 'manual') {
      const ghi = Calc.estimateGHI(this.state.latitude, this.state.longitude, this.state.body || 'earth');
      this.state.siteYieldMwhPerMwdcYear = Calc.estimateBaseYield(this.state.latitude, this.state.longitude, ghi, this.state.body || 'earth');
      this.state.siteYieldSource = 'estimated';
      this.syncStateToControls();
    }
  }

  on(id, event, handler) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener(event, () => {
      handler(el.value, el);
      this.recalculate();
    });
  }

  bindRange(id, stateKey, formatter, extra) {
    const el = document.getElementById(id);
    if (!el) return;
    this.rangeBindings.push({ id, stateKey, formatter });
    el.addEventListener('input', () => {
      this.state[stateKey] = parseFloat(el.value);
      this.syncRangeDisplay(id, el.value, formatter);
      if (extra) extra();
      this.syncDynamicVisibility();
      this.requestRecalculate({ includeSensitivity: false });
    });
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
    this.bindIrrOptimizerButton('optimizeBatteryCapacity', {
      inputId: 'batteryCapacity',
      stateKey: 'batteryCapacityMWh',
      maxCoarseSamples: 257,
      maxTopRegions: 5,
    });
    this.bindIrrOptimizerButton('optimizeMethaneFeedstockSplit', {
      inputId: 'methaneFeedstockSplit',
      stateKey: 'methaneFeedstockSplit',
      maxCoarseSamples: 101,
      maxTopRegions: 5,
    });
  }

  bindIrrOptimizerButton(buttonId, options) {
    const button = document.getElementById(buttonId);
    if (!button) return;
    this.captureOptimizerButtonDefaults(button);

    button.addEventListener('click', async event => {
      event.preventDefault();
      if (button.disabled) return;

      button.disabled = true;
      this.setOptimizerButtonProgress(button, { percent: 0, stage: 'start' });
      try {
        await new Promise(resolve => window.requestAnimationFrame(resolve));
        const bestValue = await this.findBestRangeValueForIrr(
          options,
          progress => this.setOptimizerButtonProgress(button, progress)
        );
        if (!Number.isFinite(bestValue)) return;

        const input = document.getElementById(options.inputId);
        if (!input) return;

        input.value = String(bestValue);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
      } finally {
        button.disabled = false;
        this.resetOptimizerButton(button);
      }
    });
  }

  captureOptimizerButtonDefaults(button) {
    if (!button) return;
    if (!button.dataset.defaultLabel) button.dataset.defaultLabel = (button.textContent || '').trim() || 'optimize';
    if (!button.dataset.defaultTitle) button.dataset.defaultTitle = button.getAttribute('title') || '';
  }

  setOptimizerButtonProgress(button, progress = {}) {
    if (!button) return;
    this.captureOptimizerButtonDefaults(button);

    const defaultLabel = button.dataset.defaultLabel || 'optimize';
    const boundedPercent = Number.isFinite(progress.percent)
      ? Math.max(0, Math.min(100, Math.round(progress.percent)))
      : null;

    button.dataset.optimizing = 'true';
    if (boundedPercent === null) {
      button.style.removeProperty('--optimize-progress');
      button.textContent = '...';
    } else {
      button.style.setProperty('--optimize-progress', `${boundedPercent}%`);
      button.textContent = `${boundedPercent}%`;
    }

    const progressText = boundedPercent === null ? 'in progress' : `${boundedPercent}% complete`;
    button.setAttribute('aria-label', `${defaultLabel} ${progressText}`);
    button.setAttribute('title', `${button.dataset.defaultTitle || defaultLabel} (${progressText})`);
  }

  resetOptimizerButton(button) {
    if (!button) return;
    this.captureOptimizerButtonDefaults(button);
    button.textContent = button.dataset.defaultLabel || 'optimize';
    button.removeAttribute('data-optimizing');
    button.style.removeProperty('--optimize-progress');
    button.removeAttribute('aria-label');
    if (button.dataset.defaultTitle) button.setAttribute('title', button.dataset.defaultTitle);
    else button.removeAttribute('title');
  }

  // Search the slider domain with a coarse sweep plus local refinement
  // so IRR optimization stays responsive on wide ranges like battery capacity.
  async findBestRangeValueForIrr(
    { inputId, stateKey, maxCoarseSamples = 257, maxTopRegions = 5 },
    onProgress = null
  ) {
    const input = document.getElementById(inputId);
    if (!input) return null;

    const min = parseFloat(input.min);
    const max = parseFloat(input.max);
    const step = parseFloat(input.step) || 1;
    if (![min, max, step].every(Number.isFinite) || step <= 0 || max < min) return null;

    const search = {
      stateKey,
      min,
      max,
      step,
      currentValue: parseFloat(input.value),
      maxCoarseSamples,
      maxTopRegions,
    };

    if (typeof Worker === 'function') {
      try {
        const workerResult = await this.requestOptimizerWorkerSearch(search, onProgress);
        return workerResult?.bestValue ?? null;
      } catch (error) {
        console.warn('Optimizer worker failed, falling back to main thread.', error);
      }
    }

    const fallbackResult = typeof Calc.findBestRangeValueForIrr === 'function'
      ? Calc.findBestRangeValueForIrr(this.state, search, { onProgress })
      : this.findBestRangeValueForIrrOnMainThread(search);
    return fallbackResult?.bestValue ?? null;
  }

  findBestRangeValueForIrrOnMainThread({
    stateKey,
    min,
    max,
    step,
    currentValue,
    maxCoarseSamples = 257,
    maxTopRegions = 5,
  }) {
    if (![min, max, step].every(Number.isFinite) || step <= 0 || max < min) return null;

    const totalSteps = Math.max(0, Math.round((max - min) / step));
    const snappedCurrentValue = this.snapRangeValue(currentValue, min, max, step);
    const currentIndex = Math.round((snappedCurrentValue - min) / step);
    const precision = this.getStepPrecision(step);
    const cache = new Map();

    const evaluate = value => {
      const snappedValue = this.snapRangeValue(value, min, max, step);
      const key = snappedValue.toFixed(precision);
      if (cache.has(key)) return cache.get(key);

      const result = {
        value: snappedValue,
        irr: Calc.calculateIrr({ ...this.state, [stateKey]: snappedValue }),
      };
      result.finite = Number.isFinite(result.irr);
      cache.set(key, result);
      return result;
    };

    const evaluateIndex = index => evaluate(min + (index * step));
    const currentResult = evaluate(snappedCurrentValue);

    if ((totalSteps + 1) <= maxCoarseSamples) {
      for (let index = 0; index <= totalSteps; index++) {
        evaluateIndex(index);
      }
    } else {
      const coarseIndices = this.buildEvenlySpacedIndices(
        totalSteps,
        Math.min(maxCoarseSamples, totalSteps + 1)
      );

      coarseIndices.forEach(index => evaluateIndex(index));

      const rankedIndices = coarseIndices
        .map(index => ({ index, ...evaluateIndex(index) }))
        .filter(entry => entry.finite)
        .sort((a, b) => b.irr - a.irr);

      const coarseSpacing = coarseIndices.length > 1
        ? coarseIndices.slice(1).reduce((maxGap, index, i) => Math.max(maxGap, index - coarseIndices[i]), 1)
        : totalSteps;

      const regionSeeds = new Set([
        currentIndex,
        ...rankedIndices.slice(0, maxTopRegions).map(entry => entry.index),
      ]);

      const mergedRegions = this.mergeIndexRanges(
        Array.from(regionSeeds).map(index => [
          Math.max(0, index - coarseSpacing),
          Math.min(totalSteps, index + coarseSpacing),
        ])
      );

      mergedRegions.forEach(([start, end]) => {
        for (let index = start; index <= end; index++) {
          evaluateIndex(index);
        }
      });
    }

    const best = Array.from(cache.values())
      .filter(entry => entry.finite)
      .sort((a, b) => {
        const irrDiff = b.irr - a.irr;
        if (Math.abs(irrDiff) > 1e-9) return irrDiff;
        return Math.abs(a.value - snappedCurrentValue) - Math.abs(b.value - snappedCurrentValue);
      })[0];

    if (!best) return null;
    if (Number.isFinite(currentResult.irr) && best.irr <= (currentResult.irr + 1e-6)) return null;

    return {
      bestValue: best.value,
      bestIrr: best.irr,
      currentValue: snappedCurrentValue,
      currentIrr: currentResult.irr,
    };
  }

  buildEvenlySpacedIndices(totalSteps, targetCount) {
    if (totalSteps <= 0) return [0];

    const indices = new Set([0, totalSteps]);
    const count = Math.max(2, Math.min(targetCount, totalSteps + 1));
    for (let i = 0; i < count; i++) {
      indices.add(Math.round((i * totalSteps) / (count - 1)));
    }
    return Array.from(indices).sort((a, b) => a - b);
  }

  mergeIndexRanges(ranges) {
    if (!Array.isArray(ranges) || !ranges.length) return [];

    const sorted = ranges
      .map(([start, end]) => [Math.min(start, end), Math.max(start, end)])
      .sort((a, b) => a[0] - b[0]);

    return sorted.reduce((merged, [start, end]) => {
      const last = merged[merged.length - 1];
      if (!last || start > (last[1] + 1)) {
        merged.push([start, end]);
      } else {
        last[1] = Math.max(last[1], end);
      }
      return merged;
    }, []);
  }

  snapRangeValue(value, min, max, step) {
    const precision = this.getStepPrecision(step);
    const boundedValue = Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : min;
    const snapped = min + (Math.round((boundedValue - min) / step) * step);
    return Number(Math.max(min, Math.min(max, snapped)).toFixed(precision));
  }

  getStepPrecision(step) {
    if (!Number.isFinite(step) || Number.isInteger(step)) return 0;
    const normalized = step.toString().toLowerCase();
    if (normalized.includes('e-')) {
      return parseInt(normalized.split('e-')[1], 10);
    }
    return normalized.includes('.') ? normalized.split('.')[1].length : 0;
  }

  getOptimizerWorker() {
    if (this.optimizerWorker) return this.optimizerWorker;

    this.optimizerWorker = new Worker('js/optimizer-worker.js?v=20260401-opt-progress');
    this.optimizerWorker.addEventListener('message', event => {
      const { requestId, messageType, progress, result, error } = event.data || {};
      const pending = this.optimizerRequests.get(requestId);
      if (!pending) return;
      if (messageType === 'progress') {
        pending.onProgress?.(progress || {});
        return;
      }

      this.optimizerRequests.delete(requestId);
      if (error) {
        pending.reject(new Error(error.message || 'Optimizer worker failed.'));
      } else {
        pending.resolve(result || null);
      }
    });
    this.optimizerWorker.addEventListener('error', event => {
      const workerError = event?.error || new Error(event?.message || 'Optimizer worker crashed.');
      this.optimizerRequests.forEach(({ reject }) => reject(workerError));
      this.optimizerRequests.clear();
      this.optimizerWorker = null;
    });

    return this.optimizerWorker;
  }

  requestOptimizerWorkerSearch(search, onProgress = null) {
    const worker = this.getOptimizerWorker();
    const requestId = ++this.optimizerRequestId;
    return new Promise((resolve, reject) => {
      this.optimizerRequests.set(requestId, { resolve, reject, onProgress });
      worker.postMessage({
        requestId,
        type: 'findBestRangeValueForIrr',
        state: this.state,
        search,
      });
    });
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
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', () => {
      this.state[stateKey] = parseFloat(el.value);
      if (extra) extra();
      this.recalculate();
    });
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

  createSliderTooltip() {
    if (this.sliderTooltip) return;

    this.sliderTooltip = document.createElement('div');
    this.sliderTooltip.className = 'slider-hover-tooltip';
    document.body.appendChild(this.sliderTooltip);

    window.addEventListener('scroll', () => this.hideSliderTooltip(), true);
    window.addEventListener('resize', () => {
      this.hideSliderTooltip();
      this.positionSliderMarkers();
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
        markerButton.title = tooltipText;
        markerButton.setAttribute('aria-label', tooltipText);
        markerButton.addEventListener('mouseenter', () => this.showSliderTooltip(markerButton, tooltipText));
        markerButton.addEventListener('mouseleave', () => this.hideSliderTooltip());
        markerButton.addEventListener('focus', () => this.showSliderTooltip(markerButton, tooltipText));
        markerButton.addEventListener('blur', () => this.hideSliderTooltip());

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

  showSliderTooltip(target, text) {
    if (!this.sliderTooltip) return;

    this.sliderTooltip.textContent = text;
    this.sliderTooltip.classList.add('visible');

    const rect = target.getBoundingClientRect();
    const tooltipRect = this.sliderTooltip.getBoundingClientRect();
    const margin = 8;
    const left = Math.min(
      window.innerWidth - tooltipRect.width - margin,
      Math.max(margin, rect.left + (rect.width / 2) - (tooltipRect.width / 2))
    );
    const top = Math.max(margin, rect.top - tooltipRect.height - 10);

    this.sliderTooltip.style.left = `${left}px`;
    this.sliderTooltip.style.top = `${top}px`;
  }

  hideSliderTooltip() {
    if (!this.sliderTooltip) return;
    this.sliderTooltip.classList.remove('visible');
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
    const checkboxIds = ['aiComputeEnabled', 'financingEnabled'];
    checkboxIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.checked = Boolean(this.state[id]);
    });

    const selectMap = {
      mountingType: this.state.mountingType,
      policyMode: this.state.policyMode,
      methaneMarketPreset: this.state.methaneMarketPreset,
      aiReliabilityTarget: this.state.aiReliabilityTarget,
    };
    Object.entries(selectMap).forEach(([id, value]) => {
      const el = document.getElementById(id);
      if (el) el.value = value;
    });

    const numbers = {
      latitude: this.state.latitude,
      longitude: this.state.longitude,
      siteYield: this.state.siteYieldMwhPerMwdcYear,
    };
    Object.entries(numbers).forEach(([id, value]) => {
      const el = document.getElementById(id);
      if (el) el.value = value;
    });

    const presetIndex = LOCATION_PRESETS.findIndex(loc =>
      (loc.body || 'earth') === (this.state.body || 'earth') &&
      Math.abs(loc.lat - this.state.latitude) < 0.1 &&
      Math.abs(loc.lon - this.state.longitude) < 0.1
    );
    document.getElementById('locationPreset').value = presetIndex >= 0 ? String(presetIndex) : 'custom';

    this.rangeBindings.forEach(binding => {
      const el = document.getElementById(binding.id);
      if (!el) return;
      el.value = this.state[binding.stateKey];
      this.syncRangeDisplay(binding.id, this.state[binding.stateKey], binding.formatter);
    });

    MODULE_REGISTRY.forEach(module => {
      const enabledEl = document.getElementById(`${module.id}Enabled`);
      if (enabledEl) enabledEl.checked = Boolean(this.state[`${module.id}Enabled`]);
      const configEl = document.getElementById(`${module.id}Config`);
      if (configEl) configEl.classList.toggle('active', Boolean(this.state[`${module.id}Enabled`]));
      const routeEl = document.getElementById(`${module.id}Route`);
      if (routeEl && this.state[`${module.id}Route`]) routeEl.value = this.state[`${module.id}Route`];
    });

    document.getElementById('aiComputeConfig').classList.toggle('active', this.state.aiComputeEnabled);
    document.getElementById('financingConfig').classList.toggle('active', this.state.financingEnabled);
    this.syncLoadConfigTabs();
  }

  syncRangeDisplay(id, value, formatter) {
    const display = document.getElementById(`${id}Value`);
    const binding = formatter || this.rangeBindings.find(item => item.id === id)?.formatter;
    if (display && binding) display.textContent = binding(value);
  }

  formatMethaneFeedstockSplit(value) {
    const methaneShare = Math.max(0, Math.min(100, parseFloat(value)));
    const methanolShare = Math.max(0, 100 - methaneShare);
    return `${FormatNumbers.fixed(methaneShare, 0)}% methane / ${FormatNumbers.fixed(methanolShare, 0)}% methanol`;
  }

  formatExploratoryPriorityWeight(value) {
    return `${FormatNumbers.fixed(parseFloat(value), 0)} weight`;
  }

  formatExploratoryCapexBasis(moduleId, value) {
    const capexConfig = Calc.getExploratoryCapexControlConfig(moduleId, this.state[`${moduleId}Route`]);
    const digits = capexConfig.step < 1 ? 2 : 0;
    return `$${FormatNumbers.fixed(parseFloat(value), digits)}/${capexConfig.unitLabel.replace('$/', '')}`;
  }

  formatExploratoryOmPercent(value) {
    return `${FormatNumbers.fixed(parseFloat(value), 1)}%/yr`;
  }

  formatMtgMethanolSplit(value) {
    const mtgShare = Math.max(0, Math.min(100, parseFloat(value)));
    const exportShare = Math.max(0, 100 - mtgShare);
    return `${FormatNumbers.fixed(mtgShare, 0)}% MTG / ${FormatNumbers.fixed(exportShare, 0)}% export`;
  }

  formatExploratorySalePrice(moduleId, value) {
    const marketConfig = EXPLORATORY_MARKET_CONFIG[moduleId];
    if (!marketConfig) return `$${FormatNumbers.fixed(parseFloat(value), 2)}`;
    const digits = marketConfig.step < 1 ? 2 : 0;
    return `$${FormatNumbers.fixed(parseFloat(value), digits)}/${marketConfig.unitLabel.replace('$/', '')}`;
  }

  syncDynamicVisibility() {
    const results = this.lastResults;
    const generatedExploratoryIds = new Set(
      (results?.exploratoryModules || [])
        .filter(module => module.enabled && module.outputDailyUnits > 0)
        .map(module => module.id)
    );
    const showMethaneMarket = results
      ? Boolean(results.sabatier?.enabled && results.sabatier?.ch4AnnualMCF > 0)
      : Boolean(this.state.sabatierEnabled);
    const showMethanolMarket = results
      ? Boolean(results.methanol?.enabled && (results.methanol?.exportAnnualTons || 0) > 0)
      : Boolean(this.state.methanolEnabled);

    const methaneMarket = this.getMethaneMarketConfig();
    const methaneMarketApplicability = document.getElementById('methaneMarketApplicabilityValue');
    if (methaneMarketApplicability) methaneMarketApplicability.textContent = methaneMarket.applicability;

    const methaneMarketBasis = document.getElementById('methaneMarketBasisValue');
    if (methaneMarketBasis) methaneMarketBasis.textContent = methaneMarket.basis;

    const methaneMarketNote = document.getElementById('methaneMarketNote');
    if (methaneMarketNote) methaneMarketNote.textContent = methaneMarket.note;

    const policy = this.getPolicyConfig();
    const showCustomH2 = Boolean(policy.useCustomH2);
    const showCustomCo2 = Boolean(policy.useCustomCo2);

    const customH2Wrap = document.getElementById('customH2CreditWrap');
    if (customH2Wrap) customH2Wrap.style.display = showCustomH2 ? 'block' : 'none';

    const customCo2Wrap = document.getElementById('customCo2CreditWrap');
    if (customCo2Wrap) customCo2Wrap.style.display = showCustomCo2 ? 'block' : 'none';

    const customH2Label = document.getElementById('customH2CreditLabel');
    if (customH2Label) {
      customH2Label.textContent = policy.h2InputLabel || 'Custom H2 Credit ($/kg)';
    }

    const customCo2Label = document.getElementById('customCo2CreditLabel');
    if (customCo2Label) {
      customCo2Label.textContent = policy.co2InputLabel || 'Custom CO2 Credit ($/ton)';
    }

    const policyApplicability = document.getElementById('policyApplicabilityValue');
    if (policyApplicability) policyApplicability.textContent = policy.applicability;

    const policyBasis = document.getElementById('policyBasisValue');
    if (policyBasis) policyBasis.textContent = policy.basis;

    const stackingRule = document.getElementById('stackingRuleValue');
    if (stackingRule) stackingRule.textContent = policy.stackingRule;

    const policyNote = document.getElementById('policyNote');
    if (policyNote) policyNote.textContent = policy.note;

    const usPolicyFootnotes = document.getElementById('usPolicyFootnotes');
    if (usPolicyFootnotes) {
      const isUsPolicy = String(this.state.policyMode || '').startsWith('us_');
      usPolicyFootnotes.style.display = isUsPolicy ? '' : 'none';
    }

    const debtTermInput = document.getElementById('debtTermYears');
    if (debtTermInput) {
      const horizonYears = Math.max(1, Math.round(this.state.analysisHorizonYears || 1));
      this.state.debtTermYears = Math.max(1, Math.min(Math.round(this.state.debtTermYears || 1), horizonYears));
      debtTermInput.max = String(horizonYears);
      debtTermInput.value = String(this.state.debtTermYears);
      this.syncRangeDisplay('debtTermYears', this.state.debtTermYears);

      const financingTermNote = document.getElementById('financingTermNote');
      if (financingTermNote) {
        financingTermNote.textContent = `Debt term is capped by the selected ${FormatNumbers.fixed(horizonYears, 0)}-year analysis horizon.`;
      }
    }

    const methaneMarketWrap = document.getElementById('methaneMarketWrap');
    if (methaneMarketWrap) methaneMarketWrap.style.display = showMethaneMarket ? 'block' : 'none';

    const methanolMarketWrap = document.getElementById('methanolMarketWrap');
    if (methanolMarketWrap) methanolMarketWrap.style.display = showMethanolMarket ? 'block' : 'none';

    MODULE_REGISTRY
      .filter(module => module.maturity === 'Exploratory' && EXPLORATORY_MARKET_CONFIG[module.id])
      .forEach(module => {
        const wrap = document.getElementById(`${module.id}MarketWrap`);
        const showWrap = results ? generatedExploratoryIds.has(module.id) : Boolean(this.state[`${module.id}Enabled`]);
        if (wrap) wrap.style.display = showWrap ? 'block' : 'none';
      });

    const exploratoryOmWrap = document.getElementById('exploratoryOmWrap');
    if (exploratoryOmWrap) {
      const showWrap = results
        ? generatedExploratoryIds.size > 0
        : MODULE_REGISTRY.some(module => module.maturity === 'Exploratory' && this.state[`${module.id}Enabled`]);
      exploratoryOmWrap.style.display = showWrap ? 'block' : 'none';
    }

    const productMarketEmptyState = document.getElementById('productMarketEmptyState');
    if (productMarketEmptyState) {
      const hasVisibleMarketControl = showMethaneMarket || showMethanolMarket || generatedExploratoryIds.size > 0;
      productMarketEmptyState.style.display = hasVisibleMarketControl ? 'none' : 'block';
    }

    MODULE_REGISTRY
      .filter(module => module.maturity === 'Exploratory')
      .forEach(module => {
        this.syncExploratoryCapexControl(module.id);
      });
  }

  syncExploratoryCapexControl(moduleId) {
    const input = document.getElementById(`${moduleId}CapexBasis`);
    const label = document.getElementById(`${moduleId}CapexBasisLabel`);
    if (!input) return;
    const capexConfig = Calc.getExploratoryCapexControlConfig(moduleId, this.state[`${moduleId}Route`]);
    input.min = String(capexConfig.min);
    input.max = String(capexConfig.max);
    input.step = String(capexConfig.step);
    this.state[`${moduleId}CapexBasis`] = Calc.clampNumber(
      this.state[`${moduleId}CapexBasis`],
      capexConfig.min,
      capexConfig.max,
      capexConfig.defaultValue
    );
    input.value = String(this.state[`${moduleId}CapexBasis`]);
    if (label) label.textContent = `Block CAPEX (${capexConfig.unitLabel})`;
    this.syncRangeDisplay(
      `${moduleId}CapexBasis`,
      this.state[`${moduleId}CapexBasis`],
      v => this.formatExploratoryCapexBasis(moduleId, v)
    );
  }

  syncDerivedFeedControls() {
    const safeState = Calc.normalizeState(this.state);
    const allocation = Calc.getBalancedAllocation(safeState);
    const mix = Calc.getProductMix(safeState);
    const mixControl = document.getElementById('productMixControl');
    const mixNote = document.getElementById('productMixNote');
    const mixInput = document.getElementById('methaneFeedstockSplit');

    if (mixControl) {
      mixControl.style.display = mix.bothEnabled ? 'block' : 'none';
    }
    if (mixInput) {
      mixInput.value = this.state.methaneFeedstockSplit;
    }
    this.syncRangeDisplay('methaneFeedstockSplit', this.state.methaneFeedstockSplit, v => this.formatMethaneFeedstockSplit(v));
    if (mixNote) {
      mixNote.textContent = mix.bothEnabled
        ? 'Shared H2 and CO2 production auto-balance from the combined methane and methanol demand.'
        : 'Shared H2 and CO2 production auto-balance from the active downstream product requirements.';
    }

    const mtgSplitControl = document.getElementById('mtgMethanolSplitControl');
    if (mtgSplitControl) {
      mtgSplitControl.style.display = this.state.mtgEnabled && this.state.methanolEnabled ? 'block' : 'none';
    }
    const mtgSplitInput = document.getElementById('mtgMethanolSplit');
    if (mtgSplitInput) {
      mtgSplitInput.value = this.state.mtgMethanolSplit;
      this.syncRangeDisplay('mtgMethanolSplit', this.state.mtgMethanolSplit, v => this.formatMtgMethanolSplit(v));
    }

    ['electrolyzer', 'dac'].forEach(id => {
      const el = document.getElementById(`${id}AllocMode`);
      if (el) {
        const pct = id === 'electrolyzer' ? allocation.electrolyzer * 100 : allocation.dac * 100;
        const basis = allocation.label === 'configured product mix'
          ? 'Product mix'
          : allocation.label === 'default methane case'
            ? 'Default case'
            : allocation.label[0].toUpperCase() + allocation.label.slice(1);
        el.textContent = `${basis} · ${FormatNumbers.fixed(pct, 1)}% of power`;
      }
    });
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
      this.updateEconChart(r);
      if (includeSensitivity) this.flushSensitivityUpdate(r);
      else this.scheduleSensitivityUpdate(r);
      this.updateImpact(r);
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
