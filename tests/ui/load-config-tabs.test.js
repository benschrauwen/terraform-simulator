import assert from 'node:assert/strict';
import test from 'node:test';

import { controlMethods } from '../../js/ui/controls.js';

function createClassList() {
  const values = new Set();
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

function createElement({ dataset = {}, disabled = false } = {}) {
  return {
    dataset,
    disabled,
    hidden: false,
    attributes: {},
    classList: createClassList(),
    listeners: {},
    focused: false,
    addEventListener(type, handler) {
      this.listeners[type] = handler;
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    focus() {
      this.focused = true;
    },
  };
}

function loadControlMethods() {
  const elements = {
    tabs: [
      createElement({ dataset: { loadTab: 'chemicals' } }),
      createElement({ dataset: { loadTab: 'ai' } }),
    ],
    panels: [
      createElement({ dataset: { loadPanel: 'chemicals' } }),
      createElement({ dataset: { loadPanel: 'ai' } }),
    ],
  };
  globalThis.window = {
    requestAnimationFrame(callback) {
      callback();
    },
  };
  globalThis.document = {
    querySelectorAll(selector) {
      if (selector === '.load-config-tab') return elements.tabs;
      if (selector === '.load-config-panel') return elements.panels;
      return [];
    },
  };

  return {
    methods: controlMethods,
    elements,
  };
}

function createApp() {
  return Object.assign(Object.create(controlMethods), {
    state: {
      loadConfigTab: 'chemicals',
    },
    positionSliderMarkersCalled: 0,
    positionSliderMarkers() {
      this.positionSliderMarkersCalled += 1;
    },
  });
}

test.afterEach(() => {
  delete globalThis.document;
  delete globalThis.window;
});

test('load config tab sync exposes one selected tab and one visible panel', () => {
  const { methods, elements } = loadControlMethods();
  const app = createApp();

  methods.syncLoadConfigTabs.call(app);

  assert.equal(elements.tabs[0].attributes['aria-selected'], 'true');
  assert.equal(elements.tabs[0].attributes.tabindex, '0');
  assert.equal(elements.tabs[1].attributes['aria-selected'], 'false');
  assert.equal(elements.tabs[1].attributes.tabindex, '-1');
  assert.equal(elements.panels[0].hidden, false);
  assert.equal(elements.panels[0].attributes['aria-hidden'], 'false');
  assert.equal(elements.panels[1].hidden, true);
  assert.equal(elements.panels[1].attributes['aria-hidden'], 'true');
  assert.equal(app.positionSliderMarkersCalled, 1);
});

test('load config tab keyboard navigation changes state and moves focus', () => {
  const { methods, elements } = loadControlMethods();
  const app = createApp();
  let defaultPrevented = false;

  methods.bindLoadConfigTabs.call(app);
  elements.tabs[0].listeners.keydown({
    key: 'ArrowRight',
    preventDefault() {
      defaultPrevented = true;
    },
  });

  assert.equal(defaultPrevented, true);
  assert.equal(app.state.loadConfigTab, 'ai');
  assert.equal(elements.tabs[1].focused, true);
  assert.equal(elements.tabs[1].attributes['aria-selected'], 'true');
  assert.equal(elements.panels[1].hidden, false);
  assert.equal(elements.panels[0].hidden, true);
});

test('load config tab Home and End keys select first and last tabs', () => {
  const { methods, elements } = loadControlMethods();
  const app = createApp();

  methods.bindLoadConfigTabs.call(app);
  elements.tabs[0].listeners.keydown({ key: 'End', preventDefault() {} });
  assert.equal(app.state.loadConfigTab, 'ai');

  elements.tabs[1].listeners.keydown({ key: 'Home', preventDefault() {} });
  assert.equal(app.state.loadConfigTab, 'chemicals');
});
