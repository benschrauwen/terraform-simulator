/* Firm generation and power-architecture blocks: the selected gas / nuclear type's trade-offs,
   unit sizing (N+x), a comparison table of all types, the architecture radio cards and the notes
   where an architecture rules out a supply (with a button that switches to hybrid).
   Pure HTML builders over js/data/datacenter/power.js; every value is escaped. */

import { ARCHITECTURES, GAS_GENSET_TYPES, NUCLEAR_TYPES, POWER_LEAD_TIMES } from '../../data/datacenter/power.js';
import { escapeAttribute as attr, escapeHtml as esc } from '../renderers/markup.js';
import { fixed, formatMW } from './format.js';
import { infoRow, note, typicalLeadMonths } from './info-panels.js';

const BTU_PER_KWH = 3.412;

const efficiency = heatRate => `${fixed((BTU_PER_KWH / heatRate) * 100, 0)}%`;
const startTime = minutes => (minutes >= 120 ? `${fixed(minutes / 60, 0)} h` : minutes < 1 ? `${fixed(minutes * 60, 0)} s` : `${fixed(minutes, 0)} min`);
const pctOf = (part, whole) => `${fixed(whole > 0 ? (part / whole) * 100 : 0, part / whole < 0.1 ? 1 : 0)}%`;
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
    type.emergencyEngine ? note(`Standby only: never run on cost while the grid is up. EPA emergency engines: unlimited in utility outages, at most ${type.emergencyEngine.maxHoursPerYear} h/yr of testing and non-emergency use (${type.emergencyEngine.maxNonEmergencyHoursPerYear} h non-emergency). ${type.emissionsNote || ''}`) : '',
    type.fuelStorageHours ? note(`On-site fuel: ${type.fuelStorageHours.typical} h at full load typical (Uptime Institute minimum ${type.fuelStorageHours.minimum} h); included in the installed cost.`) : '',
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

/* What the uptime target needs from gas (result.firm.sizingBasis, model/datacenter/firm-sizing.js). */
function uptimeNeedRows(r) {
  const basis = r.firm.sizingBasis;
  if (!basis) return [];
  const rows = [
    infoRow(
      'Needed for the uptime target',
      basis.minUnits > 0 ? `${formatMW(basis.requiredMW)} → ${fixed(basis.minUnits, 0)} unit${basis.minUnits === 1 ? '' : 's'}` : 'none',
      `Smallest firm capacity with which the year's dispatch serves the full load in all but ${fixed(basis.allowedUnservedHours, 0)} h (the ${r.reliability.targetPercent}% target), after the grid, solar and battery; unit count includes maintenance outages.`,
    ),
    infoRow('Hours short without it', `${fixed(basis.hoursShortWithoutFirm, 0)} h/yr (target allows ${fixed(basis.allowedUnservedHours, 0)})`),
  ];
  if (!basis.reachable) rows.push(note('The target cannot be met with any number of these units.', 'warning-note'));
  return rows;
}

function firmCapexShare(r) {
  const item = (r.economics?.capexItems || []).find(entry => entry.key === r.firm.family);
  return item && r.economics.totalCapex > 0 ? infoRow('Share of CAPEX', `${pctOf(item.capex, r.economics.totalCapex)} ($${fixed(item.capex / 1e6, 0)}M)`) : '';
}

function firmSizing(state, r) {
  if (!r) return '';
  const firm = r.firm;
  const auto = state.firmSizingMode === 'auto';
  if (!(firm.capacityMW > 0)) {
    if (state.firmFamily === 'none') return '';
    if (firm.family === 'gas' && auto) {
      return [note('No firm generation needed for the uptime target (spares only if you add units manually).'), ...uptimeNeedRows(r)].join('');
    }
    return [note('No firm capacity: set at least one unit.', 'warning-note'), ...uptimeNeedRows(r)].join('');
  }
  const designPeak = r.load.designPeakMW;
  const rows = [infoRow('Installed', `${fixed(firm.units, 0)} × ${formatMW(firm.unitSizeMW)} = ${formatMW(firm.capacityMW)}`)];
  if (firm.family === 'gas') {
    const basis = firm.sizingBasis;
    rows.push(...uptimeNeedRows(r));
    if (basis) {
      const spare = firm.units - basis.minUnits;
      rows.push(infoRow('Redundancy', spare >= 0 ? `N+${spare} (N = ${basis.minUnits} for the uptime target)` : `short by ${-spare} unit${spare === -1 ? '' : 's'} for the uptime target`));
    }
    rows.push(
      infoRow('Design facility peak', formatMW(designPeak), 'IT nameplate x the hottest hour\'s PUE: what the plant would need to carry the full IT load on the hottest hour. Auto sizing covers the modeled load instead.'),
      firmCapexShare(r),
    );
    if (r.dispatch.annual.gasRunHours > 0) rows.push(infoRow('Run hours', `${fixed(r.dispatch.annual.gasRunHours, 0)} h/yr`));
    const engine = firm.emergencyEngine;
    if (engine) {
      rows.push(infoRow('EPA run hours', `${fixed(engine.emergencyRunHours, 0)} h emergency + ${fixed(engine.nonEmergencyRunHours, 0)} h other (+ ~${fixed(engine.testingHoursPerYear, 0)} h testing)`, `Limit: ${engine.maxHoursPerYear} h/yr of testing and non-emergency use, at most ${engine.maxNonEmergencyHoursPerYear} h non-emergency; utility outages are emergencies.`));
    }
  } else {
    rows.push(infoRow('Average facility load', formatMW(r.load.meanFacilityMW)));
    if (!firm.onSite) rows.push(note('Contracted output from an existing plant, delivered over the grid or co-located; no on-site reactor.'));
    rows.push(firmCapexShare(r));
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
    return `<details class="dc-details"><summary>Compare generator options</summary>${compareTable(['Type', 'Eff.', '$/kW', 'To power', 'Start', 'Water'], rows, state.gasType)}</details>`;
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

/** A note and a button that switches architecture (controls.js handles [data-switch-architecture]). */
function switchArchitectureNote(text, architecture, label) {
  return `${note(text)}<button type="button" class="dc-switch-arch" data-switch-architecture="${attr(architecture)}">${esc(label)}</button>`;
}

// Grid-connected designs have no on-site generation (ARCHITECTURES.grid).
const solarArchitectureNote = () => switchArchitectureNote(
  'Grid-connected: the utility carries the load, so there is no on-site solar (an off-site renewable PPA is not modeled).',
  'hybrid', 'Switch to Hybrid to add on-site generation',
);
const firmArchitectureNote = () => switchArchitectureNote(
  'Grid-connected: on-site generators are standby backup for utility outages only (or a grid-delivered existing-plant nuclear contract). Gas engines, turbines, fuel cells and own reactors run in Hybrid.',
  'hybrid', 'Switch to Hybrid to add on-site generation',
);

export const FIRM_BLOCK_RENDERERS = { gasInfo, nuclearInfo, firmSizing, firmCompare, solarArchitectureNote, firmArchitectureNote };
