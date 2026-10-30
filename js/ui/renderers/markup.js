/*
 * Small HTML-string builders shared by the result renderers.
 *
 * Every text argument is escaped. Only parameters explicitly named `...Html`
 * (e.g. econGroup's rowsHtml) take markup, and callers must build those from
 * these same builders.
 */

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

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escape a value for HTML text content or a double-quoted attribute value. */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => HTML_ESCAPES[char]);
}

export const escapeAttribute = escapeHtml;

export function tooltipAttr(text = '') {
  return text ? ` data-tooltip="${escapeAttribute(text)}"` : '';
}

export function tooltipLabel(label, tooltip = '', className = '') {
  const classNames = [className, tooltip ? 'tooltip-label' : ''].filter(Boolean).join(' ');
  const classAttr = classNames ? ` class="${escapeAttribute(classNames)}"` : '';
  return `<span${classAttr}${tooltipAttr(tooltip)}>${escapeHtml(label)}</span>`;
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
  const noteMarkup = note ? `<span class="econ-metric-note">${escapeHtml(note)}</span>` : '';
  return `<div class="econ-metric ${escapeAttribute(cls)}">
      ${labelMarkup}
      <span class="econ-metric-value">${escapeHtml(value)}</span>
      ${noteMarkup}
    </div>`;
}

/** A collapsible group; `rowsHtml` is trusted markup built with econRow. */
export function econGroup(title, summary, rowsHtml, hint = '') {
  const hintMarkup = hint ? `<span class="econ-group-hint">${escapeHtml(hint)}</span>` : '';
  return `<details class="econ-group">
      <summary>
        <span class="econ-group-copy">
          <span class="econ-group-title">${escapeHtml(title)}</span>
          ${hintMarkup}
        </span>
        <span class="econ-group-summary">${escapeHtml(summary)}</span>
      </summary>
      <div class="econ-group-body">${rowsHtml}</div>
    </details>`;
}

export function econRow(label, value, cls = '', title = '') {
  const labelMarkup = tooltipLabel(label, title, 'econ-label');
  return `<div class="econ-row ${escapeAttribute(cls)}">
      ${labelMarkup}
      <span class="econ-value">${escapeHtml(value)}</span>
    </div>`;
}

/**
 * One cell of the production / environmental-impact grids.
 * `_icon` is unused (the dot colour comes from `cls`); it stays until the callers drop it.
 */
export function prodItem(cls, _icon, label, value, unit) {
  const unitMarkup = unit ? `<span class="prod-unit">${escapeHtml(unit)}</span>` : '';
  return `<div class="production-item ${escapeAttribute(cls)}">
      <span class="prod-label"><span class="prod-dot" aria-hidden="true"></span>${escapeHtml(label)}</span>
      <span class="prod-value">${escapeHtml(value)}${unitMarkup}</span>
    </div>`;
}
