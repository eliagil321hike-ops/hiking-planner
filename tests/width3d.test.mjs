import test from 'node:test';
import assert from 'node:assert/strict';
import { scaleWidth, installThin3d } from '../site/width3d.js';

test('scaleWidth: numbers and zoom curves', () => {
  assert.equal(scaleWidth(10, 0.5), 5);
  assert.deepEqual(scaleWidth(['interpolate', ['linear'], ['zoom'], 7, 3.5, 16, 15.6], 0.5),
    ['interpolate', ['linear'], ['zoom'], 7, 1.75, 16, 7.8]);
  assert.deepEqual(scaleWidth(['step', ['zoom'], 2, 12, 4], 0.5), ['step', ['zoom'], 1, 12, 2]);
  assert.deepEqual(scaleWidth(['interpolate', ['linear'], ['zoom'], 7, ['match', ['get', 'kind'], 'regional', 1.2, 2]], 0.5),
    ['interpolate', ['linear'], ['zoom'], 7, ['match', ['get', 'kind'], 'regional', 0.6, 1]]);
  assert.deepEqual(scaleWidth(['case', ['get', 'a'], 4, 8], 0.5), ['case', ['get', 'a'], 2, 4]);
});

test('installThin3d: thinner with terrain, original without, survives a re-added layer', () => {
  const W = ['interpolate', ['linear'], ['zoom'], 10, 4, 16, 16];
  const layers = { 'route-line': { w: W } }; let terrain = null; const h = {};
  const map = {
    getTerrain: () => terrain, getLayer: (id) => layers[id], on: (e, f) => { h[e] = f; },
    getPaintProperty: (id) => layers[id].w, setPaintProperty: (id, p, v) => { layers[id].w = v; },
  };
  installThin3d(map, ['route-line', 'days-line'], 0.5);
  assert.deepEqual(layers['route-line'].w, W);
  terrain = { source: 'dem' }; h.terrain();
  assert.deepEqual(layers['route-line'].w, ['interpolate', ['linear'], ['zoom'], 10, 2, 16, 8]);
  h.styledata();                                    // no drift on repeated events
  assert.deepEqual(layers['route-line'].w, ['interpolate', ['linear'], ['zoom'], 10, 2, 16, 8]);
  layers['days-line'] = { w: 10 }; h.styledata();   // layer added later while in 3D
  assert.equal(layers['days-line'].w, 5);
  terrain = null; h.terrain();
  assert.deepEqual(layers['route-line'].w, W);
  assert.equal(layers['days-line'].w, 10);
});
