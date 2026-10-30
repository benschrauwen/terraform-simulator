/* Shared Chart.js plumbing: runtime fallback, common axis styling, dual-axis zero alignment */

const CHART_UNAVAILABLE_MESSAGE = 'Charts are unavailable because Chart.js failed to load.';

export const CHART_THEME = Object.freeze({
  legendText: '#94a3b8',
  axisText: '#64748b',
  gridLine: '#1e293b',
});

/** Muted axis tick styling; `extra` adds e.g. `callback` or `maxTicksLimit`. */
export function axisTicks(extra = {}) {
  return { color: CHART_THEME.axisText, font: { size: 9 }, ...extra };
}

export function axisGrid() {
  return { color: CHART_THEME.gridLine };
}

export function axisTitle(text) {
  return { display: true, text, color: CHART_THEME.axisText, font: { size: 10 } };
}

export function legendLabels(extra = {}) {
  return { color: CHART_THEME.legendText, font: { size: 10 }, ...extra };
}

function isChartRuntimeAvailable() {
  return typeof Chart === 'function';
}

function getChartWrapper(canvas) {
  return canvas?.closest?.('.chart-wrapper') || canvas?.parentElement || null;
}

function markChartUnavailable(canvasId, message = CHART_UNAVAILABLE_MESSAGE) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const wrapper = getChartWrapper(canvas);

  canvas.hidden = true;
  if (wrapper) {
    wrapper.dataset.chartUnavailable = message;
    wrapper.setAttribute('role', 'status');
    wrapper.setAttribute('aria-label', message);
  }
}

export function clearChartUnavailable(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const wrapper = getChartWrapper(canvas);

  canvas.hidden = false;
  if (wrapper) {
    delete wrapper.dataset.chartUnavailable;
    wrapper.removeAttribute('role');
    wrapper.removeAttribute('aria-label');
  }
}

function destroyChartInstance(app, chartKey) {
  const chart = app?.charts?.[chartKey];
  if (chart?.destroy) chart.destroy();
  if (app?.charts) delete app.charts[chartKey];
  if (app?.chartKeys) delete app.chartKeys[chartKey];
}

/**
 * True when Chart.js is loaded. Otherwise drops any stale chart instance and shows
 * the "charts unavailable" fallback on the canvas wrapper.
 */
export function ensureChartRuntime(app, chartKey, canvasId) {
  if (isChartRuntimeAvailable()) {
    clearChartUnavailable(canvasId);
    return true;
  }

  destroyChartInstance(app, chartKey);
  markChartUnavailable(canvasId);
  return false;
}

function normalizeAxisValue(value) {
  return Math.abs(value) < 1e-9 ? 0 : value;
}

function getAxisExtents(values, paddingFraction = 0.08) {
  let positive = 0;
  let negative = 0;
  let hasFiniteValue = false;

  (Array.isArray(values) ? values : []).forEach(value => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return;
    hasFiniteValue = true;
    if (numeric > positive) positive = numeric;
    if (numeric < 0) negative = Math.max(negative, -numeric);
  });

  if (!hasFiniteValue || (positive === 0 && negative === 0)) {
    return { positive: 1, negative: 0 };
  }

  return {
    positive: positive > 0 ? positive * (1 + paddingFraction) : 0,
    negative: negative > 0 ? negative * (1 + paddingFraction) : 0,
  };
}

function getZeroRatio(extents) {
  const totalSpan = extents.positive + extents.negative;
  return totalSpan > 0 ? extents.negative / totalSpan : 0;
}

function getAlignedZeroRatio(primaryExtents, secondaryExtents) {
  if (primaryExtents.negative === 0 && secondaryExtents.negative === 0) return 0;
  if (primaryExtents.positive === 0 && secondaryExtents.positive === 0) return 1;

  const ratios = [getZeroRatio(primaryExtents), getZeroRatio(secondaryExtents)].sort((a, b) => a - b);
  const [lowRatio, highRatio] = ratios;

  if (Math.abs(highRatio - lowRatio) < 1e-9) return highRatio;
  return highRatio / (1 + highRatio - lowRatio);
}

function getBoundsForZeroRatio(extents, zeroRatio) {
  if (zeroRatio <= 0) {
    return {
      min: 0,
      max: normalizeAxisValue(extents.positive || 1),
    };
  }

  if (zeroRatio >= 1) {
    return {
      min: normalizeAxisValue(-(extents.negative || 1)),
      max: 0,
    };
  }

  const totalSpan = Math.max(
    extents.negative > 0 ? extents.negative / zeroRatio : 0,
    extents.positive > 0 ? extents.positive / (1 - zeroRatio) : 0,
    1
  );

  return {
    min: normalizeAxisValue(-zeroRatio * totalSpan),
    max: normalizeAxisValue((1 - zeroRatio) * totalSpan),
  };
}

function getStackedAxisValues(datasets, labelCount) {
  const positiveTotals = Array.from({ length: labelCount }, () => 0);
  const negativeTotals = Array.from({ length: labelCount }, () => 0);

  (Array.isArray(datasets) ? datasets : []).forEach(dataset => {
    const values = Array.isArray(dataset?.data) ? dataset.data : [];
    for (let index = 0; index < labelCount; index += 1) {
      const numeric = Number(values[index]);
      if (!Number.isFinite(numeric)) continue;
      if (numeric >= 0) positiveTotals[index] += numeric;
      else negativeTotals[index] += numeric;
    }
  });

  return positiveTotals.concat(negativeTotals);
}

/**
 * Min/max for a stacked primary axis and an unstacked secondary axis so that both
 * scales cross zero at the same gridline.
 */
export function getAlignedZeroBounds(primaryDatasets, secondaryDatasets, labelCount) {
  const primaryValues = getStackedAxisValues(primaryDatasets, labelCount);
  const secondaryValues = [];

  (Array.isArray(secondaryDatasets) ? secondaryDatasets : []).forEach(dataset => {
    const values = Array.isArray(dataset?.data) ? dataset.data : [];
    values.forEach(value => {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) secondaryValues.push(numeric);
    });
  });

  const primaryExtents = getAxisExtents(primaryValues);
  const secondaryExtents = getAxisExtents(secondaryValues);
  const zeroRatio = getAlignedZeroRatio(primaryExtents, secondaryExtents);

  return {
    primary: getBoundsForZeroRatio(primaryExtents, zeroRatio),
    secondary: getBoundsForZeroRatio(secondaryExtents, zeroRatio),
  };
}
