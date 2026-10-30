/* Small HTML-string builders shared by the result renderers */

export const EDUCATIONAL_TOOLTIPS = Object.freeze({
  projectIrr: 'Internal rate of return on project cash flows before debt financing.',
  equityIrr: 'Internal rate of return on sponsor equity cash flows after debt funding and debt service.',
  mirr: 'Modified IRR: outflows discounted and inflows reinvested at the discount rate. Unlike IRR it is always unique, and it does not assume interim cash earns the IRR itself; MIRR is above the discount rate exactly when NPV is positive.',
  effectiveCf: 'Average utilization of the chemical plant after storage smooths solar output.',
  residualChemCf: 'Average utilization left for the chemical plant after AI load is served first.',
  dailyOpHours: 'Average hours per day the chemical plant can run at its modeled load.',
  residualChemHoursDay: 'Average hours per day left for chemicals after AI load is served first.',
  residualChemHoursCycle: 'Average hours per cycle left for chemicals after AI load is served first.',
});

export function escapeAttribute(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function tooltipAttr(text = '') {
  return text ? ` data-tooltip="${escapeAttribute(text)}"` : '';
}

export function tooltipLabel(label, tooltip = '', className = '') {
  const classNames = [className, tooltip ? 'tooltip-label' : ''].filter(Boolean).join(' ');
  const classAttr = classNames ? ` class="${classNames}"` : '';
  return `<span${classAttr}${tooltipAttr(tooltip)}>${label}</span>`;
}

/** Set or clear the data-tooltip of an existing element. */
export function applyTooltip(element, text = '') {
  if (!element) return;
  if (text) {
    if (element.dataset) element.dataset.tooltip = text;
    element.classList?.add('tooltip-label');
    return;
  }
  if (typeof element.removeAttribute === 'function') {
    element.removeAttribute('data-tooltip');
  }
  element.classList?.remove('tooltip-label');
}

export function econMetric(label, value, cls = '', note = '', title = '') {
  const tooltipText = title || note;
  const labelMarkup = tooltipLabel(label, tooltipText, 'econ-metric-label');
  const noteMarkup = note ? `<span class="econ-metric-note">${note}</span>` : '';
  return `<div class="econ-metric ${cls}">
      ${labelMarkup}
      <span class="econ-metric-value">${value}</span>
      ${noteMarkup}
    </div>`;
}

export function econGroup(title, summary, rowsHtml, hint = '') {
  const hintMarkup = hint ? `<span class="econ-group-hint">${hint}</span>` : '';
  return `<details class="econ-group">
      <summary>
        <span class="econ-group-copy">
          <span class="econ-group-title">${title}</span>
          ${hintMarkup}
        </span>
        <span class="econ-group-summary">${summary}</span>
      </summary>
      <div class="econ-group-body">${rowsHtml}</div>
    </details>`;
}

export function econRow(label, value, cls = '', title = '') {
  const labelMarkup = tooltipLabel(label, title, 'econ-label');
  return `<div class="econ-row ${cls}">
      ${labelMarkup}
      <span class="econ-value">${value}</span>
    </div>`;
}

/** One cell of the production / environmental-impact grids. */
export function prodItem(cls, _icon, label, value, unit) {
  const unitMarkup = unit ? `<span class="prod-unit">${unit}</span>` : '';
  return `<div class="production-item ${cls}">
      <span class="prod-label"><span class="prod-dot" aria-hidden="true"></span>${label}</span>
      <span class="prod-value">${value}${unitMarkup}</span>
    </div>`;
}
