/* ============================================
   Plant map: the footprint on a satellite map, to true ground scale
   ============================================
   buildPlantMapLayout(result) lays the footprint blocks out in metres
   around the site pin (x east, y north, origin at the pin):
   - the campus (datacenter, cooling yard, substation, battery, gas or
     reactor plant and, grid-connected, the utility switchyard) is skyline-
     packed (plant-layout.js packRectangles) into a near-square with 15 m
     roads between blocks and centred on the pin; the switchyard and
     substation go first, on the north edge, when grid-connected;
   - the solar field sits to the east of the campus across a 30 m road,
     centred on the campus' north-south midline;
   - grid-connected, a transmission line runs north from the switchyard
     (drawn well past the fitted view, it heads off to the grid).
   Each block keeps its exact footprint area (w x h = area m²) and aspect.

   plantMapMethods (DatacenterApp mixin) draws it with Leaflet on the Esri
   World Imagery tiles (map-geo.js, as the plant builder's site map):
   rectangles and the line styled through Leaflet path options and CSS
   classes (CSP: no style attributes), labelled with Leaflet tooltips built
   from text nodes, and the view fitted to the footprint. If the tiles fail
   (offline), the blocks still draw on the map's plain background and a note
   says so; without Leaflet the Diagram view stays the only one. */

import { offsetLatLon, SATELLITE_TILE_OPTIONS, SATELLITE_TILE_URL } from '../map-geo.js';
import { formatArea } from './format.js';
import { gridTieLabel, packRectangles, plantBlockItems } from './plant-layout.js';

export const MAP_LAYOUT = Object.freeze({ roadM: 15, solarRoadM: 30, campusAspect: 1.25, lineLengthFactor: 1.5, minLineM: 400 });

/** Footprint blocks in metres around the site pin; see the header. */
export function buildPlantMapLayout(r, options = {}) {
  const { roadM, solarRoadM, campusAspect, lineLengthFactor, minLineM } = { ...MAP_LAYOUT, ...options };
  const items = plantBlockItems(r).map(item => ({
    ...item,
    w: Math.sqrt(item.areaM2 * item.aspect),
    h: Math.sqrt(item.areaM2 / item.aspect),
  }));
  const campusItems = items.filter(item => item.key !== 'solarField');
  const solar = items.find(item => item.key === 'solarField');
  const blocks = [];

  // Campus: a strip about campusAspect x as wide as the square of its area (wider if a block needs it).
  let campus = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  if (campusItems.length) {
    const area = campusItems.reduce((sum, item) => sum + item.areaM2, 0);
    const width = Math.max(Math.sqrt(area * campusAspect) + roadM, ...campusItems.map(item => item.w));
    const packed = packRectangles(campusItems, width, roadM);
    const usedWidth = Math.max(...packed.placed.map(p => p.x + p.w));
    // Packing y grows downward from the north edge; centre the campus on the pin.
    const x0 = -usedWidth / 2;
    const yTop = packed.height / 2;
    packed.placed.forEach(p => blocks.push({ ...p, x: x0 + p.x, y: yTop - p.y - p.h }));
    campus = { minX: x0, maxX: x0 + usedWidth, minY: -packed.height / 2, maxY: packed.height / 2 };
  }
  if (solar) {
    const x = campusItems.length ? campus.maxX + solarRoadM : -solar.w / 2;
    blocks.push({ ...solar, x, y: (campus.minY + campus.maxY) / 2 - solar.h / 2 });
  }

  const bounds = blocks.reduce((b, block) => ({
    minX: Math.min(b.minX, block.x),
    maxX: Math.max(b.maxX, block.x + block.w),
    minY: Math.min(b.minY, block.y),
    maxY: Math.max(b.maxY, block.y + block.h),
  }), { minX: 0, maxX: 0, minY: 0, maxY: 0 });

  let line = null;
  const switchyard = blocks.find(block => block.key === 'utilitySwitchyard');
  if (r.grid?.connected && switchyard) {
    const extent = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
    const x = switchyard.x + switchyard.w / 2;
    line = {
      connection: r.grid.connection === 'flexible' ? 'flexible' : 'firm',
      label: gridTieLabel(r),
      from: { x, y: switchyard.y + switchyard.h },
      to: { x, y: bounds.maxY + Math.max(minLineM, extent * lineLengthFactor) },
    };
  }
  return { blocks, bounds, line, totalM2: blocks.reduce((sum, block) => sum + block.areaM2, 0) };
}

const toLatLng = (lat, lon, x, y) => {
  const point = offsetLatLon(lat, lon, x, y);
  return [point.lat, point.lon];
};

/** [[south, west], [north, east]] of a block (metres around the pin) at (lat, lon). */
export function blockLatLngBounds(lat, lon, block) {
  return [toLatLng(lat, lon, block.x, block.y), toLatLng(lat, lon, block.x + block.w, block.y + block.h)];
}

function textElement(lines, className) {
  const el = document.createElement('div');
  el.className = className;
  lines.filter(Boolean).forEach((text, index) => {
    const line = document.createElement(index === 0 ? 'strong' : 'span');
    line.textContent = text;
    el.appendChild(line);
  });
  return el;
}

export const plantMapMethods = {
  /** Create the Leaflet map once; false when Leaflet is unavailable. */
  initPlantMap() {
    if (this.plantMap) return true;
    const el = document.getElementById('plantMap');
    if (!el || typeof L === 'undefined') return false;
    this.plantMap = L.map(el, { zoomControl: false, scrollWheelZoom: false, attributionControl: true });
    L.control.zoom({ position: 'bottomright' }).addTo(this.plantMap);
    this.plantMapTiles = L.tileLayer(SATELLITE_TILE_URL, { ...SATELLITE_TILE_OPTIONS });
    this.plantMapTiles.on('tileerror', () => {
      if (this.plantMapOffline) return;
      this.plantMapOffline = true;
      el.classList.add('plant-map-offline');
      this.updatePlantMapNote();
    });
    this.plantMapTiles.addTo(this.plantMap);
    this.plantMapLayer = L.layerGroup().addTo(this.plantMap);
    return true;
  },

  updatePlantMapNote() {
    const note = document.getElementById('plantMapNote');
    if (!note) return;
    const parts = ['Footprint to true ground scale around the site pin: the campus packed with 15 m roads, the solar field to the east. Hover a block for its size.'];
    if (this.plantMapOffline) parts.push('Satellite tiles could not load, so the blocks are drawn on a plain background.');
    note.textContent = parts.join(' ');
  },

  /** Redraw the map for a result (only while the Map view is shown; Leaflet needs a visible container). */
  updatePlantMap(r) {
    if (this.layoutViewMode !== 'map' || !r) return;
    if (!this.initPlantMap()) return;
    const site = r.site;
    const layout = buildPlantMapLayout(r);
    this.plantMapLayer.clearLayers();
    layout.blocks.forEach(block => {
      L.rectangle(blockLatLngBounds(site.lat, site.lon, block), {
        className: `pl-map-block pl-${block.key}`,
        weight: 1.5,
        opacity: 0.95,
        fillOpacity: 0.8,
      })
        .bindTooltip(textElement([block.name, block.detail, formatArea(block.areaM2)], 'pl-map-tip'), { sticky: true, direction: 'top', className: 'pl-map-tooltip' })
        .addTo(this.plantMapLayer);
    });
    if (layout.line) {
      L.polyline([toLatLng(site.lat, site.lon, layout.line.from.x, layout.line.from.y), toLatLng(site.lat, site.lon, layout.line.to.x, layout.line.to.y)], {
        className: `pl-map-line pl-map-line-${layout.line.connection}`,
        weight: 3,
        dashArray: layout.line.connection === 'flexible' ? '10 7' : null,
      })
        .bindTooltip(textElement([layout.line.label], 'pl-map-tip'), { sticky: true, direction: 'top', className: 'pl-map-tooltip' })
        .addTo(this.plantMapLayer);
    }
    L.circleMarker([site.lat, site.lon], { className: 'pl-map-pin', radius: 4, weight: 2, fillOpacity: 1 })
      .bindTooltip(textElement([site.name, r.grid.connected ? '' : gridTieLabel(r)], 'pl-map-tip'), { direction: 'top', className: 'pl-map-tooltip' })
      .addTo(this.plantMapLayer);
    const { bounds } = layout;
    this.plantMap.invalidateSize();
    this.plantMap.fitBounds([toLatLng(site.lat, site.lon, bounds.minX, bounds.minY), toLatLng(site.lat, site.lon, bounds.maxX, bounds.maxY)], {
      padding: [24, 24],
      maxZoom: 18,
      animate: false,
    });
    this.updatePlantMapNote();
  },
};
