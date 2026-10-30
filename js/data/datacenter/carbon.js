/* ============================================
   Carbon prices on on-site combustion
   ============================================
   The default carbon price per site (state carbonPricePerTonne, $/t CO2)
   is the compliance price of the scheme its on-site gas or diesel plant
   would fall under. It is charged on on-site combustion CO2 only (fuel x
   the fuel's kg CO2/MMBtu, power.js GENSET_FUELS), not on grid imports:
   in these markets the wholesale and retail power prices already carry
   the generators' allowance cost, so pricing grid CO2 again would count
   it twice.

   Applicability (simplification: the price is applied to all on-site
   combustion, whatever the plant size):
   - EU ETS: "combustion of fuels in installations with a total rated
     thermal input exceeding 20 MW" (units under 3 MW not counted), i.e.
     ~8 MWe of engines; a datacenter plant of any size that matters here.
     Directive 2003/87/EC Annex I as amended by Directive (EU) 2023/959.
     https://lawplayer.com/eu/article/32023L0959/anx_1
     https://www.epa.ie/our-services/licensing/climate-change/eu-emissions-trading-system-/emissions-trading-system---stationary-installations/does-our-activity-need-a-ghg-permit/
   - California cap-and-invest: facilities emitting >= 25,000 t CO2e a
     year (17 CCR 95812(c)), ~7 MW of gas engines running all year
     (8,760 MWh x 7.8 MMBtu/MWh x 52.91 kg/MMBtu = ~3,600 t per MW).
     https://www.law.cornell.edu/regulations/california/17-CCR-95812
   - Washington Climate Commitment Act: >= 25,000 t CO2e a year (RCW
     70A.65.080(1)). https://app.leg.wa.gov/rcw/default.aspx?cite=70A.65.080
   - RGGI (Virginia resumed participation on 2026-07-01; auction 73 on
     2026-09-09 cleared at $37.65 per short ton): the Model Rule covers
     units serving a generator of >= 25 MWe nameplate (section XX-1.4(a)).
     Datacenter engines (2.5-19 MW) and standby diesel (3 MW) are below
     that per unit, so Virginia's default is 0; set ~$41.50/t (the auction
     price per metric ton) for a plant of large turbines.
     https://www.rggi.org/sites/default/files/Uploads/Auction-Materials/73/PR091126_Auction73.pdf
     https://www.rggi.org/sites/default/files/Uploads/Program-Review/12-19-2017/Model_Rule_2017_12_19.pdf
   - Texas, Louisiana, Ohio, Arizona, Nevada, Iowa, Georgia, New Mexico: no
     carbon price on stationary combustion: 0.
   Germany's national fuel emissions trading (BEHG, corridor EUR 55-65/t in
   2026, section 10(2)) covers fuels outside the EU ETS; a plant above the
   20 MW threshold is in the EU ETS instead, so it is not used here.
   https://www.gesetze-im-internet.de/behg/__10.html
   Users can set an internal (shadow) carbon price instead. */

/* Global warming potential of fossil methane (IPCC AR6 WG1 Chapter 7, Table
   7.15): GWP100 29.8, GWP20 82.5. Methane slip is reported as CO2e with the
   state's horizon (methaneGwpHorizon, default 100 years, the reporting
   convention; 20 years shows the near-term warming).
   https://www.ipcc.ch/report/ar6/wg1/downloads/report/IPCC_AR6_WGI_Chapter07.pdf
   Whether a carbon price applies to it (state priceMethaneSlip, default
   off): the EU ETS covers CO2 only from stationary combustion (methane only
   for maritime, from 2026); California (17 CCR 95852(i)) and Washington
   (WAC 173-446-040) cover CH4 from combustion, but compute it with generic
   default factors (40 CFR 98 Table C-2, 0.001 kg/MMBtu for natural gas;
   judgment, not checked per facility) far below an engine's slip. So by
   default the price applies to CO2 only, and the toggle prices the slip as
   an internal carbon price would.
   https://climate.ec.europa.eu/eu-action/eu-emissions-trading-system-eu-ets/scope-eu-emissions-trading-system_en
   https://www.emsa.europa.eu/reducing-emissions/extension-ets.html
   https://www.law.cornell.edu/regulations/california/17-CCR-95852
   https://www.law.cornell.edu/regulations/washington/WAC-173-446-040 */
export const METHANE_GWP = Object.freeze({ 100: 29.8, 20: 82.5 });

// ECB reference rate, October 2026 average of the daily fixings (1.1202
// USD per EUR; 1.1172 on 2026-10-30), computed from the ECB 90-day history.
// https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml (retrieved 2026-10-30)
export const USD_PER_EUR = 1.1202;

export const CARBON_PRICE_SCHEMES = {
  'eu-ets': {
    label: 'EU ETS',
    // EEX primary auctions, October 2026: mean of the 21 auctions 1-30 Oct
    // EUR 85.97/t (EUR 82.60-89.55; EUR 89.55 on 30 Oct), from EEX's 2026
    // auction report. Cross-check: EUA Dec-26 futures closed at EUR 89.20 on
    // 29 Oct (Investing.com).
    // https://www.eex.com/en/markets/environmental-markets/eu-ets-auctions
    // https://public.eex-group.com/eex/eua-auction-report/emission-spot-primary-market-auction-report-2026-data.xlsx (retrieved 2026-10-30)
    eurPerTonne: 85.97,
    usdPerTonne: Math.round(85.97 * USD_PER_EUR * 100) / 100,
    asOf: 'EEX auctions, October 2026 average',
  },
  'ca-cap-and-invest': {
    label: 'California cap-and-invest',
    // Joint California-Quebec auction #48 (2026-08-19), current-vintage
    // settlement $32.48 per allowance (1 t CO2e); reserve price $27.94.
    // https://ww2.arb.ca.gov/sites/default/files/2026-08/nc-aug_2026_summary_results_report.pdf (retrieved 2026-10-30)
    usdPerTonne: 32.48,
    asOf: 'CARB auction, August 2026',
  },
  'wa-cca': {
    label: 'Washington Climate Commitment Act',
    // Auction #15 (2026-09-02) settled at $39.50 per allowance (t CO2e);
    // floor $27.92. (Mar and Jun 2026 cleared at ~$65 (search index).)
    // https://apps.ecology.wa.gov/publications/documents/2614063.pdf (retrieved 2026-10-30)
    usdPerTonne: 39.5,
    asOf: 'Ecology auction, September 2026',
  },
  none: { label: 'No carbon price on on-site combustion', usdPerTonne: 0, asOf: '' },
};

const EU_COUNTRIES = new Set(['IE', 'NL', 'DE', 'SE', 'FR', 'BE', 'DK', 'FI', 'ES', 'IT', 'PL', 'AT', 'PT']);

/** The carbon-price scheme key of a site (see the header). */
export function getSiteCarbonScheme(site) {
  if (EU_COUNTRIES.has(site?.country)) return 'eu-ets';
  if (site?.country === 'US' && site.state === 'CA') return 'ca-cap-and-invest';
  if (site?.country === 'US' && site.state === 'WA') return 'wa-cca';
  return 'none';
}
