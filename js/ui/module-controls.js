/* Process-module controls: card markup, preset/route selects, and route-dependent sliders */

import { Calc } from '../model/index.js';
import { ModuleCatalog } from '../model/module-catalog.js';
import { FormatNumbers } from './format-numbers.js';
import {
  formatConfigValue,
  formatExploratoryCapexBasis,
  formatExploratoryOmPercent,
  formatExploratoryPriorityWeight,
  formatModuleMarketValue,
  formatMtgMethanolSplit,
} from './formatters.js';

const hiddenAttr = show => (show ? '' : ' hidden');

export const moduleControlMethods = {
  getSelectedModulePreset(moduleId, state = this.state) {
    return ModuleCatalog.getMatchingPreset(moduleId, state)?.value || 'custom';
  },

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
  },

  renderExploratoryMarketControls() {
    const container = document.getElementById('exploratoryMarketControls');
    if (!container) return;

    const controls = ModuleCatalog.getExploratoryModules()
      .map(module => {
        const route = this.state[`${module.id}Route`];
        const marketConfig = ModuleCatalog.getMarketConfig(module.id, route);
        if (!marketConfig) return '';
        const priceKey = `${module.id}Price`;
        const currentValue = this.state[priceKey] ?? marketConfig.defaultValue;
        return `
          <div id="${module.id}MarketWrap" class="market-exploratory-group" hidden>
            <div class="module-note-title">${module.label}</div>
            <label>
              <span id="${module.id}MarketLabel">${marketConfig.label} (${marketConfig.unitLabel})</span>
              <input type="range" id="${priceKey}" min="${marketConfig.min}" max="${marketConfig.max}" step="${marketConfig.step}" value="${currentValue}">
              <span class="range-value" id="${priceKey}Value">${formatModuleMarketValue(module.id, route, currentValue)}</span>
            </label>
          </div>
        `;
      })
      .join('');

    container.innerHTML = controls;
  },

  renderExploratoryOmControls() {
    const container = document.getElementById('exploratoryOmControls');
    if (!container) return;

    container.innerHTML = `
      <div id="exploratoryOmWrap" class="market-exploratory-group" hidden>
        <div class="module-note-title">Shared exploratory plants</div>
        <label>
          Exploratory M&amp;O (% CAPEX / yr)
          <input type="range" id="exploratoryOmPercent" min="0" max="20" step="0.5" value="${this.state.exploratoryOmPercent ?? 4}">
          <span class="range-value" id="exploratoryOmPercentValue">${formatExploratoryOmPercent(this.state.exploratoryOmPercent ?? 4)}</span>
        </label>
      </div>
    `;
  },

  renderModuleBufferControl(module, route = null) {
    if (!Calc.hasModuleFeedBufferSupport(module.id)) return '';

    const bufferKey = `${module.id}BufferEnabled`;
    return `
      <div id="${module.id}BufferWrap"${hiddenAttr(Calc.moduleSupportsFeedBuffer(module.id, route))}>
        <label class="toggle-label">
          <input type="checkbox" id="${bufferKey}" ${this.state[bufferKey] ? 'checked' : ''}>
          <span>${Calc.getModuleFeedBufferLabel(module.id, route)}</span>
        </label>
      </div>
    `;
  },

  renderModuleCard(module, { cardClass, badgeClass, body }) {
    const enabled = this.state[`${module.id}Enabled`];
    return `
      <div class="process-card ${cardClass}" data-process="${module.id}">
        <div class="process-header">
          <label class="toggle-label">
            <input type="checkbox" id="${module.id}Enabled" ${enabled ? 'checked' : ''}>
            <span>${module.label}</span>
          </label>
          <span class="maturity-badge ${badgeClass}">${module.exploratory ? 'Exploratory' : 'Supported'}</span>
        </div>
        <div class="process-config disabled-group ${enabled ? 'active' : ''}" id="${module.id}Config">
          ${body}
        </div>
      </div>
    `;
  },

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
    const configs = module.configs.map(config => {
      const isLog = config.scale === 'log';
      const stateValue = this.state[config.key];
      const sliderMin = isLog ? Math.log10(config.min) : config.min;
      const sliderMax = isLog ? Math.log10(config.max) : config.max;
      const sliderStep = isLog ? 0.001 : config.step;
      const sliderValue = isLog ? Math.log10(stateValue) : stateValue;
      const dataScale = isLog ? ' data-scale="log"' : '';
      return `
      <label>${config.label}
        <input type="range" id="${config.key}"${dataScale} min="${sliderMin}" max="${sliderMax}" step="${sliderStep}" value="${sliderValue}">
        <span class="range-value" id="${config.key}Value">${formatConfigValue(config.unit, stateValue)}</span>
      </label>
    `;
    }).join('');
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

    return this.renderModuleCard(module, {
      cardClass: module.kind === 'product' ? 'product-card' : '',
      badgeClass: 'supported',
      body: `
          ${presetControl}
          ${configs}
          ${assetLifeControl}
          ${bufferControl}
          ${allocNote}
        `,
    });
  },

  renderExploratoryModule(module) {
    const route = this.state[`${module.id}Route`];
    const routeOptions = ModuleCatalog.getRouteOptions(module).map(option =>
      `<option value="${option.value}" ${route === option.value ? 'selected' : ''}>${option.label}</option>`
    ).join('');
    const priorityKey = `${module.id}PriorityWeight`;
    const capexKey = `${module.id}CapexBasis`;
    const capexControl = Calc.getModuleCapexControlConfig(module.id, route);
    const capexValue = this.state[capexKey] ?? capexControl.defaultValue;
    // MTG takes no shared H2 / CO2: its throughput (and power) follows the
    // methanol diverted to it, so it has no pool priority.
    const priorityControl = module.id === 'mtg' ? '' : `
      <label>Shared Pool Priority
        <input type="range" id="${priorityKey}" min="0" max="100" step="5" value="${this.state[priorityKey] ?? 100}">
        <span class="range-value" id="${priorityKey}Value">${formatExploratoryPriorityWeight(this.state[priorityKey] ?? 100)}</span>
      </label>
    `;
    const capexBlock = `
      <label>
        <span id="${module.id}CapexBasisLabel">CAPEX (${capexControl.unitLabel})</span>
        <input type="range" id="${capexKey}" min="${capexControl.min}" max="${capexControl.max}" step="${capexControl.step}" value="${capexValue}">
        <span class="range-value" id="${capexKey}Value">${formatExploratoryCapexBasis(module.id, route, capexValue)}</span>
      </label>
    `;
    const bufferControl = this.renderModuleBufferControl(module, route);
    const extraControls = module.id === 'mtg' ? `
      <div id="mtgMethanolSplitControl">
        <label>Methanol Diverted to MTG
          <input type="range" id="mtgMethanolSplit" min="0" max="100" step="1" value="${this.state.mtgMethanolSplit}">
          <span class="range-value" id="mtgMethanolSplitValue">${formatMtgMethanolSplit(this.state.mtgMethanolSplit)}</span>
        </label>
      </div>
    ` : '';

    return this.renderModuleCard(module, {
      cardClass: 'exploratory-card',
      badgeClass: 'exploratory',
      body: `
          <label>Route Choice
            <select id="${module.id}Route">${routeOptions}</select>
          </label>
          ${bufferControl}
          ${capexBlock}
          ${priorityControl}
          ${extraControls}
          <div class="field-note compact-note">
            ${module.id === 'mtg'
              ? 'MTG throughput, and the power it draws, follow the methanol diverted to it.'
              : 'Each route gets power and H2/CO2 in proportion to its priority (product units) x its per-unit needs.'}
            Active exploratory outputs carry route CAPEX, O&amp;M, and sale-price assumptions into ROI.
          </div>
          <div class="missing-assumptions">
            <div class="module-note-title">Key missing assumptions</div>
            <ul class="missing-list">
              ${ModuleCatalog.getMissingInputs(module).map(item => `<li>${item}</li>`).join('')}
            </ul>
          </div>
        `,
    });
  },

  /** Preset and route selects; the module checkboxes and sliders come from the control spec. */
  bindModuleControls() {
    ModuleCatalog.getAll().forEach(module => {
      if (ModuleCatalog.hasPresets(module)) {
        this.on(`${module.id}Preset`, 'change', value => {
          if (value === 'custom') {
            this.syncModulePresetControl(module.id);
            return;
          }
          this.applyModulePreset(module.id, value);
        });
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
    if (!select) return;
    select.value = this.getSelectedModulePreset(moduleId);
  },

  syncModuleControls() {
    ModuleCatalog.getAll().forEach(module => {
      const routeEl = document.getElementById(`${module.id}Route`);
      if (routeEl && this.state[`${module.id}Route`]) routeEl.value = this.state[`${module.id}Route`];
      this.syncModulePresetControl(module.id);
    });
  },

  syncModuleCapexControl(moduleId) {
    const input = document.getElementById(`${moduleId}CapexBasis`);
    const label = document.getElementById(`${moduleId}CapexBasisLabel`);
    if (!input) return;

    const capexConfig = Calc.getModuleCapexControlConfig(moduleId, this.state[`${moduleId}Route`]);
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
    if (label) label.textContent = `CAPEX (${capexConfig.unitLabel})`;
    this.syncRangeDisplay(`${moduleId}CapexBasis`, this.state[`${moduleId}CapexBasis`]);
  },

  syncModuleMarketControl(moduleId) {
    const input = document.getElementById(`${moduleId}Price`);
    const label = document.getElementById(`${moduleId}MarketLabel`);
    if (!input) return;

    const marketConfig = ModuleCatalog.getMarketConfig(moduleId, this.state[`${moduleId}Route`]);
    if (!marketConfig) return;

    input.min = String(marketConfig.min);
    input.max = String(marketConfig.max);
    input.step = String(marketConfig.step);
    this.state[`${moduleId}Price`] = Calc.clampNumber(
      this.state[`${moduleId}Price`],
      marketConfig.min,
      marketConfig.max,
      marketConfig.defaultValue
    );
    input.value = String(this.state[`${moduleId}Price`]);
    if (label) label.textContent = `${marketConfig.label} (${marketConfig.unitLabel})`;
    this.syncRangeDisplay(`${moduleId}Price`, this.state[`${moduleId}Price`]);
  },

  syncModuleBufferControl(moduleId) {
    const wrap = document.getElementById(`${moduleId}BufferWrap`);
    if (!wrap) return;
    const route = this.state[`${moduleId}Route`];
    wrap.hidden = !Calc.moduleSupportsFeedBuffer(moduleId, route);
  },
};
