/* ============================================
   Datacenter model: public API
   ============================================
   The Abundance Stack datacenter engine. The UI imports from here:
   - calculateDatacenterScenario(state, { fastMode }): the full result
     (shape documented at the top of ./scenario.js);
   - runDatacenterTornado(state, variables?, { swingPercent }) and
     calculateDatacenterBreakEven(state, { baseResult });
   - buildCashFlowTable / buildCashFlowCsv (shared with the plant builder;
     they read economics.yearlyCashFlows, which has the same fields);
   - the schema: DATACENTER_DEFAULT_STATE, DATACENTER_STATE_FIELDS,
     DATACENTER_DERIVED_KEYS, normalizeDatacenterState,
     applyDatacenterPresetDefaults, getDatacenterSite. */

export { calculateDatacenterScenario } from './scenario.js';
export { calculateDatacenterBreakEven, getDatacenterFieldRange, runDatacenterTornado } from './tornado.js';
export { FLOW_NODE_LABELS } from './impacts.js';
export { buildCashFlowCsv, buildCashFlowTable } from '../cash-flow-table.js';
export {
  applyDatacenterPresetDefaults,
  DATACENTER_DEFAULT_STATE,
  DATACENTER_DERIVED_KEYS,
  DATACENTER_STATE_FIELDS,
  getDatacenterSite,
  normalizeDatacenterState,
} from '../../state/datacenter-schema.js';
