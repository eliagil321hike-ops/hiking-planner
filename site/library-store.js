// My Routes library (D-056): saved routes and folders, separate from the route being edited.
// Data lives behind a small adapter so the browser store (IndexedDB, this device only) can later be joined by a
// synced store (e.g. a Google account) without touching the UI. Nothing here saves on its own: every write is
// the result of an explicit user action (owner: manual saving only).

export const SCHEMA_VERSION = 1;
export const LOCAL_USER = 'local';       // no accounts yet; a real user id replaces this when sync exists

const now = () => new Date().toISOString();
export const newId = () => (globalThis.crypto?.randomUUID?.() ?? `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
const cleanName = (s, fallback) => (String(s ?? '').trim().replace(/\s+/g, ' ').slice(0, 80) || fallback);

/** Library operations over an adapter { all(store), get(store, id), put(store, obj), del(store, id) }. */
export function createLibrary(adapter, { userId = LOCAL_USER } = {}) {
  const mine = (o) => o && o.userId === userId;

  async function listFolders() {
    return (await adapter.all('folders')).filter(mine).sort((a, b) => a.name.localeCompare(b.name, 'he'));
  }
  async function listRoutes() {
    return (await adapter.all('routes')).filter(mine);
  }
  async function getRoute(id) {
    const r = await adapter.get('routes', id);
    return mine(r) ? r : null;
  }
  async function folderExists(id) {
    if (id == null) return true;
    const f = await adapter.get('folders', id);
    return mine(f);
  }

  /**
   * Save a new route. `data` = { name, folderId, color, editor: <RouteEditor.toDraft()> (control points, modes,
   * routed segments: restores the editor exactly), geometry: [[lon, lat]] (the whole line), profile:
   * [[lon, lat, distance m, elevation m | null]] every 20 m, stats: { distance, ascent, descent, min, max }, bbox,
   * thumb (JPEG/SVG data URL) }. Returns the stored record.
   */
  async function createRoute(data) {
    validateRouteData(data);
    if (!(await folderExists(data.folderId ?? null))) throw new LibraryError('folder-missing');
    const t = now();
    const rec = { schema: SCHEMA_VERSION, id: newId(), userId, createdAt: t, updatedAt: t, ...pickRoute(data),
      name: cleanName(data.name, 'מסלול ללא שם') };
    await adapter.put('routes', rec);
    return rec;
  }
  /** Replace the route content of an existing record (Update Original). Keeps id, folder and createdAt;
   *  moving to another folder is only done by moveRoute. */
  async function updateRoute(id, data) {
    const old = await getRoute(id);
    if (!old) throw new LibraryError('route-missing');
    validateRouteData(data);
    const rec = { ...old, ...pickRoute(data), name: cleanName(data.name ?? old.name, old.name), folderId: old.folderId,
      updatedAt: now() };
    await adapter.put('routes', rec);
    return rec;
  }
  async function renameRoute(id, name) {
    const old = await getRoute(id);
    if (!old) throw new LibraryError('route-missing');
    const rec = { ...old, name: cleanName(name, old.name), updatedAt: now() };
    await adapter.put('routes', rec);
    return rec;
  }
  async function moveRoute(id, folderId) {
    const old = await getRoute(id);
    if (!old) throw new LibraryError('route-missing');
    if (!(await folderExists(folderId ?? null))) throw new LibraryError('folder-missing');
    const rec = { ...old, folderId: folderId ?? null, updatedAt: now() };
    await adapter.put('routes', rec);
    return rec;
  }
  /** Duplicate (also used by "Edit → Create copy"): a new id, the original is not touched. */
  async function duplicateRoute(id, { name, folderId } = {}) {
    const old = await getRoute(id);
    if (!old) throw new LibraryError('route-missing');
    const target = folderId === undefined ? old.folderId : folderId;
    if (!(await folderExists(target ?? null))) throw new LibraryError('folder-missing');
    const t = now();
    const rec = { ...structuredCloneSafe(old), id: newId(), createdAt: t, updatedAt: t, folderId: target ?? null,
      name: cleanName(name, `${old.name} (עותק)`) };
    await adapter.put('routes', rec);
    return rec;
  }
  async function deleteRoute(id) {
    if (!(await getRoute(id))) throw new LibraryError('route-missing');
    await adapter.del('routes', id);
  }

  async function createFolder(name) {
    const n = cleanName(name, '');
    if (!n) throw new LibraryError('name-empty');
    const t = now();
    const f = { schema: SCHEMA_VERSION, id: newId(), userId, name: n, createdAt: t, updatedAt: t };
    await adapter.put('folders', f);
    return f;
  }
  async function renameFolder(id, name) {
    const f = await adapter.get('folders', id);
    if (!mine(f)) throw new LibraryError('folder-missing');
    const n = cleanName(name, '');
    if (!n) throw new LibraryError('name-empty');
    const rec = { ...f, name: n, updatedAt: now() };
    await adapter.put('folders', rec);
    return rec;
  }
  /** Delete a folder; its routes are never deleted: they move to `moveTo` (a folder id) or to "no folder" (null). */
  async function deleteFolder(id, { moveTo = null } = {}) {
    const f = await adapter.get('folders', id);
    if (!mine(f)) throw new LibraryError('folder-missing');
    if (moveTo === id) throw new LibraryError('folder-same');
    if (!(await folderExists(moveTo))) throw new LibraryError('folder-missing');
    for (const r of await listRoutes()) {
      if (r.folderId === id) await adapter.put('routes', { ...r, folderId: moveTo ?? null, updatedAt: now() });
    }
    await adapter.del('folders', id);
  }

  // ---------------------------------------------------------------- personal points (D-063)
  // Saved one by one, by an explicit "save" in the marking dialog (owner: manual saving only).
  async function listPoints() {
    return (await adapter.all('points')).filter(mine);
  }
  async function createPoint(data) {
    validatePoint(data);
    const t = now();
    const rec = { schema: SCHEMA_VERSION, id: newId(), userId, createdAt: t, updatedAt: t, ...pickPoint(data),
      name: cleanName(data.name, 'נקודה') };
    await adapter.put('points', rec);
    return rec;
  }
  async function updatePoint(id, patch) {
    const old = await adapter.get('points', id);
    if (!mine(old)) throw new LibraryError('point-missing');
    const rec = { ...old, ...pickPoint(patch), name: cleanName(patch.name ?? old.name, old.name), updatedAt: now() };
    validatePoint(rec);
    await adapter.put('points', rec);
    return rec;
  }
  async function deletePoint(id) {
    const old = await adapter.get('points', id);
    if (!mine(old)) throw new LibraryError('point-missing');
    await adapter.del('points', id);
  }
  /** Owner (D-063): the old waypoints (no symbol) are removed for good, also from saved routes. Keeps updatedAt. */
  async function stripLegacyWaypoints() {
    let n = 0;
    for (const r of await listRoutes()) {
      const w = r.editor?.state?.waypoints;
      if (!Array.isArray(w) || !w.some((x) => !x.icon)) continue;
      const rec = { ...r, editor: { ...r.editor, state: { ...r.editor.state, waypoints: w.filter((x) => x.icon) } } };
      await adapter.put('routes', rec);
      n++;
    }
    return n;
  }

  return { listFolders, listRoutes, getRoute, createRoute, updateRoute, renameRoute, moveRoute, duplicateRoute,
    deleteRoute, createFolder, renameFolder, deleteFolder, listPoints, createPoint, updatePoint, deletePoint, stripLegacyWaypoints };
}

function pickPoint(d) {
  const out = {};
  for (const k of ['name', 'icon', 'lon', 'lat', 'ele', 'source']) if (k in d) out[k] = d[k];
  return out;
}
export function validatePoint(d) {
  if (!Number.isFinite(d?.lon) || !Number.isFinite(d?.lat) || Math.abs(d.lat) > 90 || Math.abs(d.lon) > 180) throw new LibraryError('point-bad');
  if (typeof d.icon !== 'string' || !d.icon) throw new LibraryError('point-bad');
}

export class LibraryError extends Error {
  constructor(code) { super(code); this.code = code; }
}

function pickRoute(d) {
  const out = {};
  for (const k of ['name', 'folderId', 'color', 'editor', 'geometry', 'profile', 'stats', 'bbox', 'thumb']) if (k in d) out[k] = d[k];
  if ('folderId' in out) out.folderId = out.folderId ?? null;
  return out;
}

/** A route must be restorable: the editor state (control points + modes + routed segments) and its line. */
export function validateRouteData(d) {
  const v = d?.editor?.state?.vertices;
  if (!Array.isArray(v) || v.length < 2) throw new LibraryError('route-too-short');
  for (const p of v) if (!Number.isFinite(p.lon) || !Number.isFinite(p.lat)) throw new LibraryError('route-bad-point');
  if (!Array.isArray(d.geometry) || d.geometry.length < 2) throw new LibraryError('route-no-geometry');
  if (d.profile && !d.profile.every((p) => Array.isArray(p) && p.length === 4)) throw new LibraryError('route-bad-profile');
}

const structuredCloneSafe = (o) => (typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)));

/** Filter + sort for the library view (pure; unit-tested). */
export function queryRoutes(routes, folders, { text = '', folder = 'all', sort = 'date' } = {}) {
  const fname = new Map(folders.map((f) => [f.id, f.name]));
  const q = text.trim().toLowerCase();
  let out = routes.filter((r) => {
    if (folder === 'none' && r.folderId) return false;
    if (folder !== 'all' && folder !== 'none' && r.folderId !== folder) return false;
    if (!q) return true;
    return r.name.toLowerCase().includes(q) || (fname.get(r.folderId) ?? '').toLowerCase().includes(q);
  });
  const by = {
    name: (a, b) => a.name.localeCompare(b.name, 'he'),
    date: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
    distance: (a, b) => (b.stats?.distance ?? 0) - (a.stats?.distance ?? 0),
    ascent: (a, b) => (b.stats?.ascent ?? 0) - (a.stats?.ascent ?? 0),
  }[sort] ?? ((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  out = [...out].sort(by);
  return out;
}

/** In-memory adapter (tests, and the fallback when the browser blocks storage — then nothing persists). */
export function memoryAdapter() {
  const db = { routes: new Map(), folders: new Map(), points: new Map() };
  const clone = (o) => JSON.parse(JSON.stringify(o));
  return {
    persistent: false,
    async all(s) { return [...db[s].values()].map(clone); },
    async get(s, id) { const o = db[s].get(id); return o ? clone(o) : undefined; },
    async put(s, o) { db[s].set(o.id, clone(o)); },
    async del(s, id) { db[s].delete(id); },
  };
}

/** IndexedDB adapter: database "topo3d-library" (unique: the github.io origin is shared by all the owner's sites). */
export function idbAdapter(name = 'topo3d-library') {
  let dbp = null;
  const open = () => (dbp ??= new Promise((res, rej) => {
    const req = indexedDB.open(name, 2);   // v2: personal points (D-063)
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('routes')) db.createObjectStore('routes', { keyPath: 'id' }).createIndex('folderId', 'folderId');
      if (!db.objectStoreNames.contains('folders')) db.createObjectStore('folders', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('points')) db.createObjectStore('points', { keyPath: 'id' });
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => { dbp = null; rej(req.error ?? new Error('IndexedDB open failed')); };
    req.onblocked = () => rej(new Error('IndexedDB blocked'));
  }));
  const tx = async (s, mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction(s, mode);
      const out = fn(t.objectStore(s));
      t.oncomplete = () => res(out?.result);
      t.onerror = () => rej(t.error ?? new Error('IndexedDB write failed'));
      t.onabort = () => rej(t.error ?? new Error('IndexedDB aborted (storage full?)'));
    });
  };
  return {
    persistent: true,
    all: (s) => tx(s, 'readonly', (st) => st.getAll()),
    get: (s, id) => tx(s, 'readonly', (st) => st.get(id)),
    put: (s, o) => tx(s, 'readwrite', (st) => st.put(o)).then(() => undefined),
    del: (s, id) => tx(s, 'readwrite', (st) => st.delete(id)).then(() => undefined),
  };
}
