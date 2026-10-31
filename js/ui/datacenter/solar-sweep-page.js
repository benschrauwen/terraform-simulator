/* Hidden price sweep page (datacenter-solar-sweep.html, linked from nowhere). Two sweeps, each
   with a CO2e, an NPV and an excess electricity chart (curtailed + exported energy; one line per
   site, matching colours across all six charts):
   - solar: installed solar price (panel + BOS, SOLAR_SWEEP_PRICES_PER_W) on x, the battery held
     at a selectable price;
   - battery: installed battery price ($/kWh of a 4-hour battery, energy + power,
     BATTERY_SWEEP_PRICES_PER_KWH) on x, solar held at a selectable price.
   Each point is the best design across grid, hybrid and islanded for a site at those two prices
   (site-survey.js priceSweepPoint), optimized in a pool of module workers (main thread as a
   fallback). Points are keyed by site and both prices, so the sweeps share any point they have in
   common, and kept in sessionStorage per settings hash; changing a held price only runs the
   missing points. The settings come from the share hash, as on the sites page. */

import { DATACENTER_SITES } from '../../data/datacenter/sites.js';
import { BATTERY_SWEEP_PRICES_PER_KWH, priceSweepPoint, SOLAR_SWEEP_PRICES_PER_W } from '../../model/datacenter/index.js';
import { batteryPricePerKWh, solarPricePerW } from '../../model/datacenter/site-survey.js';
import { axisGrid, axisTicks, axisTitle, legendLabels } from '../charts/chart-utils.js';
import { fixed, formatMW, formatStorageMWh } from './format.js';
import { parseDatacenterHash, serializeDatacenterHash } from './share.js';
import { settingsSummary } from './sites-page.js';

// Bump the version when model or data changes alter results, so stale sessions rerun.
const CACHE_PREFIX = 'abundance-price-sweep:v2:';
const MAX_WORKERS = 4;

const roundSolar = value => Math.round(value * 1000) / 1000;
const roundBattery = value => Math.round(value * 100) / 100;
const solarLabel = value => `$${fixed(value, 2)}/W`;
const batteryLabel = value => `$${fixed(value, 0)}/kWh`;

/** Cache key of a point: the site and both prices (rounded so equal prices match). */
export const pointKey = ({ id, solarPricePerW: solar, batteryPricePerKWh: battery }) => `${id}|${roundSolar(solar)}|${roundBattery(battery)}`;

/** The two sweeps: which price runs along x and which one is held. */
export const SWEEPS = Object.freeze({
  solar: {
    xs: SOLAR_SWEEP_PRICES_PER_W,
    xTitle: 'Installed solar price, panel + BOS ($/W DC)',
    xLabel: solarLabel,
    heldOptions: BATTERY_SWEEP_PRICES_PER_KWH,
    heldLabel: batteryLabel,
    point: (id, x, held) => ({ kind: 'site', id, solarPricePerW: x, batteryPricePerKWh: held }),
  },
  battery: {
    xs: BATTERY_SWEEP_PRICES_PER_KWH,
    xTitle: 'Installed battery price, 4-hour, energy + power ($/kWh)',
    xLabel: batteryLabel,
    heldOptions: SOLAR_SWEEP_PRICES_PER_W,
    heldLabel: solarLabel,
    point: (id, x, held) => ({ kind: 'site', id, solarPricePerW: held, batteryPricePerKWh: x }),
  },
});

/** Every point of one sweep at a held price: each site at each x (cheapest first). */
export function listSweepPoints(sweepKey, held) {
  const sweep = SWEEPS[sweepKey];
  return sweep.xs.flatMap(x => DATACENTER_SITES.map(site => sweep.point(site.id, x, held)));
}

/** The held-price options: the settings' own price first, then the sweep list. */
export function heldPriceOptions(sweepKey, current) {
  const sweep = SWEEPS[sweepKey];
  const values = [...new Set([current, ...sweep.heldOptions])];
  return values.map((value, index) => ({ value, label: index === 0 ? `${sweep.heldLabel(value)} (your setting)` : sweep.heldLabel(value) }));
}

/** Distinct, readable line colours on the dark theme (hue spread, two lightness bands). */
export function seriesColor(index, count) {
  const hue = Math.round((index * 360) / Math.max(1, count));
  return `hsl(${hue}, 65%, ${index % 2 ? 62 : 52}%)`;
}

/** Chart.js datasets of one sweep: one line per site (same colour in every chart), sorted by x. */
export function buildSweepDatasets(results, sweepKey, held, value) {
  const sweep = SWEEPS[sweepKey];
  return DATACENTER_SITES.map((site, index) => ({
    label: site.name,
    data: sweep.xs
      .map(x => ({ x, result: results[pointKey(sweep.point(site.id, x, held))] }))
      .filter(entry => entry.result)
      .map(({ x, result }) => ({ x, y: value(result), result })),
    borderColor: seriesColor(index, DATACENTER_SITES.length),
    backgroundColor: seriesColor(index, DATACENTER_SITES.length),
    borderWidth: 1.5,
    pointRadius: 2.5,
    tension: 0.15,
  }));
}

/** Excess electricity of a point in GWh/yr: curtailed + exported. */
export const excessGWh = result => ((result.curtailedMWh || 0) + (result.exportMWh || 0)) / 1000;

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
    this.charts = {};
    // The held price of each sweep: the settings' own, until the user picks another.
    this.current = { solar: roundSolar(solarPricePerW(this.baseState)), battery: roundBattery(batteryPricePerKWh(this.baseState)) };
    this.held = { solar: this.current.battery, battery: this.current.solar };
    const settings = document.getElementById('sweepSettings');
    if (settings) settings.textContent = settingsSummary(this.baseState);
    const prices = document.getElementById('sweepCurrentPrices');
    if (prices) prices.textContent = `solar at ${solarLabel(this.current.solar)} and the battery at ${batteryLabel(this.current.battery)}`;
    this.bindHeldSelect('solar', 'sweepSolarHeld', this.current.battery);
    this.bindHeldSelect('battery', 'sweepBatteryHeld', this.current.solar);
    document.getElementById('sweepRerun')?.addEventListener('click', () => this.rerun());
    this.render();
    this.ensureRunning();
  }

  bindHeldSelect(sweepKey, id, current) {
    const select = document.getElementById(id);
    if (!select) return;
    select.replaceChildren(...heldPriceOptions(sweepKey, current).map(option => new Option(option.label, String(option.value))));
    select.value = String(this.held[sweepKey]);
    select.addEventListener('change', () => {
      this.held[sweepKey] = Number(select.value);
      this.render();
      this.ensureRunning();
    });
  }

  /** Points the charts need now that are neither done nor running. */
  missingPoints() {
    return [...listSweepPoints('solar', this.held.solar), ...listSweepPoints('battery', this.held.battery)]
      .filter(point => !this.results[pointKey(point)] && !this.inFlight.has(pointKey(point)));
  }

  rerun() {
    (this.workers || []).forEach(worker => worker.terminate());
    this.workers = null;
    this.inFlight.clear();
    this.results = {};
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
            console.warn('Sweep worker failed, continuing on the main thread.', error);
            return runner(null);
          }
          console.warn('Sweep point failed', point, error);
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
    // A held price may have changed while the last points ran.
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
      worker.postMessage({ requestId, type: 'priceSweepPoint', state: { ...this.baseState }, options: { point } });
    });
  }

  runOnMainThread(point) {
    return new Promise((resolve, reject) => {
      window.setTimeout(() => {
        try {
          resolve(priceSweepPoint(this.baseState, point));
        } catch (error) {
          reject(error);
        }
      }, 0);
    });
  }

  render() {
    const needed = [...listSweepPoints('solar', this.held.solar), ...listSweepPoints('battery', this.held.battery)];
    const keys = [...new Set(needed.map(pointKey))];
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
    const co2 = result => result.co2eT / 1000;
    const npv = result => result.npv / 1e6;
    const co2Format = value => `${fixed(value, 0)} kt/yr`;
    const npvFormat = value => `$${fixed(value, 0)}M`;
    const excessFormat = value => `${fixed(value, value < 10 ? 1 : 0)} GWh/yr`;
    this.renderChart('solarCo2', 'sweepSolarCo2Chart', 'solar', co2, 'CO₂e (kt/yr)', co2Format);
    this.renderChart('solarNpv', 'sweepSolarNpvChart', 'solar', npv, 'NPV ($M)', npvFormat);
    this.renderChart('solarExcess', 'sweepSolarExcessChart', 'solar', excessGWh, 'Excess electricity (GWh/yr)', excessFormat);
    this.renderChart('batteryCo2', 'sweepBatteryCo2Chart', 'battery', co2, 'CO₂e (kt/yr)', co2Format);
    this.renderChart('batteryNpv', 'sweepBatteryNpvChart', 'battery', npv, 'NPV ($M)', npvFormat);
    this.renderChart('batteryExcess', 'sweepBatteryExcessChart', 'battery', excessGWh, 'Excess electricity (GWh/yr)', excessFormat);
  }

  renderChart(key, canvasId, sweepKey, value, yTitle, formatValue) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof window.Chart !== 'function') return;
    const sweep = SWEEPS[sweepKey];
    const datasets = buildSweepDatasets(this.results, sweepKey, this.held[sweepKey], value);
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
          x: { type: 'linear', min: sweep.xs[0], max: sweep.xs[sweep.xs.length - 1], title: axisTitle(sweep.xTitle), ticks: axisTicks({ callback: x => sweep.xLabel(x) }), grid: axisGrid() },
          y: { title: axisTitle(yTitle), ticks: axisTicks(), grid: axisGrid() },
        },
        plugins: {
          legend: { position: 'right', labels: legendLabels({ boxWidth: 10 }) },
          tooltip: {
            callbacks: {
              title: items => (items.length ? `At ${sweep.xLabel(items[0].parsed.x)}` : ''),
              label: item => `${item.dataset.label}: ${formatValue(item.parsed.y)}`,
              afterLabel: item => {
                const result = item.raw.result;
                const excess = (result.curtailedMWh || 0) + (result.exportMWh || 0) > 0
                  ? ` · excess: ${fixed((result.curtailedMWh || 0) / 1000, 1)} GWh curtailed, ${fixed((result.exportMWh || 0) / 1000, 1)} GWh exported`
                  : '';
                return `${describePoint(result)}${excess}`;
              },
            },
          },
        },
      },
    });
  }
}
