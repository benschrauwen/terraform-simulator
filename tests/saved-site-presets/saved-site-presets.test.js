const assert = require('node:assert/strict');
const test = require('node:test');

const SavedSitePresets = require('../../js/saved-site-presets.js');

function installMockLocalStorage() {
  const store = new Map();
  global.localStorage = {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
  };
  return store;
}

test('addFromState persists and list returns normalized presets', () => {
  installMockLocalStorage();
  const state = {
    body: 'earth',
    latitude: 40,
    longitude: -74,
    siteYieldMwhPerMwdcYear: 1600,
    siteYieldSource: 'manual',
    solarProfileModel: 'earth',
  };

  const add = SavedSitePresets.addFromState(state, '  NYC test  ');
  assert.equal(add.ok, true);
  assert.ok(add.id);
  assert.equal(add.preset.name, 'NYC test');

  const listed = SavedSitePresets.list();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].name, 'NYC test');
  assert.equal(listed[0].lat, 40);
  assert.equal(listed[0].siteYieldMwhPerMwdcYear, 1600);
});

test('findIdMatchingState respects coordinates and yield', () => {
  installMockLocalStorage();
  SavedSitePresets.addFromState(
    {
      body: 'earth',
      latitude: 1,
      longitude: 2,
      siteYieldMwhPerMwdcYear: 1000,
      siteYieldSource: 'manual',
      solarProfileModel: 'earth',
    },
    'A'
  );

  const id = SavedSitePresets.findIdMatchingState({
    body: 'earth',
    latitude: 1,
    longitude: 2,
    siteYieldMwhPerMwdcYear: 1000,
    solarProfileModel: 'earth',
  });
  assert.ok(id);

  const noMatch = SavedSitePresets.findIdMatchingState({
    body: 'earth',
    latitude: 1,
    longitude: 2,
    siteYieldMwhPerMwdcYear: 1200,
    solarProfileModel: 'earth',
  });
  assert.equal(noMatch, null);
});

test('removeById drops preset', () => {
  installMockLocalStorage();
  const { id } = SavedSitePresets.addFromState(
    {
      body: 'earth',
      latitude: 0,
      longitude: 0,
      siteYieldMwhPerMwdcYear: 1500,
      siteYieldSource: 'estimated',
      solarProfileModel: 'earth',
    },
    'X'
  );
  assert.equal(SavedSitePresets.list().length, 1);
  assert.equal(SavedSitePresets.removeById(id), true);
  assert.equal(SavedSitePresets.list().length, 0);
});

test('saveAppStateForSite / loadAppStateForSite / removeAppStateForSite', () => {
  const store = installMockLocalStorage();
  const { id } = SavedSitePresets.addFromState(
    {
      body: 'earth',
      latitude: 10,
      longitude: 20,
      siteYieldMwhPerMwdcYear: 1800,
      siteYieldSource: 'manual',
      solarProfileModel: 'earth',
    },
    'Site'
  );
  const snap = { systemSizeMW: 2.5, policyMode: 'us_45v_h2' };
  SavedSitePresets.saveAppStateForSite(id, snap);
  const key = `${SavedSitePresets.APP_STATE_KEY_PREFIX}${id}`;
  assert.ok(store.has(key));
  assert.deepEqual(SavedSitePresets.loadAppStateForSite(id), snap);
  SavedSitePresets.removeAppStateForSite(id);
  assert.equal(SavedSitePresets.loadAppStateForSite(id), null);
});

test('removeById also removes stored app state', () => {
  const store = installMockLocalStorage();
  const { id } = SavedSitePresets.addFromState(
    {
      body: 'earth',
      latitude: 5,
      longitude: 5,
      siteYieldMwhPerMwdcYear: 1700,
      siteYieldSource: 'manual',
      solarProfileModel: 'earth',
    },
    'Y'
  );
  SavedSitePresets.saveAppStateForSite(id, { methanePrice: 99 });
  const key = `${SavedSitePresets.APP_STATE_KEY_PREFIX}${id}`;
  assert.ok(store.has(key));
  SavedSitePresets.removeById(id);
  assert.equal(store.has(key), false);
});

test('parseOptionValue extracts id', () => {
  assert.equal(SavedSitePresets.parseOptionValue('s:abc'), 'abc');
  assert.equal(SavedSitePresets.parseOptionValue('custom'), null);
});
