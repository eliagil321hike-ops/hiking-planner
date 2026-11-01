// One-off build (D-032): national/regional hiking routes (OSM route=hiking, network iwn/nwn/rwn) around Israel
// → simplified GeoJSON. Data © OpenStreetMap contributors, ODbL.
import { writeFileSync, mkdirSync } from 'node:fs';
const BBOX = '29.45,34.2,33.45,35.95'; // s,w,n,e
const q = `[out:json][timeout:240];rel[route=hiking][network~"^(iwn|nwn|rwn)$"](${BBOX});out geom;`;
const EP = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
let j;
for (const ep of EP) {
  const r = await fetch(ep, { method: 'POST', body: 'data=' + encodeURIComponent(q),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'hiking-planner/1 (github.com/eliagil321hike-ops/hiking-planner)' } });
  const t = await r.text(); console.log(ep, r.status, t.length);
  if (r.ok && t.startsWith('{')) { j = JSON.parse(t); break; } else console.log(t.slice(0, 300));
}
// Douglas–Peucker in metres (local equirectangular), tolerance 4 m
function simplify(pts, tol = 4) {
  if (pts.length < 3) return pts;
  const k = Math.cos((pts[0][1] * Math.PI) / 180) * 111320, m = 110540;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop(); const [ax, ay] = [pts[a][0] * k, pts[a][1] * m], [bx, by] = [pts[b][0] * k, pts[b][1] * m];
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy; let best = -1, bi = -1;
    for (let i = a + 1; i < b; i++) {
      const px = pts[i][0] * k, py = pts[i][1] * m;
      const tt = L2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2)) : 0;
      const d = Math.hypot(px - ax - tt * dx, py - ay - tt * dy); if (d > best) { best = d; bi = i; }
    }
    if (best > tol) { keep[bi] = 1; st.push([a, bi], [bi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const feats = []; let raw = 0, kept = 0;
for (const e of j.elements) {
  const lines = e.members.filter((x) => x.type === 'way' && x.geometry && !['platform'].includes(x.role))
    .map((x) => { raw += x.geometry.length; const s = simplify(x.geometry.map((g) => [+g.lon.toFixed(5), +g.lat.toFixed(5)])); kept += s.length; return s; })
    .filter((l) => l.length > 1);
  if (!lines.length) continue;
  const t = e.tags;
  feats.push({ type: 'Feature', id: e.id, properties: { id: e.id, network: t.network, name: t['name:he'] ?? t.name ?? '', name_en: t['name:en'] ?? '', ref: t.ref ?? '', colour: t.colour ?? '', osmc: t['osmc:symbol'] ?? '' },
    geometry: { type: 'MultiLineString', coordinates: lines } });
  console.log(e.id, t.network, t['name:he'] ?? t.name, '|', t['name:en'] ?? '', '| colour', t.colour ?? '', '| ways', lines.length);
}
const out = JSON.stringify({ type: 'FeatureCollection', generated: new Date().toISOString(), source: 'OpenStreetMap via Overpass, ODbL', bbox: BBOX, features: feats });
mkdirSync('out', { recursive: true }); writeFileSync('out/trails.geojson', out);
console.log('relations', feats.length, 'points raw', raw, 'kept', kept, 'bytes', out.length);
