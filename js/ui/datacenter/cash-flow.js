/* Datacenter settings for the shared yearly cash-flow table and economics timeline:
   column tooltips, CSV header rows and file name, and the timeline's cost wording. */

import { getDatacenterSite } from '../../state/datacenter-schema.js';

export const DATACENTER_CASH_FLOW_TOOLTIPS = {
  marketRevenue: 'Revenue from GPU rental, tokens or the colocation lease (plus any export), pro-rated in the year of first power; nothing before energization.',
  policyCredits: 'No incentive schemes are modeled for the datacenter.',
  operatingCost: 'Fixed O&M plus grid energy and demand charges, fuel, nuclear fuel or PPA, and water, from first power.',
  replacementCapex: 'IT hardware bought at first power, plus scheduled replacements (GPUs, batteries, cooling plant) inside the horizon.',
  salvage: 'Straight-line residual value of every asset (land at cost), returned in the final year.',
  netCashFlow: 'Project cash flow before financing. Year 0 is the capex at notice-to-proceed.',
  discountFactor: '1 / (1 + discount rate)^year.',
  discountedCashFlow: 'Net cash flow x discount factor.',
  cumulativeDiscountedCashFlow: 'Running sum of discounted cash flow; the final-year value is the project NPV.',
  debtService: 'Interest plus principal (and any balloon) on the project debt.',
  equityCashFlow: 'Net cash flow after debt service. Year 0 is the sponsor cash at close (equity share plus financing fee).',
};

export const DATACENTER_TIMELINE_TEXT = {
  operating: 'O&M and energy (grid, fuel, water)',
  operatingLegend: 'O&M + energy',
  replacementLegend: 'Deferred + replacement CAPEX',
  replacementNote: 'hardware bought at first power and scheduled replacements',
};

/** Key/value rows heading the CSV: the scenario's main inputs and a link that reopens it. */
export function buildDatacenterCsvHeader(r, shareUrl) {
  const s = r.state;
  const e = r.economics;
  const be = e.breakEven;
  return [
    ['Abundance Stack datacenter power & cooling', 'Yearly project cash flows'],
    ['Generated', new Date().toISOString()],
    ['Scenario link', shareUrl],
    ['Site', getDatacenterSite(s.siteId).name],
    ['IT capacity (MW)', s.itCapacityMW],
    ['Cooling', r.cooling.label],
    ['Power architecture', s.architecture],
    ['Solar (MWdc)', s.solarSizeMWdc],
    ['Battery (MWh)', s.batteryCapacityMWh],
    ['Firm generation', r.firm.capacityMW > 0 ? `${r.firm.label}, ${r.firm.units} x ${r.firm.unitSizeMW} MW` : 'none'],
    ['Revenue basis', s.revenueBasis],
    be ? [`${be.label} (${be.unit})`, be.currentPrice] : null,
    ['First power', r.schedule.energizationDate?.label],
    ['Discount rate (%)', e.discountRatePercent],
    ['Analysis horizon (years)', e.yearlyCashFlows.length],
    ['Debt financing', e.financing.enabled ? `${e.financing.debtSharePercent}% debt` : 'off'],
    ['Total CAPEX ($)', e.totalCapex],
    ['Project NPV ($)', e.npv],
    ['Sign convention', 'outflows negative; year 0 = capex at notice-to-proceed'],
  ].filter(Boolean);
}
