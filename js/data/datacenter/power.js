/* ============================================
   Datacenter power supply data
   ============================================
   Grid supply (energy and demand charges, CO2 intensity, interconnection cost,
   flexible connections, export), on-site gas generation (engines, turbines,
   combined cycle, fuel cells, mobile bridge power), nuclear supply options
   (new large reactors, contracted existing plants, SMRs, microreactors), the
   power architectures, power-side project lead times and a few industry
   context facts for the datacenter simulator. Pure data.

   Solar costs reuse data/reference-data.js (SOLAR_COST_PRESETS); battery
   costs are split into energy and power components here (BATTERY_COSTS),
   its other parameters reuse the existing schema's defaults. Building, IT and cooling live in facility.js and cooling.js.

   Conventions: money in US$ (dollar year noted where the source states one),
   $/MWh, $/kW, $/kW-yr; heat rates in MMBtu/MWh (= thousand Btu/kWh) on a
   higher-heating-value (HHV) basis; CO2 in kg/MWh; water in litres per MWh
   generated (1 US gal = 3.785 L). OEM efficiencies are usually quoted on a
   lower-heating-value (LHV) basis; for natural gas HHV heat rate =
   3.412 / (LHV efficiency x 0.9027), i.e. LHV heat rate x 1.108.
   Every number carries a source (URL, retrieved 2026-10) or "judgment".
   "search index" marks figures read from a search-engine extract of the
   cited page when the page itself refused automated access. */

const KG_PER_LB = 0.45359237;
const LITRES_PER_GALLON = 3.785;

/* ---------- Grid ---------- */

/* eGRID2023 (EPA, data year 2023, released Jan 2025, rev2 Jun 2025): total
   output CO2 emission rates, lb/MWh, converted to kg/MWh. Combustion only
   (no upstream methane), at the generator, before grid losses (~4.2%).
   https://www.epa.gov/system/files/documents/2025-06/summary_tables_rev2.pdf
   https://www.epa.gov/egrid/summary-data (both retrieved 2026-10) */
export const EGRID_CO2_KG_PER_MWH = {
  US: { label: 'U.S. average', kgPerMWh: Math.round(767.2 * KG_PER_LB * 10) / 10 }, // 348.0
  ERCT: { label: 'ERCOT (Texas)', kgPerMWh: Math.round(733.9 * KG_PER_LB * 10) / 10 }, // 332.9
  SRVC: { label: 'SERC Virginia/Carolina', kgPerMWh: Math.round(593.4 * KG_PER_LB * 10) / 10 }, // 269.2
  SRMV: { label: 'SERC Mississippi Valley (Louisiana)', kgPerMWh: Math.round(739.7 * KG_PER_LB * 10) / 10 }, // 335.5
  RFCW: { label: 'RFC West (Ohio)', kgPerMWh: Math.round(911.4 * KG_PER_LB * 10) / 10 }, // 413.4
  AZNM: { label: 'WECC Southwest (Arizona/New Mexico)', kgPerMWh: Math.round(703.7 * KG_PER_LB * 10) / 10 }, // 319.2
  CAMX: { label: 'WECC California', kgPerMWh: Math.round(428.5 * KG_PER_LB * 10) / 10 }, // 194.4
  NWPP: { label: 'WECC Northwest', kgPerMWh: Math.round(631.7 * KG_PER_LB * 10) / 10 }, // 286.5
};

/* European grids: Ember yearly electricity data, 2025 generation carbon
   intensity, gCO2/kWh = kg/MWh, via Our World in Data's Ember-sourced series.
   Ember applies lifecycle emission factors, so these run higher than eGRID's
   combustion-only rates (Ember puts the US at 384 vs eGRID's 348).
   https://ourworldindata.org/grapher/carbon-intensity-electricity (retrieved 2026-10)
   https://ember-energy.org/latest-insights/european-electricity-review-2026 */
export const EU_GRID_CO2_KG_PER_MWH = {
  IE: { label: 'Ireland', kgPerMWh: 256.5 },
  NL: { label: 'Netherlands', kgPerMWh: 253.6 },
  DE: { label: 'Germany', kgPerMWh: 329.7 },
  SE: { label: 'Sweden', kgPerMWh: 35.3 },
  EU27: { label: 'EU-27', kgPerMWh: 209.9 },
};

/* EIA Electric Power Monthly Table 5.6.A (Aug 2026) and 5.6.B (year to date
   through Aug 2026), average industrial price, cents/kWh. These are revenue /
   sales, i.e. ALL-IN averages that already include demand and customer
   charges, not energy-only prices.
   https://www.eia.gov/electricity/monthly/epm_table_grapher.php?t=epmt_5_6_a
   https://www.eia.gov/electricity/monthly/epm_table_grapher.php?t=epmt_5_6_b (both retrieved 2026-10) */
export const EIA_INDUSTRIAL_PRICE_CENTS_PER_KWH = {
  US: { aug2026: 9.64, ytdAug2026: 9.09 },
  TX: { aug2026: 7.21, ytdAug2026: 6.77 },
  LA: { aug2026: 6.10, ytdAug2026: 6.58 },
  VA: { aug2026: 9.98, ytdAug2026: 10.07 },
  OH: { aug2026: 9.75, ytdAug2026: 10.23 },
  AZ: { aug2026: 9.73, ytdAug2026: 7.94 },
  GA: { aug2026: 13.05, ytdAug2026: 8.67 },
  OR: { aug2026: 8.75, ytdAug2026: 8.38 },
};

export const GRID_DEFAULTS = {
  // judgment: energy-only price to pair with the demand charge below. EIA's
  // US industrial average YTD Aug 2026 is 9.09 c/kWh = $90.9/MWh all-in
  // (Table 5.6.B above; EIA STEO Oct 2026 forecasts 9.05 c/kWh for 2026,
  // https://www.eia.gov/outlooks/steo/archives/oct26.pdf). A $12/kW-month
  // demand charge at a datacenter's ~100% load factor is ~$16/MWh, leaving
  // ~$75/MWh for energy. If you enter an EIA state all-in average as the
  // energy price instead, set the demand charge to 0 to avoid double counting.
  energyPricePerMWh: 75,
  energyPriceRangePerMWh: { low: 40, high: 150 }, // judgment: TX/LA industrial ~$60-70 all-in up to CA ~$240 (Table 5.6.A)

  // Demand charge, $/kW-month of billed peak, for transmission-voltage service:
  // - Dominion Virginia Schedule GS-4 (for usage on/after 2025-01-01, search
  //   index of the tariff PDF): on-peak supply demand $8.625/kW + transmission
  //   demand $2.310/kW (transmission voltage) + distribution demand
  //   $1.203-1.575/kW = ~$12.1-12.5/kW-month.
  //   https://www2.dominionenergy.com/-/media/pdfs/virginia/business-rates/schedule-gs4.pdf
  // - Entergy Louisiana Schedule LIPS-L (>=69 kV, effective 2024-08-30, closed
  //   to new business): $13.48/kW next 22,000 kW, $11.89/kW above.
  //   https://www.entergylouisiana.com/wp-content/uploads/ell_elec_lips-l.pdf
  // Both retrieved 2026-10. Range: judgment (ERCOT 4CP-based transmission
  // charges can be largely avoided by curtailing in the four summer peaks).
  demandChargePerKWMonth: 12,
  demandChargeRangePerKWMonth: { low: 5, high: 20 },

  co2KgPerMWh: EGRID_CO2_KG_PER_MWH.US.kgPerMWh,

  // Utility-side delivery for a new 230 kV data center substation (Dominion,
  // PJM TEAC 2026-02-03): Mudd Tavern 300 MW $26M (~$87/kW), Emy 212 MW $26M
  // (~$123/kW), Cosner 300 MW $28M (~$93/kW); each $6M line + $20M ring-bus
  // substation. Excludes network upgrades and the customer's own HV/MV
  // transformers (see ONSITE_SUBSTATION).
  // https://www.pjm.com/-/media/DotCom/committees-groups/committees/teac/2026/20260203/20260203-item-12---dom-supplemental-projects.pdf (retrieved 2026-10)
  // Default/range: judgment (adds a share of network upgrades; Texas SB 6
  // rules also propose a $50,000/MW non-refundable study fee, search index:
  // https://www.gtlaw.com/ar/insights/2026/3/texas-senate-bill-6-update-what-data-centers-large-load-customers-should-know-about-proposed-interconnection-standards).
  interconnectionCapexPerKW: 150,
  interconnectionCapexRangePerKW: { low: 50, high: 400 },
  // Plan area of the utility's switching station (the ring-bus substation
  // above) at the delivery point, per MW of connection. judgment: the same
  // density as the customer's own HV yard (ONSITE_SUBSTATION, ~1 acre per
  // 100 MW). The transmission line's right-of-way is not counted.
  switchyardFootprintM2PerMW: 40,

  // 'firm' = full firm service; 'flexible' = conditional-firm / curtailable
  // connection backed by on-site resources ("bring your own capacity").
  connection: 'firm',

  // Utility outages (forced interruptions) of any grid connection, firm or
  // flexible, hours per year. Firm service is not uninterruptible:
  // - Transmission-level delivery points (the service a large datacenter
  //   substation takes): Electricity Canada's Bulk Electricity System
  //   composite, forced outages, all events, not normalized, reported in
  //   BC Hydro's F2024 reliability filing, Table 5: T-SAIDI 1.93-3.63 h per
  //   delivery point per year over F2015-F2023 (mean 2.68 h; our
  //   arithmetic) and T-SAIFI-SI 0.74-1.06 sustained (>= 1 min)
  //   interruptions per year (mean 0.82), i.e. ~3.3 h per interruption.
  //   BC Hydro's own system: 0.92-6.00 h (F2024 6.00 h).
  //   https://www.bchydro.com/content/dam/BCHydro/customer-portal/documents/corporate/regulatory-planning-documents/regulatory-filings/rra/2024-05-14-bchydro-f05-f06-rra-directive-26-f2024.pdf (retrieved 2026-10)
  // - US distribution customers (EIA-861, Electric Power Annual Table 11.1,
  //   IEEE 1366): SAIDI 366.6 min (6.1 h) with major event days and 123.9
  //   min without in 2023; 662.6 min (11.0 h) and 131.6 min in 2024; SAIFI
  //   1.35 / 1.02 (2023) and 1.53 / 1.07 (2024). Most of these interruptions
  //   start on the distribution system, which a transmission-served load
  //   bypasses, so they bound the transmission figure from above.
  //   https://www.eia.gov/electricity/annual/html/epa_11_01.html (retrieved 2026-10)
  // Default 3 h/yr: the delivery-point T-SAIDI rounded to the dispatch's
  // whole hours (judgment; a dual-fed, looped 230-500 kV substation may see
  // less, a radial or storm-exposed one more). The Uptime Institute's Tier
  // Standard accordingly treats the utility as an economic alternative and
  // the engine-generator plant as the only reliable source (Accredited Tier
  // Designer paper on engine-generator ratings; not opened, search index):
  // https://atd.uptimeinstitute.com/resources/asset/accredited-tier-designer-technical-paper-series-engine-generator-ratings
  outageHoursPerYear: 3,
  outageHoursRange: { low: 2, high: 6 },

  // Camus / encoord / Princeton ZERO Lab, "Flexible Data Centers: A Faster,
  // More Affordable Path to Power" (Dec 2025, Google-funded), six PJM sites:
  // grid power available ">99% of all hours"; on-site resources dispatched
  // 40-70 hours per year (= 99.2-99.5% of 8,760 h; our arithmetic); 7-35
  // curtailed hours from transmission limits (events 4-16 h) plus ~32 h of
  // generation shortfalls in extreme weather. At the most constrained site
  // (Hare) the optimum was ~155 MW / 620 MWh of 4-h batteries + 48 MW of
  // on-site gas + compute flexibility for a 500 MW load.
  // https://cdn.prod.website-files.com/60dbdcca2e4b1919e8894fa5/6930abf1be0f36db6fc27157_Whitepaper%20-%20With%20Appendix.pdf (retrieved 2026-10)
  flexibleUnavailableHoursPerYear: 50,
  flexibleUnavailableHoursRange: { low: 40, high: 70 },

  // Same study: a flexible connection reaches full operation in "roughly two
  // years", 3-5 years faster than the traditional 3-7 year wait. Delay beyond
  // a ~2-year facility build, judgment: firm ~2 years, flexible ~0. The
  // schedule model (POWER_LEAD_TIMES) supersedes this simple field.
  connectionDelayYears: { firm: 2, flexible: 0 },

  // Export of surplus on-site power is off by default (behind-the-meter
  // loads usually have no export agreement; judgment).
  exportEnabled: false,
  // judgment: below the average wholesale price, because solar surplus
  // coincides with low-price hours. EIA STEO Oct 2026 Table 2: ERCOT North
  // hub $37.33/MWh (2025), $33.68 (2026F); PJM Western hub $60.09 (2025),
  // $84.95 (2026F); CAISO SP15 $25.34 (2026F).
  // https://www.eia.gov/outlooks/steo/archives/oct26.pdf (retrieved 2026-10)
  exportPricePerMWh: 30,
  wholesalePricePerMWh: { ercotNorth2025: 37.33, ercotNorth2026F: 33.68, pjmWest2025: 60.09, pjmWest2026F: 84.95 },
};

/* Customer-owned HV substation (high-voltage transformers, breakers,
   switchgear) between the utility delivery point or the on-site generators
   and the datacenter's medium-voltage system. */
export const ONSITE_SUBSTATION = {
  // judgment: comparable to the utility's own 230 kV ring-bus substation
  // cost per kW above (~$65-95/kW for $20M at 212-300 MW) plus
  // transformers; Wood Mackenzie reports power-transformer prices up ~77%
  // since 2019 (search index). Range judgment.
  capexPerKW: 100,
  capexRangePerKW: { low: 50, high: 200 },
  // judgment: ~1 acre (4,047 m2) per 100 MW of HV yard.
  footprintM2PerMW: 40,
};

/* ---------- Natural gas ---------- */

export const GAS_DEFAULTS = {
  // EIA Short-Term Energy Outlook, Oct 2026, Table 2: Henry Hub spot
  // $3.53/MMBtu (2025), $3.48 (2026), $3.16 (2027F); January 2026 averaged
  // $7.72 after winter storm Fern. Electric power sector delivered cost
  // ("power generation fuel cost, natural gas") $3.87 (2025), $3.94 (2026),
  // $3.34 (2027F).
  // https://www.eia.gov/outlooks/steo/archives/oct26.pdf
  // https://www.eia.gov/outlooks/steo/report/natgas.php (both retrieved 2026-10)
  henryHubPerMMBtu: 3.48,
  henryHub2027PerMMBtu: 3.16,
  // 2026 power-sector delivered $3.94 minus Henry Hub $3.48 = $0.46 (above);
  // rounded, judgment. Sites far from a major pipeline pay more.
  deliveredAdderPerMMBtu: 0.5,
  // Default delivered fuel price ~= EIA's 2026 power-sector delivered cost.
  // Lazard LCOE+ v19 uses $3.45/MMBtu for new gas plants (see context).
  fuelPricePerMMBtu: 4.0,
  fuelPriceRangePerMMBtu: { low: 2.5, high: 8.0 }, // judgment: Waha-linked West Texas gas up to a Fern-like winter month
  // EIA: natural gas 116.65 lb (52.91 kg) CO2 per MMBtu.
  // https://www.eia.gov/environment/emissions/co2_vol_mass.php (retrieved 2026-10)
  co2KgPerMMBtu: 52.91,
  // judgment: methane leakage upstream is not counted (combustion only, like eGRID).
  label: 'Natural gas',
  generationLabel: 'Gas generation',
};

/* ---------- Diesel (standby generators) ----------
   Fuel of the 'standby-diesel' genset type below. Prices are $/MMBtu HHV
   like natural gas so the same state field (gasFuelPricePerMMBtu, the
   "delivered fuel price") carries either; it follows the selected type's
   fuel. */
export const DIESEL_DEFAULTS = {
  label: 'Diesel',
  generationLabel: 'Diesel generation',
  // 40 CFR 98 Subpart C Table C-1, Distillate Fuel Oil No. 2: 0.138
  // mmBtu/gallon (HHV) and 73.96 kg CO2/mmBtu. EIA: diesel 137,381 Btu/gal;
  // distillate 163.45 lb (74.14 kg) CO2/MMBtu, 22.45 lb/gal.
  // https://www.ecfr.gov/current/title-40/chapter-I/subchapter-C/part-98/subpart-C/appendix-Table%20C-1%20to%20Subpart%20C%20of%20Part%2098
  // https://www.law.cornell.edu/cfr/text/40/appendix-Table_C-1_to_subpart_C_of_part_98
  // https://www.eia.gov/energyexplained/units-and-calculators/
  // https://www.eia.gov/environment/emissions/co2_vol_mass.php (all retrieved 2026-10)
  mmbtuPerGallon: 0.138,
  co2KgPerMMBtu: 73.96,
  // EIA STEO (Oct 6, 2026): US retail diesel $5.19/gal 2026 average ($6.29
  // in September; ~$4.50 in 2027). EIA weekly: $6.352/gal on 2026-10-26.
  // EIA FAQ: federal diesel tax 24.4 c/gal, state average 35.5 c/gal (Jan
  // 2026); dyed off-road diesel for a stationary generator is exempt from
  // the federal tax (IRS Pub 510; $0.001 LUST tax remains) and, in most
  // states, from the road tax (not verified state by state).
  // https://www.eia.gov/outlooks/steo/
  // https://www.eia.gov/petroleum/gasdiesel/
  // https://www.eia.gov/tools/faqs/faq.php?id=10&t=10
  // https://www.irs.gov/publications/p510 (all retrieved 2026-10)
  retailPricePerGallon2026: 5.19,
  roadTaxPerGallon: 0.244 + 0.355,
  // (5.19 - 0.599) / 0.138 = $33.3/MMBtu, rounded; retail still includes the
  // retail margin, so bulk deliveries can be lower (judgment).
  fuelPricePerMMBtu: 33,
  // judgment: low = 2027 STEO ~$4.50/gal untaxed less a bulk discount; high =
  // the Sep-Oct 2026 retail level untaxed ((6.35 - 0.60) / 0.138 = 41.7).
  fuelPriceRangePerMMBtu: { low: 25, high: 42 },
};

/* Fuels of the on-site generation types (GAS_GENSET_TYPES[type].fuel). */
export const GENSET_FUELS = { 'natural-gas': GAS_DEFAULTS, diesel: DIESEL_DEFAULTS };

/** The fuel defaults ({ label, fuelPricePerMMBtu, co2KgPerMMBtu, ... }) of a genset type entry. */
export function getGensetFuel(type) {
  return GENSET_FUELS[type?.fuel] || GAS_DEFAULTS;
}

/* Methane slip: unburned CH4 in the exhaust, kg per MMBtu of fuel (HHV).
   - Lean-burn gas engines: 40 CFR 98 Subpart W Table W-7 (2024), 4-stroke
     lean-burn 0.522 kg/MMBtu (EPA AP-42 3.2 Table 3.2-2: 1.25 lb/MMBtu =
     0.567). At ~7.8 MMBtu/MWh that is ~4 g CH4/kWh; a Cat G3520H site sheet
     gives ~2.7 g/kWh (THC - NMHC, not-to-exceed) and FuelEU Maritime assumes
     2.6% of fuel for lean-burn spark-ignition engines (~4 g/kWh).
   - Gas turbines (aero, industrial, CCGT, mobile): Table W-7 0.004 kg/MMBtu
     (AP-42 3.1 Table 3.1-2a: 8.6E-3 lb/MMBtu).
   - Diesel: 40 CFR 98 Table C-2, petroleum products 3.0E-3 kg/MMBtu.
   - Solid-oxide fuel cells: none (Bloom: "NO CH4 ... emissions",
     Connecticut Siting Council petition 1208; company claim).
   https://www.law.cornell.edu/cfr/text/40/appendix-Table_W-7_to_subpart_W_of_part_98
   https://www.epa.gov/sites/production/files/2020-10/documents/c03s02.pdf
   https://www.epa.gov/sites/default/files/2020-10/documents/c03s01.pdf
   https://www.law.cornell.edu/cfr/text/40/appendix-Table_C-2_to_subpart_C_of_part_98
   https://powergenenterprises.com/wp-content/uploads/2026/04/G3520H-Performance-Data-Sheet.pdf
   https://portal.ct.gov/lib/csc/pending_petitions/2_petitions_1201through1300/pe1208_responsetointerrogatories_manchester1.pdf
   (all retrieved 2026-10-30) */
export const METHANE_SLIP = {
  leanBurnEngineKgPerMMBtu: 0.522,
  turbineKgPerMMBtu: 0.004,
  dieselKgPerMMBtu: 0.003,
  fuelCellKgPerMMBtu: 0,
};

/* On-site generation types of the 'gas' firm family (the name predates the
   diesel entry: the family is fuel-burning or fuel-cell generation on
   site). Per type:
     fuel                  'natural-gas' (default) or 'diesel' (GENSET_FUELS:
                           price, CO2 per MMBtu)
     standbyOnly           emergency standby: never dispatched on cost against
                           the grid (dispatch.js), EPA run-hour limits apply
                           (emergencyEngine)
     unitSizeMW            { min, default, max } per unit
     heatRateMMBtuPerMWh   full-load HHV heat rate (default) and range
     partLoad              heat-rate penalty at 50% unit load (fraction) and
                           minimum stable load (% of unit rating)
     capexPerKW            installed $/kW (default, low, high), 2026 market
     fixedOmPerKWYear, variableOmPerMWh
     startMinutes          cold/standby start to full load
     rampPercentPerMinute  of unit rating
     availabilityPercent, forcedOutageRatePercent   per unit (N+1 sizing)
     water                 { consumptionLPerMWh, withdrawalLPerMWh }
     footprintM2PerMW, leadTimeKey (POWER_LEAD_TIMES), tradeOff
     ambientDerate         hot weather: { referenceC, outputPercentPerC,
                           heatRatePercentPerC }: above referenceC dry bulb,
                           a unit's output falls (and its heat rate rises) by
                           that % per °C (supply.js gasAmbientFactors; no
                           uplift below it, conservative). No inlet cooling.
     methaneSlipKgPerMMBtu unburned CH4 per MMBtu of fuel (HHV), reported as
                           CO2e (impacts.js; METHANE_SLIP sources below)

   2026 price context: EIA AEO2026 (2025$; Sargent & Lundy basis) is the
   cost floor; Lazard LCOE+ v19 (Jul 2026) captures 2026 quotes. Wood
   Mackenzie (2026-04-01): turbine prices "projected to rise to $600/kW by the
   end of 2027, a 195% increase since 2019"; EPRI: a small turbine takes
   18-36 months, a large one "about five years" to deliver.
   https://www.eia.gov/outlooks/aeo/assumptions/pdf/EMM_Assumptions.pdf
   https://www.lazard.com/media/kcfconhf/lazards-lcoeplus_vf.pdf
   https://www.utilitydive.com/news/gas-turbine-supply-crunch-set-to-raise-prices-195-by-2027-woodmac/816904/
   (all retrieved 2026-10) */
export const GAS_GENSET_TYPES = {
  recip: {
    label: 'Reciprocating gas engines',
    fuel: 'natural-gas',
    examples: 'Wärtsilä 34SG / 50SG, INNIO Jenbacher J920 FleXtra, Caterpillar G3520',
    // Wärtsilä 34SG 5.8-10.8 MW, 50SG 18.4-18.9 MW; Jenbacher J920 10.6 MW;
    // Cat G3520 2.5 MW (search index).
    // https://www.wartsila.com/energy/solutions/engine-power-plants/gas-power-plants
    // https://www.jenbacher.com/en/gas-engines/type-9 (retrieved 2026-10)
    unitSizeMW: { min: 2.5, default: 10, max: 19 },
    // 50SG 50.0% LHV -> 7.56; 34SG 48.9% -> 7.73; J920 48.7% -> 7.76; G3520
    // 45.3% -> 8.34 (LHV assumed). EIA AEO2020 4 x 5.6 MW engine plant: 8,295
    // Btu/kWh HHV. Default judgment for 10-19 MW engines.
    // https://www.eia.gov/analysis/studies/powerplants/capitalcost/pdf/capital_cost_AEO2020.pdf
    heatRateMMBtuPerMWh: { default: 7.8, low: 7.56, high: 8.34 },
    // judgment: one engine loses ~1-3 points of efficiency at 50% load; a
    // multi-engine plant follows load by stopping engines, so the plant stays
    // near full-load efficiency.
    partLoad: { heatRatePenaltyAt50Percent: 0.05, minStableLoadPercent: 30 },
    // EIA AEO2020 (2019$): $1,810/kW, fixed O&M $35.16/kW-yr, variable O&M
    // $5.69/MWh (same PDF; no engine case in AEO2025/2026). NYISO 2025-29
    // demand-curve reset screening (2023): Wärtsilä 18V50SG 18 MW $1,700/kW
    // (search index). Default judgment: AEO2020 x ~1.1-1.3 escalation.
    // https://www.nyiso.com/documents/20142/40204141/2%202025-2029%20DCR%20-%20BMcD%20Presentation%2009262023%20ICAPWG.pdf/c82642e7-0705-d1dd-7316-f2406b539c3e
    capexPerKW: { default: 2000, low: 1500, high: 2600 },
    fixedOmPerKWYear: 45, // judgment: AEO2020 $35.16 escalated ~1.3x
    variableOmPerMWh: 7.4, // judgment: AEO2020 $5.69 escalated ~1.3x
    // Wärtsilä "2 min to full load" (34SG); Jenbacher J920 "from the start in
    // 2 minutes" (pages above).
    startMinutes: 2,
    rampPercentPerMinute: 50, // derived: 0 -> 100% in ~2 minutes
    availabilityPercent: 97, // judgment (no NERC GADS figure verified)
    forcedOutageRatePercent: 3, // judgment
    water: { consumptionLPerMWh: 0, withdrawalLPerMWh: 0 }, // judgment: closed-loop radiator cooling
    footprintM2PerMW: 150, // judgment: engine hall + radiators + exhaust stacks
    // EPA CHP Catalog (2015) sec. 2.4.2: engines are rated at 77 °F (25 °C);
    // power and efficiency fall ~1% per 10 °F above it (~0.18%/°C). Wärtsilä:
    // engine output down "less than 2 per cent" at 45 °C (vendor).
    // https://www.epa.gov/sites/default/files/2015-07/documents/catalog_of_chp_technologies.pdf
    // https://www.wartsila.com/energy/learn-more/technology-comparison-engines-vs-aeros/derating-due-to-ambient-temperature
    ambientDerate: { referenceC: 25, outputPercentPerC: 0.18, heatRatePercentPerC: 0.18 },
    methaneSlipKgPerMMBtu: METHANE_SLIP.leanBurnEngineKgPerMMBtu,
    leadTimeKey: 'gas-recip',
    tradeOff: 'Highest simple-cycle efficiency at small unit size, 2-minute starts and flat part-load efficiency; modular N+1/N+2 is natural. More units to maintain and higher O&M per kW.',
  },
  aero: {
    label: 'Aeroderivative gas turbines',
    fuel: 'natural-gas',
    examples: 'GE Vernova LM2500XPRESS / LM6000, Siemens Energy SGT-A35, Mitsubishi FT8 MOBILEPAC',
    // LM2500XPRESS up to 34 MW; LM6000 PF+ Sprint 56.9 MW; SGT-A35
    // 31.8-38.1 MW; FT8 MOBILEPAC 30.9 MW (60 Hz).
    // https://www.gevernova.com/gas-power/products/gas-turbines/lm6000
    // https://www.gevernova.com/news/press-releases/ge-vernova-aeroderivative-solutions-expected-improve-reliability-puerto-ricos
    // https://www.siemens-energy.com/global/en/home/products-services/product/sgt-a30-a35-rb.html
    // https://power.mhi.com/products/aerogasturbines/lineup/ft8mp (retrieved 2026-10)
    unitSizeMW: { min: 30, default: 50, max: 57 },
    // EIA AEO2026 aeroderivative (4 x 54 MW, 211 MW): 9,447 Btu/kWh HHV.
    // LM6000 PF+ Sprint 41.0% LHV -> 9.23; LM2500XPRESS 39.5% -> 9.57;
    // SGT-A35 9.33-10.01; FT8 36.7% -> 10.32.
    heatRateMMBtuPerMWh: { default: 9.45, low: 9.23, high: 10.32 },
    // judgment: ~15-25% higher heat rate at 50% load.
    partLoad: { heatRatePenaltyAt50Percent: 0.2, minStableLoadPercent: 25 },
    // EIA AEO2026 (2025$): $2,275/kW, fixed O&M $9.99/kW-yr, variable O&M
    // $5.97/MWh. AEO2025 (2023$) had $1,606/kW. High: judgment for 2026
    // turbine scarcity.
    capexPerKW: { default: 2275, low: 1600, high: 2800 },
    fixedOmPerKWYear: 9.99,
    variableOmPerMWh: 5.97,
    // LM2500XPRESS "in 5 minutes or even less from cold iron"; LM6000 "start
    // up in 5 minutes"; FT8 MOBILEPAC 10 min cold start to full power.
    startMinutes: 5,
    // GE LM6000 page: ~50 MW/min for aeroderivatives -> ~100%/min on a 50 MW unit.
    rampPercentPerMinute: 100,
    availabilityPercent: 97, // judgment
    forcedOutageRatePercent: 3, // judgment
    water: { consumptionLPerMWh: 0, withdrawalLPerMWh: 0 }, // judgment: dry; Sprint/water-injected NOx control uses some
    footprintM2PerMW: 80, // judgment: packaged units on skids
    // GE LM6000 PC SPRINT without inlet cooling: 51.3 MW at 8.9 °C -> 38.5 MW
    // at 37.8 °C (~0.86%/°C), heat rate > +6% (~0.2%/°C) (POWER, 2013-06-01);
    // GT PRO aeroderivative ~26% below ISO at 45 °C (Wärtsilä, vendor).
    // https://www.powermag.com/improving-warm-weather-performance-of-the-lm6000/
    ambientDerate: { referenceC: 15, outputPercentPerC: 0.86, heatRatePercentPerC: 0.2 },
    methaneSlipKgPerMMBtu: METHANE_SLIP.turbineKgPerMMBtu,
    leadTimeKey: 'gas-aero',
    tradeOff: 'Fast 5-minute starts and steep ramps for AI load swings, compact and lighter; moderate efficiency and a tight 2026 supply chain.',
  },
  'industrial-sc': {
    label: 'Industrial / heavy-duty simple-cycle turbines',
    fuel: 'natural-gas',
    examples: 'Siemens Energy SGT-800, Solar Turbines Titan 130/250, GE Vernova 7HA in simple cycle',
    // SGT-800 45.3-62.5 MW; Titan 130 16.5 MW (search index); 7HA.03 SC 430 MW.
    // https://www.siemens-energy.com/global/en/home/products-services/product/sgt-800.html
    // https://www.gevernova.com/gas-power/products/gas-turbines/7ha (retrieved 2026-10)
    unitSizeMW: { min: 16.5, default: 60, max: 430 },
    // SGT-800 8,302-8,892 Btu/kWh LHV -> 9.20-9.85 HHV; 7HA.03 SC 7,884 LHV
    // -> 8.74; EIA AEO2026 industrial frame (419 MW) 9,142 HHV; Lazard v19 gas
    // peaking 10,275-11,175. Default judgment for a ~60 MW industrial unit.
    heatRateMMBtuPerMWh: { default: 9.5, low: 8.74, high: 11.18 },
    partLoad: { heatRatePenaltyAt50Percent: 0.25, minStableLoadPercent: 40 }, // judgment
    // EIA AEO2026 (2025$): $1,158/kW, fixed O&M $7.18, variable O&M $4.17.
    // Lazard v19 gas peaking: $1,100-1,650/kW, fixed O&M $10-17, variable O&M
    // $3.50-5.00. Default judgment between the two.
    capexPerKW: { default: 1400, low: 1100, high: 1650 },
    fixedOmPerKWYear: 12, // judgment: between AEO2026 $7.18 and Lazard $10-17
    variableOmPerMWh: 4.5, // judgment: AEO2026 $4.17, Lazard $3.50-5.00
    // GE 7HA: "10-21 minutes full gas turbine load". Industrial-unit start
    // times not published (judgment: similar).
    startMinutes: 15,
    // 7HA.03: 75 MW/min on 430 MW (~17%/min); 7HA.02: 60 MW/min on 384 MW.
    rampPercentPerMinute: 15,
    availabilityPercent: 95, // judgment
    forcedOutageRatePercent: 4, // judgment
    water: { consumptionLPerMWh: 0, withdrawalLPerMWh: 0 }, // judgment: dry simple cycle
    footprintM2PerMW: 60, // judgment
    // Siemens SGT-800 (57 MW rating) power vs intake temperature: ~56.8 MW
    // at 15 °C, 47.0 at 40 °C (~0.69%/°C); heat rate ~9.0 -> 9.46 MJ/kWh
    // (~0.2%/°C) (brochure chart, read +/-2%). EPA CHP Catalog: Solar Taurus 70
    // 80% of ISO output at 100 °F (~0.88%/°C).
    // https://assets.new.siemens.com/siemens/assets/api/uuid:daeb2935-2ea5-4400-a5dc-653de64ca7d3/gas-turbine-sgt-800.pdf
    ambientDerate: { referenceC: 15, outputPercentPerC: 0.7, heatRatePercentPerC: 0.2 },
    methaneSlipKgPerMMBtu: METHANE_SLIP.turbineKgPerMMBtu,
    leadTimeKey: 'gas-industrial-sc',
    tradeOff: 'Lowest $/kW of the gas options and fine for backup that runs few hours; frame units are large and lumpy and wait ~5 years for delivery.',
  },
  ccgt: {
    label: 'Combined cycle (F/H-class CCGT)',
    fuel: 'natural-gas',
    examples: 'GE Vernova 7HA.02/.03 1x1, Siemens Energy SGT6-9000HL, Mitsubishi M501JAC',
    // EIA AEO2026: single-shaft 627 MW, multi-shaft 1,227 MW.
    unitSizeMW: { min: 250, default: 627, max: 1227 },
    // EIA AEO2026: 6,226 Btu/kWh HHV; GE 7HA "63-64% net combined-cycle
    // efficiency" -> 5.91-6.00; Lazard v19: 6,475-6,550.
    heatRateMMBtuPerMWh: { default: 6.3, low: 5.91, high: 6.55 },
    partLoad: { heatRatePenaltyAt50Percent: 0.12, minStableLoadPercent: 40 }, // judgment
    // EIA AEO2026 (2025$): $1,086/kW (1x1), fixed O&M $16.23, variable O&M
    // $3.49. Lazard v19: $1,450-2,100/kW, fixed O&M $10-25.50, variable O&M
    // $2.75-5.00; its high case reflects "$2,400/kW - $2,600/kW based on market
    // quotes for CCGT projects in early stages of development with post-2028 COD".
    capexPerKW: { default: 2200, low: 1450, high: 2600 },
    fixedOmPerKWYear: 16.23,
    variableOmPerMWh: 3.49,
    // GE: "The 7HA combined cycle plant ramps up to full load in less than 30
    // minutes" (hot start). Cold starts take hours (judgment).
    startMinutes: 30,
    rampPercentPerMinute: 8, // judgment: steam cycle limits the plant ramp
    availabilityPercent: 92, // judgment
    forcedOutageRatePercent: 5, // judgment
    // Macknick et al. 2012 (Environ. Res. Lett. 7 045802), NGCC: wet tower
    // consumption 205 gal/MWh (median), withdrawal 255; dry cooling ~2.
    // https://openei.org/datasets/files/969/pub/1748-9326_7_4_045802.pdf (retrieved 2026-10)
    water: { consumptionLPerMWh: Math.round(205 * LITRES_PER_GALLON), withdrawalLPerMWh: Math.round(255 * LITRES_PER_GALLON) },
    waterDryCooled: { consumptionLPerMWh: Math.round(2 * LITRES_PER_GALLON), withdrawalLPerMWh: Math.round(2 * LITRES_PER_GALLON) },
    footprintM2PerMW: 100, // judgment: incl. HRSG, steam turbine and cooling tower
    // Plant output vs ambient: ~0.45%/°C (Arrieta & Lora 2005, 2 x 501F,
    // search index) to 0.96%/°C (Şen et al. 2018 regression in the CPUC
    // Energy Division proposal, R.21-10-002, 2023-01-20), which calibrated only
    // ~0.17%/°C against CAISO curtailments (inlet cooling). Default judgment
    // 0.5%/°C above ISO 15 °C; heat rate change not modeled (no source).
    // https://www.cpuc.ca.gov/-/media/cpuc-website/divisions/energy-division/documents/resource-adequacy-homepage/r21-10-002/4_ed-proposal-for-phase-3-derates.pdf
    ambientDerate: { referenceC: 15, outputPercentPerC: 0.5, heatRatePercentPerC: 0 },
    methaneSlipKgPerMMBtu: METHANE_SLIP.turbineKgPerMMBtu,
    leadTimeKey: 'gas-ccgt',
    tradeOff: 'Best fuel efficiency and lowest running cost; slow starts, 600+ MW blocks, water-hungry with wet cooling, and the longest turbine wait.',
  },
  sofc: {
    label: 'Solid-oxide fuel cells',
    fuel: 'natural-gas',
    examples: 'Bloom Energy Server 6.5',
    // Bloom datasheet (Feb 2026): 325 kW net AC per server.
    // https://www.bloomenergy.com/wp-content/uploads/bloom-energy-server-datasheet-feb-2026.pdf (retrieved 2026-10)
    unitSizeMW: { min: 0.325, default: 0.325, max: 0.325 },
    // Datasheet: "Cumulative electrical efficiency 65-53% (LHV net AC)" over
    // life -> 5.81-7.13 MMBtu/MWh HHV; midpoint 6.47. EIA AEO2026 fuel cells:
    // 6,469 Btu/kWh.
    heatRateMMBtuPerMWh: { default: 6.47, low: 5.81, high: 7.13 },
    partLoad: { heatRatePenaltyAt50Percent: 0, minStableLoadPercent: 30 }, // judgment
    // No published Bloom price. EIA AEO2026 generic fuel cell (10 MW, 2025$):
    // $8,287/kW, fixed O&M $37.77, variable O&M $0.72 - used as the high end.
    // Unverified secondary analyst estimates put Bloom near $2,500-3,000/kW.
    // Default: judgment.
    capexPerKW: { default: 4000, low: 2500, high: 8287 },
    fixedOmPerKWYear: 37.77,
    variableOmPerMWh: 0.72,
    // judgment: kept hot; not a cycling resource (cold start takes many hours).
    startMinutes: 600,
    rampPercentPerMinute: 1, // judgment: slow; pair with batteries for AI load swings
    availabilityPercent: 99, // judgment: many small modules
    forcedOutageRatePercent: 1, // judgment
    // Datasheet: water "None during normal operation".
    water: { consumptionLPerMWh: 0, withdrawalLPerMWh: 0 },
    // Datasheet: ~9 m x 1.3 m per 325 kW server = ~36 m2/MW of equipment;
    // x ~1.7 for access aisles (judgment).
    footprintM2PerMW: 60,
    // Bloom Energy Server 6.5: operating range -20 to 45 °C, no derate
    // stated (datasheet, Feb 2026).
    // https://www.bloomenergy.com/wp-content/uploads/bloom-energy-server-datasheet-feb-2026.pdf
    ambientDerate: { referenceC: 45, outputPercentPerC: 0, heatRatePercentPerC: 0 },
    methaneSlipKgPerMMBtu: METHANE_SLIP.fuelCellKgPerMMBtu,
    leadTimeKey: 'gas-sofc',
    tradeOff: 'Efficient, no water, near-zero NOx, small modules that permit fast; price is high and unpublished, and output ramps slowly, so it needs a battery for AI load swings.',
  },
  bridge: {
    label: 'Mobile / trailer-mounted bridge turbines',
    fuel: 'natural-gas',
    examples: 'Solar Turbines SMT-130, Mitsubishi FT8 MOBILEPAC (e.g. xAI Colossus, Memphis)',
    // Shelby County permit (2025-07-02): 15 Solar SMT-130 units "up to 247
    // megawatts" (~16.5 MW each); FT8 MOBILEPAC 31 MW.
    // https://techcrunch.com/2025/07/03/xai-gets-permits-for-15-natural-gas-generators-at-memphis-data-center/ (retrieved 2026-10)
    unitSizeMW: { min: 16.5, default: 16.5, max: 31 },
    // Titan 130 9,630 Btu/kWh (search index, LHV assumed) -> 10.67; FT8 10.32.
    heatRateMMBtuPerMWh: { default: 10.5, low: 10.32, high: 10.67 },
    partLoad: { heatRatePenaltyAt50Percent: 0.25, minStableLoadPercent: 30 }, // judgment
    // judgment: no published purchase or rental price; set to the AEO2026
    // aeroderivative cost. Usually rented or leased as a bridge until the grid
    // or permanent plant arrives.
    capexPerKW: { default: 2275, low: 1600, high: 2800 },
    fixedOmPerKWYear: 10, // judgment: ~AEO2026 aeroderivative
    variableOmPerMWh: 8, // judgment: above aeroderivative (mobilization, smaller units)
    startMinutes: 10, // FT8 MOBILEPAC cold start (page above)
    rampPercentPerMinute: 50, // judgment
    availabilityPercent: 95, // judgment
    forcedOutageRatePercent: 5, // judgment
    water: { consumptionLPerMWh: 0, withdrawalLPerMWh: 0 }, // judgment
    footprintM2PerMW: 80, // judgment
    // Solar Titan 130 (the SMT-130 core) available power: ~14.9 MW at 15 °C,
    // 13.4 at 30 °C, 11.2 at 45 °C (~0.8%/°C); heat rate ~10.2 -> 10.75 MJ/kWh
    // at 30 °C (~0.36%/°C) (datasheet chart, read +/-2%).
    // https://www.globalpwr.com/wp-content/uploads/cut-sheets/gps-titan130-spec-sheet.pdf
    ambientDerate: { referenceC: 15, outputPercentPerC: 0.8, heatRatePercentPerC: 0.36 },
    methaneSlipKgPerMMBtu: METHANE_SLIP.turbineKgPerMMBtu,
    leadTimeKey: 'gas-bridge',
    tradeOff: 'Fastest path to on-site power (months) and easy to remove later; least efficient, highest emissions per MWh, and contested air permits.',
  },
  'standby-diesel': {
    label: 'Standby diesel generators',
    fuel: 'diesel',
    standbyOnly: true,
    examples: 'Caterpillar 3516C / 3516E, Cummins QSK95 (C3000 / C3500), MTU 20V4000 (DS3000)',
    // Datacenter standby units are 2.5-3.25 MW: Cat 3516C 2,500 ekW standby
    // (60 Hz datasheet LEHE1377-04); Cat 3516E 3,000 ekW standby (cat.com);
    // MTU 20V4000 DS3000 3,000 kWe standby (60 Hz); Cummins QSK95 C3500D5e
    // 2,800 kWe standby (50 Hz, AWS Frankfurt permit appendix), C3000D6e listed
    // at 3,250 kW standby (60 Hz). Default judgment: the 3 MW class of 2025-26 builds.
    // https://www.hanovercounty.gov/DocumentCenter/View/5983/CAT-3516C-2500KW-Cut
    // https://www.cat.com/en_US/products/new/power-systems/electric-power/diesel-generator-sets/1000033111.html
    // https://www.globalpwr.com/wp-content/uploads/cut-sheets/gps-mtu-3000-kw-spec-sheet.pdf
    // https://consult.environment-agency.gov.uk/psc/sl0-9ee-amazon-data-services-uk-limited/supporting_documents/application-bespoke-appendix-a-typical-generator-specifications-sheet-aws-c3500d5e-qsk95-g5-nominal-emissions-epr-mp3824mg-a001-020326pdf
    // (all retrieved 2026-10)
    unitSizeMW: { min: 2.5, default: 3, max: 3.25 },
    // Fuel at 100% standby load x 0.138 MMBtu/gal (DIESEL_DEFAULTS, HHV):
    // Cat 3516C 175.3 gal/h / 2.5 MW = 9.68; MTU DS3000 207 gal/h / 3.0 MW =
    // 9.52; QSK95 C3500D5e 725 L/h (191.5 gal) / 2.8 MW = 9.44 MMBtu/MWh (sheets above).
    heatRateMMBtuPerMWh: { default: 9.55, low: 9.44, high: 9.68 },
    // judgment: ~10% higher heat rate at 50% load; below ~30% load diesel
    // engines wet-stack, so the plant commits fewer units instead.
    partLoad: { heatRatePenaltyAt50Percent: 0.1, minStableLoadPercent: 30 },
    // Installed (genset, enclosure, belly tank, switchgear share, install):
    // NREL ~$1,000/kW (June 2025, via Latitude Media, 2026-03-09); Better Data
    // Center Project (Mar 2026): gensets "commonly estimated at $350-$500/kW",
    // enclosures, noise attenuation and fuel tanks "over $200/kW" more, NREL
    // (2014) $800-1,100/kW all-in. High: judgment for 2026 shortage pricing
    // and paralleling switchgear.
    // https://www.latitudemedia.com/news/the-data-center-boom-is-a-diesel-generator-boom/
    // https://betterdatacenterproject.com/wp-content/uploads/2026/03/Diesel-Generators-at-Data-Centers-Status-Impacts-and-Protective-Practices.pdf
    capexPerKW: { default: 1000, low: 550, high: 1300 },
    // PNNL O&M best practices: $8,000-10,500/yr for a 300 kW standby unit
    // under 200 h/yr (~$27-35/kW-yr), monthly tests and an annual load-bank
    // test. Default judgment for 2.5-3 MW fleets (scale), incl. fuel polishing.
    // https://www.pnnl.gov/projects/om-best-practices/standby-generators
    fixedOmPerKWYear: 15,
    variableOmPerMWh: 10, // judgment: few run hours; wear parts and oil per MWh
    // NFPA 110 Type 10: power restored within 10 s; the Cat 3516C and MTU
    // DS3000 sheets: accepts 100% (rated) load in one step per NFPA 110.
    // https://www.csemag.com/role-of-nfpa-110-and-interaction-with-other-codes/
    startMinutes: 10 / 60,
    rampPercentPerMinute: 100, // one-step block load (sheets above); capped at 100%/min here
    availabilityPercent: 99, // judgment: a few days of planned maintenance a year
    forcedOutageRatePercent: 2, // judgment (fail-to-start/run on demand)
    water: { consumptionLPerMWh: 0, withdrawalLPerMWh: 0 }, // radiator-cooled
    footprintM2PerMW: 40, // judgment: 40-ft enclosures with belly tanks in a generator yard, with access
    // Cat 3516C cooling packages for ambients up to 50 °C; MTU DS3000 radiator
    // rated 45 °C ("consult ... for temperature derations"). Above 45 °C:
    // Cummins QSK95 ~12.1% per 10 °C (search index only).
    ambientDerate: { referenceC: 45, outputPercentPerC: 1.2, heatRatePercentPerC: 0 },
    methaneSlipKgPerMMBtu: METHANE_SLIP.dieselKgPerMMBtu,
    leadTimeKey: 'diesel-standby',
    // EPA emergency stationary engines (40 CFR 60.4211(f), Subpart IIII;
    // 63.6640(f), Subpart ZZZZ): emergency operation is unlimited; maintenance
    // checks, readiness testing and non-emergency operation are limited to
    // 100 h per calendar year, of which at most 50 h non-emergency (no peak
    // shaving, no non-emergency demand response, no supply to the grid under
    // a financial arrangement). Emergency engines over 2,237 kW need Tier 2
    // (60.4202(b)(2)); non-emergency engines Tier 4 (60.4204(b), 60.4201(c)).
    // Testing hours: judgment, ~1 h monthly plus an annual load-bank test
    // (PNNL above).
    // https://www.ecfr.gov/current/title-40/section-60.4211
    // https://www.ecfr.gov/current/title-40/section-63.6640
    // https://www.law.cornell.edu/cfr/text/40/60.4211
    // https://www.law.cornell.edu/cfr/text/40/63.6640
    // https://www.law.cornell.edu/cfr/text/40/60.4202
    // https://www.law.cornell.edu/cfr/text/40/60.4201 (all retrieved 2026-10)
    emergencyEngine: { maxHoursPerYear: 100, maxNonEmergencyHoursPerYear: 50, testingHoursPerYear: 20 },
    // On-site fuel: Uptime Institute requires at least 12 h for every Tier;
    // operators store 24-96 h (e.g. QTS belly tanks: 48 h at 100% load).
    // Not costed separately (in the installed $/kW).
    // https://journal.uptimeinstitute.com/fuel-system-design-reliability/
    fuelStorageHours: { minimum: 12, typical: 48 },
    emissionsNote: 'EPA Tier 2 (emergency); Tier 4 Final with SCR for any non-emergency use.',
    tradeOff: 'The standard datacenter standby: cheapest firm kW and 10-second starts. Diesel costs ~8x natural gas per MMBtu and emits 40% more CO2 per MMBtu, and EPA limits emergency engines to 100 h/yr of testing and non-emergency use, so it is backup for utility outages, not prime power.',
  },
};

// Default for a grid-connected site's standby (the default design); the
// islanded starting design uses reciprocating gas engines as prime power.
export const DEFAULT_GAS_GENSET_TYPE = 'standby-diesel';

/* Redundancy guidance for sizing gas units (units x unit size). */
export const GAS_REDUNDANCY_GUIDANCE = {
  // IEA "Key Questions on Energy and AI" (2026-04-16), executive summary:
  // reliable onsite gas "requires overbuilding onsite generation
  // infrastructure by 30% to 70% relative to demand".
  // https://www.iea.org/reports/key-questions-on-energy-and-ai/executive-summary (retrieved 2026-10)
  ieaOverbuildPercent: { low: 30, high: 70 },
  // Camus et al. (Dec 2025): 168 MW of accredited on-site gas needs 202 MW
  // nameplate at PJM's 83% ELCC (~1.2x). Whitepaper URL in GRID_DEFAULTS.
  pjmGasElccPercent: 83,
  // judgment: islanded = N+2 (one unit in maintenance and one forced outage);
  // grid backup = N+1. Williams' Socrates plants for Meta (Ohio, off-grid)
  // mix Titan 250, PGM 130, SGT-400 and Cat 3520 units plus a mobile SMT-130
  // for outages and diesel black-start sets.
  // https://www.power-eng.com/onsite-power/onsite-gas-turbines-reciprocating-engines-to-power-meta-data-center/ (retrieved 2026-10)
  islanded: { spareUnits: 2, defaultGensetType: 'recip' },
  backup: { spareUnits: 1, defaultGensetType: 'standby-diesel' },
  // judgment: prime power running in parallel with the grid (hybrid). The
  // grid is a second source, so N+1 as for backup; engines as islanded.
  gridParallel: { spareUnits: 1, defaultGensetType: 'recip' },
};

// Gas-family types that may only stand by (standbyOnly): the only
// generators a grid-connected design may have (ARCHITECTURES.grid).
export const STANDBY_GAS_GENSET_TYPES = Object.freeze(Object.keys(GAS_GENSET_TYPES).filter(key => GAS_GENSET_TYPES[key].standbyOnly));

/* ---------- Battery storage cost (energy + power components) ----------
   capex = MWh x energy $/kWh + MW x power $/kW (MW = MWh / duration), so a
   shorter battery of the same MWh costs more: its inverters, transformers
   and switchgear are sized for more MW. The energy part is cells, racks,
   containers and energy-related BOS; the power part PCS/inverters, MV
   transformers, switchgear and the BESS's own grid tie.

   - NREL, Cost Projections for Utility-Scale Battery Storage: 2025 Update
     (NREL/TP-6A40-93281, June 2025; 2024$, US, overnight incl. EPC,
     contingency, interconnection): "Total Cost ($/kW) = Energy Cost ($/kWh)
     * Duration (hr) + Power Cost ($/kW)"; 2024: "the energy cost is
     $241/kWh, and the power cost is $372/kW" (4 h: $334/kWh); Table 2 mid
     case 4 h: $321/kWh (2025), $308/kWh (2026); low case 2026 $255.
     https://docs.nlr.gov/docs/fy25osti/93281.pdf
     https://atb.nlr.gov/electricity/2024/utility-scale_battery_storage
   - PNNL Energy Storage Cost and Performance Database v2024 (LFP, 100 MW,
     2023, US installed): 4 h $372.72/kWh; 2 h $423, 8 h $352.91, 10 h
     $349.07/kWh; a linear fit of the 2 h and 10 h totals gives ~$331/kWh +
     ~$185/kW (EPC and development booked per kWh).
     https://www.pnnl.gov/sites/default/files/media/file/ESGC_Cost_Performance_Database_v2024.xlsx
   - Lazard LCOE+ (Jul 2026), utility-scale standalone 100 MW, US, total
     capital cost: 2 h $270-580/kWh, 4 h $270-365/kWh (tariffs and FEOC rules
     on Chinese cells raised US prices).
     https://lazard.com/media/sdvdrvc5/lazards-lcoeplus_vf.pdf
   - Global basis (outside the US and China): Ember (2025-12-11) ~$125/kWh
     all-in for >= 4 h ("$75/kWh for the core equipment shipped from China
     and around $50/kWh for installation and grid connection"); BNEF ESS cost
     survey 2025: $117/kWh average turnkey (equipment, global), US ~$219/kWh
     (search summary, not opened).
     https://ember-energy.org/latest-insights/how-cheap-is-battery-storage/
     https://about.bnef.com/insights/clean-energy/battery-storage-costs-hit-record-lows
     https://www.energy-storage.news/behind-the-numbers-bnef-finds-40-year-on-year-drop-in-bess-costs/
     (all retrieved 2026-10)
   Default: the US 2026 basis, because the default site is in Texas and the
   US sources all sit well above the former $150/kWh (a global-market
   figure): NREL's 2024 split scaled to its 2026 mid case (x 308 / 334),
   energy $222/kWh + power $343/kW = $308/kWh at 4 h, inside Lazard's
   $270-365. A behind-the-meter battery shares the site substation, so the
   power part is slightly conservative (judgment). Effective $/kWh = energy +
   power / duration: 1 h $565, 2 h $394, 4 h $308, 8 h $265. */
export const BATTERY_COSTS = {
  energyPerKWh: 222,
  powerPerKW: 343,
  nrel2024: { energyPerKWh: 241, powerPerKW: 372, fourHourPerKWh: 334 },
  nrel2026MidFourHourPerKWh: 308,
  lazard2026FourHourPerKWh: { low: 270, high: 365 },
  pnnl2023FourHourPerKWh: 372.72,
  // Global (ex-US/China) basis: Ember's ~$125/kWh at 4 h with a ~20% power
  // share (judgment between PNNL's 12% and NREL's 28%): 120 + 120 / 4 = $150/kWh.
  globalBasis: { energyPerKWh: 120, powerPerKW: 120 },
};

/* ---------- Battery as reserve (state batteryReplacesSpares, batteryReserveHours) ----------
   A battery can stand in for spare generator units (N+x): it picks up a
   tripped unit's load within the inverter response time and holds it while
   the unit is restarted or replaced. Default reserve: 4 hours per replaced
   unit (judgment from the reserve products below):
   - ERCOT Non-Spinning Reserve must be sustained for four consecutive hours
     (NPRR 1096, PUCT 2022-05-01); ECRS two hours.
     https://www.bakerbotts.com/thought-leadership/publications/2023/april/2022-energy-memo_energy-storage-issues-in-the-ercot-market
   - CPUC resource adequacy counts storage at its four-hour output (2022 RA
     Guide, D.21-06-029).
     https://www.cpuc.ca.gov/-/media/cpuc-website/divisions/energy-division/documents/resource-adequacy-homepage/resource-adequacy-compliance-materials/final-2022-ra-guide-clean-101821.pdf
   - NERC BAL-002-2: contingency reserve restored within 90 minutes after
     the 15-minute recovery period (a shorter bound).
     https://nerc.com/pa/Stand/Project%202010141%20%20Phase%201%20of%20Balancing%20Authority%20Re/Project_2010-14_1%20BAL-002-2_Implementation_Plan-Clean-07012015.pdf
   AI sites already pair batteries with on-site generation: xAI's Colossus
   (Memphis) put Tesla Megapacks between the turbines and the GPUs to buffer
   "millisecond spikes and drops in power" of training load (ServeTheHome,
   2024-10-28) and as backup during grid disruptions (Introl, 2026-04-01).
   The model's hourly dispatch does not see those transients.
   https://www.servethehome.com/inside-100000-nvidia-gpu-xai-colossus-cluster-supermicro-helped-build-for-elon-musk/4/
   https://introl.com/blog/xai-memphis-colossus-100000-gpu-supercomputer-infrastructure
   (all retrieved 2026-10-30) */
export const BATTERY_RESERVE = {
  defaultHoursPerUnit: 4,
};

/* ---------- Nuclear ---------- */

/* Nuclear supply options. New-build types carry overnight capex; the
   contracted-existing option is a PPA price with no capex. Per type:
     unitSizeMWe, capacityFactor, capexPerKW { foak, noak, default },
     fixedOmPerKWYear, variableOmPerMWh, fuelPerMWh, earliestCodYear (for a
     project ordered now), constructionYears, water (cooling tower), status
     (Oct 2026), loadFollowing, tradeOff, leadTimeKey.
   Shared sources (retrieved 2026-10):
   - EIA AEO2026 EMM Table 3 (2025$): LWR $8,255/kW total overnight (2,156 MW,
     6-yr lead time, first available 2031), fixed O&M $163.40/kW-yr, variable
     O&M $2.62/MWh; SMR $9,831/kW (480 MW), $127.62/kW-yr, $3.32/MWh.
     https://www.eia.gov/outlooks/aeo/assumptions/pdf/EMM_Assumptions.pdf
   - EIA Table 6.07.B: US nuclear capacity factor 93.0% (2023), 90.8% (2024),
     91.1% (2025). https://www.eia.gov/electricity/monthly/epm_table_grapher.php?t=epmt_6_07_b
   - EIA: reactors refuel every 18-24 months, outages ~35-38 days (search index).
     https://www.eia.gov/todayinenergy/detail.php?id=60942
   - NEI "Nuclear Costs in Context" (Aug 2026), 2025 fleet, 2025$/MWh: fuel
     5.95, capital 9.69, operating 20.82, total 36.46.
     https://www.nei.org/getContentAsset/47fa8caa-9b0d-4029-932c-07f902e82f4f/8d8ff8d6-b2ae-401b-a63c-f6b108e809d2/2024-Costs-in-Context-final.pdf
   - Lazard LCOE+ v19 (Jul 2026), US nuclear: $12,300-17,570/kW, fixed O&M
     $136-158/kW-yr, variable $4.40-5.15/MWh, 84-month build, LCOE $175-255/MWh.
   - INL meta-analysis (Abou-Jaoude et al. 2024): next-commercial overnight
     cost $5,250-7,750/kWe large, $5,500-10,000/kWe SMR.
     https://gain.inl.gov/content/uploads/4/2024/12/INL-MIS-24-82002-Using-the-Cost-Reports-and-Papers.pdf
   - Macknick et al. 2012, nuclear with cooling tower: consumption 672
     gal/MWh, withdrawal 1,101 gal/MWh (medians); once-through withdraws
     ~44,350. https://openei.org/datasets/files/969/pub/1748-9326_7_4_045802.pdf
   - NRC 2023 rule (10 CFR 50.160): scalable, performance-based emergency
     planning zones for SMRs and non-LWRs, possibly at the site boundary
     (search index). Large LWRs keep the standard ~10-mile plume EPZ
     (judgment). https://www.federalregister.gov/documents/2023/11/16/2023-25163/emergency-preparedness-for-small-modular-reactors-and-other-new-technologies
   - HALEU: DOE option price to Centrus $17M per MTU (~$17,000/kgU; search
     index). https://www.sec.gov/Archives/edgar/data/1065059/000106505924000089/leu-20240930.htm
   Decommissioning: judgment, a reserve of ~$500-700M per large unit (NRC
   10 CFR 50.75 minimum formula; not verified) - folded into fixed O&M here. */
const NUCLEAR_TOWER_WATER = {
  consumptionLPerMWh: Math.round(672 * LITRES_PER_GALLON),
  withdrawalLPerMWh: Math.round(1101 * LITRES_PER_GALLON),
};

export const NUCLEAR_TYPES = {
  'large-lwr': {
    label: 'Large reactor, new build (AP1000)',
    examples: 'Westinghouse AP1000 (Vogtle 3 & 4)',
    unitSizeMWe: { min: 1114, default: 1117, max: 1117 }, // Lazard v19 1,117; EIA lists Vogtle 4 at 1,114
    capacityFactor: 0.92, // EIA fleet 90.8-93.0% (2023-2025)
    // MIT CANES (2024), "Total Cost Projection of the Next AP1000" (2024$):
    // Vogtle realized ~$11,000/kW overnight; next two units at Vogtle
    // $8,300-10,375/kW; greenfield $9,300-11,625/kW; NOAK $4,625/kW.
    // https://web.mit.edu/kshirvan/www/research/ANP201%20TR%20CANES.pdf
    // AEO2026 $8,255/kW; Lazard v19 $12,300-17,570/kW. Default: judgment
    // within MIT's greenfield range.
    capexPerKW: { foak: 11000, noak: 4625, default: 10000 },
    fixedOmPerKWYear: 163.4, // AEO2026
    variableOmPerMWh: 2.62, // AEO2026
    fuelPerMWh: 5.95, // NEI 2025 fleet average
    // judgment: ~2-3 yr combined licence + 7-8 yr build for an order placed
    // now. MIT: next units 80-96 months; Lazard 84 months; Vogtle 3 COD Jul
    // 2023, Vogtle 4 COD Apr 2024 (EIA).
    // https://www.eia.gov/todayinenergy/detail.php?id=61963
    earliestCodYear: 2035,
    constructionYears: 7,
    water: NUCLEAR_TOWER_WATER,
    loadFollowing: 'Designed for daily load-follow; US units run baseload (judgment).',
    status: 'Design certified; no new US combined licence pending. Westinghouse-US government framework (Oct 2025) for at least $80B of reactors; Santee Cooper/Brookfield studying completion of V.C. Summer 2 & 3 (search index).',
    // https://www.enr.com/articles/61771-feds-reach-deal-with-westinghouse-for-80b-in-nuclear-reactor-deployments
    // https://www.ans.org/news/2026-05-05/article-8003/joint-venture-formed-with-a-focus-on-finishing-summer2-and-3/
    leadTimeKey: 'nuclear-large-lwr',
    tradeOff: 'Lowest cost per MWh at scale and a 60-80 year life, but $10B+ per unit, 7+ year builds and a history of overruns.',
  },
  'contracted-existing': {
    label: 'Existing plant: restart / uprate / PPA',
    examples: 'Crane (TMI-1) - Microsoft; Susquehanna - Amazon; Clinton - Meta; Palisades restart; Duane Arnold - Google',
    unitSizeMWe: { min: 800, default: 1000, max: 2000 }, // Crane 835, Clinton 1,121, Susquehanna PPA 1,920
    capacityFactor: 0.92,
    // No capex to the buyer. No PPA price has been published. Lazard v19
    // shows a restart LCOE of ~$71/MWh (read from a chart label, moderate
    // confidence); the fleet's all-in cost is $36.46/MWh (NEI). Default and
    // range: judgment for a scarce, premium 20-year carbon-free contract.
    capexPerKW: { foak: 0, noak: 0, default: 0 },
    ppaPricePerMWh: { default: 90, low: 70, high: 120 },
    fixedOmPerKWYear: 0,
    variableOmPerMWh: 0,
    fuelPerMWh: 0,
    // Clinton-Meta deliveries from Jun 2027; Crane in service 2027-2028;
    // Duane Arnold restart Q1 2029 (search index).
    // https://neutronbytes.com/2025/06/06/meta-signs-20-year-power-deal-with-constellation/
    // https://www.powermag.com/constellation-races-to-revive-crane-nuclear-plant-amid-tight-timelines-market-shifts
    // https://www.ans.org/news/2025-10-28/article-7501/nextera-and-google-ink-a-deal-to-restart-duane-arnold/
    earliestCodYear: 2027,
    constructionYears: 0,
    water: { consumptionLPerMWh: 0, withdrawalLPerMWh: 0 }, // off-site: not charged to the datacenter
    loadFollowing: 'Baseload, delivered through the grid (front-of-meter) or co-located.',
    status: 'Talen-Amazon restructured from 960 MW co-location to a 1,920 MW front-of-meter PPA through 2042 (Jun 2025); Palisades restart slipped, no date as of Jul 2026 (search index). Only a handful of restart candidates exist.',
    // https://www.datacenterdynamics.com/en/news/aws-talen-sign-ppa-for-192gw-of-power-from-pennsylvania-nuclear-plant/
    // https://www.ans.org/news/2026-07-08/article-8187/palisades-restart-projects-holtec-ipo-lawsuit-dismissal-but-no-restart-date/
    leadTimeKey: 'nuclear-contracted-existing',
    tradeOff: 'Fastest firm carbon-free power with no construction risk; a small, mostly contracted pool, premium prices, and co-location draws FERC/PJM scrutiny.',
  },
  'bwrx-300': {
    label: 'SMR: GE Vernova Hitachi BWRX-300',
    examples: 'OPG Darlington (Ontario), TVA Clinch River (Tennessee)',
    unitSizeMWe: { min: 300, default: 300, max: 300 },
    capacityFactor: 0.92, // judgment: fleet-like LWR
    // OPG Darlington (FID 2025-05-08): C$20.9B for 4 units all-in (interest,
    // escalation, contingency); unit 1 C$6.1B + C$1.6B common = C$7.7B
    // (~C$25,700/kW), fleet ~C$17,400/kW nominal.
    // https://wnn.world-nuclear.org/articles/what-is-the-budget-for-canadas-first-smr-project
    // Overnight default: judgment between AEO2026 SMR $9,831/kW and OPG's
    // all-in first unit; NOAK: INL SMR range top.
    capexPerKW: { foak: 15000, noak: 10000, default: 12000 },
    fixedOmPerKWYear: 127.62, // AEO2026 SMR
    variableOmPerMWh: 3.32, // AEO2026 SMR
    fuelPerMWh: 6.5, // judgment: standard LEU, ~fleet fuel cost
    earliestCodYear: 2033, // judgment; TVA Clinch River target 2033 (search index)
    constructionYears: 5, // judgment: OPG FID May 2025 -> unit 1 in service 2030
    water: NUCLEAR_TOWER_WATER,
    loadFollowing: 'Natural-circulation BWR intended for manoeuvring (judgment, not verified).',
    status: 'NRC construction permit for TVA Clinch River issued 2026-09-29; OPG Darlington unit 1 under construction, in service 2030 targeted.',
    // https://www.gevernova.com/news/press-releases/nrc-issues-first-us-construction-permit-bwrx-300-small-modular-reactor-tva-clinch-river
    leadTimeKey: 'nuclear-bwrx-300',
    tradeOff: 'Most advanced SMR (US permit and a Canadian build underway) on conventional fuel; first units cost more per kW than a large reactor.',
  },
  nuscale: {
    label: 'SMR: NuScale US460 (VOYGR)',
    examples: 'NuScale US460 6-module plant',
    unitSizeMWe: { min: 77, default: 462, max: 462 }, // 77 MWe modules, 6-module plant 462 MWe
    capacityFactor: 0.92, // judgment
    // UAMPS Carbon Free Power Project target price rose from $58 to $89/MWh
    // (early 2023) and the project was cancelled in Nov 2023 (search index);
    // the widely quoted $9.3B total was not verified. Capex: judgment, FOAK
    // above AEO2026 SMR $9,831/kW.
    // https://www.neimagazine.com/news/uamps-and-nuscale-cancel-plans-to-build-smrs-at-inl-11297083/
    // https://www.eenews.net/articles/nuscale-cancels-first-of-a-kind-nuclear-project-as-costs-surge/
    capexPerKW: { foak: 18000, noak: 9831, default: 15000 },
    fixedOmPerKWYear: 127.62,
    variableOmPerMWh: 3.32,
    fuelPerMWh: 7, // judgment: LEU, small core
    earliestCodYear: 2034, // judgment: no construction permit application filed
    constructionYears: 4, // judgment
    water: NUCLEAR_TOWER_WATER,
    loadFollowing: 'Module-level cycling (judgment, not verified).',
    status: 'NRC Standard Design Approval for US460 on 2025-05-29; ENTRA1-TVA 6 GW framework (Sep 2025) non-binding, no PPA signed as of Jun 2026 (search index).',
    // https://www.nrc.gov/reactors/new-reactors/advanced/who-were-working-with/applicant-projects/nuscale-us460.html
    leadTimeKey: 'nuclear-nuscale',
    tradeOff: 'The only NRC-approved SMR design and finely divisible in 77 MW modules; its one firm project died on price and the order book is non-binding.',
  },
  'xe-100': {
    label: 'SMR: X-energy Xe-100 (HTGR)',
    examples: 'Dow Long Mott (Seadrift, TX); Energy Northwest Cascade (Amazon)',
    unitSizeMWe: { min: 80, default: 320, max: 960 }, // 80 MWe units, 4-pack 320 MWe, Cascade up to 12 units
    capacityFactor: 0.92, // judgment
    capexPerKW: { foak: 15000, noak: 9831, default: 12000 }, // judgment: no public estimate
    fixedOmPerKWYear: 127.62,
    variableOmPerMWh: 3.32,
    fuelPerMWh: 15, // judgment: HALEU TRISO premium over ~$6 LWR fuel
    earliestCodYear: 2032, // judgment
    constructionYears: 4, // judgment
    // judgment: ~40% thermal efficiency vs ~33% for LWRs -> ~20% less cooling water.
    water: { consumptionLPerMWh: Math.round(NUCLEAR_TOWER_WATER.consumptionLPerMWh * 0.8), withdrawalLPerMWh: Math.round(NUCLEAR_TOWER_WATER.withdrawalLPerMWh * 0.8) },
    loadFollowing: 'Good; high-temperature steam also serves process heat (judgment).',
    status: 'Dow Long Mott construction permit application docketed May 2025, NRC environmental assessment/FONSI May 2026, permit expected late 2026-early 2027; Cascade in pre-application (search index).',
    // https://www.nasdaq.com/articles/x-energy-q1-earnings-call-highlights
    leadTimeKey: 'nuclear-xe-100',
    tradeOff: 'High-temperature steam suits co-located industrial loads; depends on HALEU/TRISO fuel supply and has no public cost estimate.',
  },
  kairos: {
    label: 'SMR: Kairos Power KP-FHR',
    examples: 'Hermes 2 (Oak Ridge, TN) for Google via TVA',
    unitSizeMWe: { min: 35, default: 50, max: 75 }, // Hermes 2 up to 50 MWe; 75 MWe commercial size not verified
    capacityFactor: 0.9, // judgment
    capexPerKW: { foak: 20000, noak: 9831, default: 15000 }, // judgment: no public estimate
    fixedOmPerKWYear: 127.62,
    variableOmPerMWh: 3.32,
    fuelPerMWh: 15, // judgment: HALEU TRISO
    earliestCodYear: 2030, // Hermes 2 to TVA in 2030 (search index); fleet judgment early-mid 2030s
    constructionYears: 4, // judgment
    water: { consumptionLPerMWh: Math.round(NUCLEAR_TOWER_WATER.consumptionLPerMWh * 0.8), withdrawalLPerMWh: Math.round(NUCLEAR_TOWER_WATER.withdrawalLPerMWh * 0.8) }, // judgment
    loadFollowing: 'Low-pressure salt-cooled design (judgment: flexible, unproven).',
    status: 'Google: up to 500 MW from 6-7 reactors by 2035 (Oct 2024); TVA PPA for up to 50 MW from Hermes 2 serving Google (Aug 2025) (search index).',
    // https://www.ans.org/news/2025-08-19/article-7291/a-new-collaboration-among-kairos-tva-and-google/
    leadTimeKey: 'nuclear-kairos',
    tradeOff: 'Low-pressure design with a hyperscaler offtake; very small units and an unproven fuel and salt supply chain.',
  },
  natrium: {
    label: 'Advanced: TerraPower Natrium (with storage)',
    examples: 'Kemmerer Unit 1 (Wyoming); Meta agreement for 2-8 units',
    // 345 MWe, boosted to 500 MWe with molten-salt storage.
    // https://world-nuclear-news.org/articles/nrc-issues-construction-permit-for-first-natrium-plant
    unitSizeMWe: { min: 345, default: 345, max: 500 },
    capacityFactor: 0.9, // judgment
    // ~$4B total with DOE ARDP up to $2B (secondary, search index) ->
    // ~$11,600/kW on 345 MWe.
    // https://wyofile.com/nixed-russian-fuel-supply-complicates-natrium-schedule/
    capexPerKW: { foak: 11600, noak: 8000, default: 11600 },
    fixedOmPerKWYear: 127.62, // judgment: AEO2026 SMR row
    variableOmPerMWh: 3.32,
    fuelPerMWh: 15, // judgment: HALEU metal fuel
    earliestCodYear: 2031, // TerraPower targets 2030 completion; press calls 2031 optimistic
    constructionYears: 5, // judgment
    water: { consumptionLPerMWh: Math.round(NUCLEAR_TOWER_WATER.consumptionLPerMWh * 0.8), withdrawalLPerMWh: Math.round(NUCLEAR_TOWER_WATER.withdrawalLPerMWh * 0.8) }, // judgment
    loadFollowing: 'Built-in molten-salt storage swings output 345 -> 500 MWe for daily peaks.',
    status: 'NRC construction permit for Kemmerer Unit 1 on 2026-03-04, the first for a commercial non-LWR. HALEU supply delayed the project by at least two years (2022).',
    // https://www.energy.gov/ne/articles/nrc-issues-construction-permit-terrapowers-natrium-advanced-reactor
    leadTimeKey: 'nuclear-natrium',
    tradeOff: 'Storage gives firm baseload plus peaking, the best fit for datacenter load shaping; first-of-a-kind sodium technology on scarce HALEU.',
  },
  microreactor: {
    label: 'Microreactor / small fast reactor',
    examples: 'Oklo Aurora (15-75 MWe), Westinghouse eVinci',
    // Oklo 10-K: Aurora 15-75 MWe; Switch 12 GWe master agreement (Dec 2024)
    // (search index; SEC blocks automated access).
    // https://www.sec.gov/Archives/edgar/data/1849056/000162828025014490/oklo-20241231.htm
    unitSizeMWe: { min: 5, default: 75, max: 75 },
    capacityFactor: 0.9, // judgment
    capexPerKW: { foak: 30000, noak: 10000, default: 20000 }, // judgment: no published $/kW
    fixedOmPerKWYear: 150, // judgment: small units carry more fixed staff/security per kW
    variableOmPerMWh: 3.32,
    fuelPerMWh: 20, // judgment: HALEU
    earliestCodYear: 2028, // Aurora-INL target late 2027-2028 under DOE authorization (search index)
    constructionYears: 2, // judgment
    water: { consumptionLPerMWh: 0, withdrawalLPerMWh: 0 }, // judgment: air-cooled designs assumed
    loadFollowing: 'Designed for small loads; fast-reactor dynamics (judgment).',
    status: 'Oklo Aurora-INL Nuclear Safety Design Agreement approved by DOE 2025-11-11; the 2020 NRC licence application was denied in 2022; Meta 1.2 GW campus agreement in Ohio (Jan 2026).',
    // https://oklo.com/newsroom/news-details/2026/Oklo-Announces-U-S--Department-of-Energy-Approval-for-Nuclear-Safety-Design-Agreement-of-Aurora-Powerhouse-at-Idaho-National-Laboratory/default.aspx
    // https://world-nuclear-news.org/articles/meta-announces-landmark-agreements-for-new-nuclear
    leadTimeKey: 'nuclear-microreactor',
    tradeOff: 'Small and siteable next to the load with a small emergency zone; no licensed commercial unit yet, the highest $/kW and HALEU-dependent.',
  },
};

export const DEFAULT_NUCLEAR_TYPE = 'contracted-existing';

/* ---------- Power architectures ---------- */

/* What each architecture allows, enforced on every state by
   state/datacenter-schema.js (normalizeDatacenterState), so the UI, share
   links, the optimizer and the model only ever see a legal design:
     resources       'required' | 'optional' | 'none' per supply
     gridConnections allowed grid connection types (grid-connected only)
     gasTypes        allowed GAS_GENSET_TYPES keys (absent = all)
     nuclearTypes    allowed NUCLEAR_TYPES keys (absent = all)
   Grid-connected is firm utility service with backup only: standby
   generators, a battery, or a grid-delivered contract with an existing
   nuclear plant (modeled off site: no reactor, water or land at the
   datacenter, supply.js onSite false). An off-site renewable PPA would be a
   grid price and carbon setting, not on-site solar (not modeled). */
export const ARCHITECTURES = {
  grid: {
    label: 'Grid-connected',
    description: 'Firm utility service carries the load. On-site equipment is backup only: standby diesel generators and an optional battery ride through utility outages; nuclear only as a grid-delivered contract with an existing plant. No on-site solar or prime-power generation (choose Hybrid for those). Simplest to run, but the large-load connection can take years and the grid sets the price and the carbon intensity.',
    resources: { grid: 'required', solar: 'none', battery: 'optional', gas: 'optional', nuclear: 'optional' },
    gridConnections: ['firm'],
    gasTypes: STANDBY_GAS_GENSET_TYPES,
    nuclearTypes: ['contracted-existing'],
    examples: [
      {
        name: 'Meta Hyperion (Richland Parish, LA)',
        summary: 'Utility-built supply: Entergy gas plants for the campus. Three plants (~2.3 GW) approved in Aug 2025. In Mar 2026, seven more (~5.2 GW) were proposed, for ~7.5 GW in total.',
        url: 'https://fortune.com/2026/03/27/meta-hyperion-10-gas-power-plants-louisiana-entergy/',
        date: '2026-03',
      },
      {
        name: 'Clinton nuclear - Meta (IL)',
        summary: '20-year PPA for 1,121 MW from Constellation\'s Clinton plant starting Jun 2027; grid-delivered.',
        url: 'https://neutronbytes.com/2025/06/06/meta-signs-20-year-power-deal-with-constellation/',
        date: '2025-06',
      },
      {
        name: 'Susquehanna nuclear - Amazon (PA)',
        summary: 'Talen restructured a 960 MW co-location deal into a 1,920 MW front-of-meter PPA through 2042.',
        url: 'https://www.datacenterdynamics.com/en/news/aws-talen-sign-ppa-for-192gw-of-power-from-pennsylvania-nuclear-plant/',
        date: '2025-06',
      },
      {
        name: 'Google - TotalEnergies solar PPAs (TX)',
        summary: '1 GWp of solar (Wichita 805 MWp + Mustang Creek 195 MWp), ~28 TWh over 15 years, delivered via ERCOT.',
        url: 'https://corporate.totalenergies.us/news/totalenergies-provide-1-gw-solar-capacity-power-googles-data-centers-texas-15-years',
        date: '2026-02-09',
      },
    ],
  },
  hybrid: {
    label: 'Hybrid (grid + on-site)',
    description: 'A firm or flexible grid connection plus on-site generation and storage: solar, batteries, gas engines or turbines (or standby diesel) and nuclear. On-site gas runs whenever it is cheaper than grid power, with the grid as the balance, and covers the hours the grid cannot. A flexible connection, curtailable for a few dozen hours a year, can connect years sooner than firm service.',
    resources: { grid: 'required', solar: 'optional', battery: 'optional', gas: 'optional', nuclear: 'optional' },
    gridConnections: ['firm', 'flexible'],
    examples: [
      {
        name: 'Google / Intersect Meitner Energy Center (Gray & Roberts Counties, TX)',
        summary: 'Data center co-located with >1 GW of wind, solar and batteries; a minority of demand is met by firming on-site gas. Air-cooled.',
        url: 'https://www.intersect.com/news/google-and-intersect-deepen-texas-roots-with-new-data-center-and-energy-investments-in-gray-and-roberts-counties',
        date: '2026-06-04',
      },
      {
        name: 'Google / Intersect Quantum (Haskell County, TX)',
        summary: 'Quantum I and II: 640 MW of solar and 1.3 GWh of batteries paired with a Google data center.',
        url: 'https://www.powermag.com/google-launches-1-gw-plus-co-located-data-center-and-generation-complex-in-texas-panhandle/',
        date: '2026-06',
      },
      {
        name: 'Enbridge Cowboy project for Meta (Cheyenne, WY)',
        summary: '365 MW of solar plus 200 MW / 1,600 MWh of batteries ($1.2B, in service by end-2027), delivered under the utility\'s Large Power Contract Service tariff.',
        url: 'https://www.utilitydive.com/news/enbridge-meta-build-365-mw200-mw-solarstorage-project/820905/',
        date: '2026-05',
      },
      {
        name: 'Camus / encoord / Princeton flexible-connection study (PJM)',
        summary: 'Six PJM sites: grid available >99% of hours; batteries, gas and load flex cover 40-70 h/yr; full power ~3-5 years sooner.',
        url: 'https://cdn.prod.website-files.com/60dbdcca2e4b1919e8894fa5/6930abf1be0f36db6fc27157_Whitepaper%20-%20With%20Appendix.pdf',
        date: '2025-12',
      },
      {
        name: 'xAI Colossus (Memphis, TN)',
        summary: 'Mobile gas turbines bridged the wait for grid supply; the county permitted 15 SMT-130 units (~247 MW) in Jul 2025.',
        url: 'https://techcrunch.com/2025/07/03/xai-gets-permits-for-15-natural-gas-generators-at-memphis-data-center/',
        date: '2025-07-03',
      },
    ],
  },
  islanded: {
    label: 'Islanded (off-grid)',
    description: 'No grid connection: on-site generation alone must meet the uptime target. It can be gas engines or turbines on their own, solar plus batteries, nuclear, or any mix. It avoids the interconnection queue, but every outage hour has to be covered by spare units or storage, so the plant is oversized (the IEA cites 30-70% for gas).',
    resources: { grid: 'none', solar: 'optional', battery: 'optional', gas: 'optional', nuclear: 'optional' },
    examples: [
      {
        name: 'GW Ranch (Pecos County, TX) - Pacifico Energy / Amazon',
        summary: 'Private off-grid grid: TCEQ air permit for 7.65 GW of gas turbines (35 units), plus 1.8 GW of batteries and 750 MWac of solar. Amazon acquired a campus site to buy its power.',
        url: 'https://www.businesswire.com/news/home/20260126236053/en/Pacifico-Energy-Secures-7.65-GW-Power-Generation-Permit-for-GW-Ranch-Project',
        date: '2026-01-26',
      },
      {
        name: 'Williams Socrates for Meta (New Albany, OH)',
        summary: 'Two 200 MW behind-the-meter gas plants (turbines + reciprocating engines), not connected to the grid; OPSB approved Socrates South in Jun 2025.',
        url: 'https://www.datacenterdynamics.com/en/news/ohio-regulators-approve-construction-of-200mw-gas-power-plant-to-serve-meta-data-center-in-new-albany-ohio/',
        date: '2025-06',
      },
      {
        name: 'Oracle Project Jupiter (Doña Ana County, NM)',
        summary: 'Single microgrid of up to 2.45 GW of Bloom fuel cells replacing planned gas turbines and diesel; Oracle claims ~92% lower NOx and negligible water.',
        url: 'https://www.datacenterdynamics.com/en/news/oracle-to-deploy-up-to-245gw-of-bloom-fuel-cells-at-new-mexico-data-center/',
        date: '2026-04-27',
      },
    ],
  },
};

export const DEFAULT_ARCHITECTURE = 'grid';

/* Starting design per architecture, applied when the user switches
   architecture (state/datacenter-schema.js applyArchitectureDefaults). A
   starting point to adjust or optimize, not an optimum; every size is
   judgment. Gas is sized 'auto' in all three: the fewest units with which
   the hourly dispatch meets the uptime target given the grid, solar and
   battery (model/datacenter/firm-sizing.js), plus spare units, so each
   design meets the target by construction (tested in
   tests/calculations/datacenter-architecture.test.js).
   - grid: the default design. Firm utility service carries the load;
     standby diesel generators (the common datacenter backup, EPA emergency
     engines) cover the utility outages the target does not allow, plus one
     spare unit (GAS_REDUNDANCY_GUIDANCE backup). No solar or battery.
   - hybrid: the flexible-connection design of the Camus / encoord /
     Princeton study (GRID_DEFAULTS): a curtailable grid connection, on-site
     solar, a 4-hour battery (the study's batteries were 4-hour, and the
     model's curtailment events last 4 h) and reciprocating gas engines as
     prime power (GAS_REDUNDANCY_GUIDANCE gridParallel: N+1), sized for what
     the battery and solar cannot cover during outages and curtailments. The
     hybrid merit order runs the engines whenever they are cheaper than grid
     power (dispatch.js), so the grid becomes the balance; standby diesel
     would never run on cost and leave the design a grid one with solar.
     Solar = 2 MWdc per MW IT, east-west (judgment: it supplies roughly a
     third of the facility energy at Abilene with little curtailment,
     leaving the grid and gas as the balance). Battery power = the IT
     nameplate, so energy = 4 h x IT MW.
   - islanded: reciprocating gas engines alone as prime power with N+2
     redundancy (GAS_REDUNDANCY_GUIDANCE islanded); solar is optional and off, because gas-only is the common
     real off-grid build (Socrates, GW Ranch's core). */
export const ARCHITECTURE_STARTING_DESIGNS = {
  grid: {
    gridConnection: 'firm',
    solarMWdcPerMWIT: 0,
    batteryHoursOfIT: 0,
    gasType: GAS_REDUNDANCY_GUIDANCE.backup.defaultGensetType,
    gasSpareUnits: GAS_REDUNDANCY_GUIDANCE.backup.spareUnits,
  },
  hybrid: {
    gridConnection: 'flexible',
    solarMWdcPerMWIT: 2,
    batteryDurationHours: 4,
    batteryHoursOfIT: 4,
    gasType: GAS_REDUNDANCY_GUIDANCE.gridParallel.defaultGensetType,
    gasSpareUnits: GAS_REDUNDANCY_GUIDANCE.gridParallel.spareUnits,
  },
  islanded: {
    solarMWdcPerMWIT: 0,
    batteryHoursOfIT: 0,
    gasType: GAS_REDUNDANCY_GUIDANCE.islanded.defaultGensetType,
    gasSpareUnits: GAS_REDUNDANCY_GUIDANCE.islanded.spareUnits,
  },
};

/* ---------- Project lead times (power side) ----------
   Months from notice-to-proceed, { low, typical, high }; path duration =
   permitting + procurement + construction. Long-lead equipment is ordered
   (slot reserved) during permitting, so procurementMonths is only the part of
   order-to-delivery that outlasts permitting, and constructionMonths is the
   work left after delivery (site works proceed while equipment is awaited). Building and IT are in facility.js
   (FACILITY_LEAD_TIMES), cooling in cooling.js. */
export const POWER_LEAD_TIMES = {
  'grid-firm': {
    label: 'Grid connection (firm service)',
    // Large-load study, facilities agreement and transmission planning
    // (Dominion example: PJM need meeting 2025-10-08 -> solutions meeting
    // 2026-02-03); low/high judgment. ERCOT moved large loads to a batch
    // study ("Batch Zero") in 2026 and paused data center energizations
    // >=75 MW for an audit after the Governor's 2026-08-03 letter (search index).
    // https://www.ercot.com/services/comm/mkt_notices/M-A080326-01
    permittingMonths: { low: 6, typical: 12, high: 24 },
    // Utility HV equipment: Wood Mackenzie (Sep 2025) power transformers 128
    // weeks (~30 months) average in Q2 2025, GSUs 143 weeks; "between 2 - 3 years".
    // https://www.powermag.com/wp-content/uploads/2026/01/making-the-connection-executive-summary-september-2025.pdf
    procurementMonths: { low: 18, typical: 30, high: 36 },
    // judgment: substation + short line build.
    constructionMonths: { low: 6, typical: 12, high: 24 },
    // Check: totals 30 / 54 / 84 months vs Camus "3 to 7 years" and the
    // Dominion projects above (requested 2027-2028, projected 2030-2031).
  },
  'grid-flexible': {
    label: 'Grid connection (flexible / conditional firm)',
    // Camus et al.: a flexible connection reaches full operation in roughly
    // two years. Split across phases: judgment.
    permittingMonths: { low: 6, typical: 9, high: 12 },
    procurementMonths: { low: 6, typical: 9, high: 18 },
    constructionMonths: { low: 3, typical: 6, high: 9 },
  },
  substation: {
    label: 'On-site HV substation (transformers, switchgear)',
    permittingMonths: { low: 3, typical: 6, high: 9 }, // judgment
    // Wood Mackenzie (above): power transformers 128 weeks, GSUs 143 weeks,
    // switchgear 44 weeks (Q2 2025), i.e. ~30 months order-to-delivery, less
    // the permitting overlap. Low: judgment for medium-voltage-only designs,
    // refurbished or pre-ordered transformers.
    procurementMonths: { low: 9, typical: 24, high: 30 },
    constructionMonths: { low: 4, typical: 6, high: 12 }, // judgment
  },
  'gas-recip': {
    label: 'Gas engines',
    // judgment: state air permit; a PSD major-source permit must be decided
    // within one year of a complete application (Clean Air Act 165(c)).
    // https://www.law.cornell.edu/uscode/text/42/7475
    permittingMonths: { low: 6, typical: 12, high: 18 },
    // judgment: no published engine lead time found; set below EPRI's 18-36
    // months for small turbines (Utility Dive, above). Williams Socrates:
    // OPSB approval Jun 2025 -> in service targeted Q3 2026 (~15 months of
    // procurement + construction after the permit).
    // https://www.williams.com/wp-content/uploads/sites/8/2025/08/1355-Socrates-North-Fact-Sheet_v6.pdf
    procurementMonths: { low: 6, typical: 9, high: 18 },
    constructionMonths: { low: 4, typical: 6, high: 12 }, // judgment
  },
  'gas-aero': {
    label: 'Aeroderivative turbines',
    permittingMonths: { low: 6, typical: 12, high: 18 }, // judgment (see gas-recip)
    // EPRI: small turbine 18-36 months order-to-delivery, less the permitting overlap.
    procurementMonths: { low: 12, typical: 15, high: 18 },
    constructionMonths: { low: 4, typical: 6, high: 9 }, // judgment
  },
  'gas-industrial-sc': {
    label: 'Industrial / frame simple-cycle turbines',
    permittingMonths: { low: 9, typical: 12, high: 24 }, // judgment
    // EPRI: a large turbine ordered now "would likely take about five years";
    // GE Vernova reported a 116 GW backlog + slot reservations in Q2 2026
    // (search index). Low: industrial units (e.g. SGT-800) - judgment.
    // https://www.turbomachinerymag.com/view/ge-vernova-gas-turbine-backlog-hits-116-gw-as-power-orders-more-than-double
    // Order-to-delivery 24 / 48 / 72 months less the permitting overlap.
    procurementMonths: { low: 15, typical: 36, high: 48 },
    constructionMonths: { low: 6, typical: 9, high: 12 }, // judgment; Lazard v19 peaker build 24 months
  },
  'gas-ccgt': {
    label: 'Combined cycle (CCGT)',
    permittingMonths: { low: 12, typical: 18, high: 30 }, // judgment
    // EPRI ~5 years for a large turbine (above): order-to-delivery 36 / 60 /
    // 84 months less the permitting overlap.
    procurementMonths: { low: 24, typical: 42, high: 54 },
    // Lazard v19: 24-month construction; EIA AEO2026 lead time 3 years
    // (pre-crunch). Work left after turbine delivery: judgment.
    constructionMonths: { low: 12, typical: 18, high: 24 },
  },
  'diesel-standby': {
    label: 'Standby diesel generators',
    // judgment: emergency engines usually get a minor-source or general
    // permit; a large fleet can need a full air permit (high case).
    permittingMonths: { low: 2, typical: 4, high: 9 },
    // Global Power Supply (2026-05-11): 1,250-3,250 kW standby diesel
    // generators 52-70 weeks; Caterpillar (Q2 2026 call, search summary):
    // diesel genset lead times "extended into 2028", a little shorter than
    // gas prime power. Order-to-delivery 12 / 16 / 24 months less the
    // permitting overlap.
    // https://globalpwr.com/blog/generator-lead-times-in-2026
    // https://gurufocus.com/news/9002976/ (retrieved 2026-10)
    procurementMonths: { low: 10, typical: 12, high: 18 },
    constructionMonths: { low: 2, typical: 3, high: 6 }, // judgment: set on pads, fuel, cabling, commissioning
  },
  'gas-sofc': {
    label: 'Solid-oxide fuel cells',
    permittingMonths: { low: 2, typical: 4, high: 9 }, // judgment: no combustion; light air permitting
    // judgment: Bloom cites power within ~90 days for data centers (company
    // claim, not verified); EIA AEO2026 lead time for fuel cells is 3 years.
    procurementMonths: { low: 3, typical: 6, high: 12 },
    constructionMonths: { low: 2, typical: 4, high: 6 }, // judgment
  },
  'gas-bridge': {
    label: 'Mobile bridge turbines',
    permittingMonths: { low: 1, typical: 4, high: 12 }, // judgment: temporary-source permits; contested in Memphis
    procurementMonths: { low: 1, typical: 3, high: 9 }, // judgment: rental fleet availability
    constructionMonths: { low: 1, typical: 2, high: 3 }, // judgment
  },
  'nuclear-large-lwr': {
    label: 'Large reactor (AP1000)',
    permittingMonths: { low: 24, typical: 36, high: 48 }, // judgment: combined licence
    procurementMonths: { low: 0, typical: 0, high: 0 }, // inside construction
    // MIT CANES: next units 80-96 months; Lazard v19 84; Vogtle ~130.
    constructionMonths: { low: 80, typical: 90, high: 130 },
  },
  'nuclear-contracted-existing': {
    label: 'Existing nuclear PPA / restart',
    // judgment: contracting only; a restart (Crane, Palisades, Duane Arnold)
    // takes ~2-4 years from announcement; grid delivery follows the grid path.
    permittingMonths: { low: 3, typical: 6, high: 12 },
    procurementMonths: { low: 0, typical: 0, high: 0 },
    constructionMonths: { low: 0, typical: 12, high: 36 },
  },
  'nuclear-bwrx-300': {
    label: 'BWRX-300 SMR',
    // NRC reviewed TVA's Clinch River construction permit in ~14 months
    // (permit 2026-09-29); plus application preparation (judgment).
    permittingMonths: { low: 18, typical: 30, high: 42 },
    procurementMonths: { low: 0, typical: 0, high: 0 },
    // OPG Darlington: FID May 2025 -> unit 1 in service 2030 (~60 months).
    constructionMonths: { low: 48, typical: 60, high: 72 },
  },
  'nuclear-nuscale': {
    label: 'NuScale US460',
    permittingMonths: { low: 24, typical: 36, high: 48 }, // judgment: no construction permit application yet
    procurementMonths: { low: 0, typical: 0, high: 0 },
    constructionMonths: { low: 42, typical: 54, high: 72 }, // judgment
  },
  'nuclear-xe-100': {
    label: 'X-energy Xe-100',
    // Dow: application Mar 2025, permit expected late 2026-early 2027 (~21-24
    // months; search index).
    permittingMonths: { low: 21, typical: 24, high: 36 },
    procurementMonths: { low: 0, typical: 0, high: 0 },
    constructionMonths: { low: 42, typical: 54, high: 72 }, // judgment
  },
  'nuclear-kairos': {
    label: 'Kairos KP-FHR',
    permittingMonths: { low: 18, typical: 24, high: 36 }, // judgment
    procurementMonths: { low: 0, typical: 0, high: 0 },
    constructionMonths: { low: 36, typical: 48, high: 60 }, // judgment: Hermes 2 groundbreaking 2026 -> 2030
  },
  'nuclear-natrium': {
    label: 'TerraPower Natrium',
    // Kemmerer: construction permit application Mar 2024 -> permit
    // 2026-03-04 (~24 months).
    permittingMonths: { low: 24, typical: 24, high: 36 },
    procurementMonths: { low: 0, typical: 0, high: 0 },
    constructionMonths: { low: 48, typical: 60, high: 72 }, // permit Mar 2026 -> target 2030-2031
  },
  'nuclear-microreactor': {
    label: 'Microreactor',
    permittingMonths: { low: 12, typical: 24, high: 48 }, // judgment: DOE authorization at INL; NRC route longer
    procurementMonths: { low: 0, typical: 0, high: 0 },
    constructionMonths: { low: 12, typical: 24, high: 36 }, // judgment
  },
  solar: {
    label: 'Solar (behind the meter)',
    // judgment: no interconnection queue behind the meter; county/land-use
    // permits only. EIA AEO2026 lead time for grid-scale PV is 2 years.
    permittingMonths: { low: 3, typical: 6, high: 12 },
    procurementMonths: { low: 2, typical: 4, high: 9 }, // judgment: modules, trackers, inverters
    constructionMonths: { low: 4, typical: 8, high: 14 }, // judgment
  },
  battery: {
    label: 'Battery storage',
    // EIA AEO2026 lead time for battery storage: 1 year. Split: judgment.
    permittingMonths: { low: 2, typical: 3, high: 9 },
    procurementMonths: { low: 3, typical: 5, high: 12 },
    constructionMonths: { low: 2, typical: 4, high: 6 },
  },
};

/* ---------- Industry context ---------- */

/* Headline facts for the "industry context" note and the sources page.
   `checked`: 'opened' = we read the page/PDF; 'search-index' = only a search
   extract of it; 'owner' = owner's illustrative arithmetic. */
export const DATACENTER_POWER_CONTEXT = [
  {
    id: 'cleanview-btm',
    text: 'Cleanview tracks 59 behind-the-meter data centers planning ~90 GW of self-generation (>25% of planned US data center capacity). About 2 GW was operating in mid-2026, mostly xAI\'s Colossus 1 & 2 gas turbines (1,498 MW).',
    source: 'Cleanview, "Bypassing the Grid: How Data Center Developers Are Building Their Own Power Plants" (2026)',
    url: 'https://cleanview.co/reports/behind-the-meter-data-centers',
    checked: 'opened',
  },
  {
    id: 'iea-onsite-gas',
    text: 'IEA: around 15-27 GW of onsite natural gas may power data centres by 2030, mostly in the US; dependable onsite gas requires overbuilding generation by 30-70% relative to demand.',
    source: 'IEA, Key Questions on Energy and AI, executive summary (2026-04-16)',
    url: 'https://www.iea.org/reports/key-questions-on-energy-and-ai/executive-summary',
    checked: 'opened',
  },
  {
    id: 'epri-share',
    text: 'EPRI scenarios: data centers could use 9-17% of US electricity by 2030, up from ~4-5% today.',
    source: 'EPRI, Powering Intelligence 2026 (Feb 2026)',
    url: 'https://esca.epri.com/products/3002034696/',
    checked: 'search-index',
  },
  {
    id: 'lbnl-2030',
    text: 'LBNL reference case: 649 TWh of US data center use in 2030 (11.8% of US demand); scenario bounds 521-843 TWh.',
    source: 'LBNL, United States Data Center Energy Usage Report: 2025 Update (published Jun 2026)',
    url: 'https://eta-publications.lbl.gov/publications/united-states-data-center-energy-2025',
    checked: 'search-index',
  },
  {
    id: 'camus-flexible',
    text: 'A flexible grid connection with bring-your-own capacity can bring a 500 MW data center to full power in ~2 years, 3-5 years sooner. At six PJM sites the grid was available >99% of hours, and on-site resources ran 40-70 h/yr.',
    source: 'Camus, encoord & Princeton ZERO Lab, Flexible Data Centers (Dec 2025)',
    url: 'https://cdn.prod.website-files.com/60dbdcca2e4b1919e8894fa5/6930abf1be0f36db6fc27157_Whitepaper%20-%20With%20Appendix.pdf',
    checked: 'opened',
  },
  {
    id: 'ember-flex',
    text: 'Ember estimates only ~3% of data centre capacity will be available for load shifting in 2030, since ~87% runs latency-sensitive cloud and inference work. Onsite generation offers more grid relief.',
    source: 'Ember, Data centres for grids: the potential impact of flexibility (2026-10-29)',
    url: 'https://ember-energy.org/latest-insights/data-centres-for-grids-the-potential-impact-of-flexibility/',
    checked: 'opened',
  },
  {
    id: 'ceepr-rates',
    text: 'Data center entry (2010-2024) raised average retail electricity prices by 2.7% (industrial +4.2%), concentrated at investor-owned utilities.',
    source: 'Meeks, Pless, Qi & Wang, "Who Pays for Growth? Evidence from Data Centers and the Grid", MIT CEEPR working paper (2026)',
    url: 'https://ceepr.mit.edu/workingpaper/who-pays-for-growth-evidence-from-datacenters-and-the-grid/',
    checked: 'search-index',
  },
  {
    id: 'ercot-queue',
    text: 'ERCOT had ~474 GW of large loads seeking interconnection in mid-2026 (~90% data centers). After the Governor\'s 2026-08-03 letter it paused energizing new data centers of 75 MW+ pending an audit.',
    source: 'ERCOT board and Senate updates, Jul-Sep 2026',
    url: 'https://www.ercot.com/services/comm/mkt_notices/M-A080326-01',
    checked: 'search-index',
  },
  {
    id: 'interconnection-wait',
    text: 'Power plants built in 2024 took a median 55 months from interconnection request to operation (36 in 2015, 22 in 2008).',
    source: 'LBNL, Queued Up: 2025 Edition (Dec 2025)',
    url: 'https://emp.lbl.gov/sites/default/files/2025-12/Queued%20Up%202025%20Edition%20-%2012.15.2025.pdf',
    checked: 'opened',
  },
  {
    id: 'transformers',
    text: 'Power transformer lead times averaged 128 weeks (GSUs 143) in Q2 2025; the US faced a ~30% power-transformer supply deficit.',
    source: 'Wood Mackenzie, Making the connection: executive summary (Sep 2025)',
    url: 'https://www.powermag.com/wp-content/uploads/2026/01/making-the-connection-executive-summary-september-2025.pdf',
    checked: 'opened',
  },
  {
    id: 'turbine-prices',
    text: 'Gas turbine prices are projected to reach $600/kW by end-2027 (+195% since 2019). A large turbine ordered now takes ~5 years to deliver, a small one 18-36 months.',
    source: 'Utility Dive on Wood Mackenzie (2026-04-01) and EPRI',
    url: 'https://www.utilitydive.com/news/gas-turbine-supply-crunch-set-to-raise-prices-195-by-2027-woodmac/816904/',
    checked: 'opened',
  },
  {
    id: 'lazard-lcoe',
    text: 'Unsubsidized LCOE, $/MWh: gas combined cycle 51-129, gas peaking 144-276, utility solar 40-98, solar + storage 61-156, US nuclear 175-255 (gas at $3.45/MMBtu).',
    source: 'Lazard, Levelized Cost of Energy+ v19.0 (Jul 2026)',
    url: 'https://www.lazard.com/media/kcfconhf/lazards-lcoeplus_vf.pdf',
    checked: 'opened',
  },
  {
    id: 'dispatch-cost',
    // 6.5 x $5 + $4 = $36.5/MWh; 9.5 x $5 + $6 = $53.5/MWh.
    text: 'Illustrative fuel + variable O&M cost at $5/MMBtu: a CCGT (6.5 MMBtu/MWh + $4/MWh) runs at ~3.65 c/kWh, a simple-cycle turbine or engine (9.5 MMBtu/MWh + $6/MWh) at ~5.35 c/kWh.',
    source: 'Owner analysis (Oct 2026), arithmetic',
    url: '',
    checked: 'owner',
  },
  {
    id: 'eia-prices',
    text: 'Average industrial electricity price, Aug 2026: Texas 7.21 c/kWh, Louisiana 6.10, Virginia 9.98, US 9.64.',
    source: 'EIA Electric Power Monthly, Table 5.6.A',
    url: 'https://www.eia.gov/electricity/monthly/epm_table_grapher.php?t=epmt_5_6_a',
    checked: 'opened',
  },
  {
    id: 'henry-hub',
    text: 'Henry Hub averages $3.48/MMBtu in 2026 and is forecast at $3.16 in 2027; January 2026 hit $7.72 after winter storm Fern.',
    source: 'EIA Short-Term Energy Outlook (Oct 2026)',
    url: 'https://www.eia.gov/outlooks/steo/report/natgas.php',
    checked: 'opened',
  },
  {
    id: 'nuclear-deals',
    text: 'Hyperscalers have contracted existing and new nuclear: Meta up to 6.6 GW (Vistra, TerraPower, Oklo; Jan 2026) plus Clinton 1.1 GW, Amazon-Talen 1.92 GW, Microsoft-Crane 835 MW, Google-Kairos 500 MW. The US fleet ran at a 91.1% capacity factor in 2025.',
    source: 'World Nuclear News (Meta, 2026-01); EIA Table 6.07.B',
    url: 'https://world-nuclear-news.org/articles/meta-announces-landmark-agreements-for-new-nuclear',
    checked: 'search-index',
  },
];
