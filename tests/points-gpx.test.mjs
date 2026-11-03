// D-063 marked points: personal points store, legacy waypoint removal, GPX export.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLibrary, memoryAdapter, LibraryError } from '../site/library-store.js';
import { routeToGpx, pointsToGpx, gpxFileName } from '../site/gpx.js';
import { MARK_ICONS, isMarkIcon, pinImageId, symbolColourOn } from '../site/marker-icons.js';

test('personal points: create, list, update, delete; bad points refused', async () => {
  const lib = createLibrary(memoryAdapter());
  const p = await lib.createPoint({ name: '  מעיין  ', icon: 'spring', lon: 35.41, lat: 33.002, ele: 512.4, source: { key: '35.41,33.002', name: 'מעיין' } });
  assert.equal(p.name, 'מעיין');
  assert.equal(p.ele, 512.4);
  assert.deepEqual((await lib.listPoints()).map((x) => x.id), [p.id]);
  const u = await lib.updatePoint(p.id, { name: 'עין', icon: 'viewpoint' });
  assert.equal(u.name, 'עין'); assert.equal(u.icon, 'viewpoint'); assert.equal(u.lon, 35.41);
  const blank = await lib.createPoint({ name: '', icon: 'general', lon: 35, lat: 33 });
  assert.equal(blank.name, 'נקודה', 'an empty name gets a default');
  await assert.rejects(lib.createPoint({ name: 'x', icon: 'general', lon: 200, lat: 33 }), (e) => e instanceof LibraryError && e.code === 'point-bad');
  await assert.rejects(lib.createPoint({ name: 'x', lon: 35, lat: 33 }), (e) => e.code === 'point-bad');
  await lib.deletePoint(p.id);
  await assert.rejects(lib.deletePoint(p.id), (e) => e.code === 'point-missing');
  assert.equal((await lib.listPoints()).length, 1);
});

const rec = (waypoints) => {
  const geometry = [[35.4, 33], [35.401, 33.001], [35.402, 33.0015]];
  return { name: 'מסלול', folderId: null, color: '#39ff14', editor: { version: 1, profile: 'foot-hiking', state: { vertices: geometry.map(([lon, lat]) => ({ lon, lat, mode: null })), waypoints }, cache: {} },
    geometry, profile: geometry.map(([x, y], i) => [x, y, i * 100, 500 + i]), stats: { distance: 200, ascent: 2, descent: 0, min: 500, max: 502 }, bbox: [35.4, 33, 35.402, 33.0015], thumb: '' };
};

test('legacy waypoints (no symbol) are removed from saved routes; marked points and updatedAt kept', async () => {
  const lib = createLibrary(memoryAdapter());
  const old = await lib.createRoute(rec([{ id: 'a', lon: 35.4, lat: 33, name: 'ישן', note: '' }, { id: 'b', lon: 35.401, lat: 33.001, name: 'תצפית', note: '', icon: 'viewpoint' }]));
  const clean = await lib.createRoute(rec([]));
  assert.equal(await lib.stripLegacyWaypoints(), 1);
  const back = await lib.getRoute(old.id);
  assert.deepEqual(back.editor.state.waypoints.map((w) => w.id), ['b']);
  assert.equal(back.updatedAt, old.updatedAt);
  assert.deepEqual(await lib.getRoute(clean.id), clean);
  assert.equal(await lib.stripLegacyWaypoints(), 0, 'runs once in effect');
});

test('route GPX: marks as wpt, profile as trkpt with elevation; text escaped', () => {
  const g = routeToGpx({ ...rec([{ id: 'b', lon: 35.401, lat: 33.001, name: 'תצפית <נוף> & "ים"', note: '', icon: 'viewpoint' }, { id: 'c', lon: 1, lat: 2, name: 'ישן', note: '' }]), updatedAt: '2026-11-03T10:00:00.000Z' });
  assert.match(g, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<gpx version="1.1"/);
  assert.equal((g.match(/<wpt /g) || []).length, 1, 'only marked points (with a symbol)');
  assert.ok(g.includes('<name>תצפית &lt;נוף&gt; &amp; &quot;ים&quot;</name><type>viewpoint</type>'));
  assert.equal((g.match(/<trkpt /g) || []).length, 3);
  assert.ok(g.includes('<trkpt lat="33.0015" lon="35.402"><ele>502</ele></trkpt>'));
  const noProfile = routeToGpx({ ...rec([]), profile: null });
  assert.equal((noProfile.match(/<trkpt /g) || []).length, 3);
  assert.ok(!noProfile.includes('<ele>'));
});

test('points GPX and file names', () => {
  const g = pointsToGpx([{ name: 'חניון', icon: 'tent', lon: 35.4, lat: 33, ele: 400 }, { name: 'מפגש', icon: 'general', lon: 35.5, lat: 33.1, ele: null }]);
  assert.equal((g.match(/<wpt /g) || []).length, 2);
  assert.ok(g.includes('<ele>400</ele><name>חניון</name><type>tent</type>'));
  assert.ok(g.trim().endsWith('</gpx>'));
  assert.equal(gpxFileName('מסלול: א/ב?'), 'מסלול א ב.gpx');
  assert.equal(gpxFileName(''), 'topo3d.gpx');
});

test('marker icons: 12 symbols incl. general, peak and parking; image ids; symbol contrast', () => {
  assert.equal(MARK_ICONS.length, 12);
  for (const k of ['general', 'peak', 'parking', 'spring', 'tent', 'viewpoint']) assert.ok(isMarkIcon(k), k);
  assert.equal(pinImageId('tent', '#D0435B'), 'mk-tent-d0435b');
  assert.equal(symbolColourOn('#39ff14'), '#0a1f0a');
  assert.equal(symbolColourOn('#24476b'), '#ffffff');
});
