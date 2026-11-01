// One-off probe (D-032): do OpenFreeMap tiles carry hiking-route info, and how big is Israel's nwn/rwn set?
import { VectorTile } from '@mapbox/vector-tile';
import Protobuf from 'pbf';
const tj = await (await fetch('https://tiles.openfreemap.org/planet')).json();
console.log('tiles', tj.tiles, 'version', tj.version, tj.planetiler_version ?? '', tj.description ?? '');
for (const l of tj.vector_layers) if (['transportation_name', 'transportation', 'poi'].includes(l.id)) console.log(l.id, l.minzoom, l.maxzoom, Object.keys(l.fields).join(','));
const blocks = { meron: [9802, 6599], jerusalem: [9784, 6666] };
for (const [nm, [cx, cy]] of Object.entries(blocks)) {
  let total = 0, withRoute = 0, hikingNet = 0, paths = 0, pathsHiking = 0; const names = new Map();
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    const url = tj.tiles[0].replace('{z}', 14).replace('{x}', cx + dx).replace('{y}', cy + dy);
    const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
    const vt = new VectorTile(new Protobuf(buf));
    const L = vt.layers.transportation_name; if (!L) continue;
    for (let i = 0; i < L.length; i++) {
      const p = L.feature(i).properties; total++;
      const nets = [1,2,3,4,5,6].map((k) => p[`route_${k}_network`]).filter(Boolean);
      if (nets.length) withRoute++;
      if (p.class === 'path') paths++;
      const h = [1,2,3,4,5,6].filter((k) => ['iwn','nwn','rwn','lwn'].includes(p[`route_${k}_network`]));
      if (h.length) { hikingNet++; if (p.class === 'path') pathsHiking++;
        for (const k of h) { const key = `${p[`route_${k}_network`]}|${p[`route_${k}_name`]}|${p[`route_${k}_colour`]}`; names.set(key, (names.get(key) ?? 0) + 1); } }
    }
    const T = vt.layers.transportation; if (T && dx === 0 && dy === 0) console.log(nm, 'transportation sample keys', Object.keys(T.feature(0).properties).join(','));
  }
  console.log(nm, { total, withRoute, hikingNet, paths, pathsHiking }); console.log([...names].slice(0, 25));
}
const q = '[out:json][timeout:120];area["ISO3166-1"="IL"][admin_level=2]->.a;rel(area.a)[route=hiking][network~"^(iwn|nwn|rwn)$"];out tags;';
const r = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q) });
const j = await r.json();
console.log('IL hiking relations', j.elements.length);
for (const e of j.elements) console.log(e.id, e.tags.network, e.tags['name:he'] ?? e.tags.name, '|', e.tags['name:en'] ?? '', '| colour', e.tags.colour ?? '', '| osmc', e.tags['osmc:symbol'] ?? '');
const q2 = '[out:json][timeout:180];area["ISO3166-1"="IL"][admin_level=2]->.a;rel(area.a)[route=hiking][network~"^(iwn|nwn|rwn)$"];way(r);out geom;';
const r2 = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q2) });
const t2 = await r2.text(); console.log('geometry bytes', t2.length, 'ways', (t2.match(/"type": "way"/g) || []).length);
