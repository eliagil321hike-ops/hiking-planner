// Browser-side DEM sampling with the SAME decoder as packages/geo (compiled into vendor/geo).
// Used for: (1) the live encoding check, (2) elevation along a drawn line.
// Tiles are decoded with colour-space conversion and premultiplication OFF, otherwise the RGB
// bytes (and so the elevations) can be silently altered.
//
// Zoom fallback: Mapterhorn guarantees z0–12 everywhere, z13+ only in some areas (Meron: z13 yes, z14 no;
// owner run 2026-11-01). If the tile at `zoom` is missing (404), the parent tile is used, down to
// `fallbackMinZoom`. Missing data is never 0: if no tile exists, the result is null.

import { decodeRgbaTile, elevationInTile, tileForLonLat } from './vendor/geo/index.js';

export function createDemSampler({ urlTemplate, encoding, tileSize, zoom, fallbackMinZoom = zoom, maxTiles = 64 }) {
  if (!encoding) throw new Error('DEM encoding must be explicit');
  if (!tileSize) throw new Error('DEM tileSize must be explicit');
  // Decoded tiles, least recently used first (perf review 2026-11-03): a long route or a long session no longer
  // keeps every tile it ever touched in memory (~1 MB each); a failed download is retried next time.
  const cache = new Map();
  const zoomUsed = new Map(); // how often each zoom actually served a sample (for the report)

  async function loadTile(id) {
    const key = `${id.z}/${id.x}/${id.y}`;
    if (cache.has(key)) {                       // refresh its place in the LRU order
      const hit = cache.get(key); cache.delete(key); cache.set(key, hit); return hit;
    }
    {
      const job = (async () => {
        const url = urlTemplate.replace('{z}', id.z).replace('{x}', id.x).replace('{y}', id.y);
        const res = await fetch(url);
        if (res.status === 404 || res.status === 204) return null; // no data at this zoom
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
      })();
      cache.set(key, job);
      job.catch(() => { if (cache.get(key) === job) cache.delete(key); });
      while (cache.size > maxTiles) cache.delete(cache.keys().next().value);
      return job;
    }
  }

  /** Elevation (m) at [lon, lat], or null if no data at any allowed zoom. */
  async function elevationAt(p) {
    for (let z = zoom; z >= fallbackMinZoom; z--) {
      const id = tileForLonLat(p, z);
      const tile = await loadTile(id);
      if (tile) {
        zoomUsed.set(z, (zoomUsed.get(z) ?? 0) + 1);
        return elevationInTile(tile, id, p);
      }
    }
    return null;
  }

  async function elevations(points) {
    return Promise.all(points.map((p) => elevationAt(p)));
  }

  return { elevationAt, elevations, zoom, fallbackMinZoom, encoding, tileSize, zoomUsed, cacheSize: () => cache.size };
}
