# Terraform-Style Solar-to-Chemical Simulator

## Purpose

This project is a one-page educational simulator for the economics of a Terraform Industries-style solar-to-chemical plant. The current UI already exposes many of the right concepts, but the calculation model is still a partial prototype. This document defines what the simulator should model, which formulas it should use, which constants are reasonably supported by Terraform's public materials, and which assumptions still need explicit user input before the output should be treated as decision-grade.

This document is based on:

- [Terraform Industries main site](https://terraformindustries.com/)
- [The Terraformer Mark One](https://terraformindustries.wordpress.com/2023/06/26/the-terraformer-mark-one/)
- [Terraformer Environmental Calculus](https://terraformindustries.wordpress.com/2024/02/06/terraformer-environmental-calculus/)
- [To Conquer the Primary Energy Consumption Layer of Our Entire Civilization](https://terraformindustries.wordpress.com/2025/04/03/to-conquer-the-primary-energy-consumption-layer-of-our-entire-civilization/)
- [The Future Of Solar Doesn't Track The Sun](https://terraformindustries.wordpress.com/2025/04/29/the-future-of-solar-doesnt-track-the-sun/)
- [The Core Pillars at Terraform Industries](https://terraformindustries.wordpress.com/2025/06/12/the-core-pillars-at-terraform-industries/)
- [Terraform makes carbon neutral natural gas](https://terraformindustries.wordpress.com/2024/04/01/terraform-makes-carbon-neutral-natural-gas/)
- [Terraform Industries Master Plan](https://terraformindustries.wordpress.com/2024/10/04/terraform-industries-master-plan/)
- [How Terraform Navigated The Idea Maze](https://terraformindustries.wordpress.com/2024/06/24/how-terraform-navigated-the-idea-maze/)
- [Terraform Industries Whitepaper 2.0](https://terraformindustries.wordpress.com/2023/01/09/terraform-industries-whitepaper-2-0/)
- [Permitting Reform Or Death](https://terraformindustries.wordpress.com/2023/11/10/permitting-reform-or-death/)
- [How to Produce Green Hydrogen for $1/kg](https://terraformindustries.wordpress.com/2023/08/16/how-to-produce-green-hydrogen-for-1-kg/)
- [PEG FAQs](https://www.jurchen-technology.com/products/solar-mounting/peg/faq/)
- [PEG Design](https://www.jurchen-technology.de/peg-design/)
- [26 CFR § 1.45V-2](https://www.law.cornell.edu/cfr/text/26/1.45V-2)
- [NREL Utility-Scale PV ATB](https://atb.nrel.gov/electricity/2023/2023/utility-scale_pv)

## What Terraform Publicly Describes

Terraform's published core architecture is not "generic renewable fuels." It is a very specific design philosophy:

- Use the cheapest possible local solar DC.
- Delete inverters, transmission, H2 transport, CO2 transport, and other balance-of-system costs wherever possible.
- Run integrated subsystems locally: solar + electrolyzer + DAC + reactor.
- Optimize for capital efficiency and manufacturability, not maximum electrical efficiency.
- Accept intermittent operation if that reduces capex enough.
- Start with methane (`CH4`) as the primary product.
- Treat methanol as the next major liquid-fuel / chemical platform.
- Consider ammonia and broader downstream chemistry as future scope, not the main first-order simulator.

That means the simulator should primarily model a direct-coupled methane plant first, and only then branch into optional product variants.

## Additional Material Found After Initial Review

A broader sweep of Terraform and supporting sources closed a few important gaps:

- `The Terraformer Mark One` materially improves the basis for the simulator's core unit. It describes one Terraformer paired with a standard `1 MW` solar array, producing `1000 cf/h`, optimized for `25%` utilization, `6000 cf/day`, `2190 h/yr`, and `>2 million cf/yr`, with a public revenue framing of `$10/Mcf` plus `$54/Mcf` in IRA PTCs.
- `To Conquer the Primary Energy Consumption Layer of Our Entire Civilization` expands the public product roadmap well beyond methane and methanol. It explicitly lists hydrogen, methane, methanol, coke/graphite/graphene, ammonia, cement, steel, non-ferrous metals, desalination, and exotics as candidate solar-adapted primary production loads.
- The same post also publishes stylized overall-reaction bases for several future product lines. These are not enough for bankable plant economics, but they are enough to justify a generalized module architecture.
- `Terraformer Environmental Calculus` improves environmental side assumptions, especially on land productivity, water use, and the broader climate/land-use rationale.
- The Jurchen PEG material provides useful external support for East-West structure assumptions such as `8°` tilt, `~95-98%` GCR, `~450 working hours/MWp`, and a vendor claim of `225%` higher land yield versus trackers / conventional fixed-tilt systems.
- `26 CFR § 1.45V-2` confirms that `45V` and `45Q` should not be stacked by default for the same carbon capture equipment.
- NREL ATB provides a better external benchmark for utility-scale PV CAPEX, O&M, capacity factor bins, AC/DC conventions, and the typical one-axis tracking baseline.

These additions do not eliminate the need for user choices, but they do make the next version of the model much better specified.

## Current Implementation Review

The current app now has a coherent first-pass architecture rather than only a loose UI shell:

- `index.html` exposes site yield, mounting, battery, core process, supported product, exploratory module, methane market, and policy inputs.
- `js/solar-geometry.js` supplies daily profile shapes and astronomical context for charts.
- `js/constants.js` holds stoichiometry, market presets, policy presets, planetary/site presets, and the module registry.
- `js/calculations.js` separates solar, battery dispatch, auto-balanced feed allocation, supported-product mass balance, finance, and environmental outputs.
- `js/app.js` renders supported versus exploratory modules distinctly and surfaces policy and finance assumptions in the economics panel.

However, several important parts are still heuristic or incomplete:

### 1. Solar resource is yield-driven, but still not project-grade

The implementation is materially better than the earliest prototype:

- Annual economics are now driven primarily by `siteYieldMwhPerMwdcYear`.
- Presets and manual site-yield input work today.
- `js/solar-geometry.js` mainly shapes the daily profile rather than directly determining annual MWh.

Main remaining issues:

- Earth fallback yield still comes from a latitude/GHI heuristic when the user is not on a preset or explicit manual yield.
- Mounting effects are still encoded as heuristic yield multipliers plus simple cloudiness/latitude adjustments.
- `panelEfficiency` affects land area, not annual yield. That is acceptable for a fixed-MWdc framing, but the model should stay explicit that energy is yield-driven rather than module-efficiency-driven.

### 2. Product architecture is only partly de-symmetrized

The app no longer treats every downstream pathway as equally mature:

- Methane and methanol are the only supported product families with active mass-balance and economics.
- Exploratory modules now exist in the shared module registry with route choices and missing-input gating.
- Exploratory modules are explicitly excluded from ROI and NPV rather than being given fake precision.

Main remaining issues:

- Hydrogen-only sales are not modeled as a revenue line yet.
- Exploratory modules still lack route-specific mass balance, CAPEX, and replacement models.
- The UI still exposes many roadmap modules in one surface, so the simulator can look broader than the economically modeled core actually is.

### 3. Power allocation is now auto-derived, not manually tuned

The current model auto-balances electrolyzer versus DAC power split from stoichiometry and process electricity intensity for the active methane/methanol mix. That is much closer to Terraform's direct-coupled plant logic than arbitrary sliders.

Main remaining issue:

- If no downstream methane or methanol product is enabled, the allocation fallback is still stylized rather than tied to an explicit hydrogen-only or DAC-only operating mode.

### 4. Economics are materially stronger, but still simplified

Several earlier placeholders are now implemented:

- Solar, battery, electrolyzer, DAC, Sabatier, and methanol all have separate asset-life inputs.
- Core process CAPEX scales with design basis (`$/kW`, `$/t-yr`, or `$/kg/h feed`) instead of only fixed lump sums.
- Named policy modes are non-stacked by default, `45V` and EU Hydrogen Bank support are duration-limited, and `45Q` now depends on CO2 disposition.
- NPV, IRR, ROI, and payback now include discrete replacement CAPEX inside the analysis horizon.

Main remaining issues:

- There is still no debt, tax, inflation, salvage value, or working-capital model.
- O&M is still represented by simple percentage-of-CAPEX assumptions rather than route-specific fixed and variable costs.
- Policy qualification is not validated against lifecycle analysis, ownership structure, or jurisdiction-specific legal tests.

### 5. Battery modeling is still a comparison feature, not the core thesis

The battery model is more internally consistent than before:

- It smooths clipped daytime energy into night hours.
- It applies round-trip efficiency more symmetrically.
- Reactor sizing now follows the battery-shaped process peak rather than raw solar nameplate.

Even so, Terraform's core thesis still points first to sun-following process hardware, not to battery-heavy smoothing. The battery model remains a stylized comparison case rather than a full storage engineering model.

## Recommended Scope

## Tier 1: Supported scope today

These have enough public Terraform detail to remain the primary supported scope of the current app:

- Direct-coupled solar -> electrolyzer -> H2
- Direct-coupled solar -> DAC -> CO2
- Direct-coupled integrated methane plant:
  - solar
  - electrolyzer
  - DAC
  - Sabatier reactor
- Methanol as a second product mode
- Solar mounting comparison: East-West vs single-axis tracker vs fixed tilt
- Commodity methane vs green methane premium revenue cases
- Explicit policy modes for `45V` / `45Q` / no-credit scenarios

## Tier 2: Exploratory modules already scaffolded

These are publicly signaled by Terraform and already appear in the module architecture, but they do not yet have enough detailed public economics to be treated as well-supported:

- Carbon monoxide / CO2-to-CO conversion
- Ammonia
- Coke / graphite / graphene
- Cement
- Steel
- Silicon
- Aluminum
- Titanium
- Generic mineral inputs
- Desalination

These should be added only if the app architecture supports:

- module-specific feedstocks
- module-specific power intensity
- module-specific capex scaling
- confidence labels such as `Supported`, `Exploratory`, and `Concept`

## Tier 3: Still deferred unless more data is added

- Fischer-Tropsch
- Factory-of-factories economics
- Detailed insurance / hail / wildfire / permitting finance model
- Full mining / quarry / raw material logistics
- Secret / exotic projects

## Recommended Model Structure

The simulator should be structured as five layers:

1. Solar resource and array geometry
2. Hourly power availability / curtailment
3. Process mass and energy balance
4. Capital and operating cost model
5. Revenue, incentives, and finance

For expansion beyond methane, the simulator should not hard-code each product family as bespoke UI and logic. It should instead move toward a `module registry` architecture in which each product vertical plugs into the same shared plant framework.

Recommended module definition shape:

```text
module = {
  id,
  label,
  family,
  maturity,
  upstream_feeds,
  products,
  byproducts,
  reaction_basis,
  electricity_intensity,
  thermal_intensity,
  capex_model,
  utilization_class,
  price_unit,
  references
}
```

Recommended maturity classes:

- `Supported`: enough public assumptions for meaningful economics
- `Exploratory`: enough public rationale to include, but economics still rough
- `Concept`: roadmap item only; no serious economics yet

## 1. Solar Resource and Array Model

The most important change is to stop estimating annual output from latitude alone.

Recommended core input:

- `site_yield_mwh_per_mwdc_year`

This should be either:

- selected from presets, or
- entered directly by the user, or
- derived from a proper dataset later

Using annual yield directly is much cleaner than pretending the simulator can infer bankable production from latitude and a simple GHI curve.

### Core solar formulas

```text
annual_solar_mwh = solar_mwdc * site_yield_mwh_per_mwdc_year

daily_solar_kwh_avg = annual_solar_mwh * 1000 / 365

capacity_factor = annual_solar_mwh / (solar_mwdc * 8760)
```

If an hourly shape is needed:

```text
hourly_solar_kwh[h] = daily_solar_kwh_selected_day * normalized_profile[h]
```

The `normalized_profile` can still come from `js/solar-geometry.js`, but annual economics should be based on annual yield, not on the displayed daily shape.

### Mounting model

Terraform's solar article argues:

- East-West arrays are often cheaper overall despite lower energy per panel.
- Single-axis trackers improve yield but add BOS, labor, land, and hail-survival complexity.
- Relative performance is location- and weather-dependent.

So the simulator should separate:

- energy yield effect
- land packing effect
- BOS / structure cost effect
- weather-risk / hail-risk effect

Recommended implementation:

```text
site_yield_mwh_per_mwdc_year = base_yield_for_location * mounting_yield_multiplier(location, mounting)

site_area_m2 = panel_area_m2 / packing_factor(mounting)
```

Where:

```text
panel_area_m2 = solar_mwdc * 1e6 / (module_efficiency * 1000 W/m2)
```

Important: module efficiency should affect panel area and land use, but not annual MWh from a fixed MWdc nameplate unless the simulator is modeling land-constrained buildout.

## 2. Process Mass and Energy Balance

This should be the heart of the app.

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

Publicly relevant values from Terraform materials:

- theoretical minimum: `39.4 kWh/kg H2`
- legacy efficient electrolysis: about `50 kWh/kg H2`
- Terraform-style low-capex approach: about `79-80 kWh/kg H2`

### DAC

Terraform publicly describes calcium looping with very low capex and high willingness to spend cheap electricity.

Core formula:

```text
co2_tons = dac_input_kwh / dac_kwh_per_tco2
co2_kg = co2_tons * 1000
```

Publicly relevant value:

- `3.44 MWh/t-CO2` = `3440 kWh/t-CO2`

### Sabatier methane synthesis

Reaction:

```text
CO2 + 4 H2 -> CH4 + 2 H2O
```

Stoichiometric mass constants already used in the code and consistent with chemistry:

```text
h2_per_kg_ch4 = 0.503 kg H2 / kg CH4
co2_per_kg_ch4 = 2.744 kg CO2 / kg CH4
```

Core formulas:

```text
ch4_kg_from_h2 = h2_kg / 0.503
ch4_kg_from_co2 = co2_kg / 2.744

ch4_kg = min(ch4_kg_from_h2, ch4_kg_from_co2) * sabatier_conversion
```

Volume conversion:

```text
ch4_mcf = ch4_kg / kg_per_mcf
```

Note: the simulator must standardize exactly what `MCF` means. `kg_per_mcf` depends on the temperature / pressure standard. The current `19.25 kg / MCF` is plausible but should be explicitly documented and not hidden.

### Methanol synthesis

Reaction:

```text
CO2 + 3 H2 -> CH3OH + H2O
```

Stoichiometric mass constants:

```text
h2_per_kg_meoh = 0.189 kg H2 / kg methanol
co2_per_kg_meoh = 1.374 kg CO2 / kg methanol
water_per_kg_meoh = 0.562 kg H2O / kg methanol
```

Core formula:

```text
meoh_kg = min(h2_kg / 0.189, co2_kg / 1.374) * methanol_conversion
```

### Future module families explicitly signaled by Terraform

The most important expansion beyond methane/methanol comes from Terraform's public `Primary Energy Consumption Layer` post and the corresponding careers list. These modules should be designed into the simulator architecture even if they are not all fully implemented in the first build.

The reactions below are best interpreted as high-level process bases, not full plant chemistry:

| Module family | Public overall basis | Common feeds | Public support quality | Recommended simulator status |
| --- | --- | --- | --- | --- |
| Hydrogen | `2 H2O -> O2 + 2 H2` | water, electricity | high | `Supported` |
| Methane | `CO2 + 4 H2 -> CH4 + 2 H2O` | CO2, H2, electricity | high | `Supported` |
| Methanol | `CO2 + 3 H2 -> CH3OH + H2O` | CO2, H2, electricity | medium-high | `Supported` |
| Carbon monoxide / syngas intermediate | `CO2 -> CO + 1/2 O2` or `CO2 + H2 -> CO + H2O` | CO2, electricity, sometimes H2 | low-medium | `Exploratory` |
| Coke / graphite / graphene | `CO2 -> C + O2` | CO2, electricity | low | `Exploratory` |
| Ammonia | `6 H2O + 2 N2 -> 4 NH3 + 3 O2` | water, air / N2, electricity | low-medium | `Exploratory` |
| Cement | `CaCO3 -> CaO + CO2` | limestone, electricity / heat | low-medium | `Exploratory` |
| Steel | `2 Fe2O3 -> 4 Fe + 3 O2` | iron oxide, electricity and/or H2 | low-medium | `Exploratory` |
| Non-ferrous oxide reduction | `2 Al2O3 -> 4 Al + 3 O2` and analogs | mineral oxides, electricity | low | `Exploratory` |
| Desalination | stylized salt-water separation basis | brine / seawater, electricity | low | `Exploratory` |
| Exotics | undisclosed | unknown | very low | `Concept` |

### What "add CO/coke/ammonia/steel/al/ti/desalination" should mean in the app

For this project, adding these modules should not mean fabricating precise economics. It should mean:

1. The data model supports them.
2. The UI can surface them as future / exploratory modules.
3. The simulator can express their feedstocks, products, and missing assumptions.
4. Only modules with enough data are allowed to drive polished ROI and NPV outputs.

Recommended grouping for the app:

- `Air + water chemistry`: hydrogen, methane, methanol, CO via CO2 conversion, ammonia
- `Carbon solids`: coke / graphite / graphene
- `Calcination / mineral decomposition`: DAC, cement, lime-related systems
- `Oxide reduction / metallurgy`: steel, aluminum, silicon, titanium, generic mineral inputs
- `Water systems`: desalination

### Minimum extra inputs required for each future module family

These are the gating variables before the simulator should show serious economics:

| Family | Key missing inputs |
| --- | --- |
| Carbon monoxide / CO2-to-CO | route choice (`plasma`, `SOEC`, `RWGS`, etc.), electricity and/or H2 intensity, CO purification/compression basis, recycle assumptions, reactor durability and capex |
| Coke / graphite / graphene | target product grade, conversion route, Faradaic or thermal efficiency, byproduct handling, reactor capex |
| Ammonia | route choice, N2 separation method, loop pressure / compression assumptions, conversion and recycle assumptions, reactor capex |
| Cement | kiln or calciner energy basis, feed purity, capture treatment for released CO2, product price basis, scale assumptions |
| Steel | route choice (`H2-DRI + EAF`, flash ironmaking, molten oxide electrolysis, etc.), ore grade, reductant basis, furnace capex, scrap assumptions |
| Aluminum | route choice, alumina feed quality, current efficiency, anode consumption, cell capex |
| Titanium | route choice, ore / chloride feed assumptions, reductant choice, batch vs continuous assumptions |
| Silicon | route choice, feed purity, energy basis, furnace / cell capex, product grade |
| Desalination | technology (`RO`, thermal, electrodialysis), feed salinity, recovery ratio, pretreatment cost, water sale price |

### Recommended default dispatch logic

Instead of asking the user to guess the right electrolyzer / DAC split, compute a balanced default for the selected product.

For methane:

```text
kwh_per_kg_ch4 =
  (0.503 * electrolyzer_kwh_per_kg_h2) +
  (2.744 * dac_kwh_per_tco2 / 1000) +
  reactor_aux_kwh_per_kg_ch4
```

Then:

```text
ch4_kg_per_day = available_process_kwh_per_day / kwh_per_kg_ch4
```

If `reactor_aux_kwh_per_kg_ch4` is omitted for a first pass, the balanced electricity split is still easy to derive:

```text
h2_share =
  (0.503 * electrolyzer_kwh_per_kg_h2) /
  ((0.503 * electrolyzer_kwh_per_kg_h2) + (2.744 * dac_kwh_per_tco2 / 1000))

dac_share = 1 - h2_share
```

Using Terraform-style numbers:

- electrolyzer: `78.9 kWh/kg H2`
- DAC: `3440 kWh/t CO2`

This gives a methane-balanced split of about:

- `80.8%` to electrolysis
- `19.2%` to DAC

That is much better grounded than the current default `70% / 30%`.

## 3. Economics Model

The current model is too simplified to represent Terraform's published framing accurately. The main issue is that it uses one lifetime for everything and annualizes with straight-line depreciation.

Terraform's public materials imply a much more specific framing:

- solar panels can last around 30 years
- process modules can be much shorter lived
- short ROI matters more than maximizing utilization
- low-capex hardware is central to the thesis

### Recommended capex buckets

At minimum:

- solar modules
- solar structure / BOS
- land and site prep
- electrical balance specific to direct DC architecture
- electrolyzer stacks and manifolds
- DAC beds / kiln / material handling
- Sabatier reactor
- controls / skid / installation / contingency
- optional battery

### Separate asset lives

Do not force a single lifetime across all assets.

Recommended first-pass asset lives:

- solar array: `25-30 years`
- battery: cycle-limited or `10-15 years`
- electrolyzer stack / process hardware: `5-10 years`
- DAC hardware: `5-10 years`
- reactor: `5-15 years`

If the UI needs to stay simple, use:

- one "solar life"
- one "process life"

### Annualized capex

Prefer a capital recovery factor over straight-line capex / years:

```text
crf(r, n) = r * (1 + r)^n / ((1 + r)^n - 1)

annualized_capex_i = capex_i * crf(discount_rate, asset_life_i)
```

Current implementation of levelized annual cost:

```text
annual_cost =
  sum(annualized_capex_i) +
  annual_fixed_om +
  annual_variable_om
```

Current implementation of discounted cash flow:

```text
cash_flow_year_y =
  revenue_y -
  annual_om -
  replacement_capex_y
```

`replacement_capex_y` is zero in most years and becomes a full replacement outflow when an asset life rolls over inside the selected horizon.

**NPV / IRR / payback (cash flows):** Levelized annual cost embeds capital recovery via CRF; upfront CAPEX is still paid once. The current code therefore uses year-0 total CAPEX, then yearly revenue minus O&M and any scheduled replacement CAPEX. It does not currently add salvage value, debt service, or tax effects.

### Solar cost basis

This is one of the most important modeling choices.

Terraform is not arguing for generic utility solar LCOE with transmission and inverters. They are arguing for ultra-cheap local solar DC used on site.

The simulator should allow the user to choose one of these approaches:

1. `Solar capex mode`
   - enter module cost, BOS cost, land cost, etc.

2. `Solar energy cost mode`
   - enter direct local solar electricity cost in `$ / MWh`

These are not the same thing. Terraform's public writing often reasons directly from very cheap local solar electricity price, then designs the equipment around that.

### Product cost formulas

For an integrated methane plant:

```text
levelized_ch4_cost_per_mcf =
  annual_total_system_cost / annual_ch4_mcf_sold
```

For hydrogen-only:

```text
levelized_h2_cost_per_kg =
  annual_total_system_cost_allocated_to_h2 / annual_h2_kg_sold
```

For DAC-only:

```text
levelized_co2_cost_per_ton =
  annual_total_system_cost_allocated_to_co2 / annual_co2_tons_captured
```

The simulator should be explicit about whether costs are:

- integrated whole-system costs, or
- subsystem costs with shared solar allocated by fraction of electricity

The current implementation currently reports integrated whole-system cost intensities for `H2`, `CO2`, and `CH4`. They should be read as whole-plant average costs, not as marginal subsystem costs.

## 4. Revenue Model

Revenue should be separated into:

- physical product revenue
- green premium / offtake premium
- policy incentives

Important country-labeling note:

- methane / biomethane support in Europe is much less uniform than US federal hydrogen credits
- several important European schemes are country-specific and operate more like tenders or contracts-for-difference than one flat `$/MCF` premium
- the UI should therefore label country context explicitly and keep the methane sale-price assumption user-controlled unless a specific tender-clearing value is intentionally entered

### Product revenue

```text
annual_revenue =
  ch4_mcf * ch4_price_per_mcf +
  h2_kg * h2_price_per_kg +
  meoh_tons * meoh_price_per_ton +
  other_products
```

### Important methane pricing distinction

Terraform's public materials support at least two methane price cases:

- commodity gas pricing
- premium green methane pricing

The main site states that Terraform delivered pipeline-grade synthetic natural gas and received a `green CH4 premium of $35/MCF` in 2024. That is very different from ordinary commodity gas assumptions.

So the simulator should support:

- commodity price
- premium offtake price
- blended price

For Europe, country-specific examples worth labeling separately include:

- `Germany`: biomethane auction / EEG framework administered by Bundesnetzagentur
- `Netherlands`: `SDE++` renewable gas operating support
- `Denmark`: green-gas tender support for upgraded biogas / e-methane delivered to the gas grid

These are useful market presets, but they should remain descriptive labels around the methane sale-price assumption unless the model adds route-specific tender arithmetic.

### Tax credits and policy

Publicly mentioned credits include:

- `45V`: `$3/kg H2`
- `45Q`: `$130/t CO2` utilization, `$180/t CO2` sequestration
- `EU Hydrogen Bank / Innovation Fund`: EU fixed-premium support on verified hydrogen output, but bid-based rather than one universal number
- older Terraform references to a US power credit use `45E` language, but for new facilities the relevant federal power-side framework is generally `45Y / 48E`

Current implementation status:

- The app exposes an explicit policy selector with `No credits`, tiered US `45V`, US `45Q` utilization, US `45Q` sequestration, EU Hydrogen Bank premium, and `Custom`.
- Named modes are non-stacked by default; only `Custom` allows user-defined H2 and CO2 credit stacking.
- `45V` tiers and the EU Hydrogen Bank premium are modeled with a `10`-year duration.
- `45Q utilization` is applied only to the CO2 stream consumed by downstream products.
- `45Q sequestration` is applied only to the modeled CO2 surplus rather than all DAC capture.

Important remaining limitations:

- Eligibility is not validated against lifecycle emissions rules, temporal matching, tax structure, ownership, transferability, or jurisdiction-specific legal detail.
- `45Q sequestration` is still approximated from modeled CO2 disposition rather than a transport/injection/permanence model.
- Power-side US incentives such as `45Y / 48E` are intentionally not bundled into the current product-side credit selector.

Important update:

- `45Y / 48E` should not be treated as a simple product-output credit toggle in the basic market panel.
- It is a power-side US incentive and depends on who owns the solar asset, whether the electricity is sold / claimed in a qualifying way, and the tax structure.
- If modeled later, it should be added as a separate advanced solar-side option rather than lumped into the hydrogen / CO2 credit selector.

## 5. Environmental Metrics

Environmental outputs are useful, but they should be secondary to the mass and economic model.

Useful outputs:

- `CO2 captured`
- `CO2 displaced by fossil substitution`
- `net water consumed or produced`
- `land area`
- `homes served equivalent`

Recommended formulas:

```text
co2_captured_tpy = annual_co2_captured_kg / 1000

co2_displaced_tpy =
  annual_ch4_mcf * fossil_emissions_factor_tco2_per_mcf

water_recycled_kgpd =
  ch4_daily_kg * water_per_kg_ch4 +
  meoh_daily_kg * water_per_kg_meoh

net_water_needed_kgpd =
  max(0, electrolyzer_water_kgpd - water_recycled_kgpd)
```

Important open issue:

- the fossil emissions factor should not be hidden
- the simulator should explicitly state which factor it uses and from which standard basis

Water:

```text
water_used_kg_per_day = h2_kg_per_day * 9
water_formed_kg_per_day = ch4_kg_per_day * (2 * 18.015 / 16.04)
net_water = water_formed - water_used
```

The current `2.25 kg H2O / kg CH4` factor is fine, but it should be documented.

## Constants and Suggested Presets

The simulator should distinguish three classes of numbers:

- physical constants
- public Terraform targets / claims
- user-selectable commercial assumptions

### Physical constants that can be hard-coded

| Parameter | Value | Notes |
| --- | ---: | --- |
| Theoretical minimum electrolysis energy | `39.4 kWh/kg H2` | Thermodynamic limit |
| Water per kg H2 | `9 kg/kg` | Electrolysis stoichiometry |
| H2 required per kg CH4 | `0.503 kg/kg` | Sabatier stoichiometry |
| CO2 required per kg CH4 | `2.744 kg/kg` | Sabatier stoichiometry |
| H2 required per kg methanol | `0.189 kg/kg` | Methanol stoichiometry |
| CO2 required per kg methanol | `1.374 kg/kg` | Methanol stoichiometry |
| Water formed per kg CH4 | `2.25 kg/kg` | From `CO2 + 4 H2 -> CH4 + 2 H2O` |

### Publicly grounded Terraform-style process defaults

These should exist as named presets, not necessarily as hard-coded universal truths.

| Parameter | Suggested preset | Why |
| --- | ---: | --- |
| Electrolyzer energy | `79 kWh/kg H2` | Consistent with Terraform's low-capex framing |
| Electrolyzer capex (current-ish) | `$100/kW` | Consistent with 2024 published milestone framing |
| Electrolyzer capex (aggressive future) | `$20/kW` | Consistent with earlier long-run whitepaper target |
| DAC energy | `3440 kWh/t-CO2` | Directly from whitepaper |
| DAC capex (current-ish) | `$600/t-yr CO2` | Consistent with 2024 published milestone framing |
| Sabatier conversion | `99%` | Reasonable from public reactor claims |
| Methane purity | `97% to 99.4%` | Publicly discussed result range |
| Solar utilization framing | `25% CF` / `~6 hours/day` | Repeated in Terraform materials |

### Publicly grounded Mark One basis

The `Terraformer Mark One` post is strong enough to support a named system preset:

| Parameter | Suggested preset | Why |
| --- | ---: | --- |
| Solar basis | `1 MW solar array` | Explicitly stated |
| CH4 output rate | `1000 cf/h` | Explicitly stated |
| Utilization | `25%` | Explicitly stated |
| Daily methane output | `6000 cf/day` | Explicitly stated |
| Annual operating hours | `2190 h/yr` | Explicitly stated |
| Annual methane output | `>2 million cf/yr` | Explicitly stated |
| Revenue case | `$10/Mcf + $54/Mcf IRA PTCs` | Explicitly stated |

### Publicly grounded product / market presets

| Parameter | Suggested preset | Why |
| --- | ---: | --- |
| Commodity methane | user input | Market-dependent |
| Green methane premium | `$35/MCF` scenario | Publicly mentioned 2024 sale |
| US hydrogen credit 45V | `up to $3/kg` | Publicly discussed; actual value is tiered by lifecycle emissions |
| CO2 credit 45Q utilization | `$130/t` | Publicly discussed |
| CO2 credit 45Q sequestration | `$180/t` | Publicly discussed |
| EU Hydrogen Bank premium | user input | Bid-based fixed premium, not one statutory EU-wide number |

### Solar defaults need explicit mode selection

Terraform materials include both:

- current-ish baseline numbers
- aggressive future / scale numbers

Those should not be mixed accidentally.

Recommended named solar presets:

1. `Commercial current-ish`
2. `Terraform near-term`
3. `Terraform aggressive future`

### External support values that should remain visibly external

These are useful, but they are not Terraform's own numbers and should be labeled accordingly:

| Parameter | Example support value | Source role |
| --- | ---: | --- |
| PEG tilt | `8°` | East-West layout benchmark |
| PEG GCR | `~95-98%` | East-West layout benchmark |
| PEG installation effort | `~450 working hours/MWp` | East-West installation benchmark |
| NREL utility PV AC capacity factor range | `~21-34%` | external utility-scale sanity check |
| NREL representative baseline | `100 MWDC one-axis tracking, ILR 1.34` | external comparison baseline |

## Where the Current Code Most Needs to Change

These are the highest-value model changes, in order:

### 1. Replace heuristic annual solar economics with yield-driven economics

Prefer:

```text
site_yield_mwh_per_mwdc_year
```

over:

- inferred GHI from latitude
- fixed mounting multipliers

### 2. Make methane the primary product mode

The app should have a clear "Methane Terraformer" mode where:

- solar power is split automatically into balanced `H2` and `CO2`
- methane output is the primary result
- optional sale of surplus `H2` is secondary

### 3. Separate solar life from process life

This is essential. The current single-lifetime model is too crude.

### 4. Make tax credit logic explicit and mutually exclusive by default

The current additive handling of credits is not defensible.

### 5. Add scale-aware capex formulas

Reactor capex should not remain a fixed dollar number across all plant sizes.

At minimum:

```text
reactor_capex = reactor_capex_reference * (throughput / reference_throughput)^scaling_exponent
```

with a user-visible scaling exponent if needed.

### 6. Demote or hide unsupported product pathways

FT and ammonia need either:

- better sourced constants and cost assumptions, or
- an "experimental" label

### 7. Refactor product logic into a module registry

The current checkbox-per-process approach will not scale to:

- coke
- ammonia
- cement
- steel
- aluminum
- titanium
- silicon
- desalination

Before serious expansion, product logic should move to a registry-based design with shared plant accounting and module-specific feed / product definitions.

## Extra Input Still Needed

The simulator cannot be made trustworthy until these choices are settled.

### 1. What exactly is the base unit?

Possible interpretations:

- `1 MWdc solar array`
- `1 MW Terraformer module`
- `1 MW process capacity`

Terraform's writings often treat the module as a `1 MW electrical` system tied to solar. The simulator should choose one basis and stick to it.

### 2. Which solar cost basis do we want?

Choose one:

- capex-derived local solar DC
- direct `$ / MWh` input
- both

### 3. Which geography model do we want?

Choose one:

- lightweight presets only
- user-entered annual yield
- real dataset-backed location lookup later

### 4. How should mounting type work?

Needed inputs:

- yield deltas by climate
- BOS deltas
- land-use deltas
- hail / insurance adjustments

The current fixed multipliers are not enough.

### 5. What credit regime should be modeled?

Needed inputs:

- which tax year / policy regime
- whether stacking is allowed
- whether methane gets premium offtake or commodity pricing

### 6. What costs are intentionally deleted?

This is critical for a Terraform-style model.

Need explicit yes / no treatment for:

- inverter cost
- grid interconnection cost
- power transmission cost
- H2 compression and transport
- CO2 compression and transport
- methane cleanup / pipeline injection cost

### 7. What replacement schedule should be used?

Needed inputs:

- panel life
- electrolyzer stack replacement interval
- DAC sorbent / refractory / kiln maintenance
- reactor catalyst or hardware replacement

### 8. How much operational detail do we want in a one-page app?

Recommended compromise:

- annual economics based on annual yield
- daily power chart for intuition
- optional advanced hourly dispatch

That keeps the app lightweight without pretending it is a full process simulator.

### 9. Which route should each future module use?

The broad product families are now clear, but the exact industrial route is not:

- ammonia: electrochemical route vs Haber-Bosch-style route?
- coke / graphite / graphene: carbon deposition, electrolysis, or another route?
- steel: `H2-DRI + EAF`, flash ironmaking, molten oxide electrolysis, or another route?
- aluminum: Hall-Heroult style baseline or a Terraform-specific adaptation?
- titanium: Kroll-like route, FFC-style route, or another route?
- silicon: furnace-based route or direct electrochemical reduction?
- desalination: reverse osmosis, thermal, electrodialysis, or another route?

These route choices matter so much that the simulator should not collapse them into a single generic slider.

## Remaining Implementation Priorities

1. Add a formal `Mark One / Methane Terraformer` preset or mode instead of relying on default field values that only approximate that framing.
2. Replace fallback annual solar heuristics with a real site-yield dataset or import workflow.
3. Add explicit hydrogen-only and DAC-only operating modes so auto-allocation does not fall back to a stylized methane basis when no downstream product is active.
4. Add debt, tax, inflation, salvage-value, and working-capital treatment around the now replacement-aware cash-flow model.
5. Promote premium and blended methane pricing cases from descriptive labels plus manual price entry into more explicit scenario handling.
6. Extend the module registry with route-specific mass-balance, OPEX, CAPEX, and replacement logic for exploratory modules.
7. Add more detailed process-specific variable OPEX and replacement assumptions for supported modules.
8. Add regression coverage for policy duration, CO2 credit eligibility, replacement timing, and battery-shaped reactor sizing.

## Bottom Line

The current app is already a good interactive sketch, but it is not yet a Terraform-style economic simulator. The biggest conceptual upgrade is to stop treating it like a collection of independent widgets and instead model it as an integrated, direct-coupled chemical plant whose economics are dominated by:

- very cheap local solar DC
- low-capex intermittent-compatible process hardware
- stoichiometric balancing of `H2` and `CO2`
- explicit product choice
- explicit policy regime
- explicit treatment of what costs the architecture deletes

If we implement those pieces first, the simulator will become much more faithful to Terraform's published ideas without needing to become a giant engineering tool.

The broader opportunity is now clearer than when this document was first drafted: Terraform's public writing no longer points only at solar-to-methane. It points at a whole class of low-capex, intermittency-friendly, colocated primary-production loads. The app should therefore be built in two layers:

- a methane-first product that is actually good
- a generalized industrial module framework that can later absorb carbon monoxide, coke, ammonia, steel, aluminum, titanium, desalination, and related verticals without a rewrite

## Implemented App Snapshot

The current app implementation now reflects a substantial portion of the architecture described above:

- The default numeric state is a `1 MW` Mojave-style methane case, but there is not yet a dedicated `Mark One` mode or preset object.
- Annual solar economics are driven by `siteYieldMwhPerMwdcYear`, while `js/solar-geometry.js` supplies the daily profile chart and astronomical context.
- Mounting assumptions are split into yield multiplier, land packing, BOS cost, and descriptive notes.
- Electrolyzer and DAC feed split defaults are auto-balanced from stoichiometry and process electricity intensity for the active methane/methanol mix; there is no manual allocation slider in the current UI.
- Capital recovery factor (`CRF`) annualization is used for levelized annual cost.
- Solar, battery, electrolyzer, DAC, Sabatier, methanol, and analysis horizon inputs are separated rather than collapsed into one plant lifetime.
- Discounted metrics now include scheduled replacement CAPEX rather than assuming one upfront build only.
- Policy treatment is explicit and non-stacked by default: `No credits`, tiered US `45V`, US `45Q` utilization / sequestration, EU Hydrogen Bank bid-premium mode, and `Custom`.
- `45V` tiers and EU Hydrogen Bank support are time-limited in the current model, and `45Q` now follows the modeled utilization-versus-sequestration basis.
- Methane market presets are descriptive context labels around a user-controlled methane sale-price assumption.
- The module registry now covers supported core/product modules (`electrolyzer`, `dac`, `sabatier`, `methanol`) plus exploratory modules for carbon monoxide / CO2-to-CO, ammonia, coke, cement, steel, silicon, aluminum, titanium, and desalination.
- Exploratory modules are intentionally excluded from ROI and shown with route choice plus missing-assumption gating instead of fake precision.
- Battery dispatch now shapes effective process peak, and downstream reactor sizing follows that battery-shaped peak rather than raw solar nameplate.

Some simplifications still remain in code and should stay visible as assumptions:

- Preset and fallback annual yield values are still stylized rather than backed by a proper irradiance database.
- Methane and methanol are the only product families with active downstream economics, and hydrogen sales are still not a modeled revenue line.
- Exploratory modules expose architecture and routing, but not route-specific mass-balance or detailed CAPEX models yet.
- Levelized annual cost does not spread replacements into a separate annual replacement term; replacements currently enter the discounted cash-flow path as discrete events.
- The finance model still omits debt, taxes, inflation escalation, salvage value, and formal policy-qualification logic.
- The auto-allocation fallback with no downstream product enabled is still stylized rather than a dedicated hydrogen-only or DAC-only mode.
