/* <select> option lists generated from reference data, so labels cannot drift from the model */

import {
  AI_RELIABILITY_OPTIONS,
  METHANE_MARKET_PRESETS,
  MOUNTING_TYPES,
} from '../data/reference-data.js';
import { PolicyModel } from '../model/policy.js';
import { escapeAttribute, escapeHtml } from './renderers/markup.js';

function optionHtml({ value, label }) {
  return `<option value="${escapeAttribute(value)}">${escapeHtml(label)}</option>`;
}

function optgroupHtml(label, optionsHtml) {
  return `<optgroup label="${escapeAttribute(label)}">${optionsHtml}</optgroup>`;
}

/** Render options in order, wrapping consecutive options that share a `group` in one <optgroup>. */
function groupedOptionsHtml(options) {
  const runs = [];
  options.forEach(option => {
    const last = runs[runs.length - 1];
    if (last && last.group === option.group) last.options.push(option);
    else runs.push({ group: option.group, options: [option] });
  });
  return runs.map(({ group, options: runOptions }) => {
    const html = runOptions.map(optionHtml).join('');
    return group ? optgroupHtml(group, html) : html;
  }).join('');
}

function setOptions(id, html) {
  const select = document.getElementById(id);
  if (select) select.innerHTML = html;
}

export const selectOptionMethods = {
  populatePresets() {
    this.populateLocationPresetSelect();

    setOptions('mountingType', Object.entries(MOUNTING_TYPES)
      .map(([value, mounting]) => optionHtml({ value, label: mounting.label }))
      .join(''));

    setOptions('aiReliabilityTarget', AI_RELIABILITY_OPTIONS.map(optionHtml).join(''));

    setOptions('policyMode', PolicyModel.getSelectGroups().map(group => {
      if (group.label === 'Baseline' && group.options.length === 1) {
        return optionHtml({ value: group.options[0].id, label: group.options[0].label });
      }
      const optionsHtml = group.options
        .map(option => optionHtml({ value: option.id, label: option.label }))
        .join('');
      return optgroupHtml(group.label, optionsHtml);
    }).join(''));

    setOptions('methaneMarketPreset', groupedOptionsHtml(
      Object.entries(METHANE_MARKET_PRESETS).map(([value, preset]) => ({
        value,
        label: preset.label,
        group: preset.group || null,
      }))
    ));
  },
};
