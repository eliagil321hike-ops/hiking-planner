// Day split (D-065): the elevation graph coloured by day, with a handle on every boundary between days. Dragging a
// handle moves that day boundary along the route (the lodging follows). Drawn like the route graph (profile.js):
// same axes, grid, fonts and hover readout; only the day colours are new.

import { elevationTicks } from './profile.js';

const NS = 'http://www.w3.org/2000/svg';
function el(name, attrs = {}, text) {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (text !== undefined) n.textContent = text;
  return n;
}

/**
 * profile: [[lon, lat, distance m, elevation m | null]] · cuts: [0, b1, …, last] sample indices · colors(k) ·
 * opts: { sel: day index | null, label(k) → text of boundary k, onDrag(k, i, done), onHover(i | null) }
 */
export function renderDaysProfile(container, profile, cuts, colors, opts = {}) {
  container.innerHTML = '';
  if (!profile || profile.length < 2) return;
  const sel = opts.sel ?? null;
  const i0 = sel === null ? 0 : cuts[sel], i1 = sel === null ? profile.length - 1 : cuts[sel + 1];
  const W = container.clientWidth || 600, H = container.clientHeight || 150;
  const pad = { l: 40, r: 14, t: 26, b: 18 };
  const d0 = profile[i0][2], d1 = profile[i1][2], span = Math.max(1, d1 - d0);
  const vals = profile.slice(i0, i1 + 1).map((p) => p[3]).filter((v) => v !== null && Number.isFinite(v));
  if (vals.length < 2) { container.textContent = '—'; return; }
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi - lo < 20) { const m = (hi + lo) / 2; lo = m - 10; hi = m + 10; }
  const yLo = lo - (hi - lo) * 0.04, yHi = hi + (hi - lo) * 0.06;
  const x = (d) => pad.l + ((d - d0) / span) * (W - pad.l - pad.r);
  const y = (e) => pad.t + (1 - (e - yLo) / (yHi - yLo)) * (H - pad.t - pad.b);
  const baseY = H - pad.b;
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Elevation profile by day' });
  container.append(svg);

  // grid + axes (as profile.js)
  for (const v of elevationTicks(yLo, yHi)) {
    svg.append(el('text', { x: pad.l - 6, y: y(v) + 3.5, 'text-anchor': 'end', class: 'profile-axis' }, `${v}`));
    svg.append(el('line', { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), class: 'profile-grid profile-grid-h' }));
  }
  svg.append(el('text', { x: pad.l - 6, y: pad.t - 8, 'text-anchor': 'end', class: 'profile-axis' }, 'm'));
  const km = span / 1000, step = [0.25, 0.5, 1, 2, 5, 10, 20, 50].find((s) => km / s <= 7) ?? 100;
  const endX = x(d1);
  for (let k = Math.ceil(d0 / 1000 / step) * step; k * 1000 < d1; k += step) {
    const gx = x(k * 1000);
    if (gx - x(d0) < 20 || endX - gx < 48) continue;
    svg.append(el('line', { x1: gx, x2: gx, y1: pad.t, y2: baseY, class: 'profile-grid' }));
    svg.append(el('text', { x: gx, y: H - 4, 'text-anchor': 'middle', class: 'profile-axis' }, `${+k.toFixed(2)}`));
  }
  const fmtKm = (m) => `${(m / 1000).toFixed(m < 10_000 ? 2 : 1)} km`;
  svg.append(el('text', { x: pad.l, y: H - 4, 'text-anchor': 'middle', class: 'profile-axis' }, sel === null ? '0' : `${+(d0 / 1000).toFixed(1)}`));
  svg.append(el('text', { x: endX, y: H - 4, 'text-anchor': 'end', class: 'profile-axis profile-strong' }, fmtKm(d1)));

  // one area + line per day (gaps in elevation stay gaps)
  const days = sel === null ? cuts.slice(0, -1).map((_, k) => k) : [sel];
  for (const k of days) {
    const a = cuts[k], b = cuts[k + 1];
    let area = '', line = '', run = [];
    const flush = () => {
      if (run.length > 1) {
        area += `M${x(run[0][2]).toFixed(1)},${baseY}` + run.map((p) => `L${x(p[2]).toFixed(1)},${y(p[3]).toFixed(1)}`).join('') + `L${x(run.at(-1)[2]).toFixed(1)},${baseY}Z`;
        line += run.map((p, j) => `${j ? 'L' : 'M'}${x(p[2]).toFixed(1)},${y(p[3]).toFixed(1)}`).join('');
      }
      run = [];
    };
    for (let i = a; i <= b; i++) { const p = profile[i]; if (p[3] === null) flush(); else run.push(p); }
    flush();
    svg.append(el('path', { d: area, class: 'dp-area', fill: colors(k) }));
    svg.append(el('path', { d: line, class: 'dp-line', stroke: colors(k) }));
  }

  // boundaries with handles (whole-trek view only)
  if (sel === null) {
    for (let k = 1; k < cuts.length - 1; k++) {
      const bx = x(profile[cuts[k]][2]);
      const g = el('g', { 'data-k': k });
      g.append(el('line', { x1: bx, x2: bx, y1: pad.t - 4, y2: baseY, class: 'dp-bound' }));
      g.append(el('rect', { x: bx - 5, y: pad.t - 14, width: 10, height: 16, rx: 3, class: 'dp-handle' }));
      g.append(el('path', { d: `M${bx - 1.5} ${pad.t - 10}v8M${bx + 1.5} ${pad.t - 10}v8`, class: 'dp-grip' }));
      const lab = opts.label?.(k) ?? '';
      if (lab) g.append(el('text', { x: bx + (bx > W - 120 ? -9 : 9), y: pad.t - 3, 'text-anchor': bx > W - 120 ? 'end' : 'start', class: 'dp-label' }, lab));
      const hit = el('rect', { x: bx - 11, y: pad.t - 16, width: 22, height: baseY - pad.t + 16, class: 'dp-hit', 'data-k': k });
      hit.setAttribute('aria-label', lab);
      g.append(hit);
      svg.append(g);
    }
  }

  // hover readout (as profile.js)
  const cursor = el('line', { class: 'profile-cursor', y1: pad.t, y2: baseY });
  const readout = el('text', { class: 'profile-readout', y: pad.t + 11 });
  for (const n of [cursor, readout]) n.style.display = 'none';
  svg.append(cursor, readout);
  const indexAt = (clientX) => {
    const r = container.getBoundingClientRect();   // the container stays while the graph is redrawn during a drag
    const d = d0 + Math.max(0, Math.min(1, ((clientX - r.left) / r.width * W - pad.l) / (W - pad.l - pad.r))) * span;
    let lo2 = i0, hi2 = i1;
    while (hi2 - lo2 > 1) { const m = (lo2 + hi2) >> 1; if (profile[m][2] < d) lo2 = m; else hi2 = m; }
    return Math.abs(profile[lo2][2] - d) <= Math.abs(profile[hi2][2] - d) ? lo2 : hi2;
  };
  svg.addEventListener('pointermove', (e) => {
    if (container.classList.contains('dragging')) return;
    const i = indexAt(e.clientX), cx = x(profile[i][2]);
    cursor.setAttribute('x1', cx); cursor.setAttribute('x2', cx);
    const right = cx > W - 150;
    readout.setAttribute('x', cx + (right ? -6 : 6));
    readout.setAttribute('text-anchor', right ? 'end' : 'start');
    readout.textContent = `${fmtKm(profile[i][2])} · ${profile[i][3] === null ? '—' : Math.round(profile[i][3]) + ' m'}`;
    for (const n of [cursor, readout]) n.style.display = '';
    opts.onHover?.(i);
  });
  svg.addEventListener('pointerleave', () => { for (const n of [cursor, readout]) n.style.display = 'none'; opts.onHover?.(null); });

  // dragging a boundary: listeners on the window, so the graph can be redrawn while dragging
  svg.addEventListener('pointerdown', (e) => {
    const k = Number(e.target.getAttribute?.('data-k'));
    if (!k || !opts.onDrag) return;
    e.preventDefault();
    const box = container.closest('.days-profile') ?? container;
    box.classList.add('dragging');
    const lo3 = cuts[k - 1] + 1, hi3 = cuts[k + 1] - 1;
    let last = cuts[k], t0 = 0;
    const move = (ev) => {
      const i = Math.max(lo3, Math.min(hi3, indexAt(ev.clientX)));
      if (i === last) return;
      last = i;
      const now = performance.now();
      if (now - t0 > 30) { t0 = now; opts.onDrag(k, i, false); }
    };
    const up = () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
      box.classList.remove('dragging');
      opts.onDrag(k, last, true);
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
  });
}
