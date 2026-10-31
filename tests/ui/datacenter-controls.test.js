/* Contracts between the datacenter control registry (js/ui/datacenter/control-spec.js), the page
   shell (datacenter.html) and the datacenter state schema: containers exist, ids are unique,
   every control drives a schema field, slider bounds stay inside the schema range and contain
   the default, select options are valid values, and the rendered markup carries each control. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { GAS_GENSET_TYPES, NUCLEAR_TYPES } from '../../js/data/datacenter/power.js';
import {
  applyDatacenterPresetDefaults,
  DATACENTER_DEFAULT_STATE,
  DATACENTER_STATE_FIELDS,
  normalizeDatacenterState,
} from '../../js/state/datacenter-schema.js';
import { collectVisibilityRules, renderSectionMarkup, selectOptions, toSliderValue } from '../../js/ui/datacenter/control-markup.js';
import { DATACENTER_SECTIONS, getControlRange, getDatacenterControlSpecs, getDatacenterSections } from '../../js/ui/datacenter/control-spec.js';
import { FIRM_BLOCK_RENDERERS } from '../../js/ui/datacenter/firm-info.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const html = fs.readFileSync(path.join(ROOT, 'datacenter.html'), 'utf8');
const staticIds = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
const specs = getDatacenterControlSpecs();
const field = key => DATACENTER_STATE_FIELDS.find(entry => entry.key === key);
const options = key => field(key).options || field(key).getOptions();

// States that exercise every selection-dependent range (each gas and nuclear type; hybrid
// allows them all, grid only standby generators and an existing-plant contract).
const HYBRID = normalizeDatacenterState({ ...DATACENTER_DEFAULT_STATE, architecture: 'hybrid' });
const VARIANT_STATES = [
  DATACENTER_DEFAULT_STATE,
  ...Object.keys(GAS_GENSET_TYPES).map(gasType => applyDatacenterPresetDefaults({ ...HYBRID, firmFamily: 'gas', gasType }, 'gasType')),
  ...Object.keys(NUCLEAR_TYPES).map(nuclearType => applyDatacenterPresetDefaults({ ...HYBRID, firmFamily: 'nuclear', nuclearType }, 'nuclearType')),
];

test('every control container exists in datacenter.html and no section of the registry is dropped', () => {
  Object.keys(DATACENTER_SECTIONS).forEach(id => assert.ok(staticIds.includes(id), `#${id} missing from datacenter.html`));
  // The schema already has every field the registry names (GPU rental included).
  assert.equal(specs.length, Object.values(DATACENTER_SECTIONS).flatMap(function flat(items) {
    return items.flatMap(item => (item.details ? flat(item.items) : item.block ? [] : [item]));
  }).length);
});

test('control ids are unique, do not collide with the page shell and map to schema fields', () => {
  const ids = specs.flatMap(spec => [spec.id, `${spec.id}Value`]);
  assert.deepEqual(ids.filter((id, index) => ids.indexOf(id) !== index), []);
  assert.deepEqual(ids.filter(id => staticIds.includes(id)), [], 'control ids collide with datacenter.html ids');
  specs.forEach(spec => {
    const key = spec.stateKey || spec.id;
    assert.ok(Object.hasOwn(DATACENTER_DEFAULT_STATE, key), `#${spec.id}: ${key} is not a datacenter state field`);
    assert.ok(['range', 'select', 'checkbox', 'number'].includes(spec.type), `#${spec.id} type`);
    if (spec.type === 'range') assert.equal(typeof spec.format, 'function', `#${spec.id} needs a formatter`);
    if (spec.type === 'checkbox') assert.equal(field(key).type, 'boolean', `#${spec.id} drives a boolean`);
  });
});

test('slider and number bounds stay inside the schema range and contain the current value', () => {
  VARIANT_STATES.forEach(state => {
    specs.filter(spec => spec.type === 'range' || spec.type === 'number').forEach(spec => {
      const key = spec.stateKey || spec.id;
      const { min, max, step } = getControlRange(spec, state);
      const schema = field(key);
      assert.ok(Number.isFinite(min) && Number.isFinite(max) && step > 0, `#${spec.id} bounds`);
      assert.ok(min < max, `#${spec.id} min < max`);
      assert.ok(min >= schema.min && max <= schema.max, `#${spec.id} ${min}..${max} outside schema ${schema.min}..${schema.max}`);
      const hidden = spec.visible && !spec.visible(state);
      if (!hidden) assert.ok(state[key] >= min - 1e-9 && state[key] <= max + 1e-9, `#${spec.id}: ${state[key]} outside ${min}..${max} (${state.gasType}/${state.nuclearType})`);
    });
  });
});

test('select options are valid schema values and include the default', () => {
  specs.filter(spec => spec.type === 'select').forEach(spec => {
    const key = spec.stateKey || spec.id;
    const values = spec.options(DATACENTER_DEFAULT_STATE).map(option => String(option.value));
    assert.equal(new Set(values).size, values.length, `#${spec.id} duplicate options`);
    assert.ok(values.includes(String(DATACENTER_DEFAULT_STATE[key])), `#${spec.id} lacks the default ${DATACENTER_DEFAULT_STATE[key]}`);
    if (field(key).type === 'enum') {
      // Every enum value is offered in hybrid, which allows them all (grid offers a subset: below).
      const hybridValues = spec.options(HYBRID).map(option => String(option.value));
      assert.ok(values.every(value => hybridValues.includes(value)), `#${spec.id} default options within hybrid's`);
      assert.deepEqual([...hybridValues].sort(), [...options(key)].map(String).sort(), `#${spec.id} options vs schema enum`);
    } else {
      // Numeric selects (uptime target, tornado swing): every option normalizes to itself.
      values.forEach(value => assert.equal(normalizeDatacenterState({ [key]: Number(value) })[key], Number(value), `#${spec.id} option ${value}`));
    }
  });
  // A value outside the presets (e.g. from a share link) is added rather than lost.
  const uptime = specs.find(spec => spec.id === 'uptimeTargetPercent');
  assert.ok(selectOptions(uptime, { ...DATACENTER_DEFAULT_STATE, uptimeTargetPercent: 99.95 }).some(option => option.value === '99.95'));
});

test('rendered markup carries every control once with its default value', () => {
  const markup = Object.values(getDatacenterSections()).map(items => renderSectionMarkup(items, DATACENTER_DEFAULT_STATE)).join('');
  assert.doesNotMatch(markup, /\sstyle=/);
  specs.forEach(spec => {
    const tags = markup.match(new RegExp(`<(input|select)\\b[^>]*\\bid="${spec.id}"[^>]*>`, 'g')) || [];
    assert.equal(tags.length, 1, `#${spec.id} rendered once`);
    if (spec.type === 'range') {
      const value = Number(tags[0].match(/\bvalue="([^"]*)"/)[1]);
      assert.ok(Math.abs(value - toSliderValue(spec, DATACENTER_DEFAULT_STATE[spec.stateKey || spec.id])) < 1e-9, `#${spec.id} value`);
      assert.match(markup, new RegExp(`id="${spec.id}Value">[^<]+<`), `#${spec.id} read-out`);
    }
  });
  // Visibility rules resolve to rendered elements.
  const rules = Object.values(getDatacenterSections()).flatMap(collectVisibilityRules);
  assert.ok(rules.length > 10);
  rules.forEach(([selector]) => {
    const match = selector.match(/(?:#dcBlock-|data-details="|data-control-wrap=")([^"\]]+)/);
    assert.ok(match && markup.includes(match[1]), `${selector} has a rendered element`);
  });
});

test('grid-connected: no solar controls, firm service and standby generators only, a switch to hybrid', () => {
  const spec = id => specs.find(entry => entry.id === id);
  const values = (id, state) => spec(id).options(state).map(option => option.value);
  const grid = DATACENTER_DEFAULT_STATE;
  assert.equal(grid.architecture, 'grid');
  assert.deepEqual(values('gridConnection', grid), ['firm']);
  assert.deepEqual(values('gasType', grid), ['standby-diesel']);
  assert.deepEqual(values('nuclearType', grid), ['contracted-existing']);
  assert.deepEqual(values('gridConnection', HYBRID), ['firm', 'flexible']);
  assert.ok(values('gasType', HYBRID).includes('recip'));
  // Solar: every control and block hidden, the note with its switch button shown instead (and the
  // reverse in hybrid).
  const solarRules = collectVisibilityRules(getDatacenterSections().solarControls);
  const noteRule = solarRules.find(([selector]) => selector === '#dcBlock-solarArchitectureNote');
  assert.ok(noteRule && noteRule[1](grid) && !noteRule[1](HYBRID));
  solarRules.filter(rule => rule !== noteRule).forEach(([selector, visible]) => {
    assert.equal(visible(grid), false, `${selector} hidden on grid`);
    assert.equal(visible(HYBRID), true, `${selector} shown in hybrid`);
  });
  assert.ok(getDatacenterControlSpecs().filter(entry => ['solarSizeMWdc', 'mountingType'].includes(entry.id)).every(entry => !entry.visible(grid)));
  const note = FIRM_BLOCK_RENDERERS.solarArchitectureNote(grid);
  assert.match(note, /<button type="button" class="dc-switch-arch" data-switch-architecture="hybrid">Switch to Hybrid to add on-site generation<\/button>/);
  assert.match(FIRM_BLOCK_RENDERERS.firmArchitectureNote(grid), /data-switch-architecture="hybrid"/);
});
