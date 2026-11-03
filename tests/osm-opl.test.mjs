// The Geofabrik/osmium path (scripts/osm_opl.py, D-057) must give build() exactly what Overpass gives, so the
// map does not change when the data source does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const FIXTURE = new URL('./fixtures/overpass-sample.json', import.meta.url).pathname;

function py(code) {
  return JSON.parse(execFileSync('python3', ['-c', `import json, sys; sys.path.insert(0, 'scripts')\n${code}`],
    { encoding: 'utf8' }));
}

// Writes the fixture as osmium would (opl, add_metadata=false, locations on ways): every member way becomes a
// way line with node ids and locations; space , = @ % are escaped as %<hex>%.
const TO_OPL = `
def esc(s):
    return ''.join('%%%x%%' % ord(c) if c in ' ,=@%\\n' or ord(c) < 32 else c for c in s)
def T(tags):
    return 'T' + ','.join(esc(k) + '=' + esc(v) for k, v in tags.items())
d = json.load(open(${JSON.stringify(FIXTURE)}, encoding='utf-8'))
lines, ways, nid = [], {}, 1000
for el in d['elements']:
    for m in el.get('members', []):
        if m['type'] == 'way' and 'geometry' in m:
            ways[m['ref']] = m['geometry']
for wid, g in ways.items():
    refs = []
    for p in g:
        nid += 1; refs.append('n%dx%sy%s' % (nid, p['lon'], p['lat']))
    lines.append('w%d T N%s' % (wid, ','.join(refs)))
for el in d['elements']:
    t = el.get('tags', {})
    if el['type'] == 'relation' and 'members' in el:
        ms = ','.join({'way': 'w', 'node': 'n', 'relation': 'r'}[m['type']] + str(m['ref']) + '@' + esc(m['role']) for m in el['members'])
        lines.append('r%d %s M%s' % (el['id'], T(t), ms))
    elif el['type'] == 'node':
        lines.append('n%d %s x%s y%s' % (el['id'], T(t), el['lon'], el['lat']))
    else:   # a POI way/relation: Overpass only gives its centre; draw a small square around it
        c = el['center']; pts = []
        for dx, dy in ((-1e-4, -1e-4), (1e-4, -1e-4), (1e-4, 1e-4), (-1e-4, 1e-4), (-1e-4, -1e-4)):
            nid += 1; pts.append('n%dx%.7fy%.7f' % (nid, c['lon'] + dx, c['lat'] + dy))
        if el['type'] == 'way':
            lines.append('w%d %s N%s' % (el['id'], T(t), ','.join(pts)))
        else:
            lines.append('w%d T N%s' % (el['id'] + 500000, ','.join(pts)))
            lines.append('r%d %s Mw%d@outer' % (el['id'], T(t), el['id'] + 500000))
`;

const norm = (x) => JSON.stringify([...x].map((f) => JSON.stringify(f)).sort());

test('Geofabrik/osmium path gives build() the same trails and points as Overpass', () => {
  const r = py(`${TO_OPL}
import fetch_osm_hiking as f, osm_opl
a_t, a_p, _ = f.build(d)
b = osm_opl.to_overpass(lines, f.BBOX, '2026-11-01T00:00:00Z')
b_t, b_p, _ = f.build(b)
print(json.dumps({'a_t': a_t, 'a_p': a_p, 'b_t': b_t, 'b_p': b_p, 'opl': lines, 'base': b['osm3s']}, ensure_ascii=False))`);
  assert.ok(r.a_t.length > 0 && r.a_p.length > 0, 'fixture has trails and points');
  assert.ok(r.opl.some((l) => /%20%/.test(l)), 'escaped spaces are exercised');
  assert.equal(r.b_t.length, r.a_t.length);
  assert.equal(r.b_p.length, r.a_p.length);
  // POI centres of areas are rebuilt from a square, so compare rounded to ~1 m (build() rounds to 6 decimals)
  const round = (fs) => fs.map((f) => ({ ...f, geometry: { ...f.geometry,
    coordinates: f.geometry.coordinates.map((v) => Math.round(v * 1e5) / 1e5) } }));
  assert.equal(norm(r.b_t), norm(r.a_t));
  assert.equal(norm(round(r.b_p)), norm(round(r.a_p)));
  assert.equal(r.base.timestamp_osm_base, '2026-11-01T00:00:00Z');
});

test('OPL details: escapes, Hebrew, areas, box, springs, missing locations, children', () => {
  const r = py(`
import osm_opl
box = (29.45, 34.2, 33.45, 35.95)
esc = lambda s: ''.join('%%%x%%' % ord(c) for c in s)   # everything escaped: the hardest case
lines = [
  'n1 Tnatural=spring,name=' + esc('מעיין עמוד') + ',seasonal=yes x35.4 y33.0',
  'n2 Tnatural=spring x10.0 y50.0',
  'n3 Tamenity=drinking_water x35.5 y33.01',
  'w5 Tnatural=spring Nn11x35.0y32.0,n12x35.001y32.001',
  'w6 T Nn21x35.1y32.1,n22x35.12y32.12,n23x35.1y32.12,n21x35.1y32.1',
  'r7 Ttourism=camp_site,type=multipolygon,name=חניון Mw6@outer',
  'w8 Thighway=path Nn31x35.2y32.2,n32xy,n34,n33x35.21y32.21',
  'w9 Thighway=path Nn41x10.0y50.0,n42x10.1y50.1',
  'r10 Troute=hiking,network=nwn,name=a%20%b Mr11@,w8@',
  'r11 Troute=hiking,name=section Mr12@,w8@',
  'r12 Troute=hiking,name=deeper Mw8@main%20%line',
  'r13 Troute=hiking,network=lwn Mw9@',
  'r14 Troute=hiking,network=lwn Mw8@,w99@',
]
d = osm_opl.to_overpass(lines, box, 'T0')
print(json.dumps(d, ensure_ascii=False))`);
  const byKey = Object.fromEntries(r.elements.map((e) => [e.type[0] + e.id, e]));
  // Hebrew + space written as %hex% comes back as text; seasonal kept
  assert.equal(byKey.n1.tags.name, 'מעיין עמוד');
  assert.equal(byKey.n1.tags.seasonal, 'yes');
  assert.ok(!byKey.n2, 'spring outside the box dropped');
  assert.ok(byKey.n3, 'tap kept');
  assert.ok(!byKey.w5, 'springs are nodes only (as in the Overpass query)');
  // campsite drawn as an area (relation): centre of its bounding box, unescaped Hebrew name as written
  assert.deepEqual(byKey.r7.center, { lat: 32.11, lon: 35.11 });
  assert.equal(byKey.r7.tags.name, 'חניון');
  assert.ok(!byKey.w6, 'untagged area outline is not a point');
  // a node with no location is skipped, the rest of the way stays
  assert.equal(byKey.r10.members[1].geometry.length, 2);
  assert.equal(byKey.r10.tags.name, 'a b');
  // children of national routes at any depth; their roles unescaped
  assert.ok(byKey.r11 && byKey.r12);
  assert.equal(byKey.r12.members[0].role, 'main line');
  assert.ok(!byKey.r13, 'marked trail entirely outside the box dropped');
  // a member way missing from the file is listed without geometry (Overpass does the same; build() skips it)
  assert.deepEqual(byKey.r14.members[1], { type: 'way', ref: 99, role: '' });
  assert.equal(r.osm3s.timestamp_osm_base, 'T0');
});
