/* Shared satellite-map pieces for the plant builder's site map (site-map.js) and the datacenter
   plant map (datacenter/plant-map.js): the Esri World Imagery tile source (the CSP's img-src
   allows the server.arcgisonline.com host) and a local flat-earth metres <-> degrees conversion,
   good to well under 1% over the few kilometres a site spans. Pure; no DOM. */

export const SATELLITE_TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
export const SATELLITE_TILE_OPTIONS = Object.freeze({ attribution: 'Tiles &copy; Esri', maxZoom: 19 });

const METERS_PER_DEG_LAT = 111320;

/** Metres per degree of longitude at `lat` (floored so the poles stay finite). */
export function metersPerDegreeLon(lat) {
  return Math.max(METERS_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180), 1000);
}

/** The point `offsetXMeters` east and `offsetYMeters` north of (lat, lon). */
export function offsetLatLon(lat, lon, offsetXMeters, offsetYMeters) {
  return {
    lat: lat + (offsetYMeters / METERS_PER_DEG_LAT),
    lon: lon + (offsetXMeters / metersPerDegreeLon(lat)),
  };
}

/** [[south, west], [north, east]] of a widthMeters x heightMeters rectangle centred on (lat, lon). */
export function getRectBounds(lat, lon, widthMeters, heightMeters, minWidthMeters = 20, minHeightMeters = minWidthMeters) {
  const halfWidth = Math.max(widthMeters, minWidthMeters) / 2;
  const halfHeight = Math.max(heightMeters, minHeightMeters) / 2;
  const deltaLat = halfHeight / METERS_PER_DEG_LAT;
  const deltaLon = halfWidth / metersPerDegreeLon(lat);
  return [
    [lat - deltaLat, lon - deltaLon],
    [lat + deltaLat, lon + deltaLon],
  ];
}
