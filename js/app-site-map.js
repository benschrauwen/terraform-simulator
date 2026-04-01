/* Site map helpers attached to App */

window.AppSiteMapMethods = {
  initSiteMap() {
    const mapEl = document.getElementById('siteMap');
    if (!mapEl || this.siteMap) return;
    const palette = (typeof Diagram !== 'undefined' && Diagram.colors) ? Diagram.colors : {};
    const markerColor = palette.electric || '#5f7fb8';
    const overlayColor = palette.solar || '#c6923a';

    if (typeof L === 'undefined') {
      this.showSiteMapMessage(
        'Satellite map failed to load.',
        'Satellite imagery is temporarily unavailable, but the footprint metrics still update from the model.'
      );
      return;
    }

    this.siteMap = L.map(mapEl, {
      zoomControl: false,
      scrollWheelZoom: false,
      attributionControl: true,
    });
    this.siteMap.setView([this.state.latitude || 0, this.state.longitude || 0], 14, {
      animate: false,
    });

    L.control.zoom({ position: 'bottomright' }).addTo(this.siteMap);

    L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {
        attribution: 'Tiles &copy; Esri',
        maxZoom: 19,
      }
    ).addTo(this.siteMap);

    this.siteMapMarker = L.circleMarker([this.state.latitude, this.state.longitude], {
      radius: 4,
      color: '#ffffff',
      weight: 2,
      fillColor: markerColor,
      fillOpacity: 0.95,
    }).addTo(this.siteMap);

    this.siteMapOverlay = L.rectangle(
      [
        [this.state.latitude, this.state.longitude],
        [this.state.latitude, this.state.longitude],
      ],
      {
        color: overlayColor,
        weight: 2,
        fillColor: overlayColor,
        fillOpacity: 0.22,
        interactive: false,
      }
    ).addTo(this.siteMap);

    this.siteMapModuleLayer = L.layerGroup().addTo(this.siteMap);
  },

  showSiteMapMessage(message, noteText) {
    const mapEl = document.getElementById('siteMap');
    const emptyEl = document.getElementById('siteMapEmpty');
    const noteEl = document.getElementById('siteMapNote');

    if (mapEl) mapEl.hidden = true;
    if (emptyEl) {
      emptyEl.hidden = false;
      emptyEl.textContent = message;
    }
    if (noteEl && noteText) noteEl.textContent = noteText;
  },

  showSiteMap(noteText) {
    const mapEl = document.getElementById('siteMap');
    const emptyEl = document.getElementById('siteMapEmpty');
    const noteEl = document.getElementById('siteMapNote');

    if (mapEl) mapEl.hidden = false;
    if (emptyEl) emptyEl.hidden = true;
    if (noteEl && noteText) noteEl.textContent = noteText;
  },

  getSquareBounds(lat, lon, sideMeters, minSideMeters = 20) {
    const halfSide = Math.max(sideMeters, minSideMeters) / 2;
    const metersPerDegLat = 111320;
    const metersPerDegLon = Math.max(111320 * Math.cos((lat * Math.PI) / 180), 1000);
    const deltaLat = halfSide / metersPerDegLat;
    const deltaLon = halfSide / metersPerDegLon;

    return [
      [lat - deltaLat, lon - deltaLon],
      [lat + deltaLat, lon + deltaLon],
    ];
  },

  formatArea(areaM2) {
    if (!Number.isFinite(areaM2) || areaM2 <= 0) return '—';

    const acres = areaM2 / 4046.8564224;
    if (acres >= 0.5) return `${FormatNumbers.fixed(acres, 1)} acres`;
    if (areaM2 >= 1e6) return `${FormatNumbers.fixed(areaM2 / 1e6, 2)} km2`;
    return `${Math.round(areaM2).toLocaleString()} m2`;
  },

  formatDistance(meters) {
    if (!Number.isFinite(meters) || meters <= 0) return '—';
    if (meters >= 1000) return `${FormatNumbers.fixed(meters / 1000, 2)} km`;
    return `${Math.round(meters).toLocaleString()} m`;
  },

  hexToRgba(hex, alpha) {
    if (typeof hex !== 'string') return `rgba(255,255,255,${alpha})`;
    const normalized = hex.length === 4
      ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
      : hex;
    const r = parseInt(normalized.slice(1, 3), 16);
    const g = parseInt(normalized.slice(3, 5), 16);
    const b = parseInt(normalized.slice(5, 7), 16);
    if (![r, g, b].every(Number.isFinite)) return `rgba(255,255,255,${alpha})`;
    return `rgba(${r},${g},${b},${alpha})`;
  },

  getSiteFootprintColor(id) {
    const palette = (typeof Diagram !== 'undefined' && Diagram.colors) ? Diagram.colors : {};
    const colorMap = {
      total: palette.solar || '#c6923a',
      solar: palette.solar || '#c6923a',
      battery: palette.battery || '#6c76a9',
      ai: palette.ai || '#78a6d8',
      electrolyzer: palette.h2 || '#6ba5b5',
      dac: palette.co2 || '#8c84b4',
      sabatier: palette.methane || '#6ba177',
      methanol: palette.methanol || '#b47b41',
    };
    return colorMap[id] || palette.inactive || '#8d99a8';
  },

  getSiteFootprintAbbreviation(id) {
    const labelMap = {
      ai: 'AI',
      electrolyzer: 'ELY',
      dac: 'DAC',
      battery: 'BAT',
      sabatier: 'CH4',
      methanol: 'MeOH',
    };
    return labelMap[id] || String(id || '').slice(0, 4).toUpperCase();
  },

  buildSiteFootprintEstimate(r) {
    const solarAreaM2 = Math.max(r?.solar?.landAreaM2 || 0, 0);

    // Order-of-magnitude process-building footprints tuned so a 1 MW case
    // still looks solar-dominated, similar to Terraform's cartoon render.
    const rawItems = [
      {
        id: 'ai',
        label: 'AI datacenter',
        areaM2: r.ai.enabled ? Math.max(48, (r.ai.designLoadKW || 0) * 0.25) : 0,
      },
      {
        id: 'electrolyzer',
        label: 'Electrolyzer',
        areaM2: r.electrolyzer.enabled ? Math.max(24, (r.electrolyzer.allocKW || 0) * 0.03) : 0,
      },
      {
        id: 'dac',
        label: 'DAC',
        areaM2: r.dac.enabled ? Math.max(36, (r.dac.co2AnnualTons || 0) * 0.35) : 0,
      },
      {
        id: 'battery',
        label: 'Battery yard',
        areaM2: r.storage.enabled ? Math.max(20, ((r.storage.battCapKWh || 0) / 1000) * 6) : 0,
      },
      {
        id: 'sabatier',
        label: 'Methane plant',
        areaM2: r.sabatier.enabled ? Math.max(9, (r.sabatier.designHourlyRate || 0) * 4) : 0,
      },
      {
        id: 'methanol',
        label: 'Methanol plant',
        areaM2: r.methanol.enabled ? Math.max(12, (r.methanol.designHourlyOutputKg || 0) * 0.12) : 0,
      },
    ];

    const processItems = rawItems
      .filter(item => Number.isFinite(item.areaM2) && item.areaM2 > 0)
      .map(item => ({
        ...item,
        sideMeters: Math.sqrt(item.areaM2),
        color: this.getSiteFootprintColor(item.id),
      }))
      .sort((a, b) => b.areaM2 - a.areaM2);

    const processAreaM2 = processItems.reduce((sum, item) => sum + item.areaM2, 0);
    const totalAreaM2 = solarAreaM2 + processAreaM2;
    const totalSideMeters = totalAreaM2 > 0 ? Math.sqrt(totalAreaM2) : 0;

    return {
      solarAreaM2,
      processAreaM2,
      totalAreaM2,
      totalSideMeters,
      items: totalAreaM2 > 0
        ? [{
            id: 'total',
            label: 'Total site',
            areaM2: totalAreaM2,
            sideMeters: totalSideMeters,
            color: this.getSiteFootprintColor('total'),
          }, ...processItems]
        : [],
    };
  },

  renderSiteFootprintEstimate() {
    const el = document.getElementById('siteMapFootprints');
    if (!el) return;
    el.hidden = true;
    el.innerHTML = '';
  },

  offsetLatLon(lat, lon, offsetXMeters, offsetYMeters) {
    const metersPerDegLat = 111320;
    const metersPerDegLon = Math.max(111320 * Math.cos((lat * Math.PI) / 180), 1000);
    return {
      lat: lat + (offsetYMeters / metersPerDegLat),
      lon: lon + (offsetXMeters / metersPerDegLon),
    };
  },

  clearSiteMapModuleSquares() {
    if (this.siteMapModuleLayer) this.siteMapModuleLayer.clearLayers();
  },

  renderSiteMapModuleSquares(lat, lon, footprint) {
    this.clearSiteMapModuleSquares();
    if (!this.siteMapModuleLayer || !footprint?.items?.length) return;

    const total = footprint.items.find(item => item.id === 'total');
    if (!total || !Number.isFinite(total.sideMeters) || total.sideMeters <= 0) return;

    const layoutOrder = {
      ai: 0,
      dac: 0,
      sabatier: 1,
      electrolyzer: 2,
      methanol: 3,
      battery: 4,
    };
    const processItems = footprint.items.filter(item => item.id !== 'total');
    if (!processItems.length) return;

    const totalSide = total.sideMeters;
    const gapMeters = Math.max(1.5, totalSide * 0.012);
    const marginMeters = Math.max(2.5, totalSide * 0.04);
    const minVisibleSideMeters = Math.max(1.4, totalSide * 0.022);
    const rowItems = processItems
      .map(item => ({
        ...item,
        sideMeters: Math.max(item.sideMeters, minVisibleSideMeters),
        sortOrder: layoutOrder[item.id] ?? 99,
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder);

    const rowWidth = rowItems.reduce((sum, item) => sum + item.sideMeters, 0) + (Math.max(0, rowItems.length - 1) * gapMeters);
    const maxSide = rowItems.reduce((max, item) => Math.max(max, item.sideMeters), 0);
    const availableWidth = Math.max(totalSide - (marginMeters * 2), totalSide * 0.3);
    const availableHeight = Math.max(totalSide - (marginMeters * 2), totalSide * 0.3);
    const layoutScale = rowWidth > 0 || maxSide > 0
      ? Math.min(
          1,
          rowWidth > 0 ? availableWidth / rowWidth : 1,
          maxSide > 0 ? (availableHeight * 0.28) / maxSide : 1
        )
      : 1;
    const scaledGapMeters = gapMeters * layoutScale;
    let cursorX = (-totalSide / 2) + marginMeters;
    const topEdge = (totalSide / 2) - marginMeters;

    rowItems.forEach(item => {
      const scaledSide = item.sideMeters * layoutScale;
      const x = cursorX + (scaledSide / 2);
      const y = topEdge - (scaledSide / 2);
      const center = this.offsetLatLon(lat, lon, x, y);
      const bounds = this.getSquareBounds(center.lat, center.lon, scaledSide, 0);
      L.rectangle(bounds, {
        color: item.color,
        weight: 1,
        opacity: 0.95,
        fillColor: item.color,
        fillOpacity: 0.42,
        interactive: false,
      }).addTo(this.siteMapModuleLayer);
      cursorX += scaledSide + scaledGapMeters;
    });

    if (this.siteMapMarker?.bringToFront) this.siteMapMarker.bringToFront();
    if (this.siteMapOverlay?.bringToBack) this.siteMapOverlay.bringToBack();
  },

  updateSiteMap(r) {
    const areaEl = document.getElementById('siteMapArea');
    const squareEl = document.getElementById('siteMapSquare');
    const earthScenario = r.solar.bodyKey === 'earth';
    const hasCoords = Number.isFinite(this.state.latitude) && Number.isFinite(this.state.longitude);
    const footprint = this.buildSiteFootprintEstimate(r);
    const landAreaM2 = Math.max(footprint.totalAreaM2 || 0, 0);
    const squareSideMeters = footprint.totalSideMeters;
    const mapNote = 'Satellite view for Earth locations. The highlighted amber square is the estimated total site footprint (solar + active plant modules); the smaller colored squares sit at the top-left as a simple side-by-side process row.';

    this.renderSiteFootprintEstimate(footprint);

    if (areaEl) areaEl.textContent = `Area ${this.formatArea(landAreaM2)}`;
    if (squareEl) squareEl.textContent = `Side ${this.formatDistance(squareSideMeters)}`;

    if (!earthScenario) {
      this.clearSiteMapModuleSquares();
      this.showSiteMapMessage(
        'Satellite imagery is only available for Earth locations in this pane.',
        'Satellite view is Earth-only. The footprint numbers still reflect the modeled solar + plant footprint.'
      );
      return;
    }

    if (!hasCoords) {
      this.clearSiteMapModuleSquares();
      this.showSiteMapMessage(
        'Enter a valid latitude and longitude to render the site footprint.',
        'The footprint numbers still reflect the current modeled solar + plant footprint.'
      );
      return;
    }

    this.initSiteMap();
    if (!this.siteMap || !this.siteMapOverlay || !this.siteMapMarker) {
      this.clearSiteMapModuleSquares();
      this.showSiteMapMessage(
        'Satellite imagery is unavailable right now.',
        'The footprint metrics still update, but the live map could not be initialized.'
      );
      return;
    }

    this.showSiteMap(mapNote);

    const bounds = this.getSquareBounds(this.state.latitude, this.state.longitude, squareSideMeters);
    this.siteMapMarker.setLatLng([this.state.latitude, this.state.longitude]);
    this.siteMapOverlay.setBounds(bounds);
    this.clearSiteMapModuleSquares();

    window.requestAnimationFrame(() => {
      if (!this.siteMap) return;
      this.siteMap.invalidateSize();
      this.siteMap.fitBounds(bounds, {
        padding: [28, 28],
        maxZoom: 18,
        animate: false,
      });
      this.renderSiteMapModuleSquares(this.state.latitude, this.state.longitude, footprint);
    });
  },
};
