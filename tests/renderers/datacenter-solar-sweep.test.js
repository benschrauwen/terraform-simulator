/*
 * Hidden solar price sweep: the price is set as panel + BOS with the split kept, each point is
 * the best design across architectures at that price, and the page's datasets have one line per
 * project (CO2e) or per site (NPV), sorted by price.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DATACENTER_PROJECTS } from '../../js/data/datacenter/projects.js';
import { DATACENTER_SITES } from '../../js/data/datacenter/sites.js';
import { DATACENTER_DEFAULT_STATE, SOLAR_SWEEP_PRICES_PER_W, solarSweepPoint } from '../../js/model/datacenter/index.js';
import { withSolarPrice } from '../../js/model/datacenter/site-survey.js';
import { buildSweepDatasets, describePoint, listSweepPoints, pointKey } from '../../js/ui/datacenter/solar-sweep-page.js';

test('the solar price is panel + BOS at the given total, keeping their split', () => {
  const base = DATACENTER_DEFAULT_STATE;
  const share = base.panelCostPerW / (base.panelCostPerW + base.bosCostPerW);
  const priced = withSolarPrice(base, 0.4);
  assert.ok(Math.abs(priced.panelCostPerW + priced.bosCostPerW - 0.4) < 1e-12);
  assert.ok(Math.abs(priced.panelCostPerW / 0.4 - share) < 1e-12);
});

test('cheaper solar never lowers the best NPV, and the point reports its design', () => {
  const cheap = solarSweepPoint(DATACENTER_DEFAULT_STATE, { kind: 'site', id: 'abilene-tx', pricePerW: 0.2 }, { budget: 300 });
  const dear = solarSweepPoint(DATACENTER_DEFAULT_STATE, { kind: 'site', id: 'abilene-tx', pricePerW: 1.2 }, { budget: 300 });
  assert.ok(cheap.npv >= dear.npv - 1e-6 * Math.abs(dear.npv), `${cheap.npv} vs ${dear.npv}`);
  assert.ok(cheap.solarMWdc >= dear.solarMWdc);
  assert.ok(cheap.co2eT > 0 && cheap.feasible);
  const project = solarSweepPoint(DATACENTER_DEFAULT_STATE, { kind: 'project', id: 'meta-prometheus', pricePerW: 0.7 }, { budget: 200 });
  assert.equal(project.kind, 'project');
  assert.ok(Number.isFinite(project.npv) && project.co2eT > 0);
  assert.match(describePoint(project), /solar/);
});

test('the sweep covers every project and site at every price, one dataset each, sorted by price', () => {
  const points = listSweepPoints();
  assert.equal(points.length, (DATACENTER_PROJECTS.length + DATACENTER_SITES.length) * SOLAR_SWEEP_PRICES_PER_W.length);
  assert.equal(new Set(points.map(pointKey)).size, points.length);
  const fake = points.map(point => ({ ...point, npv: point.pricePerW, co2eT: 1000 * point.pricePerW }));
  const shuffled = [...fake].reverse();
  const co2 = buildSweepDatasets(shuffled, 'project', result => result.co2eT / 1000);
  const npv = buildSweepDatasets(shuffled, 'site', result => result.npv);
  assert.equal(co2.length, DATACENTER_PROJECTS.length);
  assert.equal(npv.length, DATACENTER_SITES.length);
  co2.forEach(dataset => {
    assert.equal(dataset.data.length, SOLAR_SWEEP_PRICES_PER_W.length);
    assert.deepEqual(dataset.data.map(point => point.x), [...SOLAR_SWEEP_PRICES_PER_W]);
  });
  assert.equal(new Set(npv.map(dataset => dataset.borderColor)).size, npv.length);
});
