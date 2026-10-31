/* Sites page (datacenter-sites.html): the user's settings (from the share hash) optimized at every
   site, one card per site (site-card.js). Each site runs optimizeForSite in a small pool of module
   workers (js/workers/datacenter-optimizer-worker.js), or on the main thread when workers are
   unavailable or fail; cards fill in as sites finish and the list re-sorts. Finished surveys are
   kept in sessionStorage per settings hash, so coming back from the simulator does not rerun them.
   A card links to the simulator with that site's optimized design in the share hash. */

import { DATACENTER_SITES } from '../../data/datacenter/sites.js';
import { COOLING_TECHNOLOGIES } from '../../data/datacenter/cooling.js';
import { GPU_PLATFORMS } from '../../data/datacenter/gpu.js';
import { calculateDatacenterScenario, optimizeForSite } from '../../model/datacenter/index.js';
import { escapeHtml as esc } from '../renderers/markup.js';
import { fixed, formatMW, formatUptime } from './format.js';
import { parseDatacenterHash, serializeDatacenterHash } from './share.js';
import { renderPendingSiteCard, renderSiteCard } from './site-card.js';

// Bump the version when model or data changes alter results, so stale sessions rerun.
const CACHE_PREFIX = 'abundance-sites:v4:';
const MAX_WORKERS = 4;

export const SITE_SORTS = Object.freeze({
  npv: { label: 'NPV', value: entry => entry.result.economics.npv, descending: true },
  irr: { label: 'Project IRR', value: entry => entry.result.economics.projectIrr ?? -Infinity, descending: true },
  firstPower: { label: 'First power', value: entry => entry.result.schedule.energizationMonth, descending: false },
  powerCost: { label: 'Power cost', value: entry => entry.result.economics.levelized?.costOfPowerPerMWh ?? Infinity, descending: false },
  footprint: { label: 'Footprint', value: entry => entry.result.footprint.totalM2, descending: false },
  name: { label: 'Name', value: entry => entry.site.name, descending: false },
});

/** Finished entries in sort order (ties keep the data order). */
export function sortSiteEntries(entries, sortKey = 'npv') {
  const sort = SITE_SORTS[sortKey] || SITE_SORTS.npv;
  return [...entries].sort((a, b) => {
    const x = sort.value(a);
    const y = sort.value(b);
    if (typeof x === 'string') return x.localeCompare(y);
    return sort.descending ? y - x : x - y;
  });
}

/** "100 MW IT · NVIDIA GB300 … · Direct-to-chip … · $5.00/GPU-hour · uptime 99.982%". */
export function settingsSummary(state) {
  return [
    `${formatMW(state.itCapacityMW)} IT`,
    GPU_PLATFORMS[state.gpuPlatform]?.label,
    COOLING_TECHNOLOGIES[state.coolingTechnology]?.label,
    `$${fixed(state.gpuRentalPricePerHour, 2)}/GPU-hour`,
    `uptime target ${formatUptime(state.uptimeTargetPercent)}`,
  ].filter(Boolean).join(' · ');
}

function readCache(key) {
  try {
    const raw = window.sessionStorage.getItem(CACHE_PREFIX + key);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeCache(key, surveys) {
  try {
    window.sessionStorage.setItem(CACHE_PREFIX + key, JSON.stringify(surveys));
  } catch {
    // Storage full or blocked: the page still works, it just reruns next time.
  }
}

export class DatacenterSitesPage {
  constructor() {
    const parsed = parseDatacenterHash(window.location.hash, window.LZString);
    this.baseState = parsed.state;
    this.baseHash = serializeDatacenterHash(this.baseState, window.LZString);
    this.sortKey = 'npv';
    this.entries = new Map(); // siteId -> { site, survey, result }
    this.failed = new Map(); // siteId -> message
    this.surveys = readCache(this.baseHash);
    this.running = new Set();
    this.bindControls();
    this.renderSettings();
    Object.values(this.surveys).forEach(survey => this.addSurvey(survey, { save: false }));
    this.render();
    this.runRemaining();
  }

  bindControls() {
    const back = document.getElementById('sitesBackLink');
    if (back) back.href = `datacenter.html${this.baseHash}`;
    const sort = document.getElementById('sitesSort');
    if (sort) {
      sort.innerHTML = Object.entries(SITE_SORTS).map(([key, { label }]) => `<option value="${esc(key)}">${esc(label)}</option>`).join('');
      sort.value = this.sortKey;
      sort.addEventListener('change', () => {
        this.sortKey = sort.value;
        this.render();
      });
    }
    document.getElementById('sitesRerun')?.addEventListener('click', () => this.rerun());
  }

  renderSettings() {
    const target = document.getElementById('sitesSettings');
    if (target) target.textContent = settingsSummary(this.baseState);
  }

  addSurvey(survey, { save = true } = {}) {
    const site = DATACENTER_SITES.find(entry => entry.id === survey.siteId);
    if (!site) return;
    const result = calculateDatacenterScenario(survey.state);
    this.entries.set(site.id, { site, survey, result });
    this.failed.delete(site.id);
    if (save) {
      this.surveys[site.id] = survey;
      writeCache(this.baseHash, this.surveys);
    }
  }

  rerun() {
    this.terminateWorkers();
    this.entries.clear();
    this.failed.clear();
    this.surveys = {};
    writeCache(this.baseHash, this.surveys);
    this.render();
    this.runRemaining();
  }

  async runRemaining() {
    const queue = DATACENTER_SITES.filter(site => !this.entries.has(site.id)).map(site => site.id);
    if (!queue.length) return;
    this.startedAt = Date.now();
    const poolSize = typeof Worker === 'function'
      ? Math.max(1, Math.min(MAX_WORKERS, (navigator.hardwareConcurrency || 2) - 1, queue.length))
      : 0;
    const runner = async worker => {
      while (queue.length) {
        const siteId = queue.shift();
        this.running.add(siteId);
        this.render();
        try {
          const survey = worker ? await this.runInWorker(worker, siteId) : await this.runOnMainThread(siteId);
          this.addSurvey(survey);
        } catch (error) {
          if (worker) {
            // The worker broke: finish this site and the rest on the main thread.
            console.warn('Site optimizer worker failed, continuing on the main thread.', error);
            queue.unshift(siteId);
            this.running.delete(siteId);
            return runner(null);
          }
          this.failed.set(siteId, error?.message || 'Optimization failed');
        }
        this.running.delete(siteId);
        this.render();
      }
      return undefined;
    };
    this.workers = Array.from({ length: poolSize }, () => new Worker(new URL('../../workers/datacenter-optimizer-worker.js', import.meta.url), { type: 'module' }));
    await Promise.all(poolSize ? this.workers.map(worker => runner(worker)) : [runner(null)]);
    this.terminateWorkers();
    this.render();
  }

  runInWorker(worker, siteId) {
    return new Promise((resolve, reject) => {
      const requestId = `${siteId}-${Date.now()}`;
      const onMessage = event => {
        const { requestId: id, messageType, result, error } = event.data || {};
        if (id !== requestId || messageType === 'progress') return;
        cleanup();
        if (error) reject(new Error(error.message));
        else resolve(result);
      };
      const onError = event => {
        cleanup();
        reject(event?.error || new Error(event?.message || 'Worker crashed'));
      };
      const cleanup = () => {
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
      };
      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onError);
      worker.postMessage({ requestId, type: 'optimizeDatacenterSite', state: { ...this.baseState }, options: { siteId } });
    });
  }

  runOnMainThread(siteId) {
    // Yield first so the page can paint the progress between sites.
    return new Promise((resolve, reject) => {
      window.setTimeout(() => {
        try {
          resolve(optimizeForSite(this.baseState, siteId));
        } catch (error) {
          reject(error);
        }
      }, 0);
    });
  }

  terminateWorkers() {
    (this.workers || []).forEach(worker => worker.terminate());
    this.workers = [];
    this.running.clear();
  }

  render() {
    const total = DATACENTER_SITES.length;
    const done = this.entries.size;
    const progress = document.getElementById('sitesProgress');
    if (progress) {
      progress.max = total;
      progress.value = done + this.failed.size;
      progress.hidden = done + this.failed.size >= total;
    }
    const status = document.getElementById('sitesStatus');
    if (status) {
      const elapsed = this.startedAt ? ` · ${fixed((Date.now() - this.startedAt) / 1000, 0)} s` : '';
      status.textContent = done + this.failed.size < total
        ? `Optimizing ${total - done - this.failed.size} of ${total} sites (grid, hybrid and islanded each)${elapsed}…`
        : `All ${total} sites optimized${this.failed.size ? `, ${this.failed.size} failed` : ''}. Click a site to open its design in the simulator.`;
    }
    const list = document.getElementById('sitesList');
    if (!list) return;
    const sorted = sortSiteEntries([...this.entries.values()], this.sortKey);
    const maxFootprintM2 = Math.max(0, ...sorted.map(entry => entry.result.footprint?.totalM2 || 0));
    const cards = sorted.map((entry, index) => renderSiteCard({
      ...entry,
      rank: index + 1,
      href: `datacenter.html${serializeDatacenterHash(entry.survey.state, window.LZString)}`,
      maxFootprintM2,
    }));
    DATACENTER_SITES.filter(site => !this.entries.has(site.id)).forEach(site => {
      const status = this.failed.get(site.id) || (this.running.has(site.id) ? 'Optimizing…' : 'Waiting…');
      cards.push(renderPendingSiteCard(site, status));
    });
    list.innerHTML = cards.join('');
  }
}
