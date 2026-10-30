/*
 * Datacenter model: physics and dispatch truths, checked against
 * independent computations (energy balance, cooling.js calibration, CO2
 * factors, hand-derived unit outages and lead times), not snapshots.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { COOLING_TECHNOLOGIES, interpolateCurve } from '../../js/data/datacenter/cooling.js';
import { GAS_DEFAULTS, POWER_LEAD_TIMES } from '../../js/data/datacenter/power.js';
import { DATACENTER_SITES } from '../../js/data/datacenter/sites.js';
import { calculateDatacenterScenario, getDatacenterSite } from '../../js/model/datacenter/index.js';

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const ARCHITECTURES = {
  grid: {},
  gridFlexibleBattery: { gridConnection: 'flexible', firmFamily: 'none', batteryCapacityMWh: 400 },
  hybrid: { architecture: 'hybrid', solarSizeMWdc: 200, batteryCapacityMWh: 400, firmFamily: 'gas', gridExportEnabled: true },
  islandedGasOnly: { architecture: 'islanded', firmFamily: 'gas', gasType: 'recip' },
  islandedSolarBattery: { architecture: 'islanded', firmFamily: 'none', solarSizeMWdc: 1000, batteryCapacityMWh: 4000 },
  islandedGasReserveBattery: { architecture: 'islanded', firmSizingMode: 'manual', firmUnits: 9, batteryCapacityMWh: 200 },
  nuclearContracted: { firmFamily: 'nuclear', nuclearType: 'contracted-existing' },
  nuclearSmrIslanded: { architecture: 'islanded', firmFamily: 'nuclear', nuclearType: 'bwrx-300', batteryCapacityMWh: 100 },
};

for (const [name, overrides] of Object.entries(ARCHITECTURES)) {
  test(`${name}: every hour, supply + unserved = load + battery charge + export + curtailment`, () => {
    const r = calculateDatacenterScenario(overrides);
    const H = r.dispatch.hourly;
    for (let h = 0; h < 8760; h++) {
      const supply = H.solarMW[h] + H.nuclearMW[h] + H.gridMW[h] + H.gasMW[h] + H.batteryDischargeMW[h] + H.unservedMW[h];
      const uses = H.loadMW[h] + H.batteryChargeMW[h] + H.exportMW[h] + H.curtailedMW[h];
      assert.ok(Math.abs(supply - uses) < 1e-6, `hour ${h}: ${supply} vs ${uses}`);
      assert.ok(H.gridMW[h] <= r.grid.importCapMW + 1e-9, `hour ${h} grid above cap`);
      assert.ok(H.unservedMW[h] >= 0 && H.curtailedMW[h] >= -1e-12 && H.exportMW[h] >= 0);
      if (!r.grid.connected) assert.equal(H.gridMW[h], 0);
    }
    // Battery: energy in = energy out + losses + change in stored energy.
    const a = r.dispatch.annual;
    const b = r.dispatch.battery;
    assert.ok(Math.abs(a.batteryChargeMWh - a.batteryDischargeMWh - b.lossesMWh - (b.endSocMWh - b.startSocMWh)) < 1e-6);
    // Electricity flows: what reaches the facility is what it uses.
    const into = r.flows.electricity.filter(f => f.to === 'facility').reduce((s, f) => s + f.value, 0);
    const out = r.flows.electricity.filter(f => f.from === 'facility').reduce((s, f) => s + f.value, 0);
    assert.ok(Math.abs(into - out) < 1e-6 * into);
    assert.ok(Math.abs(into - (a.loadMWh - a.unservedMWh)) < 1e-6 * into);
  });
}

test('annual PUE reproduces the cooling.js calibration at the calibration climates', () => {
  // cooling.js calibrated each technology on PVGIS TMY 12 x 24 typical days
  // for Chicago (11.3 C) and Phoenix (22.8 C). sites.js carries Phoenix and
  // New Albany OH (also 11.3 C mean dry-bulb) from the same PVGIS source.
  for (const [id, tech] of Object.entries(COOLING_TECHNOLOGIES)) {
    const hot = calculateDatacenterScenario({ siteId: 'phoenix-az', coolingTechnology: id }, { fastMode: true });
    assert.ok(Math.abs(hot.cooling.annualPue - tech.calibration.hotDesert.pue) < 0.01, `${id} Phoenix PUE ${hot.cooling.annualPue}`);
    assert.ok(Math.abs(hot.water.wueLPerKWhIT - tech.calibration.hotDesert.wueLPerKWhIT) < 0.02, `${id} Phoenix WUE ${hot.water.wueLPerKWhIT}`);
    const temperate = calculateDatacenterScenario({ siteId: 'new-albany-oh', coolingTechnology: id }, { fastMode: true });
    assert.ok(Math.abs(temperate.cooling.annualPue - tech.calibration.temperate.pue) < 0.01, `${id} temperate PUE ${temperate.cooling.annualPue}`);
    assert.ok(Math.abs(temperate.water.wueLPerKWhIT - tech.calibration.temperate.wueLPerKWhIT) < 0.03, `${id} temperate WUE`);
  }
});

test('default site: PUE is the energy ratio and sits between the calibration climates', () => {
  const r = calculateDatacenterScenario({});
  const tech = COOLING_TECHNOLOGIES[r.state.coolingTechnology];
  // Abilene (20.4 C mean) is warmer than Chicago and cooler than Phoenix.
  assert.ok(r.cooling.annualPue > tech.calibration.temperate.pue && r.cooling.annualPue < tech.calibration.hotDesert.pue);
  assert.ok(Math.abs(r.energy.facilityServedMWh / r.energy.itServedMWh - r.cooling.annualPue) < 1e-9);
  // Hand check of one hour: July 15:00 dry-bulb from sites.js through the curve.
  const site = getDatacenterSite('abilene-tx');
  const t = site.dryBulbC[6][15];
  const expected = 1 + tech.overheadFraction + (t < tech.cooling.freeCoolingBelowC ? tech.cooling.freeCoolingFraction : interpolateCurve(tech.cooling.mechanicalFractionAt, t));
  const hour = (31 + 28 + 31 + 30 + 31 + 30 + 9) * 24 + 15; // 10 July, 15:00
  assert.ok(Math.abs(r.dispatch.hourly.pue[hour] - expected) < 1e-12);
});

test('CO2 = gas fuel x 52.91 kg/MMBtu + grid imports x grid intensity', () => {
  for (const overrides of [{}, ARCHITECTURES.hybrid, ARCHITECTURES.islandedGasOnly, { gridConnection: 'flexible' }]) {
    const r = calculateDatacenterScenario(overrides, { fastMode: true });
    const a = r.dispatch.annual;
    const expected = (a.fuelMMBtu * 52.91 + a.gridMWh * r.state.gridCo2KgPerMWh) / 1000;
    assert.equal(GAS_DEFAULTS.co2KgPerMMBtu, 52.91);
    assert.ok(Math.abs(r.emissions.totalT - expected) < 1e-9 * Math.max(1, expected));
  }
  // Fuel never below the full-load heat rate, never above the 50%-load penalty
  // at the minimum stable load.
  const r = calculateDatacenterScenario(ARCHITECTURES.islandedGasOnly, { fastMode: true });
  const { gasMWh, fuelMMBtu } = r.dispatch.annual;
  assert.ok(fuelMMBtu >= gasMWh * r.state.gasHeatRateMMBtuPerMWh - 1e-6);
  assert.ok(fuelMMBtu <= gasMWh * r.state.gasHeatRateMMBtuPerMWh * (1 + 0.05 * 1.4) + 1e-6);
});

test('cooling water = WUE(h) x IT energy, split by the evaporated / blowdown shares', () => {
  const r = calculateDatacenterScenario({ siteId: 'phoenix-az', coolingTechnology: 'dlc-cooling-tower' }, { fastMode: true });
  const tech = COOLING_TECHNOLOGIES['dlc-cooling-tower'];
  const site = getDatacenterSite('phoenix-az');
  const itKW = r.load.itLoadMW * 1000;
  let litres = 0;
  site.dryBulbC.forEach((row, month) => row.forEach(t => {
    litres += interpolateCurve(tech.water.litresPerKWhITAt, t) * itKW * MONTH_DAYS[month];
  }));
  assert.equal(r.reliability.unservedMWh, 0);
  assert.ok(Math.abs(r.water.cooling.withdrawnM3 - litres / 1000) < 1e-6 * litres);
  assert.ok(Math.abs(r.water.cooling.evaporatedM3 - 0.79 * litres / 1000) < 1e-6 * litres);
  // Latent heat = evaporated litres x 0.678 kWh/L; the rest of the facility heat goes to air.
  assert.ok(Math.abs(r.heat.latentMWh - r.water.cooling.evaporatedM3 * 0.678) < 1e-6 * r.heat.latentMWh);
  assert.ok(Math.abs(r.heat.latentMWh + r.heat.sensibleMWh - r.energy.facilityServedMWh) < 1e-6);
  // Closed-loop dry coolers use no water.
  assert.equal(calculateDatacenterScenario({}, { fastMode: true }).water.withdrawnM3, 0);
});

test('islanded gas: N+1 units serve every hour; too few units leave exactly the missing energy unserved', () => {
  const nPlusOne = calculateDatacenterScenario(ARCHITECTURES.islandedGasOnly, { fastMode: true });
  assert.equal(nPlusOne.reliability.uptimePercent, 100);
  assert.equal(nPlusOne.reliability.unservedMWh, 0);
  // N = ceil(design peak / unit size); +1 spare.
  assert.equal(nPlusOne.firm.units, Math.ceil(nPlusOne.load.designPeakMW / 10) + 1);

  // 5 x 10 MW engines against a ~80 MW load: short in every hour. Each unit is
  // out round(3% x 8760) = 263 h one after another (no overlap), so the
  // plant delivers 50 MW x 8760 h - 10 MW x 5 x 263 h; the rest is unserved.
  const short = calculateDatacenterScenario({ ...ARCHITECTURES.islandedGasOnly, firmSizingMode: 'manual', firmUnits: 5 }, { fastMode: true });
  const delivered = 50 * 8760 - 10 * 5 * 263;
  assert.ok(Math.abs(short.dispatch.annual.gasMWh - delivered) < 1e-6);
  assert.ok(Math.abs(short.reliability.unservedMWh - (short.dispatch.annual.loadMWh - delivered)) < 1e-6);
  assert.equal(short.reliability.uptimePercent, 0);
});

test('a flexible connection is unavailable exactly the set number of hours', () => {
  for (const hours of [0, 40, 50, 70, 500]) {
    const r = calculateDatacenterScenario({ gridConnection: 'flexible', gridUnavailableHoursPerYear: hours, firmFamily: 'none' }, { fastMode: true });
    assert.equal(r.grid.unavailableHours, hours);
    assert.equal(r.grid.events.reduce((sum, event) => sum + event.hours, 0), hours);
    // Nothing on site: every unavailable hour goes unserved, and only those.
    assert.equal(r.reliability.unservedHours, hours);
  }
  // A reserve battery charged from the grid rides through 4-hour events.
  const withBattery = calculateDatacenterScenario(ARCHITECTURES.gridFlexibleBattery, { fastMode: true });
  assert.equal(withBattery.dispatch.batteryRole, 'reserve');
  assert.equal(withBattery.reliability.uptimePercent, 100);
  assert.ok(withBattery.dispatch.annual.gridToBatteryMWh > 0);
});

test('hybrid dispatch orders grid and gas by marginal cost', () => {
  // Recip at $4/MMBtu: 7.8 x 4 + 7.4 = $38.6/MWh < grid $67.7 -> gas first.
  const cheapGas = calculateDatacenterScenario({ architecture: 'hybrid' }, { fastMode: true });
  assert.equal(cheapGas.firm.marginalCostPerMWh, 7.8 * 4 + 7.4);
  assert.equal(cheapGas.dispatch.order, 'firm-first');
  assert.equal(cheapGas.dispatch.annual.gridMWh, 0);
  const dearGas = calculateDatacenterScenario({ architecture: 'hybrid', gasFuelPricePerMMBtu: 9 }, { fastMode: true });
  assert.equal(dearGas.dispatch.order, 'grid-first');
  assert.equal(dearGas.dispatch.annual.gasMWh, 0);
});

test('nuclear runs as must-take baseload with its refuelling outage', () => {
  const r = calculateDatacenterScenario(ARCHITECTURES.nuclearContracted, { fastMode: true });
  // Auto contract = average facility load; out (1 - 0.92) x 8760 = 700.8 -> 701 h.
  assert.ok(Math.abs(r.firm.capacityMW - r.load.meanFacilityMW) < 1e-9);
  assert.ok(Math.abs(r.dispatch.annual.nuclearMWh - r.firm.capacityMW * (8760 - 701)) < 1e-6);
  assert.equal(r.emissions.gasT, 0);
  assert.equal(r.reliability.uptimePercent, 100);
  // Islanded single SMR without enough storage: its outage hours go unserved.
  const smr = calculateDatacenterScenario({ architecture: 'islanded', firmFamily: 'nuclear', nuclearType: 'bwrx-300' }, { fastMode: true });
  assert.equal(smr.firm.units, 1);
  assert.equal(smr.reliability.unservedHours, 701);
});

test('energization = the slowest required path, from the lead-time data', () => {
  const r = calculateDatacenterScenario({});
  const firm = POWER_LEAD_TIMES['grid-firm'];
  const typical = firm.permittingMonths.typical + firm.procurementMonths.typical + firm.constructionMonths.typical;
  assert.equal(r.schedule.energizationMonth, typical); // 12 + 30 + 12 = 54
  assert.equal(r.schedule.criticalPath.id, 'grid-firm');
  assert.equal(r.schedule.energizationMonth, Math.max(...r.schedule.paths.filter(p => p.required).map(p => p.durationMonths)));
  r.schedule.paths.forEach(path => assert.equal(path.slackMonths, r.schedule.energizationMonth - path.durationMonths));
  assert.equal(r.schedule.energizationDate.label, '2031-07'); // NTP 2027-01 + 54 months
  // Standby gas on a firm grid is optional: it does not set first power.
  assert.equal(r.schedule.paths.find(p => p.id === 'gas-recip').required, false);
  const high = calculateDatacenterScenario({ scheduleCase: 'high' });
  assert.equal(high.schedule.energizationMonth, Math.max(
    firm.permittingMonths.high + firm.procurementMonths.high + firm.constructionMonths.high,
    ...high.schedule.paths.filter(p => p.required).map(p => p.durationMonths),
  ));
  // Islanded gas: the grid drops out and the gas plant becomes required.
  const islanded = calculateDatacenterScenario(ARCHITECTURES.islandedGasOnly);
  assert.ok(!islanded.schedule.paths.some(p => p.id.startsWith('grid')));
  assert.equal(islanded.schedule.paths.find(p => p.id === 'gas-recip').required, true);
  // A reactor cannot run before its earliest commercial-operation year.
  const smr = calculateDatacenterScenario({ architecture: 'islanded', firmFamily: 'nuclear', nuclearType: 'bwrx-300' });
  assert.ok(smr.schedule.energizationDate.year >= 2033);
});

test('sites.js daily solar factors: 365 days, monthly mean ~1 (rounding), no negative days', () => {
  DATACENTER_SITES.forEach(site => {
    assert.deepEqual(site.dailySolarFactor.map(month => month.length), MONTH_DAYS, site.id);
    site.dailySolarFactor.forEach(month => {
      const mean = month.reduce((a, b) => a + b, 0) / month.length;
      assert.ok(Math.abs(mean - 1) < 0.006, `${site.id} month mean ${mean}`);
      month.forEach(value => assert.ok(value >= 0));
    });
  });
});

test('TMY day-to-day variability: annual solar is conserved, the hourly cap holds, cloudy spells appear', () => {
  const size = 300;
  const r = calculateDatacenterScenario({ siteId: 'dublin-ie', architecture: 'hybrid', firmFamily: 'none', solarSizeMWdc: size });
  assert.equal(r.solar.dailyVariability, true);
  // Annual energy = MWdc x PVGIS base yield x mounting multiplier, unchanged by the daily factor.
  const target = size * r.state.siteYieldMwhPerMwdcYear * r.solar.yieldMultiplier;
  assert.ok(Math.abs(r.solar.annualMWh - target) < 1e-6 * target);
  const H = r.dispatch.hourly;
  assert.ok(Math.max(...H.solarMW) <= size + 1e-9);
  // Daily solar energy in local days; a spell of >= 3 consecutive days below
  // half the month's mean daily energy exists at a cloudy site (Dublin's TMY
  // has a 5-day spell of days below half its month's mean GHI).
  const daily = Array.from({ length: 365 }, (_, d) => H.solarMW.slice(d * 24, d * 24 + 24).reduce((a, b) => a + b, 0));
  let day = 0;
  let longest = 0;
  MONTH_DAYS.forEach(days => {
    const mean = daily.slice(day, day + days).reduce((a, b) => a + b, 0) / days;
    let run = 0;
    for (let d = day; d < day + days; d++) {
      run = daily[d] < 0.5 * mean ? run + 1 : 0;
      longest = Math.max(longest, run);
    }
    day += days;
  });
  assert.ok(longest >= 3, `longest low-solar spell ${longest} days`);
  // The daily factor moves energy between days of a month: day energies at
  // the same site differ by far more than the clear-sky geometry allows
  // (clear-sky days of one month differ by a few percent).
  const june = daily.slice(151, 181);
  assert.ok(Math.min(...june) < 0.5 * Math.max(...june));
});

test('islanded solar + battery: cloudy days now cost uptime (Abilene, 1 GWdc / 4 GWh)', () => {
  const r = calculateDatacenterScenario({ architecture: 'islanded', firmFamily: 'none', solarSizeMWdc: 1000, batteryCapacityMWh: 4000 }, { fastMode: true });
  // With clear-sky-equivalent days this design served every hour; a run of
  // overcast TMY days now drains the 4 GWh battery (~2.5 days of load).
  assert.ok(r.reliability.uptimePercent < 100, `uptime ${r.reliability.uptimePercent}`);
  assert.ok(r.reliability.uptimePercent > 99);
  assert.ok(r.reliability.longestOutageHours >= 24);
  // A larger battery restores it, monotonically.
  const bigger = calculateDatacenterScenario({ architecture: 'islanded', firmFamily: 'none', solarSizeMWdc: 1000, batteryCapacityMWh: 8000 }, { fastMode: true });
  assert.ok(bigger.reliability.uptimePercent >= r.reliability.uptimePercent);
});
