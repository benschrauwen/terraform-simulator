/* Firm generation and power-architecture blocks: the selected gas / nuclear type's trade-offs,
   unit sizing (N+x), a comparison table of all types, and the architecture radio cards.
   Pure HTML builders over js/data/datacenter/power.js; every value is escaped. */

import { ARCHITECTURES, GAS_GENSET_TYPES, NUCLEAR_TYPES, POWER_LEAD_TIMES } from '../../data/datacenter/power.js';
import { escapeAttribute as attr, escapeHtml as esc } from '../renderers/markup.js';
import { fixed, formatMW } from './format.js';
import { infoRow, note, typicalLeadMonths } from './info-panels.js';

const BTU_PER_KWH = 3.412;

const efficiency = heatRate => `${fixed((BTU_PER_KWH / heatRate) * 100, 0)}%`;
const startTime = minutes => (minutes >= 120 ? `${fixed(minutes / 60, 0)} h` : `${fixed(minutes, 0)} min`);
const waterText = water => (water?.consumptionLPerMWh > 0 ? `${fixed(water.consumptionLPerMWh, 0)} L/MWh consumed` : 'no water');
const leadText = (key, scheduleCase) => `${fixed(typicalLeadMonths(POWER_LEAD_TIMES[key], scheduleCase), 0)} mo`;

/** One-line trade-off summary of a gas type: efficiency, $/kW, lead time, start, water. */
export function gasTradeOffLine(type, scheduleCase = 'typical') {
  return [
    `${efficiency(type.heatRateMMBtuPerMWh.default)} efficient (HHV)`,
    `$${fixed(type.capexPerKW.default, 0)}/kW`,
    `${leadText(type.leadTimeKey, scheduleCase)} to power`,
    `${startTime(type.startMinutes)} start`,
    waterText(type.water),
  ].join(' · ');
}

function gasInfo(state) {
  const type = GAS_GENSET_TYPES[state.gasType];
  if (!type) return '';
  return [
    `<p class="dc-tradeoff">${esc(gasTradeOffLine(type, state.scheduleCase))}</p>`,
    `<p class="dc-info-lead">${esc(type.tradeOff)}</p>`,
    infoRow('Unit sizes', type.unitSizeMW.max > type.unitSizeMW.min ? `${formatMW(type.unitSizeMW.min)} – ${formatMW(type.unitSizeMW.max)}` : formatMW(type.unitSizeMW.min)),
    note(`Examples: ${type.examples}`),
  ].join('');
}

/** Earliest commercial operation year of a nuclear option. */
export function earliestCod(type) {
  return Number.isFinite(type?.earliestCodYear) ? type.earliestCodYear : null;
}

function nuclearInfo(state) {
  const type = NUCLEAR_TYPES[state.nuclearType];
  if (!type) return '';
  const cod = earliestCod(type);
  const contracted = (type.capexPerKW?.default || 0) === 0;
  return [
    cod ? `<div class="dc-cod-badge"><span>Earliest commercial operation</span><strong>${esc(cod)}</strong></div>` : '',
    `<p class="dc-tradeoff">${esc([
      contracted ? `PPA ~$${fixed(type.ppaPricePerMWh?.default || 0, 0)}/MWh, no capex` : `$${fixed(type.capexPerKW.default, 0)}/kW overnight`,
      `${fixed(type.capacityFactor * 100, 0)}% capacity factor`,
      `${leadText(type.leadTimeKey, state.scheduleCase)} licensing + build`,
      waterText(type.water),
    ].join(' · '))}</p>`,
    `<p class="dc-info-lead">${esc(type.tradeOff)}</p>`,
    note(`Examples: ${type.examples}`),
    note(`Status (Oct 2026): ${type.status}`),
    note(`Load following: ${type.loadFollowing}`),
  ].join('');
}

function firmSizing(state, r) {
  if (!r || !(r.firm.capacityMW > 0)) {
    return state.firmFamily === 'none' ? '' : note('No firm capacity: set at least one unit.', 'warning-note');
  }
  const firm = r.firm;
  const designPeak = r.load.designPeakMW;
  const rows = [infoRow('Installed', `${fixed(firm.units, 0)} × ${formatMW(firm.unitSizeMW)} = ${formatMW(firm.capacityMW)}`)];
  if (firm.family === 'gas') {
    const needed = Math.ceil(designPeak / firm.unitSizeMW - 1e-9);
    const spare = firm.units - needed;
    rows.push(
      infoRow('Design facility peak', formatMW(designPeak), 'IT nameplate x the hottest hour\'s PUE.'),
      infoRow('Redundancy', spare >= 0 ? `N+${spare} (N = ${needed})` : `short by ${-spare} unit${spare === -1 ? '' : 's'}`),
    );
    if (r.dispatch.annual.gasRunHours > 0) rows.push(infoRow('Run hours', `${fixed(r.dispatch.annual.gasRunHours, 0)} h/yr`));
  } else {
    rows.push(infoRow('Average facility load', formatMW(r.load.meanFacilityMW)));
    if (!firm.onSite) rows.push(note('Contracted output from an existing plant, delivered over the grid or co-located; no on-site reactor.'));
  }
  return rows.join('');
}

function compareTable(headers, rows, selectedKey) {
  const head = headers.map(text => `<th scope="col">${esc(text)}</th>`).join('');
  const body = rows.map(({ key, cells }) => `<tr${key === selectedKey ? ' class="dc-selected-row"' : ''}>${cells.map((cell, index) => (index === 0 ? `<th scope="row">${esc(cell)}</th>` : `<td>${esc(cell)}</td>`)).join('')}</tr>`).join('');
  return `<div class="dc-table-scroll"><table class="dc-compare-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function firmCompare(state) {
  if (state.firmFamily === 'gas') {
    const rows = Object.entries(GAS_GENSET_TYPES).map(([key, type]) => ({
      key,
      cells: [type.label, efficiency(type.heatRateMMBtuPerMWh.default), `$${fixed(type.capexPerKW.default, 0)}`, leadText(type.leadTimeKey, state.scheduleCase), startTime(type.startMinutes), type.water?.consumptionLPerMWh > 0 ? 'wet' : 'dry'],
    }));
    return `<details class="dc-details"><summary>Compare gas options</summary>${compareTable(['Type', 'Eff.', '$/kW', 'To power', 'Start', 'Water'], rows, state.gasType)}</details>`;
  }
  if (state.firmFamily === 'nuclear') {
    const rows = Object.entries(NUCLEAR_TYPES).map(([key, type]) => ({
      key,
      cells: [type.label, type.capexPerKW.default > 0 ? `$${fixed(type.capexPerKW.default, 0)}` : 'PPA', `${fixed(type.unitSizeMWe.default, 0)} MW`, String(earliestCod(type) ?? '—'), leadText(type.leadTimeKey, state.scheduleCase)],
    }));
    return `<details class="dc-details"><summary>Compare nuclear options</summary>${compareTable(['Option', '$/kW', 'Unit', 'Earliest COD', 'Lead'], rows, state.nuclearType)}</details>`;
  }
  return '';
}

/** Architecture radio cards: label, description, real-world examples (links open in a new tab). */
export function renderArchitectureCards(selected) {
  const cards = Object.entries(ARCHITECTURES).map(([key, arch]) => {
    const examples = (arch.examples || []).map(example => `<li><a href="${attr(example.url)}" target="_blank" rel="noreferrer">${esc(example.name)}</a> <span class="dc-example-date">${esc(example.date || '')}</span><br><span>${esc(example.summary)}</span></li>`).join('');
    return `<label class="dc-arch-card${key === selected ? ' selected' : ''}" data-architecture="${attr(key)}">
        <span class="dc-arch-head"><input type="radio" name="architecture" value="${attr(key)}"${key === selected ? ' checked' : ''}> <strong>${esc(arch.label)}</strong></span>
        <span class="dc-arch-desc">${esc(arch.description)}</span>
      </label>
      <details class="dc-details dc-arch-examples" data-architecture-examples="${attr(key)}"${key === selected ? '' : ' hidden'}>
        <summary>Real-world examples</summary>
        <ul class="dc-example-list">${examples}</ul>
      </details>`;
  }).join('');
  return `<div class="dc-arch-cards" role="radiogroup" aria-label="Power architecture">${cards}</div>`;
}

export const FIRM_BLOCK_RENDERERS = { gasInfo, nuclearInfo, firmSizing, firmCompare };
