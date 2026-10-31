/* Generic spec-driven control binding (input -> state, state -> control), shared by the
   plant builder (controls.js) and the datacenter page. A spec is
   { type: 'range' | 'checkbox' | 'select' | 'number', id, stateKey?, format?, parse?,
   toggles?, onInput?, onChange?, dayViewOnly? } (see control-spec.js). The host app
   provides state, rangeBindings (a Map), syncDynamicVisibility, requestRecalculate,
   recalculate and (for dayViewOnly) refreshDaySpecificViews. */

function readRangeValue(el) {
  const sliderValue = parseFloat(el.value);
  return el.dataset.scale === 'log' ? Math.pow(10, sliderValue) : sliderValue;
}

function writeRangeValue(el, stateValue) {
  const numericState = parseFloat(stateValue);
  el.value = el.dataset.scale === 'log' && Number.isFinite(numericState) && numericState > 0
    ? Math.log10(numericState)
    : stateValue;
}

export const controlBindingMethods = {
  bindControlSpec(spec) {
    const el = document.getElementById(spec.id);
    if (!el) return;
    const stateKey = spec.stateKey || spec.id;

    if (spec.type === 'range') {
      const formatter = value => spec.format(value, this);
      this.rangeBindings.set(spec.id, { id: spec.id, stateKey, formatter });
      el.addEventListener('input', () => {
        const actualValue = readRangeValue(el);
        this.state[stateKey] = actualValue;
        this.syncRangeDisplay(spec.id, actualValue, formatter);
        spec.onInput?.(this);
        this.syncDynamicVisibility();
        if (spec.dayViewOnly) {
          this.refreshDaySpecificViews();
        } else {
          this.requestRecalculate({ includeSensitivity: false });
        }
      });
      return;
    }

    el.addEventListener('change', () => {
      let value;
      if (spec.type === 'checkbox') {
        value = el.checked;
        if (spec.toggles) document.getElementById(spec.toggles)?.classList.toggle('active', value);
      } else if (spec.type === 'number') {
        value = parseFloat(el.value);
      } else {
        value = spec.parse ? spec.parse(el.value) : el.value;
      }
      const previous = this.state[stateKey];
      this.state[stateKey] = value;
      spec.onChange?.(this, value, previous);
      this.recalculate();
    });
  },

  syncControlSpec(spec) {
    const el = document.getElementById(spec.id);
    if (!el) return;
    const stateValue = this.state[spec.stateKey || spec.id];

    if (spec.type === 'range') {
      writeRangeValue(el, stateValue);
      this.syncRangeDisplay(spec.id, stateValue);
    } else if (spec.type === 'checkbox') {
      el.checked = Boolean(stateValue);
      if (spec.toggles) document.getElementById(spec.toggles)?.classList.toggle('active', Boolean(stateValue));
    } else {
      el.value = stateValue;
    }
  },

  syncRangeDisplay(id, value, formatter) {
    const display = document.getElementById(`${id}Value`);
    const format = formatter || this.rangeBindings.get(id)?.formatter;
    if (display && format) display.textContent = format(value);
  },
};
