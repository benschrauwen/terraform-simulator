/* ============================================
   Datacenter facility defaults
   ============================================
   Building + electrical capex, land and footprint, IT utilization, uptime
   tiers, IT hardware, revenue (colocation) and water price defaults for the
   datacenter simulator, plus project lead times for the building and the IT.
   Pure data. Cooling plant lives in data/datacenter/cooling.js; grid
   interconnection, HV substation, gas generation, solar and batteries live in
   data/datacenter/power.js.

   Capex split (avoids double counting), $ per kW of IT capacity:
     facility.js  shell + core, in-building electrical (MV switchgear, UPS with
                  ride-through batteries, PDUs/busway), fire, security, BMS,
                  fit-out, soft costs and contingency
     cooling.js   the cooling plant of the chosen technology
     power.js     HV substation/transformers, grid connection, standby or
                  firming generation (gas), solar, battery storage
     land         FACILITY_DEFAULTS.landCapexPerKWIT
   All-in benchmarks (retrieved 2026-10) for cross-checking the sum:
   - Turner & Townsend Data Centre Construction Cost Index 2026-27: US country
     average $12.08/W (typical 60 MW design); AI facilities ~10% more, advanced
     AI $14.00-16.00/W.
     https://www.turnerandtownsend.com/insights/data-centre-construction-cost-index-2026-27/
   - Turner & Townsend (2025-11-05): 7-10% US premium for AI (liquid-cooled)
     over traditional data centers of similar IT capacity.
     https://www.turnerandtownsend.com/en-us/news/ai-data-center-rush-raises-alarm-over-construction-supply-chain/
   - Cushman & Wakefield 2026 Data Center Development Cost Guide: average
     all-in greenfield $17.6M per MW "for the most modern facilities" (US),
     costs up 21% per MW "since we published our last report".
     https://www.cushmanwakefield.com/en/united-states/insights/data-center-development-cost-guide
   - JLL 2026 outlook: global average data centre construction cost $11.3M
     per MW (total build, not shell-and-core; secondary report, JLL text not
     accessible).
     https://www.datacentres.com/news/data-centre-construction-costs-11m-per-mw
   - Epoch AI 1 GW GB200 NVL72 build: facility $11,433, land $172, utility
     works $164, servers $21,188, network $4,925 per kW IT; 14-year facility
     and 5-year IT lives; PUE 1.14.
     https://epoch.ai/data-insights/ai-datacenter-cost-breakdown
   - Bernstein (2025-11-01): ~$35B per GW; generators/turbines ~6%,
     transformers ~5%, UPS ~4%, cooling ~4%, GPUs ~39%, networking ~13%.
     https://www.investing.com/news/stock-market-news/how-much-does-a-gw-of-data-center-capacity-actually-cost-4314046
   Default all-in non-IT build at the default design (grid + standby
   diesel): facility $10,000 + cooling ~$1,500 + standby diesel ~$960 + grid
   connection ~$196 + HV substation ~$131 + land $170 = ~$12,960 per kW IT,
   between T&T's US average ($12.08/W) and its advanced-AI band ($14-16/W),
   and below C&W's all-in $17.6M/MW (which adds powered-land premiums and
   owner costs). Islanded or hybrid designs add on-site generation (power.js),
   moving the sum toward or above T&T's AI band. */

import { AI_COMPUTE_DEFAULTS } from '../reference-data.js';

export const FACILITY_DEFAULTS = {
  // Shell + in-building electrical + fit-out, excluding cooling plant, HV
  // substation, generation and land (scope in header). judgment: T&T
  // advanced-AI $14-16/W all-in minus cooling (~$1.5/W, cooling.js) and
  // substation/generation (~$2-3.5/W, Bernstein shares), cross-checked with
  // Epoch's $11.4k/kW facility (incl. cooling, power).
  capexPerKWIT: { low: 8000, default: 10000, high: 13000 },
  // judgment: Tier multipliers on capexPerKWIT for added redundancy (2N
  // electrical paths, compartmentalization). No public per-tier cost index
  // found; T&T and C&W quote Tier III-class designs.
  tierCapexMultiplier: { I: 0.7, II: 0.85, III: 1.0, IV: 1.25 },
  defaultTier: 'III',
  // Epoch AI 1 GW build: land $172M -> ~$170 per kW IT (URL in header).
  landCapexPerKWIT: 170,

  // Building gross floor area per MW IT: Crusoe Abilene (Stargate) first two
  // buildings 980,000 sq ft (~91,000 m2) for "over 200MW of IT capacity" ->
  // ~450 m2/MW incl. data halls, electrical rooms and support.
  // https://w.media/crusoe-tops-off-final-ai-data-center-in-abilene-texas/ (retrieved 2026-10)
  buildingFloorAreaM2PerMWIT: 450,
  // judgment: single-storey AI halls, so footprint ~ floor area; multi-storey
  // colocation halls in land-constrained markets are 2-4x denser.
  buildingFootprintM2PerMWIT: 450,
  // Total fenced site (buildings, cooling yard, substation, roads, setbacks;
  // excluding solar). Abilene: ~875-1,100 acres reported for ~1.2 GW (8
  // buildings, ~4 million sq ft) -> ~0.7-0.9 acres/MW; acreage varies by
  // source (https://fourweekmba.com/the-stargate-reality-check/,
  // https://www.datacentermap.com/usa/texas/abilene/crusoe-abilene/,
  // retrieved 2026-10). Default = judgment at the low end because power.js
  // and cooling.js size their own yards.
  siteAcresPerMWIT: 0.75,

  // Average IT power as a fraction of IT nameplate. LBNL 2025 update (not
  // opened: escholarship refuses automated access; figures from secondary
  // reading, unverified): AI training servers 80% utilization (75-85%),
  // inference ~20% by 2030 (2024 report: 40%), AI server idle power 20%
  // (20-30%) of rated; average power = rated x (U + idle x (1 - U)).
  // Training -> ~0.84, inference -> 0.36-0.52. Interconnection capacity
  // utilization "estimated to be around 50%".
  // https://escholarship.org/uc/item/33m6w3x0
  // Cross-checks: Epoch AI's 1 GW build assumes 71% utilization ("the
  // average of four estimates collected by Tyler Norris"; URL in header);
  // LBNL's 2024 report projects GPU servers averaging 60-80% of nameplate in
  // 2024-2028 (via Uptime Institute, search index).
  // https://intelligence.uptimeinstitute.com/entity_pdf/node/2858/pdf
  itUtilization: {
    aiTraining: 0.8, // LBNL, rounded down: servers rarely draw full rated power
    aiInference: 0.45, // LBNL 2024-2030 range midpoint
    colocation: 0.5, // LBNL ~50% of interconnection capacity used
    // judgment: owner-operated AI campus with a training-heavy mix that is
    // sized to its load; the user can lower it for inference.
    default: 0.7,
  },

  // Uptime Institute Tier definitions. Uptime's current Tier Standard
  // "does not assign availability predictions to Tier levels" (expected
  // downtime removed 2009):
  // https://journal.uptimeinstitute.com/explaining-uptime-institutes-tier-classification-system/
  // The widely quoted percentages below are the legacy values, e.g.
  // https://phoenixnap.com/blog/data-center-tiers-classification (both
  // retrieved 2026-10). They describe the facility infrastructure, not grid
  // or on-site supply adequacy, which the simulator models explicitly.
  uptimeTiers: [
    { tier: 'I', label: 'Basic capacity', redundancy: 'N', availabilityPercent: 99.671, downtimeHoursPerYear: 28.8 },
    { tier: 'II', label: 'Redundant capacity', redundancy: 'N+1 components', availabilityPercent: 99.741, downtimeHoursPerYear: 22 },
    { tier: 'III', label: 'Concurrently maintainable', redundancy: 'N+1, dual paths', availabilityPercent: 99.982, downtimeHoursPerYear: 1.6 },
    { tier: 'IV', label: 'Fault tolerant', redundancy: '2N or 2N+1', availabilityPercent: 99.995, downtimeHoursPerYear: 0.4 },
  ],

  // IT hardware: reuse the AI defaults (GPU racks, network, storage; not the
  // facility). Epoch's GB200 build gives $26.1k/kW for servers + network
  // (low); GB300 racks alone run ~$36-43k/kW (see reference-data.js).
  itCapexPerKW: { low: 26000, default: AI_COMPUTE_DEFAULTS.capexPerKW, high: 60000 },
  // Meta FY2025 10-K: servers and network 5-5.5 years; buildings 25-30
  // years; equipment 1-25 years.
  // https://www.sec.gov/Archives/edgar/data/1326801/000162828026003942/meta-20251231.htm (retrieved 2026-10)
  itAssetLifeYears: AI_COMPUTE_DEFAULTS.assetLifeYears,
  itOmPercent: AI_COMPUTE_DEFAULTS.omPercent,
  // judgment: blend of shell (25-30 yr, Meta 10-K) and electrical gear
  // (~15-20 yr); Epoch uses 14 for the whole facility.
  facilityAssetLifeYears: 20,
  // judgment: staff, maintenance contracts, insurance and property tax for
  // the building and electrical systems, excluding energy and cooling O&M.
  facilityOmPercentOfCapexPerYear: 2,

  // Wholesale colocation lease (powered shell + fit-out; tenant supplies IT
  // and pays power). CBRE North America H2 2025: primary-market average
  // $195.94-196.25/kW-month for 250-500 kW (record, +6.5% y/y); H1 2026: 10+
  // MW asking rates +6.7% across primary markets (Silicon Valley unchanged;
  // a Silicon Valley $200-275 range is not in the page text, may be in a
  // chart). Default = judgment for a multi-MW block, which leases below the
  // 250-500 kW tier.
  // https://www.cbre.com/insights/books/north-america-data-center-trends-h2-2025
  // https://www.cbre.com/insights/books/north-america-data-center-trends-h1-2026
  // (both retrieved 2026-10)
  colocationLeasePerKWMonth: { low: 130, default: 175, high: 250 },

  // US commercial water price, $ per m3 of withdrawal. Phoenix inside-city
  // volume charge $4.93-6.13 per 748-gal unit (Mar 2025) + $0.62
  // environmental charge -> ~$1.96-2.38/m3, before sewer charges on blowdown.
  // https://phoenix.gov/administration/departments/waterservices/city-services-bill/water-sewer-rates.html
  // (retrieved 2026-10). Default = judgment incl. a sewer allowance.
  waterPricePerM3: { low: 1.0, default: 2.5, high: 5.0 },

  // judgment: UPS batteries (li-ion, 5-10 min ride-through at full load) are
  // in facility capex and only bridge to standby generation or a grid
  // return; energy-shifting storage is the separate battery in power.js.
  upsRideThroughMinutes: 5,
};

/* Project lead times, months from notice-to-proceed, { low, typical, high }.
   Model: path duration = permitting + procurement + construction. */
export const FACILITY_LEAD_TIMES = {
  'shell-fitout': {
    label: 'Datacenter building + fit-out',
    // judgment: local site plan/building permits on a zoned site, 3-12
    // months; contested markets (e.g. Northern Virginia) run longer.
    permittingMonths: { low: 3, typical: 6, high: 12 },
    // In-building long-lead gear (MV switchgear, UPS; Bisnow 2026-10-25:
    // switchgear 12-18 months) is ordered at NTP and runs in parallel with
    // construction; the construction durations below already include it.
    // HV transformers are in power.js.
    // https://www.bisnow.com/news/national/data-center-development/ai-boom-keeps-data-center-supply-chains-stretched-to-the-breaking-point (retrieved 2026-10)
    procurementMonths: { low: 0, typical: 0, high: 0 },
    // Epoch AI (2025-11-10), construction start to first power: Colossus 2
    // ~7.7 (2025-02-28 -> 2025-10-19; retrofit), Stargate Abilene ~12.9, New Carlisle ~16.4, Microsoft
    // Fayetteville ~20.6 (median), Fairwater ~32.6 months. Crusoe Abilene:
    // construction began 2024-07, first two buildings live 2025-09 (~14).
    // https://epoch.ai/data-insights/data-centers-buildout-speeds
    // https://w.media/crusoe-tops-off-final-ai-data-center-in-abilene-texas/
    // (both retrieved 2026-10). Low = Abilene-class fast track; modular /
    // prefabricated halls and power skids push toward it.
    constructionMonths: { low: 13, typical: 20, high: 32 },
  },
  'it-delivery': {
    label: 'GPU / IT hardware delivery + install',
    permittingMonths: { low: 0, typical: 0, high: 0 },
    // judgment: TrendForce (2026-08) calls GB300 racks NVIDIA's primary 2026
    // shipping product with demand persisting into 1H27; no public order-to-
    // delivery figure found.
    // https://www.trendforce.com/presscenter/news/20260828-13204.html (retrieved 2026-10)
    procurementMonths: { low: 3, typical: 6, high: 12 },
    // judgment: rack install, liquid-loop fill, network cabling, burn-in.
    constructionMonths: { low: 1, typical: 2, high: 4 },
  },
};

// Downtime hours per year implied by an availability percentage.
export function downtimeHoursPerYear(availabilityPercent) {
  return (1 - availabilityPercent / 100) * 8760;
}
