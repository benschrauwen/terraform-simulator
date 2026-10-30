/* Datacenter center-column views: the Sankey flows, the to-scale plant layout and the project
   timeline, checked against independent truths (proportionality, conservation, geometry, the
   schedule's critical path) on real model results. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { NUCLEAR_TYPES } from '../../js/data/datacenter/power.js';
import { calculateDatacenterScenario } from '../../js/model/datacenter/index.js';
import { buildPlantLayout, packRectangles, renderPlantLayoutSvg } from '../../js/ui/datacenter/plant-layout.js';
import { buildSankeyLayout, renderSankeySvg } from '../../js/ui/datacenter/sankey.js';
import { buildTimelineRows, renderTimelineSvg, timelineHeadline } from '../../js/ui/datacenter/timeline.js';

const close = (actual, expected, rel = 1e-9, label = '') => assert.ok(
  Math.abs(actual - expected) <= rel * Math.max(1, Math.abs(expected)),
  `${label} expected ${expected}, got ${actual}`,
);

const HYBRID = { architecture: 'hybrid', solarSizeMWdc: 400, batteryCapacityMWh: 800, gridConnection: 'flexible' };
const hybrid = calculateDatacenterScenario(HYBRID);
const baseline = calculateDatacenterScenario({});

/* ---------- Sankey ---------- */

test('sankey band widths and node heights are proportional to the flows', () => {
  ['electricity', 'heat'].forEach(kind => {
    const layout = buildSankeyLayout(hybrid.flows[kind], hybrid.flows.labels);
    assert.ok(layout.links.length >= 4, `${kind}: expected several links`);
    // One scale for every band: width / value is the same constant.
    layout.links.forEach(link => close(link.width / link.value, layout.scale, 1e-12, `${kind} ${link.from}->${link.to}`));
    // A node's height is its throughput (max of in and out) on the same scale.
    layout.nodes.forEach(node => close(node.y1 - node.y0, Math.max(node.inValue, node.outValue) * layout.scale, 1e-9, node.id));
    // Bands leaving a node fill it from the top without gaps: their widths sum to its outflow.
    layout.nodes.filter(node => node.outgoing.length).forEach(node => {
      const sum = node.outgoing.reduce((total, link) => total + link.width, 0);
      close(sum, node.outValue * layout.scale, 1e-9, `${node.id} outflow`);
    });
  });
});

test('sankey electricity totals balance: what the sources supply reaches the sinks', () => {
  const layout = buildSankeyLayout(hybrid.flows.electricity, hybrid.flows.labels);
  close(layout.totals.in, layout.totals.out, 1e-9, 'in vs out');
  const a = hybrid.dispatch.annual;
  // Sources: solar + grid + gas generation (the battery is an intermediate node).
  close(layout.totals.in, a.solarMWh + a.gridMWh + a.gasMWh + a.nuclearMWh, 1e-6, 'source total');
  // The facility node passes on exactly what it gets: IT + cooling + distribution losses.
  const facility = layout.nodes.find(node => node.id === 'facility');
  close(facility.inValue, facility.outValue, 1e-9, 'facility balance');
  close(facility.outValue, hybrid.energy.facilityServedMWh, 1e-6, 'facility = served facility energy');
});

test('sankey places sources in the first column, sinks in the last and stays inside the view', () => {
  const layout = buildSankeyLayout(hybrid.flows.electricity, hybrid.flows.labels);
  const last = layout.columns.length - 1;
  layout.nodes.forEach(node => {
    if (!node.incoming.length) assert.equal(node.depth, 0, `${node.id} is a source`);
    if (!node.outgoing.length) assert.equal(node.depth, last, `${node.id} is a sink`);
    assert.ok(node.y0 >= 0 && node.y1 <= layout.height + 1e-9, `${node.id} inside the view`);
  });
  // Every band starts at its source's right edge and ends at its target's left edge, between columns.
  layout.links.forEach(link => assert.ok(link.target.depth > link.source.depth, `${link.from}->${link.to} runs left to right`));
});

test('sankey SVG escapes labels, uses no style attributes and handles empty flows', () => {
  const layout = buildSankeyLayout(
    [{ from: 'a', to: 'b', value: 10, unit: 'MWh/yr' }, { from: 'b', to: 'c', value: 4, unit: 'MWh/yr' }],
    { a: '<img src=x onerror=alert(1)>', b: 'B & co', c: 'C' },
  );
  const svg = renderSankeySvg(layout, { title: 'Test "flows"' });
  assert.doesNotMatch(svg, /<img/);
  assert.match(svg, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(svg, /B &amp; co/);
  assert.doesNotMatch(svg, /\sstyle=/);
  assert.equal(buildSankeyLayout([], {}).nodes.length, 0);
  assert.equal(renderSankeySvg(buildSankeyLayout([], {})), '');
});

/* ---------- Plant layout ---------- */

function overlaps(a, b) {
  return a.x < b.x + b.w - 1e-6 && b.x < a.x + a.w - 1e-6 && a.y < b.y + b.h - 1e-6 && b.y < a.y + a.h - 1e-6;
}

test('plant layout areas are proportional to the footprint areas (one scale for all blocks)', () => {
  [baseline, hybrid, calculateDatacenterScenario({ firmFamily: 'nuclear', nuclearType: 'bwrx-300' })].forEach(r => {
    const layout = buildPlantLayout(r);
    const areas = r.footprint.areasM2;
    const expectedKeys = Object.keys(areas).filter(key => areas[key] > 0).sort();
    assert.deepEqual(layout.blocks.map(block => block.key).sort(), expectedKeys);
    layout.blocks.forEach(block => {
      close(block.w * block.h, areas[block.key] * layout.pxPerM ** 2, 1e-9, `${block.key} area`);
    });
    close(layout.blocks.reduce((sum, block) => sum + block.share, 0), 1, 1e-12, 'shares');
    // Blocks do not overlap and stay inside the view.
    layout.blocks.forEach((a, i) => {
      assert.ok(a.x >= 0 && a.x + a.w <= layout.width + 1e-6, `${a.key} inside width`);
      assert.ok(a.y + a.h <= layout.height + 1e-6, `${a.key} inside height`);
      layout.blocks.slice(i + 1).forEach(b => assert.ok(!overlaps(a, b), `${a.key} overlaps ${b.key}`));
    });
  });
});

test('a 1 GWdc solar field visibly dwarfs the building in the layout', () => {
  const r = calculateDatacenterScenario({ solarSizeMWdc: 1000 });
  const layout = buildPlantLayout(r);
  const solar = layout.blocks.find(block => block.key === 'solarField');
  const building = layout.blocks.find(block => block.key === 'building');
  const ratio = r.footprint.areasM2.solarField / r.footprint.areasM2.building;
  assert.ok(ratio > 50, `solar / building footprint ${ratio}`);
  close((solar.w * solar.h) / (building.w * building.h), ratio, 1e-9, 'drawn area ratio');
  // The grid-tie label is escaped (the option moved from a scale-bar label to the transmission line).
  const svg = renderPlantLayoutSvg({ ...layout, gridTie: { ...layout.gridTie, label: 'Grid <131 MW>' } });
  assert.match(svg, /data-key="solarField"/);
  assert.match(svg, /Grid &lt;131 MW&gt;/);
  assert.doesNotMatch(svg, /\sstyle=/);
});

test('skyline packing never overlaps and reports the used height', () => {
  const rects = [{ w: 50, h: 40 }, { w: 30, h: 30 }, { w: 30, h: 10 }, { w: 60, h: 5 }, { w: 20, h: 20 }];
  const { placed, height } = packRectangles(rects, 100, 2);
  placed.forEach((a, i) => placed.slice(i + 1).forEach(b => assert.ok(!overlaps(a, b))));
  assert.equal(height, Math.max(...placed.map(p => p.y + p.h)));
  assert.equal(packRectangles([{ w: 120, h: 1 }], 100, 0), null);
});

/* ---------- Timeline ---------- */

test('timeline flags exactly the schedule critical path and its segments add up to each duration', () => {
  [baseline, hybrid, calculateDatacenterScenario({ architecture: 'islanded', firmFamily: 'gas' })].forEach(r => {
    const rows = buildTimelineRows(r.schedule);
    const critical = rows.filter(row => row.critical);
    assert.equal(critical.length, 1);
    assert.equal(critical[0].id, r.schedule.criticalPath.id);
    // The critical path is the slowest required one.
    const slowest = Math.max(...rows.filter(row => row.required).map(row => row.durationMonths));
    assert.equal(critical[0].durationMonths, slowest);
    rows.forEach(row => close(row.segments.reduce((sum, s) => sum + s.months, 0), row.durationMonths, 1e-9, row.id));
    const svg = renderTimelineSvg(r.schedule);
    assert.equal((svg.match(/data-critical="true"/g) || []).length, 1);
    assert.match(svg, new RegExp(`data-path="${critical[0].id}" data-critical="true"`));
    assert.doesNotMatch(svg, /\sstyle=/);
  });
  assert.match(timelineHeadline(baseline.schedule), /^Slowest path: .+, \d+ months → first power [A-Z][a-z]{2} \d{4}$/);
});

test('timeline shows the wait for a reactor\'s earliest commercial operation', () => {
  // A fast case and a short scale make licensing + build end before the COD year.
  const r = calculateDatacenterScenario({ architecture: 'islanded', firmFamily: 'nuclear', nuclearType: 'bwrx-300', scheduleCase: 'low', scheduleScalePercent: 50 });
  const row = buildTimelineRows(r.schedule).find(path => path.id === NUCLEAR_TYPES['bwrx-300'].leadTimeKey);
  assert.ok(row, 'reactor path');
  const wait = row.segments.find(segment => segment.key === 'waitForCodMonths');
  assert.ok(wait && wait.months > 0, 'reactor waits for COD');
  assert.equal(row.earliestCodYear, NUCLEAR_TYPES['bwrx-300'].earliestCodYear);
  // It finishes in January of the COD year (notice-to-proceed + duration).
  assert.equal(row.finish.year, NUCLEAR_TYPES['bwrx-300'].earliestCodYear);
  assert.match(renderTimelineSvg(r.schedule), new RegExp(`COD ≥ ${NUCLEAR_TYPES['bwrx-300'].earliestCodYear}`));
});
