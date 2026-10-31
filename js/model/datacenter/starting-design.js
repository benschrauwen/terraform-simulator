/* ============================================
   Starting design after an architecture switch
   ============================================
   buildStartingDesign(state, architecture) = applyArchitectureDefaults
   (state/datacenter-schema.js; sizes justified in data/datacenter/power.js
   ARCHITECTURE_STARTING_DESIGNS). Its gas is auto-sized for the uptime
   target (firm-sizing.js), so it meets the target whenever enough units
   can; as a safeguard (an unreachable target, a type with tiny units), one
   gas unit at a time is then added (manual sizing) until it meets it, up to
   MAX_EXTRA_UNITS. Pure; no DOM. */

import { applyArchitectureDefaults } from '../../state/datacenter-schema.js';
import { calculateDatacenterScenario } from './scenario.js';

const MAX_EXTRA_UNITS = 10;

/**
 * { state, result, addedUnits }: the starting design for `architecture`,
 * its full result and how many gas units were added to meet the uptime
 * target (0 when the rule-based design already meets it).
 */
export function buildStartingDesign(rawState, architecture) {
  let state = applyArchitectureDefaults(rawState, architecture);
  let result = calculateDatacenterScenario(state, { fastMode: true });
  let addedUnits = 0;
  while (!result.reliability.meetsTarget && result.firm.family === 'gas' && addedUnits < MAX_EXTRA_UNITS) {
    addedUnits += 1;
    state = { ...state, firmSizingMode: 'manual', firmUnits: result.firm.units + 1 };
    result = calculateDatacenterScenario(state, { fastMode: true });
  }
  return { state: result.state, result, addedUnits };
}
