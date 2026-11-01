import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RouteEditor, addPoint, movePoint, insertPoint, deletePoint, setSegmentMode, reverseRoute, closeLoop,
  addWaypoint, editWaypoint, deleteWaypoint, isClosed, segmentKey, type LonLat, type Mode,
} from '../src/editor.ts';

const P = (i: number): LonLat => [35.4 + i * 0.001, 33.0 + (i % 3) * 0.0005];
const modes = (e: RouteEditor) => e.state.vertices.map((v) => v.mode);
const coords = (e: RouteEditor) => e.state.vertices.map((v) => [v.lon, v.lat]);
const snapshot = (e: RouteEditor) => JSON.stringify(e.state);

function build(ms: Mode[]) {
  const e = new RouteEditor();
  e.run(addPoint(P(0), 'free'));
  ms.forEach((m, i) => e.run(addPoint(P(i + 1), m)));
  return e;
}

test('vertex 0 has mode null; mode describes the segment ending at the vertex', () => {
  const e = build(['snap', 'free']);
  assert.deepEqual(modes(e), [null, 'snap', 'free']);
  const segs = e.segments();
  assert.equal(segs.length, 2);
  assert.equal(segs[0].mode, 'snap');
  assert.equal(segs[1].mode, 'free');
});

test('coordinates are [lon, lat]; invalid points are rejected', () => {
  assert.throws(() => addPoint([200, 10], 'free'), RangeError);
  assert.throws(() => addPoint([35, 95], 'free'), RangeError);
  const e = build(['free']);
  assert.deepEqual(coords(e)[0], [35.4, 33.0]);
});

test('free segments are straight; snap segments are pending with a provisional line', () => {
  const e = build(['free', 'snap']);
  const [a, b] = e.segments();
  assert.equal(a.status, 'ok'); assert.equal(a.provisional, false); assert.equal(a.geometry.length, 2);
  assert.equal(b.status, 'pending'); assert.equal(b.provisional, true);
  assert.equal(e.pendingRequests().length, 1);
});

test('routing result replaces the provisional line; ends pinned to the control points', () => {
  const e = build(['snap']);
  const [req] = e.pendingRequests();
  const mid: LonLat = [35.4005, 33.0009];
  e.applyRouteResult(req.key, { geometry: [[35.40001, 33.0], mid, [35.401, 33.0005]] });
  const s = e.segments()[0];
  assert.equal(s.status, 'ok');
  assert.deepEqual(s.geometry[0], P(0), 'starts at the control point');
  assert.deepEqual(s.geometry.at(-1), P(1), 'ends at the control point');
  assert.ok(s.geometry.some((p) => p[0] === mid[0] && p[1] === mid[1]));
  assert.equal(e.pendingRequests().length, 0);
});

test('routing failure NEVER silently becomes a free straight segment', () => {
  const e = build(['snap']);
  const [req] = e.pendingRequests();
  e.applyRouteResult(req.key, { error: 'NO_PATH' });
  const s = e.segments()[0];
  assert.equal(s.mode, 'snap', 'still snap');
  assert.equal(s.status, 'error');
  assert.equal(s.error, 'NO_PATH');
  assert.equal(s.provisional, true, 'only a provisional line is shown');
  assert.equal(e.pendingRequests().length, 0, 'not re-requested in a loop');
  // explicit user choice
  e.run(setSegmentMode(1, 'free', e.state));
  assert.equal(e.segments()[0].status, 'ok');
  assert.equal(e.segments()[0].mode, 'free');
});

test('late response cannot overwrite a newer edit (stale-response guard)', () => {
  const e = build(['snap']);
  const [old] = e.pendingRequests();
  e.run(movePoint(1, [35.402, 33.001], e.state));          // user edits before the response arrives
  const [fresh] = e.pendingRequests();
  assert.notEqual(old.key, fresh.key);
  const used = e.applyRouteResult(old.key, { geometry: [P(0), [35.5, 33.5], P(1)] });   // late, stale
  assert.equal(used, false, 'stale response not rendered');
  assert.equal(e.segments()[0].status, 'pending');
  assert.ok(!e.segments()[0].geometry.some((p) => p[0] === 35.5), 'stale geometry not shown');
  // ...but it is cached: undoing the move shows it without a new request
  e.undo();
  assert.equal(e.segments()[0].status, 'ok');
  assert.equal(e.pendingRequests().length, 0);
});

test('undo/redo restore exact prior states over every command type', () => {
  const e = build(['snap', 'free', 'snap']);
  const states: string[] = [snapshot(e)];
  const steps = [
    () => e.run(movePoint(2, [35.41, 33.01], e.state)),
    () => e.run(insertPoint(2, [35.405, 33.002], e.state)),
    () => e.run(deletePoint(1, e.state)),
    () => e.run(setSegmentMode(1, 'free', e.state)),
    () => e.run(reverseRoute()),
    () => e.run(closeLoop('snap', e.state)),
    () => e.run(addWaypoint({ id: 'w1', lon: 35.403, lat: 33.0, name: 'מעיין', note: '' })),
    () => e.run(editWaypoint('w1', { name: 'עין', note: 'מים' }, e.state)),
    () => e.run(deleteWaypoint('w1', e.state)),
    () => e.run(deletePoint(0, e.state)),
  ];
  for (const s of steps) { assert.ok(s()); states.push(snapshot(e)); }
  for (let i = states.length - 2; i >= 0; i--) { assert.ok(e.undo()); assert.equal(snapshot(e), states[i], `undo to state ${i}`); }
  // (the 4 addPoint commands that built the route are still on the undo stack, as they should be)
  for (let i = 1; i < states.length; i++) { assert.ok(e.redo()); assert.equal(snapshot(e), states[i], `redo to state ${i}`); }
  assert.equal(e.redo(), false);
});

test('a new command clears the redo stack', () => {
  const e = build(['free']);
  e.undo();
  assert.ok(e.canRedo);
  e.run(addPoint(P(5), 'free'));
  assert.equal(e.canRedo, false);
});

test('reverse with mixed snap/free modes: exact §8.4 semantics (D-025)', () => {
  // v0..v4 with modes [_, snap, free, free, snap]
  const e = build(['snap', 'free', 'free', 'snap']);
  const before = e.segments().map((s) => ({ from: s.geometry[0], to: s.geometry.at(-1), mode: s.mode }));
  e.run(reverseRoute());
  assert.deepEqual(coords(e), [P(4), P(3), P(2), P(1), P(0)].map((p) => [...p]));
  assert.deepEqual(modes(e), [null, 'snap', 'free', 'free', 'snap']);
  // every reversed segment keeps the mode of the same physical segment
  const after = e.segments();
  for (const s of after) {
    const twin = before.find((b) => b.from === undefined ? false : JSON.stringify(b.from) === JSON.stringify(s.geometry.at(-1)) && JSON.stringify(b.to) === JSON.stringify(s.geometry[0]));
    assert.ok(twin, 'same physical segment exists');
    assert.equal(s.mode, twin!.mode, 'mode preserved for the same physical segment');
  }
  // an asymmetric case where the literal "mode_{n-j}" formula would differ
  const f = build(['snap', 'free']);           // [_, snap, free]
  f.run(reverseRoute());
  assert.deepEqual(modes(f), [null, 'free', 'snap'], 'v2→v1 was free, v1→v0 was snap');
  // waypoints untouched
  const g = build(['free']);
  g.run(addWaypoint({ id: 'a', lon: 35.4, lat: 33.0, name: 'x', note: '' }));
  const wp = JSON.stringify(g.state.waypoints);
  g.run(reverseRoute());
  assert.equal(JSON.stringify(g.state.waypoints), wp);
});

test('reverse reuses routed geometry reversed, without new requests', () => {
  const e = build(['snap']);
  const [req] = e.pendingRequests();
  e.applyRouteResult(req.key, { geometry: [P(0), [35.4005, 33.0009], P(1)] });
  e.run(reverseRoute());
  assert.equal(e.pendingRequests().length, 0, 'no new routing request');
  const s = e.segments()[0];
  assert.equal(s.status, 'ok');
  assert.deepEqual(s.geometry, [P(1), [35.4005, 33.0009], P(0)]);
});

test('close loop adds one segment back to the start; invoking again adds nothing', () => {
  const e = build(['free', 'free']);
  assert.ok(e.run(closeLoop('snap', e.state)));
  assert.ok(isClosed(e.state));
  assert.equal(e.state.vertices.length, 4);
  assert.equal(e.state.vertices.at(-1)!.mode, 'snap');
  assert.equal(e.run(closeLoop('snap', e.state)), false, 'no duplicate');
  assert.equal(e.state.vertices.length, 4);
});

test('delete merges neighbours: the merged segment keeps the mode of the segment after the point', () => {
  const e = build(['snap', 'free']);
  e.run(deletePoint(1, e.state));
  assert.deepEqual(modes(e), [null, 'free']);
  e.undo();
  assert.deepEqual(modes(e), [null, 'snap', 'free']);
  e.run(deletePoint(0, e.state));
  assert.deepEqual(modes(e), [null, 'free'], 'new first vertex has mode null');
  e.undo();
  assert.deepEqual(modes(e), [null, 'snap', 'free'], 'original mode restored');
});

test('insert into a segment: both halves keep its mode', () => {
  const e = build(['snap']);
  e.run(insertPoint(1, [35.4005, 33.0002], e.state));
  assert.deepEqual(modes(e), [null, 'snap', 'snap']);
  assert.throws(() => insertPoint(5, P(1), e.state), RangeError);
});

test('a 20-point route with snapped and free segments can be built and edited', () => {
  const ms: Mode[] = Array.from({ length: 19 }, (_, i) => (i % 3 === 0 ? 'free' : 'snap'));
  const e = build(ms);
  assert.equal(e.state.vertices.length, 20);
  assert.equal(e.segments().length, 19);
  for (const r of e.pendingRequests()) e.applyRouteResult(r.key, { geometry: [r.from, r.to] });
  assert.equal(e.segments().filter((s) => s.status !== 'ok').length, 0);
  e.run(movePoint(10, [35.5, 33.1], e.state));
  e.run(deletePoint(5, e.state));
  e.run(insertPoint(3, [35.4025, 33.0004], e.state));
  e.run(reverseRoute());
  assert.equal(e.state.vertices.length, 20);
  // only the segments touching the edited points need routing again
  const pending = e.pendingRequests().length;
  assert.ok(pending > 0 && pending <= 6, `pending ${pending}`);
});

test('full geometry concatenates segments without duplicated joints', () => {
  const e = build(['free', 'free']);
  assert.deepEqual(e.geometry(), [P(0), P(1), P(2)]);
});

test('draft round-trip keeps vertices, modes, waypoints and routed geometry', () => {
  const e = build(['snap', 'free']);
  const [req] = e.pendingRequests();
  e.applyRouteResult(req.key, { geometry: [P(0), [35.4005, 33.0009], P(1)] });
  e.run(addWaypoint({ id: 'w', lon: 35.4, lat: 33.0, name: 'חניה', note: '' }));
  const draft = JSON.parse(JSON.stringify(e.toDraft()));
  const f = new RouteEditor(draft.profile);
  f.load(draft.state, draft.cache);
  assert.equal(snapshot(f), snapshot(e));
  assert.equal(f.pendingRequests().length, 0, 'routed segment restored without a new request');
  assert.deepEqual(f.geometry(), e.geometry());
});

test('segment key separates direction, mode and profile', () => {
  const a: LonLat = [35, 33], b: LonLat = [35.1, 33.1];
  assert.notEqual(segmentKey(a, b, 'snap', 'hiking'), segmentKey(b, a, 'snap', 'hiking'));
  assert.notEqual(segmentKey(a, b, 'snap', 'hiking'), segmentKey(a, b, 'free', 'hiking'));
  assert.notEqual(segmentKey(a, b, 'snap', 'hiking'), segmentKey(a, b, 'snap', 'foot'));
});
