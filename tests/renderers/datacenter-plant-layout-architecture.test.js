/* The plant layout diagram (plant-layout.js) follows the power architecture, checked on the
   starting design of each architecture against independent truths: drawn areas = footprint
   areas, no overlaps, the blocks each design has, and the grid tie only when grid-connected.
   The note shown after an architecture switch is checked too. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildStartingDesign, calculateDatacenterScenario, DATACENTER_DEFAULT_STATE } from '../../js/model/datacenter/index.js';
import { describeStartingDesign } from '../../js/ui/datacenter/controls.js';
import { buildPlantLayout, PLANT_BLOCKS, renderPlantLayoutSvg } from '../../js/ui/datacenter/plant-layout.js';

const designs = Object.fromEntries(['grid', 'hybrid', 'islanded'].map(a => [a, buildStartingDesign(DATACENTER_DEFAULT_STATE, a)]));
const results = Object.fromEntries(Object.entries(designs).map(([key, design]) => [key, calculateDatacenterScenario(design.state)]));
const close = (actual, expected, rel, label) => assert.ok(Math.abs(actual - expected) <= rel * Math.max(1, Math.abs(expected)), `${label}: expected ${expected}, got ${actual}`);
const overlaps = (a, b) => a.x < b.x + b.w - 1e-6 && b.x < a.x + a.w - 1e-6 && a.y < b.y + b.h - 1e-6 && b.y < a.y + a.h - 1e-6;
const positiveKeys = r => Object.keys(r.footprint.areasM2).filter(key => r.footprint.areasM2[key] > 0).sort();

test('every footprint area has a plan block and the diagram draws exactly the non-zero ones', () => {
  const footprintKeys = Object.keys(results.grid.footprint.areasM2).sort();
  assert.deepEqual(PLANT_BLOCKS.map(block => block.key).sort(), footprintKeys);
  Object.entries(results).forEach(([architecture, r]) => {
    const layout = buildPlantLayout(r);
    assert.deepEqual(layout.blocks.map(block => block.key).sort(), positiveKeys(r), architecture);
    layout.blocks.forEach(block => close(block.w * block.h, r.footprint.areasM2[block.key] * layout.pxPerM ** 2, 1e-9, `${architecture} ${block.key}`));
    layout.blocks.forEach((a, i) => layout.blocks.slice(i + 1).forEach(b => assert.ok(!overlaps(a, b), `${architecture}: ${a.key} overlaps ${b.key}`)));
  });
});

test('the diagram blocks differ between architectures as their designs do', () => {
  const keys = Object.fromEntries(Object.entries(results).map(([key, r]) => [key, buildPlantLayout(r).blocks.map(block => block.key)]));
  assert.ok(keys.grid.includes('utilitySwitchyard') && keys.grid.includes('gasPlant'));
  assert.ok(!keys.grid.includes('solarField') && !keys.grid.includes('battery'));
  ['solarField', 'battery', 'gasPlant', 'utilitySwitchyard'].forEach(key => assert.ok(keys.hybrid.includes(key), `hybrid ${key}`));
  assert.ok(!keys.islanded.includes('utilitySwitchyard') && !keys.islanded.includes('solarField') && keys.islanded.includes('gasPlant'));
  assert.notDeepEqual(keys.grid.slice().sort(), keys.hybrid.slice().sort());
  assert.notDeepEqual(keys.grid.slice().sort(), keys.islanded.slice().sort());
});

test('the transmission line is drawn only when grid-connected and taps into the switchyard', () => {
  ['grid', 'hybrid'].forEach(architecture => {
    const layout = buildPlantLayout(results[architecture]);
    const { gridTie } = layout;
    assert.equal(gridTie.connection, architecture === 'grid' ? 'firm' : 'flexible');
    assert.match(gridTie.label, architecture === 'grid' ? /firm service/ : /flexible connection, curtailable 50 h\/yr/);
    const switchyard = layout.blocks.find(block => block.key === 'utilitySwitchyard');
    // The tap runs from the line down to the switchyard's top edge, inside its width, crossing no other block.
    assert.ok(gridTie.tap.x > switchyard.x && gridTie.tap.x < switchyard.x + switchyard.w);
    assert.equal(gridTie.tap.y2, switchyard.y);
    assert.ok(gridTie.line.y < gridTie.tap.y2);
    const tapBox = { x: gridTie.tap.x, w: 1e-3, y: gridTie.tap.y1, h: gridTie.tap.y2 - gridTie.tap.y1 };
    layout.blocks.forEach(block => assert.ok(!overlaps(tapBox, block), `tap crosses ${block.key}`));
    // The tie to the on-site substation spans just the road between them.
    const substation = layout.blocks.find(block => block.key === 'substation');
    assert.equal(gridTie.tie.x1, switchyard.x + switchyard.w);
    assert.equal(gridTie.tie.x2, substation.x);
    const svg = renderPlantLayoutSvg(layout);
    assert.match(svg, new RegExp(`class="pl-gridtie pl-gridtie-${gridTie.connection}"`));
    assert.match(svg, /data-key="utilitySwitchyard"/);
    assert.doesNotMatch(svg, /\sstyle=/);
  });
  const islanded = buildPlantLayout(results.islanded);
  assert.equal(islanded.gridTie, null);
  const svg = renderPlantLayoutSvg(islanded);
  assert.doesNotMatch(svg, /pl-gridtie|pl-transmission|utilitySwitchyard/);
  assert.match(svg, /Islanded: no grid connection/);
});

/* ---------- Architecture note ---------- */

test('the architecture note names the starting design', () => {
  assert.equal(
    describeStartingDesign(designs.hybrid.result, designs.hybrid.addedUnits),
    'Applied a starting design for Hybrid (grid + on-site): flexible grid connection (131 MW, curtailable 50 h/yr), 200 MWdc east-west fixed solar, 400 MWh / 100 MW battery, 5 × 10.0 MW reciprocating gas engines (N+1 with the battery); adjust the sizes or use Optimize design.',
  );
  assert.match(describeStartingDesign(designs.grid.result), /^Applied a starting design for Grid-connected: firm grid connection \(131 MW\), 15 × 10.0 MW reciprocating gas engines \(N\+1 standby\), no solar or battery; /);
  assert.match(describeStartingDesign(designs.islanded.result), /^Applied a starting design for Islanded \(off-grid\): no grid connection, 16 × 10.0 MW reciprocating gas engines \(N\+2\), no solar or battery; /);
  assert.match(describeStartingDesign(designs.hybrid.result, 3), /\(N\+1 with the battery, 3 added to meet the uptime target\)/);
});
