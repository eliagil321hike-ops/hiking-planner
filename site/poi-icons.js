// Map icon set drawn in code (D-031, D-036): one 24-unit grid, one white outline, similar visual weight, a
// distinct colour per category. Tent (brown) and tap (blue) follow the owner's examples; no third-party image
// is copied. Drawn synchronously with Path2D so the images exist before the layers that use them render.

const SIZE = 24;     // design grid (viewBox 0 0 24 24)
const RATIO = 2;     // drawn at 2x for sharp edges

// Each icon: parts drawn in order; a part has a path `d`, a `fill` colour (even-odd) or a `stroke` colour.
const ICONS = {
  'topo-tent': [
    { d: 'M12 5.4 L3.6 19.8 H20.4 Z M12 12.2 L8.6 19.8 H15.4 Z', fill: '#45260a' },
    { d: 'M2.2 19.6 H21.8 V21.4 H2.2 Z', fill: '#45260a' },
    { d: 'M10.2 2.4 L12.6 5.8 M13.8 2.4 L11.4 5.8', stroke: '#45260a', width: 1.6 },
  ],
  'topo-tap': [
    { d: 'M7.6 3.5 H16.4 V4.9 H7.6 Z', fill: '#0a86c9' },
    { d: 'M6.2 4.2 m-1.6 0 a1.6 1.6 0 1 0 3.2 0 a1.6 1.6 0 1 0 -3.2 0', fill: '#0a86c9' },
    { d: 'M17.8 4.2 m-1.6 0 a1.6 1.6 0 1 0 3.2 0 a1.6 1.6 0 1 0 -3.2 0', fill: '#0a86c9' },
    { d: 'M12 4.1 m-1.7 0 a1.7 1.7 0 1 0 3.4 0 a1.7 1.7 0 1 0 -3.4 0', fill: '#0a86c9' },
    { d: 'M11.1 5 H12.9 V7 H11.1 Z M9.4 7 H14.6 V8.6 H9.4 Z', fill: '#0a86c9' },
    { d: 'M10.2 8.6 H13.8 V10.2 H18.2 V14 H8.8 V17.6 H4.8 V13.8 Q4.8 10.2 8.4 10.2 H10.2 Z', fill: '#0a86c9' },
    { d: 'M18.6 9.6 H20.4 V14.6 H18.6 Z M4.2 18 H9.4 V19.6 H4.2 Z', fill: '#0a86c9' },
  ],
  'topo-parking': [
    { d: 'M6 3 H18 Q21 3 21 6 V18 Q21 21 18 21 H6 Q3 21 3 18 V6 Q3 3 6 3 Z', fill: '#1d5fa8' },
    { d: 'M8.6 6.5 H13.2 A3.9 3.9 0 0 1 13.2 14.3 H11.2 V17.6 H8.6 Z M11.2 8.8 V12 H13 A1.6 1.6 0 0 0 13 8.8 Z', fill: '#ffffff' },
  ],
  'topo-spring': [
    { d: 'M12 2.8 C10.4 5.4 5.4 10.6 5.4 14.6 A6.6 6.6 0 0 0 18.6 14.6 C18.6 10.6 13.6 5.4 12 2.8 Z', fill: '#12938a' },
    { d: 'M8.4 15 Q10.2 13.6 12 15 T15.6 15', stroke: '#ffffff', width: 1.4 },
  ],
  'topo-viewpoint': [
    { d: 'M5.2 13.4 L7.2 5.6 H10.4 L10.8 12.2 Z M18.8 13.4 L16.8 5.6 H13.6 L13.2 12.2 Z', fill: '#8c3b1c' },
    { d: 'M9.6 11.6 H14.4 V14.4 H9.6 Z', fill: '#8c3b1c' },
    { d: 'M3.8 16 a3.9 3.9 0 1 0 7.8 0 a3.9 3.9 0 1 0 -7.8 0 Z M6 16 a1.7 1.7 0 1 0 3.4 0 a1.7 1.7 0 1 0 -3.4 0 Z', fill: '#8c3b1c' },
    { d: 'M12.4 16 a3.9 3.9 0 1 0 7.8 0 a3.9 3.9 0 1 0 -7.8 0 Z M14.6 16 a1.7 1.7 0 1 0 3.4 0 a1.7 1.7 0 1 0 -3.4 0 Z', fill: '#8c3b1c' },
  ],
  'topo-shelter': [
    { d: 'M12 3.4 L2.4 11.6 H5.2 V20.4 H18.8 V11.6 H21.6 Z M10 20.4 V14.6 H14 V20.4 Z', fill: '#4e5b66' },
  ],
};

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
  return added;
}

export const POI_ICON_IDS = Object.keys(ICONS);
