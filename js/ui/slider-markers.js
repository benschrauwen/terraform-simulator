/* ============================================
   Slider guide markers and log-scale ticks
   ============================================ */

export const SLIDER_MARKERS = {
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
  // Market benchmarks below were checked 2026-10; each carries its source.
  methanePrice: [
    { value: 3, label: 'Low US spot gas' },
    // Whitepaper 2.0 revenue case "at a gas price of $10/kcf":
    // https://terraformindustries.wordpress.com/2023/01/09/terraform-industries-whitepaper-2-0/
    { value: 10, label: 'Whitepaper commodity case' },
    { value: 20, label: 'Generic green methane case' },
    // "Currently we can produce methane for under $30/MCF" (2026-06-16):
    // https://terraformindustries.wordpress.com/2026/06/16/the-enormous-size-of-the-oil-and-gas-market-drives-adoption-of-synthetic-fuel-production/
    { value: 30, label: 'Terraform reported production cost (<$30/MCF, Jun 2026)' },
  ],
  methanolPrice: [
    // CFR China spot $0.54/kg on 2026-10-08 (Procurement Resource, 2026-10-19):
    // https://www.procurementresource.com/news-and-articles/asian-methanol-jumps-64-percent
    { value: 540, label: 'China CFR spot, Oct 2026 (reported)' },
    // Methanex European posted contract EUR 875/t for Q4 2026 x 1.113 USD/EUR (ECB 2026-10-29):
    // https://www.methanex.com/about-methanol/pricing/
    { value: 970, label: 'Europe posted contract, Q4 2026 (Methanex, EUR 875/t)' },
  ],
  batteryCost: [
    // BNEF Energy Storage System Cost Survey 2025 (Dec 2025), turnkey systems excl. EPC
    // and grid connection: https://www.energy-storage.news/behind-the-numbers-bnef-finds-40-year-on-year-drop-in-bess-costs/
    { value: 73, label: 'China turnkey BESS avg (BNEF 2025)' },
    { value: 117, label: 'Global turnkey BESS avg (BNEF 2025)' },
    { value: 177, label: 'Europe turnkey BESS avg (BNEF 2025)' },
    { value: 219, label: 'US turnkey BESS avg (BNEF 2025)' },
  ],
  panelCost: [
    // OPIS Chinese Module Marker $0.109/W, 2026-07-31:
    // https://www.pv-magazine.com/2026/07/31/chinese-topcon-module-prices-fall-as-high-efficiency-supply-adds-pressure/
    { value: 0.11, label: 'TOPCon module FOB China, Jul 2026 (OPIS)' },
    // OPIS DDP US TOPCon 600 W+ $0.290/W, 2026-03-06:
    // https://www.pv-magazine.com/2026/03/06/china-topcon-module-prices-edge-higher-as-march-cargoes-clear/
    { value: 0.29, label: 'TOPCon module DDP US, Mar 2026 (OPIS)' },
  ],
  bosCost: [
    // Terraform 1.8 MW build, Kern County CA, 2026: $1.3M "including land, site
    // improvements" (~$0.72/W). With $0.29/W modules and default land/site prep,
    // the remainder is ~$0.40/W of BOS:
    // https://terraformindustries.wordpress.com/2026/10/27/how-terraform-built-the-cheapest-solar-in-north-america/
    { value: 0.40, label: 'Implied by Terraform 1.8 MW build, 2026 ($0.72/W all-in)' },
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

function ensureRangeInputWrap(input) {
  if (input.parentElement?.classList.contains('range-input-wrap')) {
    return input.parentElement;
  }

  const wrap = document.createElement('div');
  wrap.className = 'range-input-wrap';
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);
  return wrap;
}

function ensureLayer(wrap, className) {
  let layer = wrap.querySelector(`.${className}`);
  if (!layer) {
    layer = document.createElement('div');
    layer.className = className;
    wrap.appendChild(layer);
  }
  return layer;
}

function readSliderBounds(input) {
  const min = parseFloat(input.min);
  const max = parseFloat(input.max);
  return Number.isFinite(min) && Number.isFinite(max) && max > min ? { min, max } : null;
}

function getRangeThumbSize(input) {
  const cssValue = getComputedStyle(input).getPropertyValue('--range-thumb-size').trim();
  const parsed = parseFloat(cssValue);
  return Number.isFinite(parsed) ? parsed : 14;
}

// Place an element over the slider track where the thumb centre would be for `value`.
function positionOnTrack({ input, element, min, max, value }) {
  const width = input.getBoundingClientRect().width;
  if (!width || max <= min) return;

  const thumbSize = getRangeThumbSize(input);
  const ratio = (value - min) / (max - min);
  const left = (thumbSize / 2) + (ratio * Math.max(0, width - thumbSize));
  element.style.left = `${left}px`;
}

export const sliderMarkerMethods = {
  initSliderMarkers() {
    this.sliderMarkerBindings = [];
    this.logTickBindings = [];

    Object.entries(SLIDER_MARKERS).forEach(([id, markers]) => {
      const input = document.getElementById(id);
      if (!input) return;

      const markerLayer = ensureLayer(ensureRangeInputWrap(input), 'slider-markers');
      const bounds = readSliderBounds(input);
      if (!bounds) return;

      const isLog = input.dataset.scale === 'log';
      const formatter = this.rangeBindings.get(id)?.formatter;
      markerLayer.innerHTML = '';

      markers.forEach(marker => {
        const sliderValue = isLog ? Math.log10(marker.value) : marker.value;
        if (sliderValue < bounds.min || sliderValue > bounds.max) return;

        const markerButton = document.createElement('button');
        markerButton.type = 'button';
        markerButton.className = 'slider-marker';

        const valueText = formatter ? formatter(marker.value) : String(marker.value);
        const tooltipText = `${valueText} - ${marker.label}`;
        markerButton.dataset.tooltip = tooltipText;
        markerButton.setAttribute('aria-label', tooltipText);

        markerButton.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          input.value = String(sliderValue);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.focus();
        });

        markerLayer.appendChild(markerButton);
        this.sliderMarkerBindings.push({ input, element: markerButton, ...bounds, value: sliderValue });
      });
    });

    this.initLogSliderTicks();
    this.positionSliderMarkers();
  },

  initLogSliderTicks() {
    document.querySelectorAll('input[type="range"][data-scale="log"]').forEach(input => {
      const wrap = ensureRangeInputWrap(input);
      wrap.classList.add('has-log-ticks');

      const tickLayer = ensureLayer(wrap, 'slider-log-ticks');
      tickLayer.innerHTML = '';

      const bounds = readSliderBounds(input);
      if (!bounds) return;

      const realMin = Math.pow(10, bounds.min);
      const realMax = Math.pow(10, bounds.max);

      for (let decade = Math.floor(bounds.min); decade <= Math.ceil(bounds.max); decade++) {
        for (const m of [1, 2, 5]) {
          const realValue = m * Math.pow(10, decade);
          if (realValue < realMin * 0.999 || realValue > realMax * 1.001) continue;

          const tick = document.createElement('span');
          tick.className = m === 1 ? 'slider-log-tick major' : 'slider-log-tick minor';
          if (m === 1) {
            const label = document.createElement('span');
            label.className = 'slider-log-tick-label';
            label.textContent = realValue >= 1000
              ? `${(realValue / 1000).toLocaleString()}k`
              : `${realValue}`;
            tick.appendChild(label);
          }
          tickLayer.appendChild(tick);
          this.logTickBindings.push({ input, element: tick, ...bounds, value: Math.log10(realValue) });
        }
      }
    });
  },

  positionSliderMarkers() {
    this.sliderMarkerBindings.forEach(positionOnTrack);
    (this.logTickBindings || []).forEach(positionOnTrack);
  },
};
