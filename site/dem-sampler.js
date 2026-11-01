// Browser-side DEM sampling with the SAME decoder as packages/geo (compiled into vendor/geo).
// Used for: (1) the live encoding check, (2) elevation along a drawn line.
// Tiles are decoded with colour-space conversion and premultiplication OFF, otherwise the RGB
// bytes (and so the elevations) can be silently altered.

import { decodeRgbaTile, elevationInTile, tileForLonLat } from './vendor/geo/index.js';

export function createDemSampler({ urlTemplate, encoding, tileSize, zoom }) {
  if (!encoding) throw new Error('DEM encoding must be explicit');
  if (!tileSize) throw new Error('DEM tileSize must be explicit');
  const cache = new Map();

  async function loadTile(id) {
    const key = `${id.z}/${id.x}/${id.y}`;
    if (!cache.has(key)) {
      cache.set(key, (async () => {
        const url = urlTemplate.replace('{z}', id.z).replace('{x}', id.x).replace('{y}', id.y);
        const res = await fetch(url);
        if (res.status === 404 || res.status === 204) return null; // no data (e.g. open sea)
        if (!res.ok) throw new Error(`DEM tile ${key}: HTTP ${res.status}`);
        const bmp = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
        if (bmp.width !== tileSize || bmp.height !== tileSize) {
          throw new Error(`DEM tile ${key} is ${bmp.width}×${bmp.height}px but tileSize is declared ${tileSize}`);
        }
        const canvas = new OffscreenCanvas(tileSize, tileSize);
        const ctx = canvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
        ctx.drawImage(bmp, 0, 0);
        const rgba = ctx.getImageData(0, 0, tileSize, tileSize).data;
        return decodeRgbaTile(rgba, tileSize, encoding);
      })());
    }
    return cache.get(key);
  }

  /** Elevation (m) at [lon, lat], or null if no data. */
  async function elevationAt(p) {
    const id = tileForLonLat(p, zoom);
    const tile = await loadTile(id);
    return tile ? elevationInTile(tile, id, p) : null;
  }

  async function elevations(points) {
    // load each distinct tile once, in parallel
    return Promise.all(points.map((p) => elevationAt(p)));
  }

  return { elevationAt, elevations, zoom, encoding, tileSize };
}
