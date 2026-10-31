/* Sites page cards: one optimized site per card, as HTML strings (pure; no DOM).
   renderSiteCard({ site, survey, result, rank, href, maxFootprintM2 }) shows the
   site's inputs that drive the design, the core financials, the winning design
   and how the three architectures compare, a typical-day dispatch (a small SVG
   using the main dispatch chart's series and colours) and the plant layout to
   scale (plant-layout.js at card size). `result` is the full scenario of the
   winning design; `survey` is optimizeForSite's output. */

import { ARCHITECTURES } from '../../data/datacenter/power.js';
import { escapeAttribute as attr, escapeHtml as esc } from '../renderers/markup.js';
import { DISPATCH_SERIES } from './dispatch-chart.js';
import { fixed, formatArea, formatMW, formatPercent, formatStorageMWh, formatTonnes, formatUptime, formatYearMonth, money } from './format.js';
import { buildPlantLayout, renderPlantLayoutSvg } from './plant-layout.js';

export const DISPATCH_MINI_SIZE = Object.freeze({ width: 320, height: 132, padLeft: 46, padRight: 12, padTop: 8, padBottom: 18 });
export const SITE_LAYOUT_SIZE = Object.freeze({ width: 420, maxHeight: 220 });

const SHORT_ARCHITECTURE = { grid: 'Grid', hybrid: 'Hybrid', islanded: 'Islanded' };
const r1 = value => Math.round(value * 10) / 10;

const isNum = value => typeof value === 'number' && Number.isFinite(value);
const years = value => (isNum(value) ? `${fixed(value, 1)} yr` : 'never');
const percentOrDash = value => (isNum(value) ? formatPercent(value, 1) : '—');

/** Hourly series of the average typical day: { hours, series: { key: number[] }, load: number[] }. */
export function averageDayDispatch(dispatch) {
  const days = dispatch?.typicalDays;
  if (!days) return null;
  const pick = key => Array.from(days[key]?.average || new Array(24).fill(0));
  return {
    series: Object.fromEntries(DISPATCH_SERIES.map(({ key }) => [key, pick(key)])),
    load: pick('loadMW'),
  };
}

/** Stacked hourly bars (supply above zero, surplus below) and the load line, as SVG markup. */
export function renderDispatchMiniSvg(dispatch, size = DISPATCH_MINI_SIZE) {
  const data = averageDayDispatch(dispatch);
  if (!data) return '';
  const { width, height, padLeft, padRight, padTop, padBottom } = { ...DISPATCH_MINI_SIZE, ...size };
  const active = DISPATCH_SERIES.filter(({ key }) => data.series[key].some(value => Math.abs(value) > 1e-6));
  let top = Math.max(...data.load, 0);
  let bottom = 0;
  for (let h = 0; h < 24; h++) {
    let up = 0;
    let down = 0;
    active.forEach(({ key, sign }) => { if (sign > 0) up += data.series[key][h]; else down += data.series[key][h]; });
    top = Math.max(top, up);
    bottom = Math.max(bottom, down);
  }
  if (top + bottom <= 0) return '';
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;
  const yOf = mw => padTop + ((top - mw) / (top + bottom)) * plotH;
  const barW = plotW / 24;
  const rects = [];
  for (let h = 0; h < 24; h++) {
    let up = 0;
    let down = 0;
    active.forEach(({ key, sign, color, label }) => {
      const value = data.series[key][h];
      if (value <= 1e-6) return;
      const from = sign > 0 ? up : -down;
      const to = sign > 0 ? up + value : -(down + value);
      if (sign > 0) up += value; else down += value;
      const y = Math.min(yOf(from), yOf(to));
      rects.push(`<rect x="${r1(padLeft + h * barW + 0.5)}" y="${r1(y)}" width="${r1(barW - 1)}" height="${r1(Math.abs(yOf(to) - yOf(from)))}" fill="${attr(color)}"><title>${esc(`${String(h).padStart(2, '0')}:00 ${label}: ${formatMW(value)}`)}</title></rect>`);
    });
  }
  const loadPath = data.load.map((mw, h) => `${h === 0 ? 'M' : 'L'}${r1(padLeft + h * barW)} ${r1(yOf(mw))} L${r1(padLeft + (h + 1) * barW)} ${r1(yOf(mw))}`).join(' ');
  const zero = yOf(0);
  const ticks = [0, 6, 12, 18, 24].map(h => `<text class="sd-axis" x="${r1(padLeft + h * barW)}" y="${height - 4}" text-anchor="${h === 24 ? 'end' : 'middle'}">${String(h).padStart(2, '0')}:00</text>`).join('');
  return `<svg class="site-dispatch-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Typical-day dispatch, averaged over the year">
    <text class="sd-axis" x="${padLeft - 4}" y="${r1(padTop + 8)}" text-anchor="end">${esc(formatMW(top))}</text>
    ${bottom > 0 ? `<text class="sd-axis" x="${padLeft - 4}" y="${r1(height - padBottom)}" text-anchor="end">−${esc(formatMW(bottom))}</text>` : ''}
    ${rects.join('')}
    <line class="sd-zero" x1="${padLeft}" y1="${r1(zero)}" x2="${width - padRight}" y2="${r1(zero)}"></line>
    <path class="sd-load" d="${loadPath}"><title>Facility load</title></path>
    ${ticks}
  </svg>`;
}

/** Legend for the series present in the average day. */
export function renderDispatchLegend(dispatch) {
  const data = averageDayDispatch(dispatch);
  if (!data) return '';
  return `<ul class="site-dispatch-legend">${DISPATCH_SERIES
    .filter(({ key }) => data.series[key].some(value => Math.abs(value) > 1e-6))
    .map(({ label, color }) => `<li><svg class="sd-swatch" viewBox="0 0 10 10" aria-hidden="true"><rect width="10" height="10" rx="2" fill="${attr(color)}"></rect></svg>${esc(label)}</li>`)
    .join('')}<li><svg class="sd-swatch" viewBox="0 0 10 10" aria-hidden="true"><line class="sd-load" x1="0" y1="5" x2="10" y2="5"></line></svg>Facility load</li></ul>`;
}

/** "Gas 62% · Grid 30% · Solar 8%" from the year's shares of served load. */
export function servedSharesText(r) {
  const shares = r.dispatch?.annual?.sharesOfServed || {};
  const names = { solar: 'Solar', nuclear: 'Nuclear', grid: 'Grid', gas: r.firm?.fuel === 'Diesel' ? 'Diesel' : 'Gas', battery: 'Battery' };
  return Object.entries(shares)
    .filter(([, share]) => share > 0.0005)
    .sort((a, b) => b[1] - a[1])
    .map(([source, share]) => `${names[source] || source} ${formatPercent(share * 100, share < 0.01 ? 1 : 0)}`)
    .join(' · ');
}

/** One-line description of the winning design. */
export function designSummary(r) {
  const s = r.state;
  const parts = [];
  if (r.grid?.connected) parts.push(`${s.gridConnection === 'flexible' ? 'Flexible' : 'Firm'} grid connection`);
  else parts.push('No grid');
  parts.push(s.solarSizeMWdc > 0 ? `${formatMW(s.solarSizeMWdc)}dc solar` : 'no solar');
  parts.push(s.batteryCapacityMWh > 0 ? `${formatStorageMWh(s.batteryCapacityMWh)} battery` : 'no battery');
  if (r.firm?.units > 0) parts.push(`${r.firm.units} × ${formatMW(r.firm.unitSizeMW)} ${r.firm.label.toLowerCase()}`);
  else parts.push('no on-site generation');
  return parts.join(' · ');
}

/** Site inputs that drive the choice: solar yield, grid price and CO₂, carbon price, hot-day temperature. */
export function siteDriversText(site, state) {
  return [
    `Solar ${fixed(state.siteYieldMwhPerMwdcYear, 0)} kWh/kWp`,
    `grid ${fixed(state.gridEnergyPricePerMWh, 0)} $/MWh`,
    `${fixed(state.gridCo2KgPerMWh, 0)} kg CO₂/MWh`,
    state.carbonPricePerTonne > 0 ? `carbon ${fixed(state.carbonPricePerTonne, 0)} $/t` : 'no carbon price',
    `hot day ${fixed(site.coolingDesignDryBulb04C, 0)} °C`,
  ].join(' · ');
}

/** Compact legend: every block's number, name and area (the small ones show only their number). */
export function renderFootprintLegend(layout) {
  if (!layout.blocks.length) return '';
  return `<ol class="site-footprint-legend">${layout.blocks.map(block => `<li class="pl-${attr(block.key)}"><span class="pl-swatch" aria-hidden="true"></span><span class="sfl-num">${block.number}</span><span class="sfl-name">${esc(block.name)}</span><span class="sfl-area">${esc(formatArea(block.areaM2))}</span></li>`).join('')}</ol>`;
}

function metric(label, value, cls = '', title = '') {
  return `<div class="site-metric ${attr(cls)}"${title ? ` title="${attr(title)}"` : ''}><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`;
}

function financials(r) {
  const e = r.economics;
  const breakEven = e.breakEven;
  const rows = [
    metric('NPV', money(e.npv), e.npv >= 0 ? 'is-good' : 'is-bad'),
    metric('Project IRR', percentOrDash(e.projectIrr)),
  ];
  if (e.financing?.enabled) rows.push(metric('Equity IRR', percentOrDash(e.equityIrr)));
  rows.push(
    breakEven && isNum(breakEven.breakEvenPrice)
      ? metric('Break-even', `${fixed(breakEven.breakEvenPrice, 2)} ${breakEven.unit}`, '', `${breakEven.label} at which NPV = 0 (now ${fixed(breakEven.currentPrice, 2)})`)
      : '',
    metric('CAPEX', money(e.totalCapex)),
    metric('Power cost', isNum(e.levelized?.costOfPowerPerMWh) ? `${fixed(e.levelized.costOfPowerPerMWh, 0)} $/MWh` : '—', '', 'Levelized delivered power cost per facility MWh'),
    isNum(e.gpuPaybackYears) ? metric('GPU payback', years(e.gpuPaybackYears)) : '',
    metric('Payback after first power', years(e.paybackAfterFirstPowerYears)),
    metric('First power', formatYearMonth(r.schedule.energizationDate), '', r.schedule.criticalPath?.label ? `Critical path: ${r.schedule.criticalPath.label}` : ''),
    metric('CO₂e', `${formatTonnes(r.emissions.totalCo2eT)}/yr`, 'dc-metric-keepcase'),
    metric('Uptime', formatUptime(r.reliability.uptimePercent), r.reliability.meetsTarget ? '' : 'is-bad'),
  );
  return `<dl class="site-metrics">${rows.join('')}</dl>`;
}

function architectureComparison(survey) {
  const items = survey.architectures.map(row => {
    const best = row.architecture === survey.bestArchitecture;
    const value = isNum(row.npv) ? money(row.npv) : '—';
    const detail = [row.feasible === false ? 'misses uptime' : '', row.firstPower ? formatYearMonth(row.firstPower) : ''].filter(Boolean).join(', ');
    return `<li class="site-arch${best ? ' is-best' : ''}${row.feasible === false ? ' is-infeasible' : ''}" data-architecture="${attr(row.architecture)}">
        <span class="site-arch-name">${esc(SHORT_ARCHITECTURE[row.architecture] || row.architecture)}</span>
        <span class="site-arch-npv">${esc(value)}</span>
        <span class="site-arch-detail">${esc(detail)}</span>
      </li>`;
  }).join('');
  return `<ul class="site-archs" aria-label="Best NPV per architecture">${items}</ul>`;
}

/** Placeholder card while a site is still being optimized (or failed). */
export function renderPendingSiteCard(site, status = 'Waiting…') {
  return `<article class="site-card is-pending" data-site-id="${attr(site.id)}">
    <header class="site-card-head"><h2 class="site-card-title">${esc(site.name)}</h2><span class="site-card-status">${esc(status)}</span></header>
  </article>`;
}

/** The full card for an optimized site. maxFootprintM2 scales the footprint bar across cards. */
export function renderSiteCard({ site, survey, result: r, rank, href, maxFootprintM2 = 0 }) {
  const architecture = survey.bestArchitecture ? ARCHITECTURES[survey.bestArchitecture]?.label || survey.bestArchitecture : 'No design';
  const layout = buildPlantLayout(r, SITE_LAYOUT_SIZE);
  const totalM2 = r.footprint?.totalM2 || 0;
  const share = maxFootprintM2 > 0 ? Math.min(1, totalM2 / maxFootprintM2) : 0;
  return `<article class="site-card" data-site-id="${attr(site.id)}" data-architecture="${attr(survey.bestArchitecture || '')}">
    <header class="site-card-head">
      <span class="site-rank" aria-label="Rank">${esc(rank)}</span>
      <h2 class="site-card-title"><a class="site-card-link" href="${attr(href)}" title="Open this design in the simulator">${esc(site.name)}</a></h2>
      <span class="site-arch-badge site-arch-${attr(survey.bestArchitecture || 'none')}">${esc(architecture)}</span>
      <p class="site-card-drivers">${esc(site.gridRegion || '')}${site.gridRegion ? ' · ' : ''}${esc(siteDriversText(site, r.state))}</p>
    </header>
    <div class="site-card-body">
      <section class="site-card-col site-card-finance" aria-label="Financials">
        <h3>Financials</h3>
        ${financials(r)}
        <h3>Design</h3>
        <p class="site-design">${esc(designSummary(r))}</p>
        ${architectureComparison(survey)}
      </section>
      <section class="site-card-col site-card-dispatch" aria-label="Power dispatch">
        <h3>Dispatch <span class="site-card-sub">typical day, year average</span></h3>
        ${renderDispatchMiniSvg(r.dispatch)}
        ${renderDispatchLegend(r.dispatch)}
        <p class="site-card-note">Share of load: ${esc(servedSharesText(r) || '—')}</p>
      </section>
      <section class="site-card-col site-card-footprint" aria-label="Site footprint">
        <h3>Footprint <span class="site-card-sub">${esc(formatArea(totalM2))}</span></h3>
        ${renderPlantLayoutSvg(layout)}
        ${renderFootprintLegend(layout)}
        <div class="site-footprint-bar" role="img" aria-label="Footprint relative to the largest site">
          <svg viewBox="0 0 100 4" preserveAspectRatio="none" aria-hidden="true"><rect class="sfb-track" width="100" height="4"></rect><rect class="sfb-fill" width="${r1(share * 100)}" height="4"></rect></svg>
        </div>
        <p class="site-card-note">${esc(fixed(share * 100, 0))}% of the largest site's footprint. Each plan has its own scale; see the scale bar.</p>
      </section>
    </div>
  </article>`;
}
