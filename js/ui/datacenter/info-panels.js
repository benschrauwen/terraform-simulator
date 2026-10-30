/* Read-only info blocks inside the left-panel sections (site, cooling, grid, solar, battery,
   revenue): data-file descriptions plus live results for the current design. Pure HTML builders;
   every value is escaped. Firm generation and architecture blocks live in firm-info.js. */

import { COOLING_TECHNOLOGIES } from '../../data/datacenter/cooling.js';
import { GRID_DEFAULTS, POWER_LEAD_TIMES } from '../../data/datacenter/power.js';
import { getDatacenterSite } from '../../state/datacenter-schema.js';
import { escapeHtml as esc } from '../renderers/markup.js';
import { fixed, formatArea, formatM3, formatMW, formatMWh, formatPercent, money, midSentence } from './format.js';
import { getGpuPlatforms } from './gpu-platforms.js';

/** One label / value row (the plant builder's .info-row look). */
export function infoRow(label, value, tooltip = '') {
  const tip = tooltip ? ` class="tooltip-label" data-tooltip="${esc(tooltip)}"` : '';
  return `<div class="info-row"><span${tip}>${esc(label)}</span><span class="highlight">${esc(value)}</span></div>`;
}

export const note = (text, cls = '') => `<div class="field-note compact-note${cls ? ` ${esc(cls)}` : ''}">${esc(text)}</div>`;

/** Typical-case months of a lead-time entry (permitting + procurement + construction). */
export function typicalLeadMonths(leadTimes, scheduleCase = 'typical') {
  return ['permittingMonths', 'procurementMonths', 'constructionMonths']
    .reduce((sum, phase) => sum + (leadTimes?.[phase]?.[scheduleCase] || 0), 0);
}

function siteInfo(state) {
  const site = getDatacenterSite(state.siteId);
  const coords = `${fixed(Math.abs(site.lat), 2)}°${site.lat >= 0 ? 'N' : 'S'}, ${fixed(Math.abs(site.lon), 2)}°${site.lon >= 0 ? 'E' : 'W'}`;
  const isUs = site.country === 'US';
  return [
    `<p class="dc-info-lead">${esc(site.why || '')}</p>`,
    infoRow('Location', coords, 'Town / county centroid of the preset; the model uses the preset\'s climate and solar data, so custom coordinates are not supported.'),
    infoRow('Grid region', site.gridRegion || '—'),
    infoRow('Solar yield', `${fixed(site.baseYield, 0)} kWh/kWp/yr`, 'PVGIS v5.3, fixed array at optimal tilt, 14% system losses.'),
    infoRow('Industrial power price', `$${fixed(site.electricityPriceAltUsdPerMWh, 1)}/MWh`, site.electricityPriceAltBasis || ''),
    infoRow('Grid CO₂', `${fixed(site.gridCo2KgPerMWh, 0)} kg/MWh`, site.gridCo2Basis || ''),
    infoRow('Mean dry / wet bulb', `${fixed(site.annualMeanDryBulbC, 1)} / ${fixed(site.annualMeanWetBulbC, 1)} °C`),
    infoRow('0.4% design dry / wet bulb', `${fixed(site.coolingDesignDryBulb04C, 1)} / ${fixed(site.coolingDesignWetBulb04C, 1)} °C`, 'Hottest 0.4% of hours in the PVGIS typical year; sets the design PUE and the size of the power connection.'),
    isUs ? '' : note('EU grid CO₂ is Ember\'s lifecycle intensity (it includes upstream emissions); US sites use eGRID direct combustion rates.'),
    site.note ? note(site.note) : '',
  ].join('');
}

function coolingInfo(state, r) {
  const tech = COOLING_TECHNOLOGIES[state.coolingTechnology];
  if (!tech) return '';
  const live = r ? [
    infoRow('Annual PUE at this site', fixed(r.cooling.annualPue, 3), 'Facility energy / IT energy over the year, from the hourly typical-day temperatures.'),
    infoRow('Peak PUE (hottest hour)', fixed(r.cooling.peakPue, 2), 'Sizes the grid connection and substation.'),
    infoRow('WUE (withdrawn)', `${fixed(r.cooling.wueLPerKWhIT, 2)} L/kWh-IT`),
    infoRow('Cooling water', `${formatM3(r.water.cooling?.withdrawnM3 || 0)}/yr`),
  ].join('') : '';
  return [
    `<p class="dc-info-lead">${esc(tech.shortDescription)}</p>`,
    infoRow('Typical use', tech.typicalUse),
    infoRow('Max rack density', `~${fixed(tech.maxRackDensityKW, 0)} kW/rack`),
    live,
    tech.heatReuse?.note ? note(`Heat reuse: ${tech.heatReuse.note}`) : '',
  ].join('');
}

function gridNote(state, r) {
  const site = getDatacenterSite(state.siteId);
  const key = state.gridConnection === 'flexible' ? 'grid-flexible' : 'grid-firm';
  const lead = typicalLeadMonths(POWER_LEAD_TIMES[key], state.scheduleCase);
  const parts = [
    `Site default price: $${fixed(site.electricityPriceAltUsdPerMWh, 1)}/MWh (${site.electricityPriceAltBasis || 'site data'}). It is an all-in average, so the demand charge starts at 0.`,
    `${POWER_LEAD_TIMES[key].label}: ~${fixed(lead, 0)} months to connect (${state.scheduleCase} case).`,
  ];
  if (state.gridConnection === 'flexible') {
    parts.push(`A flexible connection can be cut for ${GRID_DEFAULTS.flexibleUnavailableHoursRange.low}-${GRID_DEFAULTS.flexibleUnavailableHoursRange.high} h/yr in the Camus / encoord / Princeton PJM study; on-site generation or a battery must carry those hours.`);
  }
  const rows = r?.grid?.connected ? [
    infoRow('Connection size', formatMW(r.grid.importCapMW)),
    infoRow('Peak import', formatMW(r.dispatch.annual.peakGridMW)),
    infoRow('Grid energy', `${formatMWh(r.dispatch.annual.gridMWh)}/yr`),
  ].join('') : '';
  return parts.map(text => note(text)).join('') + rows;
}

function solarInfo(state, r) {
  if (!(state.solarSizeMWdc > 0)) return note('Solar is optional in hybrid and islanded designs. Add an array to cut grid energy or fuel; islanded designs can run on solar + battery alone.');
  if (!r) return '';
  const a = r.dispatch.annual;
  return [
    infoRow('Annual output', `${formatMWh(r.solar.annualMWh)}/yr`),
    infoRow('Capacity factor', formatPercent(r.solar.capacityFactor * 100)),
    infoRow('Share of load served', formatPercent(a.sharesOfServed.solar * 100)),
    infoRow('Curtailed / exported', `${formatMWh(a.curtailedMWh)} / ${formatMWh(a.exportMWh)}`),
    infoRow('Land', formatArea(r.solar.areaM2)),
    infoRow('Solar LCOE', `$${fixed(r.solar.lcoe * 1000, 1)}/MWh`, 'Levelized cost of the array\'s own output (capex, O&M, discount rate), before curtailment.'),
    note('Mounting changes reset module and BOS prices to the measured 2026 build basis for that mounting.'),
  ].join('');
}

const BATTERY_ROLES = {
  shift: 'Shifts solar or nuclear surplus into later hours; it never buys grid energy to resell.',
  reserve: 'Reserve: kept full from the grid (or spare gas) and used only when the grid or generators cannot carry the load.',
  none: '',
};

function batteryInfo(state, r) {
  if (!(state.batteryCapacityMWh > 0)) return note('Optional. Pairs with solar to cover nights, or rides through grid curtailments and gas start-ups.');
  if (!r) return '';
  const b = r.dispatch.battery;
  return [
    infoRow('Power', formatMW(b.powerMW)),
    infoRow('Effective cost', `$${fixed(b.costPerKWh, 0)}/kWh at ${fixed(state.batteryDurationHours, state.batteryDurationHours % 1 ? 1 : 0)} h`, 'Energy $/kWh + power $/kW / duration: shorter batteries carry more inverter and transformer capacity per kWh.'),
    infoRow('Full cycles', `${fixed(b.equivalentFullCyclesPerYear, 0)}/yr`),
    infoRow('Life', `${fixed(b.lifetimeYears, 1)} years`),
    infoRow('Discharged', `${formatMWh(r.dispatch.annual.batteryDischargeMWh)}/yr`),
    note(BATTERY_ROLES[r.dispatch.batteryRole] || ''),
  ].join('');
}

const REVENUE_NOTES = {
  'gpu-rental': 'You own the GPUs and rent them by the GPU-hour (neocloud model). Revenue follows occupancy and the rental price, which falls as newer GPUs ship.',
  tokens: 'You own the GPUs and sell inference tokens. Token output follows served IT energy, so a lower PUE lowers cost, not revenue.',
  colocation: 'Wholesale lease of powered space: the tenant brings and pays for the IT hardware. The lease is per kW of IT capacity per month.',
};

function revenueNote(state, r) {
  const text = REVENUE_NOTES[state.revenueBasis] || '';
  const breakEven = r?.economics?.breakEven;
  const rows = [];
  if (r?.economics?.revenue) {
    rows.push(infoRow('Year-1 revenue (full year)', money(r.economics.totalAnnualRevenue)));
  }
  if (breakEven && Number.isFinite(breakEven.breakEvenPrice)) {
    rows.push(infoRow(`Break-even ${midSentence(breakEven.label)}`, `${fixed(breakEven.breakEvenPrice, 2)} ${breakEven.unit}`, 'Price at which project NPV = 0, everything else unchanged.'));
  }
  return note(text) + rows.join('');
}

function gpuInfo(state, r) {
  const platform = getGpuPlatforms()[state.gpuPlatform];
  if (!platform) return '';
  const fleet = r?.economics?.gpuFleet;
  const rows = [
    infoRow('Typical rental (retail)', `$${fixed(platform.rentalPricePerGpuHour, 2)}/GPU-hr`, 'SemiAnalysis InferenceX retail rental price; resets the rental slider when the platform changes.'),
    platform.marketIndex ? infoRow('Market index', `$${fixed(platform.marketIndex.pricePerGpuHour, 2)}/GPU-hr (${platform.marketIndex.date})`, platform.marketIndex.source) : '',
    infoRow('Owner TCO', `$${fixed(platform.ownerTcoPerGpuHour, 2)}/GPU-hr`, 'SemiAnalysis estimate of an owner\'s all-in cost per GPU-hour.'),
    infoRow('IT power', `${fixed(platform.itKWPerGpu, 2)} kW/GPU`, `System ${fixed(platform.systemKW, 1)} kW per ${platform.gpusPerSystem} GPUs plus network and storage.`),
    infoRow('Capex', `${money(platform.capexPerGpu)}/GPU`),
  ];
  if (fleet?.enabled) rows.push(infoRow('GPUs in this design', fixed(fleet.count, 0)));
  rows.push(note('With GPU rental the IT draw follows occupancy (rented GPUs run near full power, idle ones near idle), so the utilization slider does not apply.'));
  return rows.join('');
}

export const INFO_BLOCK_RENDERERS = {
  siteInfo,
  coolingInfo,
  gridNote,
  solarInfo,
  batteryInfo,
  revenueNote,
  gpuInfo,
};
