import assert from 'node:assert/strict';
import test from 'node:test';

import { siteMapMethods } from '../../js/ui/site-map.js';

function createElement(id) {
  return {
    id,
    hidden: false,
    textContent: '',
    innerHTML: '',
  };
}

function createLeafletStub() {
  const calls = {};
  const addTo = function addTo(target) {
    this.addedTo = target;
    return this;
  };

  return {
    calls,
    L: {
      map(element, options) {
        const map = {
          element,
          options,
          handlers: {},
          setView(center, zoom, viewOptions) {
            this.center = center;
            this.zoom = zoom;
            this.viewOptions = viewOptions;
            return this;
          },
          on(event, handler) {
            this.handlers[event] = handler;
            return this;
          },
          invalidateSize() {
            this.invalidated = true;
          },
          fitBounds(bounds, fitOptions) {
            this.fit = { bounds, options: fitOptions };
          },
        };
        calls.map = map;
        return map;
      },
      control: {
        zoom(options) {
          const control = { options, addTo };
          calls.zoom = control;
          return control;
        },
      },
      tileLayer(url, options) {
        const layer = {
          url,
          options,
          handlers: {},
          on(event, handler) {
            this.handlers[event] = handler;
            return this;
          },
          addTo,
        };
        calls.tileLayer = layer;
        return layer;
      },
      divIcon(options) {
        calls.icon = options;
        return options;
      },
      marker(position, options) {
        const marker = {
          position,
          options,
          handlers: {},
          on(event, handler) {
            this.handlers[event] = handler;
            return this;
          },
          addTo,
          setLatLng(nextPosition) {
            this.position = nextPosition;
          },
          bringToFront() {
            this.front = true;
          },
        };
        calls.marker = marker;
        return marker;
      },
      rectangle(bounds, options) {
        const rectangle = {
          bounds,
          options,
          addTo,
          setBounds(nextBounds) {
            this.bounds = nextBounds;
          },
          bringToBack() {
            this.back = true;
          },
        };
        calls.rectangle = rectangle;
        return rectangle;
      },
      layerGroup() {
        const layer = {
          addTo,
          clearLayers() {
            this.cleared = true;
          },
        };
        calls.layerGroup = layer;
        return layer;
      },
    },
  };
}

function loadSiteMapMethods({ L } = {}) {
  const elements = new Map();
  globalThis.window = {
    requestAnimationFrame(callback) {
      callback();
    },
  };
  globalThis.document = {
    getElementById(id) {
      return elements.get(id) || null;
    },
  };

  if (L) globalThis.L = L;
  else delete globalThis.L;

  return {
    methods: siteMapMethods,
    registerElement(id, initial = {}) {
      const element = Object.assign(createElement(id), initial);
      elements.set(id, element);
      return element;
    },
  };
}

test.afterEach(() => {
  delete globalThis.L;
  delete globalThis.document;
  delete globalThis.window;
});

function createApp(methods, overrides = {}) {
  return Object.assign(Object.create(methods), {
    state: {
      latitude: 37.7749,
      longitude: -122.4194,
    },
    siteMap: null,
    siteMapMarker: null,
    siteMapModuleLayer: null,
    siteMapOverlay: null,
    siteMapTileLayer: null,
    ...overrides,
  });
}

function registerMapElements(harness) {
  return {
    map: harness.registerElement('siteMap'),
    empty: harness.registerElement('siteMapEmpty', { hidden: true }),
    note: harness.registerElement('siteMapNote'),
    area: harness.registerElement('siteMapArea'),
    square: harness.registerElement('siteMapSquare'),
    footprints: harness.registerElement('siteMapFootprints'),
  };
}

function createMapResult(overrides = {}) {
  return {
    solar: {
      bodyKey: 'earth',
      landAreaM2: 4046.8564224,
      ...overrides.solar,
    },
    ai: { enabled: false, designLoadKW: 0 },
    electrolyzer: { enabled: false, allocKW: 0 },
    dac: { enabled: false, co2AnnualTons: 0 },
    storage: { enabled: false, battCapKWh: 0 },
    sabatier: { enabled: false, designHourlyRate: 0 },
    methanol: { enabled: false, designHourlyOutputKg: 0 },
  };
}

test('site map shows a visible fallback when Leaflet is unavailable', () => {
  const harness = loadSiteMapMethods();
  const elements = registerMapElements(harness);
  const app = createApp(harness.methods);

  harness.methods.initSiteMap.call(app);

  assert.equal(app.siteMap, null);
  assert.equal(elements.map.hidden, true);
  assert.equal(elements.empty.hidden, false);
  assert.equal(elements.empty.textContent, 'Satellite map failed to load.');
  assert.equal(
    elements.note.textContent,
    'Satellite imagery is temporarily unavailable, but the footprint metrics still update from the model.'
  );
});

test('site map tile failures switch to the map fallback state', () => {
  const leaflet = createLeafletStub();
  const harness = loadSiteMapMethods({ L: leaflet.L });
  const elements = registerMapElements(harness);
  const app = createApp(harness.methods);

  harness.methods.initSiteMap.call(app);
  assert.equal(typeof leaflet.calls.tileLayer.handlers.tileerror, 'function');

  leaflet.calls.tileLayer.handlers.tileerror();

  assert.equal(elements.map.hidden, true);
  assert.equal(elements.empty.hidden, false);
  assert.equal(elements.empty.textContent, 'Satellite tiles failed to load.');
  assert.equal(
    elements.note.textContent,
    'Satellite tile imagery is temporarily unavailable, but the footprint metrics still update from the model.'
  );
});

test('site map updates metrics and hides the map for non-earth scenarios', () => {
  const leaflet = createLeafletStub();
  const harness = loadSiteMapMethods({ L: leaflet.L });
  const elements = registerMapElements(harness);
  const app = createApp(harness.methods);

  harness.methods.updateSiteMap.call(app, createMapResult({ solar: { bodyKey: 'mars' } }));

  assert.equal(elements.map.hidden, true);
  assert.equal(elements.empty.hidden, false);
  assert.equal(elements.empty.textContent, 'Satellite imagery is only available for Earth locations in this pane.');
  assert.equal(elements.area.textContent, 'Area 1.0 acres');
  assert.equal(elements.square.textContent, 'Side 64 m');
  assert.equal(app.siteMap, null);
});

test('map-originated coordinate edits clamp latitude and wrap longitude', () => {
  const harness = loadSiteMapMethods();
  let edited = false;
  let synced = false;
  let recalculated = false;
  const app = createApp(harness.methods, {
    handleLocationEdited() {
      edited = true;
    },
    syncStateToControls() {
      synced = true;
    },
    recalculate() {
      recalculated = true;
    },
  });

  harness.methods.applySiteLocationFromMap.call(app, 120, 541);

  assert.equal(app.state.latitude, 90);
  assert.equal(app.state.longitude, -179);
  assert.equal(edited, true);
  assert.equal(synced, true);
  assert.equal(recalculated, true);
});
