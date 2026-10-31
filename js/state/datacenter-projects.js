/* Real-project presets (data/datacenter/projects.js) applied to a datacenter state. Pure. */

import { getDatacenterProject } from '../data/datacenter/projects.js';
import { applyArchitectureDefaults, applyDatacenterPresetDefaults, normalizeDatacenterState } from './datacenter-schema.js';

// Design fields a project may set directly, after its selections.
const DESIGN_FIELDS = [
  'itCapacityMW', 'gridConnection', 'solarSizeMWdc', 'batteryCapacityMWh', 'batteryDurationHours',
  'firmFamily', 'firmSizingMode', 'firmUnits', 'firmSpareUnits', 'firmExtraUnits', 'gasUnitSizeMW', 'gridImportCapMW',
];
// Selections whose preset values reset when the project changes them (in this order).
const SELECTIONS = ['gpuPlatform', 'coolingTechnology'];
const TYPE_SELECTIONS = ['gasType', 'nuclearType'];

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
  let next = applyDatacenterPresetDefaults({ ...state, siteId: project.siteId }, 'siteId');
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
