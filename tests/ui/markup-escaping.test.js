import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_STATE } from '../../js/state/schema.js';
import { Diagram } from '../../js/ui/diagram.js';
import { moduleControlMethods } from '../../js/ui/module-controls.js';
import { econGroup, econMetric, econRow, escapeHtml, prodItem } from '../../js/ui/renderers/markup.js';
import { selectOptionMethods } from '../../js/ui/select-options.js';

const HOSTILE = '<img src=x onerror="alert(1)">&\'';

test('escapeHtml escapes every HTML-significant character', () => {
  assert.equal(escapeHtml(HOSTILE), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;&#39;');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(12.5), '12.5');
});

test('HTML-string builders escape text and attribute arguments', () => {
  const outputs = [
    econRow(HOSTILE, HOSTILE, HOSTILE, HOSTILE),
    econMetric(HOSTILE, HOSTILE, HOSTILE, HOSTILE, HOSTILE),
    econGroup(HOSTILE, HOSTILE, '', HOSTILE),
    prodItem(HOSTILE, HOSTILE, HOSTILE, HOSTILE),
  ];
  outputs.forEach(html => {
    assert.doesNotMatch(html, /<img/);
    assert.doesNotMatch(html, /"alert/);
  });
});

test('module cards and diagram cards escape data-derived text', () => {
  const app = { state: { ...DEFAULT_STATE, [`${HOSTILE}Route`]: HOSTILE }, ...moduleControlMethods };
  const hostileModule = {
    id: HOSTILE,
    label: HOSTILE,
    exploratory: true,
    routeOptions: [{ value: HOSTILE, label: HOSTILE }],
    missingInputs: [HOSTILE],
    configs: [],
  };
  const outputs = [
    app.renderExploratoryModule(hostileModule),
    app.renderSupportedModule({ ...hostileModule, exploratory: false, configs: [{ key: HOSTILE, label: HOSTILE, min: 1, max: 2, step: 1 }] }),
    Diagram.drawCard({ x: 0, y: 0, w: 10, h: 10, icon: HOSTILE, title: HOSTILE, value: HOSTILE, subtitle: HOSTILE, color: '#ffffff', active: true }),
  ];
  outputs.forEach(html => {
    assert.doesNotMatch(html, /<img/);
    assert.doesNotMatch(html, /"alert/);
  });
});

test('econGroup keeps rowsHtml as trusted markup', () => {
  const html = econGroup('Title', 'Summary', econRow('Row', '$1'));
  assert.match(html, /<div class="econ-group-body"><div class="econ-row ">/);
});

test('select options escape values, labels and optgroup labels', () => {
  const elements = {};
  globalThis.document = { getElementById: id => (elements[id] ??= { innerHTML: '' }) };
  try {
    selectOptionMethods.populatePresets.call({ populateLocationPresetSelect() {}, ...selectOptionMethods });
  } finally {
    delete globalThis.document;
  }
  ['mountingType', 'aiReliabilityTarget', 'policyMode', 'methaneMarketPreset'].forEach(id => {
    const html = elements[id].innerHTML;
    assert.match(html, /<option value="[^"<>]+">[^<>]+<\/option>/, `${id} renders options`);
    // Text between tags never contains a raw quote-free "&" that is not an entity.
    assert.doesNotMatch(html, /&(?![a-z]+;|#\d+;)/, `${id} has an unescaped ampersand`);
  });
});
