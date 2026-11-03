// osm-loader.js with pre-built regions (D-058): on-demand cells fully inside a region are never asked from
// Overpass; along a border both sources load and a route/point already in the pre-built data is shown once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOsmLoader } from '../site/osm-loader.js';

function fakeMap(view) {
  let v = view;
  return {
    getZoom: () => v.z,
    getBounds: () => ({ getWest: () => v.w, getEast: () => v.e, getSouth: () => v.s, getNorth: () => v.n }),
    on() {},
    set(nv) { v = nv; },
  };
}
const cfg = { index: 'idx', base: 'c/', minZoom: 7, maxCells: 100,
  dynamic: { enabled: true, endpoint: 'ovp', minZoom: 11, cell: 0.25, maxCellsPerRequest: 6, maxCellsPerSearch: 24 } };
const ok = (body) => ({ ok: true, json: async () => body });
const pt = (kind, lon, lat, name = '') => ({ type: 'Feature', properties: { kind, name }, geometry: { type: 'Point', coordinates: [lon, lat] } });

// A region covering lon 10.0–10.5, lat 62.0–62.25: on-demand cells d248_40 and d248_41 are inside it.
const INDEX = { cell: 0.5, dcell: 0.25, covered: { 248: [[40, 41]] }, cells: { '124_20': [1, 2] } };
const CELL = {
  trails: [{ type: 'Feature', id: 77, properties: { kind: 'marked', color: '#2e9b3e', name: 'A' },
    geometry: { type: 'MultiLineString', coordinates: [[[10.1, 62.1], [10.3, 62.2]]] } }],
  pois: [pt('waterfall', 10.2, 62.1, 'Foss'), pt('ruins', 10.6, 62.1)],
};
// Overpass answer for the border cells: the same route (id 77), the same waterfall, and a new pool
const OVERPASS = { elements: [
  { type: 'relation', id: 77, tags: { route: 'hiking', network: 'lwn', name: 'A' }, members: [
    { type: 'way', ref: 1, role: '', geometry: [{ lon: 10.55, lat: 62.1 }, { lon: 10.6, lat: 62.2 }] }] },
  { type: 'node', id: 2, lon: 10.2, lat: 62.1, tags: { waterway: 'waterfall', name: 'Foss' } },
  { type: 'node', id: 3, lon: 10.6, lat: 62.15, tags: { natural: 'water', water: 'stream_pool' } },
] };

function setup(index = INDEX, view = { z: 12, w: 10.05, e: 10.45, s: 62.05, n: 62.2 }) {
  const calls = [];
  let last = null;
  const map = fakeMap(view);
  const fetchImpl = async (url, opts) => {
    calls.push({ url, body: opts?.body?.toString() ?? '' });
    if (url === 'idx') return ok(index);
    if (url === 'ovp') return ok(OVERPASS);
    if (url.startsWith('c/')) return ok(CELL);
    return { ok: false, status: 404 };
  };
  const loader = createOsmLoader(map, cfg, { fetchImpl, onUpdate: (d) => { last = d; } });
  return { loader, map, calls, data: () => last };
}

test('inside a pre-built region: cells from the extract, no Overpass request', async () => {
  const { loader, calls, data } = setup();
  await loader.start();
  assert.deepEqual(calls.map((c) => c.url), ['idx', 'c/124_20.json']);
  assert.equal(data().trails.length, 1);
});

test('along the border: Overpass for uncovered cells only; same route and point shown once', async () => {
  const { loader, map, calls, data } = setup();
  await loader.start();
  map.set({ z: 12, w: 10.3, e: 10.7, s: 62.05, n: 62.2 });     // view now reaches past lon 10.5
  await loader.update();
  const ovp = calls.filter((c) => c.url === 'ovp');
  assert.equal(ovp.length, 1);
  const q = decodeURIComponent(ovp[0].body.replace(/\+/g, ' '));
  assert.match(q, /\(62,10\.5,62\.25,10\.75\)/, 'the request covers only the uncovered cell d248_42 (lon 10.5–10.75)');
  const d = data();
  assert.equal(d.trails.filter((t) => t.id === 77).length, 1, 'route 77 once (the pre-built copy)');
  assert.equal(d.trails[0].geometry.coordinates[0][0][0], 10.1, 'the pre-built geometry wins');
  const kinds = d.pois.map((f) => f.properties.kind).sort();
  assert.deepEqual(kinds, ['pool', 'ruins', 'waterfall'], `waterfall once, the new pool added: ${kinds}`);
});

test('an older index without `covered` falls back to its coverage box', async () => {
  const old = { cell: 0.5, coverage: [10.0, 62.0, 10.5, 62.25], cells: { '124_20': [1, 2] } };
  const { loader, calls } = setup(old);
  await loader.start();
  assert.equal(calls.filter((c) => c.url === 'ovp').length, 0);
});
