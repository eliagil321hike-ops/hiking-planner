// D-069 (owner, 2026-11-09): in 3D the route looked smeared and far too wide. With terrain on, MapLibre drapes
// line layers on the ground (rendered into the terrain's textures), so a tilted camera magnifies the line near
// the bottom of the screen and softens its edges. The planned route and the day colours are therefore drawn
// thinner while 3D is on; 2D keeps the original widths. Only the widths change; colours and order stay.

/** Layers drawn thinner in 3D: the planned route (casing, line, provisional segments, day colours) and the trail
 *  lines, all by the same factor, so the planned route stays the widest line as in 2D (D-043). */
export const THIN_IN_3D = ['route-casing', 'route-line', 'route-provisional', 'days-line',
  'topo-hike-casing', 'topo-hike-line', 'topo-marked-casing', 'topo-marked-line',
  'topo-trails-casing', 'topo-trails-track', 'topo-trails-track-inner', 'topo-trails-path', 'topo-trails-footway'];
/** Width factor in 3D. */
export const FACTOR_3D = 0.5;

/** Multiplies a line-width value by k: a number, a zoom `interpolate` / `step`, or a `match` / `case` on data –
 *  only the output numbers change, so the expression keeps its shape. */
export function scaleWidth(value, k) {
  if (typeof value === 'number') return Math.round(value * k * 100) / 100;
  if (!Array.isArray(value)) return value;
  const [op] = value;
  if (op === 'interpolate') {          // ['interpolate', type, input, z0, w0, z1, w1, …]
    return value.map((v, i) => (i >= 4 && (i - 4) % 2 === 0 ? scaleWidth(v, k) : v));
  }
  if (op === 'step') {                 // ['step', input, w0, z1, w1, …]
    return value.map((v, i) => (i >= 2 && i % 2 === 0 ? scaleWidth(v, k) : v));
  }
  if (op === 'match') {                // ['match', input, label, out, …, fallback]
    return value.map((v, i) => (i >= 3 && (i % 2 === 1 || i === value.length - 1) ? scaleWidth(v, k) : v));
  }
  if (op === 'case') {                 // ['case', cond, out, …, fallback]
    return value.map((v, i) => (i >= 2 && (i % 2 === 0 || i === value.length - 1) ? scaleWidth(v, k) : v));
  }
  return ['*', k, value];              // any other data expression
}

/** Keeps the listed layers at their 2D width, or thinner while terrain (3D) is on. Re-applied after style changes. */
export function installThin3d(map, ids = THIN_IN_3D, k = FACTOR_3D) {
  const base = new Map(), applied = new Map();
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  function sync() {
    const on = !!map.getTerrain?.();
    for (const id of ids) {
      if (!map.getLayer(id)) { applied.delete(id); continue; }
      const cur = map.getPaintProperty(id, 'line-width');
      if (!applied.has(id) || !same(cur, applied.get(id))) base.set(id, cur);   // new layer or set elsewhere
      const want = on ? scaleWidth(base.get(id), k) : base.get(id);
      applied.set(id, want);
      if (!same(cur, want)) map.setPaintProperty(id, 'line-width', want);
    }
  }
  map.on('terrain', sync);
  map.on('styledata', sync);
  sync();
  return sync;
}
