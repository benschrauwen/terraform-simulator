/* Cross-file contracts between index.html, the control registry, the state schema and reference data */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { CLOUDINESS_BY_REGION } from '../../js/data/assumptions.js';
import { POLICY_SCHEMES } from '../../js/data/policies.js';
import { LOCATION_PRESETS } from '../../js/data/reference-data.js';
import { CORE_STATE_FIELDS, DEFAULT_STATE } from '../../js/state/schema.js';
import { CONTROL_SPECS, getModuleControlSpecs } from '../../js/ui/control-spec.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

function attr(tag, name) {
  const match = tag.match(new RegExp(`\\s${name}=(["'])(.*?)\\1`, 'i'));
  return match ? match[2] : undefined;
}

const staticIds = [...html.matchAll(/\sid=(["'])(.*?)\1/g)].map(match => match[2]);

test('every index.html range/number input stays within its state schema bounds', () => {
  const inputs = (html.match(/<input\b[^>]*>/gi) || [])
    .filter(tag => ['range', 'number'].includes(attr(tag, 'type')));
  assert.ok(inputs.length > 20, 'Expected the static numeric controls to be found.');

  inputs.forEach(tag => {
    const id = attr(tag, 'id');
    const spec = CONTROL_SPECS.find(candidate => candidate.id === id);
    assert.ok(spec, `#${id} has no entry in CONTROL_SPECS.`);
    const stateKey = spec.stateKey || spec.id;
    const field = CORE_STATE_FIELDS.find(candidate => candidate.key === stateKey);
    assert.ok(field, `#${id} maps to ${stateKey}, which has no state schema field.`);

    const min = Number(attr(tag, 'min'));
    const max = Number(attr(tag, 'max'));
    assert.ok(Number.isFinite(min) && Number.isFinite(max), `#${id} needs numeric min and max.`);
    assert.ok(min <= max, `#${id} min ${min} > max ${max}.`);
    assert.ok(min >= field.min, `#${id} min ${min} is below the ${stateKey} schema min ${field.min}.`);
    assert.ok(max <= field.max, `#${id} max ${max} is above the ${stateKey} schema max ${field.max}.`);

    const value = attr(tag, 'value');
    if (value !== undefined) {
      assert.ok(Number(value) >= min && Number(value) <= max, `#${id} value ${value} is outside ${min}..${max}.`);
    }
  });
});

test('every Earth location preset region has a cloudiness entry', () => {
  const earthPresets = LOCATION_PRESETS.filter(preset => (preset.body || 'earth') === 'earth');
  assert.ok(earthPresets.length > 0);
  earthPresets.forEach(preset => {
    assert.ok(
      Object.hasOwn(CLOUDINESS_BY_REGION, preset.region),
      `${preset.name} has region "${preset.region}", which is not in CLOUDINESS_BY_REGION.`
    );
  });
});

test('policy input DOM ids do not collide with static or module-generated element ids', () => {
  // controls.js renders each policy input as #<key> with a #<key>Value read-out.
  const policyIds = new Set();
  Object.values(POLICY_SCHEMES).forEach(policy => {
    (policy.inputs || []).forEach(input => {
      policyIds.add(input.key);
      policyIds.add(`${input.key}Value`);
    });
  });
  assert.ok(policyIds.size > 0);

  const moduleIds = getModuleControlSpecs(DEFAULT_STATE).flatMap(spec => [spec.id, `${spec.id}Value`]);
  const otherIds = new Set([...staticIds, ...moduleIds]);
  const collisions = [...policyIds].filter(id => otherIds.has(id));
  assert.deepEqual(collisions, [], `Policy input ids collide with existing ids: ${collisions.join(', ')}`);
});

test('static index.html ids are unique', () => {
  const duplicates = staticIds.filter((id, index) => staticIds.indexOf(id) !== index);
  assert.deepEqual(duplicates, []);
});
