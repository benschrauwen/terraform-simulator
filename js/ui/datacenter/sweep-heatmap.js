/* 2D price grid heatmap for the hidden sweep page (self-written SVG, attributes only for the strict
   CSP): solar price across the columns, battery price up the rows (cheapest at the bottom left),
   each cell coloured on a sequential scale and labelled with its value; a cell's <title> gives
   the design behind it, and with `link` a cell carries its target in data-href and is a
   keyboard-focusable link (role="link"); the page navigates on click or Enter
   (bindHeatmapLinks), because SVG <a> elements do not navigate reliably. `paths` draws lines
   through (x, y) points on top, placed by linear interpolation between the cell centres (the axes
   are not evenly spaced); points outside the axes are left out. */

import { escapeAttribute as attr, escapeHtml as esc } from '../renderers/markup.js';

export const HEATMAP_SIZE = Object.freeze({ width: 760, cellHeight: 34, padLeft: 78, padBottom: 40, padTop: 8, padRight: 8 });

// Sequential scale on the dark theme (dark blue -> teal -> yellow); `better: 'high'` puts the
// bright end on high values (NPV), 'low' on low ones (CO2e).
const STOPS = [[30, 50, 92], [36, 130, 132], [120, 190, 90], [236, 210, 80]];

/** Fill and text colour for t in [0, 1] along the scale. */
export function scaleColor(t) {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
  const position = clamped * (STOPS.length - 1);
  const i = Math.min(STOPS.length - 2, Math.floor(position));
  const f = position - i;
  const rgb = STOPS[i].map((c, k) => Math.round(c + (STOPS[i + 1][k] - c) * f));
  const luminance = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
  return { fill: `rgb(${rgb.join(', ')})`, text: luminance > 0.55 ? '#111316' : '#eef2f6' };
}

/** Fractional index of `value` along ascending axis values (0 = first centre), or null outside them. */
export function axisIndex(values, value) {
  if (!Number.isFinite(value) || value < values[0] - 1e-9 || value > values[values.length - 1] + 1e-9) return null;
  for (let i = 0; i < values.length - 1; i++) {
    if (value <= values[i + 1]) return i + (value - values[i]) / (values[i + 1] - values[i]);
  }
  return values.length - 1;
}

/**
 * SVG of a heatmap. xs, ys: the axis values (ys bottom-up); cell(x, y) -> result or null (not yet
 * run); value(result) -> number; format(number) -> label; xLabel / yLabel(value) -> tick text;
 * better: 'high' | 'low'; describe(result) -> tooltip text; title: the accessible name.
 * paths: [{ key, label, points: [{ x, y, label, tip }] }], drawn as lines with a dot and label per
 * point (class hm-path-<key>; they ignore the pointer, so the cells below stay clickable).
 */
export function renderHeatmapSvg({ xs, ys, cell, value, format, xLabel, yLabel, xTitle, yTitle, better = 'high', describe = () => '', link = null, title = '', paths = [], size = HEATMAP_SIZE }) {
  const { width, cellHeight, padLeft, padBottom, padTop, padRight } = { ...HEATMAP_SIZE, ...size };
  const cellWidth = (width - padLeft - padRight) / xs.length;
  const height = padTop + ys.length * cellHeight + padBottom;
  const values = [];
  xs.forEach(x => ys.forEach(y => {
    const result = cell(x, y);
    if (result) values.push(value(result));
  }));
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 1;
  const r1 = v => Math.round(v * 10) / 10;
  const cells = [];
  ys.forEach((y, row) => {
    // Rows from the bottom: the cheapest battery price at the bottom.
    const top = padTop + (ys.length - 1 - row) * cellHeight;
    xs.forEach((x, col) => {
      const left = padLeft + col * cellWidth;
      const result = cell(x, y);
      if (!result) {
        cells.push(`<rect class="hm-pending" x="${r1(left + 1)}" y="${r1(top + 1)}" width="${r1(cellWidth - 2)}" height="${cellHeight - 2}" rx="3"><title>${esc(`${xLabel(x)}, ${yLabel(y)}: not run yet`)}</title></rect>`);
        return;
      }
      const v = value(result);
      const t = max > min ? (v - min) / (max - min) : 0.5;
      const { fill, text } = scaleColor(better === 'high' ? t : 1 - t);
      const href = link ? link(result, x, y) : '';
      const tip = `${xLabel(x)}, ${yLabel(y)}: ${format(v)} · ${describe(result)}${href ? ' · click to open in the simulator' : ''}`;
      const linkAttrs = href ? ` data-href="${attr(href)}" role="link" tabindex="0" aria-label="${attr(tip)}"` : '';
      cells.push(`<g class="hm-cell${href ? ' hm-link' : ''}" data-x="${attr(x)}" data-y="${attr(y)}"${linkAttrs}><rect x="${r1(left + 1)}" y="${r1(top + 1)}" width="${r1(cellWidth - 2)}" height="${cellHeight - 2}" rx="3" fill="${attr(fill)}"><title>${esc(tip)}</title></rect><text class="hm-value" x="${r1(left + cellWidth / 2)}" y="${r1(top + cellHeight / 2 + 4)}" text-anchor="middle" fill="${attr(text)}">${esc(format(v))}</text></g>`);
    });
  });
  const xTicks = xs.map((x, col) => `<text class="hm-axis" x="${r1(padLeft + (col + 0.5) * cellWidth)}" y="${padTop + ys.length * cellHeight + 14}" text-anchor="middle">${esc(xLabel(x))}</text>`).join('');
  const yTicks = ys.map((y, row) => `<text class="hm-axis" x="${padLeft - 6}" y="${r1(padTop + (ys.length - 1 - row) * cellHeight + cellHeight / 2 + 4)}" text-anchor="end">${esc(yLabel(y))}</text>`).join('');
  const titles = `<text class="hm-title" x="${r1(padLeft + (width - padLeft - padRight) / 2)}" y="${height - 6}" text-anchor="middle">${esc(xTitle)}</text>
    <text class="hm-title" x="12" y="${r1(padTop + (ys.length * cellHeight) / 2)}" text-anchor="middle" transform="rotate(-90 12 ${r1(padTop + (ys.length * cellHeight) / 2)})">${esc(yTitle)}</text>`;
  const overlay = paths.map(path => {
    const placed = path.points.map(point => {
      const col = axisIndex(xs, point.x);
      const row = axisIndex(ys, point.y);
      if (col === null || row === null) return null;
      return { ...point, px: r1(padLeft + (col + 0.5) * cellWidth), py: r1(padTop + (ys.length - 1 - row + 0.5) * cellHeight) };
    }).filter(Boolean);
    if (!placed.length) return '';
    const line = placed.length > 1 ? `<polyline class="hm-path-line" points="${placed.map(p => `${p.px},${p.py}`).join(' ')}"/>` : '';
    const marks = placed.map(p => `<circle class="hm-path-dot" cx="${p.px}" cy="${p.py}" r="3.5"><title>${esc(p.tip || p.label || '')}</title></circle>${p.label ? `<text class="hm-path-label" x="${r1(p.px + 6)}" y="${r1(p.py + 13)}">${esc(p.label)}</text>` : ''}`).join('');
    return `<g class="hm-path hm-path-${attr(path.key)}" aria-label="${attr(path.label || '')}">${line}${marks}</g>`;
  }).join('');
  return `<svg class="sweep-heatmap-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${attr(title)}">${cells.join('')}${xTicks}${yTicks}${titles}${overlay}</svg>`;
}

/** Navigate when a linked cell inside `container` is clicked or activated with Enter / Space. */
export function bindHeatmapLinks(container, navigate = href => window.location.assign(href)) {
  const go = event => {
    const cell = event.target.closest?.('[data-href]');
    if (!cell || !container.contains(cell)) return;
    if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    navigate(cell.getAttribute('data-href'));
  };
  container.addEventListener('click', go);
  container.addEventListener('keydown', go);
}
