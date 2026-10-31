/*
 * Backup diesel next to the prime supply (model/datacenter/backup.js): the last resource in the
 * hourly balance, auto-sized to the fewest units covering every hour still short (plus spares),
 * at the standby diesel type's own costs, with EPA run-hour checks; the optimizer judges the
 * uptime target without it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { GAS_GENSET_TYPES } from '../../js/data/datacenter/power.js';
import { applyArchitectureDefaults, calculateDatacenterScenario, DATACENTER_DEFAULT_STATE, optimizeDatacenterDesign } from '../../js/model/datacenter/index.js';

const close = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));
const HYBRID = applyArchitectureDefaults(DATACENTER_DEFAULT_STATE, 'hybrid');
const DIESEL = GAS_GENSET_TYPES['standby-diesel'];

test('a grid site with no prime plant and auto backup matches the standby-diesel grid design', () => {
  const standby = calculateDatacenterScenario({});
  const backup = calculateDatacenterScenario({ firmFamily: 'none', backupDieselMode: 'auto' });
  assert.equal(standby.firm.type, 'standby-diesel');
  assert.equal(backup.backup.units, standby.firm.units);
  assert.equal(backup.reliability.uptimePercent, standby.reliability.uptimePercent);
  assert.ok(backup.reliability.uptimeWithoutBackupPercent < backup.reliability.targetPercent);
  assert.ok(close(backup.economics.npv, standby.economics.npv, 1e-3), `${backup.economics.npv} vs ${standby.economics.npv}`);
});

test('the backup is the last resource: hourly balance holds and it only fills what is left', () => {
  const r = calculateDatacenterScenario({ ...HYBRID, firmSizingMode: 'manual', firmUnits: 4, backupDieselMode: 'auto' });
  const H = r.dispatch.hourly;
  assert.ok(r.backup.units > 0 && r.dispatch.annual.backupMWh > 0);
  for (let h = 0; h < 8760; h++) {
    const supply = H.solarMW[h] + H.nuclearMW[h] + H.gridMW[h] + H.gasMW[h] + H.backupMW[h] + H.batteryDischargeMW[h] + H.unservedMW[h];
    const use = H.loadMW[h] + H.batteryChargeMW[h] + H.exportMW[h] + H.curtailedMW[h];
    assert.ok(Math.abs(supply - use) < 1e-6, `hour ${h}`);
    if (H.backupMW[h] > 0) assert.ok(H.batteryChargeMW[h] < 1e-9 || H.backupMW[h] <= H.loadMW[h], `hour ${h}`);
  }
  assert.equal(r.reliability.unservedHours, 0);
});

test('auto sizing is the fewest units covering every short hour, plus the spares', () => {
  const base = { ...HYBRID, firmSizingMode: 'manual', firmUnits: 4 };
  const auto = calculateDatacenterScenario({ ...base, backupDieselMode: 'auto', backupDieselSpareUnits: 1 }, { fastMode: true });
  const n = auto.backup.sizingBasis.baseUnits;
  assert.equal(auto.backup.units, n + 1);
  const exact = calculateDatacenterScenario({ ...base, backupDieselMode: 'manual', backupDieselUnits: n }, { fastMode: true });
  const fewer = calculateDatacenterScenario({ ...base, backupDieselMode: 'manual', backupDieselUnits: n - 1 }, { fastMode: true });
  assert.equal(exact.reliability.unservedHours, 0);
  assert.ok(fewer.reliability.unservedHours > 0);
  // A design that is never short needs no backup.
  const covered = calculateDatacenterScenario({ ...HYBRID, backupDieselMode: 'auto', firmExtraUnits: 20 }, { fastMode: true });
  if (covered.reliability.uptimeWithoutBackupPercent === 100) assert.equal(covered.backup.units, 0);
});

test('the backup diesel is costed at the standby diesel type, separately from the prime plant', () => {
  const r = calculateDatacenterScenario({ ...HYBRID, backupDieselMode: 'manual', backupDieselUnits: 20 });
  const item = r.economics.capexItems.find(entry => entry.key === 'backupDiesel');
  assert.ok(close(item.capex, 20 * DIESEL.unitSizeMW.default * 1000 * DIESEL.capexPerKW.default));
  const gas = r.economics.capexItems.find(entry => entry.key === 'gas');
  assert.ok(close(gas.capex, r.state.gasCapexPerKW * r.firm.capacityMW * 1000), 'the prime plant keeps its own costs');
  assert.ok(r.economics.opexLines.some(line => line.key === 'backupDieselFuel'));
  assert.ok(close(r.footprint.areasM2.backupDiesel, DIESEL.footprintM2PerMW * 20 * DIESEL.unitSizeMW.default));
  assert.ok(r.schedule.paths.some(path => path.id.startsWith('backup-') && !path.required));
  // Emissions: the diesel's own fuel factor.
  assert.ok(r.emissions.backupT >= 0 && close(r.emissions.totalT, r.emissions.gridT + r.emissions.gasT + r.emissions.backupT));
});

test('not offered when the prime generation is standby diesel itself', () => {
  const r = calculateDatacenterScenario({ backupDieselMode: 'auto' });
  assert.equal(r.firm.type, 'standby-diesel');
  assert.equal(r.backup, null);
});

test('a backup run as prime power trips the EPA warning, and the optimizer does not count it', () => {
  // Islanded solar + small battery with auto backup: the diesel carries the nights.
  const state = { architecture: 'islanded', firmFamily: 'none', solarSizeMWdc: 400, batteryCapacityMWh: 200, backupDieselMode: 'auto' };
  const r = calculateDatacenterScenario(state, { fastMode: true });
  assert.equal(r.reliability.meetsTarget, true);
  assert.equal(r.reliability.meetsTargetWithoutBackup, false);
  assert.ok(r.warnings.some(w => w.key === 'backup-run-hours'));
  const opt = optimizeDatacenterDesign({ ...DATACENTER_DEFAULT_STATE, ...state }, { budget: 60, sizeFirm: false });
  assert.equal(opt.baseline.feasible, false, 'the baseline only meets the target with the backup');
});
