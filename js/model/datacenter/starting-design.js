/* ============================================
   Starting design after an architecture switch
   ============================================
   buildStartingDesign(state, architecture) = applyArchitectureDefaults
   (state/datacenter-schema.js; sizes justified in data/datacenter/power.js
   ARCHITECTURE_STARTING_DESIGNS) with the design peak taken from the model,
   then, if that design still misses the uptime target, one gas unit at a
   time is added (manual sizing) until it meets it, up to MAX_EXTRA_UNITS.

   Why the top-up: the hybrid design credits the battery's full power during
   a grid curtailment, but with solar on site the battery shifts solar every
   day and is not always full when a curtailment starts (at Abilene it is;
   at a few cloudier or hotter sites one or two units more are needed in the
   TMY year). The starting design should meet the target the user set, so
   the gap is closed with the cheapest-to-explain resource, a gas unit.
   Pure; no DOM. */

import { applyArchitectureDefaults } from '../../state/datacenter-schema.js';
import { calculateDatacenterScenario } from './scenario.js';

const MAX_EXTRA_UNITS = 10;

/**
 * { state, result, addedUnits }: the starting design for `architecture`,
 * its full result and how many gas units were added to meet the uptime
 * target (0 when the rule-based design already meets it).
 */
export function buildStartingDesign(rawState, architecture) {
  const current = calculateDatacenterScenario(rawState, { fastMode: true });
  let state = applyArchitectureDefaults(current.state, architecture, { designPeakMW: current.load.designPeakMW });
  let result = calculateDatacenterScenario(state, { fastMode: true });
  let addedUnits = 0;
  while (!result.reliability.meetsTarget && result.firm.family === 'gas' && addedUnits < MAX_EXTRA_UNITS) {
    addedUnits += 1;
    state = { ...state, firmSizingMode: 'manual', firmUnits: result.firm.units + 1 };
    result = calculateDatacenterScenario(state, { fastMode: true });
  }
  return { state: result.state, result, addedUnits };
}
