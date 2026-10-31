/* Hidden solar price sweep page (datacenter-solar-sweep.html, linked from nowhere): for each
   installed solar price (panel + BOS, SOLAR_SWEEP_PRICES_PER_W) the best design across grid,
   hybrid and islanded is optimized for every real project and every site (site-survey.js
   solarSweepPoint), in a pool of module workers (main thread as a fallback). Two Chart.js line
   charts fill in as points finish: CO2e per project and NPV per site against the solar price.
   The user's settings come from the share hash, as on the sites page; finished points are kept in
   sessionStorage per settings hash. */

import { DATACENTER_PROJECTS } from '../../data/datacenter/projects.js';
import { DATACENTER_SITES } from '../../data/datacenter/sites.js';
import { SOLAR_SWEEP_PRICES_PER_W, solarSweepPoint } from '../../model/datacenter/index.js';
import { axisGrid, axisTicks, axisTitle, legendLabels } from '../charts/chart-utils.js';
import { fixed, formatMW, formatStorageMWh } from './format.js';
import { parseDatacenterHash, serializeDatacenterHash } from './share.js';
import { settingsSummary } from './sites-page.js';

const CACHE_PREFIX = 'abundance-solar-sweep:v1:';
const MAX_WORKERS = 4;

/** Every sweep point: projects first, then sites, each across the prices (cheapest first). */
export function listSweepPoints(prices = SOLAR_SWEEP_PRICES_PER_W) {
  const series = [
    ...DATACENTER_PROJECTS.map(project => ({ kind: 'project', id: project.id })),
    ...DATACENTER_SITES.map(site => ({ kind: 'site', id: site.id })),
  ];
  return prices.flatMap(pricePerW => series.map(entry => ({ ...entry, pricePerW })));
}

export const pointKey = point => `${point.kind}|${point.id}|${point.pricePerW}`;

/** Distinct, readable line colours on the dark theme (hue spread, two lightness bands). */
export function seriesColor(index, count) {
  const hue = Math.round((index * 360) / Math.max(1, count));
  return `hsl(${hue}, 65%, ${index % 2 ? 62 : 52}%)`;
}

/** Chart.js datasets for one kind: one line per project or site, points sorted by price. */
export function buildSweepDatasets(results, kind, value) {
  const entries = kind === 'project'
    ? DATACENTER_PROJECTS.map(project => ({ id: project.id, label: project.name }))
    : DATACENTER_SITES.map(site => ({ id: site.id, label: site.name }));
  return entries.map(({ id, label }, index) => ({
    label,
    data: results
      .filter(result => result.kind === kind && result.id === id)
      .sort((a, b) => a.pricePerW - b.pricePerW)
      .map(result => ({ x: result.pricePerW, y: value(result), result })),
    borderColor: seriesColor(index, entries.length),
    backgroundColor: seriesColor(index, entries.length),
    borderWidth: 1.5,
    pointRadius: 2.5,
    tension: 0.15,
  }));
}

/** Tooltip line: the value plus the design behind it. */
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
    this.points = listSweepPoints();
    const settings = document.getElementById('sweepSettings');
    if (settings) settings.textContent = settingsSummary(this.baseState);
    const current = document.getElementById('sweepCurrentPrice');
    if (current) current.textContent = `$${fixed(this.baseState.panelCostPerW + this.baseState.bosCostPerW, 2)}/W`;
    document.getElementById('sweepRerun')?.addEventListener('click', () => this.rerun());
    this.charts = {};
    this.render();
    this.run();
  }

  rerun() {
    (this.workers || []).forEach(worker => worker.terminate());
    this.results = {};
    writeCache(this.baseHash, this.results);
    this.render();
    this.run();
  }

  addResult(result) {
    this.results[pointKey(result)] = result;
    writeCache(this.baseHash, this.results);
    window.clearTimeout(this.renderTimer);
    this.renderTimer = window.setTimeout(() => this.render(), 150);
  }

  async run() {
    const queue = this.points.filter(point => !this.results[pointKey(point)]);
    if (!queue.length) return;
    this.startedAt = Date.now();
    const poolSize = typeof Worker === 'function' ? Math.max(1, Math.min(MAX_WORKERS, (navigator.hardwareConcurrency || 2) - 1)) : 0;
    const runner = async worker => {
      while (queue.length) {
        const point = queue.shift();
        try {
          this.addResult(worker ? await this.runInWorker(worker, point) : await this.runOnMainThread(point));
        } catch (error) {
          if (worker) {
            console.warn('Sweep worker failed, continuing on the main thread.', error);
            queue.unshift(point);
            return runner(null);
          }
          console.warn('Sweep point failed', point, error);
        }
      }
      return undefined;
    };
    this.workers = Array.from({ length: poolSize }, () => new Worker(new URL('../../workers/datacenter-optimizer-worker.js', import.meta.url), { type: 'module' }));
    await Promise.all(poolSize ? this.workers.map(worker => runner(worker)) : [runner(null)]);
    this.workers.forEach(worker => worker.terminate());
    this.workers = [];
    this.render();
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
      worker.postMessage({ requestId, type: 'solarSweepPoint', state: { ...this.baseState }, options: { point } });
    });
  }

  runOnMainThread(point) {
    return new Promise((resolve, reject) => {
      window.setTimeout(() => {
        try {
          resolve(solarSweepPoint(this.baseState, point));
        } catch (error) {
          reject(error);
        }
      }, 0);
    });
  }

  render() {
    const results = Object.values(this.results);
    const total = this.points.length;
    const progress = document.getElementById('sweepProgress');
    if (progress) {
      progress.max = total;
      progress.value = results.length;
      progress.hidden = results.length >= total;
    }
    const status = document.getElementById('sweepStatus');
    if (status) {
      const elapsed = this.startedAt ? ` · ${fixed((Date.now() - this.startedAt) / 1000, 0)} s` : '';
      status.textContent = results.length < total
        ? `Optimized ${results.length} of ${total} points${elapsed}…`
        : `All ${total} points optimized.`;
    }
    this.renderChart('co2', 'sweepCo2Chart', buildSweepDatasets(results, 'project', result => result.co2eT / 1000), 'CO₂e (kt/yr)', value => `${fixed(value, 0)} kt/yr`);
    this.renderChart('npv', 'sweepNpvChart', buildSweepDatasets(results, 'site', result => result.npv / 1e6), 'NPV ($M)', value => `$${fixed(value, 0)}M`);
  }

  renderChart(key, canvasId, datasets, yTitle, formatValue) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof window.Chart !== 'function') return;
    if (this.charts[key]) {
      this.charts[key].data.datasets = datasets;
      this.charts[key].update('none');
      return;
    }
    this.charts[key] = new window.Chart(canvas, {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        parsing: false,
        interaction: { mode: 'nearest', intersect: false },
        scales: {
          x: { type: 'linear', min: 0.2, max: 1.2, title: axisTitle('Installed solar price, panel + BOS ($/W DC)'), ticks: axisTicks({ callback: value => `$${fixed(value, 2)}` }), grid: axisGrid() },
          y: { title: axisTitle(yTitle), ticks: axisTicks(), grid: axisGrid() },
        },
        plugins: {
          legend: { position: 'right', labels: legendLabels({ boxWidth: 10 }) },
          tooltip: {
            callbacks: {
              title: items => (items.length ? `Solar at $${fixed(items[0].parsed.x, 2)}/W` : ''),
              label: item => `${item.dataset.label}: ${formatValue(item.parsed.y)}`,
              afterLabel: item => describePoint(item.raw.result),
            },
          },
        },
      },
    });
  }
}
