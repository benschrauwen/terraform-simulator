/* ============================================
   Break-even sale prices
   ============================================
   For each product the build sells, the sale price at which project NPV = 0
   with every other input unchanged. Revenue from a product is
   volume x price x per-year output factor, and nothing else in the model
   (sizing, dispatch, costs, policy credits) reads that price, so NPV is an
   exact straight line in it: two scenario runs give the root without
   iteration. */

/** Zero of the straight line through (x0, y0) and (x1, y1); null if it is flat. */
export function solveLinearZero(x0, y0, x1, y1) {
  if (![x0, y0, x1, y1].every(Number.isFinite) || x1 === x0) return null;
  const slope = (y1 - y0) / (x1 - x0);
  if (!Number.isFinite(slope) || Math.abs(slope) < 1e-12) return null;
  return x0 - (y0 / slope);
}

const UNIT_LABELS = { t: 't', m3: 'm³' };

/* Products sold by a computed scenario: the state key of their price, the
   price in that run and the year-1 volume that revenue is priced on. */
export function getSoldProducts(result) {
  const products = [];
  if (result?.sabatier?.enabled) {
    products.push({
      key: 'methane',
      label: 'methane',
      paramKey: 'methanePrice',
      unit: 'MCF',
      volume: result.sabatier.ch4AnnualMCF || 0,
    });
  }
  if (result?.methanol?.enabled) {
    // Only exported methanol is sold; methanol fed to MTG etc. earns
    // through those routes' prices.
    products.push({
      key: 'methanol',
      label: 'methanol',
      paramKey: 'methanolPrice',
      unit: 't',
      volume: result.methanol.exportAnnualTons || 0,
    });
  }
  if (result?.ai?.enabled) {
    products.push({
      key: 'ai',
      label: 'AI token',
      paramKey: 'aiTokenPricePerM',
      unit: '1M tokens',
      volume: result.ai.annualTokensM || 0,
    });
  }
  (result?.economics?.exploratoryDetails || []).forEach(module => {
    products.push({
      key: `exploratory-${module.id}`,
      label: module.outputLabel || module.label || module.id,
      paramKey: `${module.id}Price`,
      unit: UNIT_LABELS[module.outputUnit] || module.outputUnit || 't',
      volume: module.annualOutputUnits || 0,
    });
  });
  return products.map(product => ({ ...product, currentPrice: result.state?.[product.paramKey] }));
}

export const breakEvenMethods = {
  /**
   * Break-even sale price (NPV = 0) of every product the scenario sells.
   * Pass the full result already computed for `state` as `baseResult` to
   * reuse its NPV (one extra fast run per product); otherwise a fast run
   * supplies it. Each entry: { key, label, paramKey, unit, volume,
   * currentPrice, breakEvenPrice, ratioToCurrent, positiveAtZeroPrice,
   * npvPerUnitPrice }. breakEvenPrice is null when nothing is sold (NPV does
   * not depend on that price); a negative value means NPV stays positive
   * even if the product were given away.
   */
  calculateBreakEvenPrices(state, { baseResult = null } = {}) {
    const base = baseResult?.economics && baseResult?.state
      ? baseResult
      : this.calculateScenario(state, { fastMode: true });
    const normalizedState = base.state;
    const baseNpv = base.economics.npv;

    return getSoldProducts(base).map(product => {
      const empty = { ...product, breakEvenPrice: null, ratioToCurrent: null, positiveAtZeroPrice: false, npvPerUnitPrice: 0 };
      const p0 = Number(product.currentPrice);
      if (!(product.volume > 0) || !Number.isFinite(p0)) return empty;

      // A second price inside the field's normalization bounds: step up,
      // or down if the price is pinned at its maximum.
      const step = Math.max(1, Math.abs(p0) * 0.5);
      let probe = null;
      for (const candidate of [p0 + step, p0 - step]) {
        const run = this.calculateScenario({ ...normalizedState, [product.paramKey]: candidate }, { fastMode: true });
        const used = run.state[product.paramKey];
        if (Number.isFinite(used) && used !== p0) {
          probe = { price: used, npv: run.economics.npv };
          break;
        }
      }
      if (!probe) return empty;

      const breakEvenPrice = solveLinearZero(p0, baseNpv, probe.price, probe.npv);
      if (breakEvenPrice === null) return empty;
      return {
        ...product,
        breakEvenPrice,
        ratioToCurrent: p0 > 0 ? breakEvenPrice / p0 : null,
        positiveAtZeroPrice: breakEvenPrice < 0,
        npvPerUnitPrice: (probe.npv - baseNpv) / (probe.price - p0),
      };
    });
  },
};
