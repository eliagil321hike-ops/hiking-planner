import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeTerrarium, decodeMapbox, encodeTerrarium, decoderFor, decodeRgbaTile, bilinear,
  elevationInTile, lonLatToTileFraction, tileForLonLat, metresPerPixel,
  checkReferenceElevations, EncodingCheckError,
  type DemEncoding, type LonLat, type ReferencePoint, type TileId,
} from '../src/index.ts';

test('decode: SPEC §14 formulas', () => {
  assert.equal(decodeTerrarium(128, 0, 0), 0);          // sea level
  assert.equal(decodeTerrarium(132, 184, 0), 1208);      // 128*256+1208 = 33976 = 132*256+184
  assert.equal(decodeTerrarium(126, 81, 128), -430.5);   // Dead Sea-like value
  assert.ok(Math.abs(decodeMapbox(1, 134, 160) - 0) < 1e-9); // 100000*0.1 - 10000 = 0
});

test('encodeTerrarium round-trips (1/256 m precision)', () => {
  for (const v of [0, 1208, -430.5, 0.25, 8848.86, -11034]) {
    const [r, g, b] = encodeTerrarium(v);
    assert.ok(Math.abs(decodeTerrarium(r, g, b) - v) <= 1 / 256, `${v}`);
  }
});

test('encoding must be explicit: unknown encoding throws', () => {
  assert.throws(() => decoderFor('custom' as DemEncoding), /must be declared explicitly/);
});

test('decoding terrarium pixels as "mapbox" gives nonsense (the silent bug we guard against)', () => {
  const [r, g, b] = encodeTerrarium(1208);
  const wrong = decodeMapbox(r, g, b);
  assert.ok(Math.abs(wrong - 1208) > 100_000, `mapbox decode of terrarium pixel = ${wrong}`);
});

test('tile math: z0 is one tile, z1 splits at the equator and prime meridian', () => {
  assert.deepEqual(tileForLonLat([0, 0], 0), { z: 0, x: 0, y: 0 });
  assert.deepEqual(tileForLonLat([-1, 1], 1), { z: 1, x: 0, y: 0 });
  assert.deepEqual(tileForLonLat([1, -1], 1), { z: 1, x: 1, y: 1 });
  const f = lonLatToTileFraction([180, 0], 3);
  assert.ok(f.x < 8, 'lon 180 stays inside the last tile');
});

test('tile math: [lon, lat] order — Israel lands on x≈2450, y≈1656 at z12; swapped does not', () => {
  const t = tileForLonLat([35.41, 33.0], 12);
  assert.equal(t.x, Math.floor(((35.41 + 180) / 360) * 4096));
  assert.ok(t.y > 1600 && t.y < 1700, `y=${t.y}`);
  const swapped = tileForLonLat([33.0, 35.41], 12);
  assert.notEqual(swapped.y, t.y);
});

test('metresPerPixel: 40,075 km·cos32° / (512·2^z) → z12 ≈ 16.2 m, z14 ≈ 4.05 m; 256 px doubles it', () => {
  assert.ok(Math.abs(metresPerPixel(32, 12, 512) - 16.2) < 0.1);
  assert.ok(Math.abs(metresPerPixel(32, 14, 512) - 4.05) < 0.05);
  assert.ok(Math.abs(metresPerPixel(32, 12, 256) - 2 * metresPerPixel(32, 12, 512)) < 1e-9);
});

test('bilinear: exact at pixel centres, linear between, null near no-data', () => {
  const tile = { size: 2, elevations: Float64Array.from([0, 10, 20, 30]) };
  assert.equal(bilinear(tile, 0.5, 0.5), 0);
  assert.equal(bilinear(tile, 1.5, 1.5), 30);
  assert.equal(bilinear(tile, 1.0, 1.0), 15);
  const holes = { size: 2, elevations: Float64Array.from([0, NaN, 20, 30]) };
  assert.equal(bilinear(holes, 1.0, 1.0), null);
});

// ---------- Synthetic end-to-end encoding check ----------
// Build a 512 px terrarium tile whose elevation is a known function of position, then run the same
// reference check the live test uses. Correct encoding must pass; wrong encoding must throw loudly.

const SIZE = 512;
const Z = 12;
function syntheticTile(id: TileId, elevAt: (px: number, py: number) => number): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const [r, g, b] = encodeTerrarium(elevAt(x + 0.5, y + 0.5));
      const o = (y * SIZE + x) * 4;
      rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = 255;
    }
  }
  void id;
  return rgba;
}

test('encoding check: correct "terrarium" passes, "mapbox" fails LOUDLY', () => {
  const point: LonLat = [35.41, 33.0];
  const id = tileForLonLat(point, Z);
  // a smooth cone peaking at 1208 m in the tile centre, falling 2 m per pixel
  const rgba = syntheticTile(id, (px, py) => 1208 - 2 * Math.hypot(px - 256, py - 256));
  const f = lonLatToTileFraction(point, Z);
  const expected = 1208 - 2 * Math.hypot((f.x - id.x) * SIZE - 256, (f.y - id.y) * SIZE - 256);
  const refs: ReferencePoint[] = [
    { name: 'synthetic point', point, min: expected - 1, max: expected + 1, source: 'test' },
  ];

  const good = decodeRgbaTile(rgba, SIZE, 'terrarium');
  const res = checkReferenceElevations(refs, (p) => elevationInTile(good, id, p));
  assert.equal(res[0].pass, true);

  const bad = decodeRgbaTile(rgba, SIZE, 'mapbox');
  assert.throws(
    () => checkReferenceElevations(refs, (p) => elevationInTile(bad, id, p)),
    (err: unknown) => err instanceof EncodingCheckError && /DEM ENCODING CHECK FAILED/.test(err.message),
  );
});

test('encoding check: no-data counts as failure, never as 0', () => {
  const refs: ReferencePoint[] = [{ name: 'coast', point: [34.77, 32.08], min: -5, max: 10, source: 'test' }];
  assert.throws(() => checkReferenceElevations(refs, () => null), EncodingCheckError);
});

test('decodeRgbaTile: wrong buffer size throws (catches tileSize 256 vs 512 mismatch)', () => {
  assert.throws(() => decodeRgbaTile(new Uint8ClampedArray(256 * 256 * 4), 512, 'terrarium'), /does not match tile size/);
});
