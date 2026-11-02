// Every zoom/data "interpolate" in the overlay style must have strictly ascending stops: MapLibre rejects the
// whole property otherwise and the layer silently disappears (happened with icon sizes, 2026-11-02).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const style = JSON.parse(readFileSync(new URL('../site/styles/topo3d.json', import.meta.url), 'utf8'));

function* interpolations(v, path) {
  if (Array.isArray(v)) {
    if (v[0] === 'interpolate' || v[0] === 'step') yield [path, v];
    for (const x of v) yield* interpolations(x, path);
  } else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) yield* interpolations(x, `${path}.${k}`);
  }
}

test('interpolate/step stops are strictly ascending in every layer', () => {
  let n = 0;
  for (const layer of style.layers) {
    for (const [path, e] of interpolations(layer, layer.id)) {
      const stops = e.slice(3).filter((_, i) => i % 2 === 0);   // interpolate: [op, type, input, z0, v0, …]; step: [op, input, v, z1, v1, …]
      for (let i = 1; i < stops.length; i++) assert.ok(stops[i] > stops[i - 1], `${path}: stops ${JSON.stringify(stops)}`);
      n++;
    }
  }
  assert.ok(n > 20, `found ${n} expressions`);
});
