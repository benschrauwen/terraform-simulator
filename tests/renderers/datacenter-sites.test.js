/*
 * Sites page: optimizeForSite moves the user's settings to a site and keeps the best
 * architecture's design; the card renders that design's financials, dispatch and footprint
 * and links to the simulator with it; the list sorts finished sites.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DATACENTER_SITES } from '../../js/data/datacenter/sites.js';
import { calculateDatacenterScenario, DATACENTER_DEFAULT_STATE, getDatacenterSite, optimizeForSite } from '../../js/model/datacenter/index.js';
import { fitsArchitecture, normalizeDatacenterState } from '../../js/state/datacenter-schema.js';
import { averageDayDispatch, designSummary, renderDispatchMiniSvg, renderSiteCard, servedSharesText } from '../../js/ui/datacenter/site-card.js';
import { settingsSummary, sortSiteEntries } from '../../js/ui/datacenter/sites-page.js';

const surveys = new Map();
const surveyFor = siteId => {
  if (!surveys.has(siteId)) surveys.set(siteId, optimizeForSite(DATACENTER_DEFAULT_STATE, siteId));
  return surveys.get(siteId);
};

test('optimizeForSite resets the site-driven inputs, keeps the user settings and returns the best architecture', () => {
  const base = { ...DATACENTER_DEFAULT_STATE, itCapacityMW: 100, gridEnergyPricePerMWh: 12.34, gpuRentalPricePerHour: 4.5 };
  const survey = optimizeForSite(base, 'dublin-ie', { budget: 300 });
  const site = getDatacenterSite('dublin-ie');
  assert.equal(survey.siteId, 'dublin-ie');
  assert.equal(survey.state.siteId, 'dublin-ie');
  // The site's grid price replaces the user's override; non-site settings stay.
  assert.equal(survey.state.gridEnergyPricePerMWh, site.electricityPriceAltUsdPerMWh);
  assert.equal(survey.state.gpuRentalPricePerHour, 4.5);
  assert.deepEqual(survey.architectures.map(row => row.architecture), ['grid', 'hybrid', 'islanded']);
  assert.ok(fitsArchitecture(survey.state, survey.bestArchitecture));
  const best = survey.architectures.find(row => row.architecture === survey.bestArchitecture);
  survey.architectures.forEach(row => {
    if (row.feasible) assert.ok(best.npv >= row.npv - 1e-6 * Math.abs(row.npv), row.architecture);
  });
  // The returned state reproduces the reported NPV.
  const result = calculateDatacenterScenario(normalizeDatacenterState(survey.state), { fastMode: true });
  assert.ok(Math.abs(result.economics.npv - best.npv) < 1, `${result.economics.npv} vs ${best.npv}`);
});

test('the site card shows financials, design, dispatch and footprint and links to the design', () => {
  const survey = surveyFor('phoenix-az');
  const result = calculateDatacenterScenario(survey.state);
  const site = DATACENTER_SITES.find(entry => entry.id === 'phoenix-az');
  const html = renderSiteCard({ site, survey, result, rank: 2, href: 'datacenter.html#s=abc', maxFootprintM2: result.footprint.totalM2 * 2 });
  assert.match(html, /<a class="site-card-link" href="datacenter\.html#s=abc"/);
  assert.match(html, /data-site-id="phoenix-az"/);
  ['NPV', 'Project IRR', 'Break-even', 'CAPEX', 'Power cost', 'First power', 'Uptime'].forEach(label => assert.match(html, new RegExp(`<dt>${label}</dt>`)));
  assert.match(html, /class="site-dispatch-svg"/);
  assert.match(html, /class="plant-layout-svg"/);
  assert.match(html, /class="site-footprint-legend"/);
  assert.match(html, /50% of the largest site's footprint/);
  assert.equal((html.match(/class="site-arch[ "]/g) || []).length, 3);
  assert.match(html, /site-arch is-best/);
  assert.doesNotMatch(html, /NaN|undefined|Infinity/);
  assert.doesNotMatch(html, /\sstyle=/);
  assert.ok(designSummary(result).length > 0);
  assert.match(servedSharesText(result), /%/);
});

test('the mini dispatch stacks supply above zero and surplus below, scaled to fit', () => {
  const survey = surveyFor('phoenix-az');
  const result = calculateDatacenterScenario(survey.state);
  const data = averageDayDispatch(result.dispatch);
  assert.equal(data.load.length, 24);
  const svg = renderDispatchMiniSvg(result.dispatch);
  const rects = [...svg.matchAll(/<rect x="([\d.]+)" y="([\d.-]+)" width="([\d.]+)" height="([\d.]+)"/g)].map(match => match.slice(1).map(Number));
  assert.ok(rects.length > 24);
  rects.forEach(([x, y, w, h]) => {
    assert.ok(x >= 0 && x + w <= 320 + 1e-6, `x ${x}`);
    assert.ok(y >= 0 && y + h <= 132 + 1e-6, `y ${y} h ${h}`);
  });
  assert.equal(renderDispatchMiniSvg(null), '');
});

test('finished sites sort by the chosen metric', () => {
  const entries = ['phoenix-az', 'dublin-ie'].map(siteId => {
    const survey = surveyFor(siteId);
    return { site: DATACENTER_SITES.find(entry => entry.id === siteId), survey, result: calculateDatacenterScenario(survey.state) };
  });
  const byNpv = sortSiteEntries(entries, 'npv');
  assert.ok(byNpv[0].result.economics.npv >= byNpv[1].result.economics.npv);
  const byName = sortSiteEntries(entries, 'name').map(entry => entry.site.id);
  assert.deepEqual(byName, ['dublin-ie', 'phoenix-az']);
  const byFootprint = sortSiteEntries(entries, 'footprint');
  assert.ok(byFootprint[0].result.footprint.totalM2 <= byFootprint[1].result.footprint.totalM2);
  assert.match(settingsSummary(DATACENTER_DEFAULT_STATE), /MW IT/);
});
