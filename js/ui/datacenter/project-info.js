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
  const facts = project.facts || [];
  const assumptions = project.assumptions || [];
  return [
    `<p class="dc-info-lead"><strong>${esc(project.name)}</strong> · ${esc(project.status)}</p>`,
    `<p class="dc-project-summary">${esc(project.summary)}</p>`,
    `<details class="dc-project-details"><summary>Public facts (${facts.length})</summary>
      <p class="dc-project-meta">${esc(project.operator)}${project.location ? ` · ${esc(project.location)}` : ''}</p>
      <ul class="dc-project-facts">${facts.map(factItem).join('')}</ul>
    </details>`,
    assumptions.length
      ? `<details class="dc-project-details"><summary>What the design assumes (${assumptions.length})</summary><ul class="dc-project-assumptions">${assumptions.map(text => `<li>${esc(text)}</li>`).join('')}</ul>
        <p class="dc-project-meta">The timeline and economics treat it as a new build starting now (not the project's real dates), at your prices. Edit anything to test alternatives; picking another site clears the project.</p>
      </details>`
      : '',
  ].join('');
}

export const PROJECT_BLOCK_RENDERERS = { projectInfo };
