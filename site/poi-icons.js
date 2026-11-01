// Map icons drawn in code (owner request D-031): a brown tent for campsites (חניון לילה) and a blue tap for
// drinking water. Our own drawings, inspired by the owner's examples; no third-party image is copied.
// Drawn synchronously with Path2D so the images exist before the layers that use them render.

const SIZE = 24;     // design grid (viewBox 0 0 24 24)
const RATIO = 2;     // drawn at 2x for sharp edges; shown at ~24 css px

const ICONS = {
  'topo-tent': {
    color: '#45260a',
    // outer A-frame with the door cut out (even-odd), ground bar, and crossed poles at the apex
    fill: ['M12 5.4 L3.6 19.8 H20.4 Z M12 12.2 L8.6 19.8 H15.4 Z', 'M2.2 19.6 H21.8 V21.4 H2.2 Z'],
    stroke: ['M10.2 2.4 L12.6 5.8 M13.8 2.4 L11.4 5.8'],
  },
  'topo-tap': {
    color: '#0a86c9',
    fill: [
      'M7.6 3.5 H16.4 V4.9 H7.6 Z',                                    // handle bar
      'M6.2 4.2 m-1.6 0 a1.6 1.6 0 1 0 3.2 0 a1.6 1.6 0 1 0 -3.2 0',  // left knob
      'M17.8 4.2 m-1.6 0 a1.6 1.6 0 1 0 3.2 0 a1.6 1.6 0 1 0 -3.2 0', // right knob
      'M12 4.1 m-1.7 0 a1.7 1.7 0 1 0 3.4 0 a1.7 1.7 0 1 0 -3.4 0',   // centre knob
      'M11.1 5 H12.9 V7 H11.1 Z',                                      // stem
      'M9.4 7 H14.6 V8.6 H9.4 Z',                                      // collar
      'M10.2 8.6 H13.8 V10.2 H18.2 V14 H8.8 V17.6 H4.8 V13.8 Q4.8 10.2 8.4 10.2 H10.2 Z', // body + spout
      'M18.6 9.6 H20.4 V14.6 H18.6 Z',                                 // pipe flange
      'M4.2 18 H9.4 V19.6 H4.2 Z',                                     // spout tip
    ],
    stroke: [],
  },
};

function draw(spec) {
  const px = SIZE * RATIO;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = px;
  const c = canvas.getContext('2d');
  c.scale(RATIO, RATIO);
  c.lineJoin = 'round'; c.lineCap = 'round';
  const fills = spec.fill.map((d) => new Path2D(d));
  const strokes = spec.stroke.map((d) => new Path2D(d));
  // white outline first so the icon reads on hillshade, forest tint and satellite alike
  c.strokeStyle = 'rgba(255,255,255,0.95)';
  c.lineWidth = 3;
  for (const p of fills) c.stroke(p);
  c.lineWidth = 4.4;
  for (const p of strokes) c.stroke(p);
  c.fillStyle = c.strokeStyle = spec.color;
  for (const p of fills) c.fill(p, 'evenodd');
  c.lineWidth = 1.6;
  for (const p of strokes) c.stroke(p);
  return c.getImageData(0, 0, px, px);
}

/** Register the icons on the map (idempotent). Returns the ids added. */
export function addPoiIcons(map) {
  const added = [];
  for (const [id, spec] of Object.entries(ICONS)) {
    if (map.hasImage(id)) continue;
    map.addImage(id, draw(spec), { pixelRatio: RATIO });
    added.push(id);
  }
  return added;
}

export const POI_ICON_IDS = Object.keys(ICONS);
