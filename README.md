# Solar Chemical/AI Plant Builder

An unofficial, MIT-licensed browser app for exploring a Terraform Industries-style solar-to-chemical plant. The current simulator is best understood as an educational techno-economic model for a direct-coupled solar + electrolysis + DAC + methane/methanol system, with an optional colocated **AI compute** load that competes for the same solar and battery resources. It is not a bankable engineering model.

The app is intentionally centered on the idea that very cheap local solar DC, low-capex intermittent hardware, and colocated conversion can matter more than chasing maximum utilization or maximum electrical efficiency.

## Current State

Today it supports:

- Yield-driven annual solar modeling with preset Earth sites, stylized Mars and Moon presets, and manual `MWh / MWdc / year` input.
- Earth `Annual Average` and `Specific Day` views, plus average-cycle Mars and Moon modes with annual dispatch built on local-cycle and orbital-year assumptions.
- Solar mounting comparisons across fixed tilt, East-West fixed, single-axis tracking, and dual-axis tracking.
- Chemical peak sizing via `chemicalSizingPercent`, so you can compare full-capture sizing against intentional solar clipping.
- A direct-coupled allocation model that auto-balances electrolyzer, DAC, and exploratory-route power shares from the enabled downstream demand.
- Fully modeled supported product paths for methane and methanol, including mass balance, CAPEX, revenue, replacement timing, and finance outputs.
- Methane and methanol co-production with a shared feedstock split when both supported product routes are enabled.
- Default-on feed buffers for methane, methanol, and selected lower-electricity exploratory routes, so CAPEX sizing can use the peak daily average gas-feed rate of the most active modeled day instead of the instantaneous peak flow.
- Exploratory industrial routes with selectable pathways, priority weights, rough throughput modeling, CAPEX basis controls, shared exploratory O&M, sale-price inputs, and inclusion in CAPEX, revenue, NPV, and IRR.
- MTG (`methanol -> gasoline-range hydrocarbons`) as an exploratory downstream route that diverts a configurable share of methanol away from export.
- Optional on-site AI datacenter mode: a reliability-targeted constant IT load sized against the modeled solar and battery system, with token revenue, GPU CAPEX, AI O&M, and annual dispatch.
- A data-driven incentive layer with sourced, dated scheme parameters (see Sources): US `48E`, `45Y`, `45V`, `45Q`, Hydrogen / DAC Hub grants, EU Hydrogen Bank and Innovation Fund style support, Germany / Netherlands / UK / Spain program proxies, framework-only backdrops, and a custom mixed-support mode.
- NPV, project IRR, optional equity IRR with debt financing, ROI, payback, replacement-aware discounted cash flow outputs, and price sensitivity charts.
- Daily power, annual dispatch, economics, sensitivity, environmental, and site-footprint views.
- Inline IRR optimizers for battery capacity, chemical peak sizing, and methane-vs-methanol feedstock split.

The app is still a mostly static front-end project built from native ES modules (no bundler), with a lightweight Node build that generates versioned `dist/` assets for deployment. The source is split into clearer modules:

- `index.html`: app layout and control surfaces; loads the self-hosted vendor scripts plus a single `js/main.js` module entry
- `style.css`: visual styling
- `js/main.js`: browser bootstrap (creates the `App` once the DOM is ready)
- `js/data/`: reference data only, no logic
  - `reference-data.js`: planetary bodies (incl. orbital constants), site presets, mounting types, chemistry constants, methane market notes, AI defaults
  - `assumptions.js`: fixed model heuristics (`MODEL_ASSUMPTIONS`, GHI/cloudiness tables, diffuse-fraction fallback, layout reference site)
  - `modules.js`: supported and exploratory process modules and their routes (add a route or module here)
  - `policies.js`: the incentive scheme registry and policy picker groups (add a scheme here)
- `js/model/`: the DOM-free calculation engine shared by the UI, the optimizer worker, and the Node tests
  - `index.js`: assembles and exports the `Calc` facade (plus `ModuleCatalog`, `PolicyModel`, `SolarGeometry`, `DEFAULT_STATE`)
  - `solar.js`, `annual-series.js`, `battery.js`, `ai-compute.js`, `lifetime-energy.js`, `process.js`, `economics.js`: solar resource and plant, hourly annual series, battery storage and chemical dispatch, AI datacenter dispatch, per-year energy on the degrading array, process chain, and project economics
  - `scenario.js`: the end-to-end scenario pipeline (`calculateAll`, `calculateIrr`, `runSensitivity`)
  - `finance.js`, `util.js`, `optimizer-search.js`: financial primitives (CRF, debt, payback, IRR), numeric helpers, and the IRR slider search
  - `module-catalog.js`: the `ModuleCatalog` API over `data/modules.js`
  - `policy.js`: policy evaluation over `data/policies.js`
  - `solar-geometry.js`: sun position, clear-sky irradiance, plane-of-array transposition per mounting, and Earth, Mars, and Moon solar profiles
- `js/state/`: `schema.js` (field definitions and `DEFAULT_STATE`), `normalize.js` (state normalization and dependency rules), `migrations.js` (legacy state rewrites), `share-codec.js` (shareable URL hash encoding), `saved-site-presets.js` (locally saved sites)
- `js/ui/`: the `App` class (`app.js`: state, init, recalculation) plus the method mixins it is assembled from
  - `control-spec.js` + `controls.js`: one declarative list of state-backed controls drives both input binding and state -> control sync; `module-controls.js`, `site-controls.js`, and `select-options.js` cover the dynamic module cards, site presets, and data-generated option lists
  - `ui-state.js`, `day-view.js`, `layout.js`, `tooltips.js`, `slider-markers.js`: visibility sync, specific-day display, section/mobile layout, tooltips, slider guides
  - `renderers/` (result panels; `economics.js` builds the economics breakdown), `charts/` (one module per chart), `diagram.js`, `site-map.js`, `share.js`, `optimizer-client.js`
  - `formatters.js` and `format-numbers.js`: display formatting shared by controls and renderers
- `js/workers/optimizer-worker.js`: module worker running the IRR search for the inline optimize buttons
- `scripts/build.mjs` + `scripts/dev.mjs`: minimal build and static-serving scripts for local development and deployment output
- `tests/`: Node-based regression tests for calculations and renderer output

## What Is Modeled Well Enough Today

These are the parts of the app that are currently structured well enough to be useful for scenario exploration:

- Yield-driven annual solar production with mounting-specific yield plus location-adjusted land-use and solar-BOS effects layered on top of a base site yield.
- Earth annual-average and specific-day views, plus Mars and Moon annual-dispatch paths based on representative local-cycle assumptions.
- A methane and methanol product system with shared H2 and CO2 allocation, explicit conversion assumptions, and export accounting.
- Optional MTG diversion of methanol into a downstream hydrocarbon product rather than treating all methanol as exported sale volume.
- Optional AI compute economics: constant IT load sizing, token throughput and price assumptions, GPU CAPEX, AI O&M, and revenue integrated into project economics.
- Distinct CAPEX buckets for solar modules, BOS, land, site prep, battery, core process modules, exploratory route blocks, and AI IT when enabled.
- Separate asset lives, replacement CAPEX events, panel degradation, and policy-duration limits inside the discounted cash flow.
- A centralized policy registry that maps one-time capex support, per-output support, strike-minus-reference schemes, base-minus-correction schemes, framework-only policy backdrops, and a custom mixed-support stack into the cash-flow model.
- Optional debt financing that switches the headline IRR from unlevered project IRR to sponsor-style equity IRR while keeping project NPV unlevered.
- Exploratory route economics driven by route-specific electricity intensity, required feedstocks, cycling penalties, peak-throughput sizing, CAPEX basis, O&M, and sale-price assumptions.
- A lean IRR calculation path plus worker-backed search used by the inline optimization controls.

## What Is Still Simplified Or Missing

The simulator is useful, but it still has important limitations:

- Earth fallback solar yield still relies on a latitude/GHI irradiance heuristic and a fixed performance ratio when the user is not using a preset or manual annual yield.
- Every modeled day has the clear-sky profile shape; multi-day weather is not modeled, so AI reliability and battery-firmed chemical hours are clear-sky-equivalent.
- Hydrogen-only sales are not yet modeled as a revenue line.
- DAC-only and hydrogen-only operating modes are still stylized fallback cases rather than dedicated product modes.
- Exploratory routes are rough techno-economic placeholders, not full first-principles process designs with validated thermal, logistics, startup, or quality constraints.
- O&M is still represented as simple percentages of CAPEX rather than a detailed fixed-plus-variable cost model.
- Financing is limited to a simple upfront debt share, fee, and amortizing annual debt service. Taxes, depreciation, inflation, working capital, tax equity, and ownership structure are not modeled. Salvage is straight-line book value (land at nominal cost), not a market resale estimate.
- Policy eligibility is not legally validated against full lifecycle, jurisdictional, wage, certification, ownership, or contractual requirements.
- Bid-based grants, premiums, CfDs, and correction mechanisms still depend on user-entered award assumptions rather than live auction or tariff datasets.
- The battery model is a simplified firming heuristic, not a full storage engineering model or year-round plant-control system.
- AI compute is a stylized constant-load and token-pricing layer, not a GPU, network, or datacenter engineering model.
- Planetary modes are exploratory and use literature-inspired benchmarks rather than bankable resource datasets.

## Key Assumptions

The current implementation makes several deliberate assumptions that should stay visible:

- Annual economics are driven by `siteYieldMwhPerMwdcYear`; the day selector mainly changes charting and Earth day-level visualization, not the annual non-AI economics.
- `siteYieldMwhPerMwdcYear` is treated as a base annual yield for the reference mounting (fixed optimal tilt; vertical sun-tracking at the lunar pole). Mounting effects are applied on top of that base yield rather than asking the user for a fully mounting-adjusted number.
- With AI compute enabled, the model builds an annual dispatch path and serves AI first; the chemical plant and battery charging use residual solar after the AI load.
- `chemicalSizingPercent` scales the full-capture chemical peak and allows intentional clipping of the highest-solar hours.
- Feed buffers, when enabled, are treated as part of the process block and are not costed or modeled as standalone storage assets.
- Supported products and exploratory routes share H2, CO2, methanol, and power through an auto-balanced weighted allocation rather than a user-entered process-flow sheet.
- Panel efficiency affects panel area and land use, not annual energy yield, because the model is framed around user-set fixed MWdc nameplate rather than auto-resizing solar capacity to a target output.
- Earth-site acreage and solar BOS keep the user-selected installed MWdc fixed, then apply location-aware layout heuristics on top of the mounting baseline instead of solving a new required MWdc for each site.
- Stored energy always loses a fixed `2%/month` through standing leakage, and the battery charges or discharges at most `capacity / duration` per hour (default 4 h).
- Revenue follows the year-by-year energy of the fixed plant design re-dispatched on the degrading array (AI token revenue degrades less than PV output, residual chemistry more); degradation restarts after a solar replacement.
- Weather is represented only through the annual yield and the site's diffuse fraction: every modeled day has the clear-sky shape, so there are no multi-day cloudy spells.
- Named incentive schemes are non-stacked by default except in `Custom mixed support`, framework-only entries do not change cash flow, and time-limited support ends after the modeled support duration.
- Upfront capex support is applied at close against the eligible capex basis only; later replacement CAPEX is not automatically re-subsidized in the current model.
- Default methane volume conversion assumes `19.25 kg CH4 / MCF`.
- Fossil gas displacement uses `0.0528 tCO2 / MCF`: combustion CO2 of pure CH4 at 19.25 kg/MCF (EPA's ~0.055 t/MCF is for pipeline gas at ~1,036 Btu/scf). Upstream emissions and methane leakage of the displaced gas, and of the synthetic gas itself, are excluded.
- Captured CO2 that ends up in a fuel returns to the air when the fuel is burned, so the plant is not a removal: net avoided CO2 is only the displaced fossil combustion CO2 of its fuels (methane, methanol, MTG hydrocarbons). Exploratory non-fuel products are counted as bound, not avoided.
- Default low-capex Terraform-style process presets are approximate, not universal truths.

## Core Formula Summary

The formulas below are the current conceptual backbone of the app.

### Solar

`base_yield` is the yield of a reference mounting: on Earth and Mars a fixed,
equator-facing array at its optimal tilt; at the lunar peak of eternal light
(PEL) vertical, sun-tracking panels. Earth presets carry PVGIS v5.3 yields
(crystalline Si, 14% system loss, optimal tilt) and horizontal irradiation,
plus the Global Solar Atlas annual diffuse fraction (sources and retrieval date
in `js/data/reference-data.js`).

```text
base_yield_mwh_per_mwdc_year =
  manual_or_preset_or_estimated_yield

site_yield_mwh_per_mwdc_year =
  base_yield_mwh_per_mwdc_year * mounting_yield_multiplier

annual_solar_mwh = solar_mwdc * site_yield_mwh_per_mwdc_year

daily_solar_kwh_avg = annual_solar_mwh * 1000 / cycles_per_year

capacity_factor = annual_solar_mwh / (solar_mwdc * 8760)

panel_area_m2 = solar_mwdc * 1e6 / (module_efficiency * 1000)

ground_coverage_ratio =
  mounting_baseline adjusted by Earth-site latitude/cloudiness heuristics

site_area_m2 = panel_area_m2 / ground_coverage_ratio

solar_bos_cost_per_w =
  user_selected_bos_baseline adjusted by mounting + Earth-site layout heuristics
```

Earth sky and mounting geometry (`solar-geometry.js`):

```text
dni_clear = 1353 * 0.7^(air_mass^0.678) * earth_sun_distance_factor   (Meinel)
dhi_clear = 0.1 * dni_clear
ghi       = dni_clear * sin(elevation) + dhi_clear

# clouds/aerosols move a share (1 - t) of the beam into diffuse, conserving
# GHI; t is solved so the annual DHI/GHI matches the site's diffuse fraction
dni = t * dni_clear
dhi = dhi_clear + (1 - t) * dni_clear * sin(elevation)

# Hay-Davies transposition (A = dni / extraterrestrial dni, Rb = cos(aoi) / cos(zenith))
poa = dni * cos(aoi) + dhi * (A * Rb + (1 - A) * (1 + cos(tilt)) / 2)
      + 0.2 * ghi * (1 - cos(tilt)) / 2

mounting_yield_multiplier (Earth) =
  annual_poa(mounting) / annual_poa(fixed at the modeled optimal tilt)
```

Mountings: fixed tilt at the modeled optimum (golden-section search on annual
POA), 8 deg east-west racks, horizontal N-S single-axis trackers limited to
+/-60 deg with backtracking at the row ground-coverage ratio, and ideal
dual-axis tracking. At Mojave this gives E-W 0.86, single-axis 1.21, dual 1.43
(PVGIS: 0.85, 1.30 and 1.46 for unconstrained, unshaded trackers); London E-W
0.84 (PVGIS 0.82). At the lunar PEL the Sun circles ~1 deg above the horizon,
so the multiplier vs vertical sun-tracking panels is ~0.52 for a horizontal-axis
tracker, ~1/pi for a fixed vertical panel and ~0.05 for low-tilt E-W racks.
Mars and the generic Moon profile use the `MOUNTING_TYPES` table.

The hourly annual series has the modeled clear-sky shape scaled to the annual
energy, with every hour capped at DC nameplate. A yield that cannot fit under
that cap during modeled daylight is capped (and flagged in the UI) rather than
inventing energy.

For Earth sites away from a preset, the base-yield estimate is:

```text
diffuse_fraction = 0.18 + 0.38 * cloudiness            (preset: measured)
estimated_base_yield = ghi * modeled_poa_gain(optimal_tilt) * 0.78
```

That fallback is a heuristic (PVGIS performance ratios span 0.73-0.81), not a project-grade solar dataset.

### Chemical sizing and allocation

Chemical energy, clipping, operating hours and process sizing all come from
one hour-by-hour dispatch over the annual solar series (Earth: 8760 h; Mars:
one orbital year of sols, annualized; Moon: the local cycle repeated over an
Earth year). Solar feeds the process first, the battery covers shortfalls and
absorbs surplus within its power rating, the rest is clipped; the year is
settled to a periodic battery state. The 100% size is the smallest constant
capacity that clips nothing over that year:

```text
full_capture_kw = annual solar peak                        (no battery)
                = min { P : clipped_kwh(P, battery) = 0 }  (battery; bisection)

chemical_peak_kw = full_capture_kw * chemical_sizing_fraction

battery_power_kw = battery_capacity_kwh / battery_duration_hours
```

Average-day curves in the charts are hour-of-day averages of that annual dispatch.

Power and feed shares are then auto-balanced from the enabled downstream routes:

```text
weight_i = product weight (methane/methanol split %, or exploratory priority weight)

h2_power_demand  = sum_i weight_i * h2_kg_per_unit_i  * electrolyzer_kwh_per_kg
co2_power_demand = sum_i weight_i * co2_kg_per_unit_i * dac_kwh_per_kg
route_power_demand_i = weight_i * electricity_kwh_per_unit_i

electrolyzer_share = h2_power_demand / total_power_demand
dac_share          = co2_power_demand / total_power_demand
exploratory_share_i = route_power_demand_i / total_power_demand

h2_feed_share_i  = weight_i * h2_kg_per_unit_i  / sum_j weight_j * h2_kg_per_unit_j
co2_feed_share_i = weight_i * co2_kg_per_unit_i / sum_j weight_j * co2_kg_per_unit_j
```

Feeds are split by the same weight x kg-per-unit product the power shares use,
so every consumer receives H2 and CO2 in its stoichiometric ratio and the only
unused feed is each reactor's unconverted fraction (methane + methanol 50/50 at
95% / 80% conversion: 9.1% of H2 and 10.0% of CO2 unused).

Buffered gas-fed routes can size from the most active modeled day without chasing the single highest intra-day spike:

```text
buffered_peak_feed_kg_per_hour = peak_day_feed_kg / cycle_hours
```

For methane, methanol, and the exploratory routes that expose the buffer toggle, this buffered rate replaces the instantaneous peak-feed rate for nameplate CAPEX sizing when the checkbox is on.

### Electrolysis

Reaction:

```text
2 H2O -> 2 H2 + O2
```

Core formulas:

```text
h2_kg = electrolyzer_input_kwh / electrolyzer_kwh_per_kg_h2

water_consumed_kg = h2_kg * 9
```

Current default-style values:

- Theoretical minimum: `39.4 kWh/kg H2`
- Hydrogen LHV used for efficiency framing: `33.33 kWh/kg H2`
- Terraform-style low-capex preset: `79 kWh/kg H2`

### Direct Air Capture

Core formulas:

```text
co2_tons = dac_input_kwh / dac_kwh_per_tco2

co2_kg = co2_tons * 1000

dac_capex = dac_capex_per_tpy * dac_peak_kw * 8760 * 0.25 / dac_kwh_per_tco2
```

DAC CAPEX is entered per t-CO2/yr of capacity at a 25% reference solar
utilization (the basis of Terraform's whitepaper 2.0 figure of $40.35/t-yr)
and applied to the DAC's nameplate power, so the same hardware costs the same
at a sunny and a cloudy site.

Current reference preset:

- DAC energy: `3440 kWh/t-CO2`

### Methane (Sabatier)

Reaction:

```text
CO2 + 4 H2 -> CH4 + 2 H2O
```

Stoichiometric constants used in the app:

```text
h2_per_kg_ch4 = 0.503
co2_per_kg_ch4 = 2.744
water_per_kg_ch4 = 2.25
kg_ch4_per_mcf = 19.25
```

Core formulas:

```text
ch4_kg_from_h2 = h2_kg / 0.503
ch4_kg_from_co2 = co2_kg / 2.744

ch4_kg = min(ch4_kg_from_h2, ch4_kg_from_co2) * sabatier_conversion

ch4_mcf = ch4_kg / 19.25
```

### Methanol

Reaction:

```text
CO2 + 3 H2 -> CH3OH + H2O
```

Stoichiometric constants used in the app:

```text
h2_per_kg_meoh = 0.189
co2_per_kg_meoh = 1.374
water_per_kg_meoh = 0.562
```

Core formulas:

```text
gross_meoh_kg = min(h2_kg / 0.189, co2_kg / 1.374) * methanol_conversion

export_meoh_kg = max(0, gross_meoh_kg - mtg_methanol_consumption)
```

### Exploratory routes

Each exploratory route uses a rough throughput limit from electricity plus any required feedstocks:

```text
output_units =
  min(
    daily_kwh / electricity_kwh_per_unit,
    h2_available_kg / h2_kg_per_unit,
    co2_available_kg / co2_kg_per_unit,
    methanol_available_kg / methanol_kg_per_unit
  )
```

Peak-throughput sizing drives route CAPEX:

```text
peak_nameplate_units_per_hour =
  min(
    peak_alloc_kw / electricity_kwh_per_unit,
    peak_h2_kg_per_hour / h2_kg_per_unit,
    peak_co2_kg_per_hour / co2_kg_per_unit,
    peak_methanol_kg_per_hour / methanol_kg_per_unit
  )

route_capex =
  peak_nameplate_capacity * capex_basis * cycling_penalty

annual_route_revenue = annual_output_units * sale_price
```

For buffer-capable exploratory routes, the model can instead size the block from:

```text
peak_nameplate_units_per_hour =
  peak_output_daily_units / cycle_hours
```

Most exploratory routes size CAPEX on `$/ton/yr capacity`; desalination routes use `$/m3/day`.

### AI compute (optional)

When enabled, a constant `load_kw` is chosen so simulated delivered utilization meets the selected reliability target. Tokens and revenue follow throughput and price inputs:

```text
annual_tokens_m = ai_served_mwh * million_tokens_per_mwh

annual_ai_revenue = annual_tokens_m * price_per_million_tokens
```

GPU CAPEX uses `$ / kW` of installed IT load at the solved `load_kw`. The UI also reports full-rate reliability, integrated `$ / M token`, and token margin versus the token price.

Reliability is clear-sky-equivalent: every modeled day has the clear-sky shape
scaled to the site's annual yield, so multi-day cloudy spells are not modeled
and the battery needed for a real-world uptime target is larger. AI sizing
needs storage; with the battery at 0 the model adds 1 MWh per GWh/yr of solar
and says so in the AI panel.

### Lifetime energy (degradation)

The plant is sized on year-1 solar. The same design (AI load, chemical
capacity, battery) is re-dispatched at four PV output factors spanning the
horizon, and energies are interpolated per year:

```text
solar_factor_y = (1 - degradation)^((y - 1) mod solar_asset_life)   # resets after repowering

ai_factor_y       = ai_served_kwh(solar_factor_y)  / ai_served_kwh(1)
chemical_factor_y = chemical_kwh(solar_factor_y)   / chemical_kwh(1)

revenue_ai_y       = revenue_ai_1 * ai_factor_y
revenue_products_y = revenue_products_1 * chemical_factor_y
policy_credits_y   = credits_1 * (solar_factor_y for solar-output credits,
                                  chemical_factor_y for H2/CO2 credits)
```

AI is served first, so it loses less than the PV output while the residual
chemistry loses more; the AI panel reports the lowest yearly (late-life)
reliability of the fixed design load.

### Policy layer

The policy model now uses a small set of direct cash-flow archetypes plus framework-only backdrop modes:

```text
upfront_capex_support = eligible_capex * chosen_share

annual_output_support = qualifying_output * unit_support

two_way_support = qualifying_output * (strike_price - reference_price)

base_minus_correction_support =
  qualifying_output * max(base_amount - correction_amount, 0)
```

Implementation assumptions:

- Named schemes model one program or framework at a time.
- `Custom mixed support` can stack total-capex support with solar, hydrogen, and CO2 annual support.
- Upfront support reduces net CAPEX at close and the annualized capital charge on the supported initial build.
- Annual support is paid on qualifying output only and stops when the scheme duration expires: solar electricity delivered to the plant (generation minus clipping), H2 converted into products and CO2 utilized in them (vented surplus earns nothing). Solar schemes on self-consumed power (45Y, EEG, SDE++, CfD) are proxies: real schemes pay metered or sold output, and a CfD's strike-minus-reference has no reference price for power used on site. 45Q utilization into fuel is further limited to the lifecycle net reduction (IRC 45Q(f)(5)(B)), which is not modeled, so 45Q here is an upper bound.
- `Custom mixed support` applies its capex share to total installed CAPEX including land.
- Framework-only entries intentionally change scenario context without inventing a cash flow.

### Finance

The app uses capital recovery factor annualization plus a discounted cash flow path with explicit replacement years.

```text
crf(r, n) = r * (1 + r)^n / ((1 + r)^n - 1)

annualized_capex_i = capex_i * crf(discount_rate, asset_life_i)
annualized_land    = land_capex * discount_rate        # land does not wear out

asset_life_charge = sum(annualized_capex_i) + annualized_land     # cost breakdown

levelized_cost    = (net_capex_at_close + PV(replacements) - PV(salvage_N)) * crf(r, N) + annual_om
levelized_revenue = PV(yearly_revenue_y incl. credits while paid) * crf(r, N)
levelized_profit  = levelized_revenue - levelized_cost = npv * crf(r, N)

solar_capex          = modules + bos + site_prep       # 48E basis; land excluded
solar_replacement    = modules + bos                   # repowering reuses the site

salvage_N = sum_i last_install_cost_i * remaining_life_i / life_i + land_capex

net_cash_flow_y =
  yearly_revenue_y -
  annual_om -
  replacement_capex_y +
  (y == N ? salvage_N : 0)

npv =
  -initial_capex +
  sum(net_cash_flow_y / (1 + discount_rate)^y)
```

When debt financing is enabled, the model also tracks a simple upfront debt structure:

```text
debt_amount = total_capex * debt_share

equity_upfront = total_capex - debt_amount + upfront_fee

annual_debt_service = debt_amount * crf(interest_rate, debt_term)

equity_cash_flow_y = net_cash_flow_y - debt_service_y
```

Important implementation detail:

- Yearly revenue streams follow the lifetime energy vectors (see Lifetime energy): AI revenue the AI-served energy, product and exploratory revenue the delivered chemical energy, with degradation restarting after each solar replacement.
- Time-limited policy modes only apply for their modeled support duration.
- Replacement CAPEX appears as discrete outflows when asset life rolls over within the analysis horizon, paid at the end of the year the (possibly fractional) life ends in; the schedule does not drift (an 11.3-year battery is paid in years 12, 23, ...).
- The final year returns each asset's straight-line residual value (a 7-year block replaced in year 28 of 30 returns 5/7 of its cost), so lengthening the horizon no longer charges late replacements in full.
- With financing enabled, the headline IRR switches from project IRR to equity IRR, while project NPV remains unlevered.

IRR is reported only when a single economically meaningful root exists:

```text
cf_0 >= 0                                   -> n/a (no net investment)
one sign change (conventional)              -> the unique root
several sign changes, sum(cf) >= 0          -> the single root >= 0, else "ambiguous (see MIRR)"
several sign changes, sum(cf) <  0          -> n/a: any root is an artefact of late outflows

mirr = (sum max(cf_y, 0) * (1 + r)^(n - y) / -sum min(cf_y, 0) / (1 + r)^y)^(1/n) - 1
```

MIRR (finance and reinvest at the discount rate `r`) is always shown next to
IRR; it is unique and exceeds `r` exactly when NPV is positive. The inline
optimizers maximize IRR, and rank the whole sweep by MIRR instead whenever
IRR is undefined for any value in the range (by NPV if MIRR is undefined too).

### Environmental outputs

```text
co2_captured_tpy = annual_co2_captured_kg / 1000
co2_bound_tpy    = co2 converted into methane, methanol and exploratory products
co2_vented_tpy   = co2_captured_tpy - co2_bound_tpy          # unconverted feed

net_avoided_tpy  = annual_ch4_mcf * 0.0528                   # 19.25 kg CH4 x 44.01/16.04
                 + annual_meoh_t * 1.374                     # methanol carbon (export + MTG feed)

water_recycled_kgpd =
  ch4_daily_kg * 2.25 +
  meoh_daily_kg * 0.562

net_water_needed_kgpd =
  max(0, electrolyzer_water_kgpd - water_recycled_kgpd)
```

## Current Defaults In The App

The current default state is roughly a `1 MW` Mojave-style methane scenario:

- Site: Mojave Desert Earth preset
- Analysis cycle: `Annual Average`
- Annual base yield: `1974 MWh / MWdc / year` (PVGIS v5.3, fixed optimal tilt)
- Mounting: East-West fixed
- System size: `1 MW`
- Panel efficiency: `20%`
- Module cost: `$0.20/W`
- BOS cost: `$0.12/W`
- Panel degradation: `0.65%/yr`
- Battery: off by default (`0 MWh`), with `$150/kWh` storage cost and a `4 h` duration (power = capacity / 4 h) when enabled
- Chemical peak sizing: `100%`
- Electrolyzer: `79 kWh/kg H2`, `$100/kW`
- DAC: `3440 kWh/t-CO2`, `$450 per t-CO2/yr of capacity at 25% utilization` (applied to nameplate: `$450 x 8760 x 0.25 / 3440 = $286/kW` of DAC power)
- Sabatier conversion: `95%`
- Sabatier reactor CAPEX: `$50/kW CH4`
- Feed buffers: on by default for methane and methanol, and default on for exploratory modules whenever the selected route supports buffered gas-feed sizing
- Methane market preset: `Commodity gas / whitepaper-style case`
- Methane price: `$20/MCF`
- Methanol price: `$600/t`
- AI compute: off by default
- Financing: off by default
- Policy mode: `US 45V hydrogen PTC`
- Default 45V input: `$3.28/kg H2` (2026 inflation-adjusted top tier with prevailing wage; IRS Notice 2026-41)
- Solar O&M: `1.5%/yr`
- Process O&M: `3.0%/yr`
- Battery O&M: `1.5%/yr`
- Exploratory O&M: `4.0%/yr`
- Solar asset life: `30 years`
- Core process asset life defaults: `7 years`
- Analysis horizon: `30 years`
- Discount rate: `8%`

## Supported vs Exploratory Coverage

### Supported today

- Electrolyzer
- Direct air capture
- Methane / Sabatier
- Methanol

### Exploratory routes with rough economics

- MTG (`methanol -> gasoline-range hydrocarbons`)
- CO2 -> CO
- Ammonia
- Specialty Electrocarbon
- Lime
- Cement
- Steel
- Silicon
- Aluminum
- Titanium
- Desalination

These exploratory routes are no longer UI-only scaffolds. They now carry rough throughput, CAPEX, O&M, replacement, and revenue assumptions into project economics, but they should still be treated as high-level placeholders rather than validated process designs.

## Future Improvements

The most important next steps are:

- Replace fallback annual-yield heuristics with a stronger site-yield workflow or imported PV datasets.
- Add explicit hydrogen sales and dedicated hydrogen-first business cases.
- Deepen exploratory routes with better feedstock, logistics, thermal-balance, and intermittency assumptions.
- Improve variable OPEX and maintenance treatment for both supported and exploratory modules.
- Expand financing beyond simple amortizing debt into taxes, depreciation, inflation, and ownership structure.
- Make policy qualification logic more explicit and jurisdiction-aware.

## Running Locally

Use the npm scripts:

1. `npm run dev` to serve the source files locally with caching disabled.
2. `npm run build` to generate a versioned `dist/` folder for deployment.
3. `npm run preview` to serve the built `dist/` output locally.

Notes:

- Run `npm install` first: `Chart.js`, `Leaflet`, and `lz-string` are self-hosted from `node_modules/` in development and copied into `dist/` by the build.
- Earth satellite imagery depends on external map tiles.
- Manual annual yield input is still the best option if you want to use a site-specific PV benchmark.
- Vercel can deploy directly from `dist/`; the repo includes `vercel.json` so `npm run build` is used automatically.

## Tests

From the repo root, run:

```bash
node --test
```

The test suite covers calculations, planetary dispatch behavior, exploratory-route economics, optimizer behavior, and renderer formatting.

## Sources

This repo is based on public materials and should be read as an independent interpretation of those sources.

### Primary Terraform sources

- [Terraform Industries](https://terraformindustries.com/)
- [Terraform Industries Whitepaper 2.0](https://terraformindustries.wordpress.com/2023/01/09/terraform-industries-whitepaper-2-0/)
- [The Terraformer Mark One](https://terraformindustries.wordpress.com/2023/06/26/the-terraformer-mark-one/)
- [How to Produce Green Hydrogen for $1/kg](https://terraformindustries.wordpress.com/2023/08/16/how-to-produce-green-hydrogen-for-1-kg/)
- [Permitting Reform Or Death](https://terraformindustries.wordpress.com/2023/11/10/permitting-reform-or-death/)
- [Terraformer Environmental Calculus](https://terraformindustries.wordpress.com/2024/02/06/terraformer-environmental-calculus/)
- [Terraform makes carbon neutral natural gas](https://terraformindustries.wordpress.com/2024/04/01/terraform-makes-carbon-neutral-natural-gas/)
- [How Terraform Navigated The Idea Maze](https://terraformindustries.wordpress.com/2024/06/24/how-terraform-navigated-the-idea-maze/)
- [Terraform Industries Master Plan](https://terraformindustries.wordpress.com/2024/10/04/terraform-industries-master-plan/)
- [To Conquer the Primary Energy Consumption Layer of Our Entire Civilization](https://terraformindustries.wordpress.com/2025/04/03/to-conquer-the-primary-energy-consumption-layer-of-our-entire-civilization/)
- [The Future Of Solar Doesn't Track The Sun](https://terraformindustries.wordpress.com/2025/04/29/the-future-of-solar-doesnt-track-the-sun/)
- [The Core Pillars at Terraform Industries](https://terraformindustries.wordpress.com/2025/06/12/the-core-pillars-at-terraform-industries/)
- [Direct Current Data Centers](https://terraformindustries.wordpress.com/2026/01/30/direct-current-data-centers/) (2026-01-30)
- [Capturing Carbon I: The Base](https://terraformindustries.wordpress.com/2026/04/02/capturing-carbon-i-the-base/) (2026-04-02)
- [The enormous size of the oil and gas market drives adoption of synthetic fuel production](https://terraformindustries.wordpress.com/2026/06/16/the-enormous-size-of-the-oil-and-gas-market-drives-adoption-of-synthetic-fuel-production/) (2026-06-16)
- [Terraform 2026 Update](https://terraformindustries.wordpress.com/2026/10/21/terraform-2026-update/) (2026-10-21)
- [How Terraform built the cheapest solar in North America](https://terraformindustries.wordpress.com/2026/10/27/how-terraform-built-the-cheapest-solar-in-north-america/) (2026-10-27)

### Supporting references

- [Jurchen PEG FAQs](https://www.jurchen-technology.com/products/solar-mounting/peg/faq/)
- [Jurchen PEG Design](https://www.jurchen-technology.de/peg-design/)
- [26 CFR 1.45V-2](https://www.law.cornell.edu/cfr/text/26/1.45V-2)
- [Utility-Scale PV ATB 2025](https://atb.nlr.gov/electricity/2025/utility-scale_pv) (NREL, renamed National Laboratory of the Rockies in Dec 2025)
- [PVGIS](https://joint-research-centre.ec.europa.eu/pvgis-online-tool_en)
- [Global Solar Atlas](https://globalsolaratlas.info/)

### Incentive scheme references (retrieved 2026-10)

Each value in `js/data/policies.js` carries its own source comment; the main references are:

- US tax credits: IRC [§48E](https://www.law.cornell.edu/uscode/text/26/48E), [§45Y](https://www.law.cornell.edu/uscode/text/26/45Y), [§45V](https://www.law.cornell.edu/uscode/text/26/45V), [§45Q](https://www.law.cornell.edu/uscode/text/26/45Q) as amended by the One Big Beautiful Bill Act (P.L. 119-21)
- [IRS Notice 2026-47](https://www.irs.gov/irb/2026-41_IRB) (2026 §45Y amounts) and [IRS Notice 2026-41](https://www.irs.gov/irb/2026-29_IRB) (2026 §45V amounts)
- Notice 2025-42 vacatur: [KPMG, 2026-06](https://kpmg.com/us/en/taxnewsflash/news/2026/06/court-vacates-notice-2025-42-eliminated-safe-harbor-construction-wind-solar.html); appeal status: [Clifford Chance, 2026-09-04](https://www.cliffordchance.com/content/dam/cliffordchance/briefings/2026/09/IRS%20Notice%202025-42%20Appeal%20Deadline%20Nears.pdf)
- US hub status: [DOE retained list, Apr 2026 (reported)](https://decarbonfuse.com/posts/doe-restores-1-2b-for-dac-hubs-and-5-hydrogen-projects)
- EU Hydrogen Bank: [2nd auction (IEA)](https://www.iea.org/policies/27897-second-auction-of-european-hydrogen-bank-ehb), [3rd auction results](https://timharper.net/european-hydrogen-auction-explained-if25/)
- Germany: [Bundesnetzagentur PV tenders](https://www.bundesnetzagentur.de/1091186), [July 2026 round](https://www.bundesnetzagentur.de/1114090), [DGS solar market values 2025](https://www.dgs.de/wp-content/uploads/2026/01/DGS_Jahres-Monatsmarktwerte-Solar_2025.pdf), [auctions-as-a-service winners 2026-05-29](https://www.bundeswirtschaftsministerium.de/Redaktion/DE/Pressemitteilungen/2026/05/20260529-gewinner-auctions-as-a-service-fenster.html)
- Netherlands: [RVO SDE++](https://www.rvo.nl/subsidies-financiering/sde/orienteren), [RVO OWE](https://www.rvo.nl/subsidies-financiering/owe/waterstof-produceren)
- UK: [CfD AR7 results](https://www.gov.uk/government/publications/contracts-for-difference-cfd-allocation-round-7-results/contracts-for-difference-allocation-round-7-results-accessible-webpage), [Hydrogen allocation rounds](https://www.gov.uk/government/collections/hydrogen-allocation-rounds)
- FX: [ECB euro reference rates](https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html) (2026-10-29)

### Market benchmarks used for slider markers (retrieved 2026-10)

- Battery: [BNEF Energy Storage System Cost Survey 2025 (via Energy-Storage.news)](https://www.energy-storage.news/behind-the-numbers-bnef-finds-40-year-on-year-drop-in-bess-costs/): turnkey BESS $117/kWh global, $73 China, $177 Europe, $219 US
- Modules: OPIS via pv magazine, [FOB China TOPCon, 2026-07-31](https://www.pv-magazine.com/2026/07/31/chinese-topcon-module-prices-fall-as-high-efficiency-supply-adds-pressure/) and [DDP US TOPCon, 2026-03-06](https://www.pv-magazine.com/2026/03/06/china-topcon-module-prices-edge-higher-as-march-cargoes-clear/)
- Methanol: [CFR China spot, Oct 2026 (Procurement Resource)](https://www.procurementresource.com/news-and-articles/asian-methanol-jumps-64-percent), [Methanex posted contract prices](https://www.methanex.com/about-methanol/pricing/)

## License

This project is licensed under the MIT License. See `LICENSE`.

The code in this repository is MIT-licensed. Third-party names, trademarks, external datasets, and linked source materials remain under their own respective terms.
