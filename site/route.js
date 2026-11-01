// Drawing a line and its elevation profile (Phase 0 feature; becomes the route builder in Phase 3).
// Elevations come from the same DEM decoder as the map (P10.9). Late results never overwrite newer
// edits (stale-response guard, SPEC §9.4).

import { renderProfile } from './profile.js';
import { assertLonLat, resampleLine, computeElevationStats, naismithSeconds } from './vendor/geo/index.js';

const emptyFC = () => ({ type: 'FeatureCollection', features: [] });

export function initRoute(ctx) {
  const { map, sampler, samplingZoom, $, t, log, notify, fmtNumber } = ctx;
  const route = [];      // [lon, lat] control points
  let drawing = false;
  let routeSeq = 0;
  let samples = [];
  const hoverMarker = new maplibregl.Marker({ color: '#2a241d', scale: 0.7 });

  function addRouteLayers() {
    map.addSource('route', { type: 'geojson', data: emptyFC() });
    map.addLayer({ id: 'route-casing', type: 'line', source: 'route', filter: ['==', ['geometry-type'], 'LineString'],
      layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 7 } });
    map.addLayer({ id: 'route-line', type: 'line', source: 'route', filter: ['==', ['geometry-type'], 'LineString'],
      layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#b5502a', 'line-width': 4 } });
    map.addLayer({ id: 'route-points', type: 'circle', source: 'route', filter: ['==', ['geometry-type'], 'Point'],
      paint: { 'circle-radius': 6, 'circle-color': '#ffffff', 'circle-stroke-color': '#b5502a', 'circle-stroke-width': 3 } });
  }

  $('draw').addEventListener('click', () => {
    drawing = !drawing;
    $('draw').setAttribute('aria-pressed', String(drawing));
    $('draw').textContent = t(drawing ? 'route.finish' : 'route.draw');
    map.getCanvas().style.cursor = drawing ? 'crosshair' : '';
  });
  $('undo-pt').addEventListener('click', () => { route.pop(); updateRoute(); });
  $('clear').addEventListener('click', () => { route.length = 0; updateRoute(); });

  map.on('click', (e) => {
    if (!drawing) return;
    const p = [e.lngLat.lng, e.lngLat.lat]; // [lon, lat] — never swap (SPEC §14 #1)
    assertLonLat(p, 'map click');
    route.push(p);
    updateRoute();
  });

  async function updateRoute() {
    const seq = ++routeSeq;
    map.getSource('route')?.setData({
      type: 'FeatureCollection',
      features: [
        ...(route.length > 1 ? [{ type: 'Feature', geometry: { type: 'LineString', coordinates: route }, properties: {} }] : []),
        ...route.map((c) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: {} })),
      ],
    });
    if (route.length < 2) { $('profile').hidden = true; $('stats').innerHTML = ''; hoverMarker.remove(); return; }

    const t0 = performance.now();
    const pts = resampleLine(route, 20);
    let elevs;
    try { elevs = await sampler.elevations(pts.map((s) => s.point)); }
    catch (err) {
      if (seq === routeSeq) { notify(t('error.elevation', { message: err.message })); log(`elevation sampling failed: ${err.message}`, 'fail'); }
      return;
    }
    if (seq !== routeSeq) return; // a newer edit exists: drop this stale result
    const ms = Math.round(performance.now() - t0);

    samples = pts.map((s, i) => ({ ...s, elevation: elevs[i] }));
    const st = computeElevationStats(elevs, { stepM: 20 });
    const dist = pts.at(-1).distance;
    const dur = naismithSeconds(dist, st.ascent);
    const totalMin = Math.round(dur / 60);
    const m = (v) => (v === null ? '—' : `${fmtNumber(Math.round(v))} ${t('unit.m')}`);
    $('stats').innerHTML = `
      <dt>${t('stats.distance')}</dt><dd>${fmtNumber(dist / 1000, { maximumFractionDigits: 2 })} ${t('unit.km')}</dd>
      <dt>${t('stats.ascent')}</dt><dd>${m(st.ascent)}</dd>
      <dt>${t('stats.descent')}</dt><dd>${m(st.descent)}</dd>
      <dt>${t('stats.minmax')}</dt><dd>${m(st.min)} / ${m(st.max)}</dd>
      <dt>${t('stats.duration')}</dt><dd>${Math.floor(totalMin / 60)}:${String(totalMin % 60).padStart(2, '0')} ${t('unit.hours')}</dd>
      <dt>${t('stats.source')}</dt><dd>${t('stats.sourceValue', { z: samplingZoom })} · ${ms} ms</dd>
      ${st.incomplete ? `<dt>${t('stats.warning')}</dt><dd>${t('stats.incomplete')}</dd>` : ''}`;
    $('profile').hidden = false;
    renderProfile($('profile'), samples, (i) => hoverMarker.setLngLat(samples[i].point).addTo(map), { smoothed: st.smoothed, min: st.min, max: st.max });
  }

  return { addRouteLayers };
}
