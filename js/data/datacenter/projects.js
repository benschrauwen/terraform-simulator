/* ============================================
   Real AI datacenter projects (the "Real projects" picker)
   ============================================
   Each entry prefills the simulator with what is publicly known about one
   real project at one of the site presets (sites.js), so its economics can
   be checked. Only the design is set; the user's prices, revenue and
   finance settings are kept.

   Entry: { id, name, operator, siteId, location (the real place and how far
   it is from the preset), status, summary,
     design: state fields the project fixes (itCapacityMW, gpuPlatform,
       coolingTechnology, architecture, gridConnection, gridImportCapMW,
       solarSizeMWdc, batteryCapacityMWh, batteryDurationHours, firmFamily,
       gasType, firmSizingMode, firmUnits, gasUnitSizeMW); a field left out
       keeps the architecture's starting design (state/datacenter-
       projects.js applyDatacenterProject),
     facts: [{ label, value, source, date, basis? }] — every public number
       with its source URL and date; basis 'search index' when only a search
       engine's extract was read, 'estimate' for Epoch AI's satellite and
       permit based estimates, 'inferred' when derived here (no source),
     assumptions: what the design fills in that the sources do not say }.

   The simulator models one IT size, one gas type and one grid connection
   for the whole horizon, so a project that mixes turbine models, or runs on
   bridge power until the utility arrives, is approximated; the assumptions
   say how. Sources gathered 2026-10-31; several pages (DCD, Business Wire,
   Oracle newsroom, Virginia DEQ) refused automated access and are marked
   'search index'. */

const EPOCH = 'https://epoch.ai/data/ai-data-centers/directory/';
const ORACLE_FACT_SHEET = 'https://arrington.house.gov/UploadedFiles/FINAL_Oracle_OAI_Data_Center_Fact_Sheet_092225b.pdf';

export const DATACENTER_PROJECTS = Object.freeze([
  {
    id: 'stargate-abilene',
    name: 'Stargate Abilene',
    operator: 'Crusoe (developer) · Oracle (tenant) · OpenAI',
    siteId: 'abilene-tx',
    location: 'Lancium Clean Campus, Abilene, Taylor County TX: on the Abilene preset (~10 km).',
    status: 'operating',
    summary: 'The first Stargate campus: eight buildings of GB200 NVL72 on a 1.2 GW ERCOT interconnection, with an on-site gas turbine plant Oracle describes as backup.',
    design: {
      itCapacityMW: 824, gpuPlatform: 'gb200-nvl72', coolingTechnology: 'dlc-dry-cooler',
      architecture: 'hybrid', gridConnection: 'firm', solarSizeMWdc: 0, batteryCapacityMWh: 0,
      firmFamily: 'gas', gasType: 'aero', gasUnitSizeMW: 36, firmSizingMode: 'manual', firmUnits: 10,
    },
    facts: [
      { label: 'Campus', value: '1.2 GW, 8 buildings, ~4 million sq ft (the 1.2 GW is the grid interconnection, not IT)', source: 'https://www.crusoe.ai/resources/newsroom/crusoe-expands-ai-data-center-campus-in-abilene-to-1-2-gigawatts', date: '2025-03-18' },
      { label: 'Delivered', value: '6 of 8 buildings, "representing 618 megawatts" (Oracle Q1 FY27 call)', source: 'https://www.fool.com/earnings/call-transcripts/2026/09/11/oracle-orcl-q1-2027-earnings-call-transcript/', date: '2026-09-11' },
      { label: 'IT load', value: '~824 MW IT at 8 buildings (~103 MW per building), Q4 2026', source: `${EPOCH}openai-stargate-abilene`, date: '2026-07-15', basis: 'estimate' },
      { label: 'First power', value: 'Construction from Jun 2024; GB200 racks from Jun 2025; phase 1 live 2025-09-30', source: 'https://www.crusoe.ai/resources/newsroom/crusoe-announces-flagship-abilene-data-center-is-live', date: '2025-09-30' },
      { label: 'GPUs', value: 'Up to 50,000 GB200 NVL72 per building', source: 'https://www.crusoe.ai/resources/newsroom/crusoe-expands-ai-data-center-campus-in-abilene-to-1-2-gigawatts', date: '2025-03-18' },
      { label: 'Cooling', value: 'Direct-to-chip liquid, closed loop, no evaporation; ~12,625 gal per building per year', source: ORACLE_FACT_SHEET, date: '2025-09-23' },
      { label: 'On-site gas', value: '360 MW plant: 10 turbines and 62 backup diesel generators; a major permit pending for 41 more turbines; permits allow continuous operation, Crusoe says backup only', source: 'https://www.texastribune.org/2026/07/09/texas-data-centers-ai-power-plants-pollution-state-permits/', date: '2026-07-09' },
      { label: 'Turbines', value: 'GE LM2500XPRESS and Solar Titan 350 units, 360 MW combined', source: 'https://cleanview.co/reports/behind-the-meter-data-centers/full-report/stargate-abilene', date: '2026', basis: 'search index' },
      { label: 'Capex', value: '~$15B debt and equity for the facility; ~$40B of Nvidia chips bought by Oracle', source: 'https://the-decoder.com/openais-stargate-secures-11-6-billion-dollars-for-mega-data-center/', date: '2025-05', basis: 'search index' },
    ],
    assumptions: [
      'All 8 buildings at Epoch\'s ~103 MW IT each (824 MW); the simulator models the campus as one phase.',
      'The 360 MW gas plant as 10 aeroderivative turbines of 36 MW (LM2500XPRESS class); the simulator runs them whenever gas is cheaper than grid power, while Oracle says they are backup.',
      'Firm ERCOT service (not public whether the connection is flexible); the planned behind-the-meter solar and batteries have no public size and are left out.',
      'The 62 backup diesel generators are not added (one generator type per design), so the turbines alone cover utility outages and the uptime falls short of a Tier III target.',
    ],
  },
  {
    id: 'crusoe-microsoft-abilene',
    name: 'Crusoe Abilene AI factory for Microsoft',
    operator: 'Crusoe (developer) · Microsoft (tenant)',
    siteId: 'abilene-tx',
    location: 'Next to Stargate Abilene, Abilene TX.',
    status: 'under construction',
    summary: 'A 900 MW campus of two 336 MW critical-IT buildings with its own behind-the-meter power plant and a battery; the first building is due mid-2027.',
    design: {
      itCapacityMW: 336, coolingTechnology: 'dlc-dry-cooler',
      architecture: 'hybrid', gridConnection: 'firm', solarSizeMWdc: 0, batteryCapacityMWh: 0,
      firmFamily: 'gas', gasType: 'recip', firmSizingMode: 'auto',
    },
    facts: [
      { label: 'Announced', value: '2026-03-27; land clearing underway; first building energized mid-2027', source: 'https://www.crusoe.ai/resources/newsroom/crusoe-announces-new-900-mw-ai-factory-campus-in-abilene-texas-to-support-microsoft-ai-infrastructure', date: '2026-03-27' },
      { label: 'IT load', value: '336 MW critical IT for the first building; two buildings on a 900 MW campus', source: 'https://www.crusoe.ai/resources/newsroom/crusoe-announces-new-900-mw-ai-factory-campus-in-abilene-texas-to-support-microsoft-ai-infrastructure', date: '2026-03-27' },
      { label: 'Power', value: '900 MW behind-the-meter on-site power plant (fuel not disclosed) plus a medium-voltage battery (size not disclosed)', source: 'https://www.crusoe.ai/resources/newsroom/crusoe-announces-new-900-mw-ai-factory-campus-in-abilene-texas-to-support-microsoft-ai-infrastructure', date: '2026-03-27' },
      { label: 'Fuel', value: 'Probably natural gas or fuel cells (The Register\'s reading)', source: 'https://www.theregister.com/2026/03/27/microsoft_ai_crusoe/', date: '2026-03-27', basis: 'search index' },
      { label: 'Cooling', value: 'Closed-loop, non-evaporative liquid cooling', source: 'https://www.crusoe.ai/resources/newsroom/crusoe-announces-new-900-mw-ai-factory-campus-in-abilene-texas-to-support-microsoft-ai-infrastructure', date: '2026-03-27' },
    ],
    assumptions: [
      'The first 336 MW building only.',
      'GPUs are "next-generation" and unnamed: your GPU platform is kept.',
      'Generator type unknown: reciprocating gas engines, sized for the uptime target; the plant\'s grid connection is not described, so a firm ERCOT connection is assumed. The battery has no public size and is left out.',
    ],
  },
  {
    id: 'stargate-frontier',
    name: 'Vantage Frontier (Stargate Shackelford County)',
    operator: 'Vantage Data Centers · Oracle (tenant) for OpenAI · VoltaGrid (power)',
    siteId: 'abilene-tx',
    location: 'Shackelford County near Albany TX, ~50 km NE of the Abilene preset (same ERCOT West climate).',
    status: 'under construction',
    summary: 'A 1.4 GW, ten-building campus powered entirely off-grid by an on-site gas engine microgrid: the clearest public example of an islanded engine-powered AI campus.',
    design: {
      itCapacityMW: 1400, coolingTechnology: 'dlc-dry-cooler',
      architecture: 'islanded', solarSizeMWdc: 0, batteryCapacityMWh: 0,
      firmFamily: 'gas', gasType: 'recip', firmSizingMode: 'auto',
    },
    facts: [
      { label: 'Campus', value: '1.4 GW across 10 buildings, 3.7M sq ft, racks of 250 kW and up, $25B', source: 'https://ir.digitalbridge.com/news-releases/news-release-details/digitalbridge-backed-portfolio-company-vantage-data-centers', date: '2025-08-19', basis: 'search index' },
      { label: 'IT vs gross', value: '1.4 GW critical IT, 2.58 GW gross power', source: 'https://cleanview.co/reports/behind-the-meter-data-centers/full-report/stargate-frontier', date: '2026-04', basis: 'search index' },
      { label: 'Power', value: 'On-site, behind-the-meter gas microgrid of Jenbacher reciprocating engines', source: ORACLE_FACT_SHEET, date: '2025-09-23' },
      { label: 'Schedule', value: 'First building in H2 2026; closed-loop chillers needing minimal water', source: ORACLE_FACT_SHEET, date: '2025-09-23' },
      { label: 'Completion', value: '~2 GW facility power, projected Q4 2028', source: 'https://epoch.ai/blog/openai-stargate-where-the-us-sites-stand', date: '2026-04-17', basis: 'estimate' },
    ],
    assumptions: [
      'The whole 1.4 GW of IT as one phase.',
      'Engine count and size are not public: reciprocating engines at the default unit size, sized for the uptime target with N+2 spares.',
      'GPUs not public: your GPU platform is kept.',
    ],
  },
  {
    id: 'meta-hyperion',
    name: 'Meta Hyperion',
    operator: 'Meta · Entergy Louisiana (power)',
    siteId: 'richland-la',
    location: 'Holly Ridge, Richland Parish LA: on the preset.',
    status: 'under construction',
    summary: 'Meta\'s largest campus, served by Entergy from new utility combined-cycle plants built for it (front of the meter), not by on-site generation.',
    design: {
      itCapacityMW: 2000, coolingTechnology: 'dlc-dry-cooler',
      architecture: 'grid', gridConnection: 'firm', solarSizeMWdc: 0, batteryCapacityMWh: 0,
      firmFamily: 'gas', gasType: 'standby-diesel', firmSizingMode: 'auto',
    },
    facts: [
      { label: 'Campus', value: '5 GW of IT capacity, nearly 10M sq ft, 3,650 acres; $50B+', source: 'https://www.opportunitylouisiana.gov/news/meta-commits-more-than-50-billion-for-north-louisiana-project-becoming-one-of-the-largest-data-centers-in-history', date: '2026-07-13' },
      { label: 'Phase', value: '2 GW by 2030 (Meta)', source: 'https://www.datacenterdynamics.com/en/news/meta-expands-data-center-campus-in-richland-parish-louisiana-to-5gw-will-invest-50bn/', date: '2026-07', basis: 'search index' },
      { label: 'First phase', value: '~1,632 MW IT, first operation ~Jan 2028', source: `${EPOCH}meta-hyperion`, date: '2026-09-21', basis: 'estimate' },
      { label: 'Utility supply', value: 'Entergy Louisiana (MISO), 20-year agreement', source: 'https://www.opportunitylouisiana.gov/news/meta-commits-more-than-50-billion-for-north-louisiana-project-becoming-one-of-the-largest-data-centers-in-history', date: '2026-07-13' },
      { label: 'Phase 1 plants', value: '3 combined-cycle units of ~754 MW (2,262 MW), up to 1,500 MW of solar and a 500 kV line; LPSC approved 4-1 on 2025-08-20', source: 'https://www.power-eng.com/gas/combined-cycle/entergy-louisiana-gets-approval-to-build-3-new-combined-cycle-plants-to-power-huge-meta-data-center/', date: '2025-08', basis: 'search index' },
      { label: 'Phase 2', value: '7 more gas plants (~5.2 GW), 3 grid batteries; Meta pays $11B; final LPSC vote expected Nov 2026', source: 'https://thelensnola.org/2026/03/30/meta-triples-order-of-gas-fired-power-plants-for-its-ai-campus-in-louisiana/', date: '2026-03-30' },
      { label: 'Cooling', value: 'Closed-loop glycol system with dry cooling most of the year', source: 'https://datacenters.atmeta.com/richland-parish-data-center/', date: '2026' },
    ],
    assumptions: [
      'The 2 GW phase Meta targets for 2030, as IT MW (Meta quotes the campus in IT capacity).',
      'Utility power at the site\'s industrial price; the Entergy contract price is not public.',
      'Standby diesel backup sized for the uptime target (not described publicly). GPUs not public: your GPU platform is kept.',
    ],
  },
  {
    id: 'meta-prometheus',
    name: 'Meta Prometheus',
    operator: 'Meta · Williams (on-site power) · AEP Ohio',
    siteId: 'new-albany-oh',
    location: 'New Albany OH: on the preset (~5 km).',
    status: 'operating',
    summary: 'A GB200/GB300 training cluster that started on a capped utility connection plus two islanded 200 MW gas plants (Williams Socrates) of small turbines and engines.',
    design: {
      itCapacityMW: 471, gpuPlatform: 'gb200-nvl72', coolingTechnology: 'dlc-dry-cooler',
      architecture: 'hybrid', gridConnection: 'firm', gridImportCapMW: 250, solarSizeMWdc: 0, batteryCapacityMWh: 0,
      firmFamily: 'gas', gasType: 'bridge', gasUnitSizeMW: 20, firmSizingMode: 'manual', firmUnits: 30,
    },
    facts: [
      { label: 'IT load', value: '471 MW IT on 2026-08-31; 676 MW by 2026-11-30; 1,022 MW by Jul 2028', source: `${EPOCH}meta-prometheus`, date: '2026-08-31', basis: 'estimate' },
      { label: 'Phase 1', value: 'Complete; "hundreds of thousands" of GB200/GB300 GPUs, scaling toward ~1M', source: 'https://thenextweb.com/news/meta-prometheus-supercluster-1-million-gpus-muse', date: '2026-10-19', basis: 'search index' },
      { label: 'Grid', value: 'AEP Ohio interim service up to 250 MW (2026-2028), 85% minimum demand charge', source: 'https://measuredai.substack.com/p/meta-prometheus-google-ohio', date: '2026-05-20' },
      { label: 'Socrates South', value: '200 MW behind the meter, not grid-connected: 3 Solar Titan 250, 9 Solar PGM 130, 3 Siemens SGT-400 and 15 Cat 3520 engines', source: 'https://www.power-eng.com/gas/onsite-gas-turbines-reciprocating-engines-to-power-meta-data-center/', date: '2025-06-11' },
      { label: 'Socrates North', value: '200 MW of gas turbines and engines, in service Q3 2026', source: 'https://www.williams.com/wp-content/uploads/sites/8/2025/03/Socrates-North-Fact-Sheet-Final-1.pdf', date: '2025-03' },
      { label: 'Nameplate', value: 'Socrates South ~307.5 MW across 30 units for 200 MW net (N+1+1); ~$1.6B', source: 'https://measuredai.substack.com/p/meta-prometheus-google-ohio', date: '2026-05-20' },
    ],
    assumptions: [
      'The 471 MW IT running on 2026-08-31 (Epoch estimate).',
      'Both Socrates plants as 30 small turbines of 20 MW (600 MW nameplate, close to 2 x 307.5 MW), run on cost; the simulator has one generator type, so the Cat engines are folded in.',
      'Grid capped at the 250 MW interim AEP service; cooling not public, so direct-to-chip liquid is assumed.',
    ],
  },
  {
    id: 'project-jupiter',
    name: 'Project Jupiter (Stargate New Mexico)',
    operator: 'STACK Infrastructure · BorderPlex · Oracle (tenant) for OpenAI',
    siteId: 'dona-ana-nm',
    location: 'Santa Teresa, Doña Ana County NM: on the preset.',
    status: 'under construction',
    summary: 'A four-building Stargate campus now planned on an off-grid microgrid of up to 2.45 GW of Bloom solid-oxide fuel cells; permits and the gas pipeline are contested.',
    design: {
      itCapacityMW: 1750, coolingTechnology: 'dlc-dry-cooler',
      architecture: 'islanded', solarSizeMWdc: 0, batteryCapacityMWh: 0,
      firmFamily: 'gas', gasType: 'sofc', firmSizingMode: 'auto',
    },
    facts: [
      { label: 'Power', value: 'A single microgrid of up to 2.45 GW of Bloom fuel cells, not grid-connected; diesel backup dropped', source: 'https://haussamen.com/2026/04/27/project-jupiter-unveils-less-polluting-power-plan/', date: '2026-04-27' },
      { label: 'Earlier plan', value: 'Behind-the-meter gas turbines (Siemens and GE) plus diesel backup', source: ORACLE_FACT_SHEET, date: '2025-09-23' },
      { label: 'Campus', value: '4 buildings on 1,400 acres; closed-loop cooling with a one-time fill; up to $165B over its life', source: ORACLE_FACT_SHEET, date: '2025-09-23' },
      { label: 'IT load', value: '~1,750 MW IT projected Q4 2028', source: `${EPOCH}openai-stargate-new-mexico`, date: '2026-07-31', basis: 'estimate' },
      { label: 'Status', value: 'Oracle sent a force-majeure notice to STACK/Blue Owl; Oracle says the 2028 opening is on schedule', source: 'https://baxtel.com/news/oracle-issues-force-majeure-notice-to-blue-owl-over-project-jupiter-data-center-setbacks', date: '2026-09-24' },
      { label: 'Permits', value: 'The NM Supreme Court paused the well-water and air permits', source: 'https://www.upr.org/politics/2026-09-01/new-mexico-data-center-project-juniper-paused', date: '2026-09-01' },
    ],
    assumptions: [
      'Epoch\'s 1,750 MW IT for the four buildings; fuel cells sized for the uptime target with N+2 spares.',
      'The solar array visible on site has no public size and is left out. GPUs not public: your GPU platform is kept.',
    ],
  },
  {
    id: 'google-haskell',
    name: 'Google Haskell County + Intersect Quantum',
    operator: 'Google (Intersect acquired, closed Mar 2026)',
    siteId: 'haskell-tx',
    location: 'Google South Haskell campus, ~25 km from the Haskell County preset.',
    status: 'under construction',
    summary: 'A Google campus co-located with 640 MW of solar and a 1.3 GWh battery (Intersect Quantum, operating since Jun 2026) on an ERCOT connection.',
    design: {
      itCapacityMW: 440, coolingTechnology: 'dlc-dry-cooler',
      architecture: 'hybrid', gridConnection: 'firm', solarSizeMWdc: 640, batteryCapacityMWh: 1300, batteryDurationHours: 4,
      firmFamily: 'none',
    },
    facts: [
      { label: 'Solar + storage', value: '640 MW solar PV and a 1.3 GWh battery, co-located; Quantum I+II operating Jun 2026', source: 'https://www.intersect.com/portfolio/quantum', date: '2026-06' },
      { label: 'Grid', value: 'Co-location to "make better use of existing grid capacity" (ERCOT)', source: 'https://www.datacenters.google/google-commits-to-increasing-energy-abundance-and-reliability-for-texans/', date: '2025-11-14' },
      { label: 'Data center', value: 'Not disclosed by Google; ~440 MW (Aterio estimate), a 250 MVA 345 kV substation, ~1.4M sq ft', source: 'https://www.datacenterdynamics.com/en/news/google-linked-housebound-group-files-for-two-data-center-projects-in-haskell-texas/', date: '2026', basis: 'search index' },
      { label: 'Schedule', value: 'Buildings 2027-2029, first in 2027; substation energized 2026', source: 'https://baxtel.com/campus/google-south-haskell-campus', date: '2026' },
    ],
    assumptions: [
      'IT size from a third-party estimate (440 MW): edit it.',
      '640 MW of solar taken as MWdc (AC/DC not stated) and the 1.3 GWh battery as 4-hour (325 MW).',
      'No on-site gas is mentioned. Google uses TPUs: your GPU platform stands in for them; cooling not public.',
    ],
  },
  {
    id: 'fairwater-atlanta',
    name: 'Microsoft Fairwater Atlanta',
    operator: 'Microsoft (on QTS\'s Fayetteville campus)',
    siteId: 'atlanta-ga',
    location: 'Fayetteville, Fayette County GA, ~35 km south of the Atlanta preset.',
    status: 'operating',
    summary: 'Microsoft\'s AI superfactory site, sited for resilient utility power and built without on-site generation, UPS or dual-corded distribution.',
    design: {
      itCapacityMW: 636, gpuPlatform: 'gb200-nvl72', coolingTechnology: 'dlc-dry-cooler',
      architecture: 'grid', gridConnection: 'firm', solarSizeMWdc: 0, batteryCapacityMWh: 0,
      firmFamily: 'none',
    },
    facts: [
      { label: 'Operation', value: 'Began operation Oct 2025', source: 'https://news.microsoft.com/source/features/ai/from-wisconsin-to-atlanta-microsoft-connects-datacenters-to-build-its-first-ai-superfactory/', date: '2025-11-12' },
      { label: 'Power design', value: '"4x9 availability at 3x9 cost": no on-site generation, UPS or dual-corded distribution; on-site storage and GPU power smoothing', source: 'https://blogs.microsoft.com/blog/2025/11/12/infinite-scale-the-architecture-behind-the-azure-ai-superfactory/', date: '2025-11-12' },
      { label: 'GPUs', value: 'GB200 NVL72 (and GB300), ~140 kW per rack', source: 'https://blogs.microsoft.com/blog/2025/11/12/infinite-scale-the-architecture-behind-the-azure-ai-superfactory/', date: '2025-11-12' },
      { label: 'Cooling', value: 'Closed-loop liquid cooling, no evaporation; two-story buildings', source: 'https://blogs.microsoft.com/blog/2025/11/12/infinite-scale-the-architecture-behind-the-azure-ai-superfactory/', date: '2025-11-12' },
      { label: 'IT load', value: '~321 MW IT (Oct 2025), ~636 MW IT with buildings 3-4 (Jun 2026)', source: `${EPOCH}microsoft-fairwater-atlanta`, date: '2026-07-17', basis: 'estimate' },
    ],
    assumptions: [
      'Four buildings at Epoch\'s ~636 MW IT.',
      'No backup generation, as Microsoft describes: the utility\'s outages show up as unserved hours against your uptime target. The smoothing storage has no public size and is left out.',
    ],
  },
  {
    id: 'fleet-tric',
    name: 'Fleet Data Centers at Tahoe-Reno (TRIC)',
    operator: 'Fleet Data Centers (Tract) · single AA- tenant',
    siteId: 'reno-nv',
    location: 'Storey County NV, within ~20 km of the TRIC preset.',
    status: 'under construction',
    summary: 'A 200 MW IT campus that will run on temporary on-site gas plants fed by trucked LNG/CNG for 2-3 years until NV Energy can serve it.',
    design: {
      itCapacityMW: 200, coolingTechnology: 'dlc-dry-cooler',
      architecture: 'islanded', solarSizeMWdc: 0, batteryCapacityMWh: 0,
      firmFamily: 'gas', gasType: 'recip', firmSizingMode: 'manual', firmUnits: 36,
    },
    facts: [
      { label: 'Campus', value: '230 MW utility / ~200 MW critical IT; 16.4-year triple-net lease; $3.8B + $4.6B of senior secured notes', source: 'https://baxtel.com/news/fleet-data-centers-raises-4-6bn-for-nevada-data-center-campus', date: '2026-05-05' },
      { label: 'Temporary plants', value: 'South Valley 144 MW and Peru Ridge 218 MW (362 MW) of "dozens" of gas engines on trucked LNG/CNG', source: 'https://www.carsonnow.org/?p=215001', date: '2026-05-03' },
      { label: 'Approval', value: 'PUCN approved 362 MW of temporary plants on 2026-09-17, subject to air permits', source: 'https://news.constructconnect.com/nevada-regulators-approve-362-mw-of-temporary-power-projects-for-data-centers', date: '2026-09-21' },
      { label: 'Duration', value: 'Plants built in 2027, running 2-3 years until NV Energy service', source: 'https://www.carsonnow.org/?p=215001', date: '2026-05-03' },
    ],
    assumptions: [
      'The 362 MW as 36 reciprocating engines of 10 MW, islanded for the whole horizon (the simulator cannot switch to the grid after 2-3 years).',
      'Trucked LNG/CNG costs more than pipeline gas: raise the fuel price to test it. GPUs and cooling not public.',
    ],
  },
  {
    id: 'vantage-va2',
    name: 'Vantage VA2 (Sterling, Loudoun County)',
    operator: 'Vantage Data Centers',
    siteId: 'ashburn-va',
    location: 'Sterling VA, ~7 km from the Ashburn preset.',
    status: 'operating',
    summary: 'A Northern Virginia campus running off-grid on mobile gas turbines while Dominion\'s connection is constrained; a cloud campus rather than an AI one.',
    design: {
      itCapacityMW: 96, coolingTechnology: 'air-chiller',
      architecture: 'islanded', solarSizeMWdc: 0, batteryCapacityMWh: 0,
      firmFamily: 'gas', gasType: 'bridge', gasUnitSizeMW: 16.5, firmSizingMode: 'manual', firmUnits: 8,
    },
    facts: [
      { label: 'Campus', value: '96 MW critical across 3 buildings', source: 'https://www.datacentermap.com/usa/virginia/sterling/vantage-va2-campus/specs', date: '2026', basis: 'search index' },
      { label: 'Turbines', value: '8 Solar SMT-130 simple-cycle turbines of 16.5 MW (132 MW) running continuously off-grid; 40 emergency diesel sets', source: 'https://deq.virginia.gov/home/showpublisheddocument/25986/638633875365530000', date: '2024', basis: 'search index' },
      { label: 'Permit', value: 'DEQ air permit 2023-09-15; turbines operating from Apr 2024', source: 'https://cleanview.co/reports/behind-the-meter-data-centers/full-report/vantage-va2', date: '2026', basis: 'search index' },
    ],
    assumptions: [
      'Islanded on the 8 mobile turbines for the whole horizon (Vantage plans to move to the grid when it can).',
      'Not an AI campus: GPU rental revenue is your setting; switch the revenue to colocation to compare. Cooling not public (air assumed).',
    ],
  },
  {
    id: 'project-baccara',
    name: 'Project Baccara (west Maricopa County)',
    operator: 'Takanock · Baccara Power · tenant not public',
    siteId: 'phoenix-az',
    location: 'Near Luke AFB / Surprise AZ, ~35 km NW of the Phoenix preset.',
    status: 'announced',
    summary: 'A two-building campus of up to 500 MW that brings its own 700 MW gas plant, approved by the Arizona Corporation Commission in Feb 2026.',
    design: {
      itCapacityMW: 500, coolingTechnology: 'dlc-dry-cooler',
      architecture: 'islanded', solarSizeMWdc: 0, batteryCapacityMWh: 0,
      firmFamily: 'gas', gasType: 'aero', gasUnitSizeMW: 43.8, firmSizingMode: 'manual', firmUnits: 16,
    },
    facts: [
      { label: 'Gas plant', value: '700.2 MW co-located plant, approved 5-0 by the ACC on 2026-02-04', source: 'https://www.azcc.gov/news/home/2026/02/06/vice-chair-walden-releases-statement-on-project-baccara', date: '2026-02-06' },
      { label: 'Schedule', value: 'County permit 2026-05-06; construction from Q3 2026 pending an air permit; DC1 2028, DC2 2030; 160 acres; $36B', source: 'https://coppercourier.com/news/politics/project-baccara-greenlit/', date: '2026-05-07' },
      { label: 'Campus', value: 'Up to 500 MW across 2 buildings; 16 or 18 turbines; plant-only for the first 2 years, then APS', source: 'https://coppercourier.com/news/politics/project-baccara-greenlit/', date: '2026-05-07', basis: 'search index' },
    ],
    assumptions: [
      'Up to 500 MW taken as IT MW (basis not stated).',
      'The 700 MW plant as 16 aeroderivative turbines of 43.8 MW, islanded for the whole horizon (APS service after 2 years is not modeled).',
      'Tenant, GPUs and cooling not public.',
    ],
  },
  {
    id: 'xai-colossus-1',
    name: 'xAI Colossus 1 (SpaceX)',
    operator: 'SpaceX (xAI acquired Feb 2026) · leased in full to Anthropic',
    siteId: 'memphis-tn',
    location: 'Paul R. Lowry Rd, south Memphis TN (a former Electrolux factory), ~7 km from the Memphis preset.',
    status: 'operating',
    summary: 'xAI\'s first supercomputer: ~100k H100 online in 122 days in 2024, since grown to ~230k GPUs at 300+ MW; curtailable MLGW/TVA grid supply backed by a permitted 15-turbine gas plant and Tesla Megapacks.',
    design: {
      itCapacityMW: 300, gpuPlatform: 'h100-sxm', coolingTechnology: 'dlc-cooling-tower',
      architecture: 'hybrid', gridConnection: 'flexible', gridImportCapMW: 150,
      solarSizeMWdc: 0, batteryCapacityMWh: 650, batteryDurationHours: 4,
      firmFamily: 'gas', gasType: 'bridge', gasUnitSizeMW: 16.5, firmSizingMode: 'manual', firmUnits: 15,
    },
    facts: [
      { label: 'First cluster', value: '~100,000 H100, ~130 MW of compute power, online in 122 days (SpaceX prospectus)', source: 'https://www.sec.gov/Archives/edgar/data/1181412/000162828026042639/spaceexplorationtechnologi.htm', date: '2026-06-12' },
      { label: 'GPUs', value: '150k H100 + 50k H200 (Feb 2025) + 30k GB200 (Jul 2025), ~230k in all', source: 'https://epoch.ai/data/ai-data-centers/directory/colossus-1', date: '2025-07', basis: 'estimate' },
      { label: 'Anthropic', value: 'Anthropic uses all of Colossus 1 (>300 MW, >220,000 GPUs); SpaceX\'s agreements cover ~325,000 GPUs across both Colossus sites at $1.25B a month through May 2029', source: 'https://www.sec.gov/Archives/edgar/data/1181412/000162828026042639/spaceexplorationtechnologi.htm', date: '2026-06-12' },
      { label: 'IT load', value: '~340 MW (from Jul 2025); capex ~$12.9B', source: 'https://epoch.ai/data/ai-data-centers/directory/colossus-1', date: '2026-06', basis: 'estimate' },
      { label: 'Grid', value: '150 MW from MLGW/TVA (a new xAI-funded substation); a second 150 MW pending; a signed agreement makes xAI curtail when demand is high; industrial rate', source: 'https://www.mlgw.com/images/content/files/pdf/new/xAI%202025%20Update.pdf', date: '2025' },
      { label: 'Grid since', value: 'MLGW supplies under 160 MW across both SpaceXAI campuses', source: 'https://www.aol.com/articles/tva-board-approves-agreement-spacexai-234602000.html', date: '2026-08-20' },
      { label: 'Power strategy', value: 'Buys grid power as available; behind-the-meter generation and Megapacks when the grid is curtailed', source: 'https://www.sec.gov/Archives/edgar/data/1181412/000162828026042639/spaceexplorationtechnologi.htm', date: '2026-06-12' },
      { label: 'Gas permit', value: 'Shelby County permit for 15 permanent gas turbines with emission caps', source: 'https://www.actionnews5.com/2025/07/02/health-dept-grants-permit-xai-turbines/', date: '2025-07-02' },
      { label: 'Turbines', value: '15 Solar SMT-130 mobile turbines, ~247 MW; ~35 turbines were seen running before the permit', source: 'https://www.gem.wiki/Colossus_1_power_station', date: '2026' },
      { label: 'Megapacks', value: '168 Tesla Megapacks, ~150 MW', source: 'https://www.bloomberg.com/news/articles/2025-05-07/musk-s-xai-to-use-tesla-batteries-at-memphis-supercomputer', date: '2025-05-07', basis: 'search index' },
      { label: 'Cooling', value: 'Supermicro liquid-cooled HGX racks; air-cooled chillers removed by Feb 2026, 33 evaporative cooling towers (~310 MW)', source: 'https://epoch.ai/data/ai-data-centers/directory/colossus-1', date: '2026-02', basis: 'estimate' },
    ],
    assumptions: [
      'IT at 300 MW (Anthropic\'s ">300 MW"; Epoch estimates 340 MW).',
      'H100 as the platform (most of the ~230k GPUs); the H200 and GB200 are not modelled separately.',
      'Grid capped at the confirmed 150 MW and flexible (the curtailment agreement); the curtailment hours are not public.',
      'Battery 650 MWh / 4 h from 168 Megapacks x ~3.9 MWh (no source gives the MWh).',
      'Gas: the 15 permitted SMT-130 turbines (16.5 MW, mobile type), run on cost; the earlier unpermitted units are left out.',
    ],
  },
  {
    id: 'xai-colossus-2',
    name: 'xAI Colossus 2 (SpaceX)',
    operator: 'SpaceX (xAI; MZX Tech holds the Southaven plant)',
    siteId: 'memphis-tn',
    location: 'Data halls on Tulane Rd, Whitehaven, Memphis TN; gas plant in Southaven MS; ~5-6 km from the Memphis preset.',
    status: 'operating',
    summary: 'SpaceX\'s gigawatt-scale training campus, built to run entirely on its own Southaven gas plant (41 permitted turbines, ~1.2 GW) and the largest Megapack battery yet, with TVA grid supply added over time.',
    design: {
      itCapacityMW: 1000, gpuPlatform: 'gb300-nvl72', coolingTechnology: 'dlc-dry-cooler',
      architecture: 'hybrid', gridConnection: 'flexible', gridImportCapMW: 100,
      solarSizeMWdc: 0, batteryCapacityMWh: 3300, batteryDurationHours: 2,
      firmFamily: 'gas', gasType: 'industrial-sc', gasUnitSizeMW: 29.3, firmSizingMode: 'manual', firmUnits: 41,
    },
    facts: [
      { label: 'Clusters', value: '~110,000 GB200 (~210 MW, 91 days), then 110,000 GB300 (220 MW, 64 days); at least 220,000 more GB300 (>400 MW) planned', source: 'https://www.sec.gov/Archives/edgar/data/1181412/000162828026042639/spaceexplorationtechnologi.htm', date: '2026-06-12' },
      { label: 'Power design', value: '"Capable of operating entirely" on a self-built behind-the-meter gigawatt-scale gas plant, supplemented over time by grid capacity; direct-to-chip cooling', source: 'https://www.sec.gov/Archives/edgar/data/1181412/000162828026042639/spaceexplorationtechnologi.htm', date: '2026-06-12' },
      { label: 'Compute', value: 'SpaceX nameplate compute 1.4 GW (Jun 30) to 1.7 GW (Sep 30, 2026) as Colossus 2 was built out', source: 'https://www.sec.gov/Archives/edgar/data/1181412/000162828026066482/spaceexplorationtechnologi.htm', date: '2026-10-20' },
      { label: 'IT load', value: '946 MW (Jun 2026), 1,531 MW projected Q1 2027; capex ~$35.8B so far', source: 'https://epoch.ai/data/ai-data-centers/directory/colossus-2', date: '2026-06', basis: 'estimate' },
      { label: 'Gas permit', value: 'Mississippi Permit Board approved 41 permanent gas turbines (MZX Tech, Southaven)', source: 'https://www.mississippifreepress.org/mississippi-permit-board-grants-xais-request-for-41-southaven-gas-turbines-to-power-memphis-data-center/', date: '2026-03-10' },
      { label: 'Plant size', value: '41 turbines, ~1,200 MW simple cycle; MDEQ counted up to 69 temporary turbines (~1,775 MW) in Jul 2026', source: 'https://www.scientificamerican.com/article/spacexais-colossus-data-center-is-fueling-a-massive-backlash/', date: '2026-09-09' },
      { label: 'Temporary turbines', value: 'All 69 temporary turbines to be removed by Jul 2027 under an agreed MDEQ order', source: 'https://qz.com/spacex-xai-unpermitted-turbines-removal-memphis-073126', date: '2026-07-31', basis: 'search index' },
      { label: 'Battery', value: '~720 Megapacks (~2.8 GWh, 720-1,400 MW); SpaceXAI told TVA 3.3 GWh', source: 'https://www.canarymedia.com/articles/batteries/xai-massive-battery-memphis-data-center', date: '2026-09-11' },
      { label: 'TVA', value: 'TVA approved >100 MW of direct service for MZX Tech under a new data-center rate (+10% above 5 MW)', source: 'https://www.aol.com/articles/tva-board-approves-agreement-spacexai-234602000.html', date: '2026-08-20' },
      { label: 'Turbine purchases', value: '~$2.0B of mobile gas turbines (2026-04-30) plus $925M of turbine purchase agreements through 2029', source: 'https://www.sec.gov/Archives/edgar/data/1181412/000162828026042639/spaceexplorationtechnologi.htm', date: '2026-06-12' },
      { label: 'Cooling', value: '217 air-cooled chillers and 144 dry coolers (~412 MW), no cooling towers', source: 'https://epoch.ai/data/ai-data-centers/directory/colossus-2', date: '2026-06', basis: 'estimate' },
      { label: 'Litigation', value: 'NAACP Clean Air Act suit over the mobile turbines continues (US allowed to intervene 2026-10-19)', source: 'https://www.sec.gov/Archives/edgar/data/1181412/000162828026066880/spcx-20260930.htm', date: '2026-10-22' },
    ],
    assumptions: [
      'IT at 1,000 MW, between the prospectus cluster sum (~830 MW when complete) and Epoch\'s 946 MW, so the ~1.2 GW gas plant can carry the facility as SpaceX says.',
      'Gas: the permanent 41 turbines at ~29.3 MW each (1,200 / 41), as industrial simple cycle; the temporary fleet being retired by Jul 2027 is left out. The permitted turbine model was not confirmed.',
      'Battery 3,300 MWh (SpaceXAI\'s figure) at 2 h (~1.65 GW, between the reported 720-2,000 MW).',
      'Grid capped at TVA\'s ">100 MW" and flexible (MLGW says the site can come off the grid); the total is undisclosed.',
    ],
  },
]);

/** The project for an id, or null. */
export function getDatacenterProject(projectId) {
  return DATACENTER_PROJECTS.find(project => project.id === projectId) || null;
}
