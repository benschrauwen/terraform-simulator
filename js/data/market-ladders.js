/* ============================================
   Market ladders for synthetic methane and methanol
   ============================================
   Terraform's view of the markets its products can enter, from small premium
   niches down to bulk commodity. Each tier is [label, price, cumulative market
   size in $/yr up to and including the tier]; a tier's own volume is its
   share of that cumulative revenue divided by its price. Data from Terraform's
   scale-up roadmap (retrieved 2026-10-30), charted in the 2026-06-16 post:
   https://roadmap.terraformindustries.com/
   https://terraformindustries.wordpress.com/2026/06/16/the-enormous-size-of-the-oil-and-gas-market-drives-adoption-of-synthetic-fuel-production/ */

// Higher heating value of pure methane, ~1,010 Btu/scf, converts the app's $/MCF and
// MCF/yr to the ladder's $/MMBtu. (The roadmap uses 1.037, a pipeline-gas value.)
export const MMBTU_PER_MCF_CH4 = 1.01;

export const MARKET_LADDERS = Object.freeze({
  methane: {
    label: 'Methane',
    priceUnit: '$/MMBtu',
    volumeUnit: 'MMBtu/yr',
    tiers: [
      { label: 'Pure methane, packaged (beachhead)', price: 495, cumulativeMarket: 180e6, kind: 'as-is' },
      { label: 'Strategic / remote, diesel-displacing', price: 45, cumulativeMarket: 23e9, kind: 'as-is' },
      { label: 'RNG, western US (D3 RIN + LCFS)', price: 35, cumulativeMarket: 94e9, kind: 'as-is' },
      { label: 'Asian LNG spot (JKM)', price: 18.9, cumulativeMarket: 208e9, kind: 'as-is' },
      { label: 'European gas (TTF)', price: 15.5, cumulativeMarket: 271e9, kind: 'as-is' },
      { label: 'Global bulk (Henry Hub)', price: 3, cumulativeMarket: 698e9, kind: 'as-is' },
    ],
  },
  methanol: {
    label: 'Methanol',
    priceUnit: '$/t',
    volumeUnit: 't/yr',
    tiers: [
      { label: 'Packaged consumer solvent (beachhead)', price: 3000, cumulativeMarket: 90e6, kind: 'as-is' },
      { label: 'Semiconductor / electronic', price: 2000, cumulativeMarket: 190e6, kind: 'purified' },
      { label: 'HPLC / LC-MS analytical', price: 1300, cumulativeMarket: 216e6, kind: 'purified' },
      { label: 'USP / pharma', price: 700, cumulativeMarket: 426e6, kind: 'purified' },
      { label: 'Grade AA methanol', price: 450, cumulativeMarket: 45e9, kind: 'as-is' },
      { label: 'MTX aromatics / olefins', price: 267, cumulativeMarket: 462e9, kind: 'mtx' },
      { label: 'Direct methanol marine fuel', price: 250, cumulativeMarket: 615e9, kind: 'as-is' },
      { label: 'MTG gasoline', price: 223, cumulativeMarket: 1.26e12, kind: 'mtx' },
      { label: 'MTX diesel', price: 190, cumulativeMarket: 2.11e12, kind: 'mtx' },
      { label: 'MTX jet / Jet-A', price: 167, cumulativeMarket: 2.31e12, kind: 'mtx' },
    ],
  },
});

// How a tier's product is made, as in Terraform's methanol chart.
export const LADDER_TIER_KINDS = Object.freeze({
  'as-is': 'Sold as made',
  purified: 'Needs extra purification',
  mtx: 'Needs methanol-to-X conversion',
});
