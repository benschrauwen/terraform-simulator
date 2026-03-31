# Solar Chemical/AI Plant Builder

An unofficial, MIT-licensed browser app for exploring a Terraform Industries-style solar-to-chemical plant. The current simulator is best understood as an educational techno-economic model for a direct-coupled solar + electrolysis + DAC + methane/methanol system, with an optional colocated **AI compute** load that competes for the same solar and battery resources. It is not a bankable engineering model.

The app is intentionally centered on the idea that very cheap local solar DC, low-capex intermittent hardware, and colocated conversion can matter more than chasing maximum utilization or maximum electrical efficiency.

## Current State

The app is already a real working prototype, not just a UI mockup. Today it supports:

- Annual-yield-driven solar modeling with preset sites and manual `MWh / MWdc / year` input.
- Solar mounting comparisons across fixed tilt, East-West fixed, single-axis tracking, and dual-axis tracking.
- Earth, Mars, and Moon resource presets, with planetary modes clearly treated as stylized scenarios.
- A direct-coupled feed allocation model that auto-balances electrolyzer and DAC power shares from active downstream stoichiometry (chemistry runs on **residual** power after AI when AI compute is enabled).
- Fully modeled methane and methanol product paths, including mass balance, CAPEX, revenue, and finance outputs.
- Policy modes for `45V`, `45Q`, EU Hydrogen Bank style premiums, and custom credits.
- NPV, IRR, ROI, payback, annualized CAPEX, and replacement-aware discounted cash flow outputs.
- Battery firming as a comparison feature that solves for the highest continuous chemical-plant power the solar + storage pair can sustain while absorbing the modeled solar energy, with a fixed **2%/month** standing energy loss on stored energy.
- Optional **on-site AI datacenter** mode: a reliability-targeted constant IT load auto-sized from annual solar (+ optional battery), with token-based revenue, GPU CAPEX ($/kW IT), throughput (million tokens per MWh), and economics integrated into NPV and sensitivity analysis.
- **Chemical** vs **AI Compute** tabs under Processes to configure chemical modules separately from AI settings.
- Charts for daily power (solar, optional battery charge, chemical or residual chemical load, and AI when enabled) plus an **Annual Dispatch** view of daily AI vs chemical energy over the modeled year (Earth uses a full-year hourly solar shape scaled to your annual yield).
- Environmental outputs such as CO2 captured, CO2 displaced, water recycled, net water needed, and land use.
- Exploratory industrial modules that are visible in the UI but intentionally excluded from ROI until route-specific assumptions are added.

The app is still a static front-end project with no build step. The main files are:

- `index.html`: app layout and controls
- `style.css`: visual styling
- `js/app.js`: UI state, charts (power, annual dispatch, sensitivity vs methane or token price), map rendering, and panel updates
- `js/calculations.js`: solar, annual series, battery firming, AI dispatch, process, economics, policy, and environmental calculations
- `js/constants.js`: presets, chemistry constants, policy presets, and module registry
- `js/solar-geometry.js`: daily and planetary solar-profile shaping
- `js/diagram.js`: process diagram rendering

## What Is Modeled Well Enough Today

These are the parts of the app that are currently modeled with enough internal structure to be useful for scenario exploration:

- A methane-first plant architecture: solar -> electrolyzer -> DAC -> Sabatier methane (with optional **AI datacenter** on the same solar and battery when enabled)
- Methanol as a second modeled product family
- Yield-driven annual solar production rather than pure latitude-based annual output
- Optional **AI compute** economics: constant IT load sized to hit a chosen annual **delivered utilization** target against full-year hourly solar, plus token price and throughput, GPU CAPEX, fixed AI O&M, revenue in NPV, and sensitivity on token price when AI mode is on
- Distinct CAPEX buckets for solar modules, BOS, land, site prep, battery, electrolyzer, DAC, reactors, and (when enabled) AI IT
- Separate asset lives for solar, battery, and process hardware
- Replacement CAPEX events inside the discounted cash flow horizon
- Policy duration limits for support mechanisms like `45V` and EU Hydrogen Bank style premiums
- Clear separation between supported modules and exploratory modules

## What Is Still Simplified Or Missing

The simulator is useful, but it still has important limitations:

- Earth fallback solar yield still relies on a latitude/GHI heuristic when the user is not using a preset or manual annual yield.
- Hydrogen-only sales are not yet modeled as a revenue line.
- DAC-only and hydrogen-only operating modes are still stylized fallback cases rather than dedicated product modes.
- Exploratory modules do not yet have route-specific mass balance, CAPEX, replacement, or OPEX logic.
- O&M is still represented as simple percentages of CAPEX rather than a detailed fixed-and-variable cost model.
- Debt, taxes, inflation, salvage value, working capital, and ownership structure are not modeled.
- Policy eligibility is not legally validated against full lifecycle, jurisdictional, or contractual requirements.
- The battery model is a simplified continuous-output firming heuristic, not a full storage engineering model or year-round governor.
- **AI compute** is a stylized constant-load and token-pricing layer, not a GPU/network/datacenter engineering model; “integrated” $/M token metrics allocate solar + battery + AI capital to tokens for intuition, not as a contractual PPA structure.
- Planetary modes are exploratory and use literature-inspired benchmarks rather than bankable resource datasets.

## Key Assumptions

The current implementation makes several deliberate assumptions that should stay visible:

- Annual economics are driven by `siteYieldMwhPerMwdcYear`; the daily solar profile is mainly used for shaping charts and dispatch.
- With **AI compute** enabled, the model builds a **full-year hourly solar series** (Earth: day-by-day geometry scaled to annual yield) and dispatches **AI first**; the chemical plant and battery charging use **residual** solar after the AI load, with the same **2%/month** storage leakage as the battery-only path.
- Panel efficiency affects panel area and land use, not annual energy yield, because the model is framed around fixed MWdc nameplate.
- Default methane volume conversion assumes `19.25 kg CH4 / MCF`.
- Default fossil gas displacement uses `0.053 tCO2 / MCF`.
- Default low-capex Terraform-style process presets are approximate, not universal truths.
- Exploratory modules are shown to represent architecture coverage, not validated economics.
- Policy presets are non-stacked by default except in `Custom` mode.
- The default state approximates a `1 MW` Mojave-style methane case, but there is not yet a dedicated `Mark One` preset object.

## Core Formula Summary

The formulas below are the current conceptual backbone of the app.

### Solar

```text
annual_solar_mwh = solar_mwdc * site_yield_mwh_per_mwdc_year

daily_solar_kwh_avg = annual_solar_mwh * 1000 / cycles_per_year

capacity_factor = annual_solar_mwh / (solar_mwdc * 8760)

panel_area_m2 = solar_mwdc * 1e6 / (module_efficiency * 1000)

site_area_m2 = panel_area_m2 / packing_factor
```

For Earth sites, the model can still fall back to:

```text
base_yield_mwh_per_mwdc_year = ghi * 0.82
```

That fallback is intentionally treated as a heuristic, not a project-grade solar dataset.

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
meoh_kg = min(h2_kg / 0.189, co2_kg / 1.374) * methanol_conversion
```

### AI compute (optional)

When enabled, a constant `load_kw` is chosen so simulated **delivered utilization** (energy served to the AI load divided by demand) meets the selected reliability target. Tokens and revenue follow throughput and price inputs:

```text
annual_tokens_m = ai_served_mwh * million_tokens_per_mwh

annual_ai_revenue = annual_tokens_m * price_per_million_tokens
```

GPU CAPEX uses `$ / kW` of installed IT load at the solved `load_kw`. The UI also reports **full-rate reliability** (hours at full AI power), **integrated $/M token** (solar + battery + AI annualized cost divided by tokens), and **token margin** vs the token price.

### Finance

The app uses capital recovery factor annualization plus a separate discounted cash flow path with explicit replacement years.

```text
crf(r, n) = r * (1 + r)^n / ((1 + r)^n - 1)

annualized_capex_i = capex_i * crf(discount_rate, asset_life_i)

annual_cost = sum(annualized_capex_i) + annual_om

yearly_net_cash_flow_y =
  yearly_revenue_y -
  annual_om -
  replacement_capex_y

npv =
  -initial_capex +
  sum(yearly_net_cash_flow_y / (1 + discount_rate)^y)
```

Important implementation detail:

- Solar-linked revenue degrades with panel degradation over time (including **AI token revenue** when AI compute is enabled).
- Time-limited policy modes only apply for their modeled support duration.
- Replacement CAPEX appears as discrete outflows when asset life rolls over within the analysis horizon.

### Environmental Outputs

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

- Site: Mojave Desert style Earth preset
- Annual yield: `2050 MWh / MWdc / year`
- Mounting: East-West fixed
- Panel efficiency: `20%`
- Module cost: `$0.20/W`
- BOS cost: `$0.12/W`
- Panel degradation: `0.65%/yr`
- Electrolyzer: `79 kWh/kg H2`, `$100/kW`
- DAC: `3440 kWh/t-CO2`, `$600/t-yr`
- Sabatier conversion: `99%`
- Methane price: `$20/MCF`
- Methanol price: `$600/t`
- Policy mode: `45V Tier 4`
- Solar asset life: `30 years`
- Process asset life defaults: `7 years`
- Analysis horizon: `30 years`
- Discount rate: `8%`

## Supported vs Exploratory Coverage

### Supported today

- Electrolyzer
- Direct air capture
- Methane / Sabatier
- Methanol

### Exploratory scaffolds in the UI

- CO2 -> CO
- Ammonia
- Coke / graphite / graphene
- Cement / lime
- Steel
- Silicon
- Aluminum
- Titanium
- Desalination

These exploratory modules are intentionally excluded from ROI and NPV until route-specific assumptions are added.

## Future Improvements

The most important next steps are:

- Replace fallback annual-yield heuristics with imported PV datasets or a proper site-yield workflow.
- Extend exploratory modules with route-specific mass balance, CAPEX, OPEX, and replacement logic.
- Improve variable OPEX and maintenance treatment for supported modules.
- Make policy qualification logic more explicit and jurisdiction-aware.
- Add automated regression coverage for finance, policy duration, replacement timing, and dispatch-sensitive sizing.

## Running Locally

There is no build step.

You can either:

1. Open `index.html` directly in a browser.
2. Serve the folder locally, for example with `python3 -m http.server`.

Notes:

- The app depends on CDN-hosted `Chart.js` and `Leaflet`.
- Earth satellite imagery depends on external map tiles.
- Manual annual yield input is the best option today if you want to use a site-specific PV benchmark.

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
