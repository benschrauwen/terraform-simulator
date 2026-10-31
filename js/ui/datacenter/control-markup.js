/* Markup for the declarative datacenter controls (control-spec.js). Pure: returns HTML strings
   with every text and attribute value escaped, so it renders the same under Node tests. */

import { escapeAttribute as attr, escapeHtml as esc, tooltipLabel } from '../renderers/markup.js';
import { getControlRange } from './control-spec.js';

const slug = text => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Slider position of a state value (log10 on log-scale sliders). */
export function toSliderValue(spec, value) {
  return spec.scale === 'log' ? Math.log10(Math.max(Number(value), 1e-9)) : Number(value);
}

/** Slider bounds in slider units. */
export function sliderBounds(spec, state) {
  const { min, max, step } = getControlRange(spec, state);
  if (spec.scale !== 'log') return { min, max, step };
  return { min: Math.log10(min), max: Math.log10(max), step };
}

/** Options of a select spec, with the current value added when it is not one of them. */
export function selectOptions(spec, state) {
  const options = spec.options(state);
  const current = String(state[spec.stateKey || spec.id]);
  if (current !== 'undefined' && !options.some(option => String(option.value) === current)) {
    return [...options, { value: current, label: `${current} (custom)` }];
  }
  return options;
}

function labelText(spec) {
  return tooltipLabel(spec.label, spec.tooltip || '');
}

function noteMarkup(spec) {
  return spec.note ? `<div class="field-note compact-note">${esc(spec.note)}</div>` : '';
}

function controlMarkup(spec, state) {
  const key = spec.stateKey || spec.id;
  const value = state[key];
  const wrap = inner => `<div class="dc-field" data-control-wrap="${attr(spec.id)}">${inner}${noteMarkup(spec)}</div>`;

  if (spec.type === 'range') {
    const { min, max, step } = sliderBounds(spec, state);
    const logAttr = spec.scale === 'log' ? ' data-scale="log"' : '';
    return wrap(`<label>${labelText(spec)}
        <input type="range" id="${attr(spec.id)}" min="${attr(min)}" max="${attr(max)}" step="${attr(step)}" value="${attr(toSliderValue(spec, value))}"${logAttr}>
        <span class="range-value" id="${attr(spec.id)}Value">${esc(spec.format(value))}</span>
      </label>`);
  }
  if (spec.type === 'select') {
    const options = selectOptions(spec, state).map(option => {
      const selected = String(option.value) === String(value) ? ' selected' : '';
      return `<option value="${attr(option.value)}"${selected}>${esc(option.label)}</option>`;
    }).join('');
    return wrap(`<label>${labelText(spec)}<select id="${attr(spec.id)}">${options}</select></label>`);
  }
  if (spec.type === 'checkbox') {
    return wrap(`<label class="toggle-label"><input type="checkbox" id="${attr(spec.id)}"${value ? ' checked' : ''}> ${labelText(spec)}</label>`);
  }
  if (spec.type === 'number') {
    const { min, max, step } = getControlRange(spec, state);
    return wrap(`<label>${labelText(spec)}
        <input type="number" id="${attr(spec.id)}" min="${attr(min)}" max="${attr(max)}" step="${attr(step)}" value="${attr(value)}">
      </label>`);
  }
  throw new Error(`Unknown control type ${spec.type} on #${spec.id}`);
}

/** HTML for one left-panel container's items (controls, info blocks, details groups). */
export function renderSectionMarkup(items, state) {
  return items.map(item => {
    if (item.block) return `<div class="dc-block" id="dcBlock-${attr(item.block)}" data-block="${attr(item.block)}"></div>`;
    if (item.details) {
      return `<details class="dc-details" data-details="${attr(slug(item.details))}">
          <summary>${esc(item.details)}</summary>
          <div class="dc-details-body">${renderSectionMarkup(item.items, state)}</div>
        </details>`;
    }
    return controlMarkup(item, state);
  }).join('');
}

/** Every visibility rule as [selector, visible(state)] for the rendered markup. */
export function collectVisibilityRules(items) {
  return items.flatMap(item => {
    const own = item.visible
      ? [[item.block ? `#dcBlock-${item.block}` : item.details ? `[data-details="${slug(item.details)}"]` : `[data-control-wrap="${item.id}"]`, item.visible]]
      : [];
    return item.details ? [...own, ...collectVisibilityRules(item.items)] : own;
  });
}
