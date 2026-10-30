# Solar Chemical/AI Plant Builder

An unofficial, MIT-licensed browser app that simulates a Terraform Industries-style plant: cheap local solar DC driving electrolysis and direct air capture, with the hydrogen and CO2 turned into methane or methanol. It is an educational techno-economic model for exploring trade-offs, not a bankable engineering or investment model.

The model leans into the Terraform thesis: very cheap solar, low-capex hardware that runs intermittently, and colocated conversion can matter more than high utilization or peak electrical efficiency.

What it models:

- Annual solar yield from PVGIS-based Earth site presets, a fallback estimate, or a manual value, on four mountings (fixed tilt, east-west, single-axis, dual-axis), plus rough Mars and Moon presets.
- An hour-by-hour annual dispatch of solar, an optional battery and the chemical plant, with intentional undersizing (clipping) via `chemicalSizingPercent`.
- Supported products: methane (Sabatier) and methanol, with H2 and CO2 shared between them by stoichiometry.
- Exploratory industrial routes with rough economics: MTG gasoline, CO2 to CO, ammonia, specialty carbon, lime, cement, steel, silicon, aluminum, titanium and desalination.
- An optional colocated AI datacenter: a constant IT load sized to a reliability target, served before the chemicals.
- Sourced and dated incentive schemes for the US, EU, Germany, the Netherlands, the UK and Spain, plus a custom mix.
- Project finance: replacements, salvage, NPV, IRR/MIRR, payback, levelized metrics, optional debt with DSCR, inline IRR optimizers and price sensitivities.
- CO2 accounting (captured, bound, vented, net avoided), water and land use.

## Running locally

Requires Node 20 or later.

```bash
npm ci            # installs Chart.js, Leaflet and lz-string (self-hosted, no CDN)
npm run dev       # serves the repo root at http://127.0.0.1:4173 (no caching)
npm test          # node --test over tests/ (no build step needed)
npm run build     # writes a versioned dist/
npm run preview   # serves dist/ the same way
```

`PORT` and `HOST` override the dev server address. There is no bundler or framework: `index.html` loads the vendor scripts from `node_modules/` and one native ES module entry, `js/main.js`.

`npm run build` copies an allowlist (`index.html`, `style.css`, `js/`, the vendor files, `README.md`, `LICENSE`) into `dist/`. Assets go under `dist/assets/<buildId>/`, where the build ID comes from `BUILD_ID`, the Vercel or GitHub commit SHA, or `git rev-parse`, and `index.html` is rewritten to point at them. Vercel deploys `dist/` using `vercel.json`, which runs the build, marks `/assets/*` immutable and sets a strict Content-Security-Policy. The only external host the CSP allows is the Esri satellite tile server used by the site map.

## Architecture

```text
js/data/      reference data, no logic: bodies, site presets, mountings, chemistry,
   |          MODEL_ASSUMPTIONS, process module/route catalog, policy registry
js/model/     calculation engine; index.js assembles the Calc facade
   |  ^       (the model reads DEFAULT_STATE/normalizeState from state/;
   v  |        state/ reads ModuleCatalog and numeric helpers from model/)
js/state/     schema + DEFAULT_STATE, normalization, legacy migrations,
   |          share-link codec, saved sites
js/ui/        App class + mixins, declarative controls, renderers, charts, diagram, site map
js/workers/   optimizer-worker.js: runs the IRR search through Calc off the main thread
```

- `js/data/`: `reference-data.js` (bodies, `LOCATION_PRESETS`, `MOUNTING_TYPES`, `CHEMISTRY`, AI defaults), `assumptions.js` (`MODEL_ASSUMPTIONS` and the GHI/cloudiness heuristics), `modules.js` (supported and exploratory process modules), `policies.js` (incentive schemes and picker groups).
- `js/model/`: one file per concern: `solar.js` + `solar-geometry.js` (resource, sky model, mountings), `annual-series.js` (hourly year), `battery.js` (storage + chemical dispatch), `ai-compute.js`, `lifetime-energy.js`, `process.js` (allocation, electrolyzer, DAC, reactors, exploratory routes, buffers), `economics.js`, `finance.js`, `policy.js`, `module-catalog.js`, `optimizer-search.js`, and `scenario.js` (the pipeline).
- `js/state/`: `schema.js` is the single source of state fields and defaults.
- `js/ui/`: `app.js` plus mixins, `control-spec.js` + `controls.js`, `renderers/`, `charts/` (one module per chart), `diagram.js`, `site-map.js`, `share.js`, `optimizer-client.js`, `formatters.js`.
- `scripts/`: `dev.mjs` (hardened static server) and `build.mjs`.

**Key rule:** `data/`, `model/` and `state/` never touch the DOM. They run unchanged in the browser, in the worker and under Node tests. (`state/saved-site-presets.js` uses `localStorage` behind a guard.) The UI talks to the engine through the `Calc` facade, `ModuleCatalog`, `PolicyModel` and the schema exports (`DEFAULT_STATE`, `CORE_STATE_FIELDS`). It imports `data/` directly only for option lists and labels.

**Calc.** Each model file exports a plain method object (`solarMethods`, `processMethods`, `economicsMethods`, ...). `model/index.js` merges them with `Object.assign` into one `Calc` object. Methods call each other through `this`, so always call them through `Calc` (for example `Calc.calculateAll(state)`) and never detach them. Pure helpers such as `finance.js`, `util.js` and `state/normalize.js` are plain functions that the facade re-exposes. The main entry points are:

- `calculateAll(state)` / `calculateScenario(state, { fastMode })`: the full result tree.
- `calculateIrr` / `calculateReturnMetrics`: the lean path, which skips display series.
- `runSensitivity`, `findBestRangeValueForIrr` and `normalizeState`.

`scenario.js` runs this pipeline:

```text
normalizeState -> calculateSolar -> buildAnnualSolarSeries
  -> calculateBattery (chemicals only) | calculateAICompute (AI first)
  -> buildProcessAllocationPlan -> electrolyzer, DAC -> methane/methanol reactors
  -> exploratory routes -> feed-buffer storage -> calculateEconomics -> calculateEnvironmental
```

**App mixins.** `App` (`ui/app.js`) owns `state`, `init()` and `recalculate()`. All other behavior lives in mixin objects (`controlMethods`, `rendererMethods`, `chartMethods`, `siteControlMethods`, ...) that are `Object.assign`ed onto `App.prototype`. Each mixin method runs with the App instance as `this`. State-backed inputs are declared once in `CONTROL_SPECS` and `getModuleControlSpecs()` (`ui/control-spec.js`). That one list drives both input-to-state binding and state-to-control sync.

## Extending

After any of these changes, run `npm test`. Every recipe that changes the result tree also needs a characterization fixture regeneration (see [Testing](#testing-and-validation)).

**Add an exploratory route** (to an existing module):

1. In `js/data/modules.js`, add an entry under the module's `routes` with these fields:
   - `label`
   - `electricityKwhPerUnit`: electricity per output unit, excluding the H2 the route consumes. Add a comment stating its basis.
   - `capexPerAnnualUnit` with `capexUnit`: `'tpa'` for $ per t/yr, or `'m3pd'` for $ per m3/day.
   - `cyclingPenalty`
   - `feedstocks`: `{ h2Kg, co2Kg }` per output unit. `methanolKg` is only delivered to the `mtg` module.
   - `feedstockSummary`, `outputLabel` and `outputUnit`
   - `diagramInputs`: `{ h2, co2, methanol }` flags for the diagram
   - Optional: `supportsFeedBuffer`, a route-level `market` (overrides the module's sale-price slider), and `assetLifeYears` (default 10).
   - If the route needs another module, add it to the module's `routeDependencies`.
2. Add the route to `FLOORS` in `tests/calculations/energy-floor.test.js`. The value is its reaction-enthalpy floor, or `null` with the reason (an external reductant supplies the energy). Unlisted routes fail that test.
3. Regenerate the characterization fixture.

The catalog generates everything else: the state keys, normalization, the route select, the capex slider (0.25-4x the route default), the buffer toggle, the diagram card and the economics rows. A new exploratory **module** is a new `MODULE_DEFINITIONS` entry with `exploratory: true`, a `family` key from `MODULE_FAMILY_LABELS`, a `market`, `routes` and `missingInputs`. Its `<id>Enabled`, `BufferEnabled`, `Route`, `PriorityWeight`, `CapexBasis` and `Price` state keys are generated. A new *supported* product (beside methane and methanol) is not data-driven: it needs code in `process.js`, `scenario.js`, `economics.js`, the renderers and the diagram.

**Add a policy scheme:**

1. In `js/data/policies.js`, add a `POLICY_SCHEMES` entry. It needs display metadata (`label`, `jurisdiction`, `note`, `basis`, `implementationFormula`, ...) and `durationYears`: years of annual support, `0` for one-off support, or `null` to pay over the whole horizon. It also needs a `cashflowType` whose `inputs` are read in this order:
   - `capex_share`: `inputs[0]` is the share (0-1) of `eligibleCapexBasis` (`'solar' | 'electrolyzer' | 'dac' | 'total'`), paid once at close.
   - `unit_support`: `inputs[0]` is $ per unit of `outputBasis` (`'solar_kwh' | 'solar_mwh' | 'hydrogen_kg' | 'co2_ton'`).
   - `strike_minus_reference`: `inputs[0]` is the strike and `inputs[1]` the reference. Support can go negative.
   - `base_minus_correction`: `inputs[0]` is the base and `inputs[1]` the correction, floored at 0.
   - `framework_only`: no cash flow.

   Each input has `key`, `label`, `min`/`max`/`step`, `defaultValue` and `format` (`'share'`, `'currency_per_kwh'`, `'currency_per_mwh'`, `'currency_per_kg'`, `'currency_per_ton'`). Each key becomes a state field automatically (`POLICY_INPUT_FIELDS`), so share a key between schemes only when it is the same quantity. Put a source comment next to every number.
2. List the id in a `POLICY_SELECT_GROUPS` group. A scheme that is not listed is still valid in state but cannot be picked.
3. Add re-derived facts to `tests/calculations/policy-facts.test.js` and regenerate the fixture (every selectable scheme is a snapshot scenario).

The input controls render from `inputs` (`renderPolicyInputs`). A new cash-flow type or basis needs code in `model/policy.js` (`evaluatePolicy`, `getOutputMetric`, `getEligibleCapexBreakdown`) and in `economics.getYearlyEnergyFactors`.

**Add an Earth site preset:**

1. Add an entry to `LOCATION_PRESETS` in `js/data/reference-data.js`:
   - `name`, `lat`, `lon`
   - `ghi`: PVGIS `H(i)_y` at 0 deg tilt, in kWh/m2/yr.
   - `baseYield`: PVGIS v5.3 PVcalc `E_y` for crystalline Si, 14% loss, free-standing, optimal tilt.
   - `diffuseFraction`: Global Solar Atlas DIF/GHI. Omit it to use the cloudiness heuristic.
   - `region`: `desert | temperate | tropical | cloudy`. This drives layout/BOS cloudiness and the fallback diffuse fraction.
2. Run the tests. `energy-model.test.js` checks that yield/GHI is 0.72-1.0 and the diffuse fraction is 0.1-0.7.

The dropdown lists the new preset automatically. A selected preset is stored as lat/lon/yield and matched back within 0.1 deg, so the array order does not matter. The preset also becomes the "nearby preset" (its GHI, diffuse fraction and estimated yield) for any location within 2 deg latitude and 3 deg longitude.

**Add a state field and its control:**

1. Add `{ key, type, min, max, defaultValue }` to `CORE_STATE_FIELDS` in `js/state/schema.js`. `type` is `number`, `integer`, `boolean`, `enum` or `string`. `DEFAULT_STATE`, clamping in `normalizeState` and share links then follow automatically. Share links store only differences from defaults, so changing a default later changes what old links mean. Exceptions:
   - A per-module slider belongs in that module's `configs` (`data/modules.js`).
   - A policy input belongs in the scheme's `inputs`.
   - A fixed constant that users cannot change belongs in `MODEL_ASSUMPTIONS` (`data/assumptions.js`).
2. Add the element to `index.html`. Give it the default as its static `value`, plus a `<span id="<id>Value">` read-out that shows the formatted default.
3. Add `{ type: 'range' | 'checkbox' | 'select' | 'number', id, stateKey?, format?, onChange? }` to `CONTROL_SPECS` in `js/ui/control-spec.js`. Binding and sync come from that entry. `tests/ui/control-spec.test.js` checks that the element exists and that its pre-JS value and read-out match `DEFAULT_STATE`.
4. Read the value from the normalized state in the model.

**Add a result row:**

1. If the value is not on the result yet, compute it in the model, typically in `calculateEconomics` (`js/model/economics.js`), and return it. That changes the characterization tree, so regenerate the fixture.
2. Render it. The economics panel is built group by group in `js/ui/renderers/economics.js` (`buildSummaryMetrics`, `buildReturnsRows`, `buildCostRows`, `buildRevenueRows`, `buildFinancingRows`, `buildUnitRows`, `buildContextRows`). Rows use `econRow(label, value, cssClass, tooltip)` from `renderers/markup.js`. The production and impact grids in `renderers/index.js` use `prodItem`. Format values with `FormatNumbers` and `ui/formatters.js`.
3. Optionally assert on the HTML in `tests/renderers/`. Those tests render real results with stubbed DOM elements.

## Model summary

### Solar resource

```text
site_yield  = base_yield * mounting_multiplier          # MWh/MWdc/yr
annual_MWh  = MWdc * site_yield
```

`base_yield` is the yield of a reference mounting. On Earth and Mars that is a fixed, equator-facing array at its optimal tilt. At the lunar peak of eternal light it is vertical sun-tracking panels. Earth presets carry PVGIS v5.3 yields and horizontal irradiation, plus the Global Solar Atlas diffuse fraction. Away from a preset, the base yield is `GHI * modeled optimal-tilt gain * 0.78` (PVGIS performance ratios span 0.73-0.81), where GHI comes from latitude bands with a desert uplift. Panel efficiency changes area and land, not energy, because nameplate MWdc is the input. Ground coverage and BOS $/W get latitude/cloudiness layout adjustments relative to a Mojave reference.

The Earth sky model in `solar-geometry.js`:

```text
dni_clear = 1353 * 0.7^(AM^0.678) * sun_distance_factor        (Meinel)
dhi_clear = 0.1 * dni_clear
# beam transmittance t moves (1 - t) of the beam into diffuse, conserving GHI;
# t is solved so annual DHI/GHI equals the site diffuse fraction
poa = dni*cos(aoi) + dhi*(A*Rb + (1-A)*(1+cos tilt)/2) + 0.2*ghi*(1-cos tilt)/2   (Hay-Davies)
mounting_multiplier (Earth) = annual_poa(mounting) / annual_poa(fixed at modeled optimal tilt)
```

The mountings are:

- Fixed tilt at the modeled optimum (golden-section search on annual POA).
- 8 deg east-west racks.
- Horizontal N-S single-axis trackers, limited to +/-60 deg and backtracking at the row ground-coverage ratio.
- Ideal dual-axis tracking.

At Mojave this gives east-west 0.86, single-axis 1.21 and dual-axis 1.43 (PVGIS: 0.85, 1.30, 1.46). At the lunar PEL the Sun grazes the horizon, so a horizontal-axis tracker captures about 0.52, a fixed vertical panel about 1/pi and low-tilt east-west racks about 0.05. Mars and the generic Moon profile use the `MOUNTING_TYPES` table.

**Hourly year.** The dispatch runs over one hourly year:

- Earth: 8,760 h.
- Mars: one orbital year of sols, annualized to an Earth year.
- Moon: the local cycle repeated over an Earth year.

The series has the clear-sky shape scaled to the annual energy, with every hour capped at DC nameplate. If the yield cannot fit under that cap, the output is capped and a warning is shown. The day selector only changes the displayed day, never the economics.

### Dispatch and sizing (`battery.js`, `ai-compute.js`)

Chemicals-only mode works hour by hour. Solar feeds the process first. The battery covers shortfalls and absorbs surplus, limited to `capacity / batteryDurationHours` per hour (default 4 h), with `sqrt(round-trip)` efficiency each way and 2%/month self-discharge. Everything else is clipped. The start state of charge is iterated until the year is periodic. Operating hours are hours at 5% of capacity or more. The 100% size is defined by the annual dispatch:

```text
full_capture_kW = annual solar peak                          (no battery)
                = min { P : clipped_kWh(P, battery) = 0 }    (battery: bisection)
process_kW      = full_capture_kW * chemicalSizingPercent / 100
```

AI mode serves solar in this order: the constant AI load, then battery charging (the battery discharges only to AI), then the chemicals. The AI load is the largest constant load whose clear-sky-equivalent full-power reliability meets the target (bisection). Chemical 100% is the peak residual power at that load. With no battery, AI mode seeds 1 MWh per GWh/yr of solar and says so. GPU CAPEX is `$/kW * load`, O&M is 4%/yr of it, and `revenue = served MWh * M tokens/MWh * $/M tokens`.

Battery CAPEX is `$/kWh * capacity`. Its life is `min(12 yr, rated cycles / cycles per year)`, counting one cycle per day, sol or lunar cycle.

### Lifetime energy (`lifetime-energy.js`)

The plant is sized on year-1 solar. The fixed design (AI load, chemical capacity, battery) is then re-dispatched at four PV output factors spanning the horizon, and the energies are interpolated per project year:

```text
solar_factor_y = (1 - degradation)^((y - 1) mod solar_asset_life)    # resets after repowering
ai_factor_y    = ai_served(solar_factor_y)   / ai_served(1)
chem_factor_y  = chemical_kWh(solar_factor_y) / chemical_kWh(1)
```

AI has first call on solar, so it loses less than the PV output while the residual chemistry loses more. The AI panel reports the lowest yearly reliability.

### Process chain (`process.js`)

Power and feeds are auto-balanced from the enabled consumers. A consumer's weight is its methane/methanol by-mass share of the product slate (x100), or an exploratory route's priority weight (0-100) in its own output units:

```text
h2_power   = sum_i w_i * h2_kg_per_unit_i  * electrolyzer_kWh_per_kg
co2_power  = sum_i w_i * co2_kg_per_unit_i * dac_kWh_per_kg
expl_pool  = sum_j w_j * electricity_kWh_per_unit_j
electrolyzer_share = h2_power / total;  dac_share = co2_power / total
exploratory_share_j = (expl_pool / total) * w_j / sum_k w_k      # pool split by weight only
h2_feed_share_i  = w_i * h2_kg_per_unit_i  / sum_k w_k * h2_kg_per_unit_k   (same for CO2)
```

Because the feed split uses the same `weight * kg/unit` as the power split, each consumer gets H2 and CO2 in stoichiometric ratio. The only unused feed is each reactor's unconverted fraction. For example, methane + methanol 50/50 at 95%/80% conversion leaves 9.1% of the H2 and 10.0% of the CO2 unused. With no product enabled, the split falls back to 50/50 and everything is vented.

```text
H2 kg      = electrolyzer_kWh / kWh_per_kg      (LHV efficiency = 33.33 / kWh_per_kg; HHV floor 39.4)
CO2 t      = dac_kWh / kWh_per_t
CO2 + 4 H2 -> CH4 + 2 H2O:  CH4 = min(H2/0.503, CO2/2.744) * conversion;  MCF = kg / 19.25
CO2 + 3 H2 -> CH3OH + H2O:  MeOH = min(H2/0.189, CO2/1.374) * conversion; export = reactor - MTG offtake
exploratory units/day = min(kWh / kWh_per_unit, H2 / h2_per_unit, CO2 / co2_per_unit, MeOH / meoh_per_unit)
water: stoichiometric 9 kg/kg H2; feed water 12 kg/kg H2 (incl. purification rejects);
       recycled = 2.25 kg/kg CH4 + 0.562 kg/kg MeOH
```

CAPEX sizing works as follows:

- The electrolyzer is sized on `$/kW * process_kW * share`.
- DAC is priced per t-CO2/yr of capacity at a 25% reference utilization (the basis of Terraform's whitepaper 2.0 $40.35/t-yr), applied to nameplate. Identical hardware therefore costs the same at any site:

  ```text
  dac_capex = $/t-yr * dac_kW * 8760 * 0.25 / kWh_per_t      # $450/t-yr at 3,440 kWh/t = $286/kW
  ```

- The Sabatier reactor costs `$/kW-CH4` on its design output (LHV 13.9 kWh/kg). The methanol reactor costs `$/(kg/h)` on its design H2 + CO2 feed. Both are sized on the hourly peak feed.
- An exploratory route is sized on its peak hourly output. CAPEX is that rate times `cycle hours * cycles per year * $/t-yr * cycling penalty` (or `* cycle hours * $/m3/day * penalty` for water), with a 10-year life and the shared exploratory O&M %.

Feed buffers are off by default. They can be opted into per module (methane, methanol, routes with `supportsFeedBuffer`). A buffered reactor runs at a constant rate, so it is sized on the peak day's feed / cycle hours, but it must hold that feed:

```text
buffer_working_kg = peak_day_feed_kg * (1 - op_hours / cycle_hours)    # flat-supply upper bound
buffer_capex      = H2_kg * $750/kg + CO2_t * $1,000/t                  # both stated assumptions
```

The buffer carries process O&M and is replaced every 20 years. At the default $50/kW-CH4 Sabatier cost, buffering the reactor costs more in storage than it saves in reactor size.

### Policy (`policy.js`)

```text
upfront   = eligible_capex * share                       # initial build only, not replacements
annual    = qualifying_output * unit_support
          | qualifying_output * (strike - reference)
          | qualifying_output * max(base - correction, 0)
```

Annual support is paid only on qualifying output:

- Solar: power delivered to the plant (generation minus clipping).
- H2: hydrogen converted into products.
- CO2: CO2 utilized in products. Vented feed earns nothing.

Support stops after `durationYears`. Solar-output credits follow delivered solar each year, and H2/CO2 credits follow the chemical-energy factor. Named schemes apply one at a time. `Custom mixed support` stacks a capex share of total CAPEX (including land) with solar, H2 and CO2 support for the whole horizon. Framework-only entries add context but no cash.

### Finance (`economics.js`, `finance.js`)

```text
CAPEX blocks: solar (modules + BOS + site prep), land, battery, AI, electrolyzer, DAC,
              methane reactor, methanol reactor, feed buffers, each exploratory route
net_capex_0 = total_capex - upfront_support
replacement : at each multiple of an asset's life strictly inside the horizon, paid in year
              ceil(k * life) (no drift); solar repowering = modules + BOS; land never replaced
salvage_N   = sum_i last_install_cost_i * remaining_life_i / life_i  +  land at cost
O&M (flat)  = solar% * (modules + BOS) + battery% * battery + 4% * AI
              + process% * (electrolyzer + DAC + reactors + buffers) + exploratory% * routes
revenue_y   = AI_1 * ai_factor_y + (products_1 + exploratory_1) * chem_factor_y
              + credits_1 * policy_factor_y * [y <= support years]
cf_y        = revenue_y - O&M - replacements_y + [y == N] * salvage_N
NPV         = -net_capex_0 + sum_y cf_y / (1 + r)^y
```

Levelized metrics:

```text
crf(r, n)         = r (1+r)^n / ((1+r)^n - 1)
levelized cost    = (net_capex_0 + PV(replacements) - PV(salvage)) * crf(r, N) + O&M
levelized revenue = PV(revenue_y) * crf(r, N)
levelized profit  = levelized revenue - levelized cost = NPV * crf(r, N)
cost breakdown    = sum_i net_capex_i * crf(r, life_i) + land * r + O&M   (+ reconciling timing/salvage row)
solar LCOE        = (solar_capex * crf(r, solar_life) + land * r + solar O&M)
                    / (annual_MWh * sum_y f_y (1+r)^-y * crf(r, solar_life))     # gross of incentives
```

Unit costs ($/kg H2, $/t CO2, $/MCF, $/t methanol) use a cost cascade:

1. Power cost is solar, land and battery, annualized net of upfront support, plus their O&M. In AI mode only the chemical share of served energy counts.
2. Power cost is split by the electrolyzer/DAC power shares.
3. H2 and CO2 costs pass to each reactor by its feed share, so vented feed is charged to the product that vents it. Buffers are allocated by module.
4. Each cost is divided by year-1 output times the levelized chemical-energy factor.

Output-based credits are excluded.

IRR is reported only when one economically meaningful root exists. MIRR (finance and reinvest at `r`) is always shown next to it. MIRR is unique and exceeds `r` exactly when NPV is positive.

```text
cf_0 >= 0                                -> n/a (no net investment); also n/a if no later cash is positive
one sign change                          -> the unique root
several sign changes, sum(cf) >= 0       -> the single root >= 0, else "ambiguous (see MIRR)"
several sign changes, sum(cf) <  0       -> n/a: any root is an artefact of late outflows
mirr = (FV_r(inflows) / -PV_r(outflows))^(1/n) - 1
```

The inline optimizers sweep one slider at a time: battery size, chemical sizing or the methane/methanol split. They maximize IRR, or MIRR across the whole sweep if IRR is undefined anywhere in it (NPV as a last resort). Payback is reported as simple and as sustained (never dips negative again). It counts operating cash minus replacement CAPEX only, never the final-year salvage, and reads "not within horizon" when the outlay is not recovered. The "Viable" status needs both NPV > 0 and that payback.

With debt enabled, the headline IRR becomes equity IRR and equity MIRR is shown next to it. Project NPV stays unlevered (equity NPV is computed on the result but not displayed).

```text
debt        = debt_share (<= 90%) * net_capex_0;   fee = fee% * debt, paid by equity at close
payment     = debt * crf(i, term); a term longer than N leaves a balloon repaid in year N
equity_cf_y = cf_y - debt_service_y
DSCR_y      = (operating_cf_y - replacements_y) / scheduled_debt_service_y      # min/avg, flagged < 1.0x
sponsor_y   = max(0, -equity_cf_y)                     # debt service and/or replacement shortfalls
```

### CO2 and impact (`calculateEnvironmental`)

```text
captured    = DAC output
bound       = CO2 converted into methane, methanol and exploratory products
vented      = captured - bound                      # unconverted feed
net avoided = CH4_MCF * 0.0528 + MeOH_t * 1.374     # fossil fuel displaced (methanol incl. MTG feed)
```

0.0528 t/MCF is the combustion CO2 of pure CH4 (19.25 kg x 44.01/16.04). EPA's ~0.055 t/MCF is for pipeline gas. Carbon in a fuel returns to the air when it is burned, so capture is not removal: net avoided counts only displaced fossil combustion. Upstream emissions and leakage are excluded, and non-fuel exploratory products are counted as bound, not avoided.

## Defaults

All defaults live in `js/state/schema.js` (`CORE_STATE_FIELDS`), with the module, route and policy defaults in `js/data/modules.js` and `js/data/policies.js`. Print the full set with:

```bash
node --input-type=module -e "import {DEFAULT_STATE} from './js/model/index.js'; console.log(DEFAULT_STATE)"
```

The headline default scenario is:

- **Site:** Mojave Desert preset with base yield 1,974 MWh/MWdc-yr (PVGIS) on east-west fixed racking (x0.86). Earth annual-average view.
- **Plant:** 1 MWdc ($0.20/W modules, $0.12/W BOS), no battery, 100% chemical sizing. 30-year solar life with 0.65%/yr degradation.
- **Products:** methane only. Electrolyzer at 79 kWh/kg and $100/kW, DAC at 3,440 kWh/t and $450 per t-yr, Sabatier at 95% and $50/kW-CH4, 7-year process lives. Methane sells at $20/MCF. Methanol, MTG, exploratory routes, feed buffers, AI and debt are all off.
- **Policy and finance:** US 45V at $3.28/kg H2 for 10 years, an 8% discount rate and a 30-year horizon.

## Limitations

- **Weather is clear-sky-equivalent.** Every day has the clear-sky shape, scaled to the annual yield and diffuse fraction, with no multi-day cloudy spells. AI reliability and battery firming are therefore optimistic. Off-preset Earth yields use a latitude/GHI heuristic, so a manual PVGIS value is better.
- **Policy is simplified.**
  - Credits for self-consumed solar under 45Y, EEG, SDE++ and the CfD are a proxy, since real schemes pay metered or sold output and a CfD reference price has no meaning for on-site use.
  - Eligibility (lifecycle, wage, ownership, location, certification) is not legally validated, and award values are user inputs.
  - Upfront support is not re-applied to replacements, and custom support runs for the whole horizon.
- **45Q on CO2 made into fuel is an upper bound.** The IRC 45Q(f)(5)(B) lifecycle limit is not modeled.
- **Exploratory routes are rough placeholders.** Each has one electricity intensity, a flat cycling penalty, a generic 10-year life and a shared O&M %, with no thermal, startup, purity or logistics constraints. Their shared power pool is split by priority weight, not by each route's energy demand. Methanol feed reaches only MTG.
- **Process blocks follow solar freely,** with no minimum turndown, ramp limits or startup losses beyond the cycling penalty.
- **Feed-buffer inventory is a flat-supply upper bound,** and its $/kg and $/t costs are assumptions. Methanol tankage is ignored.
- **Some modes are stylized fallbacks.**
  - There is no hydrogen sales line, and with no product enabled H2 and CO2 are simply vented.
  - The battery has no capacity fade, and its life assumes one cycle per day.
  - AI compute is a constant-load token model, not a datacenter design.
  - Mars and Moon modes use literature-style benchmarks.
- **Finance is minimal.**
  - Prices and costs are constant real values: no inflation, escalation, taxes, depreciation, tax equity or working capital.
  - O&M is a flat % of CAPEX.
  - Salvage is straight-line book value (land at cost), not a resale estimate.
  - Debt is a single amortizing tranche sized on net CAPEX.

## Testing and validation

`npm test` runs `node --test` over `tests/`. The tests import the real modules, so no build step is needed.

- **Characterization snapshot** (`tests/calculations/characterization.test.js`): pins a digest of the full result tree for a matrix of scenarios (mountings, battery, sizing, product mixes, all exploratory routes, AI, Mars, Moon, financing, every selectable policy, sensitivity) against `tests/fixtures/characterization.json`. It is a refactor safety net, not a correctness check: it proves a restructuring changed nothing. When a model or result-shape change is intentional, regenerate it and review the diff:

  ```bash
  UPDATE_CHARACTERIZATION=1 node --test tests/calculations/characterization.test.js
  ```

- **Physics and invariants:**
  - The Meinel clear-sky formula, diffuse-fraction conservation, and mounting multipliers and optimal tilt within PVGIS ranges.
  - Energy balance and power limits of the dispatch, and the 100% sizing definition.
  - H2/CO2 mass balance.
  - CO2 captured = bound + vented, with net avoided never above the carbon bound in fuels.
  - Every exploratory route above its reaction-enthalpy floor.
  - Qualifying-output credit bases.
- **Hand-derived goldens:** CRF, IRR verdicts, MIRR, debt schedules and balloons, levelized identities, replacement timing and salvage, and buffer inventory.
- **Policy facts:** scheme defaults are re-derived from the IRS notices, auction results and ECB rates instead of being copied from `policies.js`.
- **UI and tooling:** control-spec and `index.html` contracts, renderers, charts, diagram, share links, saved sites, the optimizer worker, the build allowlist and dev-server hardening. These run in Node with small DOM stubs.

## Sources

This repo is based on public materials and should be read as an independent interpretation of those sources. Model data cite their own sources inline: PVGIS and Global Solar Atlas values in `js/data/reference-data.js`, and every incentive figure in `js/data/policies.js`.

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
