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
     capex          at close (year 0); the IT hardware at energization t0
                    when itCapexTiming = 'energization'
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
     lump jumping a year-end would move NPV by C x r / (1 + r)^tau).
     cf_y = f_y x (revenue - opex) + (R_y - f_y) x GPU rental - replacements_y - deferred capex_y + [y = N] salvage
     NPV  = -capex_close + sum_y cf_y / (1 + r)^y

   Opex lines (full year): fixed O&M (facility, cooling, IT, solar, battery,
   firm generation $/kW-yr), grid energy, grid demand charges (monthly peak
   import x $/kW-month), gas fuel, gas variable O&M, nuclear fuel + variable
   O&M on delivered output (an own reactor backs down) or the contracted PPA
   (take-or-pay on all available output), water.
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
import { buildFinancingModel, buildReplacementSchedule, crf } from '../finance.js';

/* Installed assets: { key, label, capex, lifeYears, group ('facility' |
   'it' | 'power'), timing ('close' | 'energization'), annualFixedOm,
   replacementCost?, perpetual?, salvageAtCost?, parts? }. */
export function buildDatacenterAssets(state, { solar, battery, firm, gridCapKW, substationKW, gridConnected }) {
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
  const assets = [
    { key: 'facility', label: 'Datacenter building + electrical', group: 'facility', capex: facilityCapex, lifeYears: state.facilityAssetLifeYears, annualFixedOm: facilityCapex * state.facilityOmPercent / 100 },
    { key: 'land', label: 'Land', group: 'facility', capex: state.landCapexPerKWIT * itKW, lifeYears: Infinity, perpetual: true, salvageAtCost: true, annualFixedOm: 0 },
    { key: 'cooling', label: 'Cooling plant', group: 'facility', capex: coolingCapex, lifeYears: tech.assetLifeYears, annualFixedOm: coolingCapex * state.coolingOmPercent / 100 },
    {
      key: 'it', label: fleet.enabled ? `GPU servers (${fleet.label})` : 'IT hardware (GPUs, network)', group: 'it', capex: itCapex, lifeYears: itLife,
      timing: state.itCapexTiming === 'energization' ? 'energization' : 'close', annualFixedOm: itCapex * state.itOmPercent / 100,
    },
    { key: 'substation', label: 'HV substation', group: 'power', capex: state.substationCapexPerKW * substationKW, lifeYears: A.assetLifeYears.substation, annualFixedOm: 0 },
    { key: 'gridInterconnection', label: 'Grid interconnection', group: 'power', capex: gridConnected ? state.gridInterconnectionCapexPerKW * gridCapKW : 0, lifeYears: A.assetLifeYears.gridInterconnection, annualFixedOm: 0 },
  ];
  if (solar.enabled) {
    const model = solar.model;
    assets.push({
      key: 'solar', label: 'Solar', group: 'power', capex: model.depreciableSolarCapex, replacementCost: model.solarReplacementCapex,
      lifeYears: state.solarAssetLife, annualFixedOm: model.annualSolarOm,
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
      key: 'battery', label: 'Battery', group: 'power', capex: battery.capex, lifeYears: battery.lifetimeYears, annualFixedOm: battery.capex * state.batteryOmPercent / 100,
      ...(battery.powerCapex > 0 ? {
        parts: [
          { label: 'Energy (cells, racks, enclosures)', capex: battery.energyCapex },
          { label: 'Power (inverters, transformers, switchgear)', capex: battery.powerCapex },
        ],
      } : {}),
    });
  }
  if (firm.family === 'gas') {
    assets.push({ key: 'gas', label: firm.label, group: 'power', capex: state.gasCapexPerKW * firmKW, lifeYears: A.assetLifeYears.gas, annualFixedOm: state.gasFixedOmPerKWYear * firmKW });
  }
  if (firm.family === 'nuclear') {
    assets.push({ key: 'nuclear', label: firm.label, group: 'power', capex: state.nuclearCapexPerKW * firmKW, lifeYears: A.assetLifeYears.nuclear, annualFixedOm: state.nuclearFixedOmPerKWYear * firmKW });
  }
  return assets.map(asset => ({ timing: 'close', ...asset }));
}

/* Energy, water and generation opex per full year of operation. */
export function buildOpexLines(state, { totals, monthlyPeakGridKW, water, firm }) {
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
    { key: 'gasVariableOm', label: diesel ? 'Diesel generator variable O&M' : 'Gas variable O&M', energy: true, annual: firm.family === 'gas' ? gasMWh * state.gasVariableOmPerMWh : 0 },
    { key: 'nuclearVariable', label: 'Nuclear fuel + variable O&M', energy: true, annual: firm.family === 'nuclear' && !contracted ? nuclearMWh * (state.nuclearFuelPerMWh + state.nuclearVariableOmPerMWh) : 0 },
    { key: 'nuclearPpa', label: 'Nuclear PPA', energy: true, annual: contracted ? nuclearMWh * state.nuclearPpaPricePerMWh : 0 },
    { key: 'water', label: 'Water', energy: false, annual: water.withdrawnM3 * state.waterPricePerM3 },
  ];
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
  // Hardware bought at energization is paid at t0, booked across the
  // bracketing year-ends (a share in year 0 is paid at close).
  const deferredYear = Math.floor(t0);
  const isDeferred = asset => asset.timing === 'energization' && t0 > 0;
  // Hardware due after the horizon (energization beyond it) is never bought.
  const deferredAssets = assets.filter(asset => isDeferred(asset) && asset.capex > 0 && t0 <= horizonYears);
  const deferredTotal = deferredAssets.reduce((sum, asset) => sum + asset.capex, 0);
  const deferredSplit = splitLumpAcrossYears(t0);
  const deferredByYear = {};
  deferredSplit.forEach(({ year, share }) => { deferredByYear[year] = deferredTotal * share; });
  const capexAtClose = assets.filter(asset => !isDeferred(asset)).reduce((sum, asset) => sum + asset.capex, 0) + (deferredByYear[0] || 0);
  const deferredCapex = deferredTotal - (deferredByYear[0] || 0);
  const totalCapex = capexAtClose + deferredCapex;
  const paidAtYear = Math.round(t0 * 100) / 100;
  const capexItems = assets.filter(asset => asset.capex > 0).map(({ key, label, capex, group, timing, parts }) => ({
    key, label, capex, group, paidAtYear: isDeferred({ timing }) ? paidAtYear : 0, ...(parts ? { parts } : {}),
  }));

  const opexLines = buildOpexLines(state, ctx);
  const fixedOmLines = assets.filter(asset => asset.annualFixedOm > 0).map(asset => ({ key: `${asset.key}Om`, label: `${asset.label} O&M`, assetKey: asset.key, annual: asset.annualFixedOm }));
  const annualFixedOm = fixedOmLines.reduce((sum, line) => sum + line.annual, 0);
  const annualVariableOpex = opexLines.reduce((sum, line) => sum + line.annual, 0);
  const annualOM = annualFixedOm + annualVariableOpex;
  const revenue = buildRevenue(state, { ...ctx, opexLines });
  const totalAnnualRevenue = Object.values(revenue).reduce((sum, value) => sum + value, 0);

  const replacementSchedule = buildShiftedReplacementSchedule(assets, horizonYears, t0);
  const financing = buildFinancingModel(state, capexAtClose);

  const yearlyCashFlows = [];
  let npv = -capexAtClose;
  let equityNpv = -financing.equityUpfront;
  let pvOperatingYears = 0;
  let pvRentalYears = 0;
  let pvOpex = 0;
  const annualGpuHoursSold = getGpuHoursSold(state, ctx.energy);
  for (let year = 1; year <= horizonYears; year++) {
    const f = operatingFraction(year);
    pvOperatingYears += f * discount(year);
    // Operating time of the year weighted by the rental-price factor of the
    // fleet in service (= f outside gpu-rental mode).
    const rentalFactor = getRentalRevenueFactor(state, year, t0);
    const priceFactor = f > 0 ? rentalFactor / f : 1;
    pvRentalYears += rentalFactor * discount(year);
    const yearlyRevenue = Object.fromEntries(Object.entries(revenue).map(([key, value]) => [key, value * (key === 'gpuRental' ? rentalFactor : f)]));
    const totalRevenue = Object.values(yearlyRevenue).reduce((sum, value) => sum + value, 0);
    const operatingCost = annualOM * f;
    pvOpex += operatingCost * discount(year);
    const operatingCashFlow = totalRevenue - operatingCost;
    const replacementEvent = replacementSchedule.byYear[year];
    const deferredCapexOutflow = deferredAssets.length ? deferredByYear[year] || 0 : 0;
    const replacementOutflow = (replacementEvent ? replacementEvent.total : 0) + deferredCapexOutflow;
    const salvageValue = year === horizonYears ? replacementSchedule.salvage.total : 0;
    const netCashFlow = operatingCashFlow - replacementOutflow + salvageValue;
    const debtEntry = financing.byYear[year] || { startingBalance: 0, endingBalance: 0, interest: 0, principalPaid: 0, debtService: 0, scheduledDebtService: 0, balloonPayment: 0 };
    const equityCashFlow = netCashFlow - debtEntry.debtService;
    const scheduledDebtService = debtEntry.scheduledDebtService ?? debtEntry.debtService;
    const previous = yearlyCashFlows[yearlyCashFlows.length - 1];
    yearlyCashFlows.push({
      year,
      operatingFraction: f,
      rentalPriceFactor: priceFactor,
      gpuHoursSold: annualGpuHoursSold * f,
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
        ...(deferredCapexOutflow > 0 ? deferredAssets.map(asset => ({
          key: asset.key, label: `${asset.label} (initial, at energization)`, cost: asset.capex * deferredCapexOutflow / deferredTotal,
          fullCost: asset.capex, share: deferredCapexOutflow / deferredTotal, scheduledAtYear: t0, initial: true,
        })) : []),
      ],
      salvageValue,
      salvageItems: salvageValue > 0 ? replacementSchedule.salvage.items : [],
      netCashFlow,
      cumulativeOperatingCash: (previous ? previous.cumulativeOperatingCash : -capexAtClose) + operatingCashFlow,
      cumulativeNetCash: (previous ? previous.cumulativeNetCash : -capexAtClose) + netCashFlow,
      debtStartingBalance: debtEntry.startingBalance,
      debtEndingBalance: debtEntry.endingBalance,
      debtInterest: debtEntry.interest,
      debtPrincipal: debtEntry.principalPaid,
      debtService: debtEntry.debtService,
      balloonPayment: debtEntry.balloonPayment || 0,
      cashAvailableForDebtService: operatingCashFlow,
      dscr: financing.enabled && scheduledDebtService > 1e-9 ? operatingCashFlow / scheduledDebtService : null,
      sponsorSupportNeeded: financing.enabled ? Math.max(0, -equityCashFlow) : 0,
      equityCashFlow,
      cumulativeEquityCash: (previous ? previous.cumulativeEquityCash : -financing.equityUpfront) + equityCashFlow,
    });
    npv += netCashFlow * discount(year);
    equityNpv += equityCashFlow * discount(year);
  }

  // Present values per asset (initial + replacements - salvage) and the
  // levelized annual cost, so levelized profit = NPV x CRF(r, N) exactly.
  const pvReplacements = replacementSchedule.entries.reduce((sum, entry) => sum + entry.total * discount(entry.year), 0);
  const pvSalvage = replacementSchedule.salvage.total * discount(horizonYears);
  const pvDeferred = deferredAssets.length
    ? Object.entries(deferredByYear).filter(([year]) => Number(year) > 0).reduce((sum, [year, amount]) => sum + amount * discount(Number(year)), 0)
    : 0;
  // PV of $1 of an energization-timed asset (its share at close undiscounted).
  const deferredDiscount = deferredSplit.reduce((sum, { year, share }) => sum + share * discount(year), 0);
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

  const assetPresentValue = asset => {
    const initial = asset.capex * (isDeferred(asset) ? deferredDiscount : 1);
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
    capexItems,
    capex: Object.fromEntries(assets.map(asset => [asset.key, asset.capex])),
    totalCapex,
    capexAtClose,
    netCapexAtClose: capexAtClose,
    // year: first year-end it is booked in; atYears: exact payment time;
    // byYear: amounts per year-end (year 0 = paid at close, in capexAtClose).
    deferredCapex: {
      year: deferredYear, atYears: t0, total: deferredCapex,
      byYear: deferredAssets.length ? deferredSplit.map(({ year }) => ({ year, total: deferredByYear[year] })) : [],
      items: deferredAssets.map(({ key, label, capex }) => ({ key, label, capex })),
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
    gpuFleet: getGpuFleet(state),
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
