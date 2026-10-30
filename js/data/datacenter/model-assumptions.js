/* ============================================
   Datacenter model assumptions
   ============================================
   Fixed constants the datacenter model needs that are not in sites.js,
   cooling.js, facility.js or power.js: physical constants, asset lives the
   data files do not give, footprints, the project start date and the
   deterministic outage placement. Pure data. Every value is a physical
   constant, derived from a data file (named) or marked "judgment". */

import { AI_COMPUTE_DEFAULTS } from '../reference-data.js';

export const DATACENTER_MODEL_ASSUMPTIONS = Object.freeze({
  // Physical constant: 1 MMBtu = 1,055.056 MJ = 293.071 kWh.
  kWhPerMMBtu: 293.071,

  // judgment: notice-to-proceed for a project planned now (Oct 2026); the
  // schedule reports calendar dates from it and nuclear types cannot reach
  // commercial operation before their earliestCodYear (power.js).
  projectNoticeToProceed: Object.freeze({ year: 2027, month: 1 }),

  // Asset lives not given in the data files (years). judgment: gas engines
  // and turbines 25 (EIA/Lazard cost bases assume 20-30 yr plant lives);
  // new nuclear 40 (initial NRC licence term; units then run 60-80 yr);
  // customer HV substation and the utility interconnection contribution 40
  // (transformers and lines outlast the 20-yr facility).
  assetLifeYears: Object.freeze({
    gas: 25,
    nuclear: 40,
    substation: 40,
    gridInterconnection: 40,
  }),

  // Tokens per MWh of IT energy. AI_COMPUTE_DEFAULTS.millionTokensPerMWh is
  // per FACILITY MWh (cooling included, see reference-data.js); dividing by
  // the facility PUE it implies turns it into a per-IT-MWh throughput so a
  // better PUE lowers cost instead of revenue. 1.14 = Epoch AI's PUE for the
  // GB200 build quoted there; the product is rounded (judgment).
  millionTokensPerMWhIT: Math.round((AI_COMPUTE_DEFAULTS.millionTokensPerMWh * 1.14) / 10) * 10,

  // Flexible grid connection: the unavailable hours come as contiguous
  // events of this length on the days of highest facility load (hot
  // afternoons, when grids are most stressed). Camus et al. (power.js
  // GRID_DEFAULTS) report curtailment events of 4-16 h; 4 h = lower end,
  // judgment.
  flexibleEventHours: 4,

  // Deterministic planned outages, placed in shoulder seasons (judgment):
  // each gas unit is out (1 - availability) x 8760 h per year, units one
  // after another from 1 March; each nuclear unit's refuelling/maintenance
  // outage of (1 - capacity factor) x 8760 h runs from 1 April, units
  // staggered back to back. Forced outages are not drawn at random.
  gasOutageStartDayOfYear: 60,
  nuclearOutageStartDayOfYear: 91,

  // Battery yard footprint, m2 per MWh. judgment: a ~4 MWh container on
  // ~15 m2 plus ~3x for spacing, fire separation, inverters and roads.
  batteryFootprintM2PerMWh: 12,

  // Nuclear power-block footprint, m2 per MWe (judgment, plant island only;
  // the emergency planning zone is separate, see nuclearExclusionZone).
  // An existing contracted plant is off site.
  nuclearFootprintM2PerMW: Object.freeze({
    'large-lwr': 250,
    'contracted-existing': 0,
    'bwrx-300': 400,
    nuscale: 400,
    'xe-100': 400,
    kairos: 400,
    natrium: 400,
    microreactor: 300,
  }),
  // Emergency planning zone notes (summarised from power.js NUCLEAR_TYPES
  // sources: NRC 2023 rule 10 CFR 50.160 allows scalable EPZs for SMRs and
  // non-LWRs, possibly at the site boundary; large LWRs keep ~10-mile EPZs).
  nuclearExclusionZone: Object.freeze({
    'large-lwr': 'Standard ~10-mile (16 km) plume-exposure emergency planning zone.',
    'contracted-existing': 'Existing plant off site; its emergency planning zone is not on the datacenter site.',
    default: 'Scalable emergency planning zone under the 2023 NRC rule, possibly at the site boundary (not yet demonstrated for a licensed plant).',
  }),
  // Net electric efficiency used for on-site reactor waste heat (judgment;
  // power.js: ~33% for LWRs, ~40% for high-temperature designs).
  nuclearThermalEfficiency: Object.freeze({
    'large-lwr': 0.33,
    'contracted-existing': 0.33,
    'bwrx-300': 0.33,
    nuscale: 0.31,
    'xe-100': 0.4,
    kairos: 0.4,
    natrium: 0.4,
    microreactor: 0.3,
  }),

  // Hours with unserved energy below this fraction of the hour's load still
  // count as fully served (numerical tolerance, not a reliability allowance).
  servedTolerance: 1e-9,
});
