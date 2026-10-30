import assert from 'node:assert/strict';
import test from 'node:test';

import { App } from '../../js/ui/app.js';

function createClassList(initial = []) {
  const values = new Set(initial);
  return {
    add(value) {
      values.add(value);
    },
    remove(value) {
      values.delete(value);
    },
    contains(value) {
      return values.has(value);
    },
    toggle(value, force) {
      const shouldAdd = force === undefined ? !values.has(value) : Boolean(force);
      if (shouldAdd) values.add(value);
      else values.delete(value);
      return shouldAdd;
    },
  };
}

function createSection({ key, open = false, bodyId = '' }) {
  const body = {
    id: bodyId,
    hidden: false,
    attributes: {},
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
  };
  const section = {
    dataset: { section: key },
    classList: createClassList(open ? ['open'] : []),
    querySelector(selector) {
      return selector === '.section-body' ? body : null;
    },
  };
  const header = {
    dataset: { toggle: key },
    attributes: {},
    listeners: {},
    closest(selector) {
      return selector === '.config-section, .results-section' ? section : null;
    },
    addEventListener(type, handler) {
      this.listeners[type] = handler;
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
  };

  return { body, header, section };
}

function loadAppClass(sections) {
  globalThis.window = {
    requestAnimationFrame(callback) {
      callback();
    },
    addEventListener() {},
  };
  globalThis.document = {
    addEventListener() {},
    querySelectorAll(selector) {
      if (selector === '.section-header') return sections.map(section => section.header);
      return [];
    },
  };

  return App;
}

test.afterEach(() => {
  delete globalThis.document;
  delete globalThis.window;
});

function createApp() {
  return {
    positionSliderMarkersCalled: 0,
    positionSliderMarkers() {
      this.positionSliderMarkersCalled += 1;
    },
  };
}

test('section toggles initialize button semantics and panel visibility state', () => {
  const openSection = createSection({ key: 'solar', open: true });
  const closedSection = createSection({ key: 'battery', open: false });
  const App = loadAppClass([openSection, closedSection]);
  const app = createApp();

  App.prototype.bindSectionToggles.call(app);

  assert.equal(openSection.header.attributes.role, 'button');
  assert.equal(openSection.header.attributes.tabindex, '0');
  assert.equal(openSection.header.attributes['aria-controls'], 'solarSectionBody');
  assert.equal(openSection.header.attributes['aria-expanded'], 'true');
  assert.equal(openSection.body.id, 'solarSectionBody');
  assert.equal(openSection.body.hidden, false);
  assert.equal(openSection.body.attributes['aria-hidden'], 'false');

  assert.equal(closedSection.header.attributes.role, 'button');
  assert.equal(closedSection.header.attributes['aria-controls'], 'batterySectionBody');
  assert.equal(closedSection.header.attributes['aria-expanded'], 'false');
  assert.equal(closedSection.body.hidden, true);
  assert.equal(closedSection.body.attributes['aria-hidden'], 'true');
});

test('section toggles support click, Enter, and Space activation', () => {
  const section = createSection({ key: 'market', open: false });
  const App = loadAppClass([section]);
  const app = createApp();
  let preventedKeys = [];

  App.prototype.bindSectionToggles.call(app);
  section.header.listeners.click();

  assert.equal(section.header.attributes['aria-expanded'], 'true');
  assert.equal(section.body.hidden, false);
  assert.equal(app.positionSliderMarkersCalled, 1);

  section.header.listeners.keydown({
    key: 'Enter',
    preventDefault() {
      preventedKeys.push('Enter');
    },
  });
  assert.equal(section.header.attributes['aria-expanded'], 'false');
  assert.equal(section.body.hidden, true);

  section.header.listeners.keydown({
    key: ' ',
    preventDefault() {
      preventedKeys.push('Space');
    },
  });
  assert.equal(section.header.attributes['aria-expanded'], 'true');
  assert.equal(section.body.hidden, false);
  assert.deepEqual(preventedKeys, ['Enter', 'Space']);
  assert.equal(app.positionSliderMarkersCalled, 3);
});

test('section toggles preserve existing body ids for aria-controls', () => {
  const section = createSection({ key: 'production', open: true, bodyId: 'customBodyId' });
  const App = loadAppClass([section]);

  App.prototype.bindSectionToggles.call(createApp());

  assert.equal(section.body.id, 'customBodyId');
  assert.equal(section.header.attributes['aria-controls'], 'customBodyId');
});
