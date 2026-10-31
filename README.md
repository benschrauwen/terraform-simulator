# Solar Chemical/AI Plant Builder

An unofficial, MIT-licensed browser app that simulates a Terraform Industries-style plant: cheap local solar DC driving electrolysis and direct air capture, with the hydrogen and CO2 turned into methane or methanol. It is an educational techno-economic model for exploring trade-offs, not a bankable engineering or investment model.

The model leans into the Terraform thesis: very cheap solar, low-capex hardware that runs intermittently, and colocated conversion can matter more than high utilization or peak electrical efficiency.

What it models:

- Annual solar yield from PVGIS-based Earth site presets, a fallback estimate, or a manual value, on four mountings (fixed tilt, east-west, single-axis, dual-axis), plus rough Mars and Moon presets.
- An hour-by-hour annual dispatch of solar, an optional battery and the chemical plant, with intentional undersizing (clipping) via `chemicalSizingPercent`.
- Supported products: methane (Sabatier) and methanol, with H2 and CO2 shared between them by stoichiometry.
- Exploratory industrial routes with rough economics: MTG gasoline, CO2 to CO, ammonia, specialty carbon, lime, cement, steel, silicon, aluminum, titanium and desalination.
- An optional colocated AI datacenter: a constant IT load served before the chemicals, either the largest load the battery supports at a reliability target or a user-set load with the battery auto-sized to that target.
- Sourced and dated incentive schemes for the US, EU, Germany, the Netherlands, the UK and Spain, plus a custom mix.
- Project finance: replacements, salvage, NPV, IRR/MIRR, payback, levelized metrics, optional debt with DSCR, inline IRR optimizers, price sensitivities with break-even (NPV = 0) sale prices, and a yearly cash-flow table with CSV export.
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

`npm run build` copies an allowlist (`index.html`, `sources.html`, `datacenter.html`, `datacenter-sources.html`, `datacenter-sites.html`, `style.css`, `datacenter.css`, `js/`, the vendor files, `README.md`, `LICENSE`) into `dist/`. Assets go under `dist/assets/<buildId>/`, where the build ID is a short SHA-256 of the shipped asset files (so identical content keeps its URL and any change gets a new one; `BUILD_ID` overrides it), and the pages are rewritten to point at them. `DIST_DIR` changes the output directory.

The footer shows which release a visitor is looking at: `v<package.json version> · <commit date> · <short sha>`, stamped into each page in `dist/` by the build (the unbuilt page says "Development build"). Bump `version` in `package.json` when you cut a release. Vercel deploys `dist/` using `vercel.json`, which runs the build, marks `/assets/*` immutable and sets a strict Content-Security-Policy. The only external host the CSP allows is the Esri satellite tile server used by the site map.

### Two sites, one codebase

One build and one Vercel deployment serve two domains:

| Host | `/` | `/sources.html` | Entry module |
| --- | --- | --- | --- |
| terraform-simulator.com (and any other host) | `index.html` (plant builder) | `sources.html` | `js/main.js` |
| abundancestack.com, www.abundancestack.com | `datacenter.html` (Abundance Stack datacenter power & cooling simulator) | `datacenter-sources.html` | `js/datacenter-main.js` |

The routing lives in `vercel.json` as `routes` with a `has: [{ "type": "host" }]` condition (`/` and `/index.html` go to `datacenter.html`, `/sources.html` to `datacenter-sources.html`, `/sites.html` to `datacenter-sites.html`); the URL in the browser does not change. It uses legacy `routes` rather than `rewrites` because Vercel applies `rewrites` only after checking the filesystem, and `/` and `/sources.html` exist as files, so a host rewrite would never fire. `datacenter.html`, `datacenter-sources.html` and `datacenter-sites.html` also work directly on any host.

Locally, `scripts/dev.mjs` reads the same routes and treats `<name>.localhost` as `<name>.com`, so `npm run dev` serves:

- http://127.0.0.1:4173/ (or localhost): the plant builder;
- http://abundancestack.localhost:4173/: the datacenter simulator (Chrome and Firefox resolve `*.localhost` to loopback; elsewhere add `127.0.0.1 abundancestack.localhost` to `/etc/hosts`).

`npm run preview` applies the same routing to `dist/`. The datacenter code lives in `js/data/datacenter/`, `js/model/datacenter/` and `js/ui/datacenter/`; URLs cited there (and in `datacenter.html`) belong on `datacenter-sources.html`, everything else on `sources.html` (`tests/ui/sources-page.test.js` checks both).

## Architecture

```text
js/data/      reference data and pure accessors over it: bodies, site presets, mountings,
   |          chemistry, MODEL_ASSUMPTIONS, process module/route catalog + ModuleCatalog,
   v          policy registry
js/state/     schema + DEFAULT_STATE (frozen), normalization, legacy migrations,
   |          share-link codec, saved sites
   v
js/model/     calculation engine; index.js assembles the Calc facade
   |
   v
js/ui/        App class + mixins, declarative controls, renderers, charts, diagram, site map
js/workers/   optimizer-worker.js: runs the IRR search through Calc off the main thread
js/util.js    dependency-free numeric helpers (clamps, step precision), usable by every layer
```

Imports run one way, top to bottom: a layer imports its own files, lower layers and `util.js`, never a higher layer. `tests/architecture/import-direction.test.js` enforces it.

- `js/data/`: `reference-data.js` (bodies, `LOCATION_PRESETS`, `MOUNTING_TYPES`, `CHEMISTRY`, `METHANE_MARKET_PRESETS`, AI defaults), `assumptions.js` (`MODEL_ASSUMPTIONS`, the GHI/cloudiness heuristics and `SOLAR_LAYOUT_REFERENCE`), `modules.js` (supported and exploratory process modules), `module-catalog.js` (`ModuleCatalog`: normalizes `modules.js` into frozen modules and answers route, preset, market, buffer and capex-slider questions), `policies.js` (incentive schemes and picker groups), `market-ladders.js` (Terraform's methane and methanol market tiers), `sensitivity-variables.js` (the inputs the NPV tornado moves and their low/high bounds).
- `js/data/datacenter/`: the datacenter simulator's sourced data: `gpu.js` (GPU platforms for the default GPU-rental business), `sites.js` (site presets with PVGIS yield and 12 x 24 typical-day dry/wet-bulb temperatures, grid price and CO2), `cooling.js` (PUE and water curves per cooling technology), `facility.js` (building, IT, colocation, water, lead times), `power.js` (grid, gas gensets, nuclear types, architectures, power lead times), `model-assumptions.js` (constants the data files do not give, each derived or marked judgment) and `sensitivity-variables.js` (its tornado inputs).
- `js/state/`: `schema.js` is the single source of state fields and defaults; `datacenter-schema.js` is the datacenter simulator's (fields, `DATACENTER_DEFAULT_STATE`, `normalizeDatacenterState`, preset-derived defaults).
- `js/model/`: one file per concern: `solar.js` + `solar-geometry.js` (resource, sky model, mountings), `annual-series.js` (hourly year), `battery.js` (storage + chemical dispatch), `ai-compute.js`, `lifetime-energy.js`, `process.js` (allocation, electrolyzer, DAC, reactors, exploratory routes, buffers), `economics.js`, `finance.js`, `policy.js`, `optimizer-search.js`, `break-even.js` (NPV = 0 sale prices), `cash-flow-table.js` (yearly cash-flow rows + CSV), `scenario.js` (the pipeline), and two pure helpers the UI imports directly: `market-ladder.js` and `tornado.js` (one-at-a-time NPV sensitivity).
- `js/model/datacenter/`: the datacenter engine, one file per concern (`climate.js`, `gpu.js`, `supply.js`, `dispatch.js`, `impacts.js`, `schedule.js`, `economics.js`, `warnings.js`, `tornado.js`), assembled by `scenario.js` (`calculateDatacenterScenario`, result shape documented at its top) and exported from `index.js`. It reuses the plant builder's solar model, battery primitives, `finance.js`, `summarizeReturns`, the tornado bounds and the cash-flow table. See [Datacenter model](#datacenter-model).
- `js/ui/`: `app.js` plus mixins, `control-spec.js` + `controls.js`, `module-controls.js`, `renderers/`, `charts/` (one module per chart, registered in `charts/index.js`), `diagram.js`, `site-map.js`, `share.js`, `optimizer-client.js`, `formatters.js`.
- `js/ui/datacenter/`: the datacenter page's `DatacenterApp` (see [Datacenter UI](#datacenter-ui)). It reuses the generic UI modules (`control-binding.js`, `layout.js`, `tooltips.js`, `slider-markers.js`, `share-feedback.js`, `renderers/cash-flow-table.js`, `charts/economics-timeline-chart.js`, `charts/tornado-chart.js`), each of which takes an optional hook (`this.runTornadoModel`, `this.sliderMarkerDefinitions`, `this.cashFlowColumnTooltips` / `cashFlowColumnLabels` / `buildCashFlowCsvHeader`, `this.economicsTimelineText`) that the plant builder leaves unset.
- `scripts/`: `dev.mjs` (hardened static server that also applies the `vercel.json` routes: headers, CSP included, and host-based page routing) and `build.mjs`.

**Key rule:** `data/`, `state/` and `model/` never touch the DOM. They run unchanged in the browser, in the worker and under Node tests. (`state/saved-site-presets.js` uses `localStorage` behind a guard.) The UI talks to the engine through the `Calc` facade, `ModuleCatalog`, `PolicyModel` and the schema exports (`DEFAULT_STATE`, `CORE_STATE_FIELDS`), and imports `data/` directly for option lists and labels. Every string the UI interpolates into HTML goes through `escapeHtml` (`ui/renderers/markup.js`); visibility is toggled with `el.hidden`, never inline styles (the CSP allows none).

**Calc.** Each model file exports a plain method object (`solarMethods`, `processMethods`, `economicsMethods`, ...). `model/index.js` merges them with `Object.assign` into one `Calc` object. Methods call each other through `this`, so always call them through `Calc` (for example `Calc.calculateAll(state)`) and never detach them. Pure helpers such as `finance.js`, `util.js` and `state/normalize.js` are plain functions that the facade re-exposes. The main entry points are:

- `calculateAll(state)` / `calculateScenario(state, { fastMode })`: the full result tree.
- `calculateIrr` / `calculateReturnMetrics`: the lean path, which skips display series.
- `runSensitivity`, `calculateBreakEvenPrices`, `findBestRangeValueForIrr` and `normalizeState`.

`scenario.js` runs this pipeline:

```text
normalizeState -> calculateSolar -> buildAnnualSolarSeries
  -> calculateBattery (chemicals only) | calculateAICompute (AI first)
  -> buildProcessAllocationPlan -> electrolyzer, DAC -> methane/methanol reactors
  -> exploratory routes -> methanol export -> feed-buffer storage
  -> calculateEconomics -> calculateEnvironmental
```

`calculateEconomics` returns `capexItems`, the one list of installed-CAPEX items (`{ key, label, capex }`, solar with its parts, one item per exploratory route). The total CAPEX, the `'total'` policy basis, the CAPEX rows and the CAPEX chart all iterate it.

**App mixins.** `App` (`ui/app.js`) owns `state`, `init()` and `recalculate()`. All other behavior lives in mixin objects (`controlMethods`, `rendererMethods`, `chartMethods`, `siteControlMethods`, ...) that are `Object.assign`ed onto `App.prototype`. Each mixin method runs with the App instance as `this`. State-backed inputs are declared once in `CONTROL_SPECS` and `getModuleControlSpecs()` (`ui/control-spec.js`). That one list drives both input-to-state binding and state-to-control sync. `recalculate()` renders the panels and calls `updateCharts(r)` once. The Sensitivity charts (price curves and the NPV tornado) rerun the model, so they refresh through `updateSensitivityCharts(r)`, debounced (`scheduleSensitivityUpdate`) while a slider is dragged.

## Extending

After any of these changes, run `npm test`. Every recipe that changes the result tree also needs a characterization fixture regeneration (see [Testing](#testing-and-validation)).

| Task | Files touched |
| --- | --- |
| Exploratory route or new product (incl. a methanol consumer) | `js/data/modules.js` + its floor in `tests/calculations/energy-floor.test.js` |
| Policy scheme | `js/data/policies.js` (+ its facts in `tests/calculations/policy-facts.test.js`) |
| Earth site preset | `js/data/reference-data.js` |
| Market ladder tier | `js/data/market-ladders.js` |
| NPV tornado variable | `js/data/sensitivity-variables.js` |
| State field + control | `js/state/schema.js`, `index.html`, `js/ui/control-spec.js` |
| Result row | the model file that computes it, `js/ui/renderers/economics.js` or `renderers/index.js` |
| Chart | a module in `js/ui/charts/`, one `RESULT_CHARTS` entry, its `<canvas>` in `index.html` |

**Add an exploratory route or a new product.** Methane and methanol are the only *supported* products, and no third one is planned: anything else the plant should make (a fuel, a chemical, a metal, water) goes through the data-driven exploratory path.

1. In `js/data/modules.js`, add an entry under an existing module's `routes`, or a new `MODULE_DEFINITIONS` entry with `exploratory: true`, a `family` key from `MODULE_FAMILY_LABELS`, a `market` (sale-price slider), `routes` and `missingInputs`. A route has:
   - `label`
   - `electricityKwhPerUnit`: electricity per output unit, excluding the H2 the route consumes. Add a comment stating its basis.
   - `capexPerAnnualUnit` with `capexUnit`: `'tpa'` for $ per t/yr, or `'m3pd'` for $ per m3/day.
   - `cyclingPenalty`
   - `feedstocks`: kg per output unit of `h2Kg` and `co2Kg` (from the shared electrolyzer / DAC pools) and `methanolKg` (from the methanol reactor). Any route with `methanolKg > 0` is a methanol consumer: it shares the methanol diverted from export (the split slider in the MTG card) with the other methanol consumers by priority x kg/unit, and its power follows the methanol it gets.
   - `feedstockSummary`, `outputLabel` and `outputUnit`
   - Optional: `supportsFeedBuffer`, a route-level `market` (overrides the module's sale-price slider), and `assetLifeYears` (default 10).
   - If the route needs another module, add it to the module's `routeDependencies` (or the module's `dependencies`).
2. Add the route to `FLOORS` in `tests/calculations/energy-floor.test.js`. The value is its reaction-enthalpy floor, or `null` with the reason (an external reductant supplies the energy). Unlisted routes fail that test.

The catalog derives everything else: the state keys (`<id>Enabled`, `BufferEnabled`, `Route`, `PriorityWeight`, `CapexBasis`, `Price`), normalization, the route select, the capex slider (0.25-4x the route default), the buffer toggle, the diagram card and its feed lines (from `feedstocks`), the CAPEX item, chart slice and economics rows. Only MTG-specific presentation (its split slider and note) is keyed by id in `ui/module-controls.js`.

**Add an NPV tornado variable.** Append an entry to `SENSITIVITY_VARIABLES` in `js/data/sensitivity-variables.js`: the `stateKey` it moves (a numeric schema or module-config field), a `label`, a display `format` and an `appliesTo(state, result)` predicate that is false when the input cannot matter for the build (product off, no battery, AI off). By default it swings by the user's chosen ±% around its current value; give it `bounds: { kind: 'absolute', low, high }` only when it has a real range, as the incentive credit does. `runTornado` clamps values to the field's schema range and drops rows that do not move NPV; `tests/calculations/tornado.test.js` checks every variable resolves against the schema.

**Add a policy scheme:**

1. In `js/data/policies.js`, add a `POLICY_SCHEMES` entry. It needs display metadata (`label`, `jurisdiction`, `note`, `basis`, `implementationFormula`, ...) and `durationYears`: years of annual support, `0` for one-off support, or `null` to pay over the whole horizon. It also needs a `cashflowType` and `inputs`, each input naming its `role` in that type's formula (`CASHFLOW_INPUT_ROLES` in `model/policy.js`):
   - `capex_share`: `share` (0-1) of `eligibleCapexBasis` (`'solar' | 'electrolyzer' | 'dac' | 'total'`, picked from `capexItems`), paid once at close.
   - `unit_support`: `perUnit`, $ per unit of `outputBasis` (`'solar_kwh' | 'solar_mwh' | 'hydrogen_kg' | 'co2_ton'`).
   - `strike_minus_reference`: `strike` and `reference`. Support can go negative.
   - `base_minus_correction`: `base` and `correction`, floored at 0.
   - `framework_only`: no inputs, no cash flow.

   Each input also has `key`, `label`, `min`/`max`/`step`, `defaultValue` and `format` (`'share'`, `'currency_per_kwh'`, `'currency_per_mwh'`, `'currency_per_kg'`, `'currency_per_ton'` with a display `unit` such as `'tCO2'`). Each key becomes a state field automatically (`POLICY_INPUT_FIELDS`), so share a key between schemes only when it is the same quantity. Put a source comment next to every number. `policy-schemes.test.js` checks the roles.
2. List the id in a `POLICY_SELECT_GROUPS` group. A scheme that is not listed is still valid in state but cannot be picked.
3. Add re-derived facts to `tests/calculations/policy-facts.test.js`. Every selectable scheme is a characterization scenario, so regenerate the fixture.

The input controls render from `inputs` (`renderPolicyInputs`). Only a new cash-flow type or basis needs code in `model/policy.js` (`evaluatePolicy`, `getOutputMetric`, `getEligibleCapexBreakdown`) and in `economics.getYearlyEnergyFactors`.

**Add an Earth site preset:**

1. Add an entry to `LOCATION_PRESETS` in `js/data/reference-data.js`:
   - `name`, `lat`, `lon`
   - `ghi`: PVGIS `H(i)_y` at 0 deg tilt, in kWh/m2/yr.
   - `baseYield`: PVGIS v5.3 PVcalc `E_y` for crystalline Si, 14% loss, free-standing, optimal tilt.
   - `diffuseFraction`: Global Solar Atlas DIF/GHI. Omit it to use the cloudiness heuristic.
   - `region`: `desert | temperate | tropical | cloudy`. This drives layout/BOS cloudiness and the fallback diffuse fraction.
2. Run the tests. `energy-model.test.js` checks that yield/GHI is 0.72-1.0 and the diffuse fraction is 0.1-0.7.

The dropdown lists the new preset automatically. A selected preset is stored as lat/lon/yield and matched back within 0.1 deg, so the array order does not matter. The preset also becomes the "nearby preset" (its GHI, diffuse fraction and estimated yield) for any location within 2 deg latitude and 3 deg longitude. A methane market framing is likewise one `METHANE_MARKET_PRESETS` entry (an optional `group` puts it in an optgroup).

**Add a state field and its control:**

1. Add `{ key, type, min, max, defaultValue }` to `CORE_STATE_FIELDS` in `js/state/schema.js`. `type` is `number`, `integer`, `boolean`, `enum` or `string`. `DEFAULT_STATE`, clamping in `normalizeState` and share links then follow automatically. Share links store only differences from defaults, so changing a default later changes what old links mean. Exceptions:
   - A per-module slider belongs in that module's `configs` (`data/modules.js`).
   - A policy input belongs in the scheme's `inputs`.
   - A fixed constant that users cannot change belongs in `MODEL_ASSUMPTIONS` (`data/assumptions.js`).
2. Add the element to `index.html`. Give it the default as its static `value`, plus a `<span id="<id>Value">` read-out that shows the formatted default. A log-scale slider takes `data-scale="log"` with `min`/`max`/`value` as log10 of the state values (see `aiLoadKW`).
3. Add `{ type: 'range' | 'checkbox' | 'select' | 'number', id, stateKey?, format?, onChange? }` to `CONTROL_SPECS` in `js/ui/control-spec.js`. Binding and sync come from that entry. `tests/ui/control-spec.test.js` checks that the element exists and that its pre-JS value and read-out match `DEFAULT_STATE`.
4. Read the value from the normalized state in the model (it is always present and clamped, so no fallback is needed).

**Add a result row:**

1. If the value is not on the result yet, compute it in the model file that owns it (for economics, one of `calculateEconomics`'s helpers in `js/model/economics.js`: `buildCapitalAssets`, `buildYearlyCashFlows`, `summarizeReturns`) and return it. That changes the characterization tree, so regenerate the fixture.
2. Render it. The economics panel is built group by group in `js/ui/renderers/economics.js` (`buildSummaryMetrics`, `buildReturnsRows`, `buildCostRows`, `buildRevenueRows`, `buildFinancingRows`, `buildUnitRows`, `buildContextRows`). Rows use `econRow(label, value, cssClass, tooltip)` from `renderers/markup.js`, which escapes its arguments. The production and impact grids in `renderers/index.js` use `prodItem(cls, label, value, unit)`. Format values with `FormatNumbers` and `ui/formatters.js`. A new installed-CAPEX block is one more entry in `buildCapitalAssets`' `coreAssets` (plus a color in `charts/capex-chart.js`); rows, chart and policy basis follow.
3. Optionally assert on the HTML in `tests/renderers/`. Those tests render real results with stubbed DOM elements.

**Add a chart:**

1. Add a module in `js/ui/charts/` exporting `{ updateXChart(r) { ... } }`. Start it with `if (!ensureChartRuntime(this, 'x', 'xChart')) return;` (it shows a fallback when Chart.js failed to load), keep the instance in `this.charts.x`, and style it with the helpers in `chart-utils.js`.
2. Add `[xChartMethods, 'updateXChart']` to `RESULT_CHARTS` in `js/ui/charts/index.js`. `App.recalculate` calls `updateCharts(r)`, which draws every registered chart.
3. Add `<canvas id="xChart">` inside a `.chart-wrapper` in `index.html`. Size it with CSS classes, not inline styles.

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

AI mode serves solar in this order: the constant AI load, then battery charging (the battery discharges only to AI), then the chemicals. Reliability is the share of hours of the settled year-1 dispatch in which the load runs at full rate (clear-sky-equivalent). `aiSizingMode` picks what is solved:

```
'max' (default, "Max for battery"):
  load_kW    = max { L : reliability(L, battery) >= target }          (doubling + bisection)
'fixed' ("Set load"):
  load_kW    = aiLoadKW  (clamped to the array DC peak, systemSizeMW * 1000)
  battery    = min { B : reliability(load, B) >= target }               (bisection, to 1e-4 of B)
               over 0 <= B <= load * cycle hours * 7   (a week of autonomy on Earth)
  infeasible : reliability(load, cap) < target -> battery = cap, ai.loadFeasible = false,
               maxFeasibleLoadKW = max { L : reliability(L, cap(L)) >= target }
```

The fixed-mode battery uses the Battery Storage duration (C-rate, both ways), efficiency and leakage, and replaces `batteryCapacityMWh` for dispatch, CAPEX and replacements; the user's own value stays in state (and in share links) for "Max for battery". It is returned as `ai.batterySizing`. Chemical 100% is the peak residual power at the design load. With no battery, "Max for battery" seeds 1 MWh per GWh/yr of solar and says so. GPU CAPEX is `$/kW * load`, O&M is 3%/yr of it, and `revenue = served MWh * M tokens/MWh * $/M tokens`. Load, energy and CAPEX are per facility kW (cooling included); tokens count input + output with a blended price, as the InferenceX benchmarks and Artificial Analysis price comparisons do. Defaults (`AI_COMPUTE_DEFAULTS`, checked 2026-10): $50k/kW (Terraform's figure), 6,000 M tokens/MWh (Blackwell serving a frontier open MoE, about half of benchmark peak), $0.35/M blended (open-weight model pricing), so $2,100/MWh of revenue, close to renting the same power out as Blackwell GPUs.

Battery CAPEX is `$/kWh * capacity`. Its life is `min(12 yr, rated cycles / EFC per year)`, where equivalent full cycles per year = year-1 energy discharged (annualized to an Earth year) / capacity, in both chemical and AI dispatch.

### Lifetime energy (`lifetime-energy.js`)

The plant is sized on year-1 solar. The fixed design (AI load, chemical capacity, battery) is then re-dispatched at four PV output factors spanning the horizon, and the energies are interpolated per project year:

```text
solar_factor_y = (1 - degradation)^((y - 1) mod solar_asset_life)    # resets after repowering
ai_factor_y    = ai_served(solar_factor_y)   / ai_served(1)
chem_factor_y  = chemical_kWh(solar_factor_y) / chemical_kWh(1)
```

AI has first call on solar, so it loses less than the PV output while the residual chemistry loses more. The AI panel reports the lowest yearly reliability.

### Process chain (`process.js`)

Power and feeds are auto-balanced from the enabled consumers. A consumer's weight is in its own output units: its methane/methanol by-mass share of the product slate (x100), or an exploratory route's priority weight (0-100). A methanol-consuming route (any route with `methanolKg` in its feedstocks, e.g. MTG) has no free priority: its weight is the product its methanol can make.

```text
h2_power   = sum_i w_i * h2_kg_per_unit_i  * electrolyzer_kWh_per_kg
co2_power  = sum_i w_i * co2_kg_per_unit_i * dac_kWh_per_kg
route_j    = w_j * electricity_kWh_per_unit_j            # each route's own power demand
total      = h2_power + co2_power + sum_j route_j
electrolyzer_share = h2_power / total;  dac_share = co2_power / total
exploratory_share_j = route_j / total                     # weight x kWh/unit, not weight alone
h2_feed_share_i  = w_i * h2_kg_per_unit_i  / sum_k w_k * h2_kg_per_unit_k   (same for CO2)
methanol routes: diverted = methanol split (slider);  pool_m = p_m * meoh_kg_m / sum_k p_k * meoh_kg_k
                 w_m = w_methanol * conversion * diverted * pool_m * 1000 / meoh_kg_m
```

Because the feed and power splits use the same `weight * per-unit need`, each consumer gets power, H2 and CO2 in the ratio it uses them, so no input is stranded behind another's limit. The only unused feed is each reactor's unconverted fraction. For example, methane + methanol 50/50 at 95%/80% conversion leaves 9.1% of the H2 and 10.0% of the CO2 unused. A disabled electrolyzer or DAC gets no power. With no product reactor or route enabled, the enabled blocks split power in the methane stoichiometric ratio (0.503 kg H2 and 2.744 kg CO2 per kg CH4: ~81/19 at defaults; a lone block gets it all) and everything is vented. Unconverted reactor feed is vented, not recycled to the reactor inlet. The allocation result carries a `kind` (`productMix`, `methane`, `methanol`, `exploratoryOnly`, `methaneFallback`) that the UI labels from.

```text
H2 kg      = electrolyzer_kWh / kWh_per_kg      (LHV efficiency = 33.33 / kWh_per_kg; HHV floor 39.4)
CO2 t      = dac_kWh / kWh_per_t
CO2 + 4 H2 -> CH4 + 2 H2O:  CH4 = min(H2/0.503, CO2/2.744) * conversion;  MCF = kg / 19.25
CO2 + 3 H2 -> CH3OH + H2O:  MeOH = min(H2/0.189, CO2/1.374) * conversion; export = reactor - methanol-route offtake
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
- An exploratory route is sized on its peak hourly output. CAPEX is that rate times `cycle hours * cycles per year * $/t-yr * cycling penalty` (or `* 24 h * $/m3/day * penalty` for water: per Earth day of nameplate, so the same hardware costs the same on any body), with a 10-year life and the shared exploratory O&M %.

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
buffered LCOE     = (solar LCOE numerator + battery_capex * crf(r, battery_life) + battery O&M)
                    / (delivered_MWh_1 * sum_y d_y (1+r)^-y * crf(r, N))           # gross of incentives
                    d_y = (chemical + AI-served kWh)_y / year-1, from the lifetime-energy vectors
```

Unit costs ($/kg H2, $/t CO2, $/MCF, $/t methanol) use a cost cascade:

1. Power cost is solar, land and battery, annualized net of upfront support, plus their O&M. In AI mode the battery (it discharges only to the AI load) goes wholly to AI, and solar + land are split by AI-served vs chemical energy; AI cost + chemical-plant cost = the total asset-life annual cost. The AI token cost is divided by levelized token output (AI-served energy factor).
2. Power cost is split by the electrolyzer/DAC power shares.
3. H2 and CO2 costs pass to each reactor by its feed share, so vented feed is charged to the product that vents it. Buffers are allocated by module.
4. Each cost is divided by year-1 output times the levelized chemical-energy factor.

Capital charges are net of upfront support at close (ITC, grants); output-based credits are excluded. Both LCOE figures are gross of incentives.

IRR is reported only when one economically meaningful root exists. MIRR (finance and reinvest at `r`) is always shown next to it. MIRR is unique and exceeds `r` exactly when NPV is positive.

```text
cf_0 >= 0                                -> n/a (no net investment); also n/a if no later cash is positive
one sign change                          -> the unique root
several sign changes, sum(cf) >= 0       -> the single root >= 0, else "ambiguous (see MIRR)"
several sign changes, sum(cf) <  0       -> n/a: any root is an artefact of late outflows
mirr = (FV_r(inflows) / -PV_r(outflows))^(1/n) - 1
```

The inline optimizers sweep one slider at a time: battery size, chemical sizing or the methane/methanol split. They maximize IRR, or MIRR across the whole sweep if IRR is undefined anywhere in it (NPV as a last resort). Payback is reported as simple and as sustained (never dips negative again). It counts operating cash minus replacement CAPEX only, never the final-year salvage, and reads "not within horizon" when the outlay is not recovered. The "Viable" status needs both NPV > 0 and that payback.

With debt enabled, the headline IRR becomes equity IRR and equity MIRR is shown next to it. Project NPV stays unlevered; equity NPV is shown in the financing rows, discounted at the project discount rate (no separate cost of equity).

```text
debt        = debt_share (<= 90%) * net_capex_0;   fee = fee% * debt, paid by equity at close
payment     = debt * crf(i, term); a term longer than N leaves a balloon repaid in year N
equity_cf_y = cf_y - debt_service_y
DSCR_y      = operating_cf_y / scheduled_debt_service_y      # CFADS before major replacements (reserve-funded); min/avg, flagged < 1.0x
sponsor_y   = max(0, -equity_cf_y)                     # debt service and/or replacement shortfalls
```

### Break-even prices and cash-flow table (`break-even.js`, `cash-flow-table.js`)

For each product the build sells (methane, exported methanol, AI tokens, each modeled exploratory route) the break-even price is the sale price at which project NPV = 0 with every other input fixed: other prices, policy credits, costs and the plant design. A product's revenue is volume x price x that year's output factor and nothing else reads the price, so NPV is exactly linear in it and two runs (the current price and one more, on the fast path) give the root:

```text
NPV(p)   = NPV(p0) + (p - p0) * V,   V = volume_1 * sum_y factor_y / (1 + r)^y
p*       = p0 - NPV(p0) / V
```

Zero volume gives no break-even. A negative `p*` is reported as such: NPV stays positive even if that product were given away. The Unit economics rows show `p*` next to the current price; the NPV-vs-price sensitivity charts (linear price axis) mark it with a dashed line, extending the sweep with one run when `p*` lies just outside it.

The "Yearly cash flows" table under Economics Over Time lists years 0..N as signed project cash: product revenue, operating policy credits, O&M, replacement CAPEX, salvage, net cash flow, discount factor, discounted and cumulative discounted cash flow, plus debt service and equity cash flow with financing. Year 0 is net CAPEX at close (gross CAPEX less upfront support); the last cumulative discounted value is the NPV, and the simple-payback year is highlighted. "Download CSV" saves the same rows at full precision under a header with the scenario link and key inputs (a Blob object URL on a temporary `<a download>`, which the CSP allows).

### CO2 and impact (`calculateEnvironmental`)

```text
captured    = DAC output
bound       = CO2 converted into methane, methanol and exploratory products
vented      = captured - bound                      # unconverted feed
net avoided = CH4_MCF * 0.0528 + MeOH_t * 1.374     # fossil fuel displaced (methanol incl. route feed, e.g. MTG)
```

0.0528 t/MCF is the combustion CO2 of pure CH4 (19.25 kg x 44.01/16.04). EPA's ~0.055 t/MCF is for pipeline gas. Carbon in a fuel returns to the air when it is burned, so capture is not removal: net avoided counts only displaced fossil combustion. Upstream emissions and leakage are excluded, and non-fuel exploratory products are counted as bound, not avoided.

### NPV tornado (`tornado.js`)

The "What drives NPV" card at the top of Sensitivity is a one-at-a-time tornado. For each input in `js/data/sensitivity-variables.js` that applies to the build, it reruns the scenario (fast path, same NPV as the full run) with that input moved down and up by the chosen swing (±10/20/30/50% of its current value, default ±20%, `tornadoSwingPercent`, kept in share links) and every other input at its current value:

```text
bar_i     = [NPV(x_i * (1 - s)), NPV(x_i * (1 + s))], s = chosen swing, clamped to the field's limits
swing_i   = max(NPV_base, NPV_low, NPV_high) - min(NPV_base, NPV_low, NPV_high)
rows      sorted by swing, largest first; rows with no NPV change are dropped
```

Because every input moves by the same percentage, bars compare like with like and are always centred on the current setup; they do not say how uncertain each input is (a ±20% methane price is far more likely than a ±20% site yield). Values never pass a field's schema limits, so a bar can be one-sided near a limit (95% conversion cannot go above 100%). The active policy's credit is the exception: it runs over its real range, from the scheme's floor (0, or the lowest statutory tier where the slider stops above 0) to its current value. The tornado ignores interactions: two inputs moving together can shift NPV by more or less than the sum of their bars. A refresh takes about 25 fast runs: ~20 ms at the defaults, ~200 ms with AI (its hourly battery dispatch dominates).

### Market ladder (`market-ladder.js`)

The Market Ladder chart places the site on Terraform's market ladder for each product it sells (tiers from Terraform's scale-up roadmap, `js/data/market-ladders.js`). Each tier has a price and the cumulative market size down to it; its own volume is its share of that market divided by its price, and shelves stack left to right on log axes.

```text
tier_volume_i      = (cumulative_market_i - cumulative_market_(i-1)) / price_i
site point         = (annual volume sold, levelized unit cost)
                     methane: MCF/yr x 1.01 MMBtu/MCF, costPerMCF / 1.01 (pure CH4 HHV)
                     methanol: exported t/yr, costPerTonMethanol
tiers cleared      = tiers with price >= site unit cost
```

The unit cost is the allocated plant cost per unit, excluding output credits. The dashed line is the assumed sale price. The ladder's x-axis is market volume, not this site's cost curve: Terraform's learning-curve path is not drawn.

## Datacenter model

The Abundance Stack page (`datacenter.html`) runs `js/model/datacenter/`: one year of hourly dispatch for a datacenter and its power supply, the water, heat and CO2 that follow, a project schedule and the economics. Every number comes from `js/data/datacenter/` (sourced there) or is marked judgment in `model-assumptions.js`.

### Load and cooling (`climate.js`)

```text
IT(h)        = IT capacity x utilization                      # constant (GPU rental: occupancy-driven draw)
PUE(h)       = 1 + overhead + cooling(T(h))                   # cooling.js curves
cooling(T)   = free-cooling fraction                if T < changeover
             = interpolate(mechanical curve, T)     otherwise
load(h)      = IT(h) x PUE(h)
WUE(h)       = interpolate(litres per kWh IT, T(h))           # withdrawn water
T(h)         = the site's typical-day dry- or wet-bulb for that month and hour (local standard time)
design peak  = IT nameplate x max PUE                         # sizes grid connection and substation
```

Annual PUE is facility energy / IT energy. At the cooling.js calibration climates the model reproduces the calibrated PUE within 0.01 (Phoenix; New Albany OH for the 11.3 °C Chicago case).

### Supply and dispatch (`supply.js`, `dispatch.js`)

- **Solar** (hybrid and islanded; grid-connected designs have none) reuses the plant builder's solar model: annual energy = MWdc x site PVGIS yield x mounting multiplier, on the clear-sky hourly plane-of-array shape with the site's own diffuse fraction, shifted from solar to local standard time. Each day is then scaled by the site's `dailySolarFactor` (that PVGIS TMY day's horizontal irradiation / its month's mean, `sites.js`) and the year is rescaled to the same annual energy with every hour capped at nameplate, so cloudy spells and clear days follow the TMY sequence while monthly and annual energy stay put. Costs and land come from `calculateSolar` on the measured 2026 build cost basis.

  ```text
  solar(h) = s x clearSkyPOA(h) x dailySolarFactor(day(h)),  capped at MWdc;  s: sum_h solar(h) = MWdc x yield x multiplier
  ```
- **Grid**: connected in `grid` and `hybrid`, import cap 0 = design peak. Firm service is not uninterruptible: every connection has `firmGridOutageHoursPerYear` of utility outages (default 3 h/yr). Electricity Canada's transmission composite (BC Hydro's F2024 reliability filing) averages 2.68 h and 0.82 sustained interruptions per delivery point a year over F2015-F2023, about 3.3 h each; US distribution customers see more (EIA Table 11.1, IEEE 1366: SAIDI 6.1 h with major event days, 2.1 h without, in 2023; 11.0 h and 2.2 h in 2024), but most of that starts on the distribution system, which a transmission-served load bypasses. The default rounds the transmission figure to whole hours (judgment). Outages come as ceil(N / 3) events of up to 3 h, the first on 15 July from 15:00 local standard time and the rest spread evenly over the year at the same hour (deterministic, judgment). Without backup, 3 h/yr gives 8757 / 8760 = 99.966% uptime, below the Tier III 99.982% (1.6 h/yr) target, so standby generation or a reserve battery is needed to meet it, which is what the Uptime Institute's Tier Standard assumes (it treats the utility as an economic alternative to the engine-generator plant). A flexible connection (hybrid only) is in addition curtailed for N hours a year, placed as contiguous 4-hour events (the low end of the 4-16 h curtailments in the Camus study) from 17:00 local standard time (18:00-22:00 summer clock time, the evening net-load peak: PJM's 2025 concept paper shows load peaking at 5-6 p.m. and net load at 9 p.m., ERCOT put its critical risk at 8-9 p.m. when solar falls) on the days of highest facility load, skipping days with an outage so the two add up. Curtailments are announced ahead, so in the 12 h before one (`flexibleEventPrechargeHours`, judgment) any battery is charged to full from spare grid; utility outages are not anticipated. Until Oct 2026 the events followed the site's own afternoon load peak, when its solar still covered much of them, which favoured hybrid solar designs.
- **Firm generation**, one family at a time. Gas: `auto` = the fewest units with which the dispatch meets the uptime target given the grid (outages, curtailments, import cap), solar and battery, plus the spare units (default N+1) when at least one unit is needed (`firm-sizing.js`, below); each unit is out (1 - availability) x 8760 h in a block, units maintained one after another from 1 March. Fuel uses the plant's committed units at equal loading, with the heat rate rising linearly to the 50%-load penalty (floored at the minimum stable load). **Hot weather** (`power.js` `ambientDerate`): above a reference dry bulb each unit's output falls, and its heat rate rises, by a sourced %/°C, applied per hour at the site's typical-day temperature, so auto sizing adds units for hot hours and fuel rises: aeroderivatives 0.86%/°C output, 0.2%/°C heat rate above 15 °C (LM6000 without inlet cooling), industrial turbines 0.7 / 0.2 (SGT-800), mobile turbines 0.8 / 0.36 (Titan 130), CCGT 0.5%/°C (judgment between ~0.45 and ~0.96%/°C in the literature; CPUC's CAISO calibration found only ~0.17), engines 0.18 / 0.18 above 25 °C (EPA CHP Catalog), standby diesel 1.2%/°C above 45 °C, fuel cells none (Bloom: -20 to 45 °C). No uplift below the reference and no inlet cooling (both conservative); the merit-order cost uses the rated heat rate. The gas family's types burn natural gas except **standby diesel** (`power.js` `standby-diesel`, the default type and the only one a grid-connected design may have): 3 MW units (Cat 3516C/E, Cummins QSK95, MTU 20V4000 DS3000 class), 9.55 MMBtu/MWh HHV from the datasheets' full-load fuel x 0.138 MMBtu/gal, $1,000/kW installed (NREL via Latitude Media 2026; $550-1,300 range), $15/kW-yr fixed O&M (judgment, PNNL basis), 99% availability (judgment), 10-second starts (NFPA 110 Type 10). Its fuel is diesel at $33/MMBtu (EIA STEO 2026 retail $5.19/gal less 59.9 c/gal road taxes, / 0.138) and 73.96 kg CO2/MMBtu (40 CFR 98 Table C-1). It is `standbyOnly`: never dispatched on cost against an available grid. EPA emergency engines may run without limit in emergencies (utility outages) but at most 100 h/yr for testing, maintenance and non-emergency use, of which 50 h non-emergency (40 CFR 60.4211(f), 63.6640(f)); the dispatch counts run hours in utility-outage hours apart, and a warning fires when the other run hours (curtailments, islanded or economic operation) exceed 50 h or, with ~20 h/yr of assumed testing, 100 h. Nuclear: must-take baseload at full rating except a (1 - capacity factor) x 8760 h refuelling/maintenance block per unit from 1 April; `auto` = enough units for the average facility load (an existing-plant contract exactly that). A contract is take-or-pay; an own reactor backs down instead of curtailing.
- **Order**, each hour: solar + nuclear serve the load; surplus charges the battery, then is exported (if enabled, grid available, up to the connection) or curtailed. A deficit is met by a shifting battery, then grid → reserve battery → gas (`grid`: gas is backup) or, in `hybrid` when gas is cheaper ((fuel + carbon price x t CO2/MMBtu) x heat rate + VOM < grid energy price), gas → grid → reserve battery; `islanded` has no grid. The rest is unserved.
- **Battery**: with a surplus source (solar or nuclear) it shifts surplus only and discharges first. Without one it is a reserve: topped up from the grid (islanded: from spare gas) and used only when the grid cannot carry the load. It never buys grid energy to shift it. A battery standing in for spare units (below) keeps their reserve as a state-of-charge floor: it shifts only the energy above it, discharges the floor only for a deficit left after grid and gas, and tops it up from spare grid or (islanded) spare gas. Power limit, efficiency, leakage and the periodic start state of charge are the plant builder's battery primitives; life = min(12 yr, rated cycles / equivalent full cycles). Capex has an energy and a power part (`power.js` `BATTERY_COSTS`), so a shorter battery of the same MWh costs more:

  ```text
  battery capex = MWh x energy $/kWh + (MWh / duration) MW x power $/kW      # O&M % and replacements on the total
  default       = $222/kWh + $343/kW  (NREL 2025 update: 2024 split $241/kWh + $372/kW, scaled to its 2026 mid case)
  effective     = 1 h $565/kWh, 2 h $394, 4 h $308, 8 h $265
  ```

  $308/kWh at 4 h sits in Lazard's 2026 US range ($270-365/kWh) and replaces the plant builder's single $150/kWh, which is a global-market figure (Ember ~$125/kWh all-in outside the US and China; BNEF $117/kWh turnkey); the global basis ($120/kWh + $120/kW = $150 at 4 h) is marked on the sliders. The battery's own power part is kept although a behind-the-meter battery shares the site substation (slightly conservative, judgment).
- **Reliability**: uptime = hours with the full load served / 8760, compared with the target (legacy Tier III 99.982% by default); unserved hours, energy and the longest outage are reported.
- **Gas sized for the uptime target** (`firm-sizing.js`). The target allows H unserved hours, the largest H with (8760 - H) / 8760 >= target (99.982% -> 1 h, 99.9% -> 8 h, 99% -> 87 h). One dispatch run with zero firm capacity gives the residual shortfall s(h) after solar, battery and grid. Gas is last in every hour's deficit order and nothing it does feeds back into other hours (a shifting battery charges only from surplus and discharges first; a reserve battery on a grid-first design charges only from the grid and discharges before gas; with gas first in the order, gas and grid split the same deficit), so s(h) is what gas faces with any fleet:

  ```text
  need(h)     = s(h) - servedTolerance x load(h)          for the hours the zero-gas run leaves unserved
  required MW = the (H+1)-th largest need(h)              (0 when at most H hours are short)
  N           = the fewest units with #{h : (N - units in maintenance at h) x unit size < need(h)} <= H,
                from ceil(required MW / unit size) upwards (maintenance blocks as in the dispatch)
  auto units  = N + spare units - spares the battery stands in for, if N > 0, else 0
  battery     : k = min(spare units, floor(battery MW / unit MW), floor(battery MWh / (reserve h x unit MW)))
                spares are not built; k x reserve h x unit MW is held as a floor; N is sized with a battery
                of the energy above the floor at the same power, so the floor never counts twice
  ```

  **Battery as reserve** (`batteryReplacesSpares`, default on; `batteryReserveHours`, default 4 h, `power.js` `BATTERY_RESERVE`): a battery picks up a tripped unit within the inverter's response and holds it while the unit restarts or a replacement starts, so it can stand in for spare units. 4 h matches ERCOT's Non-Spin duration and CPUC's 4-hour storage counting (NERC restores contingency reserve within 90 minutes, a shorter bound); at real islanded AI sites batteries also buffer GPU load transients (xAI's Megapacks at Colossus), which an hourly model does not see. Only auto sizing has spares; the optimizer's manual counts have none, so it is unaffected. At the default hybrid starting design the 100 MW / 400 MWh battery replaces the spare engine (40 MWh held; 4 engines instead of 5).

  When a reserve battery is charged from spare gas (islanded) or used after gas (hybrid with gas cheaper than the grid), the battery's state depends on the fleet; the count is then bisected on full dispatch runs between 0 and the residual count without the battery (an upper bound). Both are cached per supply design: an auto scenario costs one extra dispatch (fast mode ~1.9 ms uncached, ~0.35 ms cached; bisection cases ~6 ms). `result.firm.requiredMW` and `result.firm.sizingBasis` report the method, H, the hours short without gas, the required and largest shortfall MW, the units before spares and the hours the gas covers; the full run also reports them next to a manual count. Because the load is the modeled one (GPU occupancy or utilization x PUE), the fleet can sit below the IT-nameplate design peak: the spare units, or a manual count, cover a load the model does not see.

The hourly balance `solar + nuclear + grid + gas + battery out + unserved = load + battery in + export + curtailed` holds to rounding in every architecture (tested).

### Water, heat and CO2 (`impacts.js`)

```text
cooling water  = sum_h WUE(h) x served IT(h)          -> evaporated (share) + blowdown
plant water    = gas or on-site reactor L/MWh x MWh generated (power.js)
heat           = facility energy; latent = evaporated L x 0.678 kWh/L, the rest to air
gas waste heat = fuel x 293.07 kWh/MMBtu - electricity;  reactor = electricity x (1/efficiency - 1)
CO2            = grid MWh x grid intensity + fuel MMBtu x 52.91 kg/MMBtu (natural gas; diesel 73.96)
methane slip   = fuel MMBtu x kg CH4/MMBtu x GWP -> t CO2e             # engines 0.522, turbines 0.004, diesel 0.003, fuel cells 0
carbon cost    = fuel MMBtu x (kg CO2/MMBtu [+ slip x GWP]) / 1000 x carbon price   # on-site only; slip only if priceMethaneSlip
```

**Carbon price** (`carbonPricePerTonne`, `data/datacenter/carbon.js`): a $/t charge on on-site combustion CO2, its own opex line ("Carbon price"), part of the gas marginal cost in the hybrid merit order, and a tornado input. Not on grid imports: where a scheme applies, the power price already carries the generators' allowance cost. The default is the site's compliance price (retrieved 2026-10-30): EU sites the EU ETS (EEX auctions, October 2026 mean €85.97/t x ECB 1.1202 $/€ = $96.30/t), Kern County CA the California cap-and-invest auction ($32.48/t, Aug 2026), Quincy WA the Climate Commitment Act auction ($39.50/t, Sep 2026), all other sites 0. Virginia rejoined RGGI on 2026-07-01, but RGGI covers units of 25 MWe and more, above datacenter engines and standby diesel, so its default is 0. The schemes' size thresholds (EU ETS > 20 MW thermal input; California and Washington 25,000 t/yr) are noted but not applied: the price is charged on any on-site combustion. Set it to test an internal carbon price.

**Methane slip** (`power.js` `METHANE_SLIP`): lean-burn gas engines leave unburned methane in the exhaust, 0.522 kg CH4/MMBtu (40 CFR 98 Subpart W Table W-7, 2024; AP-42 gives 1.25 lb/MMBtu), about 4 g/kWh; turbines 0.004 (Table W-7), diesel 0.003 (Table C-2), fuel cells none (Bloom). It is reported as CO2e (`emissions.methaneCo2eT`, `totalCo2eT`, its own node in the CO2 flows, the CO₂e key metric) with fossil-methane GWP100 = 29.8 by default (`methaneGwpHorizon` '20': GWP20 = 82.5; IPCC AR6 WG1 Table 7.15). At GWP100 it adds ~29% to an engine plant's CO2, at GWP20 ~81%. The carbon price applies to it only with `priceMethaneSlip` (default off): the EU ETS does not price methane from stationary combustion (only shipping, from 2026), and California and Washington, which do cover combustion CH4, compute it with generic default factors (40 CFR 98 Table C-2) far below an engine's slip; turn it on for an internal carbon price. It also enters the hybrid merit order then.

CO2 is combustion only (eGRID-style; EU grids are Ember lifecycle values): no upstream methane, embodied or credit for exports. Flows for the Sankey views are lists of `{ from, to, value, unit }` for electricity, heat, water and CO2; footprints are building, cooling yard, solar field, battery, gas or reactor plant, substation and, when grid-connected, the utility switchyard at the delivery point (40 m² per MW of import cap, judgment; the line's right-of-way is not counted) (a reactor's emergency planning zone is reported as a note, not an area).

### Architecture rules (`power.js` `ARCHITECTURES`)

The architecture bounds the design. Each entry lists its resources (`required` / `optional` / `none`) and, where restricted, the allowed grid connections, gas types and nuclear types; `normalizeDatacenterState` (`datacenter-schema.js`, `getArchitectureViolations`) clamps every state to them, so share links, UI edits, the optimizer and the model only see a legal design. A clamped generator or nuclear type takes that type's own unit size and costs.

```text
grid      firm service only; no solar; battery optional (backup / peak shaving, a reserve);
          gas: standby types only (standby diesel); nuclear: the existing-plant contract only
          (grid-delivered and modeled off site, supply.js onSite false), or none
hybrid    firm or flexible service + solar, battery, any gas type (engines, turbines, fuel cells,
          standby diesel) or nuclear, gas dispatched on cost against the grid
islanded  no grid; any on-site supply
```

So grid is backup-only and hybrid is where on-site generation lives; a hybrid design with no solar, no prime-power gas or own reactor and firm service dispatches exactly as grid does (`fitsArchitecture(state, 'grid')`). An off-site renewable PPA is not modeled; it would be a grid price and carbon setting rather than on-site solar.

### Starting designs (`starting-design.js`)

Switching the power architecture in the UI resets the supply side to that architecture's starting design (`applyArchitectureDefaults` in `datacenter-schema.js`, sizes justified in `power.js` `ARCHITECTURE_STARTING_DESIGNS`), including its generator type (with that type's costs, unit size and fuel price when the type changes); site, IT, cooling, grid prices and mounting are kept. The default state is the grid design.

```text
grid      firm connection; standby diesel auto-sized for the uptime target + 1 spare; no solar or battery
hybrid    flexible connection; solar = 2 MWdc x IT MW; battery = 4 h x IT MW (4-hour);
          reciprocating gas engines (prime power) auto-sized for the uptime target + 1 spare
islanded  no grid; reciprocating gas engines (prime power) auto-sized + 2 spares; no solar or battery
```

Auto sizing accounts for the battery and solar (with solar on site the battery shifts solar daily and is not always full when a curtailment starts, which the former design-peak-less-battery rule missed at the cloudier or hotter sites), so every starting design meets the uptime target by construction; `buildStartingDesign` still adds manual gas units one at a time if it does not (an unreachable target). The hybrid engines run whenever they are cheaper than the grid (at Abilene $38.6/MWh against $67.7: 5 x 10 MW engines carry most of the energy, the grid the balance); standby diesel never runs on cost, so with it a hybrid design would only be a grid one with solar. They are starting points, not optima.

### Schedule (`schedule.js`)

Each component is a parallel path from notice-to-proceed (January 2027, judgment): permitting + procurement + construction for the low, typical or high case, times `scheduleScalePercent`; a reactor also waits for its earliest commercial-operation year. Energization is the slowest **required** path: building, cooling and substation always; GPU delivery when selling tokens; the grid connection in `grid`/`hybrid`; on-site firm generation and battery with a flexible connection or islanded; solar only islanded. Optional components show their slack but do not delay first power (the dispatch assumes them from energization).

### Economics (`economics.js`)

```text
t0           = energization month / 12;   year y = (y - 1, y];   f_y = clamp(y - t0, 0, 1)
capex        = facility (x tier) + land + cooling + IT + substation
               + grid interconnection + solar + battery (energy + power parts) + gas or nuclear
paid         land at close; GPUs at energization t0 by default (itCapexTiming);
             construction (constructionCapexTiming 'spread', default): evenly over [end - d, end],
               d = the component's procurement + construction months (grid interconnection:
               construction only), end = max(its path's finish, first power); 'ntp': at close
replacements = at exactly t0 + k x life; salvage straight-line at N
lump at tau  = booked (ceil(tau) - tau) at year floor(tau), (tau - floor(tau)) at year ceil(tau)
spread [a,b] = that booking integrated over the window: share_k = integral_a^b max(0, 1 - |t - k|) dt / (b - a)
opex         = fixed O&M (facility, cooling, IT, solar, battery, firm $/kW-yr) + grid energy
               + demand (monthly peak import x $/kW-month) + fuel + variable O&M
               + nuclear fuel or PPA + carbon price on on-site CO2 + water
revenue      = GPU rental (default): GPUs x 8760 x occupancy x served share x $/GPU-hr x R_y
               tokens: served IT MWh x M tokens/MWh-IT x $/M
               colocation: $/kW-month x IT kW x 12 x served share (+ energy costs passed through)
               + export MWh x export price
ops_k        = f_k x (revenue - opex) + (R_k - f_k) x GPU rental        (the operations of year k)
booked ops   = ops_k booked like a spread payment over its operating time [k - f_k, k]
cf_y         = booked ops_y - replacements_y - deferred capex_y + [y = N] salvage
```

**Construction capex timing.** Paying every construction item at notice-to-proceed left ~$1.3B idle for the 4.5 years to first power at the default; real projects spend most of it in the last 18-24 months. By default each component's capex is therefore paid evenly over its own procurement + construction on its schedule path (`schedule.js`), scheduled as late as the path's slack allows so that it ends at first power: a non-critical item pays no earlier than it must. Permitting has no capex. The grid interconnection (the utility's line and substation upgrades billed to the customer) is paid over the grid path's construction months only (the procurement months are the utility's transformer wait; judgment). An optional component that finishes after first power (e.g. a reactor waiting for its earliest COD) pays until its own finish; payments past the horizon are booked in its last year, so the undiscounted capex is the same either way. Land is paid at notice-to-proceed. At the default: building and cooling over years 2.8-4.5, substation 2-4.5, grid interconnection 3.5-4.5, standby diesel 3.25-4.5; NPV $494M (ntp: $180M), IRR 10.8% (8.7%). `constructionCapexTiming: 'ntp'` (Finance section) restores the old timing exactly.

**Financing** (`financing.js`, the Finance section's "Project debt"). The shared plant-builder engine sizes one loan on the capex at close and starts debt service in year 1; for a datacenter that financed only the land (with spread capex), served debt for years before first power and never financed the GPUs. The datacenter has its own:

```text
construction loan  draws_y = debt share x non-GPU capex paid in year y       # follows the capex timing; 'ntp': all at close
                   B_y = B_(y-1) x (1 + r) + draws_y                         # interest capitalized (IDC) until conversion
                   conversion K = max(ceil(t0), last draw); level payments over the term from K + 1
GPU loans          per GPU purchase (first fleet, each refresh): GPU share x its cost, drawn with it,
                   level payments over the GPU life at the GPU rate (never before first power)
fees               upfront fee % x each loan's draws, in its first draw year
balloon            any balance left at the horizon (e.g. the last refresh) is repaid then
equity cash_y      = project cash_y + draws_y - debt service_y - fees_y;  year 0: capex at close - draws + fees
DSCR_y             = operating cash / scheduled debt service (years after first power); sponsor support = negative
                     equity cash after first power (often a GPU refresh's equity share)
```

Capitalizing interest during construction is the usual project-finance treatment (there is no cash to pay it before first power). NPV, IRR and paybacks stay project-level; equity NPV (at the project discount rate), equity IRR and MIRR use the equity cash flows; with the loan rates equal to the discount rate and no fees, equity NPV = project NPV (tested). GPU loan defaults (`gpu.js` `GPU_FINANCING`, retrieved 2026-10-30): 70% of GPU cost at 9.0% all-in, the cluster of 2025-26 deals without an investment-grade customer (CoreWeave DDTL 5.5 SOFR + 5.5% ~9.4%, Crusoe SOFR + ~5% sized at 75% loan-to-cost or 1.30x DSCR, IREN 9% fixed); an investment-grade take-or-pay contract supports ~85-90% at ~6.5% (CoreWeave DDTL 4.0: 90% loan-to-cost at SOFR + 2.25%; Lambda 6.78% fixed). At the default with financing on (construction loan 70% at 6.5% over 15 years, GPUs 70% at 9%, 1.5% fees): $907M drawn for construction plus $83M capitalized interest ($990M at first power), four GPU loans of $2.6B each, sponsor cash at close $19M; project NPV $494M unchanged, equity NPV $357M (at 8%), equity IRR 33% (project 10.8%), minimum DSCR 0.97x, $1.6B of sponsor support after first power (mostly the equity share of GPU refreshes) and a $2.7B balloon at the horizon (the last fleet, bought half a year before it). The equity IRR is sensitive: with 70% GPU debt only ~$0.77B of equity goes in before first power, so moving operating cash by months moves it by many points (it read 10.8% while operations were booked at the year-end). DSCR uses each year's own operating cash (`cashAvailableForDebtService`), not the booked amounts. The cash-flow table and CSV add debt drawn, interest and principal columns; the economics timeline shows the draws.

**Paybacks.** `paybackYears` counts from notice-to-proceed until the cumulative project cash (salvage excluded) turns positive, so it includes the build and the 5-yearly GPU refreshes (11.6 yr at the default); `paybackAfterFirstPowerYears` = that minus t0 (7.1 yr). The timing of the build capex does not move them (it is all paid before). `gpuPaybackYears` is the "a GPU pays back in 2-3 years" figure: one GPU on its own, from when it enters service, against its own capex only:

```text
revenue(a)  = 8760 x occupancy x served share x $/GPU-hr x (1 - decline)^a       # per GPU, age a
cost        = capex per GPU x IT O&M % + (energy and water opex) / GPUs           # all energy: cooling and losses serve the IT
gpu payback = the first T <= GPU life with integral_0^T revenue(a) da - cost x T >= capex per GPU, else null
default     = 37,230 x (1 - 0.85^T) / -ln 0.85 - 3,231 T = 75,000  ->  T = 2.8 yr (2.25 yr without the price decline)
```

The building, cooling, power plant and their fixed O&M are excluded (the project payback carries them).

Time is continuous within the annual end-of-year grid, so NPV moves smoothly with the first-power date: revenue and every opex line run for the operating time f_y of each year, the GPU rental price is integrated over that time (`R_y`, below), and a lump paid at a fractional time (the GPUs at first power, any replacement) is split between the two year-ends around it so that its mean booking time is exact. IRR is rated from the first non-zero flow (moving every flow by the same time leaves IRR unchanged), because with spread capex the payment at close is only the land and the shared "no net investment" test on the year-0 flow would otherwise report no IRR when the land costs nothing; ROI is measured against the whole capex. Operating cash is booked the same way: each year's operations are a payment spread over that year's operating time, so a full year is booked half at its start and half at its end (mean = mid-year) and the first half-year after a mid-year first power is booked a quarter in the year before. Booking operations at the year-end while capex is on time discounted every year's operations half a year late and understated NPV by about $260M at the default (fixed Oct 2026); in the cash-flow table, "operating fraction" and the price factor describe each year's own operating time while the money columns are the booked amounts. Booking a whole lump at one year-end would make NPV jump by C x r / (1 + r)^tau each time tau crossed a year, and taking each year at the fleet's mid-year age made revenue jump by about one year's decline whenever a replacement crossed mid-year; together these made NPV swing by hundreds of $M between neighbouring schedules (tested: continuity in 0.25% schedule steps, and monotone in the schedule for a clearly profitable or loss-making design).

**GPU cloud rental** (the default business model, `gpu.js`): the operator owns the GPUs and rents them by the hour. Per platform (`js/data/datacenter/gpu.js`: H100, H200, B200, GB200 NVL72, GB300 NVL72, default GB300 NVL72 as the 2026 mainstream) the data give the rated IT kW per GPU (server or rack maximum / GPUs, +10% for scale-out network and storage), the all-in capex per GPU and a rental price (default: SemiAnalysis's retail rate per GPU-hour, below 2026 spot indexes because a large fleet rents mostly on term contracts).

```text
GPUs        = IT capacity kW / IT kW per GPU            (fractional, so results scale linearly)
IT draw     = nameplate x (occupancy x 0.8 + (1 - occupancy) x 0.2)   # LBNL rented vs idle draw; replaces utilization
IT capex    = GPUs x capex per GPU, replaced every GPU life (5 yr)
price(t)    = price x (1 - decline)^age(t)              # default decline 15%/yr
R_y         = integral over the operating time of year y of (1 - decline)^age(t) dt
            = sum over fleets in service of (q^(b - p) - q^(a - p)) / ln q,  q = 1 - decline
age(t)      = t - p, p = purchase time of the fleet in service at t; fleet k serves
              [t0 + k x life, t0 + (k + 1) x life); the first is bought at energization (or at NTP
              with itCapexTiming 'ntp'), each replacement buys the then-current generation at the same
              $/GPU and rents at the new-GPU price again (age resets)
```

`yearlyCashFlows[].rentalPriceFactor` is R_y / f_y (the average price factor over the year's operating time); `gpuHoursSold` per year and `economics.totalGpuHoursSold` count GPUs x occupancy x served share x hours operating.

The decline default (15%/yr, judgment) sits between the within-tier H100 declines (~6-10%/yr, Silicon Data 2023-2026), the B200 12-month forward (12% below spot) and the ~30%/yr cross-tier fall from 2023's $7-10/hr. Occupancy (default 85%) is judgment. The break-even is the rental $/GPU-hour at NPV = 0; `economics.levelized.costPerGpuHour` is the all-in cost per GPU-hour sold.

NPV, IRR/MIRR verdicts, payback, debt and the cash-flow timeline come from `finance.js` and `summarizeReturns`, so `economics` has the plant builder's shape and the shared cash-flow table works on it; the last cumulative discounted cash flow equals NPV and levelized profit equals NPV x CRF. Levelized cost of power ($/MWh delivered) is the present value of power-side capex and opex less exports over the present value of served facility energy. The site prices from EIA are all-in averages, so the demand charge defaults to 0 (a warning flags double counting). With token revenue, tokens per IT MWh = the plant builder's per-facility-MWh throughput x PUE 1.14 (Epoch's build), so a better PUE lowers cost, not revenue. Colocation tenants supply the IT, so IT capex drops out.

NPV is linear in the revenue price, so the break-even rental price, token price or colocation rate is `p0 - NPV / V` (two fast runs, cross-checked with the analytic `V`). The datacenter tornado swings each input in `js/data/datacenter/sensitivity-variables.js`, including the schedule (`scheduleScalePercent`), by the chosen ±% with the plant builder's bounds logic; a fast path reuses the cached dispatch when only prices or costs move (~1 ms per run).

### Design optimizer (`optimizer.js`)

`optimizeDatacenterDesign(state, options)` looks for the design with the highest NPV whose achieved uptime meets the state's uptime target. It sizes what the options and the architecture allow and keeps every other input (site, cooling, revenue, prices, the gas or nuclear type; battery duration and unit size unless `thorough`) fixed. A grid-connected design never gets solar, a flexible connection or prime-power gas (its start state has none, and solar and the connection are not searched there):

| Decision | Range (P = design facility peak, IT nameplate x peak PUE) |
| --- | --- |
| Solar MWdc | 0 to 4 x P (x 2 with the wider range) |
| Battery MWh | 0 to 24 h x P (x 2 with the wider range) |
| Firm units | gas: the auto design (the units the uptime target needs + the state's spare units, which a battery may stand in for) + 0 to ceil(P / unit size) + 3 extra units run on cost (`firmExtraUnits`); nuclear: 0 to that bound, manual sizing; 0 = no firm plant (so it is off the schedule too); an existing-plant nuclear contract is 0 or 1 block at the average load |
| Grid connection | optional: firm and flexible are both searched (hybrid; grid-connected is firm only) |
| Battery duration, unit size | `thorough` only: 1, 2, 4, 8 h (and the current); the generator type's min, default and max unit size |

```text
for each (solar, battery):
  gas    = auto design: N for the target + spares (N+x as in auto sizing, battery-as-reserve included)
  extra  = walk 0, 1, 2, ... extra units while NPV improves   # pay when gas is cheaper than grid power
  nuclear: n_min = fewest units with uptime >= target (bisection), then walk n_min, n_min+1, ...
coarse grid: solar in {0, S/32, ..., S}; battery in {0, 0.25, 0.5, 1, 2 h of P} + {B/8, B/4, B/2, B}
             (7 x 9 at the default bounds, S, B = upper bounds)
refine:      compass search from up to 3 coarse cells (the best, then the next best that are not its
             grid neighbours and are within 2% of its capex in NPV), step halved until below 1 MW / 1 MWh
rank:        feasible before infeasible; then NPV; infeasible candidates by uptime
```

**Wider search** (the UI checkbox: `boundsScale: 2, thorough: true`, `THOROUGH_SEARCH`): doubled bounds, then the default search on them, then a denser coarse grid (9 halvings and 11 uniform steps of each bound plus the small levels; 17 x 22 cells at the default site), refinement from up to five starts within 5% of capex of the best cell, each refined first at its own duration and unit size, then at every duration x unit size and onward with those as discrete steps. The default search's best stays a candidate, so the wider search never returns less. Budget 5,000 runs per architecture on top. A full comparison with the connection search: ~4,600 runs, ~8.4 s in Node (the default search: ~1.5 s). The unit-size search keeps the type's $/kW, heat rate and O&M at every size (no economies of scale), so it tends to pick the smallest units (finer steps fit the need more tightly; at the default site islanded 38 x 2.5 MW engines and 34 MWh of battery beat 10 x 10 MW by ~$27M): read it as a granularity check, not a sizing recommendation.

The small battery levels and the extra starts are there because the landscape can have two basins: at the hybrid starting design with standby diesel instead of its engines and a $150/kWh battery (and construction capex at notice-to-proceed, as when the test was written), ~50 MWh of battery riding through curtailments replaced seven diesel units ($154.7M at 196 MWdc, 51 MWh, 12 units), while halvings of the 24 h bound (3,144, 1,572, ..., 98 MWh) stepped over it and a single refinement from the best coarse cell stayed in the no-battery basin ($150.6M, 19 units). With evening curtailments (Oct 2026) the basins are no battery and ~31 diesel units (NPV ~$655M) versus a ~360 MWh battery that carries the precharged evening events with no diesel (~$688M), with worse mid-size batteries between; a regression test checks the optimizer against a reduced brute force there (default search within 2%, ~1.6% short because its solar steps stop on unit-count jumps; wider search within 0.5%).

Uptime cannot fall when a unit is added (every hour has at least as much available capacity), which is what the bisection relies on; the walk upwards counts and skips any count that breaks this, and `tests/calculations/datacenter-optimizer.test.js` checks the bisection against a linear scan, and the auto count against the bisection. Each candidate is a fast-mode scenario (one hourly dispatch year, about 1-2 ms; fast mode gives the same NPV, uptime and first power as the full run, tested). A budget (default 800) caps the runs per architecture; the default site converges well inside it. The result carries the best design as a state patch (always including architecture, connection, solar, battery and firm-unit fields), the current design, runs used, the bounds, which decisions sit at an upper bound (`corners`), the coarse grid (`frontier`) and notes; when nothing within the bounds meets the target it says so and returns the highest-uptime design.

`compareArchitectures(state, options)` runs it for grid, hybrid and islanded. Each starts from that architecture's starting design through one function, `getArchitectureStartState` (the schema's `applyArchitectureDefaults` when it exists, otherwise the current state with the architecture switched); patches are against the current state. At the default site (Abilene, 100 MW IT, GPU rental) the full comparison takes about 1.4 s (~470 runs; ~1.9 s when firm vs flexible is also searched) in Node or in the page's worker:

| Architecture | Best design | Uptime | NPV | IRR | First power |
| --- | --- | --- | --- | --- | --- |
| Current (grid, standby diesel N+1) | 32 x 3 MW standby diesel | 100% | $494M | 10.8% | Jul 2031 |
| Grid (firm) | 32 x 3 MW standby diesel (N+1) | 100% | $494M | 10.8% | Jul 2031 |
| Hybrid (flexible) | 9 x 10 MW gas engines + 51 MWh battery (N+1, the spare as battery reserve), no solar | 100% | $697M | 11.2% | Jan 2030 |
| Islanded | 10 x 10 MW engines + 80 MWh battery (N+2, both spares as battery reserve) + 7 MWdc solar | 100% | $682M | 11.1% | Jan 2030 |

(Construction capex spread over the build, the default. Every optimized gas design keeps its architecture's spare units, as auto sizing does.)

Grid only sizes its backup: the standby units the utility outages need for the target plus the N+1 spare (none when a battery rides through the outages; the card then says so), here the starting design itself. Hybrid runs its engines on cost (9 x 10 MW carry most of the energy, the grid the balance; with the curtailments in the evening, solar no longer pays at Abilene) and keeps the flexible connection when it is searched too (firm: $566M): its earlier first power is worth more than the curtailments cost. Islanded, an 80 MWh / 20 MW battery stands in for the two spare engines (2 x 4 h x 10 MW), cheaper than building them. When the best hybrid design has no on-site generation (no solar, gas engines or turbines, or own reactor) and firm service, it is the grid-connected design; the result says so (`reducesTo: 'grid'`, a note, and a "= grid" tag in the card) rather than showing it as a different design. The islanded optimum needs only 10 engines because the dispatch-year peak (GPU occupancy) is below the 131 MW design peak and a little solar covers the hours when maintenance outages overlap.

Limitations: it is a local search (coarse grid, then compass steps on two axes from up to three starts, with the unit count chosen per point), so a narrow optimum between grid points can still be missed; one TMY year decides feasibility (see below); the objective is NPV only (no CO2, water or first-power weight); one firm family at a time; battery duration (it sets the power and the power part of the battery cost), gas type and import cap are not searched: the optimizer sizes battery MWh at the user's duration. Choices that change the schedule, such as a flexible connection or an islanded battery on the critical path, can win or lose by more than their own cost.

### Datacenter UI

`DatacenterApp` (`js/ui/datacenter/app.js`) owns the state (`DATACENTER_DEFAULT_STATE` or the `#s=` share link), recalculates once per animation frame while a slider moves and refreshes the sensitivity panel (tornado, break-even) debounced. Its pieces:

- `control-spec.js`: every left-panel control, declared per section container in `datacenter.html` with its schema field, bounds (inside the schema range; unit sizes follow the selected type), formatter, visibility rule and, for a selection, the preset it resets (`applyDatacenterPresetDefaults`). `control-markup.js` renders them, `controls.js` binds them with the shared `control-binding.js` and shows or hides fields and whole sections (no grid section when islanded). Selections offer only what the architecture allows (grid: firm service, standby generators, the existing-plant nuclear contract); with grid selected the solar controls are hidden and the Solar and Firm generation sections show a note with a "Switch to Hybrid to add on-site generation" button (`data-switch-architecture`, the same path as the architecture cards). Choosing an architecture applies its starting design and shows a dismissible note in the section saying what was set. A control whose field the schema lacks is dropped. `info-panels.js` and `firm-info.js` fill the read-only blocks: site data, live PUE/WUE, trade-off lines and comparison tables for generator and nuclear types (standby diesel with its EPA limits and fuel storage), the earliest nuclear COD, the firm sizing (MW and units the uptime target needs, hours short without them, N+x, the share of CAPEX, run hours split into EPA emergency and other hours; "No firm generation needed for the uptime target" when grid, solar and battery cover it; switching to manual sizing starts from the auto count), the architecture cards with real-world examples and the GPU platform.
- `plant-layout.js`: blocks with area = footprint m² x (px per m)², skyline-packed at the largest scale that fits, with a scale bar and legend; every non-zero footprint area is a block. Grid-connected, a transmission line (solid firm, dashed flexible, labelled) runs along the top and taps into the utility switchyard, packed first next to the on-site substation; islanded, there is no line or switchyard. This is the Plant layout card's **Diagram** view.
- `plant-map.js`: the card's **Map** view. `buildPlantMapLayout` lays the same blocks out in metres around the site's lat/lon (campus skyline-packed into a near-square with 15 m roads and centred on the pin, switchyard and substation on its north edge, the solar field east across a 30 m road, the transmission line running north from the switchyard), each with its exact footprint area. Leaflet draws them on the Esri World Imagery tiles that the plant builder's site map uses (`js/ui/map-geo.js` holds the shared tile source and metres-to-degrees helpers), with tooltips built from text nodes, colours from CSS classes and the view fitted to the footprint. If the tiles fail the blocks stay on a plain background and a note says so. The map is drawn only while its view is shown.
- `sankey.js`: `result.flows` as columns (longest path from a source; sinks last) with node heights and band widths on one scale.
- `timeline.js`: one Gantt row per schedule path (permitting / procurement / construction / wait for COD), the critical path outlined, first power marked.
- `dispatch-chart.js`: a typical day of any month (MW by hour) or daily energy over the year, stacked by source, surplus below zero.
- Firm generation: "Carbon price also on methane slip" and the methane CO₂e basis (GWP100 / GWP20); a "Carbon price (on-site CO₂)" slider (markers at the EU ETS, California and Washington prices) with the site's default; Battery: "Battery stands in for spare generator units" and the reserve hours per replaced unit, with the count replaced in the battery and firm-sizing blocks; the CO₂ key metric shows the yearly carbon cost when there is one.
- `results.js` and `sensitivity.js`: warnings, key metrics (incl. project payback from start and after first power, GPU payback for GPU rental, and with project debt an Equity IRR tile with equity NPV and minimum DSCR next to the project NPV and IRR; the Financing group lists the construction loan, capitalized interest, term loan, GPU loans, fees, sponsor cash, DSCR and sponsor support), economics groups (each capex item with its payment window), header metrics, break-even price and the tornado. The Finance section's "Construction capex paid" select switches `constructionCapexTiming`; the cash-flow table and economics timeline show the spread capex in the "Deferred + replacement CAPEX" column. `share.js`: share links that always carry `DATACENTER_DERIVED_KEYS`.
- `optimizer-panel.js` and `optimizer-client.js`: the Optimize Design card. The optimizer runs in `js/workers/datacenter-optimizer-worker.js` (messages `optimizeDatacenterDesign` / `compareDatacenterArchitectures`, progress then result; main thread when workers are unavailable). "Wider search range" runs the thorough search (labelled "slower: ~10–15 s, more thorough"; ~8 s at the default site). For a single grid-connected run the "Solar size" and "Firm vs flexible grid" options are greyed out (they still apply when comparing architectures). The results table has one column per design (current, then each architecture; the battery with its duration) and an Apply button per design that puts its patch, architecture included, into the state and recalculates (the share link follows).
- Real projects (`project-info.js`, data in `js/data/datacenter/projects.js`, applied by `state/datacenter-projects.js` `applyDatacenterProject`): the first left-panel section picks one of 13 real AI campuses at the site presets (Stargate Abilene, Crusoe for Microsoft, Vantage Frontier, Meta Hyperion and Prometheus, Project Jupiter, Google Haskell, Microsoft Fairwater Atlanta, xAI/SpaceX Colossus 1 and 2 in Memphis, Fleet at TRIC, Vantage VA2, Project Baccara). Switching projects, or picking another site, first returns the previous project's design fields to their defaults (`applyDatacenterProject`, `clearDatacenterProject`). It sets the site (with its prices and climate), IT size, GPU platform and cooling, the architecture's starting design and then the generator type and sizes the sources state; prices, revenue, finance and schedule settings stay the user's. The block lists every public fact with its dated source (marked "search index" or "Epoch AI estimate" where that is the basis) and what the design assumes (one generator type, one IT phase, a new build from today). `projectId` travels in share links; picking another site clears it. Sources are on `datacenter-sources.html#projects`.
- `capex-split.js`: the "Where the Capex Goes" card in front of Economics Over Time: a 100% bar of the initial capex by item and a table grouped into GPUs & IT, facility and power with each item's share, when it is paid (from `capexItems`) and its replacement capex over the horizon (from the booked replacement items; the GPU refreshes dominate).
- Sites page (`datacenter-sites.html`, entry `js/datacenter-sites-main.js`, `sites-page.js` + `site-card.js`): the header's "Compare all sites" link opens it with the current settings in the share hash. Every site runs `optimizeForSite` (`model/datacenter/site-survey.js`: the site's own solar yield, grid price and CO2 and carbon price replace the user's, then `compareArchitectures` keeps the highest-NPV architecture) in a pool of up to four optimizer workers (message `optimizeDatacenterSite`), about 1 s per site. Cards fill in as sites finish, sorted by NPV, IRR, first power, power cost, footprint or name: financials, the design and each architecture's best NPV, a typical-day dispatch (year average) and the plant layout with its own scale bar plus a bar against the largest footprint. Finished sites are kept in `sessionStorage` per settings hash, so returning from the simulator does not rerun them ("Run again" does). A card links to the simulator with that site's design.

Every view renders with attributes and classes only (strict CSP) and escapes interpolated text; `datacenter.css` holds the page's styles. Tests: `tests/renderers/datacenter-*.test.js`, `tests/ui/datacenter-controls.test.js`, `tests/share-state/datacenter-share.test.js` and the boot smoke test.

### Datacenter limitations

- Temperatures are a typical day per month (no heat waves beyond the monthly mean profile). Solar has the TMY's day-to-day variability but a clear-sky shape within each day (no passing clouds), the GHI day factor stands in for plane-of-array (it understates the clear/overcast contrast for trackers), and TMY months are stitched from different years, so multi-day spells never cross a month boundary. One TMY year is not a design-year: at Abilene a 1 GWdc (east-west) / 4 GWh islanded solar + battery site serves 99.05% of hours (a ~2-day overcast spell empties the battery); ~7.7 GWh reaches 99.9% in this year (~6.4 GWh with single-axis trackers), and a multi-year record would need more.
- IT load is constant at its utilization; no AI training load swings, ramp limits or start times for gas.
- Outages are deterministic blocks (planned maintenance, utility outages at fixed dates, flexible curtailments on the evenings of the highest-load days), not random forced outages, so uptime is one representative year rather than an expected value; the utility-outage default is a Canadian transmission average, and a given site's history (feeds, voltage, storm exposure) can differ by several times. A contracted existing nuclear plant keeps delivering through a utility outage. Generators and batteries pick up an outage within the hour (no start-up time; the UPS bridges the seconds in practice).
- Standby diesel: EPA limits are checked against the modeled run hours plus an assumed ~20 h/yr of testing (testing is not dispatched); running through a flexible-connection curtailment is counted as non-emergency use (a contractual curtailment is not a utility interruption; state permits can differ). On-site fuel storage (Uptime: at least 12 h; typically 24-96 h) is in the installed $/kW, not modeled as a constraint, so a long islanded or curtailed run is not limited by tank size. Tier 4 aftertreatment (SCR) for non-emergency engines is not priced.
- The schedule does not make standby generation a required path for a firm grid connection, although meeting a Tier III target needs it; the economics may therefore start revenue before the backup plant could be built.
- Grid-connected designs have no on-site solar; an off-site renewable PPA (grid-delivered, e.g. Google's TotalEnergies contracts) is not modeled and would be a grid price and carbon setting.
- Upstream methane (leaks from gas production and pipelines) is not counted; only the slip at the site is.
- The carbon price applies to all on-site combustion, ignoring the schemes' size thresholds, and not to grid imports (their price is assumed to carry it). Free allocation, offsets and price changes over the horizon are not modeled.
- A battery standing in for spare units is judged on energy and power only; hourly dispatch cannot show the sub-second response (or GPU load transients) it would really provide or miss.
- Construction capex is spread evenly over each component's procurement and construction (no milestone or deposit profile).
- Financing on the annual grid: draws and conversion at year-ends (interest is capitalized to the year-end after first power), level payments only (no sculpting to a DSCR target, no reserve accounts, covenants or refinancing), one rate per tranche, no taxes or interest deductibility; equity is discounted at the project rate, not a separate cost of equity.
- Solar degradation is not modeled in the dispatch (year-1 output every year); prices are constant real values with no taxes.
- One firm-generation family per design; the battery cannot arbitrage grid prices.
- The schedule treats paths as independent and the dispatch runs every component from energization.
- GPU rental: occupancy is a fixed share (no ramp-up after first power, no contract book); each replacement fleet is assumed to rent at today's new-GPU price in real terms.
- Flexible-connection curtailments come at a fixed evening hour on the hottest days, and the battery knows each one 12 h ahead; real curtailments follow the grid's own conditions (transmission limits, system net load), which the model does not simulate.
- A battery standing in for spare units uses its full power for both roles: the units the target needs are sized with the battery's power, and the same power also replaces spares (its reserve energy is not double counted).
- Solar output is capped at its DC nameplate with no inverter (AC) limit: annual energy is right, but peak charging, export and the substation sized on peak export are overstated for high DC/AC ratios.
- Nuclear auto sizing covers the average facility load (ceil(average / unit size)), not the uptime target, so an islanded reactor's refuelling outage shows as unserved hours and an uptime warning; the optimizer searches unit counts and is not affected.
- Results are real (constant prices; the GPU price decline is real) and pre-tax, while the debt rates are nominal market rates.

## Defaults

All defaults live in `js/state/schema.js` (`CORE_STATE_FIELDS`), with the module, route and policy defaults in `js/data/modules.js` and `js/data/policies.js`. Print the full set with:

```bash
node --input-type=module -e "import {DEFAULT_STATE} from './js/model/index.js'; console.log(DEFAULT_STATE)"
```

The headline default scenario is:

- **Site:** Mojave Desert preset with base yield 1,974 MWh/MWdc-yr (PVGIS) on east-west fixed racking (x0.86). Earth annual-average view.
- **Plant:** 1 MWdc on the "Terraform target" solar cost basis ($0.20/W modules, $0.12/W East-West BOS, ~$0.35/W all-in with land and site prep; ~0.74 ¢/kWh on Terraform's undiscounted amortization basis, matching its <1 ¢/kWh goal). The Solar Cost Basis select switches to Terraform's measured 2026 build (~$0.72/W all-in, Oct 2026 post), at which the default methane plant does not pay back. Both bases live in `SOLAR_COST_PRESETS` (`js/data/reference-data.js`). No battery, 100% chemical sizing, 30-year solar life with 0.65%/yr degradation.
- **Products:** methane only. Electrolyzer at 79 kWh/kg and $100/kW, DAC at 3,440 kWh/t and $450 per t-yr, Sabatier at 95% and $50/kW-CH4, 7-year process lives. Methane sells at $20/MCF. Methanol, MTG, exploratory routes, feed buffers, AI and debt are all off.
- **Policy and finance:** US 45V at $3.28/kg H2 for 10 years, an 8% discount rate and a 30-year horizon.

## Limitations

- **Weather is clear-sky-equivalent.** Every day has the clear-sky shape, scaled to the annual yield and diffuse fraction, with no multi-day cloudy spells. AI reliability and battery firming are therefore optimistic. "100% chemical sizing clips no solar" holds within this modeled year only: at a cloudy site the scaled peak is low (Berlin, fixed tilt: 0.50 MW per MWdc) and real clear days would clip. Off-preset Earth yields use a latitude/GHI heuristic, so a manual PVGIS value is better.
- **Policy is simplified.**
  - Credits for self-consumed solar under 45Y, EEG, SDE++ and the CfD are a proxy, since real schemes pay metered or sold output and a CfD reference price has no meaning for on-site use.
  - Eligibility (lifecycle, wage, ownership, location, certification) is not legally validated, and award values are user inputs.
  - Upfront support is not re-applied to replacements, and custom support runs for the whole horizon.
- **45Q on CO2 made into fuel is an upper bound.** The IRC 45Q(f)(5)(B) lifecycle limit is not modeled.
- **Exploratory routes are rough placeholders.** Each has one electricity intensity, a flat cycling penalty, a generic 10-year life and a shared O&M %, with no thermal, startup, purity or logistics constraints. A route's priority sets its share of output (power, H2 and CO2 follow weight x per-unit need), not a fixed slice of the power. Methanol routes get only the user-set diverted share of the methanol reactor output, split by priority x kg MeOH per unit; the split slider lives in the MTG card.
- **Process blocks follow solar freely,** with no minimum turndown, ramp limits or startup losses beyond the cycling penalty.
- **Feed-buffer inventory is a flat-supply upper bound,** and its $/kg and $/t costs are assumptions. Methanol tankage is ignored.
- **Some modes are stylized fallbacks.**
  - There is no hydrogen sales line, and with no product enabled H2 and CO2 are simply vented. Unconverted Sabatier / methanol feed is vented too, not recycled to the reactor inlet.
  - The battery has no capacity fade; its cycle life is consumed at the year-1 dispatch throughput (equivalent full cycles), with depth-of-discharge effects ignored.
  - AI compute is a constant-load token model, not a datacenter design.
  - Mars and Moon modes use literature-style benchmarks.
- **Finance is minimal.**
  - Prices and costs are constant real values: no inflation, escalation, taxes, depreciation, tax equity or working capital.
  - O&M is a flat % of CAPEX.
  - Salvage is straight-line book value (land at cost), assumed realizable at the horizon, not a resale estimate. It is in NPV, IRR and ROI (short horizons look better) but not in payback.
  - Equity NPV and equity MIRR are discounted at the project discount rate, not a separate cost of equity.
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
- **Hand-derived goldens:** CRF, IRR verdicts, MIRR, debt schedules and balloons, levelized identities, replacement timing and salvage, and buffer inventory; break-even prices checked against a full run at the root, a third price on the same line and the hand-built discounted volume; the cash-flow table's last cumulative discounted value against NPV.
- **Datacenter model** (`tests/calculations/datacenter-*.test.js`): hourly energy balance in every architecture, PUE/WUE against the cooling calibration, CO2 and water identities, N+1 gas uptime and hand-derived unserved energy, flexible-connection hours, critical path from the lead-time data, NPV = last cumulative discounted cash flow, scale homogeneity, schedule timing and break-even round trips. Its own snapshot, `tests/fixtures/datacenter-characterization.json`, regenerates with `UPDATE_CHARACTERIZATION=1 node --test tests/calculations/datacenter-characterization.test.js`.
- **Policy facts:** scheme defaults are re-derived from the IRS notices, auction results and ECB rates instead of being copied from `policies.js`.
- **UI and tooling:** control-spec and `index.html` contracts, renderers, charts, diagram, HTML escaping, share links, saved sites, the optimizer worker, the build allowlist, dev-server hardening and the one-way import order (`tests/architecture/`). These run in Node with small DOM stubs.

## Sources

This repo is based on public materials and should be read as an independent interpretation of those sources. Model data cite their own sources inline: PVGIS and Global Solar Atlas values in `js/data/reference-data.js`, and every incentive figure in `js/data/policies.js`.

The app links a full, annotated list from its footer: [`sources.html`](sources.html). `tests/ui/sources-page.test.js` fails if any URL cited in `js/`, this README or `index.html` is missing from that page, so add new sources there too.

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
