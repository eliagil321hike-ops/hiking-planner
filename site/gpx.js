// GPX 1.1 export (D-064): a saved route (track with elevations + its marked points) and the personal points.
// Pure functions + one download helper; opened by navigation apps (waypoints carry name and a symbol word).

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const n6 = (v) => (Math.round(v * 1e6) / 1e6).toString();
const ele = (e) => (Number.isFinite(e) ? `<ele>${Math.round(e * 10) / 10}</ele>` : '');

function wpt(p) {
  return `  <wpt lat="${n6(p.lat)}" lon="${n6(p.lon)}">${ele(p.ele)}<name>${esc(p.name)}</name>${p.icon ? `<type>${esc(p.icon)}</type>` : ''}</wpt>\n`;
}
const head = (name, time) => `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Topo3D" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${esc(name)}</name>${time ? `<time>${esc(time)}</time>` : ''}</metadata>
`;

/** A My Routes record → GPX text. Track points from the saved profile (with elevation) or the line. */
export function routeToGpx(rec) {
  const marks = rec.editor?.state?.waypoints?.filter((w) => w.icon) ?? [];
  const pts = Array.isArray(rec.profile) && rec.profile.length >= 2
    ? rec.profile.map(([lon, lat, , e]) => ({ lon, lat, e }))
    : (rec.geometry ?? []).map(([lon, lat]) => ({ lon, lat, e: null }));
  let out = head(rec.name, rec.updatedAt);
  for (const w of marks) out += wpt(w);
  out += `  <trk><name>${esc(rec.name)}</name><trkseg>\n`;
  for (const p of pts) out += `    <trkpt lat="${n6(p.lat)}" lon="${n6(p.lon)}">${ele(p.e)}</trkpt>\n`;
  out += '  </trkseg></trk>\n</gpx>\n';
  return out;
}

/** Personal points → GPX text (waypoints only). */
export function pointsToGpx(points, title = 'Topo3D – הנקודות שלי') {
  let out = head(title, new Date().toISOString());
  for (const p of points) out += wpt(p);
  return `${out}</gpx>\n`;
}

/** A file name a phone and a computer both accept (Hebrew kept, unsafe characters out). */
export const gpxFileName = (name) => `${String(name || 'topo3d').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'topo3d'}.gpx`;

export function downloadText(text, fileName, type = 'application/gpx+xml') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: fileName });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
