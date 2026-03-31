/* ============================================
   App — Main controller, UI binding, charts
   ============================================ */

/** Merge CAPEX segments under 2% of total into "Other" when there are many categories (reduces unreadable slivers). */
function compactCapexChartData(labels, values, colors) {
  const n = labels.length;
  if (n <= 1) return { labels, values, colors };
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0) return { labels, values, colors };
  const minVal = total * 0.02;
  const kept = [];
  let other = 0;
  for (let i = 0; i < n; i++) {
    const v = values[i];
    if (v < minVal && n >= 5) {
      other += v;
    } else {
      kept.push({ label: labels[i], value: v, color: colors[i] });
    }
  }
  if (other > 0) {
    kept.push({ label: 'Other', value: other, color: '#64748b' });
  }
  return {
    labels: kept.map(x => x.label),
    values: kept.map(x => x.value),
    colors: kept.map(x => x.color),
  };
}

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
    this.init();
  }

  init() {
    this.populatePresets();
    this.renderModuleControls();
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
    const count = r.solar.hourlyProfile.length;
    if (r.solar.chartLabelMode === 'days') {
      return Array.from({ length: count }, (_, i) => `${FormatNumbers.fixed((i * r.solar.cycleHours) / count / 24, 1)}d`);
    }

    return Array.from({ length: count }, (_, i) => {
      const t = (i * r.solar.cycleHours) / count;
      const hours = Math.floor(t);
      const minutes = Math.round((t - hours) * 60);
      return `${hours}:${minutes.toString().padStart(2, '0')}`;
    });
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
          <div class="missing-assumptions">
            <div class="module-note-title">Missing assumptions</div>
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
    this.on('methaneMarketPreset', 'change', val => {
      this.state.methaneMarketPreset = val;
      this.syncDynamicVisibility();
    });
    this.bindRange('methanePrice', 'methanePrice', v => `$${FormatNumbers.fixed(parseFloat(v), 2)}/MCF`);
    this.bindRange('methanolPrice', 'methanolPrice', v => `$${FormatNumbers.fixed(parseInt(v, 10), 0)}/ton`);

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
  }

  bindModuleControls() {
    MODULE_REGISTRY.forEach(module => {
      const enabledKey = `${module.id}Enabled`;
      this.on(enabledKey, 'change', (_, el) => {
        this.state[enabledKey] = el.checked;
        document.getElementById(`${module.id}Config`).classList.toggle('active', el.checked);
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
        });
      }
    });
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
      this.recalculate();
    });
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

    button.addEventListener('click', async event => {
      event.preventDefault();
      if (button.disabled) return;

      button.disabled = true;
      try {
        await new Promise(resolve => window.requestAnimationFrame(resolve));
        const bestValue = this.findBestRangeValueForIrr(options);
        if (!Number.isFinite(bestValue)) return;

        const input = document.getElementById(options.inputId);
        if (!input) return;

        input.value = String(bestValue);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
      } finally {
        button.disabled = false;
      }
    });
  }

  // Search the slider domain with a coarse sweep plus local refinement
  // so IRR optimization stays responsive on wide ranges like battery capacity.
  findBestRangeValueForIrr({ inputId, stateKey, maxCoarseSamples = 257, maxTopRegions = 5 }) {
    const input = document.getElementById(inputId);
    if (!input) return null;

    const min = parseFloat(input.min);
    const max = parseFloat(input.max);
    const step = parseFloat(input.step) || 1;
    if (![min, max, step].every(Number.isFinite) || step <= 0 || max < min) return null;

    const totalSteps = Math.max(0, Math.round((max - min) / step));
    const currentValue = this.snapRangeValue(parseFloat(input.value), min, max, step);
    const currentIndex = Math.round((currentValue - min) / step);
    const precision = this.getStepPrecision(step);
    const cache = new Map();

    const evaluate = value => {
      const snappedValue = this.snapRangeValue(value, min, max, step);
      const key = snappedValue.toFixed(precision);
      if (cache.has(key)) return cache.get(key);

      const result = {
        value: snappedValue,
        irr: Calc.calculateAll({ ...this.state, [stateKey]: snappedValue }).economics.irr,
      };
      result.finite = Number.isFinite(result.irr);
      cache.set(key, result);
      return result;
    };

    const evaluateIndex = index => evaluate(min + (index * step));
    const currentResult = evaluate(currentValue);

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
        return Math.abs(a.value - currentValue) - Math.abs(b.value - currentValue);
      })[0];

    if (!best) return null;
    if (Number.isFinite(currentResult.irr) && best.irr <= (currentResult.irr + 1e-6)) return null;
    return best.value;
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

  syncBatteryEnabledState() {
    this.state.batteryEnabled = Number.isFinite(this.state.batteryCapacityMWh) && this.state.batteryCapacityMWh > 1e-9;
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
    this.mobilePanels = Array.from(document.querySelectorAll('.config-panel, .results-panel'));
    this.mobileBackdrop = document.getElementById('mobilePanelBackdrop');

    this.mobilePaneButtons.forEach(button => {
      button.addEventListener('click', () => {
        const panelId = button.dataset.panelTarget;
        if (!panelId) return;
        this.setMobilePanel(this.activeMobilePanelId === panelId ? null : panelId);
      });
    });

    if (this.mobileBackdrop) {
      this.mobileBackdrop.addEventListener('click', () => this.setMobilePanel(null));
    }

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        this.setMobilePanel(null);
      }
    });

    const handleLayoutChange = () => {
      if (!this.isMobileViewport()) {
        this.activeMobilePanelId = null;
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

  setMobilePanel(panelId) {
    this.activeMobilePanelId = this.isMobileViewport() ? panelId : null;
    this.syncMobilePaneState();
  }

  syncMobilePaneState() {
    const activeId = this.isMobileViewport() ? this.activeMobilePanelId : null;
    const hasActivePanel = Boolean(activeId);

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

    if (this.mobileBackdrop) {
      this.mobileBackdrop.hidden = !hasActivePanel;
    }
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
    const mapEl = document.getElementById('siteMap');
    if (!mapEl || this.siteMap) return;

    if (typeof L === 'undefined') {
      this.showSiteMapMessage(
        'Satellite map failed to load.',
        'Satellite imagery is temporarily unavailable, but the footprint metrics still update from the model.'
      );
      return;
    }

    this.siteMap = L.map(mapEl, {
      zoomControl: false,
      scrollWheelZoom: false,
      attributionControl: true,
    });
    this.siteMap.setView([this.state.latitude || 0, this.state.longitude || 0], 14, {
      animate: false,
    });

    L.control.zoom({ position: 'bottomright' }).addTo(this.siteMap);

    L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {
        attribution: 'Tiles &copy; Esri',
        maxZoom: 19,
      }
    ).addTo(this.siteMap);

    this.siteMapMarker = L.circleMarker([this.state.latitude, this.state.longitude], {
      radius: 4,
      color: '#ffffff',
      weight: 2,
      fillColor: '#3b82f6',
      fillOpacity: 0.95,
    }).addTo(this.siteMap);

    this.siteMapOverlay = L.rectangle(
      [
        [this.state.latitude, this.state.longitude],
        [this.state.latitude, this.state.longitude],
      ],
      {
        color: '#f59e0b',
        weight: 2,
        fillColor: '#f59e0b',
        fillOpacity: 0.22,
        interactive: false,
      }
    ).addTo(this.siteMap);

    this.siteMapModuleLayer = L.layerGroup().addTo(this.siteMap);
  }

  showSiteMapMessage(message, noteText) {
    const mapEl = document.getElementById('siteMap');
    const emptyEl = document.getElementById('siteMapEmpty');
    const noteEl = document.getElementById('siteMapNote');

    if (mapEl) mapEl.hidden = true;
    if (emptyEl) {
      emptyEl.hidden = false;
      emptyEl.textContent = message;
    }
    if (noteEl && noteText) noteEl.textContent = noteText;
  }

  showSiteMap(noteText) {
    const mapEl = document.getElementById('siteMap');
    const emptyEl = document.getElementById('siteMapEmpty');
    const noteEl = document.getElementById('siteMapNote');

    if (mapEl) mapEl.hidden = false;
    if (emptyEl) emptyEl.hidden = true;
    if (noteEl && noteText) noteEl.textContent = noteText;
  }

  getSquareBounds(lat, lon, sideMeters, minSideMeters = 20) {
    const halfSide = Math.max(sideMeters, minSideMeters) / 2;
    const metersPerDegLat = 111320;
    const metersPerDegLon = Math.max(111320 * Math.cos((lat * Math.PI) / 180), 1000);
    const deltaLat = halfSide / metersPerDegLat;
    const deltaLon = halfSide / metersPerDegLon;

    return [
      [lat - deltaLat, lon - deltaLon],
      [lat + deltaLat, lon + deltaLon],
    ];
  }

  formatArea(areaM2) {
    if (!Number.isFinite(areaM2) || areaM2 <= 0) return '—';

    const acres = areaM2 / 4046.8564224;
    if (acres >= 0.5) return `${FormatNumbers.fixed(acres, 1)} acres`;
    if (areaM2 >= 1e6) return `${FormatNumbers.fixed(areaM2 / 1e6, 2)} km2`;
    return `${Math.round(areaM2).toLocaleString()} m2`;
  }

  formatDistance(meters) {
    if (!Number.isFinite(meters) || meters <= 0) return '—';
    if (meters >= 1000) return `${FormatNumbers.fixed(meters / 1000, 2)} km`;
    return `${Math.round(meters).toLocaleString()} m`;
  }

  hexToRgba(hex, alpha) {
    if (typeof hex !== 'string') return `rgba(255,255,255,${alpha})`;
    const normalized = hex.length === 4
      ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
      : hex;
    const r = parseInt(normalized.slice(1, 3), 16);
    const g = parseInt(normalized.slice(3, 5), 16);
    const b = parseInt(normalized.slice(5, 7), 16);
    if (![r, g, b].every(Number.isFinite)) return `rgba(255,255,255,${alpha})`;
    return `rgba(${r},${g},${b},${alpha})`;
  }

  getSiteFootprintColor(id) {
    const palette = (typeof Diagram !== 'undefined' && Diagram.colors) ? Diagram.colors : {};
    const colorMap = {
      total: palette.solar || '#f59e0b',
      solar: palette.solar || '#f59e0b',
      battery: palette.battery || '#6366f1',
      ai: palette.ai || '#38bdf8',
      electrolyzer: palette.h2 || '#06b6d4',
      dac: palette.co2 || '#8b5cf6',
      sabatier: palette.methane || '#10b981',
      methanol: palette.methanol || '#f97316',
    };
    return colorMap[id] || palette.inactive || '#64748b';
  }

  getSiteFootprintAbbreviation(id) {
    const labelMap = {
      ai: 'AI',
      electrolyzer: 'ELY',
      dac: 'DAC',
      battery: 'BAT',
      sabatier: 'CH4',
      methanol: 'MeOH',
    };
    return labelMap[id] || String(id || '').slice(0, 4).toUpperCase();
  }

  buildSiteFootprintEstimate(r) {
    const solarAreaM2 = Math.max(r?.solar?.landAreaM2 || 0, 0);

    // Order-of-magnitude process-building footprints tuned so a 1 MW case
    // still looks solar-dominated, similar to Terraform's cartoon render.
    const rawItems = [
      {
        id: 'ai',
        label: 'AI datacenter',
        areaM2: r.ai.enabled ? Math.max(48, (r.ai.designLoadKW || 0) * 0.25) : 0,
      },
      {
        id: 'electrolyzer',
        label: 'Electrolyzer',
        areaM2: r.electrolyzer.enabled ? Math.max(24, (r.electrolyzer.allocKW || 0) * 0.03) : 0,
      },
      {
        id: 'dac',
        label: 'DAC',
        areaM2: r.dac.enabled ? Math.max(36, (r.dac.co2AnnualTons || 0) * 0.35) : 0,
      },
      {
        id: 'battery',
        label: 'Battery yard',
        areaM2: r.battery.enabled ? Math.max(20, ((r.battery.battCapKWh || 0) / 1000) * 6) : 0,
      },
      {
        id: 'sabatier',
        label: 'Methane plant',
        areaM2: r.sabatier.enabled ? Math.max(9, (r.sabatier.designHourlyRate || 0) * 4) : 0,
      },
      {
        id: 'methanol',
        label: 'Methanol plant',
        areaM2: r.methanol.enabled ? Math.max(12, (r.methanol.designHourlyOutputKg || 0) * 0.12) : 0,
      },
    ];

    const processItems = rawItems
      .filter(item => Number.isFinite(item.areaM2) && item.areaM2 > 0)
      .map(item => ({
        ...item,
        sideMeters: Math.sqrt(item.areaM2),
        color: this.getSiteFootprintColor(item.id),
      }))
      .sort((a, b) => b.areaM2 - a.areaM2);

    const processAreaM2 = processItems.reduce((sum, item) => sum + item.areaM2, 0);
    const totalAreaM2 = solarAreaM2 + processAreaM2;
    const totalSideMeters = totalAreaM2 > 0 ? Math.sqrt(totalAreaM2) : 0;

    return {
      solarAreaM2,
      processAreaM2,
      totalAreaM2,
      totalSideMeters,
      items: totalAreaM2 > 0
        ? [{
            id: 'total',
            label: 'Total site',
            areaM2: totalAreaM2,
            sideMeters: totalSideMeters,
            color: this.getSiteFootprintColor('total'),
          }, ...processItems]
        : [],
    };
  }

  renderSiteFootprintEstimate() {
    const el = document.getElementById('siteMapFootprints');
    if (!el) return;
    el.hidden = true;
    el.innerHTML = '';
  }

  offsetLatLon(lat, lon, offsetXMeters, offsetYMeters) {
    const metersPerDegLat = 111320;
    const metersPerDegLon = Math.max(111320 * Math.cos((lat * Math.PI) / 180), 1000);
    return {
      lat: lat + (offsetYMeters / metersPerDegLat),
      lon: lon + (offsetXMeters / metersPerDegLon),
    };
  }

  clearSiteMapModuleSquares() {
    if (this.siteMapModuleLayer) this.siteMapModuleLayer.clearLayers();
  }

  renderSiteMapModuleSquares(lat, lon, footprint) {
    this.clearSiteMapModuleSquares();
    if (!this.siteMapModuleLayer || !footprint?.items?.length) return;

    const total = footprint.items.find(item => item.id === 'total');
    if (!total || !Number.isFinite(total.sideMeters) || total.sideMeters <= 0) return;

    const layoutOrder = {
      ai: 0,
      dac: 0,
      sabatier: 1,
      electrolyzer: 2,
      methanol: 3,
      battery: 4,
    };
    const processItems = footprint.items.filter(item => item.id !== 'total');
    if (!processItems.length) return;

    const totalSide = total.sideMeters;
    const gapMeters = Math.max(1.5, totalSide * 0.012);
    const marginMeters = Math.max(2.5, totalSide * 0.04);
    const minVisibleSideMeters = Math.max(1.4, totalSide * 0.022);
    const rowItems = processItems
      .map(item => ({
        ...item,
        sideMeters: Math.max(item.sideMeters, minVisibleSideMeters),
        sortOrder: layoutOrder[item.id] ?? 99,
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder);

    const rowWidth = rowItems.reduce((sum, item) => sum + item.sideMeters, 0) + (Math.max(0, rowItems.length - 1) * gapMeters);
    const maxSide = rowItems.reduce((max, item) => Math.max(max, item.sideMeters), 0);
    const availableWidth = Math.max(totalSide - (marginMeters * 2), totalSide * 0.3);
    const availableHeight = Math.max(totalSide - (marginMeters * 2), totalSide * 0.3);
    const layoutScale = rowWidth > 0 || maxSide > 0
      ? Math.min(
          1,
          rowWidth > 0 ? availableWidth / rowWidth : 1,
          maxSide > 0 ? (availableHeight * 0.28) / maxSide : 1
        )
      : 1;
    const scaledGapMeters = gapMeters * layoutScale;
    let cursorX = (-totalSide / 2) + marginMeters;
    const topEdge = (totalSide / 2) - marginMeters;

    rowItems.forEach(item => {
      const scaledSide = item.sideMeters * layoutScale;
      const x = cursorX + (scaledSide / 2);
      const y = topEdge - (scaledSide / 2);
      const center = this.offsetLatLon(lat, lon, x, y);
      const bounds = this.getSquareBounds(center.lat, center.lon, scaledSide, 0);
      L.rectangle(bounds, {
        color: item.color,
        weight: 1,
        opacity: 0.95,
        fillColor: item.color,
        fillOpacity: 0.42,
        interactive: false,
      }).addTo(this.siteMapModuleLayer);
      cursorX += scaledSide + scaledGapMeters;
    });

    if (this.siteMapMarker?.bringToFront) this.siteMapMarker.bringToFront();
    if (this.siteMapOverlay?.bringToBack) this.siteMapOverlay.bringToBack();
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

  syncDynamicVisibility() {
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
  }

  syncDerivedFeedControls() {
    const allocation = Calc.getBalancedAllocation(this.state);
    const mix = Calc.getProductMix(this.state);
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

  recalculate() {
    this.syncBatteryEnabledState();
    this.syncPlanetaryUI();
    this.syncDerivedFeedControls();
    const r = Calc.calculateAll(this.state);
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
    this.updateSensitivityChart(r);
    this.updateImpact(r);
  }

  updateInfoDisplays(r) {
    document.getElementById('ghiValue').textContent = `${FormatNumbers.fixed(r.solar.ghi, 0)} kWh/m²/yr`;
    document.getElementById('sunHoursValue').textContent = `${FormatNumbers.fixed(r.solar.sunHours, 1)} ${r.solar.hoursPerCycleLabel}`;
    document.getElementById('yieldSourceValue').textContent = r.solar.yieldSource;
    document.getElementById('baseYieldValue').textContent = `${FormatNumbers.fixed(r.solar.baseYield, 0)} MWh/MWdc-yr`;
    document.getElementById('annualProduction').textContent = `${FormatNumbers.fixed(r.solar.annualMWh, 0)} MWh`;
    document.getElementById('capacityFactor').textContent = `${FormatNumbers.fixed(r.solar.capacityFactor * 100, 1)}%`;
    document.getElementById('lcoe').textContent = `$${FormatNumbers.fixed(r.solar.lcoe, 2)}/MWh`;
    const solarInstallCapex = document.getElementById('solarInstallCapex');
    if (solarInstallCapex) {
      solarInstallCapex.textContent = this.formatMoney(r.solar.totalSolarCapex);
    }

    const effectiveCfLabel = document.getElementById('effectiveCFLabel');
    if (effectiveCfLabel) effectiveCfLabel.textContent = r.ai.enabled ? 'Residual Chem CF:' : 'Effective CF:';
    const dailyOpHoursLabel = document.getElementById('dailyOpHoursLabel');
    if (dailyOpHoursLabel && r.ai.enabled) {
      dailyOpHoursLabel.textContent = r.solar.bodyKey === 'earth' ? 'Residual Chem Hrs/Day:' : 'Residual Chem Hrs/Cycle:';
    }
    const displayedCf = r.ai.enabled
      ? r.battery.effectiveCF
      : (r.battery.enabled ? r.battery.effectiveCF : r.solar.capacityFactor);
    const displayedHours = r.ai.enabled
      ? r.ai.chemicalDailyOpHours
      : (r.battery.enabled ? r.battery.dailyOpHours : r.solar.sunHours);
    document.getElementById('effectiveCF').textContent = `${FormatNumbers.fixed(displayedCf * 100, 1)}%`;
    document.getElementById('dailyOpHours').textContent = `${FormatNumbers.fixed(parseFloat(displayedHours), 1)} hrs`;

    const aiDesignLoadValue = document.getElementById('aiDesignLoadValue');
    const aiUtilizationValue = document.getElementById('aiUtilizationValue');
    const aiFullRateValue = document.getElementById('aiFullRateValue');
    const aiTokensAnnualValue = document.getElementById('aiTokensAnnualValue');
    if (aiDesignLoadValue) {
      aiDesignLoadValue.textContent = r.ai.enabled ? this.formatSystemSizeMW(r.ai.designLoadKW / 1000) : 'Off';
    }
    if (aiUtilizationValue) {
      aiUtilizationValue.textContent = r.ai.enabled ? `${FormatNumbers.fixed(r.ai.utilization * 100, 2)}%` : '—';
    }
    if (aiFullRateValue) {
      aiFullRateValue.textContent = r.ai.enabled ? `${FormatNumbers.fixed(r.ai.fullPowerReliability * 100, 2)}%` : '—';
    }
    if (aiTokensAnnualValue) {
      aiTokensAnnualValue.textContent = r.ai.enabled ? `${FormatNumbers.fixed(r.ai.annualTokensM / 1000, 2)}B` : '—';
    }

    const geo = r.solar.solarGeo;
    if (geo) {
      document.getElementById('sunriseTime').textContent = SolarGeometry.hoursToDisplayString(geo.sunrise, r.solar.cycleHours);
      document.getElementById('sunsetTime').textContent = SolarGeometry.hoursToDisplayString(geo.sunset, r.solar.cycleHours);
      document.getElementById('dayLength').textContent = `${FormatNumbers.fixed(geo.dayLengthHours, 1)} hrs`;
    }
  }

  updateHeaderMetrics(r) {
    const e = r.economics;
    document.getElementById('metricCapex').textContent = this.formatMoney(e.totalCapex);
    document.getElementById('metricRevenue').textContent = `${this.formatMoney(e.totalAnnualRevenue)}/yr`;
    document.getElementById('metricPayback').textContent = Number.isFinite(e.paybackYears) ? `${FormatNumbers.fixed(e.paybackYears, 1)} yrs` : 'No payback';
    const irrLabel = document.getElementById('metricIrrLabel');
    if (irrLabel) irrLabel.textContent = e.financing.enabled ? 'Equity IRR' : 'IRR';
    document.getElementById('metricIRR').textContent = this.formatIrr(e.irr);

    const viability = document.getElementById('metricViability');
    const label = document.getElementById('metricViabilityValue');
    viability.classList.remove('viable', 'marginal', 'not-viable');

    if (e.npv > 0 && e.paybackYears < this.state.analysisHorizonYears) {
      viability.classList.add('viable');
      label.textContent = 'Viable';
    } else if (e.npv > 0 || e.finalCumulativeNetCash > 0) {
      viability.classList.add('marginal');
      label.textContent = 'Marginal';
    } else {
      viability.classList.add('not-viable');
      label.textContent = 'Not viable';
    }
  }

  updatePlantScore(r) {
    const e = r.economics;
    let score = 0;
    const badges = [];

    if (e.roi > 0) {
      score += Math.min(30, Math.max(8, e.roi / 6));
      if (e.roi > 40) badges.push({ text: 'High ROI', cls: 'green' });
    }

    if (e.paybackYears < this.state.analysisHorizonYears) {
      score += Math.min(20, Math.max(6, (1 - e.paybackYears / this.state.analysisHorizonYears) * 20));
      if (e.paybackYears < 5) badges.push({ text: 'Fast Payback', cls: 'gold' });
    }

    const cf = r.battery.enabled ? r.battery.effectiveCF : r.solar.capacityFactor;
    score += cf * 18;
    if (cf > 0.22) badges.push({ text: 'High Utilization', cls: 'blue' });

    const h2Util = r.electrolyzer.enabled && r.electrolyzer.h2DailyKg > 0
      ? 1 - (r.h2Surplus / r.electrolyzer.h2DailyKg)
      : 0;
    score += Math.max(0, h2Util) * 10;
    if (h2Util > 0.9) badges.push({ text: 'Balanced Feeds', cls: 'green' });

    if (r.sabatier.enabled && r.sabatier.designHourlyRate >= 0.8) {
      score += 5;
      badges.push({ text: 'Near Design Rate', cls: 'gold' });
    }

    score = Math.round(Math.min(100, Math.max(0, score)));
    const circumference = 213.6;
    const offset = circumference - (score / 100) * circumference;
    const arc = document.getElementById('scoreArc');
    arc.setAttribute('stroke-dashoffset', offset);
    arc.setAttribute('stroke', score >= 70 ? '#7ea96d' : score >= 40 ? '#c79a48' : '#c77379');
    document.getElementById('scoreNumber').textContent = FormatNumbers.fixed(score, 0);
    document.getElementById('scoreBadges').innerHTML = badges.slice(0, 4)
      .map(badge => `<span class="badge ${badge.cls}">${badge.text}</span>`)
      .join('');

    const card = document.getElementById('plantScoreCard');
    card.classList.remove('viable', 'marginal', 'not-viable');
    card.classList.add(score >= 60 ? 'viable' : score >= 35 ? 'marginal' : 'not-viable');
  }

  updateDiagram(r) {
    Diagram.render(document.getElementById('diagramContainer'), r);
  }

  updateSiteMap(r) {
    const areaEl = document.getElementById('siteMapArea');
    const squareEl = document.getElementById('siteMapSquare');
    const earthScenario = r.solar.bodyKey === 'earth';
    const hasCoords = Number.isFinite(this.state.latitude) && Number.isFinite(this.state.longitude);
    const footprint = this.buildSiteFootprintEstimate(r);
    const landAreaM2 = Math.max(footprint.totalAreaM2 || 0, 0);
    const squareSideMeters = footprint.totalSideMeters;
    const mapNote = 'Satellite view for Earth locations. The highlighted amber square is the estimated total site footprint (solar + active plant modules); the smaller colored squares sit at the top-left as a simple side-by-side process row.';

    this.renderSiteFootprintEstimate(footprint);

    if (areaEl) areaEl.textContent = `Area ${this.formatArea(landAreaM2)}`;
    if (squareEl) squareEl.textContent = `Side ${this.formatDistance(squareSideMeters)}`;

    if (!earthScenario) {
      this.clearSiteMapModuleSquares();
      this.showSiteMapMessage(
        'Satellite imagery is only available for Earth locations in this pane.',
        'Satellite view is Earth-only. The footprint numbers still reflect the modeled solar + plant footprint.'
      );
      return;
    }

    if (!hasCoords) {
      this.clearSiteMapModuleSquares();
      this.showSiteMapMessage(
        'Enter a valid latitude and longitude to render the site footprint.',
        'The footprint numbers still reflect the current modeled solar + plant footprint.'
      );
      return;
    }

    this.initSiteMap();
    if (!this.siteMap || !this.siteMapOverlay || !this.siteMapMarker) {
      this.clearSiteMapModuleSquares();
      this.showSiteMapMessage(
        'Satellite imagery is unavailable right now.',
        'The footprint metrics still update, but the live map could not be initialized.'
      );
      return;
    }

    this.showSiteMap(
      mapNote
    );

    const bounds = this.getSquareBounds(this.state.latitude, this.state.longitude, squareSideMeters);
    this.siteMapMarker.setLatLng([this.state.latitude, this.state.longitude]);
    this.siteMapOverlay.setBounds(bounds);
    this.clearSiteMapModuleSquares();

    window.requestAnimationFrame(() => {
      if (!this.siteMap) return;
      this.siteMap.invalidateSize();
      this.siteMap.fitBounds(bounds, {
        padding: [28, 28],
        maxZoom: 18,
        animate: false,
      });
      this.renderSiteMapModuleSquares(this.state.latitude, this.state.longitude, footprint);
    });
  }

  updateProduction(r) {
    const cycleUnit = this.getCycleRateUnit(r);
    const cycleEnergyLabel = r.ai.enabled
      ? (cycleUnit === 'day' ? 'Flexible Chem Energy' : 'Flexible Chem Cycle Energy')
      : (cycleUnit === 'day' ? 'Daily Energy' : 'Cycle Energy');
    const rows = [
      this.prodItem('solar', '☀️', 'Electricity', `${FormatNumbers.fixed(r.solar.annualMWh, 0)}`, 'MWh/yr'),
      this.prodItem('electric', '⚡', cycleEnergyLabel, `${FormatNumbers.fixed(r.effectiveDailyKWh, 0)}`, `kWh/${cycleUnit}`),
    ];

    if (r.ai.enabled) {
      rows.push(this.prodItem('electric', '🖥️', 'AI Load', this.formatSystemSizeMW(r.ai.designLoadKW / 1000), `${FormatNumbers.fixed(r.ai.reliabilityTarget, 2)}% target`));
      rows.push(this.prodItem('electric', '🧠', 'AI Tokens', `${FormatNumbers.fixed(r.ai.annualTokensM / 1000, 2)}`, 'B/yr'));
      rows.push(this.prodItem('battery', '⏱️', 'AI Utilization', `${FormatNumbers.fixed(r.ai.utilization * 100, 2)}`, '%'));
      rows.push(this.prodItem('battery', '♻️', 'Residual Chem Energy', `${FormatNumbers.fixed(r.ai.chemicalAnnualKWh / 1000, 0)}`, 'MWh/yr'));
    }

    rows.push(this.prodItem('h2', '💧', 'Hydrogen', `${FormatNumbers.fixed(r.electrolyzer.h2DailyKg, 1)}`, `kg/${cycleUnit}`));
    rows.push(this.prodItem('co2', '🌬️', 'CO₂ Captured', `${FormatNumbers.fixed(r.dac.co2DailyKg, 1)}`, `kg/${cycleUnit}`));

    if (r.sabatier.enabled) {
      rows.push(this.prodItem('ch4', '🔥', 'Methane', `${FormatNumbers.fixed(r.sabatier.ch4DailyMCF, 2)}`, `MCF/${cycleUnit}`));
    }
    if (r.methanol.enabled) {
      rows.push(this.prodItem('fuel', '🧪', 'Methanol', `${FormatNumbers.fixed(r.methanol.dailyLiters, 1)}`, `L/${cycleUnit}`));
    }
    if (r.h2Surplus > 0.1) rows.push(this.prodItem('h2', '💨', 'Unused H₂', `${FormatNumbers.fixed(r.h2Surplus, 1)}`, `kg/${cycleUnit}`));
    if (r.co2Surplus > 0.1) rows.push(this.prodItem('co2', '☁️', 'CO₂ Surplus', `${FormatNumbers.fixed(r.co2Surplus, 1)}`, `kg/${cycleUnit}`));

    document.getElementById('productionGrid').innerHTML = rows.join('');
  }

  prodItem(cls, _icon, label, value, unit) {
    const unitMarkup = unit ? `<span class="prod-unit">${unit}</span>` : '';
    return `<div class="production-item ${cls}">
      <span class="prod-label"><span class="prod-dot" aria-hidden="true"></span>${label}</span>
      <span class="prod-value">${value}${unitMarkup}</span>
    </div>`;
  }

  updateEconomics(r) {
    const e = r.economics;
    const solarBreakdown = e.capexBreakdown || {};
    const methaneMarket = this.getMethaneMarketConfig();
    let html = '';
    html += this.econRow('Installed CAPEX', '', 'header');
    html += this.econRow('Solar modules', this.formatMoney(solarBreakdown.solarModules || 0));
    html += this.econRow('Solar structure + install BOS', this.formatMoney(solarBreakdown.solarBos || 0));
    if ((solarBreakdown.solarLand || 0) > 0) html += this.econRow('Land acquisition', this.formatMoney(solarBreakdown.solarLand));
    if ((solarBreakdown.solarSitePrep || 0) > 0) html += this.econRow('Site prep', this.formatMoney(solarBreakdown.solarSitePrep));
    html += this.econRow('Total solar installation', this.formatMoney(e.capex.solar));
    if (e.capex.battery > 0) html += this.econRow('Battery', this.formatMoney(e.capex.battery));
    if (e.capex.ai > 0) html += this.econRow('AI datacenter', this.formatMoney(e.capex.ai));
    if (e.capex.electrolyzer > 0) html += this.econRow('Electrolyzer', this.formatMoney(e.capex.electrolyzer));
    if (e.capex.dac > 0) html += this.econRow('DAC', this.formatMoney(e.capex.dac));
    if (e.capex.sabatier > 0) html += this.econRow('Methane reactor', this.formatMoney(e.capex.sabatier));
    if (e.capex.methanol > 0) html += this.econRow('Methanol reactor', this.formatMoney(e.capex.methanol));
    html += this.econRow('Total CAPEX', this.formatMoney(e.totalCapex), 'total');

    if (e.financing.enabled) {
      html += this.econRow('Financing', '', 'header');
      html += this.econRow('Debt share', `${FormatNumbers.fixed(e.financing.debtSharePercent, 0)}% of upfront CAPEX`);
      html += this.econRow('Debt-funded at close', this.formatMoney(e.financing.debtAmount), 'positive');
      html += this.econRow('Equity-funded CAPEX', this.formatMoney(e.financing.equityCapex), 'negative');
      if (e.financing.upfrontFee > 0) {
        html += this.econRow('Upfront financing fee', this.formatMoney(e.financing.upfrontFee), 'negative');
      }
      html += this.econRow('Total sponsor cash at close', this.formatMoney(e.financing.equityUpfront), 'negative');
      html += this.econRow('Debt coupon', `${FormatNumbers.fixed(e.financing.debtInterestRate, 2)}%`);
      html += this.econRow('Debt term', `${FormatNumbers.fixed(e.financing.debtTermYears, 0)} years`);
      if (e.financing.totalDebtService > 0) {
        html += this.econRow(
          'Annual debt service',
          this.formatMoney(e.financing.annualDebtService),
          'negative',
          'Modeled as a level-payment amortizing loan over the selected debt term.'
        );
        html += this.econRow('Total debt interest', this.formatMoney(e.financing.totalInterest), 'negative');
      }
    }

    html += this.econRow('Levelized annual cost (CRF)', '', 'header');
    html += this.econRow(
      'Capital recovery',
      this.formatMoney(e.annualizedCapexTotal),
      'negative',
      `Upfront CAPEX x capital recovery factor at ${FormatNumbers.fixed(this.state.discountRate, 1)}% and each asset's book life. This is the economic annual capital charge, not straight-line depreciation.`
    );
    if (r.ai.enabled && r.ai.annualOM > 0) {
      html += this.econRow('AI fixed O&M', this.formatMoney(r.ai.annualOM), 'negative');
    }
    html += this.econRow('Total O&M', this.formatMoney(e.annualOM), 'negative');
    html += this.econRow('Total levelized annual cost', this.formatMoney(e.annualCost), 'negative');

    html += this.econRow('Revenue', '', 'header');
    if (e.revenue.ai > 0) {
      html += this.econRow('AI token price', `$${FormatNumbers.fixed(this.state.aiTokenPricePerM, 2)} / 1M tokens`);
      html += this.econRow('AI throughput', `${Math.round(this.state.aiMillionTokensPerMWh).toLocaleString()} M tokens/MWh`);
      html += this.econRow('AI tokens sold', `${FormatNumbers.fixed(r.ai.annualTokensM / 1000, 2)}B /yr`);
      html += this.econRow('AI token revenue', this.formatMoney(e.revenue.ai), 'positive');
    }
    if (e.revenue.methane > 0) {
      html += this.econRow('Methane market scope', methaneMarket.applicability);
      html += this.econRow('Methane market basis', methaneMarket.label);
    }
    if (e.revenue.methane > 0) html += this.econRow(`Methane @ $${FormatNumbers.fixed(e.methaneSalePrice, 2)}/MCF`, this.formatMoney(e.revenue.methane), 'positive');
    if (e.revenue.methanol > 0) html += this.econRow('Methanol sales', this.formatMoney(e.revenue.methanol), 'positive');
    if (e.policy.mode !== 'none') {
      html += this.econRow('Policy scope', e.policy.applicability);
      html += this.econRow('Policy basis', e.policy.basis);
      if (Number.isFinite(e.policy.durationYears)) {
        html += this.econRow('Policy duration', `${FormatNumbers.fixed(e.policy.durationYears, 0)} years`);
      }
      if (e.policy.co2Credit > 0) {
        const co2Basis = e.policy.mode === 'us_45q_sequestration'
          ? 'Eligible sequestered CO₂'
          : e.policy.mode === 'us_45q_utilization'
            ? 'Eligible utilized CO₂'
            : 'Eligible CO₂';
        html += this.econRow(co2Basis, `${FormatNumbers.fixed(e.policy.eligibleCo2Tons, 1)} tons/yr`);
      }
    }
    if (e.revenue.policyCredits > 0) html += this.econRow(e.policy.label, this.formatMoney(e.revenue.policyCredits), 'positive');
    html += this.econRow('Total Revenue', this.formatMoney(e.totalAnnualRevenue), 'total');

    if (r.h2Surplus > 0.1 || r.co2Surplus > 0.1) {
      html += this.econRow('Losses / Unused Output', '', 'header');
      if (r.h2Surplus > 0.1) {
        html += this.econRow('Unused H₂', `${FormatNumbers.fixed(r.h2Surplus, 1)} kg/${this.getCycleRateUnit(r)}`);
      }
      if (r.co2Surplus > 0.1) {
        html += this.econRow('Unused CO₂', `${FormatNumbers.fixed(r.co2Surplus, 1)} kg/${this.getCycleRateUnit(r)}`);
      }
    }

    html += this.econRow('Key Metrics', '', 'header');
    const projectNpvLabel = e.financing.enabled ? 'Project NPV' : 'NPV';
    const projectIrrLabel = e.financing.enabled ? 'Project IRR' : 'IRR';
    const projectPaybackLabel = e.financing.enabled ? 'Project Payback' : 'Payback';
    html += this.econRow(
      'Annual profit (levelized)',
      this.formatMoney(e.annualProfit),
      e.annualProfit >= 0 ? 'positive' : 'negative',
      'Revenue minus total levelized annual cost (capital recovery + O&M).'
    );
    html += this.econRow(
      projectNpvLabel,
      this.formatMoney(e.npv),
      e.npv >= 0 ? 'positive' : 'negative',
      'Discounted cash flows: -upfront CAPEX in year 0, then yearly revenue minus O&M and any scheduled replacement CAPEX. CRF capital recovery is not repeated as a cash outflow.'
    );
    html += this.econRow(
      projectIrrLabel,
      this.formatIrr(e.projectIrr),
      Number.isFinite(e.projectIrr) ? (e.projectIrr >= 0 ? 'positive' : 'negative') : '',
      'Internal rate of return on the same net-cash path as NPV after O&M and scheduled replacements.'
    );
    if (e.financing.enabled) {
      html += this.econRow(
        'Equity IRR',
        this.formatIrr(e.equityIrr),
        Number.isFinite(e.equityIrr) ? (e.equityIrr >= 0 ? 'positive' : 'negative') : '',
        'IRR on sponsor equity cash flows: upfront equity plus financing fees in year 0, then project net cash after scheduled debt service.'
      );
    }
    html += this.econRow(
      projectPaybackLabel,
      Number.isFinite(e.paybackYears) ? `${FormatNumbers.fixed(e.paybackYears, 1)} years` : 'N/A',
      '',
      'Simple payback on cumulative net cash versus upfront CAPEX. It is only shown if the project stays cash-positive through the selected horizon.'
    );
    if (e.financing.enabled) {
      html += this.econRow(
        'Equity payback',
        Number.isFinite(e.equityPaybackYears) ? `${FormatNumbers.fixed(e.equityPaybackYears, 1)} years` : 'N/A',
        '',
        'Simple payback on cumulative sponsor equity cash after scheduled debt service.'
      );
    }
    if (e.totalReplacementOutflows > 0) {
      html += this.econRow(
        'Scheduled replacements',
        this.formatMoney(e.totalReplacementOutflows),
        'negative',
        'Full equipment replacement CAPEX that lands inside the selected analysis horizon and is included in NPV, IRR, ROI, and payback.'
      );
    }

    if (r.ai.enabled) {
      html += this.econRow('AI load auto-sized', this.formatSystemSizeMW(r.ai.designLoadKW / 1000));
      html += this.econRow('Delivered AI utilization', `${FormatNumbers.fixed(r.ai.utilization * 100, 2)}%`);
      html += this.econRow('Full-rate reliability', `${FormatNumbers.fixed(r.ai.fullPowerReliability * 100, 2)}%`);
      html += this.econRow('Integrated AI cost', `$${FormatNumbers.fixed(e.costPerMToken, 2)} / 1M tokens`);
      html += this.econRow('Token margin', `${e.tokenMarginPerM >= 0 ? '+' : ''}$${FormatNumbers.fixed(e.tokenMarginPerM, 2)} / 1M`, e.tokenMarginPerM >= 0 ? 'positive' : 'negative');
    }
    if (e.costPerKgH2 > 0) html += this.econRow('Integrated H₂ cost', `$${FormatNumbers.fixed(e.costPerKgH2, 2)}/kg`);
    if (e.costPerTonCO2 > 0) html += this.econRow('Integrated CO₂ cost', `$${FormatNumbers.fixed(e.costPerTonCO2, 0)}/ton`);
    if (e.costPerMCF > 0) html += this.econRow('Integrated CH₄ cost', `$${FormatNumbers.fixed(e.costPerMCF, 2)}/MCF`);

    if (e.excludedModules.length) {
      html += this.econRow('Excluded from ROI', '', 'header');
      html += this.econRow('Exploratory modules', e.excludedModules.join(', '));
    }

    document.getElementById('econBreakdown').innerHTML = html;
  }

  econRow(label, value, cls = '', title = '') {
    const safeTitle = title
      ? ` title="${String(title).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`
      : '';
    return `<div class="econ-row ${cls}"${safeTitle}>
      <span class="econ-label">${label}</span>
      <span class="econ-value">${value}</span>
    </div>`;
  }

  updateImpact(r) {
    const cycleUnit = this.getCycleRateUnit(r);
    const env = r.environmental;
    const html = [
      this.prodItem('co2', '🌍', 'CO₂ Captured', `${FormatNumbers.fixed(env.co2Captured, 1)}`, 'tons/yr'),
      this.prodItem('ch4', '♻️', 'CO₂ Displaced', `${FormatNumbers.fixed(env.co2Displaced, 1)}`, 'tons/yr'),
      this.prodItem('solar', '📐', 'Land Use', `${FormatNumbers.fixed(env.landAcres, 1)}`, 'acres'),
      this.prodItem('ch4', '🏠', 'Homes Served', `${FormatNumbers.fixed(env.homesServed, 0)}`, 'homes'),
      this.prodItem('h2', '♻️', 'Water Recycled', `${FormatNumbers.fixed(env.waterRecycledDaily, 0)}`, `L/${cycleUnit}`),
      this.prodItem('h2', '💧', 'Net Water Needed', `${FormatNumbers.fixed(env.netWaterDaily, 0)}`, `L/${cycleUnit}`),
    ];
    document.getElementById('impactGrid').innerHTML = html.join('');
  }

  updatePowerChart(r) {
    const aiMode = r.ai.enabled;
    const specificAiDaySelected = aiMode && r.solar.bodyKey === 'earth' && this.state.dayMode === 'specific';
    const selectedDayIndex = Math.max(0, Math.min(364, (this.state.dayOfYear || 1) - 1));
    const selectedDayLabel = `${SolarGeometry.dayToDateString(this.state.dayOfYear)}${SolarGeometry.notableDay(this.state.dayOfYear)}`;
    const sliceSelectedDay = series => {
      if (!Array.isArray(series) || !series.length) return [];
      const start = selectedDayIndex * 24;
      const slice = series.slice(start, start + 24);
      return slice.length === 24 ? slice : [];
    };
    const specificSolarData = sliceSelectedDay(r.annualSolar?.hourlyKW);
    const specificAiData = sliceSelectedDay(r.ai.dispatch?.aiHourlyKW);
    const specificBatteryChargeData = sliceSelectedDay(r.ai.dispatch?.batteryChargeHourlyKW);
    const specificChemicalData = sliceSelectedDay(r.ai.dispatch?.chemicalHourlyKW);
    const showSpecificAiDay = specificAiDaySelected &&
      specificSolarData.length === 24 &&
      specificAiData.length === 24 &&
      specificChemicalData.length === 24;
    const dayLabel = aiMode
      ? (showSpecificAiDay ? `— ${selectedDayLabel}` : '— Yearly Dispatch Average')
      : (r.solar.bodyKey === 'earth' && this.state.dayMode === 'specific')
        ? `— ${selectedDayLabel}`
        : r.solar.bodyKey === 'earth'
          ? '— Annual Average'
          : `— Average local ${r.solar.cycleUnit}`;
    document.getElementById('powerChartDayLabel').textContent = dayLabel;
    const powerChartNote = document.getElementById('powerChartNote');
    if (powerChartNote) {
      const noteParts = [];
      if (aiMode) {
        noteParts.push(r.battery.enabled
          ? (showSpecificAiDay
              ? 'Hourly dispatch for the selected day using the annual AI load sizing. AI is served first, battery charging is shown separately, and chemistry only runs on residual solar left after charging.'
              : 'Average hour-of-day dispatch across the modeled year. AI is served first, battery charging is shown separately, and chemicals only consume residual energy left after charging.')
          : (showSpecificAiDay
              ? 'Hourly dispatch for the selected day using the annual AI load sizing. AI is served first, and chemistry only runs on residual solar left after AI demand.'
              : 'Average hour-of-day dispatch across the modeled year. AI is served first; chemicals only consume residual energy.'));
      } else if (r.battery.enabled) {
        noteParts.push(r.solar.bodyKey === 'earth' && this.state.dayMode === 'specific'
          ? 'Battery-backed dispatch for the selected day. The chemical plant is sized to the lowest peak load that still absorbs the modeled solar energy; excess solar charges the battery and stored energy extends operation later in the day.'
          : 'Representative battery-backed dispatch for the modeled cycle. The chemical plant is sized to the lowest peak load that still absorbs the modeled solar energy; excess solar charges the battery and stored energy extends operation later in the cycle.');
        if (r.solar.chartNote) noteParts.push(r.solar.chartNote);
      } else {
        noteParts.push(r.solar.bodyKey === 'earth' && this.state.dayMode === 'specific'
          ? 'Chemical load for the selected day with no battery shifting. The process follows the solar profile directly.'
          : 'Representative chemical load with no battery shifting. The process follows the solar profile directly.');
        if (r.solar.chartNote) noteParts.push(r.solar.chartNote);
      }
      if (!aiMode && r.solar.bodyKey === 'earth') {
        noteParts.push('Daily chart shape varies by mounting type; annual economics still follow the annual yield input.');
      }
      powerChartNote.textContent = noteParts.join(' ');
    }

    const solarData = aiMode
      ? (showSpecificAiDay ? specificSolarData : (r.annualSolar.averageDayKW || []))
      : r.solar.hourlyProfile.map(v => Math.min((v * r.solar.dailyKWh) / r.solar.binHours, r.solar.peakPowerKW));
    const labels = aiMode
      ? Array.from({ length: solarData.length }, (_, i) => `${i}:00`)
      : this.getPowerChartLabels(r);
    const aiData = aiMode
      ? (showSpecificAiDay ? specificAiData : (r.ai.dispatch.averageDayAiKW || []))
      : [];
    const batteryChargeData = aiMode
      ? (showSpecificAiDay ? specificBatteryChargeData : (r.ai.dispatch.averageDayBatteryChargeKW || []))
      : (r.battery.batteryChargeHourlyKW || []);
    const chemicalData = aiMode
      ? (showSpecificAiDay ? specificChemicalData : (r.ai.dispatch.averageDayChemicalKW || []))
      : (r.battery.enabled ? (r.battery.hourlyKW || []) : solarData);
    const showBatteryChargeSeries = r.battery.enabled &&
      batteryChargeData.length === labels.length &&
      batteryChargeData.some(value => value > 1e-6);
    const chartKey = JSON.stringify({
      dayLabel,
      labels,
      aiMode,
      batteryEnabled: r.battery.enabled,
      solarData,
      aiData,
      batteryChargeData: showBatteryChargeSeries ? batteryChargeData : [],
      chemicalData,
    });

    if (this.chartKeys.power === chartKey && this.charts.power) return;

    const datasets = [
      {
        label: 'Solar output (kW)',
        data: solarData,
        borderColor: '#f59e0b',
        backgroundColor: 'rgba(245, 158, 11, 0.1)',
        fill: true,
        tension: 0.4,
        pointRadius: 0,
        borderWidth: 2,
      },
      ...(aiMode ? [
        {
          label: 'AI served (kW)',
          data: aiData,
          borderColor: '#38bdf8',
          backgroundColor: 'rgba(56, 189, 248, 0.08)',
          fill: false,
          tension: 0.35,
          pointRadius: 0,
          borderWidth: 2,
        },
        ...(showBatteryChargeSeries ? [{
          label: 'Battery charging (kW)',
          data: batteryChargeData,
          borderColor: '#6366f1',
          backgroundColor: 'rgba(99, 102, 241, 0.1)',
          fill: false,
          tension: 0.35,
          pointRadius: 0,
          borderWidth: 2,
        }] : []),
        {
          label: 'Residual chemical load (kW)',
          data: chemicalData,
          borderColor: '#10b981',
          backgroundColor: 'rgba(16, 185, 129, 0.16)',
          fill: true,
          tension: 0.35,
          pointRadius: 0,
          borderWidth: 2,
        },
      ] : [
        ...(showBatteryChargeSeries ? [{
          label: 'Battery charging (kW)',
          data: batteryChargeData,
          borderColor: '#6366f1',
          backgroundColor: 'rgba(99, 102, 241, 0.1)',
          fill: false,
          tension: 0.35,
          pointRadius: 0,
          borderWidth: 2,
        }] : []),
        {
          label: 'Chemical load (kW)',
          data: chemicalData,
          borderColor: '#10b981',
          backgroundColor: 'rgba(16, 185, 129, 0.16)',
          fill: true,
          tension: 0.35,
          pointRadius: 0,
          borderWidth: 2,
        },
      ]),
    ];

    if (!this.charts.power) {
      this.charts.power = new Chart(document.getElementById('powerChart'), {
        type: 'line',
        data: { labels, datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { labels: { color: '#94a3b8', font: { size: 10 } } },
            tooltip: {
              callbacks: {
                label(ctx) {
                  const y = ctx.parsed.y;
                  if (!Number.isFinite(y)) return ctx.dataset.label;
                  const dec = Math.abs(y) >= 100 ? 0 : 1;
                  return `${ctx.dataset.label}: ${FormatNumbers.fixed(y, dec)}`;
                },
              },
            },
          },
          scales: {
            x: {
              ticks: { color: '#64748b', font: { size: 9 }, maxTicksLimit: 12 },
              grid: { color: '#1e293b' },
              title: {
                display: true,
                text: aiMode ? 'Hour of day' : (r.solar.chartLabelMode === 'days' ? 'Earth days into local cycle' : 'Local solar time'),
                color: '#64748b',
                font: { size: 10 },
              },
            },
            y: {
              ticks: {
                color: '#64748b',
                font: { size: 9 },
                callback: v => FormatNumbers.fixed(v, Math.abs(v) >= 1000 ? 0 : 1),
              },
              grid: { color: '#1e293b' },
              beginAtZero: true,
              title: { display: true, text: 'kW', color: '#64748b', font: { size: 10 } },
            },
          },
        },
      });
    } else {
      this.charts.power.data.labels = labels;
      this.charts.power.data.datasets = datasets;
      this.charts.power.options.scales.x.title.text = aiMode ? 'Hour of day' : (r.solar.chartLabelMode === 'days' ? 'Earth days into local cycle' : 'Local solar time');
      this.charts.power.update();
    }

    this.chartKeys.power = chartKey;
  }

  updateAnnualDispatchChart(r) {
    const rawDayLabels = r.annualDispatch?.dayLabels || [];
    const labels = rawDayLabels.map(label => {
      const match = /^Day (\d+)$/.exec(String(label));
      if (match) return `Day ${FormatNumbers.fixed(parseInt(match[1], 10), 0)}`;
      return label;
    });
    const aiSeries = (r.annualDispatch?.dailyAiKWh || []).map(value => value / 1000);
    const chemicalSeries = (r.annualDispatch?.dailyChemicalKWh || []).map(value => value / 1000);
    const annualDispatchNote = document.getElementById('annualDispatchNote');
    if (annualDispatchNote) {
      annualDispatchNote.textContent = r.ai.enabled
        ? 'Daily delivered energy over the modeled year. AI gets first call on solar and battery support; chemistry only runs on the residual energy left over.'
        : 'Daily seasonal solar energy over the modeled year. Enable AI Compute to see how the datacenter carves out a high-reliability constant load before chemistry absorbs the residual.';
    }

    const chartKey = JSON.stringify({
      labels,
      aiEnabled: r.ai.enabled,
      aiSeries,
      chemicalSeries,
    });
    if (this.chartKeys.annualDispatch === chartKey && this.charts.annualDispatch) return;

    const datasets = [
      {
        label: 'AI energy (MWh/day)',
        data: aiSeries,
        borderColor: '#38bdf8',
        backgroundColor: 'rgba(56, 189, 248, 0.2)',
        fill: true,
        tension: 0.25,
        pointRadius: 0,
        borderWidth: 2,
      },
      {
        label: 'Chemical energy (MWh/day)',
        data: chemicalSeries,
        borderColor: '#10b981',
        backgroundColor: 'rgba(16, 185, 129, 0.18)',
        fill: true,
        tension: 0.25,
        pointRadius: 0,
        borderWidth: 2,
      },
    ];

    if (!this.charts.annualDispatch) {
      this.charts.annualDispatch = new Chart(document.getElementById('annualDispatchChart'), {
        type: 'line',
        data: { labels, datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { labels: { color: '#94a3b8', font: { size: 10 } } },
            tooltip: {
              callbacks: {
                label(ctx) {
                  const y = ctx.parsed.y;
                  if (!Number.isFinite(y)) return ctx.dataset.label;
                  return `${ctx.dataset.label}: ${FormatNumbers.fixed(y, 2)}`;
                },
              },
            },
          },
          scales: {
            x: {
              ticks: { color: '#64748b', font: { size: 9 }, maxTicksLimit: 12 },
              grid: { color: '#1e293b' },
              title: { display: true, text: 'Day of year', color: '#64748b', font: { size: 10 } },
            },
            y: {
              ticks: {
                color: '#64748b',
                font: { size: 9 },
                callback: v => FormatNumbers.fixed(v, 2),
              },
              grid: { color: '#1e293b' },
              beginAtZero: true,
              title: { display: true, text: 'MWh/day', color: '#64748b', font: { size: 10 } },
            },
          },
        },
      });
    } else {
      this.charts.annualDispatch.data.labels = labels;
      this.charts.annualDispatch.data.datasets = datasets;
      this.charts.annualDispatch.update();
    }

    this.chartKeys.annualDispatch = chartKey;
  }

  updateEconChart(r) {
    const e = r.economics;
    const solarBreakdown = e.capexBreakdown || {};
    const labels = [];
    const values = [];
    const colors = [];
    if ((solarBreakdown.solarModules || 0) > 0) { labels.push('Solar modules'); values.push(solarBreakdown.solarModules); colors.push('#f59e0b'); }
    if ((solarBreakdown.solarBos || 0) > 0) { labels.push('Solar BOS'); values.push(solarBreakdown.solarBos); colors.push('#fbbf24'); }
    if ((solarBreakdown.solarLand || 0) > 0) { labels.push('Land'); values.push(solarBreakdown.solarLand); colors.push('#84cc16'); }
    if ((solarBreakdown.solarSitePrep || 0) > 0) { labels.push('Site prep'); values.push(solarBreakdown.solarSitePrep); colors.push('#22c55e'); }
    if (e.capex.battery > 0) { labels.push('Battery'); values.push(e.capex.battery); colors.push('#6366f1'); }
    if (e.capex.ai > 0) { labels.push('AI datacenter'); values.push(e.capex.ai); colors.push('#38bdf8'); }
    if (e.capex.electrolyzer > 0) { labels.push('Electrolyzer'); values.push(e.capex.electrolyzer); colors.push('#06b6d4'); }
    if (e.capex.dac > 0) { labels.push('DAC'); values.push(e.capex.dac); colors.push('#8b5cf6'); }
    if (e.capex.sabatier > 0) { labels.push('Methane'); values.push(e.capex.sabatier); colors.push('#10b981'); }
    if (e.capex.methanol > 0) { labels.push('Methanol'); values.push(e.capex.methanol); colors.push('#f97316'); }

    const compact = compactCapexChartData(labels, values, colors);
    const sliceCount = compact.labels.length;
    const borderW = sliceCount > 7 ? 1 : 2;

    if (this.charts.econ) this.charts.econ.destroy();
    this.charts.econ = new Chart(document.getElementById('econChart'), {
      type: 'doughnut',
      data: {
        labels: compact.labels,
        datasets: [{
          data: compact.values,
          backgroundColor: compact.colors,
          borderColor: '#1a2236',
          borderWidth: borderW,
          hoverBorderWidth: borderW,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { bottom: 2 } },
        plugins: {
          legend: {
            position: 'bottom',
            align: 'center',
            labels: {
              color: '#94a3b8',
              font: { size: 9 },
              padding: 8,
              boxWidth: 10,
              boxHeight: 10,
            },
          },
          title: {
            display: true,
            text: 'Installed CAPEX Breakdown',
            color: '#94a3b8',
            font: { size: 11 },
            padding: { bottom: 10 },
          },
          tooltip: {
            callbacks: {
              label(ctx) {
                const v = ctx.raw;
                return `${ctx.label}: ${FormatNumbers.formatMoney(v)}`;
              },
            },
          },
        },
      },
    });
  }

  updateSensitivityChart(r = this.lastResults) {
    const emptyState = document.getElementById('sensitivityEmptyState');
    const sensitivityConfigs = [
      {
        chartKey: 'sensitivityMethane',
        wrapperId: 'sensitivityMethaneCard',
        canvasId: 'sensitivityMethaneChart',
        paramKey: 'methanePrice',
        prices: [2, 3, 4, 6, 8, 10, 15, 20, 25, 30],
        axisLabel: 'Methane price ($/MCF)',
        lineColor: '#10b981',
        active: Boolean(r?.sabatier?.enabled) && (r?.sabatier?.ch4AnnualMCF || 0) > 0,
        formatLabel: value => `$${FormatNumbers.fixed(value, 0)}`,
      },
      {
        chartKey: 'sensitivityMethanol',
        wrapperId: 'sensitivityMethanolCard',
        canvasId: 'sensitivityMethanolChart',
        paramKey: 'methanolPrice',
        prices: [100, 200, 300, 400, 600, 800, 1000, 1200],
        axisLabel: 'Methanol price ($/ton)',
        lineColor: '#f97316',
        active: Boolean(r?.methanol?.enabled) && (r?.methanol?.annualTons || 0) > 0,
        formatLabel: value => `$${FormatNumbers.fixed(value, 0)}`,
      },
      {
        chartKey: 'sensitivityAi',
        wrapperId: 'sensitivityAiCard',
        canvasId: 'sensitivityAiChart',
        paramKey: 'aiTokenPricePerM',
        prices: [0.5, 1, 2, 3, 5, 8, 12, 16],
        axisLabel: 'AI token price ($ / 1M tokens)',
        lineColor: '#38bdf8',
        active: Boolean(r?.ai?.enabled) && (r?.ai?.annualTokensM || 0) > 0,
        formatLabel: value => `$${Number.isInteger(value) ? FormatNumbers.fixed(value, 0) : FormatNumbers.fixed(value, 2)}`,
      },
    ];

    if (this.charts.sensitivity) {
      this.charts.sensitivity.destroy();
      delete this.charts.sensitivity;
    }

    let visibleChartCount = 0;

    sensitivityConfigs.forEach(config => {
      const wrapper = document.getElementById(config.wrapperId);
      const canvas = document.getElementById(config.canvasId);

      if (wrapper) wrapper.hidden = !config.active;
      if (this.charts[config.chartKey]) {
        this.charts[config.chartKey].destroy();
        delete this.charts[config.chartKey];
      }
      if (!config.active || !canvas) return;

      visibleChartCount += 1;
      const series = Calc.runSensitivity(this.state, config.paramKey, config.prices);
      this.charts[config.chartKey] = new Chart(canvas, {
        type: 'line',
        data: {
          labels: config.prices.map(config.formatLabel),
          datasets: [
            {
              label: 'NPV',
              data: series.map(point => point.npv),
              borderColor: config.lineColor,
              tension: 0.3,
              pointRadius: 3,
              borderWidth: 2,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label(ctx) {
                  const y = ctx.parsed.y;
                  if (!Number.isFinite(y)) return ctx.dataset.label;
                  return `${ctx.dataset.label}: ${FormatNumbers.formatMoney(y)}`;
                },
              },
            },
          },
          scales: {
            x: {
              title: {
                display: true,
                text: config.axisLabel,
                color: '#64748b',
                font: { size: 10 },
              },
              ticks: { color: '#64748b', font: { size: 9 } },
              grid: { color: '#1e293b' },
            },
            y: {
              title: { display: true, text: 'NPV ($)', color: '#64748b', font: { size: 10 } },
              ticks: {
                color: '#64748b',
                font: { size: 9 },
                callback: value => FormatNumbers.formatMoney(Number(value)),
              },
              grid: { color: '#1e293b' },
            },
          },
        },
      });
    });

    if (emptyState) emptyState.hidden = visibleChartCount > 0;
  }

  formatConfigValue(unit, value) {
    const numeric = parseFloat(value);
    if (unit === '%') return `${FormatNumbers.fixed(numeric, numeric % 1 ? 1 : 0)}%`;
    if (unit === '$') return `$${FormatNumbers.fixed(Math.round(numeric), 0)}`;
    if (unit === '$/W') return `$${FormatNumbers.fixed(numeric, 2)}/W`;
    if (unit === '$/kW') return `$${FormatNumbers.fixed(Math.round(numeric), 0)}/kW`;
    if (unit === '$/t-yr') return `$${FormatNumbers.fixed(Math.round(numeric), 0)}/t-yr`;
    if (unit === '$/kg-feed-hr') return `$${FormatNumbers.fixed(Math.round(numeric), 0)}/(kg/h feed)`;
    if (unit === 'kWh/kg') return `${FormatNumbers.fixed(Math.round(numeric), 0)} kWh/kg`;
    if (unit === 'kWh/t') return `${FormatNumbers.fixed(Math.round(numeric), 0)} kWh/t`;
    return `${FormatNumbers.fixed(numeric, Number.isInteger(numeric) ? 0 : 2)}`;
  }

  formatMoney(val) {
    return FormatNumbers.formatMoney(val);
  }

  formatIrr(val) {
    if (!Number.isFinite(val) || val <= -99.9) return 'N/A';
    return `${FormatNumbers.fixed(val, 1)}%`;
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
