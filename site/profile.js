// Elevation profile: x = cumulative distance, y = elevation (SPEC §8.3). Light, low design (owner request
// D-030): a top info row (total length, highest, lowest), a separate slope legend, a thin slope-coloured line
// over a pale fill, km ticks with the FULL length marked at the right end, and a hover readout.
// Missing elevation breaks the line and the fill; it is never drawn as 0.

const NS = 'http://www.w3.org/2000/svg';

// Absolute grade classes, computed over ~100 m on smoothed elevations. Colour is not the only carrier of
// meaning: the legend spells out the ranges.
export const SLOPE_CLASSES = [
  { max: 0.08, color: '#4caf50', label: '0–8%' },
  { max: 0.15, color: '#d4b106', label: '8–15%' },
  { max: 0.25, color: '#ef7d1a', label: '15–25%' },
  { max: Infinity, color: '#d32f2f', label: '25%+' },
];

export function slopeClass(grade) {
  const g = Math.abs(grade);
  return SLOPE_CLASSES.find((c) => g < c.max);
}

function el(name, attrs = {}, text) {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (text !== undefined) n.textContent = text;
  return n;
}

/** Round elevation levels inside [lo, hi]: the step (5…1000 m) that gives 3–5 lines. */
export function elevationTicks(lo, hi) {
  const span = hi - lo;
  const step = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000].find((s) => span / s <= 5) ?? 2000;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(v);
  return out;
}

const fmtKm = (m) => `${(m / 1000).toFixed(m < 10_000 ? 2 : 1)} km`;

export function renderProfile(container, samples, onHover, opts = {}) {
  container.innerHTML = '';
  const valid = samples.filter((s) => s.elevation !== null);
  if (valid.length < 2) {
    container.textContent = samples.length ? 'No elevation data for this line' : '';
    return;
  }
  const smoothed = opts.smoothed ?? samples.map((s) => s.elevation);
  // Drawn height: the smoothed series (a calm line), falling back to the raw value; gaps stay gaps.
  const ev = (i) => (samples[i].elevation === null ? null : smoothed[i] ?? samples[i].elevation);
  const W = container.clientWidth || 360, H = container.clientHeight || 120;
  // top: info + legend row (16 px); left: elevation labels; right: room for the end tick label
  const pad = { l: 40, r: 14, t: 24, b: 18 };
  const maxD = samples.at(-1).distance;
  const els = valid.map((s) => s.elevation);
  let lo = Math.min(...els), hi = Math.max(...els);
  if (hi - lo < 20) { const m = (hi + lo) / 2; lo = m - 10; hi = m + 10; }
  const span = hi - lo;
  const yLo = lo - span * 0.04, yHi = hi + span * 0.06;
  const x = (d) => pad.l + (d / maxD) * (W - pad.l - pad.r);
  const y = (e) => pad.t + (1 - (e - yLo) / (yHi - yLo)) * (H - pad.t - pad.b);
  const baseY = H - pad.b;

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: '100%', role: 'img', 'aria-label': 'Elevation profile' });
  container.append(svg); // in the DOM early so text widths can be measured

  // --- top row, left: total length · highest · lowest (no labels inside the plot to collide with)
  const hiS = valid.reduce((m, s) => (s.elevation > m.elevation ? s : m));
  const loS = valid.reduce((m, s) => (s.elevation < m.elevation ? s : m));
  if (!opts.compact) {   // in the route panel (D-039) the figures are shown above the graph
    const info = el('text', { x: pad.l, y: 13, class: 'profile-info' });
    info.append(el('tspan', { class: 'profile-strong' }, fmtKm(maxD)));
    info.append(el('tspan', { dx: 10 }, `▲ ${Math.round(hiS.elevation)} m`));
    info.append(el('tspan', { dx: 8 }, `▼ ${Math.round(loS.elevation)} m`));
    svg.append(info);
  }

  // --- top row, right: slope legend (short coloured bars + text), right-aligned before the close button
  let lx = W - pad.r - 30;
  for (const c of [...SLOPE_CLASSES].reverse()) {
    const tx = el('text', { x: lx, y: 13, 'text-anchor': 'end', class: 'profile-legend' }, c.label);
    svg.append(tx);
    const w = tx.getComputedTextLength?.() || c.label.length * 6;
    svg.append(el('line', { x1: lx - w - 16, x2: lx - w - 5, y1: 9.5, y2: 9.5, stroke: c.color, 'stroke-width': 3, 'stroke-linecap': 'round' }));
    lx = lx - w - 24;
  }

  // --- km grid; the right end always shows the full length (owner request)
  const kmLen = maxD / 1000;
  const stepKm = [0.25, 0.5, 1, 2, 5, 10, 20, 50].find((s) => kmLen / s <= 7) ?? 100;
  const endX = x(maxD);
  for (let k = stepKm; k * 1000 < maxD; k += stepKm) {
    const gx = x(k * 1000);
    if (endX - gx < 48) break;                         // keep clear of the end label
    svg.append(el('line', { x1: gx, x2: gx, y1: pad.t, y2: baseY, class: 'profile-grid' }));
    svg.append(el('text', { x: gx, y: H - 4, 'text-anchor': 'middle', class: 'profile-axis' }, `${+k.toFixed(2)}`));
  }
  svg.append(el('line', { x1: endX, x2: endX, y1: pad.t, y2: baseY + 3, class: 'profile-end' }));
  svg.append(el('text', { x: endX, y: H - 4, 'text-anchor': 'end', class: 'profile-axis profile-strong' }, fmtKm(maxD)));
  svg.append(el('text', { x: pad.l - 2, y: H - 4, 'text-anchor': 'end', class: 'profile-axis' }, '0'));

  // --- elevation scale (left): 4–5 round levels (owner, D-049), e.g. every 100 m on a 400 m climb
  for (const v of elevationTicks(yLo, yHi)) {
    svg.append(el('text', { x: pad.l - 6, y: y(v) + 3.5, 'text-anchor': 'end', class: 'profile-axis' }, `${v}`));
    svg.append(el('line', { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), class: 'profile-grid profile-grid-h' }));
  }
  svg.append(el('text', { x: pad.l - 6, y: pad.t - 6, 'text-anchor': 'end', class: 'profile-axis' }, 'm'));

  // --- pale fill per contiguous run of valid samples
  let run = [];
  const flushArea = () => {
    if (run.length > 1) {
      const d = `M${x(run[0].distance)},${baseY}` + run.map((s) => `L${x(s.distance).toFixed(1)},${y(s.elevation).toFixed(1)}`).join('') + `L${x(run.at(-1).distance)},${baseY}Z`;
      svg.append(el('path', { d, class: 'profile-area' }));
    }
    run = [];
  };
  samples.forEach((s, i) => { if (s.elevation === null) flushArea(); else run.push({ distance: s.distance, elevation: ev(i) }); });
  flushArea();

  // --- thin slope-coloured line (grade from smoothed values over ≈100 m)
  const W_SAMPLES = 2;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1], b = samples[i];
    if (a.elevation === null || b.elevation === null) continue;
    const i0 = Math.max(0, i - 1 - W_SAMPLES), i1 = Math.min(samples.length - 1, i + W_SAMPLES);
    const e0 = smoothed[i0], e1 = smoothed[i1];
    const dd = samples[i1].distance - samples[i0].distance;
    const grade = e0 !== null && e1 !== null && dd > 0 ? (e1 - e0) / dd : 0;
    svg.append(el('line', {
      x1: x(a.distance).toFixed(1), y1: y(ev(i - 1)).toFixed(1), x2: x(b.distance).toFixed(1), y2: y(ev(i)).toFixed(1),
      stroke: slopeClass(grade).color, class: 'profile-seg',
    }));
  }
  for (const s of [hiS, loS]) svg.append(el('circle', { cx: x(s.distance), cy: y(ev(samples.indexOf(s))), r: 2.5, class: 'profile-dot' }));
  // start / finish (D-039)
  const iFirst = samples.findIndex((s) => s.elevation !== null);
  const iLast = samples.length - 1 - [...samples].reverse().findIndex((s) => s.elevation !== null);
  svg.append(el('circle', { cx: x(samples[iFirst].distance), cy: y(ev(iFirst)), r: 4, class: 'profile-start' }));
  svg.append(el('circle', { cx: x(samples[iLast].distance), cy: y(ev(iLast)), r: 4, class: 'profile-finish' }));

  // --- hover / drag readout
  const cursor = el('line', { class: 'profile-cursor', y1: pad.t, y2: baseY });
  const dot = el('circle', { r: 3.5, class: 'profile-hover' });
  const readout = el('text', { class: 'profile-readout', y: pad.t + 11 });
  for (const n of [cursor, dot, readout]) n.style.display = 'none';
  svg.append(cursor, dot, readout);

  function pick(pointer) {
    const r = svg.getBoundingClientRect();
    const px = ((pointer.clientX - r.left) / r.width) * W;
    const dist = Math.max(0, Math.min(maxD, ((px - pad.l) / (W - pad.l - pad.r)) * maxD));
    let best = 0;
    for (let i = 1; i < samples.length; i++) if (Math.abs(samples[i].distance - dist) < Math.abs(samples[best].distance - dist)) best = i;
    const s = samples[best];
    const cx = x(s.distance);
    cursor.setAttribute('x1', cx); cursor.setAttribute('x2', cx);
    const right = cx > W - 150;
    readout.setAttribute('x', cx + (right ? -6 : 6));
    readout.setAttribute('text-anchor', right ? 'end' : 'start');
    readout.textContent = `${fmtKm(s.distance)} · ${s.elevation === null ? '—' : Math.round(s.elevation) + ' m'}`;
    if (s.elevation !== null) { dot.setAttribute('cx', cx); dot.setAttribute('cy', y(ev(best))); }
    for (const n of [cursor, readout]) n.style.display = '';
    dot.style.display = s.elevation === null ? 'none' : '';
    onHover?.(best);
  }
  svg.addEventListener('pointerdown', (e) => { svg.setPointerCapture(e.pointerId); pick(e); });
  svg.addEventListener('pointermove', (e) => { if (e.buttons || e.pointerType === 'mouse') pick(e); });
}
