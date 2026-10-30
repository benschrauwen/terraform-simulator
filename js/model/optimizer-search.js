/* ============================================
   Optimizer search
   ============================================
   Finds the slider value with the best IRR: an exhaustive sweep for small
   ranges, otherwise a coarse sweep followed by refinement around the best
   regions. Runs in the optimizer worker and in tests.

   IRR is withheld (NaN) when cash flows have no single meaningful root, so
   a sweep can mix finite and undefined IRRs. The search then ranks every
   candidate by MIRR at the discount rate instead (always unique, and above
   the discount rate exactly when NPV is positive), and by NPV if MIRR is
   undefined too (no outflows at all). One metric ranks the whole sweep so
   values are never compared across metrics. */

import { getStepPrecision } from '../util.js';

function snapRangeValue(value, min, max, step) {
  const precision = getStepPrecision(step);
  const boundedValue = Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : min;
  const snapped = min + (Math.round((boundedValue - min) / step) * step);
  return Number(Math.max(min, Math.min(max, snapped)).toFixed(precision));
}

function buildEvenlySpacedIndices(totalSteps, targetCount) {
  if (totalSteps <= 0) return [0];

  const indices = new Set([0, totalSteps]);
  const count = Math.max(2, Math.min(targetCount, totalSteps + 1));
  for (let i = 0; i < count; i++) {
    indices.add(Math.round((i * totalSteps) / (count - 1)));
  }
  return Array.from(indices).sort((a, b) => a - b);
}

function mergeIndexRanges(ranges) {
  if (!Array.isArray(ranges) || !ranges.length) return [];

  const sorted = ranges
    .map(([start, end]) => [Math.min(start, end), Math.max(start, end)])
    .sort((a, b) => a[0] - b[0]);

  return sorted.reduce((merged, [start, end]) => {
    const last = merged[merged.length - 1];
    if (!last || start > (last[1] + 1)) {
      merged.push([start, end]);
    } else {
      last[1] = Math.max(last[1], end);
    }
    return merged;
  }, []);
}

export const optimizerSearchMethods = {
  snapRangeValue,
  buildEvenlySpacedIndices,
  mergeIndexRanges,

  findBestRangeValueForIrr(baseState, {
    stateKey,
    min,
    max,
    step,
    currentValue,
    maxCoarseSamples = 257,
    maxTopRegions = 5,
  }, options = {}) {
    if (typeof stateKey !== 'string' || !stateKey) return null;
    if (![min, max, step].every(Number.isFinite) || step <= 0 || max < min) return null;

    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
    let lastPercent = -1;
    const emitProgress = (percent, stage) => {
      if (!onProgress) return;
      const boundedPercent = Math.max(0, Math.min(100, Math.round(percent)));
      if (boundedPercent <= lastPercent && stage !== 'done') return;
      lastPercent = Math.max(lastPercent, boundedPercent);
      try {
        onProgress({ percent: lastPercent, stage });
      } catch (error) {
        // Progress reporting should never change optimizer behavior.
      }
    };

    const totalSteps = Math.max(0, Math.round((max - min) / step));
    const snappedCurrentValue = snapRangeValue(currentValue, min, max, step);
    const currentIndex = Math.round((snappedCurrentValue - min) / step);
    const precision = getStepPrecision(step);
    const cache = new Map();

    const evaluate = value => {
      const snappedValue = snapRangeValue(value, min, max, step);
      const key = snappedValue.toFixed(precision);
      if (cache.has(key)) return cache.get(key);

      const metrics = this.calculateReturnMetrics({ ...baseState, [stateKey]: snappedValue });
      const result = {
        value: snappedValue,
        irr: metrics.irr,
        mirr: metrics.mirr,
        npv: metrics.npv,
      };
      cache.set(key, result);
      return result;
    };
    const chooseMetric = entries => {
      if (entries.every(entry => Number.isFinite(entry.irr))) return 'irr';
      if (entries.every(entry => Number.isFinite(entry.mirr))) return 'mirr';
      return 'npv';
    };

    const evaluateIndex = index => evaluate(min + (index * step));
    emitProgress(0, 'start');
    const currentResult = evaluate(snappedCurrentValue);
    emitProgress(6, 'seed');

    if ((totalSteps + 1) <= maxCoarseSamples) {
      for (let index = 0; index <= totalSteps; index++) {
        evaluateIndex(index);
        emitProgress(6 + (((index + 1) / Math.max(totalSteps + 1, 1)) * 90), 'sweep');
      }
    } else {
      const coarseIndices = buildEvenlySpacedIndices(
        totalSteps,
        Math.min(maxCoarseSamples, totalSteps + 1)
      );

      coarseIndices.forEach((index, coarseIndex) => {
        evaluateIndex(index);
        emitProgress(6 + (((coarseIndex + 1) / Math.max(coarseIndices.length, 1)) * 34), 'coarse');
      });

      const coarseEntries = coarseIndices.map(index => ({ index, ...evaluateIndex(index) }));
      const coarseMetric = chooseMetric(coarseEntries);
      const rankedIndices = coarseEntries
        .filter(entry => Number.isFinite(entry[coarseMetric]))
        .sort((a, b) => b[coarseMetric] - a[coarseMetric]);

      const coarseSpacing = coarseIndices.length > 1
        ? coarseIndices.slice(1).reduce((maxGap, index, i) => Math.max(maxGap, index - coarseIndices[i]), 1)
        : totalSteps;

      const regionSeeds = new Set([
        currentIndex,
        ...rankedIndices.slice(0, maxTopRegions).map(entry => entry.index),
      ]);

      const mergedRegions = mergeIndexRanges(
        Array.from(regionSeeds).map(index => [
          Math.max(0, index - coarseSpacing),
          Math.min(totalSteps, index + coarseSpacing),
        ])
      );
      emitProgress(42, 'rank');

      const refinementCount = mergedRegions.reduce((sum, [start, end]) => sum + (end - start + 1), 0);
      let refinedSteps = 0;

      mergedRegions.forEach(([start, end]) => {
        for (let index = start; index <= end; index++) {
          evaluateIndex(index);
          refinedSteps += 1;
          emitProgress(42 + ((refinedSteps / Math.max(refinementCount, 1)) * 54), 'refine');
        }
      });
    }

    const entries = Array.from(cache.values());
    const metric = chooseMetric(entries);
    // NPV differences are in dollars, rates in percent points.
    const tolerance = metric === 'npv' ? 1e-6 * Math.max(1, ...entries.map(entry => Math.abs(entry.npv) || 0)) : 1e-6;
    const best = entries
      .filter(entry => Number.isFinite(entry[metric]))
      .sort((a, b) => {
        const diff = b[metric] - a[metric];
        if (Math.abs(diff) > 1e-9) return diff;
        return Math.abs(a.value - snappedCurrentValue) - Math.abs(b.value - snappedCurrentValue);
      })[0];

    emitProgress(100, 'done');
    if (!best) return null;
    if (Number.isFinite(currentResult[metric]) && best[metric] <= (currentResult[metric] + tolerance)) {
      return null;
    }

    return {
      metric,
      bestValue: best.value,
      bestIrr: best.irr,
      bestScore: best[metric],
      currentValue: snappedCurrentValue,
      currentIrr: currentResult.irr,
      currentScore: currentResult[metric],
    };
  },
};
