// Basic elevation profile (Phase 0 only): SVG line chart, x = cumulative distance, y = elevation.
// Touch/drag on the chart reports the sample index so the page can move a marker on the map.

const NS = 'http://www.w3.org/2000/svg';

export function renderProfile(container, samples, onHover) {
  // samples: [{ distance (m), elevation (m | null) }]
  container.innerHTML = '';
  const valid = samples.filter((s) => s.elevation !== null);
  if (valid.length < 2) {
    container.textContent = samples.length ? 'No elevation data for this line' : '';
    return;
  }
  const W = container.clientWidth || 360, H = container.clientHeight || 140;
  const pad = { l: 40, r: 8, t: 8, b: 20 };
  const maxD = samples.at(-1).distance;
  const els = valid.map((s) => s.elevation);
  let lo = Math.min(...els), hi = Math.max(...els);
  if (hi - lo < 20) { const m = (hi + lo) / 2; lo = m - 10; hi = m + 10; }
  const x = (d) => pad.l + (d / maxD) * (W - pad.l - pad.r);
  const y = (e) => pad.t + (1 - (e - lo) / (hi - lo)) * (H - pad.t - pad.b);

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Elevation profile');

  // area + line, broken at missing data (never drawn as 0)
  let d = '', pen = false;
  for (const s of samples) {
    if (s.elevation === null) { pen = false; continue; }
    d += `${pen ? 'L' : 'M'}${x(s.distance).toFixed(1)},${y(s.elevation).toFixed(1)}`;
    pen = true;
  }
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', d);
  path.setAttribute('class', 'profile-line');
  svg.append(path);

  for (const [val, label] of [[lo, Math.round(lo)], [hi, Math.round(hi)]]) {
    const t = document.createElementNS(NS, 'text');
    t.setAttribute('x', 4); t.setAttribute('y', y(val) + 4);
    t.setAttribute('class', 'profile-axis');
    t.textContent = `${label} m`;
    svg.append(t);
  }
  const km = document.createElementNS(NS, 'text');
  km.setAttribute('x', W - pad.r); km.setAttribute('y', H - 4);
  km.setAttribute('text-anchor', 'end'); km.setAttribute('class', 'profile-axis');
  km.textContent = `${(maxD / 1000).toFixed(2)} km`;
  svg.append(km);

  const cursor = document.createElementNS(NS, 'line');
  cursor.setAttribute('class', 'profile-cursor');
  cursor.setAttribute('y1', pad.t); cursor.setAttribute('y2', H - pad.b);
  cursor.style.display = 'none';
  svg.append(cursor);

  function pick(ev) {
    const r = svg.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * W;
    const dist = Math.max(0, Math.min(maxD, ((px - pad.l) / (W - pad.l - pad.r)) * maxD));
    let best = 0;
    for (let i = 1; i < samples.length; i++) if (Math.abs(samples[i].distance - dist) < Math.abs(samples[best].distance - dist)) best = i;
    cursor.setAttribute('x1', x(samples[best].distance)); cursor.setAttribute('x2', x(samples[best].distance));
    cursor.style.display = '';
    onHover?.(best);
  }
  svg.addEventListener('pointerdown', (e) => { svg.setPointerCapture(e.pointerId); pick(e); });
  svg.addEventListener('pointermove', (e) => { if (e.buttons || e.pointerType === 'touch') pick(e); });
  container.append(svg);
}
