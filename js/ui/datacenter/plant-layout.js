/* ============================================
   Plant layout: an area-to-scale site plan (self-written SVG)
   ============================================
   buildPlantLayout(result) turns result.footprint.areasM2 into rectangles
   whose areas share one scale (px² per m²): width = sqrt(area x aspect) x s,
   height = sqrt(area / aspect) x s, packed bottom-left on a skyline so the
   whole site fits the view. The scale s is the largest that fits, found by
   bisection, so a 1 GWdc solar field visibly dwarfs the building. A scale
   bar gives real distances. Every positive footprint area is a block, so a
   component with zero capacity disappears.

   Grid tie: when the site is grid-connected a band at the top carries the
   transmission line to the utility grid (solid for firm service, dashed for
   a flexible connection, labelled); the utility switchyard is packed first
   (top-left, under the line) with the on-site substation next to it, the
   line taps down into the switchyard and the switchyard ties to the
   substation. An islanded site has no line and no switchyard and says so
   under the plan. renderPlantLayoutSvg draws it with attributes and classes
   only. Pure; no DOM. */

import { COOLING_TECHNOLOGIES } from '../../data/datacenter/cooling.js';
import { escapeAttribute as attr, escapeHtml as esc } from '../renderers/markup.js';
import { fixed, formatArea, formatMW, formatStorageMWh } from './format.js';

export const LAYOUT_SIZE = Object.freeze({ width: 760, maxHeight: 340, padding: 12, gap: 10, scaleBarHeight: 30, gridBandHeight: 26 });

// Plan aspect ratio (width / height) per block, judgment for a readable plan.
const BLOCKS = [
  { key: 'solarField', name: 'Solar field', aspect: 1.6 },
  { key: 'nuclearPlant', name: 'Reactor plant', aspect: 1.3 },
  { key: 'building', name: 'Datacenter', aspect: 2 },
  { key: 'gasPlant', name: 'Gas plant', aspect: 1.5 },
  { key: 'coolingYard', name: 'Cooling yard', aspect: 2.5 },
  { key: 'battery', name: 'Battery yard', aspect: 2 },
  { key: 'substation', name: 'Substation', aspect: 1.2 },
  { key: 'utilitySwitchyard', name: 'Utility switchyard', aspect: 1.2 },
];

/** The plan's block definitions (key, name, aspect), one per footprint area. */
export const PLANT_BLOCKS = Object.freeze(BLOCKS.map(block => Object.freeze({ ...block })));

// Packed first when grid-connected, so they sit under the transmission line.
const GRID_TIE_ORDER = ['utilitySwitchyard', 'substation'];

function blockDetail(key, r) {
  switch (key) {
    case 'building': return `${formatMW(r.load.itCapacityMW)} IT`;
    case 'coolingYard': return (COOLING_TECHNOLOGIES[r.state.coolingTechnology]?.label || '').split(' (')[0];
    case 'substation': return `${formatMW(r.load.designPeakMW)} design peak`;
    case 'solarField': return `${formatMW(r.solar.sizeMWdc)}dc`;
    case 'battery': return `${formatStorageMWh(r.dispatch.battery.capacityMWh)} / ${formatMW(r.dispatch.battery.powerMW)}`;
    case 'gasPlant':
    case 'nuclearPlant': return `${fixed(r.firm.units, 0)} × ${formatMW(r.firm.unitSizeMW)}`;
    case 'utilitySwitchyard': return `${formatMW(r.grid.importCapMW)} ${r.grid.connection === 'flexible' ? 'flexible' : 'firm'} grid tie`;
    default: return '';
  }
}

/** Label of the grid connection (the transmission line), or of its absence. */
export function gridTieLabel(r) {
  if (!r.grid?.connected) return 'Islanded: no grid connection';
  const outages = r.grid.outageHours > 0 ? `, ~${fixed(r.grid.outageHours, 0)} h/yr outages` : '';
  const kind = r.grid.connection === 'flexible'
    ? `flexible connection, curtailable ${fixed(r.grid.curtailmentHours ?? r.grid.unavailableHours, 0)} h/yr${outages}`
    : `firm service${outages}`;
  return `Transmission line to the utility grid: ${formatMW(r.grid.importCapMW)}, ${kind}`;
}

/** Blocks of a result with their footprint area and detail; packing order: grid tie first when connected, then largest first. */
export function plantBlockItems(r) {
  const areas = r.footprint?.areasM2 || {};
  const items = BLOCKS
    .filter(block => (areas[block.key] || 0) > 0)
    .map(block => ({
      ...block,
      name: block.key === 'gasPlant' && r.firm?.fuel === 'diesel' ? 'Diesel generators' : block.name,
      areaM2: areas[block.key],
      detail: blockDetail(block.key, r),
    }))
    .sort((a, b) => b.areaM2 - a.areaM2);
  if (!r.grid?.connected) return items;
  const rank = key => (GRID_TIE_ORDER.includes(key) ? GRID_TIE_ORDER.indexOf(key) : GRID_TIE_ORDER.length);
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => rank(a.item.key) - rank(b.item.key) || a.index - b.index)
    .map(entry => entry.item);
}

/* Bottom-left skyline packing of { w, h } rectangles into a strip of `width`.
   Returns positions and the used height; null if a rectangle is wider than the strip. */
export function packRectangles(rects, width, gap) {
  let skyline = [{ x: 0, w: width, y: 0 }];
  const placed = [];
  for (const rect of rects) {
    if (rect.w > width + 1e-9) return null;
    let best = null;
    skyline.forEach(segment => {
      const x = segment.x;
      if (x + rect.w > width + 1e-9) return;
      const y = Math.max(...skyline.filter(s => s.x < x + rect.w - 1e-9 && s.x + s.w > x + 1e-9).map(s => s.y));
      if (!best || y < best.y - 1e-9 || (Math.abs(y - best.y) <= 1e-9 && x < best.x)) best = { x, y };
    });
    const top = best.y + rect.h;
    placed.push({ ...rect, x: best.x, y: best.y });
    // Raise the skyline over [x, x + w + gap].
    const x0 = best.x;
    const x1 = Math.min(width, best.x + rect.w + gap);
    const next = [];
    skyline.forEach(s => {
      const sEnd = s.x + s.w;
      if (sEnd <= x0 || s.x >= x1) { next.push(s); return; }
      if (s.x < x0) next.push({ x: s.x, w: x0 - s.x, y: s.y });
      if (sEnd > x1) next.push({ x: x1, w: sEnd - x1, y: s.y });
    });
    next.push({ x: x0, w: x1 - x0, y: top + gap });
    skyline = next.sort((a, b) => a.x - b.x);
  }
  const height = placed.length ? Math.max(...placed.map(p => p.y + p.h)) : 0;
  return { placed, height };
}

function niceScaleBar(pxPerM) {
  const candidates = [5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
  return candidates.find(m => m * pxPerM >= 70) || candidates[candidates.length - 1];
}

/** Blocks with positions in px, the px-per-metre scale and the grid tie; see the header. */
export function buildPlantLayout(r, size = LAYOUT_SIZE) {
  const { width, maxHeight, padding, gap, scaleBarHeight, gridBandHeight } = { ...LAYOUT_SIZE, ...size };
  const items = plantBlockItems(r);
  const totalM2 = items.reduce((sum, item) => sum + item.areaM2, 0);
  const connected = Boolean(r.grid?.connected);
  const band = connected ? gridBandHeight : 0;
  const islandedLabel = connected ? '' : gridTieLabel(r);
  if (!items.length) return { blocks: [], totalM2: 0, pxPerM: 0, width, height: 2 * padding + scaleBarHeight + band, gridTie: null, islandedLabel };

  const innerWidth = width - 2 * padding;
  const innerHeight = maxHeight - 2 * padding - scaleBarHeight - band;
  const rectsAt = (s, items) => items.map(item => ({ ...item, w: Math.sqrt(item.areaM2 * item.aspect) * s, h: Math.sqrt(item.areaM2 / item.aspect) * s }));
  const fits = (s, items) => {
    const packed = packRectangles(rectsAt(s, items), innerWidth, gap);
    return packed && packed.height <= innerHeight ? packed : null;
  };
  // Largest scale that fits (bisection; packing height grows with s).
  const largestScale = items => {
    let lo = 0;
    let hi = Math.sqrt((innerWidth * innerHeight) / totalM2) * 1.2;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid, items)) lo = mid; else hi = mid;
    }
    return lo;
  };
  // The biggest block takes whichever plan shape lets the site fill the view best.
  const biggest = items.reduce((best, item, index) => (item.areaM2 > items[best].areaM2 ? index : best), 0);
  let best = null;
  [null, 1, 1.3, 2, 2.6, 3.4].forEach(aspect => {
    const candidate = aspect ? items.map((item, index) => (index === biggest ? { ...item, aspect } : item)) : items;
    const scale = largestScale(candidate);
    if (!best || scale > best.scale * 1.0001) best = { scale, items: candidate };
  });
  const pxPerM = best.scale;
  const packed = fits(pxPerM, best.items) || packRectangles(rectsAt(pxPerM, best.items), innerWidth, gap);
  const top = padding + band;
  const blocks = packed.placed.map((block, index) => ({
    ...block,
    number: index + 1,
    x: block.x + padding,
    y: block.y + top,
    share: block.areaM2 / totalM2,
  }));
  const scaleBarM = niceScaleBar(pxPerM);

  let gridTie = null;
  if (connected) {
    const lineY = padding + 4;
    const switchyard = blocks.find(block => block.key === 'utilitySwitchyard');
    const substation = blocks.find(block => block.key === 'substation');
    gridTie = {
      connection: r.grid.connection === 'flexible' ? 'flexible' : 'firm',
      label: gridTieLabel(r),
      line: { x1: padding, x2: width - padding, y: lineY },
      // From the line down to the switchyard's top edge (it is packed first, top-left).
      tap: switchyard ? { x: switchyard.x + switchyard.w / 2, y1: lineY, y2: switchyard.y } : null,
      // Switchyard to substation along the top row they share.
      tie: switchyard && substation && Math.abs(substation.y - switchyard.y) < 1e-6
        ? { x1: switchyard.x + switchyard.w, x2: substation.x, y: switchyard.y + Math.min(switchyard.h, substation.h) / 2 }
        : null,
    };
  }
  return {
    blocks,
    totalM2,
    pxPerM,
    width,
    height: Math.ceil(packed.height + top + padding + scaleBarHeight),
    scaleBar: { metres: scaleBarM, px: scaleBarM * pxPerM, x: padding, y: packed.height + top + 16 },
    gridTie,
    islandedLabel,
  };
}

const r1 = value => Math.round(value * 100) / 100;

function renderGridTie(tie) {
  if (!tie) return '';
  const { line } = tie;
  const pylons = [];
  for (let x = line.x1 + 24; x < line.x2 - 6; x += 64) {
    pylons.push(`<path class="pl-pylon" d="M${r1(x - 4)} ${r1(line.y + 5)} L${r1(x)} ${r1(line.y - 4)} L${r1(x + 4)} ${r1(line.y + 5)}"></path>`);
  }
  const tap = tie.tap && tie.tap.y2 > tie.tap.y1
    ? `<line class="pl-line pl-tap" x1="${r1(tie.tap.x)}" y1="${r1(tie.tap.y1)}" x2="${r1(tie.tap.x)}" y2="${r1(tie.tap.y2)}"></line>`
    : '';
  const tieLine = tie.tie && tie.tie.x2 > tie.tie.x1
    ? `<line class="pl-line pl-tie" x1="${r1(tie.tie.x1)}" y1="${r1(tie.tie.y)}" x2="${r1(tie.tie.x2)}" y2="${r1(tie.tie.y)}"></line>`
    : '';
  return `<g class="pl-gridtie pl-gridtie-${attr(tie.connection)}" data-connection="${attr(tie.connection)}">
      <line class="pl-line pl-transmission" x1="${r1(line.x1)}" y1="${r1(line.y)}" x2="${r1(line.x2)}" y2="${r1(line.y)}"><title>${esc(tie.label)}</title></line>
      ${pylons.join('')}${tap}${tieLine}
      <text class="pl-grid" x="${r1(line.x2)}" y="${r1(line.y + 16)}" text-anchor="end">${esc(tie.label)}</text>
    </g>`;
}

/** SVG markup of a plant layout. Blocks too small for text carry their legend number. */
export function renderPlantLayoutSvg(layout) {
  const blocks = layout.blocks.map(block => {
    // Approximate text widths: 12px bold name ~7 px/char, 10px detail ~5.6 px/char.
    const fitsText = block.w >= Math.max(96, block.name.length * 7 + 8, block.detail.length * 5.6 + 8) && block.h >= 34;
    const cx = block.x + block.w / 2;
    const cy = block.y + block.h / 2;
    const text = fitsText
      ? `<text class="pl-name" x="${r1(cx)}" y="${r1(cy - 3)}" text-anchor="middle">${esc(block.name)}</text>
         <text class="pl-detail" x="${r1(cx)}" y="${r1(cy + 10)}" text-anchor="middle">${esc(block.detail)}</text>`
      : `<circle class="pl-badge" cx="${r1(cx)}" cy="${r1(cy)}" r="8"></circle><text class="pl-badge-text" x="${r1(cx)}" y="${r1(cy + 3)}" text-anchor="middle">${block.number}</text>`;
    return `<g class="pl-block pl-${attr(block.key)}" data-key="${attr(block.key)}" data-area="${attr(block.areaM2)}" data-w="${attr(block.w)}" data-h="${attr(block.h)}">
        <rect x="${r1(block.x)}" y="${r1(block.y)}" width="${r1(Math.max(block.w, 0.5))}" height="${r1(Math.max(block.h, 0.5))}" rx="1.5"><title>${esc(`${block.name}: ${block.detail}, ${formatArea(block.areaM2)}`)}</title></rect>
        ${text}
      </g>`;
  }).join('');
  const bar = layout.scaleBar
    ? `<g class="pl-scale"><line x1="${r1(layout.scaleBar.x)}" y1="${r1(layout.scaleBar.y)}" x2="${r1(layout.scaleBar.x + layout.scaleBar.px)}" y2="${r1(layout.scaleBar.y)}"></line>
        <line x1="${r1(layout.scaleBar.x)}" y1="${r1(layout.scaleBar.y - 4)}" x2="${r1(layout.scaleBar.x)}" y2="${r1(layout.scaleBar.y + 4)}"></line>
        <line x1="${r1(layout.scaleBar.x + layout.scaleBar.px)}" y1="${r1(layout.scaleBar.y - 4)}" x2="${r1(layout.scaleBar.x + layout.scaleBar.px)}" y2="${r1(layout.scaleBar.y + 4)}"></line>
        <text x="${r1(layout.scaleBar.x + layout.scaleBar.px + 8)}" y="${r1(layout.scaleBar.y + 4)}">${esc(layout.scaleBar.metres >= 1000 ? `${fixed(layout.scaleBar.metres / 1000, 0)} km` : `${layout.scaleBar.metres} m`)}</text>
        ${layout.islandedLabel ? `<text class="pl-islanded" x="${r1(layout.width - 12)}" y="${r1(layout.scaleBar.y + 4)}" text-anchor="end">${esc(layout.islandedLabel)}</text>` : ''}</g>`
    : '';
  return `<svg class="plant-layout-svg" viewBox="0 0 ${layout.width} ${layout.height}" role="img" aria-label="Plant layout to scale">${renderGridTie(layout.gridTie)}${blocks}${bar}</svg>`;
}

/** Legend list (HTML) with every block's number, capacity and area. */
export function renderPlantLegend(layout) {
  const items = layout.blocks.map(block => `<li class="pl-legend-item pl-${attr(block.key)}">
      <span class="pl-swatch" aria-hidden="true"></span>
      <span class="pl-legend-num">${block.number}</span>
      <span class="pl-legend-name">${esc(block.name)}</span>
      <span class="pl-legend-detail">${esc(block.detail)}</span>
      <span class="pl-legend-area">${esc(formatArea(block.areaM2))} · ${esc(fixed(block.share * 100, block.share < 0.01 ? 2 : 1))}%</span>
    </li>`).join('');
  return `<ul class="pl-legend">${items}</ul>`;
}
