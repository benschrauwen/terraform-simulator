/* Where a site sits on a product's market ladder: which tiers its levelized
   cost can serve, and how its output compares with each tier's volume. */

import { MARKET_LADDERS, MMBTU_PER_MCF_CH4 } from '../data/market-ladders.js';

/** Tiers with their own annual volume and the cumulative volume at their right edge. */
export function buildMarketLadder(productKey) {
  const ladder = MARKET_LADDERS[productKey];
  if (!ladder) return null;

  let previousMarket = 0;
  let cumulativeVolume = 0;
  const tiers = ladder.tiers.map(tier => {
    const volume = (tier.cumulativeMarket - previousMarket) / tier.price;
    const startVolume = cumulativeVolume;
    cumulativeVolume += volume;
    previousMarket = tier.cumulativeMarket;
    return { ...tier, volume, startVolume, endVolume: cumulativeVolume };
  });

  return { ...ladder, key: productKey, tiers, totalVolume: cumulativeVolume };
}

/**
 * The site's working point in the ladder's units: annual volume sold and
 * levelized production cost per unit (output credits excluded), plus the
 * assumed sale price, all converted from the scenario result.
 */
export function getSiteWorkingPoint(productKey, result, state) {
  const economics = result?.economics || {};
  if (productKey === 'methane') {
    const annualMCF = result?.sabatier?.enabled ? result.sabatier.ch4AnnualMCF || 0 : 0;
    return {
      annualVolume: annualMCF * MMBTU_PER_MCF_CH4,
      annualNativeVolume: annualMCF,
      nativeUnit: 'MCF/yr',
      unitCost: economics.costPerMCF / MMBTU_PER_MCF_CH4,
      salePrice: state.methanePrice / MMBTU_PER_MCF_CH4,
    };
  }
  if (productKey === 'methanol') {
    const exportTons = result?.methanol?.enabled ? result.methanol.exportAnnualTons || 0 : 0;
    return {
      annualVolume: exportTons,
      annualNativeVolume: exportTons,
      nativeUnit: 't/yr',
      unitCost: economics.costPerTonMethanol,
      salePrice: state.methanolPrice,
    };
  }
  return null;
}

/**
 * Tiers the site clears at its cost (price at or above the levelized cost),
 * the market those tiers add up to, and whether the site's own output would
 * already saturate the beachhead tier.
 */
export function getMarketPosition(ladder, point) {
  const unitCost = Number(point?.unitCost);
  if (!ladder || !Number.isFinite(unitCost) || !(point.annualVolume > 0)) return null;

  const clearedTiers = ladder.tiers.filter(tier => tier.price >= unitCost);
  const nextTier = ladder.tiers.find(tier => tier.price < unitCost) || null;
  const beachhead = ladder.tiers[0];
  return {
    clearedTiers,
    nextTier,
    addressableMarket: clearedTiers.at(-1)?.cumulativeMarket || 0,
    addressableVolume: clearedTiers.at(-1)?.endVolume || 0,
    // Cost reduction still needed to reach the next tier down.
    costCutToNextTier: nextTier ? 1 - nextTier.price / unitCost : null,
    beachheadShare: point.annualVolume / beachhead.volume,
  };
}
