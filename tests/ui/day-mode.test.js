const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');
const APP_UI_STATE_SOURCE = fs.readFileSync(path.join(ROOT, 'js', 'app-ui-state.js'), 'utf8');

function createClassList() {
  const values = new Set();
  return {
    toggle(value, force) {
      const shouldAdd = force === undefined ? !values.has(value) : Boolean(force);
      if (shouldAdd) values.add(value);
      else values.delete(value);
      return shouldAdd;
    },
    contains(value) {
      return values.has(value);
    },
  };
}

function createElement({ dataset = {} } = {}) {
  return {
    dataset,
    classList: createClassList(),
    disabled: false,
    hidden: false,
    attributes: {},
    textContent: '',
    innerHTML: '',
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
  };
}

function loadUiStateMethods({ body, dayMode }) {
  const averageTab = createElement({ dataset: { mode: 'average' } });
  const specificTab = createElement({ dataset: { mode: 'specific' } });
  const elements = {
    daySpecificControls: createElement(),
    dayModeNote: createElement(),
    irradianceLabel: createElement(),
    sunHoursLabel: createElement(),
    dailyOpHoursLabel: createElement(),
    siteYieldNote: createElement(),
    powerChartNote: createElement(),
  };
  const context = {
    window: {},
    document: {
      querySelector(selector) {
        if (selector === '.day-tab[data-mode="average"]') return averageTab;
        if (selector === '.day-tab[data-mode="specific"]') return specificTab;
        return null;
      },
      querySelectorAll(selector) {
        return selector === '.day-tab' ? [averageTab, specificTab] : [];
      },
      getElementById(id) {
        return elements[id] || null;
      },
    },
  };

  vm.createContext(context);
  vm.runInContext(APP_UI_STATE_SOURCE, context, { filename: 'js/app-ui-state.js' });

  return {
    app: {
      state: { dayMode },
      getBodyConfig() {
        return body;
      },
    },
    averageTab,
    elements,
    methods: context.window.AppUiStateMethods,
    specificTab,
  };
}

test('day mode controls expose pressed state and show specific-day controls when active', () => {
  const { app, averageTab, elements, methods, specificTab } = loadUiStateMethods({
    body: {
      label: 'Earth',
      supportsSpecificDay: true,
      chartNote: '',
    },
    dayMode: 'specific',
  });

  methods.syncPlanetaryUI.call(app);

  assert.equal(averageTab.attributes['aria-pressed'], 'false');
  assert.equal(averageTab.attributes['aria-disabled'], 'false');
  assert.equal(specificTab.attributes['aria-pressed'], 'true');
  assert.equal(specificTab.attributes['aria-disabled'], 'false');
  assert.equal(specificTab.disabled, false);
  assert.equal(elements.daySpecificControls.hidden, false);
  assert.equal(elements.daySpecificControls.attributes['aria-hidden'], 'false');
});

test('day mode falls back to annual average and disables specific day for non-Earth bodies', () => {
  const { app, averageTab, elements, methods, specificTab } = loadUiStateMethods({
    body: {
      label: 'Mars',
      supportsSpecificDay: false,
      siteYieldNote: 'Mars yield note',
      chartNote: 'Mars chart note',
    },
    dayMode: 'specific',
  });

  methods.syncPlanetaryUI.call(app);

  assert.equal(app.state.dayMode, 'average');
  assert.equal(averageTab.attributes['aria-pressed'], 'true');
  assert.equal(specificTab.attributes['aria-pressed'], 'false');
  assert.equal(specificTab.disabled, true);
  assert.equal(specificTab.classList.contains('disabled'), true);
  assert.equal(specificTab.attributes['aria-disabled'], 'true');
  assert.equal(elements.daySpecificControls.hidden, true);
  assert.equal(elements.daySpecificControls.attributes['aria-hidden'], 'true');
  assert.match(elements.dayModeNote.textContent, /Mars uses an average local solar cycle/);
});
