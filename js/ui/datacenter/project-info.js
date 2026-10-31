/* "Real project" info block (Site section): what is publicly known about the project the design
   was prefilled from (data/datacenter/projects.js), each fact linked to its source, and what the
   design assumes beyond the sources. Pure HTML; every value is escaped. */

import { getDatacenterProject } from '../../data/datacenter/projects.js';
import { escapeAttribute as attr, escapeHtml as esc } from '../renderers/markup.js';
import { note } from './info-panels.js';

const BASIS_LABELS = { 'search index': 'search index', estimate: 'Epoch AI estimate', inferred: 'inferred' };

function factItem(fact) {
  const basis = BASIS_LABELS[fact.basis] ? ` <span class="dc-project-basis">(${esc(BASIS_LABELS[fact.basis])})</span>` : '';
  const source = fact.source
    ? ` <a class="dc-project-source" href="${attr(fact.source)}" target="_blank" rel="noreferrer">${esc(fact.date || 'source')}</a>`
    : '';
  return `<li><span class="dc-project-fact-label">${esc(fact.label)}</span> <span class="dc-project-fact-value">${esc(fact.value)}</span>${source}${basis}</li>`;
}

/** The block for a state: the project's facts, or how to pick one. */
export function projectInfo(state) {
  const project = getDatacenterProject(state.projectId);
  if (!project) {
    return note('Pick a real project to prefill its site, IT size, GPUs, cooling and power plant from public sources, then check its economics. Your prices, revenue and finance settings are kept.');
  }
  return [
    `<p class="dc-info-lead"><strong>${esc(project.name)}</strong> · ${esc(project.operator)} · ${esc(project.status)}</p>`,
    `<p class="dc-project-summary">${esc(project.summary)}</p>`,
    project.location ? note(project.location) : '',
    `<ul class="dc-project-facts">${(project.facts || []).map(factItem).join('')}</ul>`,
    (project.assumptions || []).length
      ? `<details class="dc-project-assumptions"><summary>What the design assumes</summary><ul>${project.assumptions.map(text => `<li>${esc(text)}</li>`).join('')}</ul></details>`
      : '',
    note('The timeline and economics treat it as a new build starting now (not the project\'s real dates), at your prices. Edit anything to test alternatives; picking another site clears the project.'),
  ].join('');
}

export const PROJECT_BLOCK_RENDERERS = { projectInfo };
