// Map icon set drawn in code (D-031, D-036, D-047, D-048). Points of interest: a small rounded square in the
// category colour with a white symbol (owner: "like Gaia" — our own drawings, nothing copied), one size and
// weight for all. Peaks and saddles stay plain symbols. Drawn synchronously with Path2D so the images exist
// before the layers that use them render.

const SIZE = 24;     // design grid (viewBox 0 0 24 24)
const RATIO = 2;     // drawn at 2x for sharp edges

// Square badges: `bg` colour, `glyph` parts drawn in white (fill even-odd, or stroke) inside the square.
export const BADGES = {
  'topo-tent': { bg: '#59544d', glyph: [
    { d: 'M12 6.2 L6 17.4 H18 Z M12 11.6 L9.7 17.4 H14.3 Z', fill: true },
    { d: 'M10.6 4.6 L12.6 7.4 M13.4 4.6 L11.4 7.4', stroke: 1.3 },
  ] },
  'topo-tap': { bg: '#3a85bf', glyph: [
    { d: 'M8.6 5.6 H15.4 V6.8 H8.6 Z M11.3 6.8 H12.7 V8.4 H11.3 Z M10.2 8.4 H13.8 V9.6 H10.2 Z', fill: true },
    { d: 'M10.6 9.6 H13.4 V10.8 H16.8 V13.8 H9.8 V16.6 H6.8 V13.6 Q6.8 10.8 9.6 10.8 H10.6 Z', fill: true },
    { d: 'M8.3 18.4 a1 1.3 0 1 0 0.01 0', fill: true },
  ] },
  'topo-parking': { bg: '#4a6690', glyph: [
    { d: 'M9 6 H13.2 A3.6 3.6 0 0 1 13.2 13.2 H11.4 V18 H9 Z M11.4 8.2 V11 H13 A1.4 1.4 0 0 0 13 8.2 Z', fill: true },
  ] },
  'topo-spring': { bg: '#2f8f86', glyph: [
    { d: 'M12 5 C10.8 7 7.4 10.6 7.4 13.6 A4.6 4.6 0 0 0 16.6 13.6 C16.6 10.6 13.2 7 12 5 Z', fill: true },
    { d: 'M9.6 14 Q10.8 13 12 14 T14.4 14', stroke: 1.2, color: '#2f8f86' },
  ] },
  'topo-viewpoint': { bg: '#a65f42', glyph: [
    { d: 'M7.4 12.6 L8.8 7 H11 L11.3 11.6 Z M16.6 12.6 L15.2 7 H13 L12.7 11.6 Z M10.8 11.2 H13.2 V13.2 H10.8 Z', fill: true },
    { d: 'M6.6 14.4 a2.7 2.7 0 1 0 5.4 0 a2.7 2.7 0 1 0 -5.4 0 Z M8.2 14.4 a1.1 1.1 0 1 0 2.2 0 a1.1 1.1 0 1 0 -2.2 0 Z', fill: true },
    { d: 'M12 14.4 a2.7 2.7 0 1 0 5.4 0 a2.7 2.7 0 1 0 -5.4 0 Z M13.6 14.4 a1.1 1.1 0 1 0 2.2 0 a1.1 1.1 0 1 0 -2.2 0 Z', fill: true },
  ] },
  // day-use picnic site ("חניון יום"): table with benches
  'topo-picnic': { bg: '#5e8a52', glyph: [
    { d: 'M6.4 8.6 H17.6 V10.4 H6.4 Z M5.4 13 H18.6 V14.6 H5.4 Z', fill: true },
    { d: 'M9.2 10.4 L7.2 17.6 M14.8 10.4 L16.8 17.6', stroke: 1.5 },
  ] },
  'topo-shelter': { bg: '#6c7782', glyph: [
    { d: 'M12 5.6 L5.6 11 H7.4 V17.6 H16.6 V11 H18.4 Z M10.7 17.6 V13.8 H13.3 V17.6 Z', fill: true },
  ] },
};

// Plain symbols (not badges): peaks and saddles.
const ICONS = {
  'topo-peak': [
    { d: 'M12 5 L20.5 19 H3.5 Z', fill: '#4a3727' },
  ],
  'topo-saddle': [
    { d: 'M5 5 Q11 12 5 19 M19 5 Q13 12 19 19', stroke: '#4a3727', width: 2.2 },
  ],
};

function canvas2d() {
  const px = SIZE * RATIO;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = px;
  const c = canvas.getContext('2d');
  c.scale(RATIO, RATIO);
  c.lineJoin = 'round'; c.lineCap = 'round';
  return c;
}

// One proportion for every badge (owner, D-048): the square spans 3.5–20.5, every symbol is drawn at 80 %
// around the centre, one 1-unit white edge, a faint shadow.
const GLYPH_SCALE = 0.8;
function drawBadge({ bg, glyph }) {
  const c = canvas2d();
  const sq = new Path2D('M6.8 3.5 H17.2 Q20.5 3.5 20.5 6.8 V17.2 Q20.5 20.5 17.2 20.5 H6.8 Q3.5 20.5 3.5 17.2 V6.8 Q3.5 3.5 6.8 3.5 Z');
  c.shadowColor = 'rgba(0,0,0,0.22)'; c.shadowBlur = 1.2; c.shadowOffsetY = 0.4;
  c.fillStyle = bg; c.fill(sq);
  c.shadowColor = 'transparent';
  c.strokeStyle = 'rgba(255,255,255,0.95)'; c.lineWidth = 1; c.stroke(sq);   // reads on dark imagery too
  c.translate(12, 12); c.scale(GLYPH_SCALE, GLYPH_SCALE); c.translate(-12, -12);
  for (const p of glyph) {
    const path = new Path2D(p.d);
    if (p.fill) { c.fillStyle = p.color ?? '#ffffff'; c.fill(path, 'evenodd'); }
    if (p.stroke) { c.strokeStyle = p.color ?? '#ffffff'; c.lineWidth = p.stroke; c.stroke(path); }
  }
  return c.getImageData(0, 0, SIZE * RATIO, SIZE * RATIO);
}

function draw(parts) {
  const px = SIZE * RATIO;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = px;
  const c = canvas.getContext('2d');
  c.scale(RATIO, RATIO);
  c.lineJoin = 'round'; c.lineCap = 'round';
  const paths = parts.map((p) => ({ ...p, path: new Path2D(p.d) }));
  // one white outline under everything, so every icon reads on hillshade, forest tint and satellite alike
  c.strokeStyle = 'rgba(255,255,255,0.95)';
  for (const p of paths) {
    if (p.fill === '#ffffff' || p.stroke === '#ffffff') continue;  // inner white details need no halo
    c.lineWidth = p.stroke ? p.width + 2.8 : 3;
    c.stroke(p.path);
  }
  for (const p of paths) {
    if (p.fill) { c.fillStyle = p.fill; c.fill(p.path, 'evenodd'); }
    if (p.stroke) { c.strokeStyle = p.stroke; c.lineWidth = p.width; c.stroke(p.path); }
  }
  return c.getImageData(0, 0, px, px);
}

/** Register the icons on the map (idempotent). Returns the ids added. */
export function addPoiIcons(map) {
  const added = [];
  for (const [id, parts] of Object.entries(ICONS)) {
    if (map.hasImage(id)) continue;
    map.addImage(id, draw(parts), { pixelRatio: RATIO });
    added.push(id);
  }
  for (const [id, badge] of Object.entries(BADGES)) {
    if (map.hasImage(id)) continue;
    map.addImage(id, drawBadge(badge), { pixelRatio: RATIO });
    added.push(id);
  }
  return added;
}

export const POI_ICON_IDS = [...Object.keys(BADGES), ...Object.keys(ICONS)];
