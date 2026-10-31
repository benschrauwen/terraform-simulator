/* ============================================
   Datacenter economics
   ============================================
   Capex, opex, revenue, yearly cash flows and returns of a datacenter
   design, in the same result shape as the plant builder's economics (npv,
   irr / projectIrrAnalysis, mirr, paybackYears, yearlyCashFlows,
   cashFlowTimeline, capexItems, financing, ...), so the shared cash-flow
   table, timeline and tornado UI work on it. It reuses finance.js
   (replacement schedule, salvage, debt, IRR/MIRR) and the plant builder's
   summarizeReturns.

   Timing (years from notice-to-proceed, t0 = energization month / 12).
   Time is continuous within the annual end-of-year cash-flow grid, so NPV
   moves smoothly with the first-power date:
     capex          land at close (year 0). Construction capex (building,
                    cooling, substation, grid interconnection, generation,
                    solar, battery) with constructionCapexTiming 'spread'
                    (default): evenly over the component's procurement +
                    construction months on its schedule path (the grid
                    interconnection over the grid path's construction
                    months only: the utility's own build of the line and
                    substation, billed as it is done; permitting has no
                    capex), scheduled as late as the path's slack allows, so
                    it ends at first power (or at the path's own finish when
                    an optional component finishes later); with 'ntp' at
                    close. The IT hardware at energization t0 when
                    itCapexTiming = 'energization', else at close.
     operations     revenue and every opex line x operating fraction
                    f_y = clamp(y - t0, 0, 1) of project year y (y - 1, y]
     GPU rental     x R_y = integral of the rental-price factor over the
                    operating time of year y (gpu.js), each fleet's year
                    split at its replacement point t0 + k x life
     replacements   at exactly t0 + k x life (finance.js schedule, shifted)
     salvage        straight-line book value at the horizon N (land at cost)
     A lump paid at a fractional time tau (deferred IT, replacements) is
     booked across the two year-ends that bracket it, (ceil(tau) - tau) in
     year floor(tau) and (tau - floor(tau)) in year ceil(tau): its mean
     booking time is tau, so its present value is continuous in tau (a whole
     lump jumping a year-end would move NPV by C x r / (1 + r)^tau). A
     payment spread evenly over [a, b] is that booking integrated over the
     window (splitSpreadAcrossYears). Year-0 bookings are paid at close;
     bookings past the horizon fall in its last year, so the undiscounted
     capex is the same with either timing. Debt (financing.js): a
     construction loan drawn with the non-GPU capex and a loan per GPU
     purchase; equity cash = project cash + draws - debt service - fees.

   Paybacks: paybackYears = years from notice-to-proceed until the
   cumulative project cash (salvage excluded) turns positive;
   paybackAfterFirstPowerYears = that minus t0. gpuPaybackYears = years
   after one GPU enters service until its cumulative rental margin repays
   its own capex (gpuPayback below).
     cf_y = booked operations_y - replacements_y - deferred capex_y + [y = N] salvage
     booked operations_y = sum over operating years k of s_ky x (f_k x (revenue - opex) + (R_k - f_k) x GPU rental),
       s_ky = splitSpreadAcrossYears(k - f_k, k): year k's operating time booked
       like a spread payment, so operations and capex share one timing basis
     NPV  = -capex_close + sum_y cf_y / (1 + r)^y

   Opex lines (full year): fixed O&M (facility, cooling, IT, solar, battery,
   firm generation $/kW-yr), grid energy, grid demand charges (monthly peak
   import x $/kW-month), gas fuel, gas variable O&M, nuclear fuel + variable
   O&M on delivered output (an own reactor backs down) or the contracted PPA
   (take-or-pay on all available output), carbon price on on-site combustion
   CO2 (data/datacenter/carbon.js; not on grid imports), water.
   Revenue: GPU rental (default, model/datacenter/gpu.js) = GPUs x 8760 x
   occupancy x served share x $/GPU-hour x R_y;
   tokens = served IT MWh x M tokens/MWh-IT x $/M tokens;
   colocation = $/kW-month x IT kW x 12 x served share of IT energy, plus
   (if colocationPowerPassThrough) the energy opex recovered at cost from
   the tenant; export = exported MWh x export price. Pure; no DOM. */

import { COOLING_TECHNOLOGIES } from '../../data/datacenter/cooling.js';
import { FACILITY_DEFAULTS } from '../../data/datacenter/facility.js';
import { DATACENTER_MODEL_ASSUMPTIONS as A } from '../../data/datacenter/model-assumptions.js';
import { summarizeReturns } from '../economics.js';
import { getGpuFleet, getRentalRevenueFactor } from './gpu.js';
import { onSiteNuclearMWh } from './impacts.js';
import { pricedCo2eKgPerMMBtu } from './supply.js';
import { analyzeIRR, buildReplacementSchedule, crf } from '../finance.js';
import { buildDatacenterFinancing } from './financing.js';

/* Installed assets: { key, label, capex, lifeYears, group ('facility' |
   'it' | 'power'), timing ('close' | 'energization' | 'build'), pathId and
   paySegment ('build': procurement + construction; 'construction') of the
   schedule path a 'build' asset is paid over, annualFixedOm,
   replacementCost?, perpetual?, salvageAtCost?, parts? }. */
export function buildDatacenterAssets(state, { solar, battery, firm, backup = null, gridCapKW, substationKW, gridConnected }) {
  const itKW = state.itCapacityMW * 1000;
  const tech = COOLING_TECHNOLOGIES[state.coolingTechnology];
  const tierMultiplier = FACILITY_DEFAULTS.tierCapexMultiplier[state.facilityTier] ?? 1;
  const fleet = getGpuFleet(state);
  const facilityCapex = state.facilityCapexPerKWIT * tierMultiplier * itKW;
  const coolingCapex = state.coolingCapexPerKWIT * itKW;
  // GPU rental: GPUs x $/GPU; tokens: $/kW-IT; colocation: the tenant's.
  const itCapex = fleet.enabled ? fleet.count * fleet.capexPerGpu
    : state.revenueBasis === 'tokens' ? state.itCapexPerKW * itKW : 0;
  const itLife = fleet.enabled ? fleet.lifeYears : state.itAssetLifeYears;
  const firmKW = firm.capacityMW * 1000;
  // Construction capex paid over a schedule path (or all at close).
  const spread = state.constructionCapexTiming !== 'ntp';
  const build = (pathId, paySegment = 'build') => (spread && pathId ? { timing: 'build', pathId, paySegment } : { timing: 'close' });
  const assets = [
    { key: 'facility', label: 'Datacenter building + electrical', group: 'facility', capex: facilityCapex, lifeYears: state.facilityAssetLifeYears, annualFixedOm: facilityCapex * state.facilityOmPercent / 100, ...build('shell-fitout') },
    { key: 'land', label: 'Land', group: 'facility', capex: state.landCapexPerKWIT * itKW, lifeYears: Infinity, perpetual: true, salvageAtCost: true, annualFixedOm: 0 },
    { key: 'cooling', label: 'Cooling plant', group: 'facility', capex: coolingCapex, lifeYears: tech.assetLifeYears, annualFixedOm: coolingCapex * state.coolingOmPercent / 100, ...build('cooling') },
    {
      key: 'it', label: fleet.enabled ? `GPU servers (${fleet.label})` : 'IT hardware (GPUs, network)', group: 'it', capex: itCapex, lifeYears: itLife,
      timing: state.itCapexTiming === 'energization' ? 'energization' : 'close', annualFixedOm: itCapex * state.itOmPercent / 100,
    },
    { key: 'substation', label: 'HV substation', group: 'power', capex: state.substationCapexPerKW * substationKW, lifeYears: A.assetLifeYears.substation, annualFixedOm: 0, ...build('substation') },
    {
      key: 'gridInterconnection', label: 'Grid interconnection', group: 'power', capex: gridConnected ? state.gridInterconnectionCapexPerKW * gridCapKW : 0, lifeYears: A.assetLifeYears.gridInterconnection, annualFixedOm: 0,
      ...build(state.gridConnection === 'flexible' ? 'grid-flexible' : 'grid-firm', 'construction'),
    },
  ];
  if (solar.enabled) {
    const model = solar.model;
    assets.push({
      key: 'solar', label: 'Solar', group: 'power', capex: model.depreciableSolarCapex, replacementCost: model.solarReplacementCapex,
      lifeYears: state.solarAssetLife, annualFixedOm: model.annualSolarOm, ...build('solar'),
      parts: [
        { key: 'solarModules', label: 'Solar modules', capex: model.moduleCapex },
        { key: 'solarBos', label: 'Solar structure + install BOS', capex: model.bosCapex },
        { key: 'solarSitePrep', label: 'Site prep', capex: model.sitePrepCapex },
      ],
    });
    assets.push({ key: 'solarLand', label: 'Solar land', group: 'power', capex: model.landCapex, lifeYears: Infinity, perpetual: true, salvageAtCost: true, annualFixedOm: 0 });
  }
  if (battery.capex > 0) {
    assets.push({
      key: 'battery', label: 'Battery', group: 'power', capex: battery.capex, lifeYears: battery.lifetimeYears, annualFixedOm: battery.capex * state.batteryOmPercent / 100, ...build('battery'),
      ...(battery.powerCapex > 0 ? {
        parts: [
          { label: 'Energy (cells, racks, enclosures)', capex: battery.energyCapex },
          { label: 'Power (inverters, transformers, switchgear)', capex: battery.powerCapex },
        ],
      } : {}),
    });
  }
  if (firm.family === 'gas') {
    // At the unit size's own $/kW and fixed O&M (supply.js gasSizeFactors).
    const size = firm.sizeFactors || { capex: 1, fixedOm: 1 };
    assets.push({ key: 'gas', label: firm.label, group: 'power', capex: state.gasCapexPerKW * size.capex * firmKW, lifeYears: A.assetLifeYears.gas, annualFixedOm: state.gasFixedOmPerKWYear * size.fixedOm * firmKW, ...build(firm.typeData?.leadTimeKey) });
  }
  if (firm.family === 'nuclear') {
    assets.push({ key: 'nuclear', label: firm.label, group: 'power', capex: state.nuclearCapexPerKW * firmKW, lifeYears: A.assetLifeYears.nuclear, annualFixedOm: state.nuclearFixedOmPerKWYear * firmKW, ...build(firm.typeData?.leadTimeKey) });
  }
  // Backup diesel next to the prime supply (backup.js), at the diesel type's own costs.
  if (backup && backup.units > 0) {
    const dieselKW = backup.firm.capacityMW * 1000;
    const diesel = backup.dieselState;
    assets.push({
      key: 'backupDiesel', label: `Backup diesel (${backup.units} × ${backup.firm.unitSizeMW} MW)`, group: 'power',
      capex: diesel.gasCapexPerKW * dieselKW, lifeYears: A.assetLifeYears.gas, annualFixedOm: diesel.gasFixedOmPerKWYear * dieselKW,
      ...build(`backup-${backup.firm.typeData?.leadTimeKey}`),
    });
  }
  return assets.map(asset => ({ timing: 'close', ...asset }));
}

/* Energy, water and generation opex per full year of operation. */
export function buildOpexLines(state, { totals, monthlyPeakGridKW, water, firm, backup = null }) {
  const gasMWh = totals.gasKWh / 1000;
  const contracted = firm.family === 'nuclear' && !firm.onSite;
  // Contract: take-or-pay on all available output. Own reactor: fuel and
  // variable O&M on the energy it delivers (it backs down instead of curtailing).
  const nuclearMWh = contracted ? totals.nuclearKWh / 1000 : onSiteNuclearMWh(totals);
  const diesel = firm.family === 'gas' && firm.typeData?.fuel === 'diesel';
  const lines = [
    { key: 'gridEnergy', label: 'Grid energy', energy: true, annual: (totals.gridKWh / 1000) * state.gridEnergyPricePerMWh },
    { key: 'gridDemand', label: 'Grid demand charges', energy: true, annual: monthlyPeakGridKW.reduce((sum, kW) => sum + kW, 0) * state.gridDemandChargePerKWMonth },
    { key: 'gasFuel', label: diesel ? 'Diesel fuel' : 'Gas fuel', energy: true, annual: totals.fuelMMBtu * state.gasFuelPricePerMMBtu },
    { key: 'gasVariableOm', label: diesel ? 'Diesel generator variable O&M' : 'Gas variable O&M', energy: true, annual: firm.family === 'gas' ? gasMWh * (firm.variableOmPerMWh ?? state.gasVariableOmPerMWh) : 0 },
    { key: 'nuclearVariable', label: 'Nuclear fuel + variable O&M', energy: true, annual: firm.family === 'nuclear' && !contracted ? nuclearMWh * (state.nuclearFuelPerMWh + state.nuclearVariableOmPerMWh) : 0 },
    { key: 'nuclearPpa', label: 'Nuclear PPA', energy: true, annual: contracted ? nuclearMWh * state.nuclearPpaPricePerMWh : 0 },
    // On-site combustion CO2 (and, with priceMethaneSlip, methane slip as CO2e) x carbon
    // price; grid imports carry theirs in the power price.
    { key: 'carbonPrice', label: 'Carbon price', energy: true, annual: firm.family === 'gas' ? totals.fuelMMBtu * pricedCo2eKgPerMMBtu(state, firm.typeData) / 1000 * state.carbonPricePerTonne : 0 },
    { key: 'water', label: 'Water', energy: false, annual: water.withdrawnM3 * state.waterPricePerM3 },
  ];
  // Backup diesel: its fuel, variable O&M and carbon price at the diesel type's values.
  if (backup && backup.units > 0) {
    const diesel = backup.dieselState;
    const fuelMMBtu = totals.backupFuelMMBtu || 0;
    lines.push(
      { key: 'backupDieselFuel', label: 'Backup diesel fuel', energy: true, annual: fuelMMBtu * diesel.gasFuelPricePerMMBtu },
      { key: 'backupDieselVariableOm', label: 'Backup diesel variable O&M', energy: true, annual: (totals.backupKWh || 0) / 1000 * diesel.gasVariableOmPerMWh },
      { key: 'backupDieselCarbon', label: 'Carbon price (backup diesel)', energy: true, annual: fuelMMBtu * pricedCo2eKgPerMMBtu(state, backup.firm.typeData) / 1000 * state.carbonPricePerTonne },
    );
  }
  return lines;
}

/* GPU-hours sold per full year: GPUs x 8760 x occupancy x served share. */
export function getGpuHoursSold(state, energy) {
  const fleet = getGpuFleet(state);
  if (!fleet.enabled) return 0;
  const servedShare = energy.itDemandKWh > 0 ? energy.itServedKWh / energy.itDemandKWh : 0;
  return fleet.count * 8760 * (fleet.occupancyPercent / 100) * servedShare;
}

/* Revenue per full year of operation, by stream. */
export function buildRevenue(state, { energy, totals, opexLines }) {
  const itServedMWh = energy.itServedKWh / 1000;
  const servedShare = energy.itDemandKWh > 0 ? energy.itServedKWh / energy.itDemandKWh : 0;
  const energyOpex = opexLines.filter(line => line.energy).reduce((sum, line) => sum + line.annual, 0);
  const colocation = state.revenueBasis === 'colocation';
  const fleet = getGpuFleet(state);
  return {
    // Full year at the new-GPU price; the yearly cash flows apply the decline.
    gpuRental: fleet.enabled ? getGpuHoursSold(state, energy) * state.gpuRentalPricePerHour : 0,
    tokens: state.revenueBasis === 'tokens' ? itServedMWh * state.millionTokensPerMWhIT * state.tokenPricePerM : 0,
    colocation: colocation ? state.colocationLeasePerKWMonth * state.itCapacityMW * 1000 * 12 * servedShare : 0,
    powerPassThrough: colocation && state.colocationPowerPassThrough ? energyOpex : 0,
    export: state.gridExportEnabled ? (totals.exportKWh / 1000) * state.gridExportPricePerMWh : 0,
    policyCredits: 0,
  };
}

/* A lump paid at time tau (years after close) on the annual grid: shares
   [{ year, share }] across the year-ends bracketing tau, weighted so the
   mean booking time is tau (all of it in year tau when tau is whole). */
export function splitLumpAcrossYears(tau) {
  const lower = Math.floor(tau + 1e-9);
  const fraction = tau - lower;
  if (fraction <= 1e-9) return [{ year: lower, share: 1 }];
  return [{ year: lower, share: 1 - fraction }, { year: lower + 1, share: fraction }];
}

// Integral of a year-end's booking weight max(0, 1 - |t - year|) from -inf to t (t relative to the year).
const bookingWeightIntegral = t => (t <= -1 ? 0 : t <= 0 ? (t + 1) ** 2 / 2 : t < 1 ? 1 - (1 - t) ** 2 / 2 : 1);

/* A payment spread evenly over [start, end] (years after close) on the
   annual grid: each instant booked as splitLumpAcrossYears books it, i.e.
   [{ year, share }] with share_k = integral over the window of the booking
   weight of year-end k / window length. Mean booking time = the window's
   midpoint; a zero-length window is a lump at `end`. */
export function splitSpreadAcrossYears(start, end) {
  if (!(end - start > 1e-9)) return splitLumpAcrossYears(end);
  const shares = [];
  for (let year = Math.floor(start); year <= Math.ceil(end); year++) {
    const share = (bookingWeightIntegral(end - year) - bookingWeightIntegral(start - year)) / (end - start);
    if (share > 1e-12) shares.push({ year, share });
  }
  return shares;
}

/* The months after notice-to-proceed over which a 'build' asset is paid:
   its path's procurement + construction (paySegment 'construction': the
   construction months only), ending at first power, or at the path's own
   finish when it finishes later (negative slack); null without a path. */
export function getCapexWindowMonths(asset, schedule) {
  const path = schedule?.paths?.find(entry => entry.id === asset.pathId);
  if (!path) return null;
  const { procurementMonths = 0, constructionMonths = 0 } = path.phases;
  const months = asset.paySegment === 'construction' ? constructionMonths : procurementMonths + constructionMonths;
  const end = Math.max(path.durationMonths, schedule.energizationMonth);
  return { start: end - months, end };
}

/* GPU payback: years after one GPU enters service until its cumulative
   rental margin repays its capex, or null if not within its life. Revenue
   per year at age a = hours sold per GPU x price x (1 - decline)^a;
   operating cost per year = IT O&M (its capex x itOmPercent) + its share of
   the energy and water opex (all of it: cooling and losses serve the IT
   load). Facility, power plant and their fixed O&M are excluded: the
   project payback carries them. */
export function gpuPayback({ capexPerGpu, revenuePerYear, costPerYear, decline, lifeYears }) {
  if (!(capexPerGpu > 0) || !(revenuePerYear > 0)) return null;
  const q = 1 - decline;
  const margin = age => (q > 0 && q < 1 ? revenuePerYear * (1 - q ** age) / -Math.log(q) : revenuePerYear * age) - costPerYear * age;
  // First crossing on a monthly scan (the margin can peak and fall as prices decline), then bisection.
  const step = 1 / 12;
  for (let age = step; age <= lifeYears + 1e-9; age += step) {
    if (margin(age) < capexPerGpu) continue;
    let lo = age - step;
    let hi = age;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (margin(mid) >= capexPerGpu) hi = mid;
      else lo = mid;
    }
    return hi;
  }
  return null;
}

/* Years from close until the cumulative cash (initial outlay, then the
   yearly flows) turns non-negative, interpolated within the year; with
   `sustained`, the crossing after which it stays non-negative. 0 when it
   never goes negative, Infinity when it does not recover. finance.js's
   paybacks start from the outlay at close only, which spread capex makes
   small (or zero). */
function paybackFromClose(initialOutflow, flows, { sustained = false } = {}) {
  let cumulative = -initialOutflow;
  let invested = cumulative < 0;
  for (let i = 0; i < flows.length; i++) {
    const after = cumulative + flows[i];
    if (flows[i] > 0 && cumulative < 0 && after >= 0) {
      let forward = after;
      const holds = !sustained || flows.slice(i + 1).every(flow => (forward += flow) >= -1e-6);
      if (holds) return i + -cumulative / flows[i];
    }
    cumulative = after;
    invested ||= cumulative < 0;
  }
  return invested ? Infinity : 0;
}

/* finance.js replacement schedule with asset lives starting at energization
   (t0 years after close): each replacement falls at exactly t0 + k x life
   and is booked across the bracketing year-ends (splitLumpAcrossYears);
   salvage is measured at the horizon. Items carry the booked `cost`, the
   `share` of the replacement it is and the exact `scheduledAtYear`. */
function buildShiftedReplacementSchedule(assets, horizonYears, t0) {
  const operatingYears = horizonYears - t0;
  const base = buildReplacementSchedule(operatingYears > 0 ? operatingYears : 0, assets.map(asset => ({
    key: asset.key, label: asset.label, cost: asset.capex, replacementCost: asset.replacementCost,
    lifeYears: asset.lifeYears, salvageAtCost: asset.salvageAtCost,
  })));
  const byYear = {};
  base.entries.forEach(entry => entry.items.forEach(item => {
    const tau = t0 + item.scheduledAtYear;
    splitLumpAcrossYears(tau).forEach(({ year: bookedYear, share }) => {
      const year = Math.min(horizonYears, Math.max(1, bookedYear));
      if (!byYear[year]) byYear[year] = { year, total: 0, items: [] };
      byYear[year].total += item.cost * share;
      byYear[year].items.push({ ...item, cost: item.cost * share, fullCost: item.cost, share, scheduledAtYear: tau });
    });
  }));
  const entries = Object.values(byYear).sort((a, b) => a.year - b.year);
  return { byYear, entries, total: base.total, salvage: { ...base.salvage, year: horizonYears } };
}

/**
 * Economics of a datacenter design. `ctx`: { energy, totals,
 * monthlyPeakGridKW, water, firm, solar, battery { capex, lifetimeYears },
 * gridCapKW, substationKW, gridConnected, schedule }.
 */
export function calculateDatacenterEconomics(state, ctx) {
  const rate = state.discountRate / 100;
  const horizonYears = state.analysisHorizonYears;
  const t0 = ctx.schedule.energizationMonth / 12;
  const discount = year => Math.pow(1 + rate, -year);
  const operatingFraction = year => Math.max(0, Math.min(1, year - t0));

  const assets = buildDatacenterAssets(state, ctx);
  // When each asset's initial capex is paid: [{ year, share }] (year 0 = at
  // close) and the window { from, to } in years. Hardware bought at
  // energization is a lump at t0; 'build' assets are spread over their
  // window (getCapexWindowMonths); bookings past the horizon fall in its last year.
  const paymentsOf = asset => {
    if (asset.timing === 'energization' && t0 > 0) return { from: t0, to: t0, shares: splitLumpAcrossYears(t0) };
    const window = asset.timing === 'build' ? getCapexWindowMonths(asset, ctx.schedule) : null;
    if (!window) return { from: 0, to: 0, shares: [{ year: 0, share: 1 }] };
    const from = window.start / 12;
    const to = window.end / 12;
    return { from, to, shares: splitSpreadAcrossYears(from, to).map(({ year, share }) => ({ year: Math.min(year, horizonYears), share })) };
  };
  // Hardware due after the horizon (energization beyond it) is never bought.
  const bought = assets.filter(asset => asset.capex > 0 && !(asset.timing === 'energization' && t0 > horizonYears));
  const payments = new Map(bought.map(asset => [asset.key, paymentsOf(asset)]));
  const isDeferred = asset => payments.get(asset.key)?.shares.some(({ year }) => year > 0) ?? false;
  const deferredAssets = bought.filter(isDeferred);
  const capexByYear = {};
  bought.forEach(asset => payments.get(asset.key).shares.forEach(({ year, share }) => {
    capexByYear[year] = (capexByYear[year] || 0) + asset.capex * share;
  }));
  const deferredByYear = Object.fromEntries(Object.entries(capexByYear).filter(([year]) => Number(year) > 0));
  const capexAtClose = capexByYear[0] || 0;
  const totalCapex = bought.reduce((sum, asset) => sum + asset.capex, 0);
  const deferredCapex = totalCapex - capexAtClose;
  const round2 = value => Math.round(value * 100) / 100;
  // paidAtYear: the mean payment time (0 at close); paidFromYear / paidToYear: the window.
  const capexItems = assets.filter(asset => asset.capex > 0).map(({ key, label, capex, group, parts }) => {
    const paid = payments.get(key) || { from: 0, to: 0 };
    return {
      key, label, capex, group, paidAtYear: round2((paid.from + paid.to) / 2), paidFromYear: round2(paid.from), paidToYear: round2(paid.to),
      ...(parts ? { parts } : {}),
    };
  });

  const opexLines = buildOpexLines(state, ctx);
  const fixedOmLines = assets.filter(asset => asset.annualFixedOm > 0).map(asset => ({ key: `${asset.key}Om`, label: `${asset.label} O&M`, assetKey: asset.key, annual: asset.annualFixedOm }));
  const annualFixedOm = fixedOmLines.reduce((sum, line) => sum + line.annual, 0);
  const annualVariableOpex = opexLines.reduce((sum, line) => sum + line.annual, 0);
  const annualOM = annualFixedOm + annualVariableOpex;
  const revenue = buildRevenue(state, { ...ctx, opexLines });
  const totalAnnualRevenue = Object.values(revenue).reduce((sum, value) => sum + value, 0);

  const replacementSchedule = buildShiftedReplacementSchedule(assets, horizonYears, t0);
  // Financing (financing.js): a construction loan on the non-GPU capex as it
  // is paid, and a GPU loan per GPU purchase (the first fleet, each refresh).
  const constructionByYear = {};
  bought.filter(asset => asset.key !== 'it').forEach(asset => payments.get(asset.key).shares.forEach(({ year, share }) => {
    constructionByYear[year] = (constructionByYear[year] || 0) + asset.capex * share;
  }));
  const gpuCohorts = [];
  const itAsset = bought.find(asset => asset.key === 'it');
  if (itAsset) {
    const paid = payments.get('it');
    gpuCohorts.push({ atYears: paid.from, byYear: Object.fromEntries(paid.shares.map(({ year, share }) => [year, itAsset.capex * share])) });
  }
  replacementSchedule.entries.forEach(entry => entry.items.filter(item => item.key === 'it').forEach(item => {
    let cohort = gpuCohorts.find(other => Math.abs(other.atYears - item.scheduledAtYear) < 1e-9);
    if (!cohort) gpuCohorts.push(cohort = { atYears: item.scheduledAtYear, byYear: {} });
    cohort.byYear[entry.year] = (cohort.byYear[entry.year] || 0) + item.cost;
  }));
  const debt = buildDatacenterFinancing(state, { constructionByYear, gpuCohorts, t0, horizonYears, gpuLifeYears: itAsset?.lifeYears });
  const noDebt = { draw: 0, capitalizedInterest: 0, interest: 0, principal: 0, balloon: 0, service: 0, startBalance: 0, endBalance: 0, fee: 0 };
  const atClose = debt.byYear[0] || noDebt;
  // Sponsor cash at close: the capex paid then, less what the loans fund, plus fees.
  const equityUpfront = capexAtClose - atClose.draw + atClose.fee;
  // In the shape summarizeReturns and the shared timeline read (debtAmount = funded at close).
  const financing = {
    ...debt,
    debtAmount: atClose.draw,
    equityCapex: capexAtClose - atClose.draw,
    upfrontFee: debt.fees,
    equityUpfront,
    annualDebtService: debt.construction.annualPayment,
    termExceedsHorizon: debt.enabled && debt.balloonPayment > 1e-9,
  };

  // Operating cash is booked like capex: the operating time of year y,
  // [y - f_y, y], is a payment spread over that window (splitSpreadAcrossYears),
  // so its mean booking time is exact and revenue, opex and capex are all
  // discounted on the same basis (a year-end booking would discount a full
  // year's operations half a year late while capex is on time). Bookings
  // before year 1 (first power within the first year) fall in year 1.
  const annualGpuHoursSold = getGpuHoursSold(state, ctx.energy);
  const revenueKeys = Object.keys(revenue);
  const booked = Array.from({ length: horizonYears + 1 }, () => ({
    revenue: Object.fromEntries(revenueKeys.map(key => [key, 0])), opex: 0, gpuHours: 0, operatingYears: 0, rentalYears: 0,
  }));
  // What each year's own operating time earns and costs, before booking.
  const earned = Array.from({ length: horizonYears + 1 }, () => ({ revenue: Object.fromEntries(revenueKeys.map(key => [key, 0])), opex: 0 }));
  for (let year = 1; year <= horizonYears; year++) {
    const f = operatingFraction(year);
    if (!(f > 0)) continue;
    // Operating time weighted by the rental-price factor of the fleet in
    // service (= f outside gpu-rental mode).
    const rentalFactor = getRentalRevenueFactor(state, year, t0);
    revenueKeys.forEach(key => { earned[year].revenue[key] = revenue[key] * (key === 'gpuRental' ? rentalFactor : f); });
    earned[year].opex = annualOM * f;
    splitSpreadAcrossYears(year - f, year).forEach(({ year: bookedYear, share }) => {
      const row = booked[Math.min(horizonYears, Math.max(1, bookedYear))];
      revenueKeys.forEach(key => { row.revenue[key] += earned[year].revenue[key] * share; });
      row.opex += earned[year].opex * share;
      row.gpuHours += annualGpuHoursSold * f * share;
      row.operatingYears += f * share;
      row.rentalYears += rentalFactor * share;
    });
  }

  const yearlyCashFlows = [];
  let npv = -capexAtClose;
  let equityNpv = -equityUpfront;
  let pvOperatingYears = 0;
  let pvRentalYears = 0;
  let pvOpex = 0;
  for (let year = 1; year <= horizonYears; year++) {
    // f and the price factor describe the year's own operating time; the
    // money columns are the booked amounts.
    const f = operatingFraction(year);
    const priceFactor = f > 0 ? getRentalRevenueFactor(state, year, t0) / f : 1;
    const row = booked[year];
    pvOperatingYears += row.operatingYears * discount(year);
    pvRentalYears += row.rentalYears * discount(year);
    const yearlyRevenue = { ...row.revenue };
    const totalRevenue = Object.values(yearlyRevenue).reduce((sum, value) => sum + value, 0);
    const operatingCost = row.opex;
    const earnedOperatingCash = Object.values(earned[year].revenue).reduce((sum, value) => sum + value, 0) - earned[year].opex;
    pvOpex += operatingCost * discount(year);
    const operatingCashFlow = totalRevenue - operatingCost;
    const replacementEvent = replacementSchedule.byYear[year];
    const deferredCapexOutflow = deferredByYear[year] || 0;
    const replacementOutflow = (replacementEvent ? replacementEvent.total : 0) + deferredCapexOutflow;
    const salvageValue = year === horizonYears ? replacementSchedule.salvage.total : 0;
    const netCashFlow = operatingCashFlow - replacementOutflow + salvageValue;
    const debtEntry = debt.byYear[year] || noDebt;
    const equityCashFlow = netCashFlow + debtEntry.draw - debtEntry.service - debtEntry.fee;
    const scheduledDebtService = debtEntry.service - debtEntry.balloon;
    const previous = yearlyCashFlows[yearlyCashFlows.length - 1];
    yearlyCashFlows.push({
      year,
      operatingFraction: f,
      rentalPriceFactor: priceFactor,
      gpuHoursSold: row.gpuHours,
      // The year's own operations before booking (for reading the year's revenue and opex).
      earnedRevenue: earned[year].revenue,
      earnedOperatingCost: earned[year].opex,
      degradationFactor: 1,
      policyDurationFactor: 0,
      revenue: yearlyRevenue,
      totalRevenue,
      operatingCost,
      annualProfit: 0, // set below, once the levelized annual cost is known
      operatingCashFlow,
      replacementOutflow,
      deferredCapexOutflow,
      replacementItems: [
        ...(replacementEvent ? replacementEvent.items : []),
        ...deferredAssets.flatMap(asset => {
          const paid = payments.get(asset.key);
          const share = paid.shares.filter(entry => entry.year === year).reduce((sum, entry) => sum + entry.share, 0);
          return share > 0 ? [{
            key: asset.key, label: `${asset.label} (initial, ${asset.timing === 'energization' ? 'at energization' : 'during construction'})`, cost: asset.capex * share,
            fullCost: asset.capex, share, scheduledAtYear: round2((paid.from + paid.to) / 2), initial: true,
          }] : [];
        }),
      ],
      salvageValue,
      salvageItems: salvageValue > 0 ? replacementSchedule.salvage.items : [],
      netCashFlow,
      cumulativeOperatingCash: (previous ? previous.cumulativeOperatingCash : -capexAtClose) + operatingCashFlow,
      cumulativeNetCash: (previous ? previous.cumulativeNetCash : -capexAtClose) + netCashFlow,
      debtStartingBalance: debtEntry.startBalance,
      debtEndingBalance: debtEntry.endBalance,
      debtDraw: debtEntry.draw,
      debtCapitalizedInterest: debtEntry.capitalizedInterest,
      debtFees: debtEntry.fee,
      debtInterest: debtEntry.interest,
      debtPrincipal: debtEntry.principal,
      debtService: debtEntry.service,
      scheduledDebtService,
      balloonPayment: debtEntry.balloon,
      // Coverage on the year's own operations (not the booked amounts, which put
      // half of the horizon's last year into the year before it).
      cashAvailableForDebtService: earnedOperatingCash,
      // From first power: debt service never starts before it (financing.js).
      dscr: debt.enabled && scheduledDebtService > 1e-9 ? earnedOperatingCash / scheduledDebtService : null,
      sponsorSupportNeeded: debt.enabled && year > t0 ? Math.max(0, -equityCashFlow) : 0,
      equityCashFlow,
      cumulativeEquityCash: (previous ? previous.cumulativeEquityCash : -equityUpfront) + equityCashFlow,
    });
    npv += netCashFlow * discount(year);
    equityNpv += equityCashFlow * discount(year);
  }

  // Present values per asset (initial + replacements - salvage) and the
  // levelized annual cost, so levelized profit = NPV x CRF(r, N) exactly.
  const pvReplacements = replacementSchedule.entries.reduce((sum, entry) => sum + entry.total * discount(entry.year), 0);
  const pvSalvage = replacementSchedule.salvage.total * discount(horizonYears);
  const pvDeferred = Object.entries(deferredByYear).reduce((sum, [year, amount]) => sum + amount * discount(Number(year)), 0);
  // PV of $1 of an asset's initial capex (its share at close undiscounted).
  const initialDiscount = asset => (payments.get(asset.key)?.shares || []).reduce((sum, { year, share }) => sum + share * discount(year), 0);
  const horizonCrf = crf(rate, horizonYears);
  const pvCapital = capexAtClose + pvDeferred + pvReplacements - pvSalvage;
  const levelizedCapitalCharge = pvCapital * horizonCrf;
  const annualCost = levelizedCapitalCharge + pvOpex * horizonCrf;
  yearlyCashFlows.forEach(entry => {
    entry.annualProfit = entry.totalRevenue - annualCost;
  });

  const policy = { upfrontSupport: 0, total: 0, upfrontSupportByCapexKey: {} };
  const returns = summarizeReturns({
    rate, horizonCrf, netCapexAtClose: capexAtClose, financing, yearlyCashFlows, totalAnnualRevenue, annualCost, totalCapex: capexAtClose, policy,
  });
  // With spread capex little or nothing is paid at close (only the land), so
  // the shared "no net investment" test (year-0 flow >= 0) would call a $5B
  // build un-investable. IRR does not change when every flow moves by the same
  // time, so rate the series from its first non-zero flow (MIRR, which
  // compounds to the horizon, is fine as it is), and measure ROI against the
  // whole capex.
  const fromFirstFlow = series => series.slice(Math.max(0, series.findIndex(value => Math.abs(value) > 1e-6)));
  const projectSeries = fromFirstFlow([-capexAtClose, ...yearlyCashFlows.map(entry => entry.netCashFlow)]);
  const equitySeries = fromFirstFlow([-equityUpfront, ...yearlyCashFlows.map(entry => entry.equityCashFlow)]);
  returns.projectIrrAnalysis = analyzeIRR(projectSeries);
  returns.equityIrrAnalysis = financing.enabled ? analyzeIRR(equitySeries) : returns.projectIrrAnalysis;
  returns.projectIrr = returns.projectIrrAnalysis.irr;
  returns.equityIrr = returns.equityIrrAnalysis.irr;
  returns.irr = (financing.enabled ? returns.equityIrrAnalysis : returns.projectIrrAnalysis).irr;
  returns.irrStatus = (financing.enabled ? returns.equityIrrAnalysis : returns.projectIrrAnalysis).status;
  returns.noNetInvestment = !(totalCapex > 0);
  returns.equityPaybackYears = paybackFromClose(equityUpfront, yearlyCashFlows.map(entry => entry.equityCashFlow - entry.salvageValue));
  returns.sustainedEquityPaybackYears = paybackFromClose(equityUpfront, yearlyCashFlows.map(entry => entry.equityCashFlow - entry.salvageValue), { sustained: true });
  returns.roi = totalCapex > 0 ? (returns.finalCumulativeNetCash / totalCapex) * 100 : NaN;
  // The timeline also shows the loan draws (the shared builder has no column for them).
  returns.cashFlowTimeline.debtDraws = [atClose.draw, ...yearlyCashFlows.map(entry => entry.debtDraw)];
  returns.cashFlowTimeline.hasDebtDraws = debt.enabled && debt.drawn > 1e-9;

  // Paybacks from notice-to-proceed and from first power (salvage excluded, as summarizeReturns).
  const paybackFlows = yearlyCashFlows.map(entry => entry.netCashFlow - entry.salvageValue);
  const paybackYears = paybackFromClose(capexAtClose, paybackFlows);
  const sustainedPaybackYears = paybackFromClose(capexAtClose, paybackFlows, { sustained: true });
  const paybackAfterFirstPowerYears = Number.isFinite(paybackYears) && paybackYears >= t0 ? paybackYears - t0 : null;
  // One GPU from when it enters service (gpuPayback); null outside GPU rental.
  const gpuFleet = getGpuFleet(state);
  const energyAndWaterOpex = opexLines.reduce((sum, line) => sum + line.annual, 0);
  const gpuPaybackYears = gpuFleet.enabled && gpuFleet.count > 0 ? gpuPayback({
    capexPerGpu: gpuFleet.capexPerGpu,
    revenuePerYear: revenue.gpuRental / gpuFleet.count,
    costPerYear: gpuFleet.capexPerGpu * state.itOmPercent / 100 + energyAndWaterOpex / gpuFleet.count,
    decline: state.gpuPriceDeclinePercentPerYear / 100,
    lifeYears: gpuFleet.lifeYears,
  }) : null;

  const assetPresentValue = asset => {
    const initial = asset.capex * initialDiscount(asset);
    const replacements = replacementSchedule.entries.reduce((sum, entry) => sum + entry.items
      .filter(item => item.key === asset.key)
      .reduce((s, item) => s + item.cost * discount(entry.year), 0), 0);
    const salvage = replacementSchedule.salvage.items
      .filter(item => item.key === asset.key)
      .reduce((s, item) => s + item.value, 0) * discount(horizonYears);
    return initial + replacements - salvage;
  };
  const pvPowerCapital = assets.filter(asset => asset.group === 'power').reduce((sum, asset) => sum + assetPresentValue(asset), 0);
  const annualPowerOpex = opexLines.filter(line => line.energy).reduce((sum, line) => sum + line.annual, 0) +
    assets.filter(asset => asset.group === 'power').reduce((sum, asset) => sum + asset.annualFixedOm, 0) - revenue.export;
  const pvPowerCost = pvPowerCapital + annualPowerOpex * pvOperatingYears;
  const pvFacilityMWh = (ctx.energy.facilityServedKWh / 1000) * pvOperatingYears;
  const pvItMWh = (ctx.energy.itServedKWh / 1000) * pvOperatingYears;
  const pvAllCost = pvCapital + pvOpex;
  const annualTokensM = state.revenueBasis === 'tokens' ? (ctx.energy.itServedKWh / 1000) * state.millionTokensPerMWhIT : 0;

  // NPV is linear in the revenue price (nothing else reads it):
  // NPV(p) = NPV(p0) + (p - p0) x V, V = revenue per unit price x PV of operating years.
  const basis = state.revenueBasis;
  const servedShare = ctx.energy.itDemandKWh > 0 ? ctx.energy.itServedKWh / ctx.energy.itDemandKWh : 0;
  const npvPerUnitPrice = basis === 'gpu-rental' ? annualGpuHoursSold * pvRentalYears
    : basis === 'colocation' ? state.itCapacityMW * 1000 * 12 * servedShare * pvOperatingYears
      : annualTokensM * pvOperatingYears;
  const BREAK_EVEN = {
    'gpu-rental': { paramKey: 'gpuRentalPricePerHour', label: 'GPU rental price', unit: '$/GPU-hour' },
    tokens: { paramKey: 'tokenPricePerM', label: 'Token price', unit: '$/M tokens' },
    colocation: { paramKey: 'colocationLeasePerKWMonth', label: 'Colocation lease', unit: '$/kW-month' },
  }[basis];
  const currentPrice = state[BREAK_EVEN.paramKey];
  const breakEvenPrice = npvPerUnitPrice > 0 ? currentPrice - npv / npvPerUnitPrice : null;

  return {
    ...returns,
    paybackYears,
    sustainedPaybackYears,
    paybackAfterFirstPowerYears,
    gpuPaybackYears,
    noNetInvestment: !(totalCapex > 0),
    capexItems,
    capex: Object.fromEntries(assets.map(asset => [asset.key, asset.capex])),
    totalCapex,
    capexAtClose,
    netCapexAtClose: capexAtClose,
    // Capex paid after close. year: first year-end it is booked in; atYears:
    // first power (when energization-timed hardware is paid); byYear:
    // amounts per year-end after close (year 0 is in capexAtClose); items
    // with their payment window in years.
    deferredCapex: {
      year: Object.keys(deferredByYear).length ? Math.min(...Object.keys(deferredByYear).map(Number)) : null, atYears: t0, total: deferredCapex,
      byYear: Object.entries(deferredByYear).map(([year, total]) => ({ year: Number(year), total })).sort((a, b) => a.year - b.year),
      items: deferredAssets.map(({ key, label, capex }) => ({ key, label, capex, fromYear: payments.get(key).from, toYear: payments.get(key).to })),
    },
    assets: assets.map(({ key, label, group, capex, lifeYears, timing, annualFixedOm }) => ({ key, label, group, capex, lifeYears, timing, annualFixedOm })),
    opexLines,
    fixedOmLines,
    annualFixedOm,
    annualVariableOpex,
    annualOM,
    revenue,
    totalAnnualRevenue,
    annualOperatingCashFlow: totalAnnualRevenue - annualOM,
    annualCost,
    levelizedAnnualCost: annualCost,
    levelizedCapitalCharge,
    levelizedAnnualProfit: returns.annualProfit,
    horizonCrf,
    replacementSchedule: replacementSchedule.entries,
    totalReplacementOutflows: replacementSchedule.total,
    salvageValue: replacementSchedule.salvage.total,
    salvageItems: replacementSchedule.salvage.items,
    policy,
    npv,
    equityNpv,
    discountRatePercent: state.discountRate,
    analysisHorizonYears: horizonYears,
    yearlyCashFlows,
    energizationYears: t0,
    operatingYearsPresentValue: pvOperatingYears,
    annualTokensM,
    annualGpuHoursSold,
    // GPU-hours sold over the horizon: GPUs x occupancy x served share x hours operating.
    totalGpuHoursSold: yearlyCashFlows.reduce((sum, entry) => sum + entry.gpuHoursSold, 0),
    gpuFleet,
    levelized: {
      costOfPowerPerMWh: pvFacilityMWh > 0 ? pvPowerCost / pvFacilityMWh : 0,
      costPerMWhIT: pvItMWh > 0 ? pvAllCost / pvItMWh : 0,
      costPerMToken: annualTokensM > 0 ? pvAllCost / (annualTokensM * pvOperatingYears) : 0,
      // Cost per GPU-hour sold (all costs; before the rental-price decline).
      costPerGpuHour: annualGpuHoursSold > 0 ? pvAllCost / (annualGpuHoursSold * pvOperatingYears) : 0,
      revenuePerMWhIT: ctx.energy.itServedKWh > 0 ? totalAnnualRevenue / (ctx.energy.itServedKWh / 1000) : 0,
    },
    breakEven: {
      ...BREAK_EVEN,
      currentPrice,
      breakEvenPrice,
      npvPerUnitPrice,
      ratioToCurrent: breakEvenPrice !== null && currentPrice > 0 ? breakEvenPrice / currentPrice : null,
    },
  };
}
