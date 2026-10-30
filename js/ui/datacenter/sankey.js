/* ============================================
   Sankey-style flow diagram (self-written SVG)
   ============================================
   buildSankeyLayout(links, labels, size) turns result.flows.<kind> ({ from,
   to, value, unit }) into columns of nodes and bands: a node's column is its
   longest path from a source, nodes with no outflow go to the last column,
   node heights and band widths share one scale (value x k, so widths are
   proportional to the flows), and each node's bands stack in the order of
   the nodes they connect to. renderSankeySvg draws it with attributes and
   classes only (no style attributes: the CSP forbids them). Pure; no DOM. */

import { escapeAttribute as attr, escapeHtml as esc } from '../renderers/markup.js';
import { formatFlowValue } from './format.js';

export const SANKEY_SIZE = Object.freeze({ width: 760, height: 320, nodeWidth: 14, nodePadding: 18, marginX: 4, marginY: 10 });

/** Columns, nodes and bands with coordinates; see the header. */
export function buildSankeyLayout(rawLinks, labels = {}, size = SANKEY_SIZE) {
  const { width, height, nodeWidth, nodePadding, marginX, marginY } = { ...SANKEY_SIZE, ...size };
  const maxValue = Math.max(0, ...rawLinks.map(link => Number(link.value) || 0));
  const links = rawLinks
    .filter(link => Number(link.value) > maxValue * 1e-9 && link.from !== link.to)
    .map(link => ({ ...link, value: Number(link.value) }));
  if (!links.length) return { nodes: [], links: [], columns: [], scale: 0, unit: rawLinks[0]?.unit || '', totals: { in: 0, out: 0 } };

  const nodeMap = new Map();
  const node = id => {
    if (!nodeMap.has(id)) nodeMap.set(id, { id, label: labels[id] || id, inValue: 0, outValue: 0, incoming: [], outgoing: [], depth: 0 });
    return nodeMap.get(id);
  };
  links.forEach(link => {
    link.source = node(link.from);
    link.target = node(link.to);
    link.source.outValue += link.value;
    link.source.outgoing.push(link);
    link.target.inValue += link.value;
    link.target.incoming.push(link);
  });
  const nodes = [...nodeMap.values()];

  // Longest path from a source (bounded relaxation, so a cycle cannot hang it).
  for (let pass = 0; pass < nodes.length; pass++) {
    let changed = false;
    links.forEach(link => {
      if (link.target.depth < link.source.depth + 1) {
        link.target.depth = link.source.depth + 1;
        changed = true;
      }
    });
    if (!changed) break;
  }
  const maxDepth = Math.max(...nodes.map(n => n.depth));
  nodes.forEach(n => {
    if (!n.outgoing.length) n.depth = maxDepth;
    n.value = Math.max(n.inValue, n.outValue);
  });

  const columns = Array.from({ length: maxDepth + 1 }, (_, depth) => nodes.filter(n => n.depth === depth));
  const usableHeight = height - 2 * marginY;
  const scale = Math.min(...columns.filter(col => col.length).map(col => (
    (usableHeight - nodePadding * (col.length - 1)) / col.reduce((sum, n) => sum + n.value, 0)
  )));
  const columnStep = maxDepth > 0 ? (width - 2 * marginX - nodeWidth) / maxDepth : 0;

  columns.forEach((col, depth) => {
    const total = col.reduce((sum, n) => sum + n.value * scale, 0) + nodePadding * (col.length - 1);
    let y = marginY + (usableHeight - total) / 2;
    col.forEach(n => {
      n.x0 = marginX + depth * columnStep;
      n.x1 = n.x0 + nodeWidth;
      n.y0 = y;
      n.y1 = y + n.value * scale;
      y = n.y1 + nodePadding;
    });
  });

  // Stack bands at each end in the order of the node at the other end.
  nodes.forEach(n => {
    let outY = n.y0;
    [...n.outgoing].sort((a, b) => a.target.y0 - b.target.y0).forEach(link => {
      link.width = link.value * scale;
      link.y0 = outY;
      outY += link.width;
    });
    let inY = n.y0;
    [...n.incoming].sort((a, b) => a.source.y0 - b.source.y0).forEach(link => {
      link.y1 = inY;
      inY += link.value * scale;
    });
  });

  const sources = nodes.filter(n => !n.incoming.length);
  const sinks = nodes.filter(n => !n.outgoing.length);
  return {
    nodes,
    links,
    columns,
    scale,
    unit: links[0].unit,
    width,
    height,
    totals: {
      in: sources.reduce((sum, n) => sum + n.outValue, 0),
      out: sinks.reduce((sum, n) => sum + n.inValue, 0),
    },
  };
}

const r1 = value => Math.round(value * 10) / 10;

/** Filled band between two nodes: a cubic ribbon of the link's width. */
export function bandPath(link) {
  const x0 = link.source.x1;
  const x1 = link.target.x0;
  const xm = (x0 + x1) / 2;
  const w = Math.max(link.width, 0.6);
  return `M${r1(x0)},${r1(link.y0)}C${r1(xm)},${r1(link.y0)} ${r1(xm)},${r1(link.y1)} ${r1(x1)},${r1(link.y1)}`
    + `L${r1(x1)},${r1(link.y1 + w)}C${r1(xm)},${r1(link.y1 + w)} ${r1(xm)},${r1(link.y0 + w)} ${r1(x0)},${r1(link.y0 + w)}Z`;
}

const cssId = id => String(id).replace(/[^a-zA-Z0-9-]/g, '');

/** SVG markup of a layout; `title` is the accessible name. */
export function renderSankeySvg(layout, { title = 'Flow diagram' } = {}) {
  if (!layout.nodes.length) return '';
  const lastDepth = layout.columns.length - 1;
  const bands = layout.links.map(link => `<path class="sk-band sk-${attr(cssId(link.from))}" d="${bandPath(link)}" data-from="${attr(link.from)}" data-to="${attr(link.to)}" data-value="${attr(link.value)}" data-width="${attr(link.width)}"><title>${esc(`${link.source.label} → ${link.target.label}: ${formatFlowValue(link.value, link.unit)}`)}</title></path>`).join('');
  const nodes = layout.nodes.map(n => {
    const right = n.depth < lastDepth;
    const tx = right ? n.x1 + 6 : n.x0 - 6;
    const ty = (n.y0 + n.y1) / 2;
    const anchor = right ? 'start' : 'end';
    return `<g class="sk-node sk-${attr(cssId(n.id))}" data-node="${attr(n.id)}">
        <rect x="${r1(n.x0)}" y="${r1(n.y0)}" width="${r1(n.x1 - n.x0)}" height="${r1(Math.max(n.y1 - n.y0, 1))}" rx="2"><title>${esc(`${n.label}: ${formatFlowValue(n.value, layout.unit)}`)}</title></rect>
        <text class="sk-label" x="${r1(tx)}" y="${r1(ty - 2)}" text-anchor="${anchor}">${esc(n.label)}</text>
        <text class="sk-value" x="${r1(tx)}" y="${r1(ty + 10)}" text-anchor="${anchor}">${esc(formatFlowValue(n.value, layout.unit))}</text>
      </g>`;
  }).join('');
  return `<svg class="sankey-svg" viewBox="0 0 ${layout.width} ${layout.height}" role="img" aria-label="${attr(title)}" preserveAspectRatio="xMidYMid meet">${bands}${nodes}</svg>`;
}
