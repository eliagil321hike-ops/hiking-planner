// Slope angle and aspect from the DEM, computed in the browser per tile (D-038). Pure functions: no DOM, so
// they are unit-tested in node (tests/terrain-derive.test.mjs). The map protocol that feeds them is at the end.
//
// Method: Horn (1981) 3×3 gradient on Terrarium elevations; pixel ground size from the tile's latitude
// (Web Mercator). Tile edges use the nearest inner pixel (clamped), so classes stay continuous across tiles.

const EARTH_CIRC = 40075016.686;

/** Terrarium RGB → metres. */
export function terrariumToElevation(rgba, n) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = rgba[i * 4] * 256 + rgba[i * 4 + 1] + rgba[i * 4 + 2] / 256 - 32768;
  return out;
}

/** Ground metres per pixel for each row of a size×size tile z/y (Web Mercator). */
export function rowMetresPerPixel(z, y, size) {
  const out = new Float32Array(size);
  const world = size * 2 ** z;
  for (let r = 0; r < size; r++) {
    const my = (y * size + r + 0.5) / world;             // 0..1 from the north edge
    const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * my)));
    out[r] = (EARTH_CIRC * Math.cos(lat)) / world;
  }
  return out;
}

/** Slope (degrees) and aspect (degrees clockwise from north, direction the slope faces; -1 when flat). */
export function slopeAspect(elev, size, mpp) {
  const slope = new Float32Array(size * size);
  const aspect = new Float32Array(size * size);
  const at = (c, r) => elev[Math.min(size - 1, Math.max(0, r)) * size + Math.min(size - 1, Math.max(0, c))];
  for (let r = 0; r < size; r++) {
    const d = mpp[r];
    for (let c = 0; c < size; c++) {
      const a = at(c - 1, r - 1), b = at(c, r - 1), cc = at(c + 1, r - 1);
      const dd = at(c - 1, r), f = at(c + 1, r);
      const g = at(c - 1, r + 1), h = at(c, r + 1), ii = at(c + 1, r + 1);
      const dzdx = ((cc + 2 * f + ii) - (a + 2 * dd + g)) / (8 * d);   // east positive
      const dzdy = ((g + 2 * h + ii) - (a + 2 * b + cc)) / (8 * d);    // south positive (rows go down)
      const k = r * size + c;
      const grad = Math.hypot(dzdx, dzdy);
      slope[k] = (Math.atan(grad) * 180) / Math.PI;
      // downhill direction = -gradient; north is -row, so the "north" component is +dzdy
      aspect[k] = grad < 1e-6 ? -1 : ((Math.atan2(-dzdx, dzdy) * 180) / Math.PI + 360) % 360;
    }
  }
  return { slope, aspect };
}

// Slope classes for walkers (scrambling and avalanche-style bands); below 15° nothing is drawn.
export const SLOPE_CLASSES = [
  { min: 15, rgba: [244, 226, 84, 200], label: '15–25°' },
  { min: 25, rgba: [242, 156, 56, 215], label: '25–30°' },
  { min: 30, rgba: [226, 70, 46, 225], label: '30–35°' },
  { min: 35, rgba: [158, 52, 170, 230], label: '35–45°' },
  { min: 45, rgba: [60, 28, 92, 235], label: '45°+' },
];

// Aspect: eight directions, distinct hues (N blue … S red); flat ground (< 5°) is left clear.
export const ASPECT_CLASSES = [
  { dir: 'N', rgba: [52, 98, 214, 190] }, { dir: 'NE', rgba: [38, 160, 196, 190] },
  { dir: 'E', rgba: [76, 178, 70, 190] }, { dir: 'SE', rgba: [196, 200, 58, 190] },
  { dir: 'S', rgba: [226, 74, 58, 190] }, { dir: 'SW', rgba: [232, 142, 56, 190] },
  { dir: 'W', rgba: [170, 84, 196, 190] }, { dir: 'NW', rgba: [100, 80, 214, 190] },
];

export function colorize(kind, slope, aspect, out) {
  for (let k = 0; k < slope.length; k++) {
    let c = null;
    if (kind === 'slope') {
      for (let j = SLOPE_CLASSES.length - 1; j >= 0; j--) if (slope[k] >= SLOPE_CLASSES[j].min) { c = SLOPE_CLASSES[j].rgba; break; }
    } else if (slope[k] >= 5 && aspect[k] >= 0) {
      c = ASPECT_CLASSES[Math.round(aspect[k] / 45) % 8].rgba;
    }
    const o = k * 4;
    if (c) { out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = c[3]; } else out[o + 3] = 0;
  }
  return out;
}

/**
 * MapLibre protocol "derive://slope/{z}/{x}/{y}" and "derive://aspect/…": fetches the DEM tile, computes,
 * returns a PNG. Browser only (createImageBitmap / OffscreenCanvas).
 */
export const deriveStats = { tiles: 0, errors: 0, lastError: null };

export function registerDeriveProtocol(maplibregl, demUrlTemplate, size = 512) {
  const cache = new Map();   // DEM tile → elevations (both layers reuse it)
  async function elevations(z, x, y, signal) {
    const key = `${z}/${x}/${y}`;
    if (!cache.has(key)) {
      cache.set(key, (async () => {
        const url = demUrlTemplate.replace('{z}', z).replace('{x}', x).replace('{y}', y);
        const res = await fetch(url, { signal });
        if (!res.ok) throw new Error(`DEM ${res.status}`);
        const bmp = await createImageBitmap(await res.blob());
        const cv = new OffscreenCanvas(bmp.width, bmp.height);
        const g = cv.getContext('2d', { willReadFrequently: true });
        g.drawImage(bmp, 0, 0);
        return terrariumToElevation(g.getImageData(0, 0, bmp.width, bmp.height).data, bmp.width * bmp.height);
      })().catch((e) => { cache.delete(key); throw e; }));
      if (cache.size > 64) cache.delete(cache.keys().next().value);
    }
    return cache.get(key);
  }
  maplibregl.addProtocol('derive', async (params, abort) => {
    const [kind, z, x, y] = params.url.replace('derive://', '').split('/');
    const Z = +z, X = +x, Y = +y.split('.')[0];
    let elev;
    try { elev = await elevations(Z, X, Y, abort.signal); } catch (e) { deriveStats.errors++; deriveStats.lastError = e.message; throw e; }
    const { slope, aspect } = slopeAspect(elev, size, rowMetresPerPixel(Z, Y, size));
    const img = new ImageData(size, size);
    colorize(kind, slope, aspect, img.data);
    const cv = new OffscreenCanvas(size, size);
    cv.getContext('2d').putImageData(img, 0, 0);
    deriveStats.tiles++;
    return { data: await (await cv.convertToBlob({ type: 'image/png' })).arrayBuffer() };
  });
}
