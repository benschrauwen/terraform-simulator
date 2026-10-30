/* ============================================
   GPU platforms for the GPU-cloud-rental business model
   ============================================
   The default datacenter business: the operator owns the GPUs and rents
   them by the GPU-hour. Per platform: rated IT power per GPU, all-in capex
   per GPU, a rental price, and reference prices. Pure data. All URLs
   retrieved 2026-10; "search index" marks a figure read from a search-engine
   extract of the cited page.

   IT power per GPU (itKWPerGpu) is the RATED system power per GPU (server or
   rack maximum / GPUs) x (1 + networkStorageShare) for the scale-out network,
   storage and management gear outside the server. It sizes how many GPUs
   fit in the IT capacity; the model applies PUE itself and the average draw
   follows occupancy (GPU_RENTAL_DEFAULTS). SemiAnalysis's "all-in" kW per
   chip (allInKWSemiAnalysis: host CPU, NICs and a cooling share, at
   typical rather than maximum draw) is kept for reference only.

   Capex per GPU (capexPerGpu) is all-in IT hardware: GPU server or rack
   share, network and storage, excluding the facility (facility.js).

   Rental price (rentalPricePerGpuHour) defaults to the SemiAnalysis AI Cloud
   TCO model "Retail" rate per chip-hour shown on each InferenceX chip page,
   the one source that covers every platform consistently, including
   GB200/GB300 NVL72. Market indexes run higher in 2026 (marketIndex: Silicon
   Data's neocloud rental indexes; on-demand list prices for NVL72), but a
   large fleet rents mostly on term contracts below spot and on-demand
   (Silicon Data's own B200 12-month forward rate is 12% below spot), so the
   retail TCO rate is the conservative default. ownerTcoPerGpuHour is
   SemiAnalysis's "Owning at Large Hyperscaler Volume" cost, for context.
   https://inferencex.semianalysis.com/chips/h100
   https://inferencex.semianalysis.com/chips/h200
   https://inferencex.semianalysis.com/chips/b200
   https://inferencex.semianalysis.com/chips/gb200-nvl72
   https://inferencex.semianalysis.com/chips/gb300-nvl72
   https://www.silicondata.com/blog/b200-rental-price-august-2026-update
   https://www.silicondata.com/blog/h200-vs-h100-rental-prices-may-july-2026 */

export const GPU_RENTAL_DEFAULTS = {
  // judgment: scale-out network (spine/leaf switches, optics), storage and
  // management power outside the GPU server or rack, +10% of rated power.
  networkStorageShare: 0.1,

  // Share of GPU-hours rented. judgment: well-run neoclouds sell most of
  // their fleet on 1-3 year contracts; 85% leaves room for spares, burn-in,
  // turnover between contracts and unsold on-demand capacity.
  occupancyPercent: 85,

  // Average IT draw as a share of rated power. LBNL 2025 update (facility.js
  // itUtilization): AI training servers run at ~80% of rated power, and an
  // idle AI server draws ~20% (20-30%) of rated. A rented GPU is taken to
  // run like a training server; an unrented one idles.
  // https://escholarship.org/uc/item/33m6w3x0
  rentedLoadFraction: 0.8,
  idleLoadFraction: 0.2,

  // Economic life: hyperscalers depreciate servers over ~5-5.5 years (Meta
  // FY2025 10-K, facility.js); the plant builder's AI default is 5.
  lifeYears: 5,

  // Real rental-price decline per year of a GPU's age. Evidence:
  // - H100 hyperscaler on-demand median $7.76/GPU-hr (Aug-Dec 2023) ->
  //   $6.26 (Jul-Dec 2025): ~-10%/yr; neocloud median $2.99 (Jun-Dec 2024)
  //   -> $2.63 (Silicon Data index, 2026-09-07): ~-6%/yr; "early rental
  //   prices routinely exceeded $7-$10 per GPU-hour" (2023) -> $2.63 (2026):
  //   ~-30%/yr across tiers.
  //   https://www.silicondata.com/blog/h100-rental-price-over-time
  // - B200 on 2026-09-07: spot $5.69, 12-month forward $5.03 (-12% in a year).
  //   https://www.silicondata.com/blog/b200-rental-price-august-2026-update
  // Default: judgment between the within-tier (6-12%) and cross-tier (~30%)
  // declines, for a GPU that ages while newer generations arrive.
  priceDeclinePercentPerYear: 15,
};

// judgment: the 2026 mainstream for new AI builds. TrendForce (2026-08):
// GB300 racks are NVIDIA's primary 2026 shipping product (facility.js).
export const DEFAULT_GPU_PLATFORM = 'gb300-nvl72';

const withNetwork = kW => Math.round(kW * (1 + GPU_RENTAL_DEFAULTS.networkStorageShare) * 100) / 100;

export const GPU_PLATFORMS = {
  'h100-sxm': {
    label: 'NVIDIA H100 SXM (HGX, 8 GPUs)',
    gpusPerSystem: 8,
    tdpW: 700, // InferenceX H100 page
    // NVIDIA DGX H100/H200 user guide: 10.2 kW max (the table header reads
    // "for each power supply"; NVIDIA's product pages give it as system power).
    // https://docs.nvidia.com/dgx/dgxh100-user-guide/introduction-to-dgxh100.html
    systemKW: 10.2,
    itKWPerGpu: withNetwork(10.2 / 8), // 1.40
    allInKWSemiAnalysis: 1.37,
    // IntuitionLabs pricing index (updated 2026-10-11): 8-GPU DGX H100
    // $300,000-460,000 (Q1-Q2 2026). Midpoint / 8 x 1.1 for network and
    // storage = ~$52k (judgment on the share).
    // https://intuitionlabs.ai/articles/data-center-gpu-pricing-2026
    capexPerGpu: 52000,
    rentalPricePerGpuHour: 2.0, // InferenceX/SemiAnalysis retail
    ownerTcoPerGpuHour: 1.17,
    marketIndex: { pricePerGpuHour: 2.63, date: '2026-09-07', source: 'Silicon Data H100 neocloud rental index' },
  },
  h200: {
    label: 'NVIDIA H200 SXM (HGX, 8 GPUs)',
    gpusPerSystem: 8,
    tdpW: 700, // InferenceX H200 page
    systemKW: 10.2, // DGX H100/H200 user guide (above)
    itKWPerGpu: withNetwork(10.2 / 8), // 1.40
    allInKWSemiAnalysis: 1.37,
    // IntuitionLabs (above): 8-GPU DGX H200 ~$400,000-500,000; midpoint / 8 x 1.1.
    capexPerGpu: 62000,
    rentalPricePerGpuHour: 2.9, // InferenceX/SemiAnalysis retail
    ownerTcoPerGpuHour: 1.22,
    marketIndex: { pricePerGpuHour: 3.29, date: '2026-09-07', source: 'Silicon Data H200 neocloud rental index' },
  },
  b200: {
    label: 'NVIDIA B200 (HGX, 8 GPUs)',
    gpusPerSystem: 8,
    tdpW: 1000, // InferenceX B200 page
    // NVIDIA DGX B200 user guide: 14.3 kW max, 8 x B200.
    // https://docs.nvidia.com/dgx/dgxb200-user-guide/introduction-to-dgxb200.html
    systemKW: 14.3,
    itKWPerGpu: withNetwork(14.3 / 8), // 1.97
    allInKWSemiAnalysis: 1.71,
    // judgment, derived: Epoch AI's 1 GW GB200 build carries servers $21,188
    // + network $4,925 = $26,113 per IT kW (facility.js); x 1.79 kW per B200
    // = ~$47k. IntuitionLabs lists the B200 card alone at $30-50k.
    capexPerGpu: 47000,
    rentalPricePerGpuHour: 3.7, // InferenceX/SemiAnalysis retail
    ownerTcoPerGpuHour: 1.73,
    marketIndex: { pricePerGpuHour: 5.69, date: '2026-09-07', source: 'Silicon Data B200 neocloud rental index (12-month forward 5.03)' },
  },
  'gb200-nvl72': {
    label: 'NVIDIA GB200 NVL72 (rack, 72 GPUs)',
    gpusPerSystem: 72,
    tdpW: 1200, // InferenceX GB200 NVL72 page
    // SemiAnalysis: ~123.6 kW per NVL72 including AC-DC conversion losses
    // (search index); vendors quote 120-135 kW.
    // https://semianalysis.substack.com/p/gb200-hardware-architecture-and-component
    systemKW: 123.6,
    itKWPerGpu: withNetwork(123.6 / 72), // 1.89
    allInKWSemiAnalysis: 1.87,
    // Epoch AI servers + network $26,113 per IT kW x 1.717 kW per GPU =
    // ~$45k; Wing VC: ~$3M per rack reported (~$42k per GPU before network).
    // https://www.wing.vc/content/how-much-does-an-nvidia-nvl72-cost
    capexPerGpu: 45000,
    rentalPricePerGpuHour: 4.0, // InferenceX/SemiAnalysis retail
    ownerTcoPerGpuHour: 1.86,
    // AmCompute, Oct 2026: GB200 on-demand $6.50-10.50, median $8.00 (search index).
    // https://www.amcompute.com/gpu-cloud-prices/gb200
    marketIndex: { pricePerGpuHour: 8.0, date: '2026-10', source: 'On-demand list median across 6 providers (AmCompute)' },
  },
  'gb300-nvl72': {
    label: 'NVIDIA GB300 NVL72 (rack, 72 GPUs)',
    gpusPerSystem: 72,
    tdpW: 1400, // InferenceX GB300 NVL72 page
    // HPE: rack TDP 132 kW nominal, ~155 kW peak; Supermicro: 8 x 33 kW
    // power shelves = 132 kW (search index).
    // https://www.hpe.com/us/en/collaterals/collateral.a50009244enw.html
    systemKW: 132,
    itKWPerGpu: withNetwork(132 / 72), // 2.02
    allInKWSemiAnalysis: 2.12,
    // Wing VC (Aug 2026): recent GB300 NVL72 purchase orders "just under
    // $5.0M" per rack (~$69K per GPU slot) plus "several hundred thousand
    // dollars of network attach"; judgment ~$0.4M -> $5.4M / 72 = $75k.
    capexPerGpu: 75000,
    rentalPricePerGpuHour: 5.0, // InferenceX/SemiAnalysis retail
    ownerTcoPerGpuHour: 2.31,
    // AmCompute, Oct 2026: GB300 on-demand from $6.50, median $11.59 across
    // 3 providers (search index).
    // https://www.amcompute.com/gpu-cloud-prices/gb300
    marketIndex: { pricePerGpuHour: 6.5, date: '2026-10', source: 'Lowest on-demand list price across 3 providers (AmCompute)' },
  },
};
