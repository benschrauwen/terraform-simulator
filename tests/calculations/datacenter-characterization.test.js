/*
 * Characterization snapshot of the datacenter model output.
 *
 * Pins a digest of the full datacenter result tree for a matrix of
 * scenarios (architectures, firm generation, cooling technologies, sites,
 * revenue bases, financing, schedule cases) plus the tornado and break-even
 * against tests/fixtures/datacenter-characterization.json. Like the plant
 * builder's snapshot (characterization.test.js, whose fixture this never
 * touches) it is a change detector, not a correctness check: the truths
 * live in datacenter-dispatch.test.js and datacenter-economics.test.js.
 *
 * Regenerate after an intentional model change and review the diff:
 *
 *   UPDATE_CHARACTERIZATION=1 node --test tests/calculations/datacenter-characterization.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { COOLING_TECHNOLOGIES } from '../../js/data/datacenter/cooling.js';
import {
  calculateDatacenterBreakEven,
  calculateDatacenterScenario,
  runDatacenterTornado,
} from '../../js/model/datacenter/index.js';
import { digest, findMismatches } from './snapshot-digest.js';

const FIXTURE_PATH = fileURLToPath(new URL('../fixtures/datacenter-characterization.json', import.meta.url));
const UPDATE = process.env.UPDATE_CHARACTERIZATION === '1';

const SCENARIOS = {
  default: {},
  // Hybrid with standby diesel dispatches as grid does; grid-connected designs are firm service only.
  hybridFlexibleDiesel: { architecture: 'hybrid', gridConnection: 'flexible' },
  hybridFlexibleBattery: { architecture: 'hybrid', gridConnection: 'flexible', firmFamily: 'none', batteryCapacityMWh: 400 },
  hybridSolarBatteryGas: { architecture: 'hybrid', solarSizeMWdc: 200, batteryCapacityMWh: 400 },
  hybridExport: { architecture: 'hybrid', solarSizeMWdc: 300, firmFamily: 'none', gridExportEnabled: true },
  islandedGasRecip: { architecture: 'islanded' },
  islandedGasAeroN2: { architecture: 'islanded', gasType: 'aero', gasUnitSizeMW: 50, gasCapexPerKW: 2275, gasFixedOmPerKWYear: 9.99, gasVariableOmPerMWh: 5.97, gasHeatRateMMBtuPerMWh: 9.45, firmSpareUnits: 2 },
  islandedSolarBattery: { architecture: 'islanded', firmFamily: 'none', solarSizeMWdc: 1000, batteryCapacityMWh: 4000 },
  islandedGasReserveBattery: { architecture: 'islanded', firmSizingMode: 'manual', firmUnits: 9, batteryCapacityMWh: 200 },
  nuclearContracted: { firmFamily: 'nuclear' },
  nuclearSmrIslanded: { architecture: 'islanded', firmFamily: 'nuclear', nuclearType: 'bwrx-300', batteryCapacityMWh: 100 },
  colocation: { revenueBasis: 'colocation' },
  tokens: { revenueBasis: 'tokens' },
  gpuB200AtNtp: { gpuPlatform: 'b200', itCapexTiming: 'ntp' },
  gpuH100Flat: { gpuPlatform: 'h100-sxm', gpuPriceDeclinePercentPerYear: 0, gpuOccupancyPercent: 70 },
  financed: { financingEnabled: true },
  scheduleHigh: { scheduleCase: 'high' },
  itCapexAtNtp: { itCapexTiming: 'ntp' },
  constructionCapexAtNtp: { constructionCapexTiming: 'ntp' },
  demandCharge: { gridEnergyPricePerMWh: 75, gridDemandChargePerKWMonth: 12 },
  phoenixTower: { siteId: 'phoenix-az', coolingTechnology: 'dlc-cooling-tower' },
  luleaAir: { siteId: 'lulea-se', coolingTechnology: 'air-chiller' },
};

// The site preset is static data, and the typical days are averages of the
// hourly series (pinned below); leaving both out keeps the fixture small.
function pinnedResult(result) {
  const { site, dispatch: { typicalDays, ...dispatch }, ...rest } = result;
  return { ...rest, siteId: site.id, dispatch };
}

function computeSnapshot() {
  const snapshot = {};
  for (const [name, overrides] of Object.entries(SCENARIOS)) {
    snapshot[name] = digest(pinnedResult(calculateDatacenterScenario(overrides)));
  }
  for (const id of Object.keys(COOLING_TECHNOLOGIES)) {
    const r = calculateDatacenterScenario({ coolingTechnology: id }, { fastMode: true });
    snapshot[`cooling:${id}`] = digest({ cooling: r.cooling, water: r.water, economics: { npv: r.economics.npv, totalCapex: r.economics.totalCapex } });
  }
  snapshot.tornado = digest(runDatacenterTornado(SCENARIOS.hybridSolarBatteryGas).bars.map(({ variable, ...bar }) => bar));
  snapshot.breakEven = digest([{}, SCENARIOS.tokens, SCENARIOS.colocation].map(overrides => calculateDatacenterBreakEven(overrides)));
  return snapshot;
}

test('datacenter calculation output matches its characterization fixture', () => {
  const actual = JSON.parse(JSON.stringify(computeSnapshot()));
  if (UPDATE || !fs.existsSync(FIXTURE_PATH)) {
    fs.mkdirSync(path.dirname(FIXTURE_PATH), { recursive: true });
    fs.writeFileSync(FIXTURE_PATH, `${JSON.stringify(actual)}\n`);
    if (!UPDATE) assert.fail('Datacenter characterization fixture was missing and has been created; rerun the tests.');
    return;
  }
  const expected = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
  const mismatches = [];
  findMismatches(expected, actual, 'snapshot', mismatches);
  assert.deepEqual(mismatches, [], `Datacenter output drifted:\n${mismatches.join('\n')}`);
});
