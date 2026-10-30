/* ============================================
   Calc facade: the calculation engine's public API
   ============================================
   Each model file contributes a plain method object; methods call each other
   through `this`, so they must always be invoked via the assembled facade. */

import { catalogMethods } from './module-catalog.js';
import { coreMethods } from './core.js';
import { solarMethods } from './solar.js';
import { batteryMethods } from './battery.js';
import { seriesAiMethods } from './series-ai.js';
import { processMethods } from './process.js';
import { economicsMethods } from './economics.js';

export const Calc = Object.assign(
  {},
  catalogMethods,
  coreMethods,
  solarMethods,
  batteryMethods,
  seriesAiMethods,
  processMethods,
  economicsMethods,
);

export { ModuleCatalog } from './module-catalog.js';
export { PolicyModel } from './policy.js';
export { SolarGeometry } from './solar-geometry.js';
export { DEFAULT_STATE } from '../state/schema.js';
