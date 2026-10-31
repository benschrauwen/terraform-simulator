/* Hidden price grid page (datacenter-solar-sweep.html, linked from nowhere): for one selected site,
   every installed solar price (panel + BOS, SOLAR_SWEEP_PRICES_PER_W) against every battery price
   ($/kWh of a 4-hour battery, energy + power, BATTERY_SWEEP_PRICES_PER_KWH). Each cell is the best
   design across grid, hybrid and islanded at those prices (site-survey.js priceSweepPoint) with the
   optimizer's wider (thorough) search, since with cheap solar and batteries the best designs sit
   on a flat ridge; points run in a pool of module workers (main thread as a fallback). CO2e, NPV
   and excess electricity are drawn as heatmaps (sweep-heatmap.js); a cell links to the simulator
   with that site, those prices and the cell's design. Lines over the heatmaps show where the
   settings' own prices go in later years on learning curves (site-survey.js learningPricePath,
   central solid, fast dashed). Points are kept in sessionStorage per settings hash; the settings
   come from the share hash, as on the sites page. */

import { PRICE_LEARNING } from '../../data/datacenter/learning.js';
import { DATACENTER_SITES } from '../../data/datacenter/sites.js';
import { BATTERY_SWEEP_PRICES_PER_KWH, priceSweepPoint, SOLAR_SWEEP_PRICES_PER_W } from '../../model/datacenter/index.js';
import { batteryPricePerKWh, learningPricePath, solarPricePerW, sweepPointState } from '../../model/datacenter/site-survey.js';
import { fixed, formatMW, formatStorageMWh } from './format.js';
import { parseDatacenterHash, serializeDatacenterHash } from './share.js';
import { settingsSummary } from './sites-page.js';
import { bindHeatmapLinks, renderHeatmapSvg } from './sweep-heatmap.js';

// Bump the version when model or data changes alter results, so stale sessions rerun.
const CACHE_PREFIX = 'abundance-price-grid:v4:';
const MAX_WORKERS = 4;
const HEATMAPS = ['sweepGridCo2', 'sweepGridNpv', 'sweepGridExcess'];

const roundSolar = value => Math.round(value * 1000) / 1000;
const roundBattery = value => Math.round(value * 100) / 100;
const solarLabel = value => `$${fixed(value, 2)}/W`;
const batteryLabel = value => `$${fixed(value, 0)}/kWh`;

/** Cache key of a point: the site and both prices (rounded so equal prices match). */
export const pointKey = ({ id, solarPricePerW: solar, batteryPricePerKWh: battery }) => `${id}|${roundSolar(solar)}|${roundBattery(battery)}`;

/** Every point of the grid for one site: each solar price x each battery price. */
export function listGridPoints(siteId) {
  return BATTERY_SWEEP_PRICES_PER_KWH.flatMap(battery => SOLAR_SWEEP_PRICES_PER_W.map(solar => ({ kind: 'site', id: siteId, solarPricePerW: solar, batteryPricePerKWh: battery })));
}

// The grid's optimizer options: the wider (thorough) search.
export const GRID_OPTIONS = Object.freeze({ thorough: true });

/** Excess electricity of a point in GWh/yr: curtailed + exported. */
export const excessGWh = result => ((result.curtailedMWh || 0) + (result.exportMWh || 0)) / 1000;

const percent = rate => `${fixed(rate * 100, 0)}%`;

/**
 * The heatmap paths of the learning curves from a state's prices: central (solid, each year
 * labelled) and fast (dashed); each dot's tooltip gives the year's prices.
 */
export function learningPaths(state) {
  return Object.entries(PRICE_LEARNING.paths).map(([key, path]) => ({
    key,
    label: `${path.label} learning path`,
    points: learningPricePath(state, key).map(point => ({
      x: point.solarPricePerW,
      y: point.batteryPricePerKWh,
      label: key === 'central' ? String(point.year) : '',
      tip: `${point.year} (${path.label.toLowerCase()} learning): solar ${solarLabel(point.solarPricePerW)}, battery ${batteryLabel(point.batteryPricePerKWh)}`,
    })),
  }));
}

/** The note under the toolbar: the learning rates and where the central path ends up. */
export function learningNote(state) {
  const { central, fast } = PRICE_LEARNING.paths;
  const ends = learningPricePath(state, 'central').filter(point => point.year > PRICE_LEARNING.baseYear)
    .map(point => `${point.year} ${solarLabel(point.solarPricePerW)} and ${batteryLabel(point.batteryPricePerKWh)}`).join('; ');
  return `Lines: where your prices go on learning curves (cost falls by a fixed share per doubling of cumulative solar or battery deployment). `
    + `Solid, central: modules ${percent(central.module)}, solar BOS ${percent(central.bos)}, battery cells ${percent(central.batteryEnergy)}, battery power equipment ${percent(central.batteryPower)}: ${ends}. `
    + `Dashed, fast: the whole installed price at ${percent(fast.module)} (solar) and ${percent(fast.batteryEnergy)} (battery). Trend lines, not forecasts; points beyond the grid are not drawn.`;
}

/** Tooltip line: the design behind a point. */
export function describePoint(result) {
  const parts = [
    result.architecture,
    result.solarMWdc > 0 ? `${formatMW(result.solarMWdc)}dc solar` : 'no solar',
    result.batteryMWh > 0 ? `${formatStorageMWh(result.batteryMWh)} battery` : 'no battery',
    result.units > 0 && result.firmLabel ? `${fixed(result.units, 0)} × ${result.firmLabel.toLowerCase()}` : null,
  ];
  return parts.filter(Boolean).join(', ');
}

function readCache(key) {
  try {
    return JSON.parse(window.sessionStorage.getItem(CACHE_PREFIX + key) || '{}');
  } catch {
    return {};
  }
}

function writeCache(key, results) {
  try {
    window.sessionStorage.setItem(CACHE_PREFIX + key, JSON.stringify(results));
  } catch {
    // Storage full or blocked: the page still works, it just reruns next time.
  }
}

export class SolarSweepPage {
  constructor() {
    this.baseState = parseDatacenterHash(window.location.hash, window.LZString).state;
    this.baseHash = serializeDatacenterHash(this.baseState, window.LZString);
    this.results = readCache(this.baseHash);
    this.inFlight = new Set();
    this.cellHrefs = new Map();
    const settings = document.getElementById('sweepSettings');
    if (settings) settings.textContent = settingsSummary(this.baseState);
    const prices = document.getElementById('sweepCurrentPrices');
    if (prices) prices.textContent = `solar at ${solarLabel(solarPricePerW(this.baseState))} and the battery at ${batteryLabel(batteryPricePerKWh(this.baseState))}`;
    this.paths = learningPaths(this.baseState);
    const learning = document.getElementById('sweepLearning');
    if (learning) learning.textContent = learningNote(this.baseState);
    this.gridSite = this.baseState.siteId;
    this.bindGridSiteSelect();
    HEATMAPS.forEach(id => {
      const container = document.getElementById(id);
      if (container) bindHeatmapLinks(container);
    });
    document.getElementById('sweepRerun')?.addEventListener('click', () => this.rerun());
    this.render();
    this.ensureRunning();
  }

  bindGridSiteSelect() {
    const select = document.getElementById('sweepGridSite');
    if (!select) return;
    select.replaceChildren(...DATACENTER_SITES.map(site => new Option(site.name, site.id)));
    select.value = this.gridSite;
    select.addEventListener('change', () => {
      this.gridSite = select.value;
      this.render();
      this.ensureRunning();
    });
  }

  /** Points of the selected site's grid that are neither done nor running. */
  missingPoints() {
    return listGridPoints(this.gridSite).filter(point => !this.results[pointKey(point)] && !this.inFlight.has(pointKey(point)));
  }

  rerun() {
    (this.workers || []).forEach(worker => worker.terminate());
    this.workers = null;
    this.inFlight.clear();
    this.results = {};
    this.cellHrefs = new Map();
    writeCache(this.baseHash, this.results);
    this.render();
    this.ensureRunning();
  }

  addResult(key, result) {
    this.results[key] = result;
    writeCache(this.baseHash, this.results);
    window.clearTimeout(this.renderTimer);
    this.renderTimer = window.setTimeout(() => this.render(), 150);
  }

  /** Start the worker pool if it is idle; runners pick the next missing point each time. */
  async ensureRunning() {
    if (this.workers || !this.missingPoints().length) return;
    this.startedAt = Date.now();
    const poolSize = typeof Worker === 'function' ? Math.max(1, Math.min(MAX_WORKERS, (navigator.hardwareConcurrency || 2) - 1)) : 0;
    const workers = Array.from({ length: poolSize }, () => new Worker(new URL('../../workers/datacenter-optimizer-worker.js', import.meta.url), { type: 'module' }));
    this.workers = workers;
    const runner = async worker => {
      for (let point = this.missingPoints()[0]; point && this.workers === workers; point = this.missingPoints()[0]) {
        const key = pointKey(point);
        this.inFlight.add(key);
        try {
          this.addResult(key, worker ? await this.runInWorker(worker, point) : await this.runOnMainThread(point));
        } catch (error) {
          this.inFlight.delete(key);
          if (worker) {
            console.warn('Grid worker failed, continuing on the main thread.', error);
            return runner(null);
          }
          console.warn('Grid point failed', point, error);
          return undefined;
        }
        this.inFlight.delete(key);
      }
      return undefined;
    };
    await Promise.all(poolSize ? workers.map(worker => runner(worker)) : [runner(null)]);
    workers.forEach(worker => worker.terminate());
    if (this.workers === workers) this.workers = null;
    this.render();
    // The site may have changed while the last points ran.
    if (this.missingPoints().length) this.ensureRunning();
  }

  runInWorker(worker, point) {
    return new Promise((resolve, reject) => {
      const requestId = `${pointKey(point)}|${Date.now()}`;
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
      worker.postMessage({ requestId, type: 'priceSweepPoint', state: { ...this.baseState }, options: { point, ...GRID_OPTIONS } });
    });
  }

  runOnMainThread(point) {
    return new Promise((resolve, reject) => {
      window.setTimeout(() => {
        try {
          resolve(priceSweepPoint(this.baseState, point, GRID_OPTIONS));
        } catch (error) {
          reject(error);
        }
      }, 0);
    });
  }

  render() {
    const keys = listGridPoints(this.gridSite).map(pointKey);
    const done = keys.filter(key => this.results[key]).length;
    const progress = document.getElementById('sweepProgress');
    if (progress) {
      progress.max = keys.length;
      progress.value = done;
      progress.hidden = done >= keys.length;
    }
    const status = document.getElementById('sweepStatus');
    if (status) {
      const elapsed = this.startedAt && this.workers ? ` · ${fixed((Date.now() - this.startedAt) / 1000, 0)} s` : '';
      status.textContent = done < keys.length ? `Optimized ${done} of ${keys.length} points${elapsed}…` : `All ${keys.length} points optimized.`;
    }
    this.renderGrid('sweepGridCo2', result => result.co2eT / 1000, value => `${fixed(value, 0)}`, 'low', 'CO2e (kt/yr)');
    this.renderGrid('sweepGridNpv', result => result.npv / 1e6, value => `$${fixed(value, 0)}M`, 'high', 'NPV');
    this.renderGrid('sweepGridExcess', excessGWh, value => fixed(value, value < 10 ? 1 : 0), 'low', 'Excess electricity (GWh/yr)');
  }

  /** The simulator link of a grid cell: the site, both prices and the cell's design (cached per point). */
  cellHref(result, solar, battery) {
    const key = pointKey({ id: this.gridSite, solarPricePerW: solar, batteryPricePerKWh: battery });
    if (!this.cellHrefs.has(key)) {
      const state = sweepPointState(this.baseState, { kind: 'site', id: this.gridSite, solarPricePerW: solar, batteryPricePerKWh: battery, patch: result.patch });
      this.cellHrefs.set(key, `datacenter.html${serializeDatacenterHash(state, window.LZString)}`);
    }
    return this.cellHrefs.get(key);
  }

  /** One heatmap of the selected site's grid; cells not run yet are left grey. */
  renderGrid(id, value, format, better, title) {
    const target = document.getElementById(id);
    if (!target) return;
    const site = DATACENTER_SITES.find(entry => entry.id === this.gridSite);
    target.innerHTML = renderHeatmapSvg({
      xs: SOLAR_SWEEP_PRICES_PER_W,
      ys: BATTERY_SWEEP_PRICES_PER_KWH,
      cell: (solar, battery) => this.results[pointKey({ id: this.gridSite, solarPricePerW: solar, batteryPricePerKWh: battery })] || null,
      value,
      format,
      xLabel: solarLabel,
      yLabel: batteryLabel,
      xTitle: 'Installed solar price, panel + BOS ($/W DC)',
      yTitle: 'Battery, 4-hour ($/kWh)',
      better,
      describe: describePoint,
      link: (result, solar, battery) => this.cellHref(result, solar, battery),
      paths: this.paths,
      title: `${title} at ${site?.name || this.gridSite} by solar and battery price`,
    });
  }
}
