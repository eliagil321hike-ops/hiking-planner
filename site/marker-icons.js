// Marker pictures for personal points and route marks (D-064, owner approved the sketches 2026-11-03).
// A rounded square (larger than the map's point icons) with a pointer and a small white dot on the exact spot.
// Inside: the same symbol drawings as the map's point icons (poi-icons.js), so a marked spring looks like a spring.
//   personal point: crimson fill, white frame, white symbol
//   route mark:     the route's colour, dark navy frame + white ring (clear on every route colour), dark or white symbol
// Images are drawn on demand ("styleimagemissing"), named mk-<icon>-<fill hex>.

import { BADGES } from './poi-icons.js';

export const PERSONAL_RED = '#D0435B';
const FRAME_DARK = '#203449';

// icon key → white symbol parts in a 24 grid (map symbols reused; "general" and "peak" drawn here)
const GLYPHS = {
  general: [{ d: 'M8 5 V19', stroke: 1.8 }, { d: 'M8 5.6 H16.6 L14.6 8.6 L16.6 11.6 H8 Z', fill: true }],
  peak: [{ d: 'M12 5.5 L19.5 18 H4.5 Z', fill: true }],
};
for (const [id, b] of Object.entries(BADGES)) GLYPHS[id.replace(/^topo-/, '')] = b.glyph;

/** Icon keys offered in the marking dialog, in this order (owner: all point symbols, incl. peak and parking). */
export const MARK_ICONS = ['general', 'viewpoint', 'spring', 'tap', 'waterfall', 'pool', 'tent', 'picnic', 'shelter', 'ruins', 'parking', 'peak']
  .filter((k) => GLYPHS[k]);

export const isMarkIcon = (k) => MARK_ICONS.includes(k);

// The pin in a 32 × 44 box: body 2–30, pointer to (16, 38), dot centre (16, 40.5).
const BODY = 'M7 2 H25 Q30 2 30 7 V25 Q30 30 25 30 H19.6 L16 38.2 L12.4 30 H7 Q2 30 2 25 V7 Q2 2 7 2 Z';
export const PIN = { w: 32, h: 44, cssWidth: 34, tipY: 40.5 };
const RATIO = 2;

/** Dark symbol on bright route colours, white on the dark ones. */
export function symbolColourOn(fill) {
  const n = parseInt(fill.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#0a1f0a' : '#ffffff';
}

export function drawPin(icon, { fill = PERSONAL_RED, frame = '#ffffff', ring = null, symbol = '#ffffff' } = {}) {
  const k = (PIN.cssWidth / PIN.w) * RATIO;
  const W = Math.ceil(PIN.w * k), H = Math.ceil(PIN.h * k);
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const c = canvas.getContext('2d');
  c.scale(k, k);
  c.lineJoin = 'round'; c.lineCap = 'round';
  // soft contact shadow
  c.fillStyle = 'rgba(0,0,0,0.22)';
  c.beginPath(); c.ellipse(16, 41.2, 4, 1.5, 0, 0, Math.PI * 2); c.fill();
  const body = new Path2D(BODY);
  if (ring) { c.strokeStyle = ring; c.lineWidth = 5.5; c.stroke(body); }
  c.shadowColor = 'rgba(0,0,0,0.25)'; c.shadowBlur = 2; c.shadowOffsetY = 0.6;
  c.fillStyle = fill; c.fill(body);
  c.shadowColor = 'transparent';
  c.strokeStyle = frame; c.lineWidth = 2.4; c.stroke(body);
  // the exact spot
  c.beginPath(); c.arc(16, PIN.tipY, 2.6, 0, Math.PI * 2);
  c.fillStyle = '#ffffff'; c.fill();
  c.strokeStyle = frame === '#ffffff' ? FRAME_DARK : frame; c.lineWidth = 1.6; c.stroke();
  // symbol (24 grid placed at 4,4)
  c.translate(4, 4);
  for (const p of GLYPHS[icon] ?? GLYPHS.general) {
    const path = new Path2D(p.d);
    if (p.fill) { c.fillStyle = p.color && p.color !== '#ffffff' ? fill : symbol; c.fill(path, 'evenodd'); }
    if (p.stroke) { c.strokeStyle = p.color && p.color !== '#ffffff' ? fill : symbol; c.lineWidth = p.stroke; c.stroke(path); }
  }
  return c.getImageData(0, 0, W, H);
}

export const pinImageId = (icon, fill) => `mk-${icon}-${fill.replace('#', '').toLowerCase()}`;

/** Draw marker images the first time a layer asks for them. */
export function registerMarkerImages(map) {
  map.on('styleimagemissing', (e) => {
    const m = /^mk-([a-z]+)-([0-9a-f]{6})$/.exec(e.id);
    if (!m || map.hasImage(e.id)) return;
    const fill = `#${m[2]}`;
    const personal = fill.toUpperCase() === PERSONAL_RED;
    const img = personal ? drawPin(m[1], { fill })
      : drawPin(m[1], { fill, frame: FRAME_DARK, ring: '#ffffff', symbol: symbolColourOn(fill) });
    map.addImage(e.id, img, { pixelRatio: RATIO });
  });
}

/** Small square icon (HTML) for lists and the dialog: the symbol on the crimson square. */
export function iconSquare(icon, size = 22, fill = PERSONAL_RED) {
  const parts = (GLYPHS[icon] ?? GLYPHS.general).map((p) => (p.fill
    ? `<path d="${p.d}" fill="${p.color && p.color !== '#ffffff' ? fill : '#fff'}" fill-rule="evenodd"/>`
    : `<path d="${p.d}" fill="none" stroke="${p.color && p.color !== '#ffffff' ? fill : '#fff'}" stroke-width="${p.stroke}" stroke-linecap="round"/>`)).join('');
  return `<svg class="mk-sq" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><rect x="1" y="1" width="22" height="22" rx="5" fill="${fill}"/><g transform="translate(12 12) scale(.82) translate(-12 -12)">${parts}</g></svg>`;
}
