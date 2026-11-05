// Day split (D-065): the pure part — no map, no DOM. Unit-tested (tests/days.test.mjs).
//
// A split is stored with the route as { version: 1, lodgings: [{ lon, lat, name, source, custom, manual }] }:
// N days = N − 1 lodgings. Lodgings keep their own place on the map; the day boundary is the route point nearest
// to the lodging, searched in order along the route (so an edited route never mixes the days up). A lodging may
// be off the route: it is joined to its boundary by a dashed line that is not counted in any distance.
//
// Owner decisions (2026-11-05): no times of any kind (walking time, hours, dates, sun); balance the days by
// distance + ascent, where every 100 m of ascent counts as 1 km; prefer ending a day near a campsite, a spring /
// water point, a shelter or one of the owner's personal points.

import { computeElevationStats } from './vendor/geo/index.js';

export const SPLIT_VERSION = 1;
export const ASCENT_PER_KM = 100;          // 100 m of ascent counts as 1 km of distance
export const SNAP_M = 150;                 // dragging a lodging this close to a known place snaps it there
export const CANDIDATE_M = 300;            // auto split looks for places this close to the route
export const FAR_M = 500;                  // a lodging further than this from its boundary gets a note
export const CONNECT_M = 25;               // beyond this a dashed line joins a lodging to the route
export const MIN_DAYS = 2, MAX_DAYS = 14;
// Day colours (the only new palette): mid-tone, distinct from each other, from the personal-point crimson and
// from the brand turquoise; drawn over the route's dark casing so they read on topo and satellite alike.
export const DAY_COLORS = ['#2F7FD8', '#E8892B', '#9A5BD3', '#3E9E4F', '#D9A90F', '#D2559A', '#4B5FD1', '#8C6D3F'];
export const dayColor = (i) => DAY_COLORS[i % DAY_COLORS.length];
// how much a kind of place is preferred as a lodging (0 = best)
// (a campsite is a place to sleep; a spring or a tap only helps, so they count as a little further away)
const KIND_COST = { camp: 0, personal: 0.05, shelter: 0.15, spring: 0.3, water: 0.3 };
export const LODGING_KINDS = Object.keys(KIND_COST).filter((k) => k !== 'personal');

const R = 6371008.8, rad = Math.PI / 180;
/** Fast distance in metres (equirectangular; good to well under 1 % at hiking scales). */
export function metres(a, b) {
  const x = (b[0] - a[0]) * rad * Math.cos(((a[1] + b[1]) / 2) * rad), y = (b[1] - a[1]) * rad;
  return Math.hypot(x, y) * R;
}

/** Cumulative effort (km-equivalent) at every profile sample: distance + ascent / ASCENT_PER_KM. */
export function effortSeries(profile) {
  const st = computeElevationStats(profile.map((p) => p[3]), { stepM: 20 });
  const e = st.smoothed;
  const out = new Array(profile.length);
  let up = 0, anchor = null;
  for (let i = 0; i < profile.length; i++) {
    const v = e[i];
    if (v === null || v === undefined) anchor = null;           // a gap restarts, like the route figures
    else if (anchor === null) anchor = v;
    else if (v - anchor >= 3) { up += v - anchor; anchor = v; }
    else if (anchor - v >= 3) anchor = v;
    out[i] = profile[i][2] / 1000 + up / ASCENT_PER_KM;
  }
  return out;
}

/** Nearest profile sample to a point among indices [i0, i1]. */
export function nearestIndex(profile, pt, i0 = 0, i1 = profile.length - 1) {
  let best = i0, bd = Infinity;
  for (let i = Math.max(0, i0); i <= Math.min(profile.length - 1, i1); i++) {
    const d = metres(pt, profile[i]);
    if (d < bd) { bd = d; best = i; }
  }
  return { i: best, offset: bd };
}

/**
 * Day boundaries for the lodgings, in order along the route: each one is searched after the previous one and
 * before the room the later ones need. Returns [{ i, offset }] (offset = metres from lodging to its boundary).
 */
export function anchorLodgings(profile, lodgings) {
  const n = profile.length, out = [];
  let prev = 0;
  lodgings.forEach((l, k) => {
    const left = lodgings.length - k - 1;
    const lo = Math.min(prev + 1, n - 2), hi = Math.max(lo, n - 2 - left);
    const b = nearestIndex(profile, [l.lon, l.lat], lo, hi);
    out.push(b);
    prev = b.i;
  });
  return out;
}

/** Figures of each day: distance, ascent, descent (same method as the route figures). */
export function dayStats(profile, boundaries) {
  const cuts = [0, ...boundaries.map((b) => b.i), profile.length - 1];
  const days = [];
  for (let k = 0; k < cuts.length - 1; k++) {
    const a = cuts[k], b = cuts[k + 1];
    const slice = profile.slice(a, b + 1);
    const st = slice.length > 1 ? computeElevationStats(slice.map((p) => p[3]), { stepM: 20 }) : { ascent: 0, descent: 0 };
    days.push({ from: a, to: b, distance: profile[b][2] - profile[a][2], ascent: st.ascent, descent: st.descent });
  }
  return days;
}

/** A sensible number of days for a route: about 20 km of effort per day, at least 2. */
export function suggestDays(profile) {
  const e = effortSeries(profile).at(-1) ?? 0;
  return Math.max(MIN_DAYS, Math.min(MAX_DAYS, Math.round(e / 20)));
}

/** Largest number of days a route can take (each day needs some route under it). */
export const maxDaysFor = (profile) => Math.max(MIN_DAYS, Math.min(MAX_DAYS, Math.floor((profile.length - 1) / 3)));

/**
 * Automatic split into n days. Each boundary aims at an equal share of the effort; within ±15 % of a day's share
 * a known place near the route (≤ CANDIDATE_M) wins, the closer to the aim, to the route and the better its kind
 * (campsite first). Otherwise the boundary is the route point at the aim and the lodging sits on the route.
 * candidates: [{ lon, lat, name, kind, key }].
 */
export function autoSplit(profile, n, candidates = []) {
  const eff = effortSeries(profile), total = eff.at(-1), share = total / n, tol = share * 0.15;
  const near = candidates.map((c) => ({ c, ...nearestIndex(profile, [c.lon, c.lat]) })).filter((x) => x.offset <= CANDIDATE_M);
  const lodgings = [];
  let prev = 0;
  for (let k = 1; k < n; k++) {
    const aim = share * k;
    const last = profile.length - 2 - (n - 1 - k);
    let ideal = prev + 1;
    while (ideal < last && eff[ideal] < aim) ideal++;
    let best = null, bestScore = Infinity;
    for (const x of near) {
      if (x.i <= prev || x.i > last || Math.abs(eff[x.i] - aim) > tol) continue;
      const score = Math.abs(eff[x.i] - aim) / share + x.offset / 1000 + (KIND_COST[x.c.kind] ?? 0.2);
      if (score < bestScore) { bestScore = score; best = x; }
    }
    if (best) {
      lodgings.push({ lon: best.c.lon, lat: best.c.lat, name: best.c.name || '', source: { key: best.c.key ?? null, kind: best.c.kind }, custom: false, manual: false });
      prev = best.i;
    } else {
      const p = profile[ideal];
      lodgings.push({ lon: p[0], lat: p[1], name: '', source: null, custom: false, manual: false });
      prev = ideal;
    }
  }
  return lodgings;
}

/** The known place within SNAP_M of a point, if any (the nearest). */
export function snapTarget(pt, candidates, within = SNAP_M) {
  let best = null, bd = within;
  for (const c of candidates) { const d = metres(pt, [c.lon, c.lat]); if (d <= bd) { bd = d; best = c; } }
  return best;
}

/** A stored split, checked: null when it is not usable (wrong shape, too few or too many days). */
export function cleanSplit(s) {
  if (!s || s.version !== SPLIT_VERSION || !Array.isArray(s.lodgings)) return null;
  if (s.lodgings.length < MIN_DAYS - 1 || s.lodgings.length > MAX_DAYS - 1) return null;
  if (!s.lodgings.every((l) => Number.isFinite(l.lon) && Number.isFinite(l.lat) && Math.abs(l.lon) <= 180 && Math.abs(l.lat) <= 90)) return null;
  return {
    version: SPLIT_VERSION,
    lodgings: s.lodgings.map((l) => ({ lon: l.lon, lat: l.lat, name: String(l.name ?? '').slice(0, 80), source: l.source ?? null, custom: !!l.custom, manual: !!l.manual })),
  };
}

/** What makes a split different for "saved / changed" (positions rounded so re-reading does not count). */
export const splitSignature = (s) => (s ? s.lodgings.map((l) => [Math.round(l.lon * 1e6), Math.round(l.lat * 1e6), l.name]) : null);
