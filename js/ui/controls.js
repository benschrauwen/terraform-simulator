/* Form-control binding and state -> control sync, driven by control-spec.js */

import { PolicyModel } from '../model/policy.js';
import { CONTROL_SPECS, getModuleControlSpecs } from './control-spec.js';
import { escapeHtml as esc } from './renderers/markup.js';

function readRangeValue(el) {
  const sliderValue = parseFloat(el.value);
  return el.dataset.scale === 'log' ? Math.pow(10, sliderValue) : sliderValue;
}

function writeRangeValue(el, stateValue) {
  const numericState = parseFloat(stateValue);
  el.value = el.dataset.scale === 'log' && Number.isFinite(numericState) && numericState > 0
    ? Math.log10(numericState)
    : stateValue;
}

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

    document.querySelectorAll('.day-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        const day = parseInt(btn.dataset.day, 10);
        this.state.dayOfYear = day;
        this.syncRangeDisplay('dayOfYear', day);
        this.refreshDaySpecificViews();
      });
    });

    this.controlSpecs = [...CONTROL_SPECS, ...getModuleControlSpecs(this.state)];
    this.controlSpecs.forEach(spec => this.bindControlSpec(spec));

    this.bindLocationPresetControl();
    this.bindSolarCostPresetControl();
    this.bindModuleControls();
    this.bindSavedSitePresetControls();
    this.bindOptimizeButtons();
    this.bindMarketLadderTabs();
  },

  bindControlSpec(spec) {
    const el = document.getElementById(spec.id);
    if (!el) return;
    const stateKey = spec.stateKey || spec.id;

    if (spec.type === 'range') {
      const formatter = value => spec.format(value, this);
      this.rangeBindings.set(spec.id, { id: spec.id, stateKey, formatter });
      el.addEventListener('input', () => {
        const actualValue = readRangeValue(el);
        this.state[stateKey] = actualValue;
        this.syncRangeDisplay(spec.id, actualValue, formatter);
        spec.onInput?.(this);
        this.syncDynamicVisibility();
        if (spec.dayViewOnly) {
          this.refreshDaySpecificViews();
        } else {
          this.requestRecalculate({ includeSensitivity: false });
        }
      });
      return;
    }

    el.addEventListener('change', () => {
      let value;
      if (spec.type === 'checkbox') {
        value = el.checked;
        if (spec.toggles) document.getElementById(spec.toggles)?.classList.toggle('active', value);
      } else if (spec.type === 'number') {
        value = parseFloat(el.value);
      } else {
        value = spec.parse ? spec.parse(el.value) : el.value;
      }
      const previous = this.state[stateKey];
      this.state[stateKey] = value;
      spec.onChange?.(this, value, previous);
      this.recalculate();
    });
  },

  /** Bind a control that is not in the spec: run `handler(value, el)`, then recalculate. */
  on(id, event, handler) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener(event, () => {
      handler(el.value, el);
      this.recalculate();
    });
  },

  syncStateToControls() {
    (this.controlSpecs || []).forEach(spec => this.syncControlSpec(spec));
    this.syncLocationControls();
    this.syncSolarCostPresetControl();
    this.syncModuleControls();
    this.renderPolicyInputs();
    this.syncLoadConfigTabs();
  },

  syncControlSpec(spec) {
    const el = document.getElementById(spec.id);
    if (!el) return;
    const stateValue = this.state[spec.stateKey || spec.id];

    if (spec.type === 'range') {
      writeRangeValue(el, stateValue);
      this.syncRangeDisplay(spec.id, stateValue);
    } else if (spec.type === 'checkbox') {
      el.checked = Boolean(stateValue);
      if (spec.toggles) document.getElementById(spec.toggles)?.classList.toggle('active', Boolean(stateValue));
    } else {
      el.value = stateValue;
    }
  },

  syncRangeDisplay(id, value, formatter) {
    const display = document.getElementById(`${id}Value`);
    const format = formatter || this.rangeBindings.get(id)?.formatter;
    if (display && format) display.textContent = format(value);
  },

  /** Policy inputs depend on the selected scheme, so they are rendered and bound together. */
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
        ${esc(input.label)}
        <input
          type="range"
          id="${esc(input.key)}"
          min="${esc(input.min)}"
          max="${esc(input.max)}"
          step="${esc(input.step)}"
          value="${esc(input.value)}"
        >
        <span class="range-value" id="${esc(input.key)}Value">${esc(input.formattedValue)}</span>
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
};
