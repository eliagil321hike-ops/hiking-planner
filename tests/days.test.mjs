// D-065 day split: automatic split, anchoring after route edits, day figures, snapping, GPX per day.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  autoSplit, anchorLodgings, dayStats, effortSeries, suggestDays, snapTarget, cleanSplit, splitSignature, metres,
  maxDaysFor, dayColor, DAY_COLORS, ASCENT_PER_KM,
} from '../site/days-core.js';
import { routeToGpx } from '../site/gpx.js';

// a straight route east along lat 33, a sample every ~20 m, elevation from a function of the distance
function route(km, elev = () => 500) {
  const out = [];
  const step = 20, dLon = step / (111320 * Math.cos(33 * Math.PI / 180));
  for (let i = 0; i * step <= km * 1000; i++) out.push([35 + i * dLon, 33, i * step, elev(i * step)]);
  return out;
}

test('effort = distance + ascent / 100 (100 m of ascent counts as 1 km)', () => {
  const flat = route(10);
  assert.ok(Math.abs(effortSeries(flat).at(-1) - 10) < 0.01);
  const climb = route(10, (d) => 500 + d * 0.05);            // 500 m of steady ascent over 10 km
  const e = effortSeries(climb).at(-1);
  assert.ok(Math.abs(e - (10 + 500 / ASCENT_PER_KM)) < 0.3, `effort ${e}`);
});

test('auto split: equal effort on a flat route; more days → more lodgings; days in route order', () => {
  const p = route(60);
  const l = autoSplit(p, 3);
  assert.equal(l.length, 2);
  const a = anchorLodgings(p, l).map((x) => x.i);
  assert.ok(a[0] < a[1]);
  const days = dayStats(p, anchorLodgings(p, l));
  for (const d of days) assert.ok(Math.abs(d.distance - 20000) < 200, `day ${d.distance}`);
  assert.equal(autoSplit(p, 5).length, 4);
});

test('auto split: a climbing first half gives a shorter first day', () => {
  const p = route(40, (d) => (d < 20000 ? 300 + d * 0.06 : 1500));  // 1200 m up in the first 20 km, then flat
  const days = dayStats(p, anchorLodgings(p, autoSplit(p, 2)));
  assert.ok(days[0].distance < days[1].distance - 3000, `${days[0].distance} vs ${days[1].distance}`);
});

test('auto split prefers a campsite over a spring, takes a personal point at the aim; ignores far places', () => {
  const p = route(40);
  const mid = p[Math.floor(p.length / 2)];
  const near = { lon: p[Math.floor(p.length * 0.47)][0], lat: 33.0015, name: 'חניון', kind: 'camp', key: 'c1' };   // ~165 m off, 6 % early
  const spring = { lon: mid[0], lat: 33.0005, name: 'מעיין', kind: 'spring', key: 's1' };                       // at the aim
  const pers = { lon: mid[0], lat: 33.0005, name: 'שלי', kind: 'personal', key: 'pt:1' };
  const far = { lon: mid[0], lat: 33.01, name: 'רחוק', kind: 'camp', key: 'c2' };                               // ~1.1 km off
  const [l] = autoSplit(p, 2, [near, spring, far]);
  assert.equal(l.name, 'חניון');
  assert.deepEqual(l.source, { key: 'c1', kind: 'camp' });
  const [l2] = autoSplit(p, 2, [near, pers, far]);
  assert.equal(l2.name, 'שלי');
  const [l3] = autoSplit(p, 2, [far]);
  assert.equal(l3.source, null, 'nothing near: the lodging sits on the route');
  assert.equal(l3.name, '');
});

test('anchoring after a route edit: lodgings stay, boundaries follow, order is kept, far lodgings are measured', () => {
  const p = route(30);
  const l = autoSplit(p, 3);
  const edited = route(36);                                   // the route was extended by 6 km
  const a = anchorLodgings(edited, l);
  assert.ok(a[0].i < a[1].i && a.every((x) => x.offset < 15));
  const off = [{ ...l[0], lat: 33.007 }, l[1]];                // ~780 m north of the route
  const b = anchorLodgings(p, off);
  assert.ok(b[0].offset > 500 && b[0].offset < 900, `offset ${b[0].offset}`);
  // two lodgings dropped in reversed order still give boundaries in route order
  const c = anchorLodgings(p, [l[1], l[0]]);
  assert.ok(c[0].i < c[1].i);
});

test('day figures add up to the whole route', () => {
  const p = route(25, (d) => 400 + 150 * Math.sin(d / 2000));
  const days = dayStats(p, anchorLodgings(p, autoSplit(p, 3)));
  const sum = days.reduce((a, d) => a + d.distance, 0);
  assert.ok(Math.abs(sum - p.at(-1)[2]) < 1);
  assert.ok(days.every((d) => d.ascent >= 0 && d.descent >= 0));
});

test('snapping, suggestions, limits, colours, stored shape', () => {
  const c = [{ lon: 35.001, lat: 33, name: 'א', kind: 'camp' }, { lon: 35.0012, lat: 33, name: 'ב', kind: 'spring' }];
  assert.equal(snapTarget([35.0009, 33], c).name, 'א');
  assert.equal(snapTarget([35.01, 33], c), null);
  assert.ok(Math.abs(metres([35, 33], [35.001, 33]) - 93.3) < 1);
  assert.equal(suggestDays(route(10)), 2);
  assert.equal(suggestDays(route(80)), 4);
  assert.equal(maxDaysFor(route(0.1)), 2);
  assert.equal(dayColor(0), DAY_COLORS[0]);
  assert.equal(dayColor(DAY_COLORS.length), DAY_COLORS[0]);
  assert.equal(cleanSplit(null), null);
  assert.equal(cleanSplit({ version: 1, lodgings: [] }), null);
  assert.equal(cleanSplit({ version: 1, lodgings: [{ lon: 200, lat: 33 }] }), null);
  const s = cleanSplit({ version: 1, lodgings: [{ lon: 35, lat: 33, name: 'x', extra: 1 }] });
  assert.deepEqual(s, { version: 1, lodgings: [{ lon: 35, lat: 33, name: 'x', source: null, custom: false, manual: false }] });
  assert.deepEqual(splitSignature(s), [[35000000, 33000000, 'x']]);
  assert.equal(splitSignature(null), null);
});

const rec = (extra = {}) => {
  const p = route(12, (d) => 500 + d / 100);
  return { name: 'טרק', updatedAt: '2026-11-05T10:00:00.000Z', editor: { state: { waypoints: [{ id: 'w', lon: p[5][0], lat: 33, name: 'תצפית', icon: 'viewpoint' }] } },
    geometry: p.map((x) => [x[0], x[1]]), profile: p, ...extra };
};

test('GPX: a route without a split is exactly as before (one track)', () => {
  const g = routeToGpx(rec());
  assert.equal((g.match(/<trk>/g) || []).length, 1);
  assert.ok(!g.includes('lodging'));
  assert.equal(routeToGpx(rec({ daySplits: null })), g);
  assert.equal(routeToGpx(rec({ daySplits: { version: 9, lodgings: [] } })), g, 'an unusable split is ignored');
});

test('GPX with days: lodging waypoints + one track per day, joined at the boundary', () => {
  const r = rec();
  const lodgings = autoSplit(r.profile, 3).map((l, k) => ({ ...l, name: k ? '' : 'חניון "הר" & <נחל>' }));
  const g = routeToGpx({ ...r, daySplits: { version: 1, lodgings } });
  assert.equal((g.match(/<trk>/g) || []).length, 3);
  assert.ok(g.includes('<name>טרק – יום 1</name><number>1</number>'));
  assert.ok(g.includes('<name>חניון &quot;הר&quot; &amp; &lt;נחל&gt;</name><type>lodging</type>'));
  assert.ok(g.includes('<name>לינה 2</name><type>lodging</type>'));
  assert.ok(g.includes('<type>viewpoint</type>'), 'route marks kept');
  const tracks = g.split('<trk>').slice(1).map((s) => [...s.matchAll(/<trkpt lat="([\d.]+)" lon="([\d.]+)">/g)].map((m) => m[2]));
  assert.equal(tracks[0].at(-1), tracks[1][0], 'day 2 starts where day 1 ends');
  assert.equal(tracks.reduce((a, t) => a + t.length, 0), r.profile.length + 2);
  assert.ok(g.trim().endsWith('</gpx>'));
});
