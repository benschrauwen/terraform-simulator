/* ============================================
   Slider guide markers
   ============================================ */

const SLIDER_MARKERS = {
  chemicalSizingPercent: [
    { value: 70, label: 'Aggressive peak shaving' },
    { value: 85, label: 'Moderate peak shaving' },
    { value: 100, label: 'Full-capture default' },
  ],
  aiTokenPrice: [
    { value: 1, label: 'Low-value internal workload' },
    { value: 3, label: 'Balanced default case' },
    { value: 5, label: 'Higher-value inference mix' },
  ],
  aiTokensPerMWh: [
    { value: 400, label: 'Heavier models / lower throughput' },
    { value: 1000, label: 'Balanced default case' },
    { value: 1600, label: 'Lighter models / higher throughput' },
  ],
  methanePrice: [
    { value: 3, label: 'Low US spot gas' },
    { value: 10, label: 'Whitepaper commodity case' },
    { value: 20, label: 'Generic green methane case' },
    { value: 35, label: '2024 premium CH4 sale' },
  ],
  methanolPrice: [
    { value: 350, label: 'China spot price' },
    { value: 600, label: 'Europe' },
    { value: 1000, label: 'Green methanol' },
  ],
  batteryCost: [
    { value: 80, label: 'China' },
    { value: 150, label: 'Europe / US' },
  ],
  panelCost: [
    { value: 0.11, label: 'Mono-crystalline, no tariffs' },
    { value: 0.3, label: 'Mono-crystalline, with tariffs' },
  ],
  landCost: [
    { value: 2500, label: 'Cheap ag / desert land' },
    { value: 10000, label: 'Higher-value land' },
  ],
  sitePrepCost: [
    { value: 8000, label: 'Light clearing / grading' },
    { value: 20000, label: 'Heavier site prep' },
  ],
};
