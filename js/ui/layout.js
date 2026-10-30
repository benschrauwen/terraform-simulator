/* Page layout behaviour: collapsible sections and the mobile single-pane switcher */

const MOBILE_MAX_WIDTH = 900;
const DEFAULT_MOBILE_PANEL_ID = 'diagramArea';

export const layoutMethods = {
  bindSectionToggles() {
    const syncSectionState = (header, section, body) => {
      const isOpen = section.classList.contains('open');
      header.setAttribute('aria-expanded', String(isOpen));
      if (body) {
        body.hidden = !isOpen;
        body.setAttribute('aria-hidden', String(!isOpen));
      }
    };

    document.querySelectorAll('.section-header').forEach((header, index) => {
      const section = header.closest('.config-section, .results-section');
      const body = section?.querySelector('.section-body');
      if (!section || !body) return;

      if (!body.id) {
        const sectionKey = section.dataset.section || header.dataset.toggle || `section-${index + 1}`;
        body.id = `${sectionKey}SectionBody`;
      }

      header.setAttribute('role', 'button');
      header.setAttribute('tabindex', '0');
      header.setAttribute('aria-controls', body.id);
      syncSectionState(header, section, body);

      const toggleSection = () => {
        section.classList.toggle('open');
        syncSectionState(header, section, body);
        window.requestAnimationFrame(() => this.positionSliderMarkers());
      };

      header.addEventListener('click', toggleSection);
      header.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        toggleSection();
      });
    });
  },

  bindMobilePaneControls() {
    this.mobileLayoutQuery = window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH}px)`);
    this.mobilePaneButtons = Array.from(document.querySelectorAll('.mobile-pane-toggle'));
    this.mobilePanels = Array.from(document.querySelectorAll('.config-panel, .diagram-area, .results-panel'));

    this.mobilePaneButtons.forEach(button => {
      button.addEventListener('click', () => {
        const panelId = button.dataset.panelTarget;
        if (!panelId) return;
        const nextPanelId = this.activeMobilePanelId === panelId
          ? DEFAULT_MOBILE_PANEL_ID
          : panelId;
        this.setMobilePanel(nextPanelId);
      });
    });

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        this.setMobilePanel(DEFAULT_MOBILE_PANEL_ID);
      }
    });

    const handleLayoutChange = () => {
      if (!this.isMobileViewport()) {
        this.activeMobilePanelId = null;
      } else if (!this.mobilePanels.some(panel => panel.id === this.activeMobilePanelId)) {
        this.activeMobilePanelId = DEFAULT_MOBILE_PANEL_ID;
      }
      this.syncMobilePaneState();
    };

    if (this.mobileLayoutQuery?.addEventListener) {
      this.mobileLayoutQuery.addEventListener('change', handleLayoutChange);
    } else if (this.mobileLayoutQuery?.addListener) {
      this.mobileLayoutQuery.addListener(handleLayoutChange);
    }

    this.syncMobilePaneState();
  },

  isMobileViewport() {
    return window.innerWidth <= MOBILE_MAX_WIDTH;
  },

  setMobilePanel(panelId) {
    const nextPanelId = this.isMobileViewport()
      ? (panelId || DEFAULT_MOBILE_PANEL_ID)
      : null;
    const panelChanged = nextPanelId !== this.activeMobilePanelId;
    this.activeMobilePanelId = nextPanelId;
    this.syncMobilePaneState();
    if (panelChanged && this.isMobileViewport()) {
      document.getElementById('mobilePaneBar')?.scrollIntoView({ block: 'start' });
    }
  },

  syncMobilePaneState() {
    const activeId = this.isMobileViewport()
      ? (this.activeMobilePanelId || DEFAULT_MOBILE_PANEL_ID)
      : null;

    this.mobilePanels.forEach(panel => {
      const isActive = panel.id === activeId;
      panel.classList.toggle('mobile-open', isActive);
      panel.setAttribute('aria-hidden', this.isMobileViewport() ? String(!isActive) : 'false');
    });

    this.mobilePaneButtons.forEach(button => {
      const isActive = button.dataset.panelTarget === activeId;
      button.classList.toggle('active', isActive);
      button.setAttribute('aria-expanded', String(isActive));
    });

    window.requestAnimationFrame(() => this.positionSliderMarkers());
  },
};
