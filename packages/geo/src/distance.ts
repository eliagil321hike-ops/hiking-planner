import { assertLonLat, type LonLat } from './coords.ts';

// WGS84 ellipsoid
const A = 6378137.0;
const F = 1 / 298.257223563;
const B = A * (1 - F);
const MEAN_RADIUS = 6371008.8;
const toRad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance on a sphere (metres). Used only as a fallback. */
export function haversine(a: LonLat, b: LonLat): number {
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * MEAN_RADIUS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Geodesic distance on the WGS84 ellipsoid (Vincenty inverse), metres.
 * Falls back to haversine for nearly antipodal points where Vincenty does not converge.
 */
export function geodesicDistance(a: LonLat, b: LonLat): number {
  assertLonLat(a, 'geodesicDistance a');
  assertLonLat(b, 'geodesicDistance b');
  if (a[0] === b[0] && a[1] === b[1]) return 0;
  let L = toRad(b[0] - a[0]);
  // normalise across the date line
  if (L > Math.PI) L -= 2 * Math.PI;
  if (L < -Math.PI) L += 2 * Math.PI;
  const U1 = Math.atan((1 - F) * Math.tan(toRad(a[1])));
  const U2 = Math.atan((1 - F) * Math.tan(toRad(b[1])));
  const sinU1 = Math.sin(U1), cosU1 = Math.cos(U1);
  const sinU2 = Math.sin(U2), cosU2 = Math.cos(U2);
  let lambda = L;
  let sinSigma = 0, cosSigma = 0, sigma = 0, cos2Alpha = 0, cos2SigmaM = 0;
  for (let i = 0; i < 200; i++) {
    const sinL = Math.sin(lambda), cosL = Math.cos(lambda);
    sinSigma = Math.sqrt((cosU2 * sinL) ** 2 + (cosU1 * sinU2 - sinU1 * cosU2 * cosL) ** 2);
    if (sinSigma === 0) return 0;
    cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosL;
    sigma = Math.atan2(sinSigma, cosSigma);
    const sinAlpha = (cosU1 * cosU2 * sinL) / sinSigma;
    cos2Alpha = 1 - sinAlpha * sinAlpha;
    cos2SigmaM = cos2Alpha !== 0 ? cosSigma - (2 * sinU1 * sinU2) / cos2Alpha : 0;
    const C = (F / 16) * cos2Alpha * (4 + F * (4 - 3 * cos2Alpha));
    const prev = lambda;
    lambda =
      L +
      (1 - C) * F * sinAlpha *
        (sigma + C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)));
    if (Math.abs(lambda - prev) < 1e-12) {
      const u2 = (cos2Alpha * (A * A - B * B)) / (B * B);
      const Aa = 1 + (u2 / 16384) * (4096 + u2 * (-768 + u2 * (320 - 175 * u2)));
      const Bb = (u2 / 1024) * (256 + u2 * (-128 + u2 * (74 - 47 * u2)));
      const dSigma =
        Bb * sinSigma *
        (cos2SigmaM +
          (Bb / 4) *
            (cosSigma * (-1 + 2 * cos2SigmaM ** 2) -
              (Bb / 6) * cos2SigmaM * (-3 + 4 * sinSigma ** 2) * (-3 + 4 * cos2SigmaM ** 2)));
      return B * Aa * (sigma - dSigma);
    }
  }
  return haversine(a, b);
}

/** Sum of geodesic segment lengths along a polyline (metres). */
export function lineLength(line: readonly LonLat[]): number {
  let d = 0;
  for (let i = 1; i < line.length; i++) d += geodesicDistance(line[i - 1], line[i]);
  return d;
}

/** Interpolate between two points at fraction t (0..1). Linear in lon/lat; fine for ≤ a few km steps. */
export function interpolate(a: LonLat, b: LonLat, t: number): LonLat {
  let dLon = b[0] - a[0];
  if (dLon > 180) dLon -= 360;
  if (dLon < -180) dLon += 360;
  let lon = a[0] + dLon * t;
  if (lon > 180) lon -= 360;
  if (lon < -180) lon += 360;
  return [lon, a[1] + (b[1] - a[1]) * t];
}

export interface LineSample {
  point: LonLat;
  /** cumulative distance from the start, metres */
  distance: number;
}

/**
 * Resample a polyline every `stepM` metres (SPEC 8.3: ~10–25 m). Always includes the first and last
 * point and every original vertex, so sharp corners are not cut.
 */
export function resampleLine(line: readonly LonLat[], stepM: number): LineSample[] {
  if (!(stepM > 0)) throw new RangeError('stepM must be > 0');
  if (line.length === 0) return [];
  line.forEach((p, i) => assertLonLat(p, `resampleLine[${i}]`));
  const out: LineSample[] = [{ point: line[0], distance: 0 }];
  let cum = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i];
    const seg = geodesicDistance(a, b);
    if (seg === 0) continue;
    const n = Math.ceil(seg / stepM);
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      out.push({ point: k === n ? b : interpolate(a, b, t), distance: cum + seg * t });
    }
    cum += seg;
  }
  return out;
}
