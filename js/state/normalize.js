/* ============================================
   State normalization
   ============================================
   Turns arbitrary input (UI state, share links, saved presets) into a complete,
   clamped state: migrates legacy fields, applies schema and module-catalog
   field rules, enforces module dependencies and body-specific constraints. */

import { PLANETARY_BODIES } from '../data/reference-data.js';
import { ModuleCatalog } from '../model/module-catalog.js';
import { clampInteger, clampNumber } from '../model/util.js';
import { migrateLegacyState } from './migrations.js';
import {
  CORE_STATE_FIELDS,
  DEFAULT_STATE,
  SOLAR_PROFILE_DEFAULTS_BY_BODY,
  SOLAR_PROFILE_OPTIONS_BY_BODY,
  getStateFieldOptions,
} from './schema.js';

// C0 controls, DEL, zero-width / directional marks, and bidi embedding,
// override and isolate controls (which can visually reorder text).
const UNSAFE_LABEL_CHARS = /[\u0000-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g;

export function hasBatteryStorage(state) {
  const batteryCapacityMWh = Number(state?.batteryCapacityMWh);
  return Number.isFinite(batteryCapacityMWh) && batteryCapacityMWh > 1e-9;
}

export function normalizeCoreStateFields(input = {}, normalized = {}) {
  const enumOrDefault = (value, allowed, fallback) => (allowed.has(value) ? value : fallback);

  CORE_STATE_FIELDS.forEach(field => {
    if (field.type === 'enum') {
      normalized[field.key] = enumOrDefault(
        input[field.key],
        new Set(getStateFieldOptions(field)),
        field.defaultValue
      );
      return;
    }

    if (field.type === 'integer') {
      const max = typeof field.getMax === 'function' ? field.getMax(normalized) : field.max;
      normalized[field.key] = clampInteger(
        input[field.key],
        field.min,
        max,
        field.defaultValue
      );
      return;
    }

    if (field.type === 'number') {
      normalized[field.key] = clampNumber(
        input[field.key],
        field.min,
        field.max,
        field.defaultValue
      );
      return;
    }

    if (field.type === 'boolean') {
      normalized[field.key] = normalized[field.key] === true;
      return;
    }

    if (field.type === 'string') {
      let value = input[field.key];
      if (typeof value !== 'string') {
        const merged = normalized[field.key];
        value = typeof merged === 'string' ? merged : field.defaultValue;
      }
      const maxLen = Number.isFinite(field.maxLength) ? field.maxLength : 200;
      normalized[field.key] = value
        .replace(UNSAFE_LABEL_CHARS, '')
        .trim()
        .slice(0, maxLen);
    }
  });
}

export function normalizeModuleStateFields(input = {}, normalized = {}) {
  ModuleCatalog.getAll().forEach(module => {
    const enabledKey = `${module.id}Enabled`;
    normalized[enabledKey] = normalized[enabledKey] === true;
    normalized[`${module.id}BufferEnabled`] = normalized[`${module.id}BufferEnabled`] === true;

    ModuleCatalog.getConfigFields(module).forEach(config => {
      const fallback = Object.prototype.hasOwnProperty.call(config, 'defaultValue')
        ? config.defaultValue
        : DEFAULT_STATE[config.key];
      normalized[config.key] = clampNumber(
        input[config.key],
        config.min,
        config.max,
        fallback
      );
    });

    const assetLifeKey = ModuleCatalog.getAssetLifeKey(module);
    if (assetLifeKey) {
      normalized[assetLifeKey] = clampInteger(
        input[assetLifeKey],
        1,
        100,
        DEFAULT_STATE[assetLifeKey] ?? ModuleCatalog.getDefaultAssetLife(module)
      );
    }

    if (ModuleCatalog.hasRoutes(module)) {
      const fallbackRoute = ModuleCatalog.getDefaultRoute(module);
      const routeOptions = new Set(ModuleCatalog.getRouteOptions(module).map(option => option.value));
      normalized[`${module.id}Route`] = routeOptions.has(input[`${module.id}Route`])
        ? input[`${module.id}Route`]
        : fallbackRoute;
    }

    if (module.exploratory) {
      normalized[`${module.id}PriorityWeight`] = clampNumber(
        input[`${module.id}PriorityWeight`],
        0,
        100,
        DEFAULT_STATE[`${module.id}PriorityWeight`] ?? module.defaultPriorityWeight ?? 100
      );
      const capexControl = ModuleCatalog.getCapexControlConfig(
        module.id,
        normalized[`${module.id}Route`]
      );
      normalized[`${module.id}CapexBasis`] = clampNumber(
        input[`${module.id}CapexBasis`],
        capexControl.min,
        capexControl.max,
        DEFAULT_STATE[`${module.id}CapexBasis`] ?? capexControl.defaultValue
      );
    }

    const marketConfig = ModuleCatalog.getMarketConfig(module.id, normalized[`${module.id}Route`]);
    if (marketConfig) {
      normalized[`${module.id}Price`] = clampNumber(
        input[`${module.id}Price`],
        marketConfig.min,
        marketConfig.max,
        DEFAULT_STATE[`${module.id}Price`] ?? marketConfig.defaultValue
      );
    }
  });
}

/* Enables every (transitive) dependency of each enabled module. */
export function enforceModuleDependencies(rawState = {}) {
  const nextState = rawState && typeof rawState === 'object'
    ? { ...rawState }
    : {};

  let changed = true;
  while (changed) {
    changed = false;
    for (const module of ModuleCatalog.getAll()) {
      if (!nextState[`${module.id}Enabled`]) continue;

      for (const dependencyId of ModuleCatalog.getDependencies(module.id, nextState)) {
        if (!ModuleCatalog.getById(dependencyId)) continue;
        const dependencyKey = `${dependencyId}Enabled`;
        if (nextState[dependencyKey]) continue;
        nextState[dependencyKey] = true;
        changed = true;
      }
    }
  }

  return nextState;
}

/* `seedAiBatteryMWh(state)` sizes default storage when AI mode starts with
   none; it needs the solar model, so the Calc facade supplies it. */
export function normalizeState(rawState = {}, { seedAiBatteryMWh = () => 0 } = {}) {
  const input = migrateLegacyState(
    rawState && typeof rawState === 'object' ? rawState : {}
  );
  // Only schema keys survive: unknown input keys would otherwise be carried
  // along and persisted (localStorage, share links).
  const normalized = { ...DEFAULT_STATE };
  Object.keys(DEFAULT_STATE).forEach(key => {
    if (Object.hasOwn(input, key)) normalized[key] = input[key];
  });
  normalizeCoreStateFields(input, normalized);

  const solarProfileFallback =
    SOLAR_PROFILE_DEFAULTS_BY_BODY[normalized.body] || DEFAULT_STATE.solarProfileModel;
  const allowedProfiles = new Set(
    SOLAR_PROFILE_OPTIONS_BY_BODY[normalized.body] || [solarProfileFallback]
  );
  normalized.solarProfileModel = allowedProfiles.has(input.solarProfileModel)
    ? input.solarProfileModel
    : solarProfileFallback;

  if (normalized.aiComputeEnabled && normalized.batteryCapacityMWh <= 1e-9) {
    normalized.batteryCapacityMWh = seedAiBatteryMWh(normalized);
  }

  normalizeModuleStateFields(input, normalized);
  Object.assign(normalized, enforceModuleDependencies(normalized));

  const bodyConfig = PLANETARY_BODIES[normalized.body] || PLANETARY_BODIES.earth;
  if (!bodyConfig.supportsSpecificDay) {
    normalized.dayMode = 'average';
  }

  normalized.batteryEnabled = hasBatteryStorage(normalized);

  return normalized;
}

export const normalizeMethods = {
  hasBatteryStorage,
  normalizeCoreStateFields,
  normalizeModuleStateFields,
  enforceModuleDependencies,

  normalizeState(rawState = {}) {
    return normalizeState(rawState, {
      seedAiBatteryMWh: state => this.getAiBatteryHeuristicMWh(state),
    });
  },
};
