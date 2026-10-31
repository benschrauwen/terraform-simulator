/*
 * Real projects (data/datacenter/projects.js): every entry is complete and sourced, sits at a
 * site preset, and applying it gives a legal design with the project's stated fields that the
 * model can run; prices, revenue and finance settings stay the user's.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DATACENTER_PROJECTS, getDatacenterProject } from '../../js/data/datacenter/projects.js';
import { DATACENTER_SITES } from '../../js/data/datacenter/sites.js';
import { calculateDatacenterScenario, DATACENTER_DEFAULT_STATE } from '../../js/model/datacenter/index.js';
import { applyDatacenterProject } from '../../js/state/datacenter-projects.js';
import { fitsArchitecture, normalizeDatacenterState } from '../../js/state/datacenter-schema.js';
import { projectInfo } from '../../js/ui/datacenter/project-info.js';

const SITE_IDS = new Set(DATACENTER_SITES.map(site => site.id));

test('every project is complete, at a site preset, and every fact has a source', () => {
  assert.ok(DATACENTER_PROJECTS.length >= 4, `${DATACENTER_PROJECTS.length} projects`);
  const ids = new Set();
  DATACENTER_PROJECTS.forEach(project => {
    assert.ok(!ids.has(project.id), `duplicate ${project.id}`);
    ids.add(project.id);
    ['name', 'operator', 'status', 'summary'].forEach(key => assert.ok(project[key], `${project.id}.${key}`));
    assert.ok(SITE_IDS.has(project.siteId), `${project.id}: site ${project.siteId}`);
    assert.ok(project.facts.length >= 3, `${project.id}: facts`);
    project.facts.forEach(fact => {
      assert.ok(fact.label && fact.value, `${project.id}: fact ${JSON.stringify(fact)}`);
      if (fact.basis !== 'inferred') assert.match(fact.source || '', /^https:\/\//, `${project.id}: ${fact.label} needs a source`);
      if (fact.source) assert.match(fact.date || '', /^\d{4}(-\d{2}){0,2}$/, `${project.id}: ${fact.label} date`);
    });
  });
});

test('applying a project gives a legal design with its stated fields; the user settings stay', () => {
  const user = normalizeDatacenterState({ ...DATACENTER_DEFAULT_STATE, discountRate: 9.5, gpuPriceDeclinePercentPerYear: 12, financingEnabled: true });
  DATACENTER_PROJECTS.forEach(project => {
    const state = applyDatacenterProject(user, project.id);
    const design = project.design;
    assert.equal(state.projectId, project.id);
    assert.equal(state.siteId, project.siteId);
    Object.entries(design).forEach(([key, value]) => {
      if (key === 'architecture' || key in state) assert.equal(state[key], value, `${project.id}.${key}`);
    });
    assert.ok(fitsArchitecture(state, state.architecture), `${project.id} is legal for ${state.architecture}`);
    // Settings that are not the project's stay the user's.
    assert.equal(state.discountRate, 9.5);
    assert.equal(state.gpuPriceDeclinePercentPerYear, 12);
    assert.equal(state.financingEnabled, true);
    const r = calculateDatacenterScenario(state, { fastMode: true });
    assert.ok(Number.isFinite(r.economics.npv), `${project.id} NPV`);
    assert.ok(r.firm && r.schedule.energizationMonth > 0);
  });
});

test('none clears the project; the info block lists the facts with links', () => {
  const project = DATACENTER_PROJECTS[0];
  const state = applyDatacenterProject(DATACENTER_DEFAULT_STATE, project.id);
  assert.equal(applyDatacenterProject(state, 'none').projectId, 'none');
  assert.equal(getDatacenterProject('none'), null);
  const html = projectInfo(state);
  assert.equal((html.match(/<li>/g) || []).length >= project.facts.length, true);
  assert.match(html, /target="_blank" rel="noreferrer"/);
  assert.doesNotMatch(html, /undefined|NaN/);
  assert.match(projectInfo(DATACENTER_DEFAULT_STATE), /Pick a real project/);
});
