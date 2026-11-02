// D-056 My Routes data layer: manual saves only, folders never delete routes, copies never touch the original,
// every coordinate and elevation comes back exactly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLibrary, memoryAdapter, queryRoutes, LibraryError } from '../site/library-store.js';

const route = (n = 3, extra = {}) => {
  const vertices = Array.from({ length: n }, (_, i) => ({ lon: 35.4 + i * 0.001, lat: 33 + i * 0.0007, mode: i ? 'snap' : null }));
  const geometry = vertices.map((v) => [v.lon, v.lat]);
  return { name: 'מעיינות', folderId: null, color: '#39ff14', editor: { version: 1, profile: 'foot-hiking', state: { vertices, waypoints: [] }, cache: {} },
    geometry, profile: geometry.map(([x, y], i) => [x, y, i * 20, i % 7 ? 500 + i * 1.25 : null]), stats: { distance: 1000 * n, ascent: 10 * n, descent: 5, min: 500, max: 600 },
    bbox: [35.4, 33, 35.41, 33.01], thumb: 'data:image/jpeg;base64,AAAA', ...extra };
};

test('create + read back keeps every coordinate and elevation exactly (long route)', async () => {
  const lib = createLibrary(memoryAdapter());
  const big = route(5000);
  const r = await lib.createRoute(big);
  const back = await lib.getRoute(r.id);
  assert.deepEqual(back.geometry, big.geometry);
  assert.deepEqual(back.profile, big.profile, 'every elevation (and gaps) kept');
  assert.deepEqual(back.editor, big.editor);
  assert.equal(back.userId, 'local');
  assert.ok(back.createdAt && back.updatedAt);
});

test('a route needs at least two points and a line; profile rows are [lon, lat, d, e]', async () => {
  const lib = createLibrary(memoryAdapter());
  await assert.rejects(lib.createRoute(route(1)), (e) => e instanceof LibraryError && e.code === 'route-too-short');
  await assert.rejects(lib.createRoute(route(3, { profile: [[1, 2]] })), (e) => e.code === 'route-bad-profile');
  assert.equal((await lib.listRoutes()).length, 0);
});

test('rename, move between folders, duplicate leaves the original untouched', async () => {
  const lib = createLibrary(memoryAdapter());
  const f1 = await lib.createFolder('גליל');
  const f2 = await lib.createFolder('נגב');
  const r = await lib.createRoute(route(3, { folderId: f1.id }));
  await lib.renameRoute(r.id, '  נחל   עמוד ');
  await lib.moveRoute(r.id, f2.id);
  const moved = await lib.getRoute(r.id);
  assert.equal(moved.name, 'נחל עמוד');
  assert.equal(moved.folderId, f2.id);
  const copy = await lib.duplicateRoute(r.id, { name: 'גרסה 2', folderId: f1.id });
  assert.notEqual(copy.id, r.id);
  assert.equal(copy.folderId, f1.id);
  assert.deepEqual(copy.geometry, moved.geometry);
  assert.deepEqual(await lib.getRoute(r.id), moved, 'original unchanged by the copy');
  const dflt = await lib.duplicateRoute(r.id);
  assert.equal(dflt.name, 'נחל עמוד (עותק)');
  await assert.rejects(lib.moveRoute(r.id, 'nope'), (e) => e.code === 'folder-missing');
});

test('update original replaces the content, keeps id/folder/createdAt, bumps updatedAt', async () => {
  const lib = createLibrary(memoryAdapter());
  const f = await lib.createFolder('גליל');
  const r = await lib.createRoute(route(3, { folderId: f.id }));
  await new Promise((ok) => setTimeout(ok, 5));
  const u = await lib.updateRoute(r.id, route(6, { name: 'ארוך יותר' }));
  assert.equal(u.id, r.id);
  assert.equal(u.folderId, f.id);
  assert.equal(u.createdAt, r.createdAt);
  assert.ok(u.updatedAt > r.updatedAt);
  assert.equal(u.geometry.length, 6);
  assert.equal(u.name, 'ארוך יותר');
  assert.equal((await lib.listRoutes()).length, 1);
});

test('deleting a folder never deletes its routes: they move to another folder or to no folder', async () => {
  const lib = createLibrary(memoryAdapter());
  const a = await lib.createFolder('א'), b = await lib.createFolder('ב');
  const r1 = await lib.createRoute(route(3, { folderId: a.id }));
  const r2 = await lib.createRoute(route(3, { folderId: a.id }));
  await lib.deleteFolder(a.id, { moveTo: b.id });
  assert.equal((await lib.getRoute(r1.id)).folderId, b.id);
  await lib.deleteFolder(b.id);
  assert.equal((await lib.getRoute(r2.id)).folderId, null);
  assert.equal((await lib.listRoutes()).length, 2);
  assert.equal((await lib.listFolders()).length, 0);
});

test('delete route; rename folder; empty folder name refused', async () => {
  const lib = createLibrary(memoryAdapter());
  const f = await lib.createFolder('טיולים');
  assert.equal((await lib.renameFolder(f.id, 'טיולי משפחה')).name, 'טיולי משפחה');
  await assert.rejects(lib.createFolder('   '), (e) => e.code === 'name-empty');
  const r = await lib.createRoute(route());
  await lib.deleteRoute(r.id);
  assert.equal(await lib.getRoute(r.id), null);
});

test('records of another user are invisible (ready for accounts)', async () => {
  const ad = memoryAdapter();
  const other = createLibrary(ad, { userId: 'google:123' });
  await other.createRoute(route());
  const mine = createLibrary(ad);
  assert.equal((await mine.listRoutes()).length, 0);
});

test('search, folder filter and the four sort orders', () => {
  const folders = [{ id: 'f1', name: 'גליל' }];
  const rs = [
    { id: '1', name: 'בניאס', folderId: 'f1', updatedAt: '2026-01-02', stats: { distance: 5000, ascent: 300 } },
    { id: '2', name: 'אלונים', folderId: null, updatedAt: '2026-03-01', stats: { distance: 12000, ascent: 100 } },
    { id: '3', name: 'גמלא', folderId: 'f1', updatedAt: '2026-02-01', stats: { distance: 8000, ascent: 900 } },
  ];
  const ids = (o) => queryRoutes(rs, folders, o).map((r) => r.id).join('');
  assert.equal(ids({ sort: 'name' }), '213');
  assert.equal(ids({ sort: 'date' }), '231');
  assert.equal(ids({ sort: 'distance' }), '231');
  assert.equal(ids({ sort: 'ascent' }), '312');
  assert.equal(ids({ folder: 'f1', sort: 'name' }), '13');
  assert.equal(ids({ folder: 'none' }), '2');
  assert.equal(ids({ text: 'גליל', sort: 'name' }), '13', 'search matches the folder name too');
  assert.equal(ids({ text: 'xyz' }), '');
});
