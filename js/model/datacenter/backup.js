/* ============================================
   Backup diesel next to the prime supply
   ============================================
   Real AI campuses pair prime power (grid, gas turbines or engines, fuel
   cells) with a fleet of standby diesel generators for the hours the rest
   cannot carry. backupDieselMode adds that fleet to any design whose prime
   generation is not standby diesel itself:

   - The units are power.js 'standby-diesel' (3 MW, $/kW, fuel, heat rate,
     availability, hot-weather derate and the EPA emergency-engine limits),
     at that type's own preset values (the gas sliders stay the prime
     plant's): getBackupDieselState.
   - Dispatch (dispatch.js): the last resource in every hour, after grid,
     prime generation and battery (the reserve floor included); it never
     charges the battery. Units are maintained one after another from 1
     March like the prime units.
   - 'auto' sizing: run the design without backup; the hours it leaves
     short need s(h) = unserved(h) - servedTolerance x load(h); the fewest
     N whose available output (maintenance, derate) covers every such hour,
     plus backupDieselSpareUnits when N > 0. Nothing the backup does feeds
     back into other hours, so this is exact. 'manual': backupDieselUnits.
   - The prime plant's auto sizing and the optimizer's feasibility ignore
     the backup (reliability.meetsTargetWithoutBackup): it is resilience on
     top, not a way to meet the target with emergency engines.
   Pure; no DOM. */

import { DATACENTER_MODEL_ASSUMPTIONS as A } from '../../data/datacenter/model-assumptions.js';
import { applyDatacenterPresetDefaults } from '../../state/datacenter-schema.js';
import { HOURS_PER_YEAR } from './climate.js';
import { gasAvailableKW, MAX_FIRM_UNITS } from './firm-sizing.js';
import { buildFirmSupply } from './supply.js';

export const BACKUP_GAS_TYPE = 'standby-diesel';

/** True when the design carries a backup diesel fleet (a mode, and a prime plant that is not standby diesel). */
export function backupApplies(state) {
  return state.backupDieselMode !== 'none' && !(state.firmFamily === 'gas' && state.gasType === BACKUP_GAS_TYPE);
}

/** The state of a standby diesel plant of `units` units at the type's preset values (the user's other settings kept). */
export function getBackupDieselState(state, units = 0) {
  return applyDatacenterPresetDefaults({
    ...state, firmFamily: 'gas', gasType: BACKUP_GAS_TYPE, firmSizingMode: 'manual', firmUnits: units,
  }, 'gasType');
}

/** Firm-supply descriptor of the backup fleet (supply.js buildFirmSupply shape). */
export function buildBackupSupply(state, units, { meanLoadKW, ambientC }) {
  return buildFirmSupply(getBackupDieselState(state, units), { meanLoadKW, ambientC });
}

/**
 * Units of backup the design needs: { baseUnits (before spares), units,
 * requiredMW (largest shortfall), hoursShort, reachable } from the
 * run without backup (`unservedKW`, `loadKW`).
 */
export function sizeBackupDiesel(state, { unservedKW, loadKW, meanLoadKW, ambientC }) {
  const needs = [];
  let maxNeed = 0;
  for (let h = 0; h < HOURS_PER_YEAR; h++) {
    const need = unservedKW[h] - A.servedTolerance * loadKW[h];
    if (need > 0) {
      needs.push({ hour: h, kW: need });
      if (need > maxNeed) maxNeed = need;
    }
  }
  if (!needs.length) return { baseUnits: 0, units: 0, requiredMW: 0, hoursShort: 0, reachable: true };
  const unitFirm = buildBackupSupply(state, 1, { meanLoadKW, ambientC });
  const covers = units => {
    const available = gasAvailableKW(units, unitFirm);
    return needs.every(({ hour, kW }) => available[hour] >= kW - 1e-6);
  };
  let units = Math.max(1, Math.ceil(maxNeed / (unitFirm.unitSizeMW * 1000) - 1e-9));
  while (units <= MAX_FIRM_UNITS && !covers(units)) units += 1;
  const reachable = units <= MAX_FIRM_UNITS;
  const baseUnits = Math.min(units, MAX_FIRM_UNITS);
  return {
    baseUnits,
    units: baseUnits + state.backupDieselSpareUnits,
    requiredMW: maxNeed / 1000,
    hoursShort: needs.length,
    reachable,
  };
}
