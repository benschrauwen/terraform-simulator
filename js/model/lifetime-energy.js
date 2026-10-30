/* ============================================
   Lifetime energy by project year
   ============================================
   The plant (AI design load, chemical capacity, battery) is sized on
   year-1 solar. As the array degrades the same fixed design is re-dispatched
   at a few solar factors and AI-served / chemical / clipped energy and AI
   reliability are interpolated per project year. Degradation restarts after
   each solar replacement (see getSolarFactorForYear). The economics apply
   these per-year vectors to the matching revenue streams. */

import { getSolarFactorForYear } from './finance.js';

const NODE_COUNT = 4;

function interpolate(nodes, factor, key) {
  if (nodes.length === 1) return nodes[0][key];
  // Nodes are ordered by descending solar factor.
  for (let i = 0; i < nodes.length - 1; i++) {
    const upper = nodes[i];
    const lower = nodes[i + 1];
    if (factor >= lower.solarFactor - 1e-12) {
      const span = upper.solarFactor - lower.solarFactor;
      const weight = span > 0 ? (factor - lower.solarFactor) / span : 1;
      return lower[key] + (Math.max(0, Math.min(1, weight)) * (upper[key] - lower[key]));
    }
  }
  return nodes[nodes.length - 1][key];
}

export const lifetimeEnergyMethods = {
  /* `year1` and `evaluate(solarFactor)` return { aiServedKWh, chemicalKWh,
     clippedKWh, reliability } on the dispatch horizon; energies are
     multiplied by `annualizationFactor` (Mars orbital year -> Earth year).
     Every *ByYear array is indexed by project year - 1. */
  buildLifetimeEnergyProfile(state, { year1, evaluate, annualizationFactor = 1, solarKWh = 0 }) {
    const horizonYears = Math.max(1, Math.round(state.analysisHorizonYears || 1));
    const degradation = state.panelDegradationAnnual;
    const solarFactorByYear = Array.from({ length: horizonYears }, (_, index) =>
      getSolarFactorForYear(degradation, index + 1, state.solarAssetLife));
    const minSolarFactor = Math.min(1, ...solarFactorByYear);

    const nodeFactors = minSolarFactor < 1 - 1e-9
      ? Array.from({ length: NODE_COUNT }, (_, i) => 1 - ((i * (1 - minSolarFactor)) / (NODE_COUNT - 1)))
      : [1];
    const nodes = nodeFactors.map((solarFactor, index) => {
      const result = index === 0 ? year1 : evaluate(solarFactor);
      return {
        solarFactor,
        aiServedKWh: (result.aiServedKWh || 0) * annualizationFactor,
        chemicalKWh: (result.chemicalKWh || 0) * annualizationFactor,
        clippedKWh: (result.clippedKWh || 0) * annualizationFactor,
        reliability: Number.isFinite(result.reliability) ? result.reliability : 1,
      };
    });

    const byYear = key => solarFactorByYear.map(factor => interpolate(nodes, factor, key));
    const aiServedKWhByYear = byYear('aiServedKWh');
    const chemicalKWhByYear = byYear('chemicalKWh');
    const relativeTo = (series, base) => series.map(value => (base > 0 ? value / base : 1));
    const aiReliabilityByYear = byYear('reliability');

    return {
      horizonYears,
      nodes,
      minSolarFactor,
      solarFactorByYear,
      solarKWhByYear: solarFactorByYear.map(factor => factor * solarKWh * annualizationFactor),
      aiServedKWhByYear,
      chemicalKWhByYear,
      clippedKWhByYear: byYear('clippedKWh'),
      aiReliabilityByYear,
      aiServedFactorByYear: relativeTo(aiServedKWhByYear, nodes[0].aiServedKWh),
      chemicalFactorByYear: relativeTo(chemicalKWhByYear, nodes[0].chemicalKWh),
      minAiReliability: Math.min(...aiReliabilityByYear),
    };
  },
};
