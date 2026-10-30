/* ============================================
   Datacenter hourly dispatch
   ============================================
   One 8760-hour year. Facility load(h) = IT(h) x PUE(h). Each hour:

   1. Must-take supply (solar + nuclear baseload) serves the load first.
      Surplus charges the battery, then is exported (if export is enabled
      and the grid is available, up to the connection capacity) or
      curtailed. A must-take nuclear contract is paid on all of its output.
   2. A deficit is met in order by
        shift battery -> [grid -> reserve battery -> gas]   ('grid-first')
        shift battery -> [gas -> grid -> reserve battery]   ('firm-first')
      grid only when connected, available this hour and up to the import
      cap; gas up to its available capacity after planned outages. 'grid'
      architecture is grid-first (gas is backup); 'hybrid' orders grid and
      gas by marginal cost (gas fuel x heat rate + VOM vs grid energy
      price), except that a standby-only type (standby diesel) is always
      after the grid; 'islanded' has no grid. What is left is unserved.
      Gas run hours in utility-outage hours are counted apart (EPA
      emergency use, warnings.js).
   3. Battery role. With a surplus source on site (solar or nuclear) the
      battery SHIFTS that surplus: it charges only from surplus and
      discharges first into any deficit. Without one it is a RESERVE: it is
      topped up from the grid while the grid is available (or, islanded,
      from spare gas capacity), never in an hour it discharged, and
      discharges only when the grid cannot carry the load (flexible-
      connection outages, import cap). The battery never charges from the
      grid to shift energy in time (no arbitrage).

   Hourly energy balance (asserted in tests):
     solar + nuclear + grid + gas + battery discharge + unserved
       = load + battery charge input + export + curtailed
   Battery primitives (power limit = capacity / duration, sqrt(round-trip)
   each way, 2%/month self-discharge, periodic start SoC) are the plant
   builder's (model/battery.js). Pure; no DOM. */

import {
  applyBatteryLeakage,
  chargeBattery,
  createAnnualBattery,
  dischargeBattery,
  settleAnnualStartSoc,
} from '../battery.js';
import { HOURS_PER_YEAR, MONTH_OF_HOUR } from './climate.js';
import { gasFuelMMBtu } from './supply.js';
import { DATACENTER_MODEL_ASSUMPTIONS as A } from '../../data/datacenter/model-assumptions.js';

const SERIES_KEYS = ['solarKW', 'nuclearKW', 'gridKW', 'gasKW', 'batteryDischargeKW', 'batteryChargeKW', 'exportKW', 'curtailedKW', 'socKWh'];

/** Deficit order for the architecture: 'grid-first' or 'firm-first'. */
export function getDispatchOrder(state, firm) {
  // Standby (emergency) generators are last-resort backup: never dispatched
  // on cost against an available grid, however their price compares.
  if (state.architecture === 'hybrid' && firm.family === 'gas' && !firm.typeData?.standbyOnly && firm.marginalCostPerMWh < state.gridEnergyPricePerMWh) {
    return 'firm-first';
  }
  return state.architecture === 'islanded' ? 'firm-first' : 'grid-first';
}

/** 'shift' | 'reserve' | 'none' (see header). */
export function getBatteryRole(batteryState, solar, firm) {
  if (!(batteryState.batteryCapacityMWh > 0)) return 'none';
  return (solar?.enabled || firm.mustTake) ? 'shift' : 'reserve';
}

function runPass(inputs, startSocKWh, capture) {
  const { loadKW, solarKW, firm, grid, batteryState, order, exportAllowed, role } = inputs;
  const battery = createAnnualBattery(batteryState, startSocKWh);
  const hasBattery = role !== 'none';
  const mustTakeKW = firm.mustTake ? firm.availableKW : null;
  const gasKWAvailable = firm.family === 'gas' ? firm.availableKW : null;
  const gridAvailable = grid.connected ? grid.available : null;
  const series = capture ? Object.fromEntries(SERIES_KEYS.map(key => [key, new Float64Array(HOURS_PER_YEAR)])) : null;
  const unservedKW = new Float64Array(HOURS_PER_YEAR);
  const t = {
    loadKWh: 0, solarKWh: 0, nuclearKWh: 0, gridKWh: 0, gasKWh: 0, batteryDischargeKWh: 0, batteryChargeKWh: 0,
    exportKWh: 0, curtailedKWh: 0, unservedKWh: 0, gridToBatteryKWh: 0, gasToBatteryKWh: 0,
    solarToLoadKWh: 0, solarToBatteryKWh: 0, solarExportKWh: 0, solarCurtailedKWh: 0,
    nuclearToLoadKWh: 0, nuclearToBatteryKWh: 0, nuclearExportKWh: 0, nuclearCurtailedKWh: 0,
    fuelMMBtu: 0, gasRunHours: 0, gasOutageRunHours: 0, gridImportHours: 0, servedHours: 0, unservedHours: 0, maxUnservedKW: 0,
    longestUnservedStreakHours: 0, peakGridKW: 0, peakExportKW: 0,
  };
  const monthlyPeakGridKW = new Array(12).fill(0);
  let streak = 0;

  for (let h = 0; h < HOURS_PER_YEAR; h++) {
    const load = loadKW[h];
    const solar = solarKW ? solarKW[h] : 0;
    const nuclear = mustTakeKW ? mustTakeKW[h] : 0;
    const gridOk = gridAvailable ? gridAvailable[h] === 1 : false;
    const gridCap = gridOk ? grid.capKW : 0;
    const gasCap = gasKWAvailable ? gasKWAvailable[h] : 0;
    if (hasBattery) applyBatteryLeakage(battery);

    let gridKW = 0;
    let gasKW = 0;
    let dischargeKW = 0;
    let surplusChargeKW = 0;
    let exportKW = 0;
    let curtailedKW = 0;
    let deficit = 0;
    const mustTake = solar + nuclear;
    const solarShare = mustTake > 0 ? solar / mustTake : 0;

    if (mustTake >= load) {
      const surplus = mustTake - load;
      if (hasBattery && surplus > 0) surplusChargeKW = chargeBattery(battery, surplus) / battery.chargeEff;
      const rest = Math.max(0, surplus - surplusChargeKW);
      exportKW = exportAllowed && gridOk ? Math.min(rest, grid.capKW) : 0;
      curtailedKW = rest - exportKW;
      t.solarToLoadKWh += load * solarShare;
      t.nuclearToLoadKWh += load * (1 - solarShare);
      t.solarToBatteryKWh += surplusChargeKW * solarShare;
      t.nuclearToBatteryKWh += surplusChargeKW * (1 - solarShare);
      t.solarExportKWh += exportKW * solarShare;
      t.nuclearExportKWh += exportKW * (1 - solarShare);
      t.solarCurtailedKWh += curtailedKW * solarShare;
      t.nuclearCurtailedKWh += curtailedKW * (1 - solarShare);
    } else {
      deficit = load - mustTake;
      t.solarToLoadKWh += solar;
      t.nuclearToLoadKWh += nuclear;
      if (role === 'shift') {
        dischargeKW = dischargeBattery(battery, deficit);
        deficit -= dischargeKW;
      }
      const takeGrid = () => {
        const take = Math.min(deficit, gridCap);
        gridKW += take;
        deficit -= take;
      };
      const takeReserve = () => {
        if (role !== 'reserve' || deficit <= 0) return;
        const delivered = dischargeBattery(battery, deficit);
        dischargeKW += delivered;
        deficit -= delivered;
      };
      const takeGas = () => {
        const take = Math.min(deficit, gasCap);
        gasKW += take;
        deficit -= take;
      };
      if (order === 'firm-first') {
        takeGas();
        takeGrid();
        takeReserve();
      } else {
        takeGrid();
        takeReserve();
        takeGas();
      }
      if (deficit < 1e-9) deficit = 0;
    }

    // Reserve battery top-up from spare grid (or, islanded, spare gas).
    let gridToBatteryKW = 0;
    let gasToBatteryKW = 0;
    if (role === 'reserve' && dischargeKW === 0 && battery.socKWh < battery.capacityKWh - 1e-9) {
      if (gridOk) {
        gridToBatteryKW = chargeBattery(battery, Math.max(0, gridCap - gridKW)) / battery.chargeEff;
        gridKW += gridToBatteryKW;
      } else if (!grid.connected && gasCap > gasKW) {
        gasToBatteryKW = chargeBattery(battery, gasCap - gasKW) / battery.chargeEff;
        gasKW += gasToBatteryKW;
      }
    }
    const chargeKW = surplusChargeKW + gridToBatteryKW + gasToBatteryKW;

    t.loadKWh += load;
    t.solarKWh += solar;
    t.nuclearKWh += nuclear;
    t.gridKWh += gridKW;
    t.gasKWh += gasKW;
    t.batteryDischargeKWh += dischargeKW;
    t.batteryChargeKWh += chargeKW;
    t.gridToBatteryKWh += gridToBatteryKW;
    t.gasToBatteryKWh += gasToBatteryKW;
    t.exportKWh += exportKW;
    if (exportKW > t.peakExportKW) t.peakExportKW = exportKW;
    t.curtailedKWh += curtailedKW;
    t.unservedKWh += deficit;
    if (gasKW > 0) {
      t.fuelMMBtu += gasFuelMMBtu(gasKW, inputs.firm);
      t.gasRunHours += 1;
      if (grid.outage?.[h]) t.gasOutageRunHours += 1;
    }
    if (gridKW > 0) t.gridImportHours += 1;
    if (gridKW > monthlyPeakGridKW[MONTH_OF_HOUR[h]]) monthlyPeakGridKW[MONTH_OF_HOUR[h]] = gridKW;
    unservedKW[h] = deficit;
    if (deficit > A.servedTolerance * load) {
      t.unservedHours += 1;
      streak += 1;
      if (streak > t.longestUnservedStreakHours) t.longestUnservedStreakHours = streak;
      if (deficit > t.maxUnservedKW) t.maxUnservedKW = deficit;
    } else {
      t.servedHours += 1;
      streak = 0;
    }
    if (series) {
      series.solarKW[h] = solar;
      series.nuclearKW[h] = nuclear;
      series.gridKW[h] = gridKW;
      series.gasKW[h] = gasKW;
      series.batteryDischargeKW[h] = dischargeKW;
      series.batteryChargeKW[h] = chargeKW;
      series.exportKW[h] = exportKW;
      series.curtailedKW[h] = curtailedKW;
      series.socKWh[h] = battery.socKWh;
    }
  }

  t.peakGridKW = Math.max(...monthlyPeakGridKW);
  return {
    totals: t,
    monthlyPeakGridKW,
    unservedKW,
    series,
    battery: {
      capacityKWh: battery.capacityKWh,
      startSocKWh: Math.max(0, Math.min(battery.capacityKWh, startSocKWh)),
      endSocKWh: battery.socKWh,
      chargeThroughputKWh: battery.chargeThroughputKWh,
      dischargeThroughputKWh: battery.dischargeThroughputKWh,
      leakageKWh: battery.leakageKWh,
    },
    endSocKWh: battery.socKWh,
  };
}

/**
 * Settled annual dispatch (periodic battery state of charge). `inputs`:
 * { loadKW, solarKW|null, firm, grid, batteryState, order, exportAllowed }.
 * Returns { totals (kWh, MMBtu, hours), monthlyPeakGridKW, unservedKW
 * (8760), series (8760 per source when capture), battery, role, order,
 * settleIterations }.
 */
export function dispatchYear(inputs, { capture = false } = {}) {
  const role = getBatteryRole(inputs.batteryState, inputs.solar, inputs.firm);
  const full = { ...inputs, role };
  const capacityKWh = role === 'none' ? 0 : inputs.batteryState.batteryCapacityMWh * 1000;
  const { startSocKWh, settleIterations } = settleAnnualStartSoc(
    capacityKWh,
    start => runPass(full, start, false),
    { hasInput: role !== 'none' && inputs.batteryState.batteryEfficiency > 0 },
  );
  const result = runPass(full, startSocKWh, capture);
  return { ...result, role, order: inputs.order, settleIterations };
}
