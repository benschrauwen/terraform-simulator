/* Center-column SVG views: the to-scale plant layout, the Sankey flow tabs (electricity, heat,
   water, CO2) and the project timeline. Each view is rendered by a pure builder (plant-layout.js,
   sankey.js, timeline.js); this mixin wires them to the DOM. */

import { escapeHtml as esc } from '../renderers/markup.js';
import { fixed, formatArea, formatFlowValue, formatYearMonth } from './format.js';
import { buildPlantLayout, renderPlantLayoutSvg, renderPlantLegend } from './plant-layout.js';
import { buildSankeyLayout, renderSankeySvg } from './sankey.js';
import { renderTimelineLegend, renderTimelineSvg, timelineHeadline } from './timeline.js';

const FLOW_KINDS = ['electricity', 'heat', 'water', 'co2'];

const FLOW_TITLES = { electricity: 'Electricity', heat: 'Heat', water: 'Water', co2: 'CO₂' };

/** One-line explanation per flow tab (basis and caveats). */
export function flowNote(kind, r) {
  const site = r.site || {};
  switch (kind) {
    case 'electricity':
      return 'Annual electricity from each source to the facility and on to IT, cooling and power-distribution losses; band widths are to scale. Surplus solar or nuclear goes to the battery, export or curtailment.';
    case 'heat':
      return 'Every MWh the facility uses ends up as heat: rejected to the air (sensible) or carried off as evaporated water (latent). Generator and reactor waste heat is shown separately.';
    case 'water':
      return 'Water withdrawn by evaporative cooling and on-site generation; what is not evaporated returns as blowdown. Closed-loop dry cooling and dry gas plants use none.';
    case 'co2':
      return site.country && site.country !== 'US'
        ? 'Combustion CO₂ only: gas at 52.91 kg/MMBtu (EIA); grid at Ember\'s lifecycle intensity for this EU country (includes upstream, so not like-for-like with US eGRID direct rates). No upstream methane or embodied carbon.'
        : 'Combustion CO₂ only: gas at 52.91 kg/MMBtu (EIA) and grid imports at the eGRID subregion\'s direct output rate. No upstream methane, embodied carbon or credit for exports.';
    default:
      return '';
  }
}

const EMPTY_FLOW_TEXT = {
  electricity: 'No electricity flows.',
  heat: 'No heat flows.',
  water: 'No water use in this design: closed-loop cooling and dry generation.',
  co2: 'No direct CO₂ emissions in this design.',
};

export const viewMethods = {
  updatePlantLayout(r) {
    const container = document.getElementById('layoutView');
    if (!container) return;
    const layout = buildPlantLayout(r);
    // Packing order puts the grid tie first, so find the largest block by area.
    const largest = [...layout.blocks].sort((a, b) => b.areaM2 - a.areaM2)[0];
    const building = layout.blocks.find(block => block.key === 'building');
    const comparison = largest && building && largest !== building
      ? `The ${largest.name.toLowerCase()} covers ${fixed(largest.areaM2 / building.areaM2, largest.areaM2 / building.areaM2 >= 10 ? 0 : 1)}× the datacenter building's footprint.`
      : 'The datacenter building is the largest block.';
    const notes = [
      `Areas to scale (one scale for every block). Total ${formatArea(layout.totalM2)}. ${comparison}`,
      r.footprint.nuclearExclusionZone ? `Reactor emergency planning zone: ${r.footprint.nuclearExclusionZone}` : '',
    ].filter(Boolean);
    container.innerHTML = `<div class="dc-view-header"><h3>Plant layout <span class="chart-title-meta">— area to scale</span></h3></div>
      ${notes.map(text => `<div class="field-note compact-note">${esc(text)}</div>`).join('')}
      <div class="plant-layout-canvas">${renderPlantLayoutSvg(layout)}</div>
      ${renderPlantLegend(layout)}`;
  },

  bindFlowTabs() {
    this.activeFlow = 'electricity';
    const tabs = Array.from(document.querySelectorAll('#flowTabs [data-flow]'));
    const select = (tab, focus = false) => {
      this.activeFlow = tab.dataset.flow;
      tabs.forEach(item => {
        const active = item === tab;
        item.classList.toggle('active', active);
        item.setAttribute('aria-selected', String(active));
        item.setAttribute('tabindex', active ? '0' : '-1');
      });
      document.getElementById('flowView')?.setAttribute('aria-labelledby', tab.id);
      if (focus) tab.focus();
      if (this.lastResults) this.updateFlows(this.lastResults);
    };
    tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => select(tab));
      tab.addEventListener('keydown', event => {
        const moves = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
        let next = null;
        if (event.key in moves) next = tabs[(index + moves[event.key] + tabs.length) % tabs.length];
        if (event.key === 'Home') next = tabs[0];
        if (event.key === 'End') next = tabs[tabs.length - 1];
        if (!next) return;
        event.preventDefault();
        select(next, true);
      });
    });
  },

  updateFlows(r) {
    const view = document.getElementById('flowView');
    if (!view) return;
    const kind = FLOW_KINDS.includes(this.activeFlow) ? this.activeFlow : 'electricity';
    const layout = buildSankeyLayout(r.flows[kind] || [], r.flows.labels);
    const noteEl = document.getElementById('flowNote');
    if (noteEl) noteEl.textContent = flowNote(kind, r);
    const meta = document.getElementById('flowMeta');
    if (meta) {
      meta.textContent = layout.nodes.length
        ? `— ${FLOW_TITLES[kind]}: ${formatFlowValue(layout.totals.in, layout.unit)} in, ${formatFlowValue(layout.totals.out, layout.unit)} out`
        : `— ${FLOW_TITLES[kind]}`;
    }
    view.innerHTML = layout.nodes.length
      ? renderSankeySvg(layout, { title: `${FLOW_TITLES[kind]} flows` })
      : `<p class="dc-empty">${esc(EMPTY_FLOW_TEXT[kind])}</p>`;
  },

  updateTimeline(r) {
    const schedule = r.schedule;
    const headline = document.getElementById('timelineHeadline');
    if (headline) headline.textContent = timelineHeadline(schedule);
    const view = document.getElementById('timelineView');
    if (view) view.innerHTML = renderTimelineSvg(schedule);
    const legend = document.getElementById('timelineLegend');
    if (legend && !legend.childElementCount) legend.innerHTML = renderTimelineLegend();
    const note = document.getElementById('timelineNote');
    if (note) {
      const parts = [
        `All paths start at notice-to-proceed (${formatYearMonth(schedule.noticeToProceed)}) and run in parallel; first power waits for the slowest required one. Optional components do not delay it.`,
        'Revenue starts at first power, so a slower path lowers NPV.',
      ];
      const reactor = schedule.paths.find(path => path.waitForCodMonths > 0);
      if (reactor) parts.push(`${reactor.label} waits ${fixed(reactor.waitForCodMonths, 0)} months for its earliest commercial-operation year.`);
      note.textContent = parts.join(' ');
    }
  },
};
