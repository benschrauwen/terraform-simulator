/* Process-module controls: card markup, preset/route selects, and route-dependent sliders */

import { Calc } from '../model/index.js';
import { ModuleCatalog } from '../data/module-catalog.js';
import { FormatNumbers } from './format-numbers.js';
import {
  formatConfigValue,
  formatExploratoryCapexBasis,
  formatExploratoryOmPercent,
  formatExploratoryPriorityWeight,
  formatModuleMarketValue,
  formatMtgMethanolSplit,
} from './formatters.js';
import { escapeHtml as esc } from './renderers/markup.js';

// Every interpolation below is esc(...), a fragment built here (`...Html`)
// or a constant attribute from these helpers.
const hiddenAttr = show => (show ? '' : ' hidden');
const checkedAttr = checked => (checked ? ' checked' : '');
const selectedAttr = selected => (selected ? ' selected' : '');

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
        <div class="module-family-title">${esc(ModuleCatalog.getFamilyLabel(family))}</div>
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
        const currentValue = this.state[priceKey];
        return `
          <div id="${esc(module.id)}MarketWrap" class="market-exploratory-group" hidden>
            <div class="module-note-title">${esc(module.label)}</div>
            <label>
              <span id="${esc(module.id)}MarketLabel">${esc(marketConfig.label)} (${esc(marketConfig.unitLabel)})</span>
              <input type="range" id="${esc(priceKey)}" min="${esc(marketConfig.min)}" max="${esc(marketConfig.max)}" step="${esc(marketConfig.step)}" value="${esc(currentValue)}">
              <span class="range-value" id="${esc(priceKey)}Value">${esc(formatModuleMarketValue(module.id, route, currentValue))}</span>
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
          <input type="range" id="exploratoryOmPercent" min="0" max="20" step="0.5" value="${esc(this.state.exploratoryOmPercent)}">
          <span class="range-value" id="exploratoryOmPercentValue">${esc(formatExploratoryOmPercent(this.state.exploratoryOmPercent))}</span>
        </label>
      </div>
    `;
  },

  renderModuleBufferControl(module, route = null) {
    if (!ModuleCatalog.hasFeedBufferSupport(module.id)) return '';

    const bufferKey = `${module.id}BufferEnabled`;
    return `
      <div id="${esc(module.id)}BufferWrap"${hiddenAttr(ModuleCatalog.supportsFeedBuffer(module.id, route))}>
        <label class="toggle-label">
          <input type="checkbox" id="${esc(bufferKey)}"${checkedAttr(this.state[bufferKey])}>
          <span>${esc(ModuleCatalog.getFeedBufferLabel(module.id, route))}</span>
        </label>
      </div>
    `;
  },

  renderModuleCard(module, { cardClass, badgeClass, bodyHtml }) {
    const enabled = this.state[`${module.id}Enabled`];
    return `
      <div class="process-card ${esc(cardClass)}" data-process="${esc(module.id)}">
        <div class="process-header">
          <label class="toggle-label">
            <input type="checkbox" id="${esc(module.id)}Enabled"${checkedAttr(enabled)}>
            <span>${esc(module.label)}</span>
          </label>
          <span class="maturity-badge ${esc(badgeClass)}">${module.exploratory ? 'Exploratory' : 'Supported'}</span>
        </div>
        <div class="process-config disabled-group ${enabled ? 'active' : ''}" id="${esc(module.id)}Config">
          ${bodyHtml}
        </div>
      </div>
    `;
  },

  renderSupportedModule(module) {
    const selectedPreset = this.getSelectedModulePreset(module.id);
    const presetHtml = ModuleCatalog.hasPresets(module)
      ? `
        <label>Preset
          <select id="${esc(module.id)}Preset">
            <option value="custom"${selectedAttr(selectedPreset === 'custom')}>Custom values</option>
            ${ModuleCatalog.getPresets(module).map(preset => `
              <option value="${esc(preset.value)}"${selectedAttr(selectedPreset === preset.value)}>${esc(preset.label)}</option>
            `).join('')}
          </select>
        </label>
      `
      : '';
    const configsHtml = module.configs.map(config => {
      const isLog = config.scale === 'log';
      const stateValue = this.state[config.key];
      const sliderMin = isLog ? Math.log10(config.min) : config.min;
      const sliderMax = isLog ? Math.log10(config.max) : config.max;
      const sliderStep = isLog ? 0.001 : config.step;
      const sliderValue = isLog ? Math.log10(stateValue) : stateValue;
      const dataScaleAttr = isLog ? ' data-scale="log"' : '';
      return `
      <label>${esc(config.label)}
        <input type="range" id="${esc(config.key)}"${dataScaleAttr} min="${esc(sliderMin)}" max="${esc(sliderMax)}" step="${esc(sliderStep)}" value="${esc(sliderValue)}">
        <span class="range-value" id="${esc(config.key)}Value">${esc(formatConfigValue(config.unit, stateValue))}</span>
      </label>
    `;
    }).join('');
    const assetLifeKey = ModuleCatalog.getAssetLifeKey(module);
    const assetLifeHtml = assetLifeKey ? `
      <label>Asset Life (years)
        <input type="range" id="${esc(assetLifeKey)}" min="3" max="20" step="1" value="${esc(this.state[assetLifeKey])}">
        <span class="range-value" id="${esc(assetLifeKey)}Value">${esc(FormatNumbers.fixed(parseInt(this.state[assetLifeKey], 10), 0))} years</span>
      </label>
    ` : '';
    const bufferHtml = this.renderModuleBufferControl(module);

    const allocNoteHtml = (module.id === 'electrolyzer' || module.id === 'dac')
      ? `<div class="info-row"><span>Power share:</span><span id="${esc(module.id)}AllocMode" class="highlight">Auto-balanced</span></div>`
      : '';

    return this.renderModuleCard(module, {
      cardClass: module.kind === 'product' ? 'product-card' : '',
      badgeClass: 'supported',
      bodyHtml: `
          ${presetHtml}
          ${configsHtml}
          ${assetLifeHtml}
          ${bufferHtml}
          ${allocNoteHtml}
        `,
    });
  },

  renderExploratoryModule(module) {
    const route = this.state[`${module.id}Route`];
    const routeOptionsHtml = ModuleCatalog.getRouteOptions(module).map(option =>
      `<option value="${esc(option.value)}"${selectedAttr(route === option.value)}>${esc(option.label)}</option>`
    ).join('');
    const priorityKey = `${module.id}PriorityWeight`;
    const capexKey = `${module.id}CapexBasis`;
    const capexControl = ModuleCatalog.getCapexControlConfig(module.id, route);
    const capexValue = this.state[capexKey];
    // MTG takes no shared H2 / CO2: its throughput (and power) follows the
    // methanol diverted to it, so it has no pool priority.
    const priorityHtml = module.id === 'mtg' ? '' : `
      <label>Shared Pool Priority
        <input type="range" id="${esc(priorityKey)}" min="0" max="100" step="5" value="${esc(this.state[priorityKey])}">
        <span class="range-value" id="${esc(priorityKey)}Value">${esc(formatExploratoryPriorityWeight(this.state[priorityKey]))}</span>
      </label>
    `;
    const capexHtml = `
      <label>
        <span id="${esc(module.id)}CapexBasisLabel">CAPEX (${esc(capexControl.unitLabel)})</span>
        <input type="range" id="${esc(capexKey)}" min="${esc(capexControl.min)}" max="${esc(capexControl.max)}" step="${esc(capexControl.step)}" value="${esc(capexValue)}">
        <span class="range-value" id="${esc(capexKey)}Value">${esc(formatExploratoryCapexBasis(module.id, route, capexValue))}</span>
      </label>
    `;
    const bufferHtml = this.renderModuleBufferControl(module, route);
    const mtgSplitHtml = module.id === 'mtg' ? `
      <div id="mtgMethanolSplitControl">
        <label>Methanol Diverted to MTG
          <input type="range" id="mtgMethanolSplit" min="0" max="100" step="1" value="${esc(this.state.mtgMethanolSplit)}">
          <span class="range-value" id="mtgMethanolSplitValue">${esc(formatMtgMethanolSplit(this.state.mtgMethanolSplit))}</span>
        </label>
      </div>
    ` : '';

    return this.renderModuleCard(module, {
      cardClass: 'exploratory-card',
      badgeClass: 'exploratory',
      bodyHtml: `
          <label>Route Choice
            <select id="${esc(module.id)}Route">${routeOptionsHtml}</select>
          </label>
          ${bufferHtml}
          ${capexHtml}
          ${priorityHtml}
          ${mtgSplitHtml}
          <div class="field-note compact-note">
            ${module.id === 'mtg'
              ? 'MTG throughput, and the power it draws, follow the methanol diverted to it.'
              : 'Each route gets power and H2/CO2 in proportion to its priority (product units) x its per-unit needs.'}
            Active exploratory outputs carry route CAPEX, O&amp;M, and sale-price assumptions into ROI.
          </div>
          <div class="missing-assumptions">
            <div class="module-note-title">Key missing assumptions</div>
            <ul class="missing-list">
              ${ModuleCatalog.getMissingInputs(module).map(item => `<li>${esc(item)}</li>`).join('')}
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

    const capexConfig = ModuleCatalog.getCapexControlConfig(moduleId, this.state[`${moduleId}Route`]);
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
    wrap.hidden = !ModuleCatalog.supportsFeedBuffer(moduleId, route);
  },
};
