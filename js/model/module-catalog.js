/* ============================================
   Module catalog API
   ============================================
   Normalizes the raw definitions in data/modules.js into frozen module objects
   and answers catalog questions (routes, presets, markets, feed buffers, capex
   slider ranges). `catalogMethods` exposes the Calc-facing wrappers. */

import { MODULE_DEFINITIONS, MODULE_FAMILY_LABELS } from '../data/modules.js';

const DEFAULT_FEED_BUFFER_LABEL = 'Feed buffer (cycle-average sizing)';

function normalizeRouteDefinition(routeId, definition = {}) {
  return Object.freeze({
    ...definition,
    id: routeId,
    feedstocks: Object.freeze({ ...(definition.feedstocks || {}) }),
    diagramInputs: Object.freeze({ ...(definition.diagramInputs || {}) }),
    market: definition.market ? Object.freeze({ ...definition.market }) : null,
  });
}

function normalizePresetDefinition(definition = {}) {
  return Object.freeze({
    ...definition,
    values: Object.freeze({ ...(definition.values || {}) }),
  });
}

function normalizeModuleDefinition(definition = {}) {
  const routeEntries = Object.entries(definition.routes || {});
  const routes = Object.freeze(
    Object.fromEntries(routeEntries.map(([routeId, routeDefinition]) => [
      routeId,
      normalizeRouteDefinition(routeId, routeDefinition),
    ]))
  );
  const presets = Object.freeze(
    (definition.presets || []).map(normalizePresetDefinition)
  );
  const routeOptions = Object.freeze(
    (definition.routeOptions || routeEntries.map(([routeId, routeDefinition]) => ({
      value: routeId,
      label: routeDefinition.label || routeId,
    }))).map(option => Object.freeze({ ...option }))
  );
  const routeDependencies = Object.freeze(
    Object.fromEntries(
      Object.entries(definition.routeDependencies || {}).map(([routeId, dependencies]) => [
        routeId,
        Object.freeze([...(dependencies || [])]),
      ])
    )
  );

  return Object.freeze({
    kind: 'core',
    defaultEnabled: false,
    defaultBufferEnabled: false,
    order: 0,
    ...definition,
    exploratory: Boolean(definition.exploratory),
    maturity: definition.exploratory ? 'Exploratory' : 'Supported',
    configs: Object.freeze([...(definition.configs || [])]),
    dependencies: Object.freeze([...(definition.dependencies || [])]),
    presets,
    defaultPreset: presets.some(preset => preset.value === definition.defaultPreset)
      ? definition.defaultPreset
      : (presets[0]?.value || null),
    routeDependencies,
    routeOptions,
    routes,
    missingInputs: Object.freeze([...(definition.missingInputs || [])]),
    diagramInputs: Object.freeze({ ...(definition.diagramInputs || {}) }),
    market: definition.market ? Object.freeze({ ...definition.market }) : null,
    defaultRoute: definition.defaultRoute || routeOptions[0]?.value || null,
  });
}

const MODULE_CATALOG = Object.freeze(MODULE_DEFINITIONS.map(normalizeModuleDefinition));

const MODULE_CATALOG_BY_ID = Object.freeze(
  Object.fromEntries(MODULE_CATALOG.map(module => [module.id, module]))
);

function resolveModule(moduleOrId) {
  if (typeof moduleOrId === 'string') {
    return Object.hasOwn(MODULE_CATALOG_BY_ID, moduleOrId) ? MODULE_CATALOG_BY_ID[moduleOrId] : null;
  }
  return moduleOrId || null;
}

export const ModuleCatalog = Object.freeze({
  getAll() {
    return MODULE_CATALOG;
  },

  getById(moduleId) {
    return typeof moduleId === 'string' ? resolveModule(moduleId) : null;
  },

  getSupportedModules() {
    return MODULE_CATALOG.filter(module => !module.exploratory);
  },

  getExploratoryModules() {
    return MODULE_CATALOG.filter(module => module.exploratory);
  },

  resolve(moduleOrId) {
    return resolveModule(moduleOrId);
  },

  hasRoutes(moduleOrId) {
    return Object.keys(resolveModule(moduleOrId)?.routes || {}).length > 0;
  },

  hasPresets(moduleOrId) {
    return (resolveModule(moduleOrId)?.presets || []).length > 0;
  },

  getPresets(moduleOrId) {
    return resolveModule(moduleOrId)?.presets || [];
  },

  getPreset(moduleOrId, presetValue = null) {
    const module = resolveModule(moduleOrId);
    if (!module) return null;

    const presets = module.presets || [];
    if (!presets.length) return null;
    if (presetValue) {
      return presets.find(preset => preset.value === presetValue) || null;
    }
    return presets.find(preset => preset.value === module.defaultPreset) || presets[0] || null;
  },

  getMatchingPreset(moduleOrId, state = {}) {
    return this.getPresets(moduleOrId).find(preset =>
      Object.entries(preset.values || {}).every(([stateKey, expectedValue]) => {
        const actualValue = Number(state?.[stateKey]);
        const targetValue = Number(expectedValue);
        return Number.isFinite(actualValue)
          && Number.isFinite(targetValue)
          && Math.abs(actualValue - targetValue) <= 1e-9;
      })
    ) || null;
  },

  isPresetConfigField(moduleOrId, configKey) {
    return this.getPresets(moduleOrId).some(
      preset => Object.prototype.hasOwnProperty.call(preset.values || {}, configKey)
    );
  },

  getRouteOptions(moduleOrId) {
    return resolveModule(moduleOrId)?.routeOptions || [];
  },

  getDefaultRoute(moduleOrId) {
    return resolveModule(moduleOrId)?.defaultRoute || null;
  },

  getRouteConfig(moduleOrId, route = null) {
    const module = resolveModule(moduleOrId);
    if (!module) return null;

    const routes = module.routes || {};
    if (route && routes[route]) return routes[route];

    const fallbackRoute = module.defaultRoute;
    return fallbackRoute ? routes[fallbackRoute] || null : null;
  },

  getMarketConfig(moduleOrId, route = null) {
    return this.getRouteConfig(moduleOrId, route)?.market || resolveModule(moduleOrId)?.market || null;
  },

  hasMarket(moduleOrId, route = null) {
    return Boolean(this.getMarketConfig(moduleOrId, route));
  },

  getConfigFields(moduleOrId) {
    return resolveModule(moduleOrId)?.configs || [];
  },

  getAssetLifeKey(moduleOrId) {
    return resolveModule(moduleOrId)?.assetLifeKey || null;
  },

  getDefaultAssetLife(moduleOrId) {
    return resolveModule(moduleOrId)?.defaultAssetLife ?? 7;
  },

  getMissingInputs(moduleOrId) {
    return resolveModule(moduleOrId)?.missingInputs || [];
  },

  getDependencies(moduleOrId, state = {}) {
    const module = resolveModule(moduleOrId);
    if (!module) return [];

    const dependencies = new Set(module.dependencies || []);
    const route = state?.[`${module.id}Route`] || module.defaultRoute;
    const routeDependencies = module.routeDependencies?.[route];
    if (Array.isArray(routeDependencies)) {
      routeDependencies.forEach(dependencyId => dependencies.add(dependencyId));
    }

    return Array.from(dependencies);
  },

  supportsFeedBuffer(moduleOrId, route = null) {
    const module = resolveModule(moduleOrId);
    if (!module) return false;
    if (module.supportsFeedBuffer) return true;
    if (!this.hasRoutes(module)) return false;

    const routeToCheck = route || module.defaultRoute;
    const routeConfig = routeToCheck ? this.getRouteConfig(module, routeToCheck) : null;
    return Boolean(routeConfig?.supportsFeedBuffer);
  },

  /* True when the module or any of its routes can run with a feed buffer. */
  hasFeedBufferSupport(moduleOrId) {
    const module = resolveModule(moduleOrId);
    if (!module) return false;
    if (module.supportsFeedBuffer) return true;
    return this.getRouteOptions(module).some(option => this.supportsFeedBuffer(module, option.value));
  },

  getFeedBufferLabel(moduleOrId, route = null) {
    const module = resolveModule(moduleOrId);
    if (!module) return DEFAULT_FEED_BUFFER_LABEL;
    if (module.bufferLabel) return module.bufferLabel;

    const routeToCheck = route || module.defaultRoute;
    const routeConfig = routeToCheck ? this.getRouteConfig(module, routeToCheck) : null;
    return routeConfig?.bufferLabel || DEFAULT_FEED_BUFFER_LABEL;
  },

  /* Slider range for an exploratory route's capex basis: 0.25x-4x the
     reference value, on a step that scales with its magnitude. */
  getCapexControlConfig(moduleOrId, route = null) {
    const routeConfig = this.getRouteConfig(moduleOrId, route);
    const defaultValue = routeConfig?.capexPerAnnualUnit || 0;
    const unitLabel = routeConfig?.capexUnit === 'm3pd' ? '$/m3/day' : '$/ton/yr capacity';
    const step = defaultValue >= 5000 ? 100 : defaultValue >= 1000 ? 50 : defaultValue >= 250 ? 10 : 5;
    const min = Math.max(step, Math.floor((defaultValue * 0.25) / step) * step);
    const max = Math.max(min + step, Math.ceil((defaultValue * 4) / step) * step);
    return {
      min,
      max,
      step,
      defaultValue,
      unitLabel,
    };
  },

  getFamilyLabel(familyKey) {
    return Object.hasOwn(MODULE_FAMILY_LABELS, familyKey) ? MODULE_FAMILY_LABELS[familyKey] : familyKey;
  },

  groupByFamily(modules = MODULE_CATALOG) {
    return modules.reduce((groups, module) => {
      const familyKey = module.family || 'other';
      groups[familyKey] = groups[familyKey] || [];
      groups[familyKey].push(module);
      return groups;
    }, {});
  },
});

/* Calc facade wrappers (kept for the UI's existing Calc.* calls). */
export const catalogMethods = {
  getModuleById(moduleId) {
    return ModuleCatalog.getById(moduleId);
  },

  getDirectModuleDependencies(moduleId, state = {}) {
    return ModuleCatalog.getDependencies(moduleId, state);
  },

  getModuleRouteConfig(moduleId, route) {
    return ModuleCatalog.getRouteConfig(moduleId, route);
  },

  getExploratoryRouteConfig(moduleId, route) {
    return ModuleCatalog.getRouteConfig(moduleId, route);
  },

  getModuleCapexControlConfig(moduleId, route) {
    return ModuleCatalog.getCapexControlConfig(moduleId, route);
  },

  getExploratoryCapexControlConfig(moduleId, route) {
    return ModuleCatalog.getCapexControlConfig(moduleId, route);
  },

  moduleSupportsFeedBuffer(moduleId, route = null) {
    return ModuleCatalog.supportsFeedBuffer(moduleId, route);
  },

  hasModuleFeedBufferSupport(moduleId) {
    return ModuleCatalog.hasFeedBufferSupport(moduleId);
  },

  getModuleFeedBufferLabel(moduleId, route = null) {
    return ModuleCatalog.getFeedBufferLabel(moduleId, route);
  },

  isModuleFeedBufferEnabled(state = {}, moduleId, route = null) {
    return ModuleCatalog.supportsFeedBuffer(moduleId, route) && Boolean(state?.[`${moduleId}BufferEnabled`]);
  },
};
