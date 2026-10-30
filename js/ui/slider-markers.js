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
