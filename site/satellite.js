// Satellite background (DECISIONS D-017). One raster layer, swapped by provider, drawn above the base
// map's fills and below roads, trails, contours and labels, so the overlays stay readable on imagery.
// It drapes on the 3D terrain automatically. Keys are typed by the user and kept in this browser only.

export const SAT_SOURCE = 'satellite';
export const SAT_LAYER = 'satellite';

/** Build the raster source for a provider; returns null if a required key is missing. */
export function satelliteSource(provider, key) {
  if (provider.needsKey && !key) return null;
  const fill = (t) => t.replace('{key}', encodeURIComponent(key ?? ''));
  // TileJSON providers: tile URL, size, zoom range and credits come from the provider's own metadata.
  if (provider.tilejson) return { type: 'raster', url: fill(provider.tilejson), attribution: provider.attribution };
  return {
    type: 'raster',
    tiles: [fill(provider.tiles)],
    tileSize: provider.tileSize,
    maxzoom: provider.maxzoom,
    attribution: provider.attribution,
  };
}

/** Show `provider` as the satellite layer (replacing any previous one), inserted before `beforeId`. */
export function setSatellite(map, provider, key, beforeId) {
  if (map.getLayer(SAT_LAYER)) map.removeLayer(SAT_LAYER);
  if (map.getSource(SAT_SOURCE)) map.removeSource(SAT_SOURCE);
  const src = satelliteSource(provider, key);
  if (!src) return false;
  map.addSource(SAT_SOURCE, src);
  map.addLayer({
    id: SAT_LAYER,
    type: 'raster',
    source: SAT_SOURCE,
    paint: { 'raster-fade-duration': 150 },
  }, map.getLayer(beforeId) ? beforeId : undefined);
  return true;
}

export function removeSatellite(map) {
  if (map.getLayer(SAT_LAYER)) map.removeLayer(SAT_LAYER);
  if (map.getSource(SAT_SOURCE)) map.removeSource(SAT_SOURCE);
}

// Browser storage is a convenience only: it can be blocked or empty (private window), so every access is guarded.
export const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* ignore */ } },
};
