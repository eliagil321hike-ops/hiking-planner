import { assertLonLat, type LonLat } from './coords.ts';

/**
 * DEM tile decoding and sampling. SPEC §14 pitfalls 2–3: the encoding must always be explicit.
 *   terrarium: elevation = (R*256 + G + B/256) - 32768
 *   mapbox:    elevation = -10000 + (R*65536 + G*256 + B) * 0.1
 */
export type DemEncoding = 'terrarium' | 'mapbox';

export function decodeTerrarium(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

export function decodeMapbox(r: number, g: number, b: number): number {
  return -10000 + (r * 65536 + g * 256 + b) * 0.1;
}

export function decoderFor(encoding: DemEncoding): (r: number, g: number, b: number) => number {
  if (encoding === 'terrarium') return decodeTerrarium;
  if (encoding === 'mapbox') return decodeMapbox;
  throw new Error(`Unknown DEM encoding: ${String(encoding)} (must be declared explicitly)`);
}

/** Inverse of decodeTerrarium, for synthetic test tiles. Rounds to the 1/256 m encoding step. */
export function encodeTerrarium(elevation: number): [number, number, number] {
  const v = elevation + 32768;
  const r = Math.floor(v / 256);
  const g = Math.floor(v) - r * 256;
  const b = Math.round((v - Math.floor(v)) * 256);
  return b === 256 ? [r, g + 1, 0] : [r, g, b];
}

/** Web Mercator tile coordinates (fractional) for a [lon, lat] at zoom z. */
export function lonLatToTileFraction(p: LonLat, z: number): { x: number; y: number } {
  assertLonLat(p, 'lonLatToTileFraction');
  const n = 2 ** z;
  const lat = Math.max(-85.05112878, Math.min(85.05112878, p[1]));
  const latRad = (lat * Math.PI) / 180;
  const x = ((p[0] + 180) / 360) * n;
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return { x: Math.min(x, n - 1e-9), y: Math.min(Math.max(y, 0), n - 1e-9) };
}

export interface TileId { z: number; x: number; y: number }

export function tileForLonLat(p: LonLat, z: number): TileId {
  const f = lonLatToTileFraction(p, z);
  return { z, x: Math.floor(f.x), y: Math.floor(f.y) };
}

/** Ground resolution of one pixel (metres) at a latitude, zoom and tile size. */
export function metresPerPixel(lat: number, z: number, tileSize: number): number {
  return (Math.cos((lat * Math.PI) / 180) * 2 * Math.PI * 6378137) / (tileSize * 2 ** z);
}

/** Decoded DEM tile: elevations in metres, row-major, size×size. null = no data. */
export interface DemTile {
  size: number;
  elevations: Float64Array;
  /** NaN in `elevations` marks no-data */
}

/** Decode raw RGBA bytes (e.g. from canvas getImageData) into a DemTile. Alpha 0 → no data. */
export function decodeRgbaTile(rgba: Uint8ClampedArray | Uint8Array, size: number, encoding: DemEncoding): DemTile {
  if (rgba.length !== size * size * 4) {
    throw new Error(`RGBA length ${rgba.length} does not match tile size ${size} (expected ${size * size * 4})`);
  }
  const decode = decoderFor(encoding);
  const elevations = new Float64Array(size * size);
  for (let i = 0; i < size * size; i++) {
    const o = i * 4;
    elevations[i] = rgba[o + 3] === 0 ? NaN : decode(rgba[o], rgba[o + 1], rgba[o + 2]);
  }
  return { size, elevations };
}

/**
 * Bilinear elevation at a fractional pixel position (pixel centres at i + 0.5).
 * Returns null if any of the four neighbours is no-data. Edge pixels are clamped (no cross-tile blend).
 */
export function bilinear(tile: DemTile, px: number, py: number): number | null {
  const s = tile.size;
  const fx = Math.min(Math.max(px - 0.5, 0), s - 1);
  const fy = Math.min(Math.max(py - 0.5, 0), s - 1);
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, s - 1), y1 = Math.min(y0 + 1, s - 1);
  const tx = fx - x0, ty = fy - y0;
  const e = tile.elevations;
  const v00 = e[y0 * s + x0], v10 = e[y0 * s + x1], v01 = e[y1 * s + x0], v11 = e[y1 * s + x1];
  if ([v00, v10, v01, v11].some((v) => Number.isNaN(v))) return null;
  return v00 * (1 - tx) * (1 - ty) + v10 * tx * (1 - ty) + v01 * (1 - tx) * ty + v11 * tx * ty;
}

/** Elevation at [lon, lat] given the decoded tile that contains it. */
export function elevationInTile(tile: DemTile, id: TileId, p: LonLat): number | null {
  const f = lonLatToTileFraction(p, id.z);
  const px = (f.x - id.x) * tile.size;
  const py = (f.y - id.y) * tile.size;
  if (px < 0 || py < 0 || px > tile.size || py > tile.size) {
    throw new Error(`Point ${JSON.stringify(p)} is outside tile ${id.z}/${id.x}/${id.y}`);
  }
  return bilinear(tile, px, py);
}

// ---------------------------------------------------------------------------------------------
// Encoding check against known reference points (SPEC P10.5). Must FAIL LOUDLY when wrong.
// ---------------------------------------------------------------------------------------------

export interface ReferencePoint {
  name: string;
  point: LonLat;
  /** acceptable inclusive range in metres */
  min: number;
  max: number;
  source: string;
}

export interface ReferenceResult extends ReferencePoint {
  measured: number | null;
  pass: boolean;
}

export class EncodingCheckError extends Error {
  results: ReferenceResult[];
  constructor(results: ReferenceResult[]) {
    const lines = results
      .filter((r) => !r.pass)
      .map((r) => `  ✗ ${r.name}: measured ${r.measured === null ? 'NO DATA' : r.measured.toFixed(1) + ' m'}, expected ${r.min}…${r.max} m`);
    super(`DEM ENCODING CHECK FAILED — elevations are wrong. Check raster-dem "encoding" and tile source.\n${lines.join('\n')}`);
    this.name = 'EncodingCheckError';
    this.results = results;
  }
}

/** Compare measured elevations with reference ranges; throws EncodingCheckError if any point fails. */
export function checkReferenceElevations(
  refs: readonly ReferencePoint[],
  measure: (p: LonLat) => number | null,
): ReferenceResult[] {
  const results = refs.map((r) => {
    const measured = measure(r.point);
    const pass = measured !== null && Number.isFinite(measured) && measured >= r.min && measured <= r.max;
    return { ...r, measured, pass };
  });
  if (results.some((r) => !r.pass)) throw new EncodingCheckError(results);
  return results;
}
