// Route preview picture for the My Routes cards (D-056). At save time the map is fitted to the whole route
// (2D, north up) and the rendered map is copied into a small JPEG. If the map cannot be read (e.g. a tile
// source without CORS, or WebGL refuses), a drawn sketch of the route line is used instead.

const W = 480, H = 300;

export function routeBBox(coords) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of coords) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }
  return [w, s, e, n];
}

/** Fit the camera to the route and grab the canvas. Resolves to a data URL, or null on any failure. */
export function captureMapThumb(map, bbox, { timeoutMs = 8000, hide = [] } = {}) {
  return new Promise((resolve) => {
    let done = false;
    // editing handles (points, mid-segment circles) are hidden for the picture and shown again afterwards
    const hidden = hide.filter((id) => map.getLayer(id) && map.getLayoutProperty(id, 'visibility') !== 'none');
    hidden.forEach((id) => map.setLayoutProperty(id, 'visibility', 'none'));
    const finish = (v) => { if (!done) { done = true; clearTimeout(timer); hidden.forEach((id) => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', 'visible')); resolve(v); } };
    const timer = setTimeout(() => finish(null), timeoutMs);
    try {
      const pad = Math.round(Math.min(map.getCanvas().clientWidth, map.getCanvas().clientHeight) * 0.12);
      map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: pad, animate: false, pitch: 0, bearing: 0, maxZoom: 15 });
      map.once('idle', () => {
        map.once('render', () => {
          try {
            const src = map.getCanvas();
            const c = document.createElement('canvas');
            c.width = W; c.height = H;
            const g = c.getContext('2d');
            // cover-crop the map canvas into 480×300
            const r = Math.max(W / src.width, H / src.height);
            const sw = W / r, sh = H / r;
            g.drawImage(src, (src.width - sw) / 2, (src.height - sh) / 2, sw, sh, 0, 0, W, H);
            const url = c.toDataURL('image/jpeg', 0.78);
            finish(isBlank(g) ? null : url);
          } catch { finish(null); }   // tainted canvas or a lost context
        });
        map.triggerRepaint();
      });
    } catch { finish(null); }
  });
}

// An all-one-colour picture means the drawing buffer was already cleared: treat as a failure.
function isBlank(g) {
  const d = g.getImageData(0, 0, W, H).data;
  const r0 = d[0], g0 = d[1], b0 = d[2];
  for (let i = 0; i < d.length; i += 4 * 97) if (Math.abs(d[i] - r0) + Math.abs(d[i + 1] - g0) + Math.abs(d[i + 2] - b0) > 12) return false;
  return true;
}

/** Fallback: the route line drawn on a plain background (SVG data URL, no map). */
export function sketchThumb(coords, color = '#39ff14') {
  const [w, s, e, n] = routeBBox(coords);
  const kx = Math.cos(((s + n) / 2) * Math.PI / 180);
  const spanX = Math.max((e - w) * kx, 1e-6), spanY = Math.max(n - s, 1e-6);
  const k = Math.min((W - 60) / spanX, (H - 60) / spanY);
  const ox = (W - spanX * k) / 2, oy = (H - spanY * k) / 2;
  const step = Math.max(1, Math.floor(coords.length / 600));
  const pts = coords.filter((_, i) => i % step === 0 || i === coords.length - 1)
    .map(([x, y]) => `${(ox + (x - w) * kx * k).toFixed(1)},${(oy + (n - y) * k).toFixed(1)}`).join(' ');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#E3EDF5"/>`
    + `<polyline points="${pts}" fill="none" stroke="#0a1f0a" stroke-opacity=".8" stroke-width="9" stroke-linejoin="round" stroke-linecap="round"/>`
    + `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
