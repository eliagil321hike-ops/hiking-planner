// Slope/aspect maths (site/terrain-derive.js) on synthetic planes with known answers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slopeAspect, rowMetresPerPixel, terrariumToElevation, colorize } from '../site/terrain-derive.js';

const SIZE = 16;
const flatMpp = new Float32Array(SIZE).fill(10);   // 10 m pixels
const plane = (fn) => { const e = new Float32Array(SIZE * SIZE); for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) e[r * SIZE + c] = fn(c, r); return e; };
const mid = (SIZE / 2) * SIZE + SIZE / 2;

test('45° slope rising to the east faces west (270°)', () => {
  const { slope, aspect } = slopeAspect(plane((c) => c * 10), SIZE, flatMpp);
  assert.ok(Math.abs(slope[mid] - 45) < 1e-3, slope[mid]);
  assert.ok(Math.abs(aspect[mid] - 270) < 1e-3, aspect[mid]);
});

test('slope rising to the north faces south (180°); rising to the south faces north (0°)', () => {
  const toNorth = slopeAspect(plane((c, r) => -r * 5), SIZE, flatMpp);   // rows go south
  assert.ok(Math.abs(toNorth.aspect[mid] - 180) < 1e-3, toNorth.aspect[mid]);
  assert.ok(Math.abs(toNorth.slope[mid] - Math.atan(0.5) * 180 / Math.PI) < 1e-3);
  const toSouth = slopeAspect(plane((c, r) => r * 5), SIZE, flatMpp);
  assert.ok(toSouth.aspect[mid] < 1e-3 || toSouth.aspect[mid] > 359.999, toSouth.aspect[mid]);
});

test('flat ground: slope 0, aspect -1, nothing drawn', () => {
  const { slope, aspect } = slopeAspect(plane(() => 300), SIZE, flatMpp);
  assert.equal(slope[mid], 0); assert.equal(aspect[mid], -1);
  const px = colorize('slope', slope, aspect, new Uint8ClampedArray(SIZE * SIZE * 4));
  assert.equal(px[mid * 4 + 3], 0);
});

test('edges are clamped: a plane keeps the same slope at the tile border', () => {
  const { slope } = slopeAspect(plane((c) => c * 10), SIZE, flatMpp);
  assert.ok(Math.abs(slope[0 * SIZE + 5] - 45) < 1e-3);           // top row, inner column
});

test('pixel size: z12 512-px tile at the equator ≈ 19.1 m; shrinks with latitude', () => {
  const eq = rowMetresPerPixel(12, 2047, 512);   // rows just north of the equator
  assert.ok(Math.abs(eq[511] - 19.109) < 0.01, eq[511]);
  const north = rowMetresPerPixel(12, 1650, 512);  // ≈ 33° N
  assert.ok(north[256] < 17 && north[256] > 15.5, north[256]);
});

test('Terrarium decode', () => {
  const e = terrariumToElevation(new Uint8ClampedArray([128, 0, 0, 255, 132, 176, 128, 255]), 2);
  assert.equal(e[0], 0);
  assert.equal(e[1], 1200.5);
});

test('colour classes: 20° yellow, 32° red; aspect class by direction', () => {
  const slope = new Float32Array([20, 32, 10]);
  const aspect = new Float32Array([0, 180, 90]);
  const s = colorize('slope', slope, aspect, new Uint8ClampedArray(12));
  assert.deepEqual([...s.slice(0, 3)], [244, 226, 84]);
  assert.deepEqual([...s.slice(4, 7)], [226, 70, 46]);
  const a = colorize('aspect', slope, aspect, new Uint8ClampedArray(12));
  assert.deepEqual([...a.slice(0, 3)], [52, 98, 214]);   // N
  assert.deepEqual([...a.slice(4, 7)], [226, 74, 58]);   // S
  assert.deepEqual([...a.slice(8, 11)], [76, 178, 70]);  // E (10° ≥ 5°)
});
