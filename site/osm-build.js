// OSM → map features, in the browser (D-042): the same rules as scripts/fetch_osm_hiking.py (build-time
// extract for Israel), used for areas outside Israel that are loaded on demand from Overpass.
// tests/osm-build.test.mjs runs both implementations on the same fixture and requires identical output.

export const RANK = { marked: 0, regional: 1, national: 2, int: 3 };
export const MARK_COLOURS = { red: '#d32f2f', blue: '#1e63c4', green: '#2e9b3e', black: '#2b2b2b', orange: '#f57c00',
  purple: '#7b1fa2', yellow: '#e0b000', brown: '#8a5a2b', white: '#9e9e9e' };
const SKIP_ROLES = new Set(['alternative', 'excursion', 'approach', 'connection']);
const PARKING_NEAR_M = 400;

export const overpassQuery = ([w, s, e, n], timeout = 90) => {
  const b = `${s},${w},${n},${e}`;
  return `[out:json][timeout:${timeout}];
rel["route"="hiking"]["network"~"^(iwn|nwn|rwn|lwn)$"](${b})->.top;
(.top; rel(r.top);)->.routes;
.routes out geom;
(
  nwr["tourism"="camp_site"](${b});
  nwr["amenity"="drinking_water"](${b});
  nwr["man_made"="water_tap"](${b});
  node["natural"="spring"](${b});
  nwr["tourism"="viewpoint"](${b});
  nwr["amenity"="shelter"](${b});
  nwr["tourism"~"^(wilderness_hut|alpine_hut)$"](${b});
  nwr["waterway"="waterfall"](${b});
  nwr["natural"="water"]["water"="stream_pool"](${b});
  nwr["natural"="water"]["name"~"^(גב|גבי|בריכת|בריכה) "](${b});
  nwr["leisure"="swimming_area"](${b});
  nwr["historic"~"^(ruins|archaeological_site)$"](${b});
  nwr["amenity"="parking"](${b});
);
out center tags;`;
};

const isInt = (t) => {
  const names = ['name', 'name:he', 'name:en'].map((k) => t[k] ?? '').join(' ');
  return names.includes('שביל ישראל') || names.includes('Israel National Trail');
};
const ownKind = (t) => (isInt(t) ? 'int' : { iwn: 'national', nwn: 'national', rwn: 'regional', lwn: 'marked' }[t.network] ?? null);
export function markColour(t) {
  const c = ((t['osmc:symbol'] ?? '').split(':')[0] || t.colour || '').trim().toLowerCase();
  return MARK_COLOURS[c] ?? '#8a5a2b';
}
const round = (v, d) => Number(v.toFixed(d));

/** Douglas–Peucker on lon/lat with a local metric approximation (tolerance in metres). */
export function simplify(pts, tolM = 4) {
  if (pts.length < 3) return pts;
  const k = Math.cos((pts[0][1] * Math.PI) / 180);
  const d2 = (p, a, b) => {
    const ax = a[0] * k, ay = a[1], bx = b[0] * k, by = b[1], px = p[0] * k, py = p[1];
    const dx = bx - ax, dy = by - ay;
    const t = dx === 0 && dy === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
    return ((ax + t * dx - px) ** 2 + (ay + t * dy - py) ** 2) * 111320 ** 2;
  };
  const keep = new Array(pts.length).fill(false); keep[0] = keep[pts.length - 1] = true;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    let best = 0, bi = -1;
    for (let m = i + 1; m < j; m++) { const v = d2(pts[m], pts[i], pts[j]); if (v > best) { best = v; bi = m; } }
    if (bi >= 0 && best > tolM ** 2) { keep[bi] = true; stack.push([i, bi], [bi, j]); }
  }
  return pts.filter((_, i) => keep[i]);
}

export function poiKind(t) {
  if (t.tourism === 'camp_site') return 'camp';
  if (t.amenity === 'drinking_water' || t.man_made === 'water_tap') return t.drinking_water === 'no' || ['private', 'no'].includes(t.access) ? null : 'water';
  if (t.amenity === 'parking') {
    if (['underground', 'multi-storey', 'rooftop', 'street_side', 'lane'].includes(t.parking) || ['private', 'no', 'customers', 'permit'].includes(t.access)) return null;
    return 'parking';
  }
  if (t.natural === 'spring') return 'spring';
  if (t.tourism === 'viewpoint') return 'viewpoint';
  if (['wilderness_hut', 'alpine_hut'].includes(t.tourism) || (t.amenity === 'shelter' && !['public_transport', 'changing_rooms', 'field_shelter'].includes(t.shelter_type))) return 'shelter';
  if (t.waterway === 'waterfall') return 'waterfall';
  if (isPool(t)) return 'pool';
  if (['ruins', 'archaeological_site'].includes(t.historic)) return 'ruins';
  return null;
}

// Pools in nature (D-058), same rule as scripts/fetch_osm_hiking.py is_pool().
const POOL_NAME = /^(גב|גבי|בריכת|בריכה) /u;
const POOL_NOT_WATER = new Set(['reservoir', 'wastewater', 'fishpond', 'basin', 'river', 'canal', 'lake', 'lagoon', 'moat']);
const POOL_NOT_NAME = /שחי|דגים|חמצון|ניקוז|ביוב/u;
export function isPool(t) {
  if (t.leisure === 'swimming_area') return !['private', 'no'].includes(t.access);
  if (t.natural !== 'water') return false;
  if (t.water === 'stream_pool') return true;
  const name = t['name:he'] || t.name || '';
  return POOL_NAME.test(name) && !POOL_NOT_WATER.has(t.water) && !POOL_NOT_NAME.test(name);
}

function trailIndex(trails, cell = 0.01) {
  const grid = new Set();
  const step = 100 / 111320;
  for (const f of trails) for (const line of f.geometry.coordinates) for (let i = 1; i < line.length; i++) {
    const [x1, y1] = line[i - 1], [x2, y2] = line[i];
    const n = Math.max(1, Math.floor(Math.hypot(x2 - x1, y2 - y1) / step));
    for (let j = 0; j <= n; j++) grid.add(`${round(x1 + ((x2 - x1) * j) / n, 4)},${round(y1 + ((y2 - y1) * j) / n, 4)}`);
  }
  const cells = new Map();
  for (const key of grid) {
    const [x, y] = key.split(',').map(Number);
    const c = `${Math.trunc(x / cell)},${Math.trunc(y / cell)}`;
    if (!cells.has(c)) cells.set(c, []);
    cells.get(c).push([x, y]);
  }
  const r = PARKING_NEAR_M / 111320;
  return (lon, lat) => {
    const k = Math.cos((lat * Math.PI) / 180);
    const cx = Math.trunc(lon / cell), cy = Math.trunc(lat / cell);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const [x, y] of cells.get(`${cx + dx},${cy + dy}`) ?? []) if (((x - lon) * k) ** 2 + (y - lat) ** 2 <= r * r) return true;
    }
    return false;
  };
}

/** Overpass JSON → { trails, pois } (GeoJSON features), same rules as the build-time extract. */
export function build(data) {
  const rels = new Map(data.elements.filter((e) => e.type === 'relation').map((e) => [e.id, e]));
  const parent = new Map();
  for (const r of rels.values()) for (const m of r.members ?? []) if (m.type === 'relation' && !parent.has(m.ref)) parent.set(m.ref, r.id);
  const kindOf = (rid, depth = 0) => {
    let k = ownKind(rels.get(rid).tags ?? {});
    const p = parent.get(rid);
    if (rels.has(p) && depth < 5) { const pk = kindOf(p, depth + 1); if (pk && (!k || RANK[pk] > RANK[k])) k = pk; }
    return k;
  };
  const labelOf = (rid) => {
    const t = rels.get(rid).tags ?? {};
    const p = parent.get(rid);
    if (rels.has(p) && isInt(rels.get(p).tags ?? {}) && !isInt(t)) return labelOf(p);
    return t['name:he'] || t.name || t['name:en'] || '';
  };
  const trails = [];
  for (const [rid, r] of rels) {
    const k = kindOf(rid);
    if (!k) continue;
    const lines = [];
    for (const m of r.members ?? []) {
      if (m.type !== 'way' || SKIP_ROLES.has(m.role ?? '') || !m.geometry) continue;
      const pts = simplify(m.geometry.filter(Boolean).map((g) => [round(g.lon, 5), round(g.lat, 5)]));
      if (pts.length >= 2) lines.push(pts);
    }
    if (!lines.length) continue;
    const t = r.tags ?? {};
    trails.push({ type: 'Feature', id: rid,
      properties: { kind: k, rank: RANK[k], name: labelOf(rid), ref: t.ref ?? '', network: t.network ?? '', color: markColour(t) },
      geometry: { type: 'MultiLineString', coordinates: lines } });
  }
  const near = trailIndex(trails);
  const pois = [];
  for (const el of data.elements) {
    if (el.type === 'relation' && !el.center) continue;
    const t = el.tags ?? {};
    const kind = poiKind(t);
    if (!kind) continue;
    const [lon, lat] = el.lon !== undefined ? [el.lon, el.lat] : [el.center.lon, el.center.lat];
    if (kind === 'parking' && !near(lon, lat)) continue;
    const props = { kind, name: t['name:he'] || t.name || '' };
    if ((kind === 'spring' && ['yes', 'spring', 'winter'].includes(t.seasonal)) || t.intermittent === 'yes') props.seasonal = 1;
    pois.push({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: [round(lon, 6), round(lat, 6)] } });
  }
  return { trails, pois };
}
