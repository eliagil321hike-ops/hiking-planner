// Loads OSM trails and points of interest for what is on screen (D-042, regions D-061).
//   Pre-built regions (Israel, Georgia, Norway): 0.5° cell files data/osm/{lat}_{lon}.json, from z7.
//   Elsewhere: on demand from the public Overpass API from z11 (≈ the 1 km scale bar), 0.25° cells, one
//   request at a time and at most a few cells per request (light use of a free service); same rules
//   (osm-build.js). An on-demand cell that lies entirely inside a region's border (index.covered) is never
//   asked for; along a border both sources are used and the same route or point is shown once (the
//   pre-built one wins). Loaded cells are kept in memory (oldest dropped beyond a limit) and merged into the
//   map sources.

import { build, overpassQuery } from './osm-build.js';

export function createOsmLoader(map, cfg, { onUpdate, fetchImpl = (...a) => fetch(...a) } = {}) {
  const stats = { cells: 0, dynamicCells: 0, requests: 0, errors: 0, lastError: null, osmBase: null };
  const loaded = new Map();      // key → { trails, pois, used }
  const pending = new Set();
  let index = null, busy = false, again = false, timer = null;

  const keyOf = (lat, lon, size, prefix = '') => `${prefix}${Math.floor(lat / size)}_${Math.floor(lon / size)}`;
  // On-demand cells inside a pre-built region (index.covered: {row: [[j0, j1], …]}). An older index without it
  // falls back to its coverage box (cells fully inside the box).
  function isCovered(c) {
    if (!index) return false;
    if (index.covered) {
      const [i, j] = c.key.slice(1).split('_').map(Number);
      return (index.covered[i] ?? []).some(([a, b]) => j >= a && j <= b);
    }
    const [w, s, e, n] = index.coverage ?? [0, 0, 0, 0];
    return c.w >= w && c.e <= e && c.s >= s && c.n <= n;
  }
  const hasStatic = (c) => Boolean(index?.cells?.[c.key]);
  const poiKey = (f) => `${f.properties.kind}|${f.geometry.coordinates.map((v) => v.toFixed(4)).join(',')}`;

  function cellsInView(size, prefix, marginFrac = 0.25) {
    const b = map.getBounds();
    const mx = (b.getEast() - b.getWest()) * marginFrac, my = (b.getNorth() - b.getSouth()) * marginFrac;
    const out = [];
    for (let i = Math.floor((b.getSouth() - my) / size); i <= Math.floor((b.getNorth() + my) / size); i++) {
      for (let j = Math.floor((b.getWest() - mx) / size); j <= Math.floor((b.getEast() + mx) / size); j++) {
        out.push({ key: `${prefix}${i}_${j}`, s: i * size, w: j * size, n: (i + 1) * size, e: (j + 1) * size });
      }
    }
    return out;
  }

  function publish() {
    const trails = [], pois = [];
    const staticIds = new Set(), staticPois = new Set();
    for (const [k, c] of loaded) {
      if (k.startsWith('d')) continue;
      for (const f of c.trails) { trails.push(f); if (f.id != null) staticIds.add(f.id); }
      for (const f of c.pois) { pois.push(f); staticPois.add(poiKey(f)); }
    }
    for (const [k, c] of loaded) {          // on-demand data: skip what a pre-built region already shows
      if (!k.startsWith('d')) continue;
      for (const f of c.trails) if (f.id == null || !staticIds.has(f.id)) trails.push(f);
      for (const f of c.pois) if (!staticPois.has(poiKey(f))) pois.push(f);
    }
    stats.cells = loaded.size;
    onUpdate?.({ trails, pois });
  }
  function store(key, data) {
    loaded.set(key, { ...data, used: performance.now() });
    if (loaded.size > cfg.maxCells) {               // drop the least recently needed cells
      const oldest = [...loaded.entries()].sort((a, b) => a[1].used - b[1].used).slice(0, loaded.size - cfg.maxCells);
      for (const [k] of oldest) loaded.delete(k);
    }
  }

  async function loadStatic(c) {
    if (!index.cells[c.key]) { store(c.key, { trails: [], pois: [] }); return; }   // nothing in this cell
    const res = await fetchImpl(`${cfg.base}${c.key}.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    store(c.key, await res.json());
  }

  async function loadDynamic(cells) {
    const bbox = [Math.min(...cells.map((c) => c.w)), Math.min(...cells.map((c) => c.s)), Math.max(...cells.map((c) => c.e)), Math.max(...cells.map((c) => c.n))];
    stats.requests++;
    const res = await fetchImpl(cfg.dynamic.endpoint, { method: 'POST', body: new URLSearchParams({ data: overpassQuery(bbox) }) });
    if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
    const { trails, pois } = build(await res.json());
    const by = new Map(cells.map((c) => [c.key, { trails: [], pois: [] }]));
    const size = cfg.dynamic.cell;
    const put = (lon, lat, what, f) => by.get(keyOf(lat, lon, size, 'd'))?.[what].push(f);   // only cells asked for
    for (const f of trails) {
      const groups = new Map();
      for (const line of f.geometry.coordinates) {
        const [lon, lat] = line[Math.floor(line.length / 2)];
        const k = keyOf(lat, lon, size, 'd');
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(line);
      }
      for (const [k, lines] of groups) by.get(k)?.trails.push({ ...f, geometry: { type: 'MultiLineString', coordinates: lines } });
    }
    for (const f of pois) put(...f.geometry.coordinates, 'pois', f);
    for (const [k, v] of by) store(k, v);
    stats.dynamicCells += cells.length;
  }

  async function update() {
    if (!index) return;
    if (busy) { again = true; return; }
    busy = true;
    try {
      const z = map.getZoom();
      const now = performance.now();
      if (z >= cfg.minZoom) {
        const want = cellsInView(index.cell, '').filter(hasStatic);
        want.forEach((c) => loaded.has(c.key) && (loaded.get(c.key).used = now));
        const missing = want.filter((c) => !loaded.has(c.key) && !pending.has(c.key));
        await Promise.all(missing.map(async (c) => {
          pending.add(c.key);
          try { await loadStatic(c); } catch (e) { stats.errors++; stats.lastError = e.message; } finally { pending.delete(c.key); }
        }));
        if (missing.length) publish();
      }
      if (cfg.dynamic?.enabled && z >= cfg.dynamic.minZoom) {
        const size = cfg.dynamic.cell;
        const want = cellsInView(size, 'd', 0.1).filter((c) => !isCovered(c));   // not fully inside a pre-built region
        want.forEach((c) => loaded.has(c.key) && (loaded.get(c.key).used = now));
        const missing = want.filter((c) => !loaded.has(c.key));
        if (missing.length && missing.length <= cfg.dynamic.maxCellsPerRequest) {
          try { await loadDynamic(missing); publish(); } catch (e) { stats.errors++; stats.lastError = e.message; }
        }
      }
    } finally {
      busy = false;
      if (again) { again = false; schedule(); }
    }
  }
  const schedule = () => { clearTimeout(timer); timer = setTimeout(update, 250); };

  async function start() {
    try {
      const res = await fetchImpl(cfg.index, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      index = await res.json();
      stats.osmBase = index.osm_base;
    } catch (e) {
      stats.lastError = `index: ${e.message}`;
      index = { cell: 0.5, covered: {}, cells: {} };   // no extract: only on-demand loading
    }
    map.on('moveend', schedule);
    await update();
  }
  /**
   * Category search (D-045): every point of `kind` inside `bounds` ([w, s, e, n]), at any zoom. Pre-built cells
   * in view are loaded first if needed; outside the regions the on-demand cells are loaded when the area is small
   * enough for a light Overpass request (otherwise `tooLargeAbroad` is set and only what is loaded counts).
   */
  async function collect(kind, [w, s, e, n]) {
    let tooLargeAbroad = false;
    const cellsOf = (size, prefix) => {
      const out = [];
      for (let i = Math.floor(s / size); i <= Math.floor(n / size); i++) for (let j = Math.floor(w / size); j <= Math.floor(e / size); j++) {
        out.push({ key: `${prefix}${i}_${j}`, s: i * size, w: j * size, n: (i + 1) * size, e: (j + 1) * size });
      }
      return out;
    };
    if (index) {
      const stat = cellsOf(index.cell, '').filter(hasStatic);
      await Promise.all(stat.filter((c) => !loaded.has(c.key)).map((c) => loadStatic(c).catch((err) => { stats.errors++; stats.lastError = err.message; })));
      if (cfg.dynamic?.enabled) {
        const dyn = cellsOf(cfg.dynamic.cell, 'd').filter((c) => !isCovered(c));
        const missing = dyn.filter((c) => !loaded.has(c.key));
        if (missing.length > cfg.dynamic.maxCellsPerSearch) tooLargeAbroad = true;
        else if (missing.length) {
          for (let k = 0; k < missing.length; k += cfg.dynamic.maxCellsPerRequest) {
            try { await loadDynamic(missing.slice(k, k + cfg.dynamic.maxCellsPerRequest)); } catch (err) { stats.errors++; stats.lastError = err.message; tooLargeAbroad = true; break; }
          }
        }
      }
      publish();
    }
    const seen = new Set(), features = [];
    const ordered = [...loaded.entries()].sort(([a], [b]) => a.startsWith('d') - b.startsWith('d'));   // pre-built first
    for (const [, c] of ordered) for (const f of c.pois) {
      const [lon, lat] = f.geometry.coordinates;
      if (f.properties.kind !== kind || lon < w || lon > e || lat < s || lat > n) continue;
      const id = poiKey(f);
      if (!seen.has(id)) { seen.add(id); features.push(f); }
    }
    return { features, tooLargeAbroad };
  }

  return { start, stats, update, collect };
}
