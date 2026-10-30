/* Datacenter left panel: renders the declarative controls into their section containers, binds
   them with the shared control-binding mixin, syncs state -> controls (incl. bounds that follow a
   selection), section and control visibility, the architecture cards and the info blocks. */

import { MOUNTING_TYPES } from '../../data/reference-data.js';
import { ARCHITECTURES, GAS_GENSET_TYPES } from '../../data/datacenter/power.js';
import { buildStartingDesign } from '../../model/datacenter/index.js';
import { applyDatacenterPresetDefaults } from '../../state/datacenter-schema.js';
import { collectVisibilityRules, renderSectionMarkup, selectOptions, sliderBounds } from './control-markup.js';
import { getDatacenterSections, withPresetHandlers } from './control-spec.js';
import { FIRM_BLOCK_RENDERERS, renderArchitectureCards } from './firm-info.js';
import { fixed, formatMW, formatStorageMWh } from './format.js';
import { INFO_BLOCK_RENDERERS } from './info-panels.js';

const BLOCK_RENDERERS = { ...INFO_BLOCK_RENDERERS, ...FIRM_BLOCK_RENDERERS };

const lowerFirst = text => (text ? text[0].toLowerCase() + text.slice(1) : '');

/**
 * The note shown after an architecture switch, from the starting design's result:
 * "Applied a starting design for <architecture>: <supply>; adjust the sizes or use Optimize design."
 */
export function describeStartingDesign(r, addedUnits = 0) {
  const s = r.state;
  const parts = [];
  if (r.grid.connected) {
    parts.push(r.grid.connection === 'flexible'
      ? `flexible grid connection (${formatMW(r.grid.importCapMW)}, curtailable ${fixed(r.grid.curtailmentHours ?? r.grid.unavailableHours, 0)} h/yr)`
      : `firm grid connection (${formatMW(r.grid.importCapMW)})`);
  } else {
    parts.push('no grid connection');
  }
  if (s.solarSizeMWdc > 0) parts.push(`${formatMW(s.solarSizeMWdc)}dc ${(MOUNTING_TYPES[s.mountingType]?.label || '').toLowerCase()} solar`);
  if (s.batteryCapacityMWh > 0) parts.push(`${formatStorageMWh(s.batteryCapacityMWh)} / ${formatMW(r.dispatch.battery.powerMW)} battery`);
  if (r.firm.family === 'gas' && r.firm.units > 0) {
    let redundancy = s.firmSizingMode === 'auto' ? `N+${fixed(s.firmSpareUnits, 0)}` : '';
    if (s.firmSizingMode === 'auto' && s.architecture === 'grid') redundancy += ' standby';
    if (addedUnits > 0) redundancy = [redundancy, `${fixed(addedUnits, 0)} added to meet the uptime target`].filter(Boolean).join(', ');
    parts.push(`${fixed(r.firm.units, 0)} × ${formatMW(r.firm.unitSizeMW)} ${lowerFirst(GAS_GENSET_TYPES[s.gasType]?.label || 'gas units')}${redundancy ? ` (${redundancy})` : ''}`);
  }
  if (!(s.solarSizeMWdc > 0) && !(s.batteryCapacityMWh > 0)) parts.push('no solar or battery');
  const label = ARCHITECTURES[s.architecture]?.label || s.architecture;
  return `Applied a starting design for ${label}: ${parts.join(', ')}; adjust the sizes or use Optimize design.`;
}

// Whole sections that only apply to some designs.
const SECTION_VISIBILITY = {
  grid: state => state.architecture !== 'islanded',
};

export const datacenterControlMethods = {
  renderDatacenterControls() {
    const sections = getDatacenterSections();
    this.visibilityRules = [];
    this.controlSpecs = [];
    Object.entries(sections).forEach(([containerId, items]) => {
      const container = document.getElementById(containerId);
      if (!container) return;
      container.innerHTML = renderSectionMarkup(items, this.state);
      collectVisibilityRules(items).forEach(([selector, visible]) => {
        container.querySelectorAll(selector).forEach(element => this.visibilityRules.push({ element, visible }));
      });
    });
    this.controlSpecs = withPresetHandlers(Object.values(sections).flatMap(function flatten(items) {
      return items.flatMap(item => (item.details ? flatten(item.items) : item.block ? [] : [item]));
    }));
    const cards = document.getElementById('dcBlock-architectureCards');
    if (cards) cards.innerHTML = renderArchitectureCards(this.state.architecture);
  },

  bindDatacenterControls() {
    this.controlSpecs.forEach(spec => this.bindControlSpec(spec));
    document.querySelectorAll('input[name="architecture"]').forEach(radio => {
      radio.addEventListener('change', () => {
        if (!radio.checked) return;
        this.applyArchitecture(radio.value);
      });
    });
  },

  /** Switch architecture: apply its starting design (buildStartingDesign), recalculate, say what changed. */
  applyArchitecture(architecture) {
    let design;
    try {
      design = buildStartingDesign(this.state, architecture);
    } catch (error) {
      this.showCalculationError?.(error);
      return;
    }
    this.state = { ...design.state };
    this.syncStateToControls();
    this.recalculate();
    this.showArchitectureNote(describeStartingDesign(this.lastResults || design.result, design.addedUnits));
  },

  showArchitectureNote(text) {
    const body = document.getElementById('architectureControls');
    if (!body) return;
    let note = document.getElementById('architectureDesignNote');
    if (!note) {
      note = document.createElement('div');
      note.id = 'architectureDesignNote';
      note.className = 'dc-arch-applied';
      note.setAttribute('role', 'status');
      const message = document.createElement('p');
      message.className = 'dc-arch-applied-text';
      const dismiss = document.createElement('button');
      dismiss.type = 'button';
      dismiss.className = 'dc-arch-applied-dismiss';
      dismiss.setAttribute('aria-label', 'Dismiss');
      dismiss.textContent = '×';
      dismiss.addEventListener('click', () => { note.hidden = true; });
      note.append(message, dismiss);
      body.appendChild(note);
    }
    note.querySelector('.dc-arch-applied-text').textContent = text;
    note.hidden = false;
  },

  /** A selection that drives preset defaults changed: reset its dependents, then re-sync. */
  applyPresetSelection(selectionKey) {
    this.state = applyDatacenterPresetDefaults(this.state, selectionKey);
    this.syncStateToControls();
  },

  syncStateToControls() {
    (this.controlSpecs || []).forEach(spec => {
      const el = document.getElementById(spec.id);
      if (!el) return;
      if (spec.type === 'range' && spec.range) {
        const { min, max, step } = sliderBounds(spec, this.state);
        el.min = String(min);
        el.max = String(max);
        el.step = String(step);
      }
      if (spec.type === 'select' && spec.options) {
        const wanted = selectOptions(spec, this.state);
        const current = Array.from(el.options).map(option => `${option.value}|${option.textContent}`).join('\n');
        if (current !== wanted.map(option => `${option.value}|${option.label}`).join('\n')) {
          el.replaceChildren(...wanted.map(option => new Option(option.label, String(option.value))));
        }
      }
      this.syncControlSpec(spec);
    });
    this.syncArchitectureCards();
    this.syncDynamicVisibility();
  },

  syncArchitectureCards() {
    document.querySelectorAll('.dc-arch-card').forEach(card => {
      const selected = card.dataset.architecture === this.state.architecture;
      card.classList.toggle('selected', selected);
      const radio = card.querySelector('input[type="radio"]');
      if (radio) radio.checked = selected;
    });
    document.querySelectorAll('[data-architecture-examples]').forEach(details => {
      details.hidden = details.dataset.architectureExamples !== this.state.architecture;
    });
  },

  syncDynamicVisibility() {
    (this.visibilityRules || []).forEach(({ element, visible }) => {
      element.hidden = !visible(this.state);
    });
    Object.entries(SECTION_VISIBILITY).forEach(([section, visible]) => {
      const element = document.querySelector(`.config-section[data-section="${section}"]`);
      if (element) element.hidden = !visible(this.state);
    });
    window.requestAnimationFrame?.(() => this.positionSliderMarkers?.());
  },

  /** Refill the info blocks from the latest result (they show live numbers). */
  updateInfoBlocks(r) {
    document.querySelectorAll('.dc-block[data-block]').forEach(block => {
      const render = BLOCK_RENDERERS[block.dataset.block];
      if (!render) return;
      // Only rewrite changed blocks, so an open <details> inside one stays open.
      this.renderedBlocks ||= new Map();
      const html = render(this.state, r);
      if (this.renderedBlocks.get(block.dataset.block) !== html) {
        block.innerHTML = html;
        this.renderedBlocks.set(block.dataset.block, html);
      }
    });
  },
};
