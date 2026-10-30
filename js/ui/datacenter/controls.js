/* Datacenter left panel: renders the declarative controls into their section containers, binds
   them with the shared control-binding mixin, syncs state -> controls (incl. bounds that follow a
   selection), section and control visibility, the architecture cards and the info blocks. */

import { applyDatacenterPresetDefaults } from '../../state/datacenter-schema.js';
import { collectVisibilityRules, renderSectionMarkup, selectOptions, sliderBounds } from './control-markup.js';
import { getDatacenterSections, withPresetHandlers } from './control-spec.js';
import { FIRM_BLOCK_RENDERERS, renderArchitectureCards } from './firm-info.js';
import { INFO_BLOCK_RENDERERS } from './info-panels.js';

const BLOCK_RENDERERS = { ...INFO_BLOCK_RENDERERS, ...FIRM_BLOCK_RENDERERS };

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
        this.state.architecture = radio.value;
        this.syncArchitectureCards();
        this.syncDynamicVisibility();
        this.recalculate();
      });
    });
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
