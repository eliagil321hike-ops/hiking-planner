// Phase 0, Option B: MapLibre GL JS + maplibre-contour, Topo3D style, draw line, elevation profile,
// and the Phase 0 measurements. Globals from <script> tags: maplibregl, mlcontour.

import { createPerf } from './perf.js';
import { createDemSampler } from './dem-sampler.js';
import { renderProfile } from './profile.js';
import { applyTopo3d, layerFeatureCounts } from './topo3d.js';
import {
  assertLonLat, resampleLine, computeElevationStats, naismithSeconds,
  checkReferenceElevations, EncodingCheckError, ISRAEL_REFERENCE_POINTS,
} from './vendor/geo/index.js';

const perf = createPerf();
perf.mark('script-start');
const $ = (id) => document.getElementById(id);
const out = $('test-out');
const results = { encoding: null, engineCheck: null, demZoomProbe: null, features: null, toggles: [], topo: null };

function log(html, cls) {
  const div = document.createElement('div');
  if (cls) div.className = cls;
  div.innerHTML = html;
  out.prepend(div);
}

// ---------------------------------------------------------------- setup
const params = new URLSearchParams(location.search);
// The standalone single-file build embeds the overlay (no server needed); otherwise fetch it.
const overlay = globalThis.__TOPO3D_OVERLAY__ ?? await (await fetch('./styles/topo3d.json', { cache: 'no-cache' })).json();
const demMaxzoom = Number(params.get('demz')) || overlay.dem.maxzoomDefault;
const DEM = { urlTemplate: overlay.dem.tiles, encoding: overlay.dem.encoding, tileSize: overlay.dem.tileSize };

if (typeof maplibregl === 'undefined' || typeof mlcontour === 'undefined') {
  log('Could not load MapLibre / maplibre-contour from unpkg.com. Check the internet connection.', 'fail');
  throw new Error('MapLibre / maplibre-contour did not load from unpkg.com (no internet, or the site is blocked by antivirus/firewall). ' +
    'ספריות המפה לא נטענו מ-unpkg.com: בדוק חיבור לאינטרנט או חסימה של אנטי-וירוס.');
}

// Hebrew needs the RTL text plugin (official MapLibre example, checked 2026-11-01).
maplibregl.setRTLTextPlugin('https://unpkg.com/@mapbox/mapbox-gl-rtl-text@0.3.0/dist/mapbox-gl-rtl-text.js', true);

const demSource = new mlcontour.DemSource({
  url: DEM.urlTemplate,
  encoding: DEM.encoding,
  maxzoom: demMaxzoom,
  worker: true,
  cacheSize: 100,
  timeoutMs: 10_000,
});
demSource.setupMaplibre(maplibregl);
const contourTiles = demSource.contourProtocolUrl({
  thresholds: overlay.contours.thresholds,
  elevationKey: overlay.contours.elevationKey,
  levelKey: overlay.contours.levelKey,
  contourLayer: overlay.contours.contourLayer,
  extent: 4096,
  buffer: 1,
});

const samplingZoom = Math.max(demMaxzoom, overlay.dem.samplingZoom ?? demMaxzoom);
const sampler = createDemSampler({ ...DEM, zoom: samplingZoom, fallbackMinZoom: Math.min(12, samplingZoom) });

const cam = overlay.camera;
const map = new maplibregl.Map({
  container: 'map',
  style: overlay.base,
  center: cam.center,
  zoom: cam.zoom,
  pitch: cam.pitch,
  bearing: cam.bearing,
  maxPitch: cam.maxPitch,
  hash: true, // camera in the URL: lets us match FATMAP reference views exactly
  attributionControl: { compact: true },
  // ?pr=1 renders fewer pixels on high-DPI screens (performance experiment, D-013)
  ...(Number(params.get('pr')) > 0 ? { pixelRatio: Number(params.get('pr')) } : {}),
});
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-left');
map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
map.on('error', (e) => log(`map error: ${e.error?.message ?? e.error ?? e}`, 'fail'));

const GROUPS = {
  hillshade: ['topo-hillshade'],
  contours: ['topo-contours-minor', 'topo-contours-index', 'topo-contour-labels'],
  trails: ['topo-trails-casing', 'topo-trails-track', 'topo-trails-path', 'topo-trails-footway'],
  landcover: ['topo-landcover'],
};
let exaggeration = overlay.terrain.exaggeration;

map.on('load', () => {
  perf.mark('style-loaded');
  try {
    results.topo = applyTopo3d(map, overlay, { contourTiles, demMaxzoom });
  } catch (e) {
    log(`Topo3D overlay failed: ${e.message}`, 'fail');
    throw e;
  }
  addRouteLayers();
  // Horizon haze like the FATMAP references (sky spec: GL JS ≥ 4.5, checked 2026-11-01).
  if (overlay.sky) map.setSky(Object.fromEntries(Object.entries(overlay.sky).filter(([k]) => !k.startsWith('$'))));
  map.once('idle', () => {
    perf.mark('first-idle');
    results.gpu = gpuInfo();
    log(`cold start → first full map: ${results.timingsText()}`);
    log(`DEM maxzoom ${demMaxzoom} · base source "${results.topo.baseSource}" · hidden base layers: ${results.topo.hidden.join(', ') || 'none'} · names switched to Hebrew-first: ${results.topo.renamed}`);
    if (results.topo.hidden.length === 0) log('WARNING: no base trail/peak layers were matched — check base style', 'fail');
  });
});
results.timingsText = () => `${Math.round(perf.report().timings['first-idle'] - perf.report().timings['script-start'])} ms`;

// ---------------------------------------------------------------- layer toggles
document.querySelectorAll('input[data-group]').forEach((cb) => {
  cb.addEventListener('change', () => {
    const g = cb.dataset.group;
    const t0 = performance.now();
    if (g === 'terrain') {
      map.setTerrain(cb.checked ? { source: 'dem-terrain', exaggeration } : null);
    } else {
      for (const id of GROUPS[g]) map.setLayoutProperty(id, 'visibility', cb.checked ? 'visible' : 'none');
    }
    map.once('idle', () => {
      const ms = Math.round(performance.now() - t0);
      results.toggles.push({ group: g, on: cb.checked, msToIdle: ms });
      log(`toggle ${g} ${cb.checked ? 'on' : 'off'}: ${ms} ms to idle`);
    });
  });
});
$('exag').addEventListener('input', (e) => {
  exaggeration = Number(e.target.value);
  $('exag-out').textContent = exaggeration.toFixed(1);
  if (map.getTerrain()) map.setTerrain({ source: 'dem-terrain', exaggeration });
});
$('panel-toggle').addEventListener('click', () => {
  const p = $('panel');
  p.classList.toggle('collapsed');
  $('panel-toggle').setAttribute('aria-expanded', String(!p.classList.contains('collapsed')));
});
perf.liveMeter($('fps'));

// ---------------------------------------------------------------- drawing + profile
const route = [];      // [lon, lat] control points
let drawing = false;
let routeSeq = 0;      // stale-response guard: only the newest computation may render (SPEC §9.4 idea)
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
const emptyFC = () => ({ type: 'FeatureCollection', features: [] });

$('draw').addEventListener('click', () => {
  drawing = !drawing;
  $('draw').setAttribute('aria-pressed', String(drawing));
  $('draw').textContent = drawing ? 'סיים ציור' : 'צייר קו';
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
  catch (err) { if (seq === routeSeq) log(`elevation sampling failed: ${err.message}`, 'fail'); return; }
  if (seq !== routeSeq) return; // a newer edit exists: drop this stale result
  const ms = Math.round(performance.now() - t0);

  samples = pts.map((s, i) => ({ ...s, elevation: elevs[i] }));
  const st = computeElevationStats(elevs, { stepM: 20 });
  const dist = pts.at(-1).distance;
  const dur = naismithSeconds(dist, st.ascent);
  const fmt = (v) => (v === null ? '—' : `${Math.round(v).toLocaleString('he-IL')} מ׳`);
  $('stats').innerHTML = `
    <dt>מרחק</dt><dd>${(dist / 1000).toLocaleString('he-IL', { maximumFractionDigits: 2 })} ק״מ</dd>
    <dt>עלייה</dt><dd>${fmt(st.ascent)}</dd>
    <dt>ירידה</dt><dd>${fmt(st.descent)}</dd>
    <dt>מינ׳ / מקס׳</dt><dd>${fmt(st.min)} / ${fmt(st.max)}</dd>
    <dt>זמן (הערכה)</dt><dd>${Math.floor(dur / 3600)}:${String(Math.round((dur % 3600) / 60)).padStart(2, '0')} שעות</dd>
    <dt>מקור גובה</dt><dd>Mapterhorn z${samplingZoom} (גיבוי z12) · ${ms} ms</dd>
    ${st.incomplete ? '<dt>אזהרה</dt><dd>חסרים נתוני גובה בחלק מהקו</dd>' : ''}`;
  $('profile').hidden = false;
  renderProfile($('profile'), samples, (i) => hoverMarker.setLngLat(samples[i].point).addTo(map), { smoothed: st.smoothed, min: st.min, max: st.max });
}

// ---------------------------------------------------------------- test: encoding (P10.5)
const metresToDeg = (m, lat) => ({ dLat: m / 111_320, dLon: m / (111_320 * Math.cos((lat * Math.PI) / 180)) });

async function measureReference(s, r) {
  if (r.mode === 'point') return s.elevationAt(r.point);
  // max within radius, on a 20 m grid
  const { dLat, dLon } = metresToDeg(r.searchRadiusM, r.point[1]);
  const step = 20 / r.searchRadiusM;
  const pts = [];
  for (let y = -1; y <= 1; y += step) for (let x = -1; x <= 1; x += step) {
    if (x * x + y * y <= 1) pts.push([r.point[0] + x * dLon, r.point[1] + y * dLat]);
  }
  const vals = (await s.elevations(pts)).filter((v) => v !== null);
  return vals.length ? Math.max(...vals) : null;
}

async function runReferenceCheck(s) {
  const measured = new Map();
  for (const r of ISRAEL_REFERENCE_POINTS) measured.set(r.name, await measureReference(s, r));
  const byPoint = new Map(ISRAEL_REFERENCE_POINTS.map((r) => [r.point, r.name]));
  return checkReferenceElevations(ISRAEL_REFERENCE_POINTS, (p) => measured.get(byPoint.get(p)));
}

$('t-encoding').addEventListener('click', async (ev) => {
  ev.target.disabled = true;
  const report = { declared: DEM, zoom: samplingZoom, points: null, pass: false, negativeControl: null };
  try {
    // 1. Real tiles, declared encoding → must PASS
    try {
      const res = await runReferenceCheck(sampler);
      report.points = res.map(({ name, measured, min, max, pass }) => ({ name, measured, min, max, pass }));
      report.pass = true;
      log(`<span class="pass">ENCODING CHECK PASSED</span> (terrarium, z${samplingZoom}→12)\n` +
        res.map((r) => `  ✓ ${r.name}: ${r.measured.toFixed(1)} m (expected ${r.min}…${r.max})`).join('\n'));
    } catch (e) {
      if (!(e instanceof EncodingCheckError)) throw e;
      report.points = e.results.map(({ name, measured, min, max, pass }) => ({ name, measured, min, max, pass }));
      log(`<span class="fail">${e.message.replace(/\n/g, '<br>')}</span>`);
    }
    // 2. Negative control: same tiles, WRONG encoding → must FAIL, proving the test can fail
    const wrong = createDemSampler({ ...DEM, encoding: 'mapbox', zoom: samplingZoom, fallbackMinZoom: Math.min(12, samplingZoom) });
    try {
      await runReferenceCheck(wrong);
      report.negativeControl = 'NOT DETECTED';
      log('<span class="fail">NEGATIVE CONTROL FAILED: wrong encoding was not detected</span>');
    } catch (e) {
      if (!(e instanceof EncodingCheckError)) throw e;
      report.negativeControl = 'detected';
      log(`<span class="pass">negative control OK</span>: decoding as "mapbox" gives e.g. ${e.results[0].measured?.toFixed(0)} m → rejected`);
    }
    // 3. Engine check: what MapLibre itself renders at the Meron reference point (exaggeration 1)
    results.engineCheck = await engineElevationCheck(ISRAEL_REFERENCE_POINTS[0].point);
    log(`engine check (MapLibre terrain vs own decoder at ${ISRAEL_REFERENCE_POINTS[0].point}): ` +
      `engine ${fmtNum(results.engineCheck.engine)} m, own ${fmtNum(results.engineCheck.own)} m, Δ ${fmtNum(results.engineCheck.diff)} m`,
      results.engineCheck.diff !== null && Math.abs(results.engineCheck.diff) <= 20 ? 'pass' : 'fail');
  } catch (e) {
    log(`encoding test error: ${e.message}`, 'fail');
  } finally {
    results.encoding = report;
    ev.target.disabled = false;
  }
});
const fmtNum = (v) => (v === null || v === undefined ? '—' : v.toFixed(1));

async function engineElevationCheck(p) {
  const before = { center: map.getCenter(), zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() };
  const hadTerrain = !!map.getTerrain();
  map.setTerrain({ source: 'dem-terrain', exaggeration: 1 });
  map.jumpTo({ center: p, zoom: 14, pitch: 0, bearing: 0 });
  await new Promise((r) => map.once('idle', r));
  const engine = map.queryTerrainElevation(p);
  const own = await sampler.elevationAt(p);
  map.setTerrain(hadTerrain ? { source: 'dem-terrain', exaggeration } : null);
  map.jumpTo(before);
  return { point: p, engine, own, diff: engine !== null && own !== null ? engine - own : null };
}

// ---------------------------------------------------------------- test: DEM max zoom over Israel
$('t-probe').addEventListener('click', async (ev) => {
  ev.target.disabled = true;
  const p = ISRAEL_REFERENCE_POINTS[0].point;
  const rows = [];
  const { tileForLonLat } = await import('./vendor/geo/index.js');
  for (let z = 10; z <= 17; z++) {
    const t = tileForLonLat(p, z);
    const url = DEM.urlTemplate.replace('{z}', z).replace('{x}', t.x).replace('{y}', t.y);
    let status;
    try { status = (await fetch(url, { cache: 'no-store' })).status; } catch { status = 'network error'; }
    rows.push({ z, status });
  }
  const okZ = rows.filter((r) => r.status === 200).map((r) => r.z);
  const maxOk = okZ.length ? Math.max(...okZ) : null;
  results.demZoomProbe = { point: p, rows, maxOk };
  log(`DEM tiles at Meron: ${rows.map((r) => `z${r.z}:${r.status}`).join(' ')}\n→ highest available z${maxOk}. ` +
    `Reload with <a href="?demz=${maxOk}${location.hash}">?demz=${maxOk}</a> to use it.`);
  ev.target.disabled = false;
});

// ---------------------------------------------------------------- test: FPS while rotating and tilting
// Which GPU does the browser use? Software rendering (SwiftShader, "Basic Render Driver") explains very
// low FPS and is fixed in browser settings, not in our code.
function gpuInfo() {
  try {
    const gl = map.getCanvas().getContext('webgl2') || map.getCanvas().getContext('webgl');
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    const vendor = ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
    const software = /swiftshader|basic render|llvmpipe|software/i.test(renderer);
    return { renderer, vendor, software, webgl2: !!map.getCanvas().getContext('webgl2'), pixelRatio: map.getPixelRatio() };
  } catch (e) { return { error: e.message }; }
}

const MERON_VIEW = { center: [35.4167, 33.0], zoom: 13.5, pitch: 60, bearing: -20 };
const idle = () => new Promise((r) => map.once('idle', r));
const orbit = (start) => (p) => map.jumpTo({ bearing: start.bearing + 360 * p, pitch: 52.5 + 12.5 * Math.sin(p * Math.PI * 4) });
function setGroup(g, on) {
  if (g === 'terrain') map.setTerrain(on ? { source: 'dem-terrain', exaggeration } : null);
  else for (const id of GROUPS[g]) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
}

// Repeatable FPS test: always at the same Meron view; a warm-up orbit first (tiles load, not measured),
// then one measured orbit per variant. Run 2 (owner, Intel HD 4400): all layers 8 fps, no contours 17,
// no 3D terrain 58.5 → 3D terrain is the cost and contours drawn onto the terrain double it. These
// variants measure the cheap savings: fewer pixels (pixel ratio 1), index contours only, no contour labels.
const vis = (ids, on) => ids.forEach((id) => map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'));
const canSetPR = typeof map.setPixelRatio === 'function';
const nativePR = map.getPixelRatio();
$('t-perf').addEventListener('click', async (ev) => {
  ev.target.disabled = true;
  const before = { center: map.getCenter(), zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() };
  const gpu = gpuInfo();
  log(`GPU: ${gpu.renderer ?? gpu.error} · WebGL2 ${gpu.webgl2} · pixelRatio ${gpu.pixelRatio?.toFixed(2)}`, gpu.software ? 'fail' : undefined);
  if (gpu.software) log('The browser is drawing WITHOUT the graphics card (software rendering). In Chrome: Settings → System → turn on "Use graphics acceleration when available", restart Chrome.', 'fail');
  if (!canSetPR) log('map.setPixelRatio is not available in this MapLibre version → pixel-ratio variants skipped (use ?pr=1 to test).');
  log('FPS test ≈ 70 s at Meron — do not touch the map…');
  map.jumpTo(MERON_VIEW);
  await idle();
  await perf.frameRun('warm-up (not counted)', 8_000, orbit(MERON_VIEW));
  await idle();
  const minor = ['topo-contours-minor'], labels = ['topo-contour-labels'];
  const pr = (v) => { if (canSetPR) map.setPixelRatio(v); };
  const reset = () => { pr(nativePR); vis([...GROUPS.contours], true); setGroup('terrain', true); };
  const variants = [
    ['all layers', () => reset()],
    [`all layers · pixelRatio 1`, () => { reset(); pr(1); }, canSetPR],
    [`pixelRatio 1 · index contours only (100 m)`, () => { reset(); pr(1); vis(minor, false); }, canSetPR],
    [`pixelRatio 1 · index contours, no contour labels`, () => { reset(); pr(1); vis(minor, false); vis(labels, false); }, canSetPR],
    ['no contours', () => { reset(); setGroup('contours', false); }],
    ['no 3D terrain (2D baseline)', () => { reset(); setGroup('terrain', false); }],
  ];
  const runs = [];
  for (const [name, apply, enabled = true] of variants) {
    if (!enabled) continue;
    apply();
    map.jumpTo(MERON_VIEW);
    await idle();
    const run = await perf.frameRun(`Meron z13.5 · ${name}`, 10_000, orbit(MERON_VIEW));
    runs.push(run);
    log(`${run.label}: avg ${run.avgFps} fps, slowest-5% ${run.p5Fps} fps, stutters(>50 ms) ${run.longFrames}`,
      run.avgFps >= 30 ? 'pass' : 'fail');
  }
  pr(nativePR);
  setGroup('terrain', true);
  document.querySelectorAll('input[data-group]').forEach((cb) => setGroup(cb.dataset.group, cb.checked));
  results.perfTest = { gpu, runs };
  map.jumpTo(before);
  ev.target.disabled = false;
});

// ---------------------------------------------------------------- test: do the Topo3D layers find data?
// Always measured at the same Meron view (flat, z13.5) so results are comparable.
$('t-features').addEventListener('click', async (ev) => {
  ev.target.disabled = true;
  const before = { center: map.getCenter(), zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() };
  map.jumpTo({ ...MERON_VIEW, pitch: 0, bearing: 0 });
  await idle();
  results.features = { at: MERON_VIEW.center, zoom: MERON_VIEW.zoom, counts: layerFeatureCounts(map, results.topo?.added ?? []) };
  log(`features at Meron (z${MERON_VIEW.zoom}):\n` +
    Object.entries(results.features.counts).map(([k, v]) => `  ${v > 0 ? '✓' : '·'} ${k}: ${v}`).join('\n'));
  map.jumpTo(before);
  ev.target.disabled = false;
});

// ---------------------------------------------------------------- export
function fullReport() {
  return { ...perf.report(), demMaxzoom, samplingZoom, overlayVersion: overlay.version, camera: location.hash, ...results, timingsText: undefined };
}
$('t-copy').addEventListener('click', async () => {
  const json = JSON.stringify(fullReport(), null, 2);
  try { await navigator.clipboard.writeText(json); log('results copied to clipboard'); }
  catch { download('phase0-results.json', json); log('clipboard unavailable — downloaded phase0-results.json'); }
});
$('t-style').addEventListener('click', () => {
  download('topo3d-merged-style.json', JSON.stringify(map.getStyle(), null, 2));
  log('downloaded topo3d-merged-style.json (contour source uses the maplibre-contour protocol)');
});
function download(name, text) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([text], { type: 'application/json' })), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
