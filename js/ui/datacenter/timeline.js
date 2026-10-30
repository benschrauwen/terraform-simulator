/* ============================================
   Project timeline (Gantt) from result.schedule
   ============================================
   One row per component path, all starting at notice-to-proceed: bars split
   into permitting / procurement / construction, plus the wait for a reactor
   type's earliest commercial operation. The critical (slowest required) path
   is highlighted, optional components are marked, and a vertical line marks
   energization (first power). Self-written SVG with attributes and classes
   only. Pure; no DOM. */

import { NUCLEAR_TYPES } from '../../data/datacenter/power.js';
import { escapeAttribute as attr, escapeHtml as esc } from '../renderers/markup.js';
import { fixed, formatYearMonth } from './format.js';

export const TIMELINE_SIZE = Object.freeze({ width: 760, labelWidth: 230, rowHeight: 26, barHeight: 14, top: 26, bottom: 14, right: 70 });

export const TIMELINE_PHASES = [
  { key: 'permittingMonths', label: 'Permitting / licensing', cls: 'tl-permit' },
  { key: 'procurementMonths', label: 'Equipment lead time', cls: 'tl-procure' },
  { key: 'constructionMonths', label: 'Construction', cls: 'tl-build' },
  { key: 'waitForCodMonths', label: 'Waiting for earliest commercial operation', cls: 'tl-wait' },
];

const NUCLEAR_BY_LEAD_KEY = new Map(Object.values(NUCLEAR_TYPES).map(type => [type.leadTimeKey, type]));

/** Rows with their segments in months from notice-to-proceed. */
export function buildTimelineRows(schedule) {
  return (schedule?.paths || []).map(path => {
    let start = 0;
    const segments = TIMELINE_PHASES.map(phase => {
      const months = phase.key === 'waitForCodMonths' ? path.waitForCodMonths || 0 : path.phases?.[phase.key] || 0;
      const segment = { ...phase, start, months };
      start += months;
      return segment;
    }).filter(segment => segment.months > 1e-9);
    const nuclear = NUCLEAR_BY_LEAD_KEY.get(path.id);
    return {
      id: path.id,
      label: path.label,
      required: path.required,
      critical: Boolean(path.critical),
      durationMonths: path.durationMonths,
      slackMonths: path.slackMonths,
      finish: path.finish,
      segments,
      earliestCodYear: nuclear?.earliestCodYear ?? null,
    };
  });
}

/** "Slowest path: <label>, N months → first power Mon YYYY". */
export function timelineHeadline(schedule) {
  if (!schedule?.criticalPath) return 'No required components.';
  return `Slowest path: ${schedule.criticalPath.label}, ${fixed(schedule.criticalPath.durationMonths, 0)} months → first power ${formatYearMonth(schedule.energizationDate)}`;
}

function slackText(row) {
  if (row.critical) return 'critical';
  if (row.slackMonths < -0.5) return `${fixed(-row.slackMonths, 0)} mo after first power`;
  return `${fixed(row.slackMonths, 0)} mo slack`;
}

/** SVG markup of the Gantt. */
export function renderTimelineSvg(schedule, size = TIMELINE_SIZE) {
  const { width, labelWidth, rowHeight, barHeight, top, bottom, right } = { ...TIMELINE_SIZE, ...size };
  const rows = buildTimelineRows(schedule);
  if (!rows.length) return '';
  const ntp = schedule.noticeToProceed;
  const maxMonth = Math.max(schedule.energizationMonth, ...rows.map(row => row.durationMonths));
  // Axis to the next January after the last finish.
  const monthsToJan = 12 - ((ntp.month - 1 + Math.ceil(maxMonth)) % 12);
  const axisMonths = Math.max(12, Math.ceil(maxMonth) + (monthsToJan === 12 ? 0 : monthsToJan));
  const plotWidth = width - labelWidth - right;
  const x = months => labelWidth + (months / axisMonths) * plotWidth;
  const height = top + rows.length * rowHeight + bottom;

  const ticks = [];
  for (let m = (13 - ntp.month) % 12; m <= axisMonths; m += 12) {
    const year = ntp.year + Math.floor((ntp.month - 1 + m) / 12);
    ticks.push(`<line class="tl-grid" x1="${x(m).toFixed(1)}" y1="${top - 6}" x2="${x(m).toFixed(1)}" y2="${height - bottom}"></line>
      <text class="tl-tick" x="${x(m).toFixed(1)}" y="${top - 10}" text-anchor="middle">${year}</text>`);
  }

  const body = rows.map((row, index) => {
    const y = top + index * rowHeight;
    const barY = y + (rowHeight - barHeight) / 2;
    const classes = ['tl-row', row.critical ? 'tl-critical' : '', row.required ? 'tl-required' : 'tl-optional'].filter(Boolean).join(' ');
    const label = `${row.label}${row.required ? '' : ' (optional)'}`;
    const segments = row.segments.map(segment => `<rect class="tl-seg ${segment.cls}" x="${x(segment.start).toFixed(1)}" y="${barY.toFixed(1)}" width="${Math.max(0.5, x(segment.start + segment.months) - x(segment.start)).toFixed(1)}" height="${barHeight}"><title>${esc(`${row.label}: ${segment.label}, ${fixed(segment.months, 0)} months`)}</title></rect>`).join('');
    const outline = `<rect class="tl-outline" x="${x(0).toFixed(1)}" y="${(barY - 1.5).toFixed(1)}" width="${Math.max(1, x(row.durationMonths) - x(0)).toFixed(1)}" height="${barHeight + 3}" rx="2"></rect>`;
    const cod = row.earliestCodYear
      ? `<text class="tl-cod" x="${(x(row.durationMonths) + 6).toFixed(1)}" y="${(barY - 1).toFixed(1)}">COD ≥ ${esc(row.earliestCodYear)}</text>`
      : '';
    return `<g class="${classes}" data-path="${attr(row.id)}" data-critical="${row.critical}">
        <text class="tl-label" x="${labelWidth - 8}" y="${(y + rowHeight / 2 + 3.5).toFixed(1)}" text-anchor="end">${esc(label.length > 36 ? `${label.slice(0, 35)}…` : label)}<title>${esc(label)}</title></text>
        ${outline}${segments}
        <text class="tl-slack" x="${(x(row.durationMonths) + 6).toFixed(1)}" y="${(barY + barHeight - 3).toFixed(1)}">${esc(`${fixed(row.durationMonths, 0)} mo · ${slackText(row)}`)}</text>
        ${cod}
      </g>`;
  }).join('');

  const ex = x(schedule.energizationMonth).toFixed(1);
  const marker = `<g class="tl-energization"><line x1="${ex}" y1="${top - 4}" x2="${ex}" y2="${height - bottom + 6}"></line>
      <text x="${ex}" y="${height - 1}" text-anchor="middle">${esc(`First power ${formatYearMonth(schedule.energizationDate)}`)}</text></g>`;
  return `<svg class="timeline-svg" viewBox="0 0 ${width} ${height + 4}" role="img" aria-label="${attr(timelineHeadline(schedule))}">${ticks.join('')}${body}${marker}</svg>`;
}

/** Legend (HTML) of the bar segments. */
export function renderTimelineLegend() {
  return `<ul class="tl-legend">${TIMELINE_PHASES.map(phase => `<li><span class="tl-swatch ${phase.cls}" aria-hidden="true"></span>${esc(phase.label)}</li>`).join('')}<li><span class="tl-swatch tl-swatch-critical" aria-hidden="true"></span>Critical path</li></ul>`;
}
