/* "Optimize design" card (right column): which inputs the optimizer may size, a Run button with
   progress, and a table of the best design per architecture (or for the current one) against the
   current design, each with an Apply button. renderOptimizerResults is a pure HTML builder (every
   value escaped, classes only); the mixin wires the card to the worker client and the app state. */

import { ARCHITECTURES } from '../../data/datacenter/power.js';
import { normalizeDatacenterState } from '../../model/datacenter/index.js';
import { escapeHtml as esc } from '../renderers/markup.js';
import { fixed, formatMW, formatStorageMWh, formatUptime, formatYearMonth, money } from './format.js';

const CORNER_LABELS = { solar: 'solar', battery: 'battery', units: 'firm units' };
const signClass = value => (value >= 0 ? 'positive' : 'negative');
const archLabel = architecture => ARCHITECTURES[architecture]?.label || architecture;
// Column headers and the architecture row use short names: the card is one narrow column.
const SHORT_ARCH = { grid: 'Grid', hybrid: 'Hybrid', islanded: 'Islanded' };
const shortArch = architecture => SHORT_ARCH[architecture] || archLabel(architecture);

/** Money to three significant figures ($581M, $5.21B): the table has four value columns. */
export function compactMoney(value) {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  const [scaled, suffix] = abs >= 1e9 ? [abs / 1e9, 'B'] : abs >= 1e6 ? [abs / 1e6, 'M'] : abs >= 1e3 ? [abs / 1e3, 'K'] : [abs, ''];
  return `${sign}$${fixed(scaled, scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2)}${suffix}`;
}
const percent = value => (Number.isFinite(value) ? `${fixed(value, 1)}%` : '—');

/** The columns of a run: the current design, then one optimized design per architecture. */
export function optimizerColumns(run) {
  if (!run?.result) return [];
  const { mode, result } = run;
  const rows = mode === 'compare' ? result.rows : [{ architecture: result.architecture, result }];
  const best = mode === 'compare' ? result.bestArchitecture : result.architecture;
  return [
    { key: 'current', label: 'Current', summary: result.baseline, patch: null },
    ...rows.map(row => ({
      key: row.architecture,
      label: mode === 'compare' ? shortArch(row.architecture) : 'Optimized',
      summary: row.result.best,
      patch: row.result.best.patch,
      result: row.result,
      best: mode === 'compare' && row.architecture === best,
    })),
  ];
}

function firmText(s) {
  if (!s.units || s.firmFamily === 'none') return 'None';
  return `${fixed(s.units, 0)}×${fixed(s.unitSizeMW, s.unitSizeMW >= 10 ? 0 : s.unitSizeMW % 0.5 ? 2 : 1)} MW`;
}

/** Notes per optimized column: infeasible, at an upper bound, and the optimizer's own notes. */
function columnNotes(column) {
  const result = column.result;
  if (!result) return [];
  const notes = [];
  if (result.corners.length) {
    notes.push(`${result.corners.map(corner => CORNER_LABELS[corner] || corner).join(', ')} at the upper bound of the search; try the wider search range.`);
  }
  result.notes.filter(note => !note.startsWith('At the upper bound')).forEach(note => notes.push(note));
  return notes;
}

/** HTML for a finished run: summary line, comparison table, notes. */
export function renderOptimizerResults(run) {
  const columns = optimizerColumns(run);
  if (!columns.length) return '';
  const { result } = run;
  const current = columns[0].summary;
  const optimized = columns.slice(1);
  const winner = optimized.find(column => column.best) || optimized[0];

  const head = columns.map(column => {
    const tags = [];
    if (column.best) tags.push('<span class="dc-opt-tag">best</span>');
    if (column.summary && !column.summary.feasible) tags.push('<span class="dc-opt-tag dc-opt-tag-warn">misses target</span>');
    if (column.result?.reducesTo) tags.push(`<span class="dc-opt-tag dc-opt-tag-muted">= ${esc(shortArch(column.result.reducesTo).toLowerCase())}</span>`);
    return `<th scope="col"${column.best ? ' class="dc-opt-best"' : ''}>${esc(column.label)}${tags.length ? `<br>${tags.join(' ')}` : ''}</th>`;
  }).join('');

  const row = (label, cell, title = '') => `<tr><th scope="row"${title ? ` title="${esc(title)}"` : ''}>${esc(label)}</th>${columns.map(column => {
    const { text, cls = '', hint = '' } = cell(column.summary, column);
    const classes = [cls, column.best ? 'dc-opt-best' : ''].filter(Boolean).join(' ');
    return `<td${classes ? ` class="${classes}"` : ''}${hint ? ` title="${esc(hint)}"` : ''}>${esc(text)}</td>`;
  }).join('')}</tr>`;

  const rows = [
    row('Architecture', s => ({ text: shortArch(s.architecture), hint: archLabel(s.architecture) })),
    row('Solar', s => ({ text: s.solarMWdc > 0 ? formatMW(s.solarMWdc) : 'None' }), 'Solar array size, MW DC'),
    row('Battery', s => ({ text: s.batteryMWh > 0 ? `${formatStorageMWh(s.batteryMWh)}${s.batteryDurationHours ? ` (${fixed(s.batteryDurationHours, s.batteryDurationHours % 1 ? 1 : 0)} h)` : ''}` : 'None' })),
    row('Firm units', s => ({ text: firmText(s), hint: s.units > 0 ? `${s.firmLabel}: ${formatMW(s.firmCapacityMW)} in all` : '' }), 'Units × unit size of the selected gas or nuclear type'),
    row('Grid', s => ({ text: s.gridConnection ? (s.gridConnection === 'flexible' ? 'Flexible' : 'Firm') : 'None' })),
    row('Uptime', s => ({ text: formatUptime(s.uptimePercent), cls: s.feasible ? 'positive' : 'negative' }), `Target ${formatUptime(current.targetPercent)}`),
    row('NPV', s => ({ text: compactMoney(s.npv), cls: signClass(s.npv), hint: money(s.npv) })),
    row('IRR', s => ({ text: percent(s.irr) })),
    row('First power', s => ({ text: formatYearMonth(s.firstPower), hint: s.criticalPath ? `Slowest path: ${s.criticalPath}` : '' })),
    row('CAPEX', s => ({ text: compactMoney(s.totalCapex), hint: money(s.totalCapex) })),
  ].join('');

  const applyCells = columns.map(column => {
    if (!column.patch) return '<td></td>';
    const applied = run.appliedKey === column.key;
    const label = applied ? 'Applied' : 'Apply';
    return `<td${column.best ? ' class="dc-opt-best"' : ''}><button type="button" class="dc-opt-apply" data-optimizer-apply="${esc(column.key)}"${applied ? ' disabled' : ''} aria-label="${esc(`${label} the ${column.label.toLowerCase()} design`)}">${label}</button></td>`;
  }).join('');

  const delta = winner.summary.npv - current.npv;
  const runs = result.candidatesEvaluated;
  const seconds = Number.isFinite(run.elapsedMs) ? ` in ${fixed(run.elapsedMs / 1000, 1)} s` : '';
  const headline = winner.summary.feasible
    ? `Best${run.mode === 'compare' ? `: ${archLabel(winner.summary.architecture)}` : ' design'}, NPV ${money(winner.summary.npv)} (${Math.abs(delta) < 5e5 ? 'same as the current design' : `${delta >= 0 ? '+' : '−'}${money(Math.abs(delta))} vs current`}).`
    : `No design within the search range meets the ${formatUptime(current.targetPercent)} target.`;

  // The same note for several architectures is listed once, naming each.
  const byNote = new Map();
  optimized.forEach(column => columnNotes(column).forEach(note => byNote.set(note, [...(byNote.get(note) || []), column.label])));
  const notes = [...byNote].map(([note, labels]) => (run.mode === 'compare' ? `${labels.join(', ')}: ${note}` : note));
  const notesHtml = notes.length ? `<ul class="dc-opt-notes">${notes.map(note => `<li>${esc(note)}</li>`).join('')}</ul>` : '';

  return `<p class="dc-opt-headline">${esc(headline)}</p>`
    + `<div class="dc-table-scroll"><table class="dc-compare-table dc-opt-table"><thead><tr><th scope="col">Design</th>${head}</tr></thead>`
    + `<tbody>${rows}<tr class="dc-opt-apply-row"><th scope="row"></th>${applyCells}</tr></tbody></table></div>`
    + notesHtml
    + `<p class="field-note compact-note">${esc(`${fixed(runs, 0)} model runs${seconds}. A local search over one typical weather year: a good design, not a proven global optimum.`)}</p>`;
}

const OPTION_INPUTS = {
  sizeSolar: 'optimizerSizeSolar',
  sizeBattery: 'optimizerSizeBattery',
  sizeFirm: 'optimizerSizeFirm',
  sizeGridConnection: 'optimizerSizeGrid',
  compare: 'optimizerCompare',
  wide: 'optimizerWide',
};

export const datacenterOptimizerMethods = {
  bindOptimizerPanel() {
    const button = document.getElementById('optimizerRunButton');
    if (!button) return;
    button.addEventListener('click', event => {
      event.preventDefault();
      this.runDesignOptimizer();
    });
    document.getElementById(OPTION_INPUTS.compare)?.addEventListener('change', () => this.syncOptimizerOptions());
    document.getElementById('optimizerResults')?.addEventListener('click', event => {
      const target = event.target?.closest?.('[data-optimizer-apply]');
      if (target && !target.disabled) this.applyOptimizerDesign(target.dataset.optimizerApply);
    });
  },

  readOptimizerOptions() {
    const checked = id => Boolean(document.getElementById(id)?.checked);
    return {
      compare: checked(OPTION_INPUTS.compare),
      options: {
        sizeSolar: checked(OPTION_INPUTS.sizeSolar),
        sizeBattery: checked(OPTION_INPUTS.sizeBattery),
        sizeFirm: checked(OPTION_INPUTS.sizeFirm),
        sizeGridConnection: checked(OPTION_INPUTS.sizeGridConnection),
        // Wider search: doubled bounds and the thorough search (denser grid, more
        // starts, battery duration and unit size; optimizer.js THOROUGH_SEARCH).
        boundsScale: checked(OPTION_INPUTS.wide) ? 2 : 1,
        thorough: checked(OPTION_INPUTS.wide),
      },
    };
  },

  /**
   * Grey out what the run cannot size: a single grid-connected run has no solar and firm service
   * only (ARCHITECTURES.grid); comparing architectures, hybrid and islanded still use them.
   */
  syncOptimizerOptions() {
    const compare = Boolean(document.getElementById(OPTION_INPUTS.compare)?.checked);
    const rules = ARCHITECTURES[this.state.architecture] || {};
    const applies = {
      sizeSolar: compare || rules.resources?.solar !== 'none',
      sizeGridConnection: compare || !rules.gridConnections || rules.gridConnections.length > 1,
    };
    Object.entries(applies).forEach(([option, enabled]) => {
      const input = document.getElementById(OPTION_INPUTS[option]);
      if (!input) return;
      input.disabled = !enabled;
      const label = input.closest?.('label');
      if (label) label.title = enabled ? '' : `Not part of a ${archLabel(this.state.architecture).toLowerCase()} design; tick "Compare all architectures" to include it.`;
    });
  },

  setOptimizerStatus(text = '', percent = null) {
    const status = document.getElementById('optimizerStatus');
    if (status) status.textContent = text;
    const progress = document.getElementById('optimizerProgress');
    if (progress) {
      progress.hidden = percent === null;
      if (percent !== null) progress.value = Math.max(0, Math.min(100, Math.round(percent)));
    }
  },

  async runDesignOptimizer() {
    const button = document.getElementById('optimizerRunButton');
    if (this.optimizerRunning) return;
    const { compare, options } = this.readOptimizerOptions();
    if (!options.sizeSolar && !options.sizeBattery && !options.sizeFirm && !options.sizeGridConnection) {
      this.setOptimizerStatus('Choose at least one thing to size.');
      return;
    }
    this.optimizerRunning = true;
    if (button) button.disabled = true;
    this.setOptimizerStatus('Starting…', 0);
    const reference = { ...this.state };
    const started = Date.now();
    try {
      const type = compare ? 'compareDatacenterArchitectures' : 'optimizeDatacenterDesign';
      const result = await this.requestDatacenterOptimization(type, reference, options, progress => {
        const where = progress.architecture ? `${archLabel(progress.architecture)}: ` : '';
        this.setOptimizerStatus(`${where}${fixed(progress.evaluations || 0, 0)} runs`, progress.percent ?? null);
      });
      this.optimizerRun = { mode: compare ? 'compare' : 'single', result, reference, elapsedMs: Date.now() - started, appliedKey: null };
      this.renderOptimizerRun();
      this.setOptimizerStatus('');
    } catch (error) {
      console.error('Design optimizer failed', error);
      this.setOptimizerStatus('The optimizer failed; see the console.');
    } finally {
      this.optimizerRunning = false;
      if (button) button.disabled = false;
    }
  },

  renderOptimizerRun() {
    const target = document.getElementById('optimizerResults');
    if (target) target.innerHTML = renderOptimizerResults(this.optimizerRun);
    this.updateOptimizerStaleness();
  },

  /** Apply a column's design: its patch on top of the current state, then recalculate (share link follows). */
  applyOptimizerDesign(key) {
    const column = optimizerColumns(this.optimizerRun).find(entry => entry.key === key);
    if (!column?.patch) return;
    // Patches are relative to the state the run started from: switching between results applies
    // onto that state; after other edits, onto the current one (keeping those edits).
    const base = this.optimizerResultsCurrent() ? this.optimizerRun.reference : this.state;
    this.state = normalizeDatacenterState({ ...base, ...column.patch });
    this.optimizerRun.appliedKey = key;
    this.optimizerRun.appliedState = { ...this.state };
    this.syncStateToControls?.();
    this.recalculate();
    this.renderOptimizerRun();
    this.setOptimizerStatus(`Applied the ${column.label.toLowerCase()} design.`);
  },

  /** Flag results that no longer describe the inputs (the user changed something since the run). */
  updateOptimizerStaleness() {
    this.syncOptimizerOptions();
    const note = document.getElementById('optimizerStale');
    if (note) note.hidden = !this.optimizerRun || this.optimizerResultsCurrent();
  },

  /** True while the state is the one the run started from or a design applied from it. */
  optimizerResultsCurrent() {
    const run = this.optimizerRun;
    if (!run) return false;
    const current = normalizeDatacenterState(this.state);
    const same = other => Boolean(other) && Object.keys(current).every(key => current[key] === other[key]);
    return same(normalizeDatacenterState(run.reference)) || same(run.appliedState);
  },
};
