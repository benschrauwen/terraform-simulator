/* Real-project presets (data/datacenter/projects.js) applied to a datacenter state. Pure. */

import { getDatacenterProject } from '../data/datacenter/projects.js';
import { applyArchitectureDefaults, applyDatacenterPresetDefaults, DATACENTER_DEFAULT_STATE, normalizeDatacenterState } from './datacenter-schema.js';

// Design fields a project may set directly, after its selections.
const DESIGN_FIELDS = [
  'itCapacityMW', 'gridConnection', 'solarSizeMWdc', 'batteryCapacityMWh', 'batteryDurationHours',
  'firmFamily', 'firmSizingMode', 'firmUnits', 'firmSpareUnits', 'firmExtraUnits', 'gasUnitSizeMW', 'gridImportCapMW',
  'backupDieselMode', 'backupDieselUnits',
];
// Selections whose preset values reset when the project changes them (in this order).
const SELECTIONS = ['gpuPlatform', 'coolingTechnology'];
const TYPE_SELECTIONS = ['gasType', 'nuclearType'];

/**
 * `state` with the fields the current project set (its design) back at their
 * defaults, so switching from one project to another never keeps the first
 * one's grid cap, GPUs or unit size; the user's own settings stay.
 */
function withoutProject(state) {
  const previous = getDatacenterProject(state?.projectId);
  if (!previous) return state;
  let next = { ...state };
  Object.keys(previous.design || {}).forEach(key => {
    if (key in DATACENTER_DEFAULT_STATE) next[key] = DATACENTER_DEFAULT_STATE[key];
  });
  [...SELECTIONS, ...TYPE_SELECTIONS].forEach(key => {
    if (key in (previous.design || {})) next = applyDatacenterPresetDefaults(next, key);
  });
  return next;
}

/**
 * The state after leaving the current project for a custom design (another
 * site picked): the project's design goes back to the defaults (the default
 * architecture's starting design when the project set one), since it
 * belongs to the project's own site; the user's settings and the new site stay.
 */
export function clearDatacenterProject(state) {
  const previous = getDatacenterProject(state?.projectId);
  let next = withoutProject(state);
  if (previous?.design?.architecture) next = applyArchitectureDefaults(next, DATACENTER_DEFAULT_STATE.architecture);
  return normalizeDatacenterState({ ...next, projectId: 'none' });
}

/**
 * The state after picking project `projectId`: its site (with the site's
 * prices and climate), IT size, GPU platform and cooling, then its
 * architecture's starting design, then the generator types and the design
 * fields it states. Prices, revenue, finance and schedule settings stay the
 * user's. An unknown id (or 'none') only clears the project.
 */
export function applyDatacenterProject(state, projectId) {
  const project = getDatacenterProject(projectId);
  if (!project) return normalizeDatacenterState({ ...state, projectId: 'none' });
  const design = project.design || {};
  let next = applyDatacenterPresetDefaults({ ...withoutProject(state), siteId: project.siteId }, 'siteId');
  if (design.itCapacityMW) next = { ...next, itCapacityMW: design.itCapacityMW };
  SELECTIONS.forEach(key => {
    if (design[key] && design[key] !== next[key]) next = applyDatacenterPresetDefaults({ ...next, [key]: design[key] }, key);
  });
  if (design.architecture) next = applyArchitectureDefaults(next, design.architecture);
  TYPE_SELECTIONS.forEach(key => {
    if (design[key] && design[key] !== next[key]) next = applyDatacenterPresetDefaults({ ...next, [key]: design[key] }, key);
  });
  const fields = Object.fromEntries(DESIGN_FIELDS.filter(key => design[key] !== undefined).map(key => [key, design[key]]));
  return normalizeDatacenterState({ ...next, ...fields, projectId: project.id });
}
