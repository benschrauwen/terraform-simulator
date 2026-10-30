/* The plant layout's Map view geometry (plant-map.js) on each architecture's starting design:
   true block areas, roads between blocks, the solar field east of the campus, the transmission
   line only when grid-connected, and true ground distances on the map (haversine, independent
   of the flat-earth conversion the map uses). The Leaflet drawing itself is checked in the
   browser. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildStartingDesign, calculateDatacenterScenario, DATACENTER_DEFAULT_STATE } from '../../js/model/datacenter/index.js';
import { blockLatLngBounds, buildPlantMapLayout, MAP_LAYOUT } from '../../js/ui/datacenter/plant-map.js';

const results = Object.fromEntries(['grid', 'hybrid', 'islanded'].map(a => [a, calculateDatacenterScenario(buildStartingDesign(DATACENTER_DEFAULT_STATE, a).state)]));
const close = (actual, expected, rel, label) => assert.ok(Math.abs(actual - expected) <= rel * Math.max(1, Math.abs(expected)), `${label}: expected ${expected}, got ${actual}`);
const positiveKeys = r => Object.keys(r.footprint.areasM2).filter(key => r.footprint.areasM2[key] > 0).sort();

const EARTH_RADIUS_M = 6371008.8;
function haversineM([lat1, lon1], [lat2, lon2]) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

test('map blocks keep their true areas, do not overlap and are separated by roads', () => {
  Object.entries(results).forEach(([architecture, r]) => {
    const map = buildPlantMapLayout(r);
    assert.deepEqual(map.blocks.map(block => block.key).sort(), positiveKeys(r), architecture);
    map.blocks.forEach(block => close(block.w * block.h, r.footprint.areasM2[block.key], 1e-9, `${architecture} ${block.key} m2`));
    close(map.totalM2, r.footprint.totalM2, 1e-9, `${architecture} total`);
    map.blocks.forEach((a, i) => map.blocks.slice(i + 1).forEach(b => {
      // Separation along the axis where the two do not overlap: at least a road (15 m; 30 m to the solar field).
      const gapX = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
      const gapY = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
      const road = a.key === 'solarField' || b.key === 'solarField' ? MAP_LAYOUT.solarRoadM : MAP_LAYOUT.roadM;
      assert.ok(Math.max(gapX, gapY) >= road - 1e-6, `${architecture}: ${a.key} / ${b.key} ${gapX} ${gapY}`);
    }));
    // All blocks inside the reported bounds; the site pin (origin) inside the campus.
    map.blocks.forEach(block => {
      assert.ok(block.x >= map.bounds.minX - 1e-9 && block.x + block.w <= map.bounds.maxX + 1e-9, `${block.key} x`);
      assert.ok(block.y >= map.bounds.minY - 1e-9 && block.y + block.h <= map.bounds.maxY + 1e-9, `${block.key} y`);
    });
    const campus = map.blocks.filter(block => block.key !== 'solarField');
    assert.ok(Math.min(...campus.map(b => b.x)) < 0 && Math.max(...campus.map(b => b.x + b.w)) > 0, 'pin inside the campus (x)');
    assert.ok(Math.min(...campus.map(b => b.y)) < 0 && Math.max(...campus.map(b => b.y + b.h)) > 0, 'pin inside the campus (y)');
  });
});

test('the map puts the solar field east of the campus and runs the line north from the switchyard', () => {
  const map = buildPlantMapLayout(results.hybrid);
  const solar = map.blocks.find(block => block.key === 'solarField');
  const campusEast = Math.max(...map.blocks.filter(block => block.key !== 'solarField').map(block => block.x + block.w));
  close(solar.x, campusEast + MAP_LAYOUT.solarRoadM, 1e-12, 'solar field across the road');
  const switchyard = map.blocks.find(block => block.key === 'utilitySwitchyard');
  assert.equal(map.line.connection, 'flexible');
  close(map.line.from.y, switchyard.y + switchyard.h, 1e-12, 'line starts at the switchyard north edge');
  assert.ok(map.line.to.y > map.bounds.maxY, 'line heads north, off the footprint');
  assert.equal(map.line.from.x, map.line.to.x);
  assert.equal(buildPlantMapLayout(results.grid).line.connection, 'firm');
  assert.equal(buildPlantMapLayout(results.islanded).line, null);
});

test('map rectangles have their true ground size at the site latitude', () => {
  [results.hybrid, calculateDatacenterScenario({ siteId: 'lulea-se' })].forEach(r => {
    const map = buildPlantMapLayout(r);
    map.blocks.forEach(block => {
      const [[south, west], [north, east]] = blockLatLngBounds(r.site.lat, r.site.lon, block);
      const midLat = (south + north) / 2;
      close(haversineM([midLat, west], [midLat, east]), block.w, 0.005, `${r.site.id} ${block.key} width`);
      close(haversineM([south, west], [north, west]), block.h, 0.005, `${r.site.id} ${block.key} height`);
    });
  });
});
