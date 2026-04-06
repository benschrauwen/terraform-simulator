(function (root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  root.SavedSitePresets = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const STORAGE_KEY = 'terraformIndustries.savedSitePresets';
  const APP_STATE_KEY_PREFIX = 'terraformIndustries.siteAppState.v1:';
  const MAX_PRESETS = 48;
  const ID_PREFIX = 's:';

  function appStateStorageKey(id) {
    return `${APP_STATE_KEY_PREFIX}${id}`;
  }

  function safeParse(json, fallback) {
    try {
      const value = JSON.parse(json);
      return Array.isArray(value) ? value : fallback;
    } catch {
      return fallback;
    }
  }

  function loadRaw() {
    try {
      if (typeof localStorage === 'undefined' || !localStorage.getItem) return [];
      return safeParse(localStorage.getItem(STORAGE_KEY) || '[]', []);
    } catch {
      return [];
    }
  }

  function saveRaw(list) {
    try {
      if (typeof localStorage === 'undefined' || !localStorage.setItem) return;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch (error) {
      console.warn('SavedSitePresets: could not write localStorage', error);
    }
  }

  function normalizePreset(entry) {
    if (!entry || typeof entry !== 'object') return null;
    const id = typeof entry.id === 'string' && entry.id ? entry.id : null;
    const name = typeof entry.name === 'string' ? entry.name.trim().slice(0, 80) : '';
    if (!id || !name) return null;

    const body = entry.body === 'mars' || entry.body === 'moon' ? entry.body : 'earth';
    const lat = Number(entry.lat);
    const lon = Number(entry.lon);
    const yieldRaw = entry.siteYieldMwhPerMwdcYear ?? entry.baseYield;
    const siteYieldMwhPerMwdcYear = Number(yieldRaw);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(siteYieldMwhPerMwdcYear)) {
      return null;
    }

    let solarProfileModel = entry.solarProfileModel;
    if (typeof solarProfileModel !== 'string') solarProfileModel = undefined;

    const allowedSources = ['preset', 'manual', 'estimated', 'planetary-custom'];
    const siteYieldSource = allowedSources.includes(entry.siteYieldSource)
      ? entry.siteYieldSource
      : 'preset';

    return {
      id,
      name,
      body,
      lat,
      lon,
      siteYieldMwhPerMwdcYear,
      solarProfileModel,
      siteYieldSource,
    };
  }

  function list() {
    return loadRaw().map(normalizePreset).filter(Boolean);
  }

  function getById(id) {
    if (typeof id !== 'string' || !id) return null;
    return list().find(preset => preset.id === id) || null;
  }

  function optionValueForId(id) {
    return `${ID_PREFIX}${id}`;
  }

  function parseOptionValue(value) {
    if (typeof value !== 'string' || !value.startsWith(ID_PREFIX)) return null;
    return value.slice(ID_PREFIX.length) || null;
  }

  function coordsClose(a, b, tol) {
    return Math.abs(a - b) <= tol;
  }

  function matchesState(preset, state) {
    if (!preset || !state) return false;
    const body = state.body || 'earth';
    if (preset.body !== body) return false;
    if (
      !coordsClose(preset.lat, state.latitude, 0.05) ||
      !coordsClose(preset.lon, state.longitude, 0.05)
    ) {
      return false;
    }
    if (
      !coordsClose(
        preset.siteYieldMwhPerMwdcYear,
        state.siteYieldMwhPerMwdcYear,
        0.51
      )
    ) {
      return false;
    }
    const sm = state.solarProfileModel;
    if (preset.solarProfileModel != null && sm != null && preset.solarProfileModel !== sm) {
      return false;
    }
    return true;
  }

  function findIdMatchingState(state) {
    const presets = list();
    const match = presets.find(preset => matchesState(preset, state));
    return match ? match.id : null;
  }

  function addFromState(state, rawName) {
    const trimmed = String(rawName || '').trim().slice(0, 80);
    if (!trimmed) {
      return { ok: false, error: 'empty' };
    }

    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const entry = {
      id,
      name: trimmed,
      body: state.body || 'earth',
      lat: state.latitude,
      lon: state.longitude,
      siteYieldMwhPerMwdcYear: state.siteYieldMwhPerMwdcYear,
      solarProfileModel: state.solarProfileModel,
      siteYieldSource: state.siteYieldSource || 'manual',
    };

    const normalized = normalizePreset(entry);
    if (!normalized) {
      return { ok: false, error: 'invalid' };
    }

    let raw = loadRaw().filter(item => item && item.id !== id);
    raw.unshift(entry);
    raw = raw.slice(0, MAX_PRESETS);
    saveRaw(raw);

    return { ok: true, id, preset: normalized };
  }

  function removeById(id) {
    if (typeof id !== 'string' || !id) return false;
    const raw = loadRaw();
    const next = raw.filter(item => item && item.id !== id);
    if (next.length === raw.length) return false;
    saveRaw(next);
    removeAppStateForSite(id);
    return true;
  }

  function loadAppStateForSite(id) {
    if (typeof id !== 'string' || !id) return null;
    try {
      if (typeof localStorage === 'undefined' || !localStorage.getItem) return null;
      const raw = localStorage.getItem(appStateStorageKey(id));
      if (!raw) return null;
      const value = JSON.parse(raw);
      return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
    } catch {
      return null;
    }
  }

  function saveAppStateForSite(id, snapshot) {
    if (typeof id !== 'string' || !id) return;
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return;
    try {
      if (typeof localStorage === 'undefined' || !localStorage.setItem) return;
      localStorage.setItem(appStateStorageKey(id), JSON.stringify(snapshot));
    } catch (error) {
      console.warn('SavedSitePresets: could not write site app state', error);
    }
  }

  function removeAppStateForSite(id) {
    if (typeof id !== 'string' || !id) return;
    try {
      if (typeof localStorage === 'undefined' || !localStorage.removeItem) return;
      localStorage.removeItem(appStateStorageKey(id));
    } catch (error) {
      console.warn('SavedSitePresets: could not remove site app state', error);
    }
  }

  return {
    STORAGE_KEY,
    APP_STATE_KEY_PREFIX,
    MAX_PRESETS,
    list,
    getById,
    addFromState,
    removeById,
    findIdMatchingState,
    optionValueForId,
    parseOptionValue,
    matchesState,
    loadAppStateForSite,
    saveAppStateForSite,
    removeAppStateForSite,
  };
});
