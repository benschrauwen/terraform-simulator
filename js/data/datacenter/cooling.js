/* ============================================
   Datacenter cooling technologies
   ============================================
   Hourly PUE and water models per cooling technology, plus plant capex,
   O&M, footprint, heat-reuse temperature and plant lead times. Pure data.

   PUE(h) = 1 + overheadFraction + coolingFraction(T(h)), where T is the
   ambient dry-bulb or wet-bulb temperature named by `cooling.basis`:
     T < freeCoolingBelowC  -> freeCoolingFraction (economizer / dry cooler:
                               fans and pumps only)
     T >= freeCoolingBelowC -> linear interpolation of mechanicalFractionAt
                               [[tempC, kW cooling per kW IT], ...], clamped
                               to the first/last point.
   `overheadFraction` is the non-cooling facility overhead (UPS and
   transformer losses, switchgear, lighting, BMS) as a fraction of IT power.

   Water: WUE(h) in litres per kWh of IT energy = linear interpolation of
   water.litresPerKWhITAt at the temperature named by `water.basis` (same
   clamping). This is site water WITHDRAWN (make-up), the Green Grid WUE
   numerator (https://thegreengrid.org/en/resources/library-and-tools/238-WP,
   WP#35: annual site water usage / IT energy, L/kWh; retrieved 2026-10).
   evaporatedShare + blowdownShare = 1 split it into water consumed
   (evaporated) and water discharged (blowdown/bleed) for the flow diagram.
   Domestic water (restrooms, kitchens) is excluded.

   Heat: every kWh drawn by the facility leaves as heat. The latent part is
   evaporated litres x LATENT_HEAT_KWH_PER_LITRE; the rest is rejected to air
   as sensible heat (dry coolers, chiller condensers, exhaust air).

   Calibration (annual PUE / withdrawn WUE L/kWh-IT) was run on PVGIS v5.3 TMY
   hourly T2m and RH (wet-bulb by Stull 2011) averaged to the 12x24 typical
   days the model uses, for Chicago (ERA5 mean dry-bulb 11.3 C) and Phoenix
   (22.8 C), retrieved 2026-10 from https://re.jrc.ec.europa.eu/api/v5_3/tmy.
   Results sit in each technology's `calibration`; the targets they were tuned
   to are stated next to them. Full-hourly TMY gives values within 0.005 PUE
   of the 12x24 results, but the 12x24 averaging trims peak-hour PUE (Phoenix
   air-chiller peak 1.66 typical-day vs 1.76 hourly).

   Fleet benchmarks used for the targets (all retrieved 2026-10):
   - Uptime Institute Global Data Center Survey 2026: industry average annual
     PUE 1.52, capacity-weighted 1.36; newer large sites "routinely" <= 1.3.
     https://intelligence.uptimeinstitute.com/resource/growing-pue-advantage-larger-data-centers
   - LBNL 2025 update: national average PUE 1.45 (2024); facilities serving AI
     equipment 1.145 (2024) -> 1.136 (2030).
     https://escholarship.org/uc/item/33m6w3x0
   - LBNL 2024 report: average site WUE ~0.36 L/kWh through 2023, rising to
     0.45-0.48; hyperscale airside-economizer + adiabatic systems report
     0.1-0.3 L/kWh; water-cooled chillers / towers have the highest WUE.
     https://eta-publications.lbl.gov/sites/default/files/2024-12/lbnl-2024-united-states-data-center-energy-usage-report_1.pdf
   - Google fleet TTM PUE 1.09 every quarter 2025 Q1 - 2026 Q2; campus TTM:
     Eemshaven NL 1.07, Hamina FI 1.09, Midlothian TX 1.11; Mesa AZ (dry,
     "air-cooled" campus, < 12 months data) quarterly 1.22 (Q1) / 1.28 (Q2 2026).
     https://www.datacenters.google/efficiency
   - Google 2025 Environmental Report (2024 data): data centers withdrew 9,866
     and consumed 7,787 million US gal (79% consumed, 21% discharged) on
     30,825,600 MWh -> 0.96 L consumed per facility kWh, ~1.04 per IT kWh at
     PUE 1.09; withdrawal ~1.32 L per IT kWh.
     https://www.gstatic.com/gumdrop/sustainability/google-2025-environmental-report.pdf
   - Microsoft FY2024 fleet WUE 0.30 L/kWh; new closed-loop chip-level designs
     use no water for cooling (~125 million L/yr saved per datacenter) at a
     "nominal" PUE increase.
     https://www.microsoft.com/en-us/microsoft-cloud/blog/2024/12/09/sustainable-by-design-next-generation-datacenters-consume-zero-water-for-cooling/
   - Equinix (colocation, mostly air-cooled) 2024 annual average PUE 1.39.
     https://www.sec.gov/Archives/edgar/data/1101239/000110123926000032/eqix-20251231.htm

   Capex scope: installed cooling plant only (heat rejection, chillers or
   CDUs, pumps, piping, CRAH/fan walls or tanks, controls), $ per kW of IT
   capacity, INCREMENTAL to the building shell + electrical in facility.js
   (which excludes cooling). Public, itemized cooling costs are scarce; the
   anchor is Bernstein (2025-11-01): cooling/thermal ~4% of ~$35B per GW of AI
   capacity ~ $1,400/kW IT for a GB200-class (liquid + air) build.
   https://www.investing.com/news/stock-market-news/how-much-does-a-gw-of-data-center-capacity-actually-cost-4314046
   Relative costs follow Schneider Electric WP-282 (immersion vs air: equal
   capex at 10 kW/rack, 10-14% lower whole-facility capex at 20-40 kW/rack
   because chillers and CRAHs drop out while dry coolers, pumps and fluid are
   added), as summarized at
   https://www.prnewswire.co.uk/news-releases/schneider-electric-releases-white-paper-on-capital-cost-comparison-of-data-centre-liquid-cooling-vs-traditional-air-cooling-812600415.html
   Per-technology values are therefore judgment around that anchor.

   Lead times { low, typical, high } in months from notice-to-proceed. The
   cooling plant is permitted with the building; procurement is the
   equipment order-to-delivery, construction is install + commissioning.
   Bisnow (2026-10-25): "chillers and other cooling system components
   routinely carry lead times of 12 to 18 months".
   https://www.bisnow.com/news/national/data-center-development/ai-boom-keeps-data-center-supply-chains-stretched-to-the-breaking-point */

// Latent heat of vaporization of water ~2,442 kJ/kg at 25 C (steam tables;
// physical constant) / 3,600 kJ per kWh = 0.678 kWh of heat per litre
// evaporated. A tower that evaporates all of 1 kWh of heat uses ~1.47 L.
export const LATENT_HEAT_KWH_PER_LITRE = 0.678;

// Common server/rack inlet limits for context (ASHRAE TC 9.9, 2021 5th ed.):
// recommended inlet 18-27 C dry-bulb for classes A1-A4; allowable A1 15-32 C,
// A2 10-35 C. Liquid-cooling facility-water classes W17/W27/W32/W40/W45/W+.
// https://www.ashrae.org/file%20library/technical%20resources/bookstore/supplemental%20files/therm-gdlns-5th-r-e-refcard.pdf
// https://www.upsite.com/blog/major-changes-to-ashraes-fifth-edition-of-thermal-guidelines-part-3-liquid-cooling-chapter-updates/
// (both retrieved 2026-10)
export const ASHRAE_THERMAL_ENVELOPE = {
  recommendedInletC: [18, 27],
  allowableA1InletC: [15, 32],
  allowableA2InletC: [10, 35],
  liquidClassesMaxSupplyC: { W17: 17, W27: 27, W32: 32, W40: 40, W45: 45 },
};

// Cooling-plant lead time shared by the technologies whose plant is mainly
// chillers, CDUs or heat-rejection units ordered from the same supply chain.
const COOLING_EQUIPMENT_PROCUREMENT_MONTHS = {
  // Bisnow 2026-10-25 (URL in header): 12-18 months for chillers and cooling
  // components; earlier (2023-06) Data Center Frontier roundtable: "chillers
  // are pushing 12 to 16 months"
  // (https://www.datacenterfrontier.com/executive-roundtable/article/33006445/voices-of-the-industry,
  // retrieved 2026-10). Typical = midpoint.
  low: 12,
  typical: 15,
  high: 18,
};

export const COOLING_TECHNOLOGIES = {
  'air-chiller': {
    id: 'air-chiller',
    label: 'Air cooling (CRAH + air-cooled chillers, economizer)',
    shortDescription: 'Fans push chilled air through the server rooms; air-cooled chillers make the cold water, and in cool weather a dry economizer coil does it without compressors. No water is evaporated.',
    typicalUse: 'Legacy enterprise and colocation halls, up to ~15-20 kW/rack',
    // judgment: Uptime 2025 survey: densities rising mainly in the 10-30 kW
    // range, "few facilities exceed 30 kW"; ~20 kW is the practical air limit
    // without rear-door coolers.
    // https://intelligence.uptimeinstitute.com/resource/uptime-institute-global-data-center-survey-2025 (retrieved 2026-10)
    maxRackDensityKW: 20,
    // judgment: colocation-style double-conversion UPS (LBNL Table 4.3 gives
    // 80-94% UPS efficiency for colocation, 90-99% hyperscale) plus
    // transformers and lighting: ~0.08 of IT.
    // https://eta-publications.lbl.gov/sites/default/files/2024-12/lbnl-2024-united-states-data-center-energy-usage-report_1.pdf (retrieved 2026-10)
    overheadFraction: 0.08,
    cooling: {
      basis: 'dryBulb',
      // judgment: 18-20 C chilled water from a dry economizer coil needs
      // ambient below ~10 C; CRAH fans + pumps + coil fans ~0.16 of IT.
      freeCoolingBelowC: 10,
      freeCoolingFraction: 0.16,
      // judgment, calibrated to annual PUE 1.30 at a 11 C site and 1.41 at a
      // 23 C desert site: Equinix 2024 fleet 1.39 and Uptime 2026 capacity-
      // weighted 1.36 (both mostly air-cooled; URLs in header). Chiller kW/kW
      // rises with condenser (dry-bulb) temperature.
      mechanicalFractionAt: [[10, 0.16], [18, 0.25], [25, 0.34], [32, 0.45], [40, 0.58], [46, 0.68]],
    },
    water: {
      basis: 'dryBulb',
      // Closed chilled-water loop and dry condensers: no evaporation. LBNL
      // 2024: such systems show "minimal WUE values, primarily influenced by
      // occasional humidification" (URL above, retrieved 2026-10).
      litresPerKWhITAt: [[-30, 0], [50, 0]],
      evaporatedShare: 1,
      blowdownShare: 0,
    },
    capexPerKWIT: {
      // judgment: chillers + CRAH + economizer coils + piping, above the
      // ~$1,400/kW Bernstein liquid/air AI anchor because the full heat load
      // passes through compressors and air handlers (see header).
      low: 1300,
      default: 1800,
      high: 2500,
    },
    // judgment: mechanical maintenance contracts, refrigerant service, filters.
    omPercentOfCapexPerYear: 3,
    // judgment: air-cooled chiller ~1.5 MW per ~28 m2 unit, x2 for service
    // clearance and airflow, N+1, sized for IT x peak PUE.
    footprintM2PerMWIT: 70,
    // judgment: chillers 20+ yr, CRAH fans/coils ~15 yr; blended.
    assetLifeYears: 15,
    heatReuse: {
      supplyTempC: 30,
      note: 'Low-grade: ~30 C hot-aisle air or ~25 C return water; needs a heat pump for district heating.',
    },
    leadTimes: {
      permittingMonths: { low: 0, typical: 0, high: 2 }, // judgment: covered by the building permit
      procurementMonths: COOLING_EQUIPMENT_PROCUREMENT_MONTHS,
      constructionMonths: { low: 3, typical: 4, high: 6 }, // judgment: set, pipe, commission in parallel with fit-out
    },
    calibration: {
      temperate: { site: 'Chicago (11.3 C)', pue: 1.30, wueLPerKWhIT: 0 },
      hotDesert: { site: 'Phoenix (22.8 C)', pue: 1.41, wueLPerKWhIT: 0 },
    },
  },

  'air-evaporative': {
    id: 'air-evaporative',
    label: 'Air cooling with outside air + evaporative assist',
    shortDescription: 'Filtered outside air cools the servers directly most of the year; on hot days it is pre-cooled by evaporating water through wet media. No chillers, very low power, some water in hot weather.',
    typicalUse: 'Hyperscale cloud halls (Meta-style), up to ~20 kW/rack',
    // judgment: same air-side density limit as above.
    maxRackDensityKW: 20,
    // judgment: hyperscale UPS 90-99% efficient (LBNL Table 4.3, URL in header).
    overheadFraction: 0.045,
    cooling: {
      basis: 'dryBulb',
      // judgment: outside air below ~22 C is supplied directly (ASHRAE
      // recommended inlet up to 27 C); fans only.
      freeCoolingBelowC: 22,
      freeCoolingFraction: 0.04,
      // judgment, calibrated to 1.09 at 11 C and 1.10 at 23 C: Meta's
      // evaporative fleet reported PUE 1.09 (2021) and Google campuses
      // 1.07-1.11 (header); fans + pumps + occasional DX trim.
      mechanicalFractionAt: [[22, 0.04], [27, 0.05], [32, 0.07], [38, 0.09], [46, 0.13]],
    },
    water: {
      basis: 'dryBulb',
      // Physics: with ~12 K air rise across the servers, cooling the intake
      // by dT evaporates ~0.12 x dT L per kWh IT (1.006 kJ/kg-K x dT / 2,442
      // kJ/kg x 1/(1.006 x 12) kg/s per kW x 3,600 s), e.g. 35 -> 25 C needs
      // ~1.2 L/kWh. Curve includes ~15% media bleed. Calibrated to ~0.1 at a
      // 11 C site and ~0.4 at a 23 C desert site: LBNL 2024 notes hyperscale
      // adiabatic systems report 0.1-0.3 L/kWh, Meta's fleet 0.26 (2021).
      // Meta 2021: https://digital.bnpmedia.com/article/Data+Centers+Look+to+Find+Balance+Between+Demand+and+Delivery/4324536/757300/article.html (retrieved 2026-10)
      litresPerKWhITAt: [[18, 0.02], [22, 0.1], [26, 0.35], [30, 0.7], [35, 1.15], [40, 1.6], [46, 2.0]],
      // judgment: wet-media sump bleed ~15% of make-up.
      evaporatedShare: 0.85,
      blowdownShare: 0.15,
    },
    capexPerKWIT: {
      // judgment: evaporative air handlers and fans, no chiller plant.
      low: 900,
      default: 1200,
      high: 1700,
    },
    omPercentOfCapexPerYear: 3, // judgment: media replacement, water treatment, filters
    // judgment: air handlers sit in a penthouse or side gallery outside the
    // white space; ~30 m2 per MW of plan area.
    footprintM2PerMWIT: 30,
    assetLifeYears: 15, // judgment
    heatReuse: {
      supplyTempC: 35,
      note: 'Warm humid exhaust air (~35 C); rarely reused.',
    },
    leadTimes: {
      // judgment: water-supply agreement for evaporative make-up.
      permittingMonths: { low: 0, typical: 2, high: 6 },
      procurementMonths: COOLING_EQUIPMENT_PROCUREMENT_MONTHS,
      constructionMonths: { low: 3, typical: 4, high: 6 }, // judgment
    },
    calibration: {
      temperate: { site: 'Chicago (11.3 C)', pue: 1.09, wueLPerKWhIT: 0.08 },
      hotDesert: { site: 'Phoenix (22.8 C)', pue: 1.10, wueLPerKWhIT: 0.41 },
    },
  },

  'dlc-dry-cooler': {
    id: 'dlc-dry-cooler',
    label: 'Direct-to-chip liquid + dry coolers (closed loop)',
    shortDescription: 'Cold plates on the GPUs carry most of the heat in warm water to fan-cooled radiators outside; a small chiller handles the remaining air-cooled parts and the hottest hours. No water is evaporated.',
    typicalUse: 'AI racks 100+ kW (GB200/GB300/Vera Rubin); zero-water designs',
    // Vertiv/NVIDIA GB200 NVL72 reference design supports up to 132 kW/rack;
    // Vera Rubin draws ~2x Grace Blackwell rack power (NVIDIA CEO, CES 2026).
    // https://investors.vertiv.com/news/news-details/2024/Vertiv-Codevelops-with-NVIDIA-Complete-Power-and-Cooling-Blueprint-for-NVIDIA-GB200-NVL72-Platform/default.aspx
    // https://www.facilitiesdive.com/news/no-chillers-needed-for-vera-rubin-server-racks-nvidia-ceo/809216/
    // (both retrieved 2026-10); 250 kW = judgment from the ~2x.
    maxRackDensityKW: 250,
    overheadFraction: 0.045, // judgment: hyperscale UPS 90-99% (LBNL Table 4.3)
    cooling: {
      basis: 'dryBulb',
      // judgment: with W32-W45 facility water (NVIDIA: 45 C supply for Vera
      // Rubin "doesn't need a chiller") dry coolers cover the liquid load
      // well above 30 C; the 15-20% residual air load needs ~20-25 C water,
      // which trim/economizing chillers make above ~15 C.
      freeCoolingBelowC: 15,
      freeCoolingFraction: 0.06,
      // judgment, calibrated to 1.12 at 11 C and 1.17 at 23 C: LBNL 2025 puts
      // AI-serving facilities at 1.145 nationally; Google's dry Mesa AZ campus
      // ran 1.22-1.28 in its first (ramp-up) quarters (header).
      mechanicalFractionAt: [[15, 0.06], [22, 0.09], [28, 0.14], [33, 0.20], [38, 0.27], [46, 0.36]],
    },
    water: {
      basis: 'dryBulb',
      // Microsoft: closed loop filled at construction, "near zero" WUE (URL
      // in header). Adiabatic-assisted dry coolers would add a small summer
      // water use; not modeled here.
      litresPerKWhITAt: [[-30, 0], [50, 0]],
      evaporatedShare: 1,
      blowdownShare: 0,
    },
    capexPerKWIT: {
      // Bernstein ~$1,400/kW cooling for a GB200-class build (header); dry
      // coolers cost more per kW than towers; +trim chillers. Range judgment.
      low: 1200,
      default: 1500,
      high: 2300,
    },
    omPercentOfCapexPerYear: 2.5, // judgment: pumps, CDU filters, coolant, fans
    // judgment: V-type dry cooler ~1 MW per ~31 m2 at a 35/45 C loop, x2 for
    // airflow spacing, N+1, plus trim chillers.
    footprintM2PerMWIT: 80,
    assetLifeYears: 15, // judgment
    heatReuse: {
      supplyTempC: 50,
      note: 'Facility water returns at ~40-55 C (W40/W45 class), directly usable for low-temperature district heating or greenhouses.',
    },
    leadTimes: {
      permittingMonths: { low: 0, typical: 0, high: 2 }, // judgment: building permit
      // CDUs and dry coolers share the 12-18 month cooling supply chain
      // (Bisnow, header); a CDU vendor also quotes 12-18 months
      // (https://nautilusdt.com/tag/cdu/, retrieved 2026-10; vendor claim).
      procurementMonths: COOLING_EQUIPMENT_PROCUREMENT_MONTHS,
      constructionMonths: { low: 3, typical: 5, high: 8 }, // judgment: secondary loop piping to every rack
    },
    calibration: {
      temperate: { site: 'Chicago (11.3 C)', pue: 1.12, wueLPerKWhIT: 0 },
      hotDesert: { site: 'Phoenix (22.8 C)', pue: 1.17, wueLPerKWhIT: 0 },
    },
  },

  'dlc-cooling-tower': {
    id: 'dlc-cooling-tower',
    label: 'Direct-to-chip liquid + evaporative cooling towers',
    shortDescription: 'Cold plates carry the heat in warm water to open cooling towers, which reject it by evaporating water. Lowest power use, but it consumes roughly a litre of water per kWh.',
    typicalUse: 'AI racks 100+ kW where water is plentiful (Google-style plants)',
    maxRackDensityKW: 250, // same cold-plate limit as dlc-dry-cooler
    overheadFraction: 0.045, // judgment: hyperscale UPS 90-99% (LBNL Table 4.3)
    cooling: {
      basis: 'wetBulb',
      // judgment: towers approach wet-bulb within ~4-6 K, so warm-water
      // loops run without compressors below ~12 C wet-bulb.
      freeCoolingBelowC: 12,
      freeCoolingFraction: 0.04,
      // judgment, calibrated to 1.09 at 11 C, 1.10 in hot-humid Dallas and
      // 1.09 in Phoenix (lower wet-bulb): Google fleet TTM 1.09 and
      // Midlothian TX 1.11 (header).
      mechanicalFractionAt: [[12, 0.04], [18, 0.055], [22, 0.07], [26, 0.09], [30, 0.11]],
    },
    water: {
      // Dry-bulb basis: the sensible share of tower heat rejection falls as
      // the air warms, so evaporation per kWh rises towards the all-latent
      // ~1.47 L/kWh (LATENT_HEAT_KWH_PER_LITRE) plus blowdown.
      basis: 'dryBulb',
      // judgment, calibrated to withdrawn ~1.23 L/kWh-IT (0.97 consumed) at a
      // 11 C site and ~1.5 (1.2 consumed) at a 23 C desert site: Google 2024
      // data centers consumed ~1.04 L per IT kWh, withdrew ~1.32 (header).
      litresPerKWhITAt: [[-10, 0.7], [0, 0.95], [10, 1.2], [20, 1.45], [30, 1.7], [40, 1.85]],
      // Google 2024: 7,787 of 9,866 million gal withdrawn was consumed (79%);
      // the rest discharged. Equivalent to ~4.7 cycles of concentration
      // (DOE FEMP: many towers run 2-4 cycles, 6+ possible;
      // https://www.energy.gov/femp/articles/cooling-towers-understanding-key-components-cooling-towers-and-how-improve-water,
      // retrieved 2026-10).
      evaporatedShare: 0.79,
      blowdownShare: 0.21,
    },
    capexPerKWIT: {
      // judgment: towers are cheaper and smaller than dry coolers for the
      // same duty (Evapco: closed-circuit/dry units have "larger initial
      // cost" than open towers; https://www.achrnews.com/articles/163586-open-loop-cooling-towers-or-closed-circuit-coolers,
      // retrieved 2026-10), plus water treatment.
      low: 1000,
      default: 1300,
      high: 1900,
    },
    // judgment: chemical water treatment and tower maintenance on top of the
    // liquid loop.
    omPercentOfCapexPerYear: 3.5,
    // judgment: one ~7 x 7 m tower cell rejects ~3-5 MW; pumps and treatment.
    footprintM2PerMWIT: 25,
    assetLifeYears: 15, // judgment
    heatReuse: {
      supplyTempC: 45,
      note: 'Facility water at ~35-45 C before the towers; reusable for district heating instead of evaporating it.',
    },
    leadTimes: {
      // judgment: water supply and discharge (blowdown) permits.
      permittingMonths: { low: 1, typical: 3, high: 9 },
      procurementMonths: COOLING_EQUIPMENT_PROCUREMENT_MONTHS,
      constructionMonths: { low: 3, typical: 5, high: 8 }, // judgment
    },
    calibration: {
      temperate: { site: 'Chicago (11.3 C)', pue: 1.09, wueLPerKWhIT: 1.23 },
      hotDesert: { site: 'Phoenix (22.8 C)', pue: 1.09, wueLPerKWhIT: 1.51 },
    },
  },

  immersion: {
    id: 'immersion',
    label: 'Single-phase immersion + dry coolers',
    shortDescription: 'Servers sit in tanks of non-conductive oil that carries all their heat to a warm-water loop and dry coolers outside. No server fans and no evaporation.',
    typicalUse: 'Dense HPC, crypto and edge sites; 50-200 kW per tank',
    // GRC: a tank holds up to 200 kW with 32 C warm water (368 kW with 13 C
    // chilled water). https://datacenterdynamics.com/en/news/grc-updates-cooling-system-for-higher-capacity (retrieved 2026-10)
    maxRackDensityKW: 200,
    overheadFraction: 0.04, // judgment: hyperscale-class electrical; vendor PUE claims (1.03) exclude it
    cooling: {
      basis: 'dryBulb',
      // judgment: 40-50 C coolant lets dry coolers work up to ~28 C ambient.
      freeCoolingBelowC: 28,
      freeCoolingFraction: 0.025,
      // judgment, calibrated to 1.065 at 11 C and 1.07 at 23 C: GRC claims
      // PUE 1.03 (https://www.businesswire.com/news/home/20210518005857/en/GRC-Releases-the-Next-Generation-of-Data-Center-Liquid-Immersion-Cooling-Providing-Increased-Sustainability-Capable-of-Delivering-a-PUE-Yield-of-1.03-and-a-Significant-Reduction-in-Operating-Costs,
      // vendor, cooling only); LiquidStack "around 1.05 to 1.1" for single
      // phase (https://www.theregister.com/2023/04/14/liquidstack_immersion_cooling/),
      // both retrieved 2026-10.
      mechanicalFractionAt: [[28, 0.025], [33, 0.04], [38, 0.07], [46, 0.12]],
    },
    water: {
      basis: 'dryBulb',
      litresPerKWhITAt: [[-30, 0], [50, 0]], // closed loop to dry coolers
      evaporatedShare: 1,
      blowdownShare: 0,
    },
    capexPerKWIT: {
      // judgment: tanks + dielectric fluid + CDUs + dry coolers. Schneider
      // WP-282 found whole-facility capex equal to air at 10 kW/rack and lower
      // at 20-40 kW/rack (header); the plant itself costs more than DLC.
      low: 1200,
      default: 1700,
      high: 2500,
    },
    omPercentOfCapexPerYear: 2.5, // judgment: fluid top-up/filtration, pumps
    // judgment: dry-cooler yard as for DLC (tanks add white-space area,
    // which is in the facility footprint).
    footprintM2PerMWIT: 70,
    assetLifeYears: 15, // judgment
    heatReuse: {
      supplyTempC: 45,
      note: 'Coolant ~40-50 C; nearly all server heat is captured in liquid, the best case for heat reuse.',
    },
    leadTimes: {
      permittingMonths: { low: 0, typical: 0, high: 2 }, // judgment
      // judgment: smaller vendor base; tanks are simpler than chillers but
      // fluid and CDUs share the cooling supply chain.
      procurementMonths: { low: 6, typical: 12, high: 18 },
      constructionMonths: { low: 2, typical: 4, high: 6 }, // judgment
    },
    calibration: {
      temperate: { site: 'Chicago (11.3 C)', pue: 1.065, wueLPerKWhIT: 0 },
      hotDesert: { site: 'Phoenix (22.8 C)', pue: 1.07, wueLPerKWhIT: 0 },
    },
  },
};

// A plausible new AI datacenter in 2026: liquid-cooled GB300/Vera Rubin
// racks with a closed, zero-water loop (Microsoft's design since 2024-08;
// NVIDIA 45 C supply water; URLs in header).
export const DEFAULT_COOLING_TECHNOLOGY = 'dlc-dry-cooler';

// Piecewise-linear lookup used by the PUE and water curves: clamps outside
// the first/last point.
export function interpolateCurve(points, x) {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i += 1) {
    const [x1, y1] = points[i];
    if (x <= x1) {
      const [x0, y0] = points[i - 1];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return points[points.length - 1][1];
}
