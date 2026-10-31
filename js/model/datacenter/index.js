/* ============================================
   Datacenter model: public API
   ============================================
   The Abundance Stack datacenter engine. The UI imports from here:
   - calculateDatacenterScenario(state, { fastMode }): the full result
     (shape documented at the top of ./scenario.js);
   - runDatacenterTornado(state, variables?, { swingPercent }) and
     calculateDatacenterBreakEven(state, { baseResult });
   - optimizeDatacenterDesign(state, options) and compareArchitectures(state,
     options): the highest-NPV design that meets the uptime target (./optimizer.js);
   - buildCashFlowTable / buildCashFlowCsv (shared with the plant builder;
     they read economics.yearlyCashFlows, which has the same fields);
   - the schema: DATACENTER_DEFAULT_STATE, DATACENTER_STATE_FIELDS,
     DATACENTER_DERIVED_KEYS, normalizeDatacenterState,
     applyDatacenterPresetDefaults, applyArchitectureDefaults, getDatacenterSite;
   - buildStartingDesign(state, architecture): the design applied when the
     user switches architecture (./starting-design.js);
   - optimizeForSite(state, siteId, options): the best design for the user's
     settings moved to another site (./site-survey.js). */

export { calculateDatacenterScenario } from './scenario.js';
export { calculateDatacenterBreakEven, getDatacenterFieldRange, runDatacenterTornado } from './tornado.js';
export { compareArchitectures, getArchitectureStartState, optimizeDatacenterDesign } from './optimizer.js';
export { FLOW_NODE_LABELS } from './impacts.js';
export { BATTERY_SWEEP_PRICES_PER_KWH, optimizeForSite, priceSweepPoint, SOLAR_SWEEP_PRICES_PER_W } from './site-survey.js';
export { buildStartingDesign } from './starting-design.js';
export { buildCashFlowCsv, buildCashFlowTable } from '../cash-flow-table.js';
export {
  applyArchitectureDefaults,
  applyDatacenterPresetDefaults,
  DATACENTER_DEFAULT_STATE,
  DATACENTER_DERIVED_KEYS,
  DATACENTER_STATE_FIELDS,
  getDatacenterSite,
  normalizeDatacenterState,
} from '../../state/datacenter-schema.js';
