/* Right column and header: warnings, key-metric cards, the economics breakdown groups and the
   header metrics. Pure HTML builders over the datacenter result (every value escaped) plus the
   mixin that writes them into the page. */

import { formatIrrWithStatus, formatMirr } from '../formatters.js';
import { buildFinancingRows } from '../renderers/economics.js';
import { econGroup, econMetric, econRow, escapeHtml as esc } from '../renderers/markup.js';
import { fixed, formatM3, formatMonths, formatTonnes, formatUptime, formatYearMonth, money, midSentence } from './format.js';

const signClass = value => (value >= 0 ? 'positive' : 'negative');
const perMWh = value => (Number.isFinite(value) ? `$${fixed(value, 1)}/MWh` : '—');
const payback = years => (Number.isFinite(years) ? `${fixed(years, 1)} yrs` : 'not within horizon');
const PROJECT_PAYBACK_TIP = 'Years from notice-to-proceed until cumulative project cash (build, operations, GPU refreshes; salvage excluded) turns positive; also counted from first power.';
const GPU_PAYBACK_TIP = 'One GPU on its own: years after it enters service until its rental revenue (occupancy, uptime, price decline with age) less its IT O&M and its share of energy and water repays its capex. Excludes the building, cooling and power plant, so it is far shorter than the project payback.';
const afterFirstPower = e => (Number.isFinite(e.paybackAfterFirstPowerYears) ? `${fixed(e.paybackAfterFirstPowerYears, 1)} yrs after first power` : '');
/** "2.8 yrs (GPU only)", "not within its life", or null outside GPU rental. */
const gpuPaybackText = e => (!e.gpuFleet?.enabled ? null : Number.isFinite(e.gpuPaybackYears) ? `${fixed(e.gpuPaybackYears, 1)} yrs` : 'not within its life');

const REVENUE_LABELS = {
  gpuRental: 'GPU rental',
  tokens: 'Token sales',
  colocation: 'Colocation lease',
  powerPassThrough: 'Power recharged to tenant',
  export: 'Grid export',
  policyCredits: 'Policy credits',
};

export function renderWarnings(warnings = []) {
  if (!warnings.length) return '';
  return `<div class="dc-warnings" role="status"><div class="dc-warnings-title">Check this design (${warnings.length})</div><ul>${warnings.map(warning => `<li>${esc(warning.message)}</li>`).join('')}</ul></div>`;
}

export function renderKeyMetrics(r) {
  const e = r.economics;
  const rel = r.reliability;
  const itKW = r.load.itCapacityMW * 1000;
  const capexPerKW = itKW > 0 ? e.totalCapex / itKW : 0;
  const water = r.water.withdrawnM3;
  return `<div class="econ-summary-grid dc-metrics">${[
    econMetric('Annual PUE', fixed(r.cooling.annualPue, 3), '', `Peak ${fixed(r.cooling.peakPue, 2)}`, 'Facility energy / IT energy over the year at this site\'s typical-day temperatures.'),
    econMetric('Uptime achieved', formatUptime(rel.uptimePercent), rel.meetsTarget ? 'positive' : 'negative', `Target ${formatUptime(rel.targetPercent)}${rel.unservedHours > 0 ? ` · ${fixed(rel.unservedHours, 0)} h short` : ''}`, 'Share of the 8,760 hours with the full facility load served (supply adequacy only; IT and building faults are not modeled).'),
    econMetric('Delivered power cost', perMWh(e.levelized?.costOfPowerPerMWh), '', 'Levelized, per facility MWh', 'Present value of power-side capex and opex (grid, fuel, generation, storage, substation) less exports, over the present value of served facility energy.'),
    econMetric('First power', formatYearMonth(r.schedule.energizationDate), '', r.schedule.criticalPath ? `${formatMonths(r.schedule.energizationMonth)} · ${r.schedule.criticalPath.label}` : '', 'Energization: the slowest required path from notice-to-proceed.'),
    econMetric('CO₂', `${formatTonnes(r.emissions.totalT)}/yr`, '', `${fixed(r.emissions.kgPerMWhServed, 0)} kg/MWh served`, 'Grid imports x grid intensity plus gas burned x 52.91 kg/MMBtu; combustion only.'),
    econMetric('Water', `${formatM3(water)}/yr`, '', `WUE ${fixed(r.cooling.wueLPerKWhIT, 2)} L/kWh-IT`, 'Withdrawn for evaporative cooling and on-site generation; most of it evaporates.'),
    econMetric('Total CAPEX', money(e.totalCapex), '', `$${fixed(capexPerKW, 0)}/kW-IT`, 'Every installed asset, incl. IT hardware when you own it. By default construction capex is paid over the build and the IT hardware at first power (Finance section).'),
    econMetric(e.financing?.enabled ? 'Project NPV' : 'NPV', money(e.npv), signClass(e.npv), `at ${fixed(e.discountRatePercent, 1)}% over ${fixed(e.analysisHorizonYears, 0)} yrs`, 'Discounted project cash flows from notice-to-proceed, including the build years without revenue.'),
    econMetric(e.financing?.enabled ? 'Project IRR' : 'IRR', formatIrrWithStatus(e.projectIrr, e.projectIrrAnalysis), Number.isFinite(e.projectIrr) ? signClass(e.projectIrr - e.discountRatePercent) : '', 'Project, before financing', e.projectIrrAnalysis?.reason || 'Internal rate of return on project cash flows before financing.'),
    econMetric('MIRR', formatMirr(e.mirr), Number.isFinite(e.mirr) ? signClass(e.mirr - e.discountRatePercent) : '', `Finance + reinvest at ${fixed(e.discountRatePercent, 1)}%`, 'Modified IRR: always unique; above the discount rate exactly when NPV is positive.'),
    econMetric('Project payback', payback(e.paybackYears), '', Number.isFinite(e.paybackYears) ? `from start · ${afterFirstPower(e)}` : '', PROJECT_PAYBACK_TIP),
    gpuPaybackText(e) ? econMetric('GPU payback', gpuPaybackText(e), '', 'GPU only, from its first rental hour', GPU_PAYBACK_TIP) : '',
  ].join('')}</div>`;
}

function capexRows(e, r) {
  const itKW = r.load.itCapacityMW * 1000;
  const rows = e.capexItems.filter(item => item.capex > 0).flatMap(item => {
    const spread = item.paidToYear - item.paidFromYear > 0.005;
    const when = spread ? ` (years ${fixed(item.paidFromYear, 1)}–${fixed(item.paidToYear, 1)})` : item.paidAtYear > 0 ? ` (year ${fixed(item.paidAtYear, 1)})` : '';
    const tip = spread ? 'Paid evenly over its procurement and construction, finishing at first power (Finance: construction capex paid).'
      : item.paidAtYear > 0 ? 'Paid at first power, not at notice-to-proceed.' : '';
    const own = econRow(`${item.label}${when}`, money(item.capex), '', tip);
    const parts = (item.parts || []).filter(part => part.capex > 0).map(part => econRow(`  ${part.label}`, money(part.capex), 'sub'));
    return [own, ...parts];
  });
  rows.push(econRow('Total CAPEX', money(e.totalCapex), 'total'));
  if (itKW > 0) rows.push(econRow('Per kW of IT', `$${fixed(e.totalCapex / itKW, 0)}/kW`));
  return rows.join('');
}

function opexRows(e) {
  const lines = [...(e.fixedOmLines || []), ...(e.opexLines || [])].filter(line => Math.abs(line.annual) > 0.5);
  const rows = lines.map(line => econRow(line.label, money(line.annual), 'negative'));
  rows.push(econRow('Total O&M + energy (full year)', money(e.annualOM), 'total'));
  return rows.join('');
}

function revenueRows(e, r) {
  const rows = Object.entries(e.revenue || {})
    .filter(([, value]) => Number.isFinite(value) && Math.abs(value) > 0.5)
    .map(([key, value]) => econRow(REVENUE_LABELS[key] || key, money(value), 'positive'));
  rows.push(econRow('Total revenue (full year)', money(e.totalAnnualRevenue), 'total'));
  if (Number.isFinite(e.levelized?.revenuePerMWhIT)) rows.push(econRow('Revenue per IT MWh', `$${fixed(e.levelized.revenuePerMWhIT, 0)}/MWh-IT`));
  if (e.energizationYears > 0) rows.push(econRow('Operating from', `year ${fixed(e.energizationYears, 1)} (first power)`, '', 'No revenue or operating cost before energization; the first operating year is pro-rated.'));
  if (r.economics.breakEven && Number.isFinite(r.economics.breakEven.breakEvenPrice)) {
    const be = r.economics.breakEven;
    rows.push(econRow(`Break-even ${midSentence(be.label)}`, `${fixed(be.breakEvenPrice, 2)} ${be.unit}`, be.breakEvenPrice <= be.currentPrice ? 'positive' : 'warning', 'Price at which project NPV = 0 with everything else unchanged.'));
  }
  return rows.join('');
}

function unitRows(e) {
  const l = e.levelized || {};
  return [
    econRow('Delivered power cost', perMWh(l.costOfPowerPerMWh), '', 'Levelized power-side cost per served facility MWh.'),
    econRow('All-in cost per IT MWh', Number.isFinite(l.costPerMWhIT) ? `$${fixed(l.costPerMWhIT, 0)}/MWh-IT` : '—', '', 'Levelized cost of the whole project (incl. IT hardware) per IT MWh served.'),
    Number.isFinite(l.costPerMToken) && l.costPerMToken > 0 ? econRow('Cost per M tokens', `$${fixed(l.costPerMToken, 3)}`) : '',
    econRow('Levelized annual profit', money(e.levelizedAnnualProfit ?? e.annualProfit), signClass(e.levelizedAnnualProfit ?? e.annualProfit), 'NPV x capital recovery factor over the horizon.'),
    econRow('Project payback', Number.isFinite(e.paybackYears) ? `${payback(e.paybackYears)} from start${afterFirstPower(e) ? ` (${afterFirstPower(e)})` : ''}` : payback(e.paybackYears), '', PROJECT_PAYBACK_TIP),
    gpuPaybackText(e) ? econRow('GPU payback (GPU only)', gpuPaybackText(e), '', GPU_PAYBACK_TIP) : '',
  ].join('');
}

export function renderEconomicsGroups(r) {
  const e = r.economics;
  const financing = buildFinancingRows({ e });
  return [
    econGroup('Capital cost', money(e.totalCapex), capexRows(e, r)),
    econGroup('Operating cost', `${money(e.annualOM)}/yr`, opexRows(e), 'Full operating year'),
    econGroup('Revenue', `${money(e.totalAnnualRevenue)}/yr`, revenueRows(e, r), 'Full operating year'),
    econGroup('Unit economics', perMWh(e.levelized?.costOfPowerPerMWh), unitRows(e)),
    financing.length ? econGroup('Financing', `${fixed(e.financing.debtSharePercent, 0)}% debt`, financing.join('')) : '',
  ].join('');
}

export function renderHeaderMetrics(r) {
  const e = r.economics;
  const metric = (label, value, cls = '', tooltip = '') => `<div class="metric ${esc(cls)}"><div class="metric-label"${tooltip ? ` data-tooltip="${esc(tooltip)}"` : ''}>${esc(label)}</div><div class="metric-value">${esc(value)}</div></div>`;
  return [
    metric('First power', formatYearMonth(r.schedule.energizationDate), '', 'Energization: the slowest required path from notice-to-proceed.'),
    metric('CAPEX', money(e.totalCapex)),
    metric('Power cost', perMWh(e.levelized?.costOfPowerPerMWh), '', 'Levelized delivered power cost per facility MWh.'),
    metric('PUE', fixed(r.cooling.annualPue, 2)),
    metric('Uptime', formatUptime(r.reliability.uptimePercent), r.reliability.meetsTarget ? '' : 'dc-metric-bad'),
    metric('NPV', money(e.npv), e.npv >= 0 ? 'dc-metric-good' : 'dc-metric-bad'),
    metric('IRR', formatIrrWithStatus(e.projectIrr, e.projectIrrAnalysis)),
  ].join('');
}

export const resultMethods = {
  updateResultsPanel(r) {
    const keyMetrics = document.getElementById('keyMetrics');
    if (keyMetrics) keyMetrics.innerHTML = renderWarnings(r.warnings) + renderKeyMetrics(r);
    const econ = document.getElementById('econBreakdown');
    if (econ) {
      // Keep open groups open across recalculations.
      const open = new Set(Array.from(econ.querySelectorAll('details[open] .econ-group-title')).map(el => el.textContent));
      econ.innerHTML = renderEconomicsGroups(r);
      econ.querySelectorAll('details.econ-group').forEach(details => {
        if (open.has(details.querySelector('.econ-group-title')?.textContent)) details.open = true;
      });
    }
    const header = document.getElementById('headerMetrics');
    if (header) header.innerHTML = renderHeaderMetrics(r);
  },
};
