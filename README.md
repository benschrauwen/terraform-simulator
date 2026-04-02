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
- Policy modes for `45V`, `45Q`, EU Hydrogen Bank style premiums, and custom H2 / CO2 credits, plus methane market presets for commodity, premium, and country-context cases.
- NPV, project IRR, optional equity IRR with debt financing, ROI, payback, replacement-aware discounted cash flow outputs, and price sensitivity charts.
- Daily power, annual dispatch, economics, sensitivity, environmental, and site-footprint views.
- Inline IRR optimizers for battery capacity, chemical peak sizing, and methane-vs-methanol feedstock split.

The app is still a mostly static front-end project, with a lightweight Node build that generates versioned `dist/` assets for deployment. The source is split into clearer modules:

- `index.html`: app layout and control surfaces
- `style.css`: visual styling
- `js/app.js`: app bootstrap, high-level coordination, and dynamic module rendering
- `js/app-controls.js`: UI event binding and control behavior
- `js/app-ui-state.js`: dynamic UI visibility, policy/market sync, planetary-mode UI sync, and derived control state
- `js/app-charts.js`: power, dispatch, economics, and sensitivity charts
- `js/app-renderers.js`: production, economics, and environmental result rendering
- `js/app-site-map.js`: site-footprint map overlay and module footprint display
- `js/app-optimizer.js` + `js/optimizer-worker.js`: worker-backed IRR search for inline optimize buttons
- `js/asset-paths.js`: shared asset URL helper for clean local paths and versioned deployment output
- `js/calculation-runtime-paths.js`: script loading order for the optimizer worker runtime
- `js/reference-data.js`: presets, chemistry constants, policy presets, market presets, and shared assumptions
- `js/module-registry.js` + `js/exploratory-routes.js`: supported/exploratory module metadata and route assumptions
- `js/state-schema.js`: shared defaults, normalization, and dependency rules
- `js/slider-markers.js`: slider guide markers and benchmark labels
- `js/solar-geometry.js`: Earth, Mars, and Moon solar-profile shaping
- `js/diagram.js`: process diagram rendering
- `js/format-numbers.js`: shared numeric formatting helpers
- `js/calculations/`: split calculation modules for finance, solar, battery, AI dispatch, process, and economics logic
- `scripts/build.mjs` + `scripts/dev.mjs`: minimal build and static-serving scripts for local development and deployment output
- `tests/`: Node-based regression tests for calculations and renderer output

## What Is Modeled Well Enough Today

These are the parts of the app that are currently structured well enough to be useful for scenario exploration:

- Yield-driven annual solar production with mounting-specific yield and land-use effects layered on top of a base site yield.
- Earth annual-average and specific-day views, plus Mars and Moon annual-dispatch paths based on representative local-cycle assumptions.
- A methane and methanol product system with shared H2 and CO2 allocation, explicit conversion assumptions, and export accounting.
- Optional MTG diversion of methanol into a downstream hydrocarbon product rather than treating all methanol as exported sale volume.
- Optional AI compute economics: constant IT load sizing, token throughput and price assumptions, GPU CAPEX, AI O&M, and revenue integrated into project economics.
- Distinct CAPEX buckets for solar modules, BOS, land, site prep, battery, core process modules, exploratory route blocks, and AI IT when enabled.
- Separate asset lives, replacement CAPEX events, panel degradation, and policy-duration limits inside the discounted cash flow.
- Optional debt financing that switches the headline IRR from unlevered project IRR to sponsor-style equity IRR while keeping project NPV unlevered.
- Exploratory route economics driven by route-specific electricity intensity, required feedstocks, cycling penalties, peak-throughput sizing, CAPEX basis, O&M, and sale-price assumptions.
- A lean IRR calculation path plus worker-backed search used by the inline optimization controls.

## What Is Still Simplified Or Missing

The simulator is useful, but it still has important limitations:

- Earth fallback solar yield still relies on a latitude and GHI heuristic when the user is not using a preset or manual annual yield.
- Hydrogen-only sales are not yet modeled as a revenue line.
- DAC-only and hydrogen-only operating modes are still stylized fallback cases rather than dedicated product modes.
- Exploratory routes are rough techno-economic placeholders, not full first-principles process designs with validated thermal, logistics, startup, or quality constraints.
- O&M is still represented as simple percentages of CAPEX rather than a detailed fixed-plus-variable cost model.
- Financing is limited to a simple upfront debt share, fee, and amortizing annual debt service. Taxes, depreciation, inflation, salvage value, working capital, tax equity, and ownership structure are not modeled.
- Policy eligibility is not legally validated against full lifecycle, jurisdictional, or contractual requirements.
- The battery model is a simplified firming heuristic, not a full storage engineering model or year-round plant-control system.
- AI compute is a stylized constant-load and token-pricing layer, not a GPU, network, or datacenter engineering model.
- Planetary modes are exploratory and use literature-inspired benchmarks rather than bankable resource datasets.

## Key Assumptions

The current implementation makes several deliberate assumptions that should stay visible:

- Annual economics are driven by `siteYieldMwhPerMwdcYear`; the day selector mainly changes charting and Earth day-level visualization, not the annual non-AI economics.
- `siteYieldMwhPerMwdcYear` is treated as a base annual yield. Mounting effects are applied on top of that base yield rather than asking the user for a fully mounting-adjusted number.
- With AI compute enabled, the model builds an annual dispatch path and serves AI first; the chemical plant and battery charging use residual solar after the AI load.
- `chemicalSizingPercent` scales the full-capture chemical peak and allows intentional clipping of the highest-solar hours.
- Feed buffers, when enabled, are treated as part of the process block and are not costed or modeled as standalone storage assets.
- Supported products and exploratory routes share H2, CO2, methanol, and power through an auto-balanced weighted allocation rather than a user-entered process-flow sheet.
- Panel efficiency affects panel area and land use, not annual energy yield, because the model is framed around fixed MWdc nameplate.
- Stored energy always loses a fixed `2%/month` through standing leakage.
- Solar-linked revenue degrades with panel degradation over time, including AI token revenue and exploratory-route revenue.
- Policy presets are non-stacked by default except in `Custom` mode, and time-limited support ends after the modeled support duration.
- Default methane volume conversion assumes `19.25 kg CH4 / MCF`.
- Default fossil gas displacement uses `0.053 tCO2 / MCF`.
- Default low-capex Terraform-style process presets are approximate, not universal truths.

## Core Formula Summary

The formulas below are the current conceptual backbone of the app.

### Solar

```text
base_yield_mwh_per_mwdc_year =
  manual_or_preset_or_estimated_yield

site_yield_mwh_per_mwdc_year =
  base_yield_mwh_per_mwdc_year * mounting_yield_multiplier

annual_solar_mwh = solar_mwdc * site_yield_mwh_per_mwdc_year

daily_solar_kwh_avg = annual_solar_mwh * 1000 / cycles_per_year

capacity_factor = annual_solar_mwh / (solar_mwdc * 8760)

panel_area_m2 = solar_mwdc * 1e6 / (module_efficiency * 1000)

site_area_m2 = panel_area_m2 / ground_coverage_ratio
```

For Earth sites, the fallback base-yield estimate is still:

```text
estimated_base_yield_mwh_per_mwdc_year = ghi * 0.82
```

That fallback is intentionally treated as a heuristic, not a project-grade solar dataset.

### Chemical sizing and allocation

The app first determines a full-capture peak, then optionally undersizes the chemical plant:

```text
chemical_peak_kw = full_capture_peak_kw * chemical_sizing_fraction
```

Power and feed shares are then auto-balanced from the enabled downstream routes:

```text
electrolyzer_share = h2_power_demand / total_power_demand

dac_share = co2_power_demand / total_power_demand

exploratory_share_i =
  exploratory_pool_share * priority_weight_i / sum(priority_weights)
```

That is a conceptual summary. In the code, the demand proxy also depends on each route's electricity intensity and required feedstocks.

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
```

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

### Finance

The app uses capital recovery factor annualization plus a discounted cash flow path with explicit replacement years.

```text
crf(r, n) = r * (1 + r)^n / ((1 + r)^n - 1)

annualized_capex_i = capex_i * crf(discount_rate, asset_life_i)

annual_cost = sum(annualized_capex_i) + annual_om

net_cash_flow_y =
  yearly_revenue_y -
  annual_om -
  replacement_capex_y

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

- Solar-linked revenue degrades with panel degradation over time, including AI token revenue and exploratory-route revenue.
- Time-limited policy modes only apply for their modeled support duration.
- Replacement CAPEX appears as discrete outflows when asset life rolls over within the analysis horizon.
- With financing enabled, the headline IRR switches from project IRR to equity IRR, while project NPV remains unlevered.

### Environmental outputs

```text
co2_captured_tpy = annual_co2_captured_kg / 1000

co2_displaced_tpy = annual_ch4_mcf * 0.053

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
- Annual base yield: `2050 MWh / MWdc / year`
- Mounting: East-West fixed
- System size: `1 MW`
- Panel efficiency: `20%`
- Module cost: `$0.20/W`
- BOS cost: `$0.12/W`
- Panel degradation: `0.65%/yr`
- Battery: off by default (`0 MWh`), with `$150/kWh` storage cost when enabled
- Chemical peak sizing: `100%`
- Electrolyzer: `79 kWh/kg H2`, `$100/kW`
- DAC: `3440 kWh/t-CO2`, `$450/kW`
- Sabatier conversion: `99%`
- Feed buffers: on by default for methane and methanol, and default on for exploratory modules whenever the selected route supports buffered gas-feed sizing
- Methane market preset: `Commodity gas / whitepaper-style case`
- Methane price: `$20/MCF`
- Methanol price: `$600/t`
- AI compute: off by default
- Financing: off by default
- Policy mode: `45V Tier 4`
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

- The app depends on CDN-hosted `Chart.js` and `Leaflet`.
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

### Supporting references

- [Jurchen PEG FAQs](https://www.jurchen-technology.com/products/solar-mounting/peg/faq/)
- [Jurchen PEG Design](https://www.jurchen-technology.de/peg-design/)
- [26 CFR 1.45V-2](https://www.law.cornell.edu/cfr/text/26/1.45V-2)
- [NREL Utility-Scale PV ATB](https://atb.nrel.gov/electricity/2023/2023/utility-scale_pv)
- [PVGIS](https://joint-research-centre.ec.europa.eu/pvgis-online-tool_en)
- [Global Solar Atlas](https://globalsolaratlas.info/)

## License

This project is licensed under the MIT License. See `LICENSE`.

The code in this repository is MIT-licensed. Third-party names, trademarks, external datasets, and linked source materials remain under their own respective terms.
