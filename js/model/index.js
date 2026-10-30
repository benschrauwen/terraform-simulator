/* ============================================
   Calc facade: the calculation engine's public API
   ============================================
   Each model file contributes a plain method object; methods call each other
   through `this`, so they must always be invoked via the assembled facade.
   Pure helpers (util, finance, normalization) are plain functions that the
   facade re-exposes under their historical Calc method names. */

import { normalizeMethods } from '../state/normalize.js';
import { aiComputeMethods } from './ai-compute.js';
import { annualSeriesMethods } from './annual-series.js';
import { batteryMethods } from './battery.js';
import { breakEvenMethods } from './break-even.js';
import { economicsMethods } from './economics.js';
import { financeMethods } from './finance.js';
import { lifetimeEnergyMethods } from './lifetime-energy.js';
import { optimizerSearchMethods } from './optimizer-search.js';
import { processMethods } from './process.js';
import { scenarioMethods } from './scenario.js';
import { solarMethods } from './solar.js';
import { utilMethods } from '../util.js';

export const Calc = Object.assign(
  {},
  utilMethods,
  financeMethods,
  normalizeMethods,
  optimizerSearchMethods,
  solarMethods,
  annualSeriesMethods,
  batteryMethods,
  aiComputeMethods,
  lifetimeEnergyMethods,
  processMethods,
  economicsMethods,
  scenarioMethods,
  breakEvenMethods,
);

export { ModuleCatalog } from '../data/module-catalog.js';
export { PolicyModel } from './policy.js';
export { SolarGeometry } from './solar-geometry.js';
export { DEFAULT_STATE } from '../state/schema.js';
