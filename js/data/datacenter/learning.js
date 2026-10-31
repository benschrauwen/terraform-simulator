/* ============================================
   Learning curves for the price grid's year paths
   ============================================
   Wright's law: a cost falls by the learning rate LR with every doubling of
   cumulative production, cost(Q) = cost(Q0) x (Q / Q0)^-b with
   b = -log2(1 - LR). The hidden price grid (datacenter-solar-sweep.html)
   draws where today's solar and battery prices would be in later years. Each
   price part learns at its own rate on its own technology's cumulative
   deployment, starting from the page's own prices in the base year.

   Learning rates
   - PV modules: 26.0% per doubling of cumulative module shipments
     (1976-2025; ITRPV 17th edition, 2026). Fraunhofer ISE (Photovoltaics
     Report, Jul 2026): 26.7% over the last 45 years. A 2006-2025 fit gives
     40.8% (ITRPV), the manufacturing scale-up years.
     https://www.pv-tech.org/itrpv-2026-solar-industry-maintains-historic-learning-curve-despite-market-turbulence/
     https://www.ise.fraunhofer.de/content/dam/ise/de/documents/publications/studies/Photovoltaics-Report.pdf
   - PV balance of system: 11% ("a global learning curve for the
     balance-of-system of 89%, ... compared with 20% for modules"; Elshurafa,
     Albardi, Bigerna and Bollino, J. Cleaner Production, 2018).
     https://www.kapsarc.org/research/publications/estimating-the-learning-curve-of-solar-pv-balance-of-system-for-over-20-countries-implications-and-policy-recommendations/
   - Li-ion battery packs: ~18% per doubling of cumulative volume (BNEF).
     Used for the battery's energy part (cells, racks, containers).
     https://about.bnef.com/insights/clean-energy/behind-scenes-take-lithium-ion-battery-prices/
   - Battery power part (PCS / inverters, transformers, switchgear, grid
     tie): 11%, the PV balance-of-system rate (judgment: the same kind of
     electrical equipment, labour and interconnection).

   Cumulative deployment (base: the start of 2026 = the end of 2025)
   - Solar: 2.9 TW installed at the end of 2025, 647 GW added in 2025
     (Ember; IEA PVPS ~2.97 TW and ~690 GW). Additions grow 4% a year, which
     reaches ~6.6 TW at the end of 2030, SolarPower Europe's medium scenario;
     the same growth afterwards (judgment).
     https://www.pv-tech.org/global-solar-pv-installations-reached-647gw-in-2025/
     https://pv-magazine-usa.com/2026/05/14/solar-approaches-3-tw-but-the-industry-faces-new-challenges/
   - Li-ion batteries (all uses; EVs dominate): 1.59 TWh of demand in 2025,
     up 29% (Benchmark Mineral Intelligence); ~6 TWh cumulative at the end of
     2025 (judgment: 2025 1.59 + 2024 ~1.23 + 2023 ~0.95 (BNEF) + ~2.2 TWh
     before). Demand grows 21% a year to ~4.2 TWh in 2030 (McKinsey's 2030
     battery market; IEA GEVO 2026: EV batteries 1.2 TWh in 2025 to ~3 TWh in
     2030), then 10% a year (judgment).
     https://source.benchmarkminerals.com/article/global-lithium-ion-battery-demand-rose-29-in-2025
     https://www.mckinsey.com/features/mckinsey-center-for-future-mobility/our-insights/battery-2035-building-new-advantages
     https://www.iea.org/reports/global-ev-outlook-2026/electric-vehicle-batteries
   (all retrieved 2026-10)

   Paths
   - central: each part at its own rate (modules 26%, BOS 11%, battery
     energy 18%, battery power 11%). Soft costs, labour and interconnection
     learn slowly, so the installed price falls much less than the module or
     pack price.
   - fast: the whole installed price learns at the module (26%) or pack
     (18%) rate, an upper bound on the pace (judgment).
   Both are trend lines, not forecasts: they leave out tariffs, commodity
   swings (module prices rose ~9% in 2025, ITRPV) and the US premium over
   the global price, which they assume stays proportional. */

export const PRICE_LEARNING = Object.freeze({
  baseYear: 2026,
  years: Object.freeze([2026, 2028, 2030, 2035]),
  solar: Object.freeze({ cumulativeGW: 2900, additionsGW: 647, additionsGrowth: 0.04, additionsGrowthAfter2030: 0.04 }),
  battery: Object.freeze({ cumulativeGWh: 6000, additionsGWh: 1590, additionsGrowth: 0.21, additionsGrowthAfter2030: 0.10 }),
  paths: Object.freeze({
    central: Object.freeze({ label: 'Central', module: 0.26, bos: 0.11, batteryEnergy: 0.18, batteryPower: 0.11 }),
    fast: Object.freeze({ label: 'Fast', module: 0.26, bos: 0.26, batteryEnergy: 0.18, batteryPower: 0.18 }),
  }),
});
