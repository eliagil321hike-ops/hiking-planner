/**
 * Route editing state (SPEC §7, §8.2, §8.4, §9.3, §9.4). Pure TypeScript: no UI, no network.
 *
 * Model
 *  - vertices v0..vn: user control points, [lon, lat]; vertex i (i ≥ 1) carries `mode` = mode of the segment
 *    ENDING at it; v0.mode = null (SPEC §7).
 *  - segment i (1..n) connects v(i-1) → v(i). Its geometry is DERIVED: free → straight line; snap → the
 *    routed geometry from the segment cache, or a provisional straight line while pending/failed.
 *    A failed snapped segment is reported as `error` and stays snap: it is NEVER silently turned into a free
 *    segment (SPEC §8.2, §14 #7). The user can switch it to free explicitly.
 *  - waypoints: independent of segments.
 *
 * Commands (SPEC §9.3): every edit is a command with an exact inverse, kept on an undo stack (redo cleared on
 * a new command). No full-route snapshots per step.
 *
 * Segment cache (SPEC §9.3/9.4): routed geometries keyed by (from, to, mode, profile). Responses are applied
 * to the cache, never directly to a segment, so a late response cannot overwrite a newer edit: it only
 * renders if a segment with exactly that key still exists. Undo/redo re-uses cached geometry without new
 * routing requests.
 */

export type LonLat = readonly [number, number];
export type Mode = 'snap' | 'free';

export interface Vertex { lon: number; lat: number; mode: Mode | null }
export interface Waypoint { id: string; lon: number; lat: number; name: string; note: string }

export interface EditorState {
  vertices: readonly Vertex[];
  waypoints: readonly Waypoint[];
}

export type SegmentStatus = 'ok' | 'pending' | 'error';
export interface Segment {
  index: number;            // 1..n (segment ending at vertex `index`)
  mode: Mode;
  key: string;              // request key (from, to, mode, profile)
  status: SegmentStatus;    // free segments are always 'ok'
  error?: string;
  geometry: LonLat[];       // [lon, lat] coordinates; provisional straight line while pending/error
  provisional: boolean;
}

export interface Command {
  label: string;
  apply(s: EditorState): EditorState;
  invert(s: EditorState): EditorState;
}

const round = (x: number) => Math.round(x * 1e7) / 1e7;          // ~1 cm: stable cache keys
export const pointKey = (p: LonLat) => `${round(p[0])},${round(p[1])}`;
export const segmentKey = (from: LonLat, to: LonLat, mode: Mode, profile: string) =>
  `${pointKey(from)}>${pointKey(to)}|${mode}|${profile}`;

function checkLonLat(p: LonLat, what: string) {
  const [lon, lat] = p;
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || lon < -180 || lon > 180 || lat < -90 || lat > 90) {
    throw new RangeError(`${what}: invalid [lon, lat] ${JSON.stringify(p)}`);
  }
}

export const emptyState = (): EditorState => ({ vertices: [], waypoints: [] });

// ------------------------------------------------------------------ commands

export function addPoint(p: LonLat, mode: Mode): Command {
  checkLonLat(p, 'addPoint');
  return {
    label: 'add point',
    apply: (s) => ({ ...s, vertices: [...s.vertices, { lon: p[0], lat: p[1], mode: s.vertices.length ? mode : null }] }),
    invert: (s) => ({ ...s, vertices: s.vertices.slice(0, -1) }),
  };
}

export function movePoint(i: number, to: LonLat, current: EditorState): Command {
  checkLonLat(to, 'movePoint');
  const v = current.vertices[i];
  if (!v) throw new RangeError(`movePoint: no vertex ${i}`);
  const from: LonLat = [v.lon, v.lat];
  const set = (s: EditorState, q: LonLat) => ({
    ...s, vertices: s.vertices.map((x, k) => (k === i ? { ...x, lon: q[0], lat: q[1] } : x)),
  });
  return { label: 'move point', apply: (s) => set(s, to), invert: (s) => set(s, from) };
}

/** Insert a point into segment `segIndex` (between v(segIndex-1) and v(segIndex)); both halves keep its mode. */
export function insertPoint(segIndex: number, p: LonLat, current: EditorState): Command {
  checkLonLat(p, 'insertPoint');
  if (segIndex < 1 || segIndex >= current.vertices.length) throw new RangeError(`insertPoint: no segment ${segIndex}`);
  const mode = current.vertices[segIndex].mode as Mode;
  return {
    label: 'insert point',
    apply: (s) => ({ ...s, vertices: [...s.vertices.slice(0, segIndex), { lon: p[0], lat: p[1], mode }, ...s.vertices.slice(segIndex)] }),
    invert: (s) => ({ ...s, vertices: [...s.vertices.slice(0, segIndex), ...s.vertices.slice(segIndex + 1)] }),
  };
}

/** Delete vertex i. The two segments around it merge into one, with the mode of the segment after it. */
export function deletePoint(i: number, current: EditorState): Command {
  const vs = current.vertices;
  const v = vs[i];
  if (!v) throw new RangeError(`deletePoint: no vertex ${i}`);
  const next = vs[i + 1];
  return {
    label: 'delete point',
    apply: (s) => {
      const out = [...s.vertices.slice(0, i), ...s.vertices.slice(i + 1)];
      if (i === 0 && out.length) out[0] = { ...out[0], mode: null };   // new first vertex has no incoming segment
      return { ...s, vertices: out };
    },
    invert: (s) => {
      const out = [...s.vertices.slice(0, i), { ...v }, ...s.vertices.slice(i)];
      if (next) out[i + 1] = { ...out[i + 1], mode: next.mode };       // restore the original first vertex mode
      return { ...s, vertices: out };
    },
  };
}

export function setSegmentMode(segIndex: number, mode: Mode, current: EditorState): Command {
  const v = current.vertices[segIndex];
  if (!v || segIndex < 1) throw new RangeError(`setSegmentMode: no segment ${segIndex}`);
  const old = v.mode as Mode;
  const set = (s: EditorState, m: Mode) => ({ ...s, vertices: s.vertices.map((x, k) => (k === segIndex ? { ...x, mode: m } : x)) });
  return { label: 'segment mode', apply: (s) => set(s, mode), invert: (s) => set(s, old) };
}

/**
 * Reverse (SPEC §8.4): new order vn..v0; the new vertex at position j (j ≥ 1) gets the mode of the segment that
 * now connects it to its predecessor, i.e. the OLD segment between v(n-j) and v(n-j+1), whose mode is
 * old mode(n-j+1). (The §8.4 formula "mode_{n-j}" is off by one; its own parenthetical defines the rule used
 * here — DECISIONS D-025.) Waypoints keep their positions. Self-inverse. Cached geometries are reused reversed
 * by the editor (no new routing requests).
 */
export function reverseRoute(): Command {
  const rev = (s: EditorState): EditorState => {
    const v = s.vertices, n = v.length - 1;
    if (n < 1) return s;
    return {
      ...s,
      vertices: v.map((_, j) => ({ lon: v[n - j].lon, lat: v[n - j].lat, mode: j === 0 ? null : v[n - j + 1].mode })),
    };
  };
  return { label: 'reverse', apply: rev, invert: rev };
}

/** Close the loop: add a segment last → first. A no-op if the route is already closed (no duplicate). */
export function closeLoop(mode: Mode, current: EditorState): Command | null {
  const v = current.vertices;
  if (v.length < 2 || isClosed(current)) return null;
  return addPoint([v[0].lon, v[0].lat], mode);
}

export const isClosed = (s: EditorState) =>
  s.vertices.length > 2 && pointKey([s.vertices[0].lon, s.vertices[0].lat]) === pointKey([s.vertices.at(-1)!.lon, s.vertices.at(-1)!.lat]);

/** Clear the whole route (points and waypoints) as ONE undoable command. */
export function clearRoute(current: EditorState): Command | null {
  if (!current.vertices.length && !current.waypoints.length) return null;
  const before = current;
  return { label: 'clear', apply: (s) => ({ ...s, vertices: [], waypoints: [] }), invert: () => before };
}

export function addWaypoint(w: Waypoint): Command {
  checkLonLat([w.lon, w.lat], 'addWaypoint');
  return {
    label: 'add waypoint',
    apply: (s) => ({ ...s, waypoints: [...s.waypoints, { ...w }] }),
    invert: (s) => ({ ...s, waypoints: s.waypoints.filter((x) => x.id !== w.id) }),
  };
}

export function editWaypoint(id: string, patch: Partial<Omit<Waypoint, 'id'>>, current: EditorState): Command {
  const old = current.waypoints.find((x) => x.id === id);
  if (!old) throw new RangeError(`editWaypoint: no waypoint ${id}`);
  if (patch.lon !== undefined || patch.lat !== undefined) checkLonLat([patch.lon ?? old.lon, patch.lat ?? old.lat], 'editWaypoint');
  const set = (s: EditorState, w: Waypoint) => ({ ...s, waypoints: s.waypoints.map((x) => (x.id === id ? { ...w } : x)) });
  return { label: 'edit waypoint', apply: (s) => set(s, { ...old, ...patch }), invert: (s) => set(s, old) };
}

export function deleteWaypoint(id: string, current: EditorState): Command {
  const idx = current.waypoints.findIndex((x) => x.id === id);
  if (idx < 0) throw new RangeError(`deleteWaypoint: no waypoint ${id}`);
  const old = current.waypoints[idx];
  return {
    label: 'delete waypoint',
    apply: (s) => ({ ...s, waypoints: s.waypoints.filter((x) => x.id !== id) }),
    invert: (s) => ({ ...s, waypoints: [...s.waypoints.slice(0, idx), { ...old }, ...s.waypoints.slice(idx)] }),
  };
}

// ------------------------------------------------------------------ editor (state + history + cache)

export interface RouteResult { geometry?: LonLat[]; error?: string }

export class RouteEditor {
  state: EditorState;
  readonly profile: string;
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private cache = new Map<string, RouteResult>();
  private listeners = new Set<() => void>();

  constructor(profile = 'hiking', initial: EditorState = emptyState()) {
    this.profile = profile;
    this.state = initial;
  }

  onChange(fn: () => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private emit() { for (const f of this.listeners) f(); }

  run(cmd: Command | null) {
    if (!cmd) return false;
    this.state = cmd.apply(this.state);
    this.undoStack.push(cmd);
    this.redoStack = [];
    if (cmd.label === 'reverse') this.cacheReversed();
    this.emit();
    return true;
  }
  undo() {
    const c = this.undoStack.pop();
    if (!c) return false;
    this.state = c.invert(this.state);
    this.redoStack.push(c);
    if (c.label === 'reverse') this.cacheReversed();
    this.emit();
    return true;
  }
  redo() {
    const c = this.redoStack.pop();
    if (!c) return false;
    this.state = c.apply(this.state);
    this.undoStack.push(c);
    if (c.label === 'reverse') this.cacheReversed();
    this.emit();
    return true;
  }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  /** Replace the whole state (e.g. restore a draft). Clears history. */
  load(state: EditorState, cache: Record<string, RouteResult> = {}) {
    this.state = state;
    this.undoStack = [];
    this.redoStack = [];
    for (const [k, v] of Object.entries(cache)) this.cache.set(k, v);
    this.emit();
  }

  // --- segments
  segments(): Segment[] {
    const v = this.state.vertices;
    const out: Segment[] = [];
    for (let i = 1; i < v.length; i++) {
      const a: LonLat = [v[i - 1].lon, v[i - 1].lat], b: LonLat = [v[i].lon, v[i].lat];
      const mode = v[i].mode as Mode;
      const key = segmentKey(a, b, mode, this.profile);
      if (mode === 'free') { out.push({ index: i, mode, key, status: 'ok', geometry: [a, b], provisional: false }); continue; }
      const hit = this.cache.get(key);
      if (hit?.geometry) out.push({ index: i, mode, key, status: 'ok', geometry: withEnds(hit.geometry, a, b), provisional: false });
      else out.push({ index: i, mode, key, status: hit?.error ? 'error' : 'pending', error: hit?.error, geometry: [a, b], provisional: true });
    }
    return out;
  }

  /** Snap segments that still need a routing request: [key, from, to]. */
  pendingRequests(): Array<{ key: string; from: LonLat; to: LonLat }> {
    return this.segments().filter((s) => s.mode === 'snap' && s.status === 'pending')
      .map((s) => ({ key: s.key, from: s.geometry[0], to: s.geometry.at(-1)! }));
  }

  /**
   * Store a routing response. Applied only through the cache, so a response for a segment that no longer
   * exists is kept (useful after undo) but not rendered. Returns true if a current segment uses it.
   */
  applyRouteResult(key: string, result: RouteResult) {
    if (result.geometry) result.geometry.forEach((p, k) => checkLonLat(p, `route result[${k}]`));
    this.cache.set(key, result);
    const used = this.segments().some((s) => s.key === key);
    if (used) this.emit();
    return used;
  }

  /** Allow a failed snap request to be retried. */
  clearRouteError(key: string) {
    if (this.cache.get(key)?.error) { this.cache.delete(key); this.emit(); }
  }

  /** Full route geometry: concatenated segments without duplicated joints (SPEC §7). */
  geometry(): LonLat[] {
    const v = this.state.vertices;
    if (v.length === 0) return [];
    if (v.length === 1) return [[v[0].lon, v[0].lat]];
    const out: LonLat[] = [];
    for (const s of this.segments()) out.push(...(out.length ? s.geometry.slice(1) : s.geometry));
    return out;
  }

  /** Serializable draft: state + cached routed geometries used by current segments. */
  toDraft() {
    const used: Record<string, RouteResult> = {};
    for (const s of this.segments()) {
      const hit = this.cache.get(s.key);
      if (s.mode === 'snap' && hit?.geometry) used[s.key] = { geometry: hit.geometry };
    }
    return { version: 1, profile: this.profile, state: this.state, cache: used };
  }

  private cacheReversed() {
    // After a reverse, segments run the other way: reuse cached geometry reversed (no new requests).
    for (const [key, val] of [...this.cache]) {
      if (!val.geometry) continue;
      const m = key.match(/^([^>]+)>([^|]+)\|(\w+)\|(.+)$/);
      if (!m) continue;
      const rkey = `${m[2]}>${m[1]}|${m[3]}|${m[4]}`;
      if (!this.cache.has(rkey)) this.cache.set(rkey, { geometry: [...val.geometry].reverse() });
    }
  }
}

/** Make sure a routed geometry starts and ends exactly at the control points (routers snap to the network). */
function withEnds(g: LonLat[], a: LonLat, b: LonLat): LonLat[] {
  if (g.length === 0) return [a, b];
  const out = [...g];
  // Same point within key precision (~1 cm): use the exact control point; otherwise connect to it.
  if (pointKey(out[0]) === pointKey(a)) out[0] = a; else out.unshift(a);
  if (pointKey(out.at(-1)!) === pointKey(b)) out[out.length - 1] = b; else out.push(b);
  return out;
}
