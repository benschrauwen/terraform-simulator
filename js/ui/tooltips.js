/* Shared hover/focus tooltip for any element carrying a data-tooltip attribute */

function resolveTooltipTarget(rawTarget) {
  const element = rawTarget && typeof rawTarget.closest === 'function'
    ? rawTarget
    : rawTarget?.parentElement;
  if (!element || typeof element.closest !== 'function') return null;
  return element.closest('[data-tooltip]');
}

export const tooltipMethods = {
  createHoverTooltip() {
    if (this.hoverTooltip) return;

    this.hoverTooltip = document.createElement('div');
    this.hoverTooltip.className = 'hover-tooltip';
    document.body.appendChild(this.hoverTooltip);

    window.addEventListener('scroll', () => this.hideHoverTooltip(), true);
    window.addEventListener('resize', () => {
      this.hideHoverTooltip();
      this.positionSliderMarkers();
    });
  },

  bindHoverTooltips() {
    if (this.hoverTooltipBindingsAttached) return;
    this.hoverTooltipBindingsAttached = true;

    document.addEventListener('mouseover', event => {
      const target = resolveTooltipTarget(event.target);
      if (!target?.dataset.tooltip) return;
      if (target.contains(event.relatedTarget)) return;
      this.showHoverTooltip(target, target.dataset.tooltip);
    });

    document.addEventListener('mouseout', event => {
      const target = resolveTooltipTarget(event.target);
      if (!target) return;
      if (target.contains(event.relatedTarget)) return;
      this.hideHoverTooltip();
    });

    document.addEventListener('focusin', event => {
      const target = resolveTooltipTarget(event.target);
      if (!target?.dataset.tooltip) return;
      this.showHoverTooltip(target, target.dataset.tooltip);
    });

    document.addEventListener('focusout', event => {
      const target = resolveTooltipTarget(event.target);
      if (!target) return;
      this.hideHoverTooltip();
    });
  },

  showHoverTooltip(target, text) {
    if (!this.hoverTooltip || !text) return;

    this.hoverTooltip.textContent = text;
    this.hoverTooltip.classList.add('visible');

    const rect = target.getBoundingClientRect();
    const tooltipRect = this.hoverTooltip.getBoundingClientRect();
    const margin = 8;
    const left = Math.min(
      window.innerWidth - tooltipRect.width - margin,
      Math.max(margin, rect.left + (rect.width / 2) - (tooltipRect.width / 2))
    );
    const preferredTop = rect.top - tooltipRect.height - 10;
    const top = preferredTop >= margin
      ? preferredTop
      : Math.min(window.innerHeight - tooltipRect.height - margin, rect.bottom + 10);

    this.hoverTooltip.style.left = `${left}px`;
    this.hoverTooltip.style.top = `${top}px`;
  },

  hideHoverTooltip() {
    if (!this.hoverTooltip) return;
    this.hoverTooltip.classList.remove('visible');
  },
};
