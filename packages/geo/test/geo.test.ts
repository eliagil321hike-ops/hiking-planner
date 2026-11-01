import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertLonLat, CoordinateError, fromLatLon, looksSwappedForIsrael,
  geodesicDistance, haversine, lineLength, resampleLine,
  computeElevationStats, fillGaps, hysteresis, anchorSteppingHysteresis, perStepThresholdAscent, smooth,
  naismithSeconds, toblerSeconds,
  type LonLat,
} from '../src/index.ts';

// ---------------- coordinates ----------------
test('coords: [lon, lat] validation rejects out-of-range values', () => {
  assert.doesNotThrow(() => assertLonLat([35.4, 33.0]));
  assert.throws(() => assertLonLat([200, 10]), CoordinateError);
  assert.throws(() => assertLonLat([10, 95]), CoordinateError);
  assert.throws(() => assertLonLat([Number.NaN, 10]), CoordinateError);
});

test('coords: fromLatLon builds [lon, lat] in GeoJSON order', () => {
  assert.deepEqual(fromLatLon(32.998, 35.409), [35.409, 32.998]);
});

test('coords: swapped Israeli point is detected', () => {
  assert.equal(looksSwappedForIsrael([35.409, 32.998]), false);
  assert.equal(looksSwappedForIsrael([32.998, 35.409]), true);
});

// ---------------- distance ----------------
test('distance: Vincenty reference case (Flinders Peak → Buninyong = 54,972.271 m)', () => {
  const flinders: LonLat = [144.42486789, -37.95103342];
  const buninyong: LonLat = [143.92649554, -37.65282114];
  assert.ok(Math.abs(geodesicDistance(flinders, buninyong) - 54972.271) < 0.01);
});

test('distance: 1° of latitude near Israel ≈ 110.9 km (catches lat/lon swap)', () => {
  const d = geodesicDistance([35, 32], [35, 33]);
  assert.ok(d > 110_800 && d < 111_000, `got ${d}`);
  const dLon = geodesicDistance([35, 32], [36, 32]); // 1° of longitude at 32°N ≈ 94.5 km
  assert.ok(dLon > 94_000 && dLon < 95_000, `got ${dLon}`);
});

test('distance: crossing the date line takes the short way', () => {
  const d = geodesicDistance([179.9, 0], [-179.9, 0]);
  assert.ok(d > 22_000 && d < 22_500, `got ${d}`);
});

test('distance: identical points and pole', () => {
  assert.equal(geodesicDistance([35, 32], [35, 32]), 0);
  const d = geodesicDistance([0, 89.9], [180, 89.9]);
  assert.ok(Math.abs(d - haversine([0, 89.9], [180, 89.9])) < 100);
});

test('distance: lineLength sums segments', () => {
  const l = lineLength([[35, 32], [35, 32.5], [35, 33]]);
  assert.ok(Math.abs(l - geodesicDistance([35, 32], [35, 33])) < 1);
});

test('resample: every ≤ step metres, keeps start, end and vertices', () => {
  const line: LonLat[] = [[35.0, 32.0], [35.0, 32.01], [35.01, 32.01]];
  const s = resampleLine(line, 20);
  assert.deepEqual(s[0].point, line[0]);
  assert.deepEqual(s.at(-1)!.point, line[2]);
  assert.ok(s.some((x) => x.point === line[1]));
  for (let i = 1; i < s.length; i++) assert.ok(s[i].distance - s[i - 1].distance <= 20.0001);
  assert.ok(Math.abs(s.at(-1)!.distance - lineLength(line)) < 0.01);
});

// ---------------- elevation stats ----------------
const ramp = (n: number, start: number, perStep: number) => Array.from({ length: n }, (_, i) => start + i * perStep);

test('ascent: gentle long climb (3% at 20 m steps) is counted — per-step threshold would miss it', () => {
  const e = ramp(251, 100, 0.6); // 5 km, +150 m, 0.6 m per step
  assert.equal(perStepThresholdAscent(e, 3), 0, 'demonstrates the v1 bug');
  const s = computeElevationStats(e);
  assert.ok(Math.abs(s.ascent - 150) < 3, `ascent ${s.ascent}`);
  assert.ok(s.descent < 0.001);
});

test('ascent: noisy flat route accumulates almost nothing', () => {
  let seed = 42;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) * 2 - 1;
  const e = Array.from({ length: 500 }, () => 300 + rnd() * 1.5);
  const s = computeElevationStats(e);
  assert.ok(s.ascent < 5 && s.descent < 5, `ascent ${s.ascent} descent ${s.descent}`);
});

test('ascent: sawtooth (10 × 40 m) equals the sum of smoothed peak-to-valley legs', () => {
  const e: number[] = [];
  for (let k = 0; k < 10; k++) {
    e.push(...ramp(20, 0, 2));        // 0 → 38
    e.push(...ramp(20, 40, -2));      // 40 → 2
  }
  e.push(0);
  const s = computeElevationStats(e);
  // Expected from the smoothed series itself: start 0 → peak, then 9 × (peak − valley).
  const sm = s.smoothed as number[];
  const peak = Math.max(...sm), valley = Math.min(...sm.slice(30, 50));
  const expected = (peak - 0) + 9 * (peak - valley);
  assert.ok(Math.abs(s.ascent - expected) < 0.01, `ascent ${s.ascent} expected ${expected}`);
  assert.ok(s.ascent > 0.85 * 400, 'smoothing costs < 15% on 400 m-wide sharp teeth');
  assert.ok(Math.abs(s.ascent - s.descent) < 1, 'returns to start');
});

test('hysteresis: wiggles < T never count; open leg credited only if ≥ T', () => {
  assert.deepEqual(hysteresis([0, 2, 0, 2, 0], 3), { ascent: 0, descent: 0 });
  assert.deepEqual(hysteresis([0, 2], 3), { ascent: 0, descent: 0 });
  assert.deepEqual(hysteresis([0, 2, 5], 3), { ascent: 5, descent: 0 });
  assert.deepEqual(hysteresis([0, 10, 8, 10], 3), { ascent: 10, descent: 0 }, '2 m dip ignored');
  assert.deepEqual(hysteresis([0, 10, 6, 10], 3), { ascent: 14, descent: 4 }, '4 m dip counted');
});

test('hysteresis: peak/valley version does not lose height at turning points (D-005)', () => {
  const e = [0, 2, 4, 6, 8, 10, 8, 6, 4, 2, 0];
  assert.deepEqual(hysteresis(e, 3), { ascent: 10, descent: 10 });
  const literal = anchorSteppingHysteresis(e, 3);
  assert.ok(literal.ascent < 10, `literal pseudocode loses height: ${literal.ascent}`);
});

test('gaps: short gaps interpolated, long gaps flagged incomplete, null never treated as 0', () => {
  const { filled, missing } = fillGaps([10, null, null, 16], 3);
  assert.deepEqual(filled, [10, 12, 14, 16]);
  assert.deepEqual(missing, []);
  const e = [500, 500, null, null, null, null, 500, 500];
  const s = computeElevationStats(e);
  assert.equal(s.incomplete, true);
  assert.deepEqual(s.missing, [[2, 5]]);
  assert.equal(s.min, 500, 'min is not 0');
  assert.equal(s.ascent, 0);
});

test('gaps at the ends are reported, not extrapolated', () => {
  const s = computeElevationStats([null, 5, 6, null]);
  assert.deepEqual(s.missing, [[0, 0], [3, 3]]);
});

test('smooth: odd window, endpoints kept, does not cross nulls', () => {
  const out = smooth([0, 10, 20, null, 30], 3);
  assert.deepEqual(out, [0, 10, 20, null, 30]);
});

test('stats: min/max smoothed and raw are both reported', () => {
  const s = computeElevationStats([100, 100, 100, 130, 100, 100, 100]);
  assert.equal(s.rawMax, 130);
  assert.ok(s.max! < 130);
});

// ---------------- duration ----------------
test('duration: Naismith 10 km + 600 m = 3 h; descent ignored', () => {
  assert.equal(naismithSeconds(10_000, 600), 3 * 3600);
  assert.equal(naismithSeconds(5_000, 0), 3600);
  assert.throws(() => naismithSeconds(-1, 0), RangeError);
});

test('duration: Tobler flat ≈ 5 km/h', () => {
  const s = toblerSeconds([[5000, 0]]);
  assert.ok(Math.abs(s / 3600 - 1.0) < 0.02, `${s / 3600} h`);
});
