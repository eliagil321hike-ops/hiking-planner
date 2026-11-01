// Elevation profile: x = cumulative distance, y = elevation. Filled area, line coloured by slope
// (SPEC 8.3 "gradient colouring optional"; look follows the owner's reference screenshots), km ticks,
// highest/lowest point. Touch/drag reports the sample index so the page can move a marker on the map.
// Missing elevation breaks the line and the fill; it is never drawn as 0.

const NS = 'http://www.w3.org/2000/svg';

// Slope classes (absolute grade, computed over ~100 m on smoothed elevations). Colour is never the only
// carrier of meaning: the legend states the ranges in text.
export const SLOPE_CLASSES = [
  { max: 0.08, color: '#4caf50', label: '<8%' },
  { max: 0.15, color: '#d4b106', label: '8–15%' },
  { max: 0.25, color: '#ef7d1a', label: '15–25%' },
  { max: Infinity, color: '#c62828', label: '>25%' },
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

export function renderProfile(container, samples, onHover, opts = {}) {
  container.innerHTML = '';
  const valid = samples.filter((s) => s.elevation !== null);
  if (valid.length < 2) {
    container.textContent = samples.length ? 'No elevation data for this line' : '';
    return;
  }
  const smoothed = opts.smoothed ?? samples.map((s) => s.elevation);
  const W = container.clientWidth || 360, H = container.clientHeight || 140;
  const pad = { l: 46, r: 10, t: 10, b: 22 };
  const maxD = samples.at(-1).distance;
  const els = valid.map((s) => s.elevation);
  let lo = Math.min(...els), hi = Math.max(...els);
  if (hi - lo < 20) { const m = (hi + lo) / 2; lo = m - 10; hi = m + 10; }
  const span = hi - lo;
  lo -= span * 0.05; hi += span * 0.08;
  const x = (d) => pad.l + (d / maxD) * (W - pad.l - pad.r);
  const y = (e) => pad.t + (1 - (e - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const baseY = H - pad.b;

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: '100%', role: 'img', 'aria-label': 'Elevation profile' });
  container.append(svg); // in the DOM early so text widths can be measured for the legend

  // km gridlines and labels
  const stepKm = [0.5, 1, 2, 5, 10, 20].find((s) => maxD / 1000 / s <= 8) ?? 50;
  for (let k = stepKm; k * 1000 < maxD; k += stepKm) {
    svg.append(el('line', { x1: x(k * 1000), x2: x(k * 1000), y1: pad.t, y2: baseY, class: 'profile-grid' }));
    svg.append(el('text', { x: x(k * 1000), y: H - 6, 'text-anchor': 'middle', class: 'profile-axis' }, `${k} km`));
  }

  // filled area per contiguous run of valid samples
  let run = [];
  const flushArea = () => {
    if (run.length > 1) {
      const d = `M${x(run[0].distance)},${baseY}` + run.map((s) => `L${x(s.distance).toFixed(1)},${y(s.elevation).toFixed(1)}`).join('') + `L${x(run.at(-1).distance)},${baseY}Z`;
      svg.append(el('path', { d, class: 'profile-area' }));
    }
    run = [];
  };
  for (const s of samples) { if (s.elevation === null) flushArea(); else run.push(s); }
  flushArea();

  // slope-coloured line: one segment per sample pair, grade from smoothed values over ≈100 m
  const W_SAMPLES = 2; // ±2 samples × 20 m ≈ 80–100 m window
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1], b = samples[i];
    if (a.elevation === null || b.elevation === null) continue;
    const i0 = Math.max(0, i - 1 - W_SAMPLES), i1 = Math.min(samples.length - 1, i + W_SAMPLES);
    const e0 = smoothed[i0], e1 = smoothed[i1];
    const dd = samples[i1].distance - samples[i0].distance;
    const grade = e0 !== null && e1 !== null && dd > 0 ? (e1 - e0) / dd : 0;
    svg.append(el('line', {
      x1: x(a.distance).toFixed(1), y1: y(a.elevation).toFixed(1), x2: x(b.distance).toFixed(1), y2: y(b.elevation).toFixed(1),
      stroke: slopeClass(grade).color, class: 'profile-seg',
    }));
  }

  // highest / lowest point
  const hiS = valid.reduce((m, s) => (s.elevation > m.elevation ? s : m));
  const loS = valid.reduce((m, s) => (s.elevation < m.elevation ? s : m));
  for (const [s, label, dy] of [[hiS, `▲ ${Math.round(hiS.elevation)} m`, -6], [loS, `▼ ${Math.round(loS.elevation)} m`, 14]]) {
    svg.append(el('circle', { cx: x(s.distance), cy: y(s.elevation), r: 3, class: 'profile-dot' }));
    const anchor = x(s.distance) > W - 70 ? 'end' : x(s.distance) < pad.l + 40 ? 'start' : 'middle';
    svg.append(el('text', { x: x(s.distance), y: y(s.elevation) + dy, 'text-anchor': anchor, class: 'profile-axis profile-strong' }, label));
  }

  // y axis labels
  for (const v of [Math.round(lo + (hi - lo) * 0.1), Math.round(lo + (hi - lo) * 0.85)]) {
    svg.append(el('text', { x: 4, y: y(v) + 4, class: 'profile-axis' }, `${v} m`));
  }

  // legend (text, not colour only)
  let lx = W - pad.r;
  for (const c of [...SLOPE_CLASSES].reverse()) {
    const t = el('text', { x: lx, y: pad.t + 1, 'text-anchor': 'end', class: 'profile-axis', 'dominant-baseline': 'hanging' }, c.label);
    svg.append(t);
    const textW = t.getComputedTextLength?.() || c.label.length * 6.5;
    const sx = lx - textW - 12;
    svg.append(el('rect', { x: sx, y: pad.t + 2, width: 9, height: 9, rx: 2, fill: c.color }));
    lx = sx - 12;
  }

  // hover cursor
  const cursor = el('line', { class: 'profile-cursor', y1: pad.t, y2: baseY });
  cursor.style.display = 'none';
  const readout = el('text', { class: 'profile-axis profile-strong', y: pad.t + 24 });
  svg.append(cursor, readout);

  function pick(ev) {
    const r = svg.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * W;
    const dist = Math.max(0, Math.min(maxD, ((px - pad.l) / (W - pad.l - pad.r)) * maxD));
    let best = 0;
    for (let i = 1; i < samples.length; i++) if (Math.abs(samples[i].distance - dist) < Math.abs(samples[best].distance - dist)) best = i;
    const cx = x(samples[best].distance);
    cursor.setAttribute('x1', cx); cursor.setAttribute('x2', cx);
    cursor.style.display = '';
    const e = samples[best].elevation;
    readout.setAttribute('x', cx + (cx > W - 120 ? -6 : 6));
    readout.setAttribute('text-anchor', cx > W - 120 ? 'end' : 'start');
    readout.textContent = `${(samples[best].distance / 1000).toFixed(2)} km · ${e === null ? '—' : Math.round(e) + ' m'}`;
    onHover?.(best);
  }
  svg.addEventListener('pointerdown', (e) => { svg.setPointerCapture(e.pointerId); pick(e); });
  svg.addEventListener('pointermove', (e) => { if (e.buttons || e.pointerType === 'mouse') pick(e); });
}
