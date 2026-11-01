/**
 * Coordinates are ALWAYS [longitude, latitude] (GeoJSON order). Never [lat, lon].
 * Elevation, when present, is the optional third value in metres.
 */
export type LonLat = readonly [lon: number, lat: number];
export type LonLatEle = readonly [lon: number, lat: number, ele: number | null];

export class CoordinateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CoordinateError';
  }
}

export function isValidLonLat(p: readonly number[]): boolean {
  if (!Array.isArray(p) || p.length < 2) return false;
  const [lon, lat] = p;
  return (
    Number.isFinite(lon) && Number.isFinite(lat) && lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90
  );
}

/** Throws if the point is not a valid [lon, lat]. Use at every boundary (UI taps, GPX, network). */
export function assertLonLat(p: readonly number[], context = 'point'): asserts p is LonLat {
  if (!isValidLonLat(p)) {
    throw new CoordinateError(`${context}: invalid [lon, lat] ${JSON.stringify(p)}`);
  }
}

/** Build a [lon, lat] from named values; the only safe way to convert from lat/lon sources (GPX, UI). */
export function fromLatLon(lat: number, lon: number): LonLat {
  const p: LonLat = [lon, lat];
  assertLonLat(p, 'fromLatLon');
  return p;
}

/**
 * Heuristic guard for a common bug in Israel: swapped order. Israel is lon ≈ 34–36, lat ≈ 29–33.5.
 * A point inside the "swapped Israel" box (lon 29–33.5, lat 34–36) is almost certainly swapped.
 */
export function looksSwappedForIsrael(p: LonLat): boolean {
  const [lon, lat] = p;
  return lon >= 29 && lon <= 33.5 && lat >= 34 && lat <= 36.5;
}
