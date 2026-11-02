// Entry point: loads the configuration, creates the map, and wires the modules together.
// Globals from <script> tags: maplibregl, mlcontour.
//   layers.js      layer switches, exaggeration, panel
//   background.js  map style: topographic / satellite / hybrid 3D
//   view3d.js      2D / 3D button
//   search.js      place search (Nominatim)
//   route.js       drawing a line, stats, profile
//   devtools.js    Phase 0 tests, loaded only with ?dev=1

import { applyI18n, t, fmtNumber, mapLocale } from './i18n.js';
import { loadPrefs, savePrefs } from './prefs.js';
import { createPerf } from './perf.js';
import { createDemSampler } from './dem-sampler.js';
import { applyTopo3d } from './topo3d.js';
import { initLayers, layerHelpers } from './layers.js';
import { initBackground } from './background.js';
import { initRoute } from './route.js';
import { initMenus } from './menus.js';
import { createOrsRouter } from './router.js';
import { initView3d } from './view3d.js';
import { initSearch } from './search.js';

const BUILD = '__BUILD__'; // replaced by CI (scripts/stamp_build.sh) with the commit id
const perf = createPerf();
perf.mark('script-start');
applyI18n();

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const DEV = params.has('dev');
const results = { encoding: null, engineCheck: null, demZoomProbe: null, features: null, toggles: [], topo: null };

/** Developer log (visible only with ?dev=1; always in the console). */
function log(html, cls) {
  (cls === 'fail' ? console.warn : console.info)('[topo3d]', html.replace(/<[^>]+>/g, ''));
  if (!DEV) return;
  const div = document.createElement('div');
  if (cls) div.className = cls;
  div.innerHTML = html;
  $('test-out').prepend(div);
}

/** User-facing status line in the panel; null clears it. */
function notify(text) {
  $('status').hidden = !text;
  $('status').textContent = text ?? '';
  delete $('status').dataset.source;   // callers may tag their own message to clear only that one later
}

// ---------------------------------------------------------------- configuration and libraries
const overlay = await (await fetch('./styles/topo3d.json', { cache: 'no-cache' })).json();
const demMaxzoom = Number(params.get('demz')) || overlay.dem.maxzoomDefault;
const samplingZoom = Math.max(demMaxzoom, overlay.dem.samplingZoom ?? demMaxzoom);
const DEM = { urlTemplate: overlay.dem.tiles, encoding: overlay.dem.encoding, tileSize: overlay.dem.tileSize };

if (typeof maplibregl === 'undefined' || typeof mlcontour === 'undefined') {
  notify(t('error.libs'));
  throw new Error(t('error.libs'));
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
const sampler = createDemSampler({ ...DEM, zoom: samplingZoom, fallbackMinZoom: Math.min(12, samplingZoom) });

// ---------------------------------------------------------------- map
// Camera: the URL hash wins (shared views); otherwise the last remembered view; otherwise Meron.
const lastCam = !location.hash && loadPrefs().camera;
const cam = { ...overlay.camera, ...(lastCam && Array.isArray(lastCam.center) ? lastCam : {}) };
const map = new maplibregl.Map({
  container: 'map',
  style: overlay.base,
  center: cam.center,
  zoom: cam.zoom,
  pitch: cam.pitch,
  bearing: cam.bearing,
  locale: mapLocale(),
  maxPitch: cam.maxPitch,
  hash: true, // camera in the URL: a view can be shared and reproduced exactly
  attributionControl: { compact: true },
  // ?pr=1 renders fewer pixels on high-DPI screens (performance experiment, D-013)
  ...(Number(params.get('pr')) > 0 ? { pixelRatio: Number(params.get('pr')) } : {}),
});
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-left');
map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
// "Center on me": asks for location permission only when pressed, one fix, no tracking (SPEC 8.1).
const geolocate = new maplibregl.GeolocateControl({
  positionOptions: { enableHighAccuracy: true, timeout: 15_000 },
  trackUserLocation: false,
  showAccuracyCircle: true,
  fitBoundsOptions: { maxZoom: 14 },
});
map.addControl(geolocate, 'top-left');
geolocate.on('error', () => notify(t('error.location')));
geolocate.on('geolocate', () => notify(null));
// Remember the last view (saved after each move; a URL hash still overrides it).
map.on('moveend', () => {
  const c = map.getCenter();
  savePrefs({ camera: { center: [+c.lng.toFixed(5), +c.lat.toFixed(5)], zoom: +map.getZoom().toFixed(2), pitch: +map.getPitch().toFixed(1), bearing: +map.getBearing().toFixed(1) } });
});
map.on('error', (e) => log(`map error: ${e.error?.message ?? e.error ?? e}`, 'fail'));

// ---------------------------------------------------------------- modules
const ctx = {
  BUILD, DEV, map, overlay, results, perf, log, notify, t, fmtNumber, $,
  sampler, DEM, demMaxzoom, samplingZoom,
  state: { exaggeration: overlay.terrain.exaggeration },
};
Object.assign(ctx, layerHelpers(ctx));
initLayers(ctx);
const view = initView3d(ctx);
map.addControl(view.control, 'top-left');
const background = initBackground(ctx);
ctx.applyBackground = background.applyBackground;
// Routing (snap to trails): openrouteservice with the owner's embedded key (D-027).
if (overlay.routing?.embeddedKey) {
  ctx.router = createOrsRouter({ key: overlay.routing.embeddedKey, profile: overlay.routing.profile });
}
const route = initRoute(ctx);
const menus = initMenus(ctx);
ctx.menus = menus;
initSearch(ctx);

// Test/debug handle (used by scripts/e2e_test.py).
globalThis.__topo3d = { map, results, ctx, editor: route.editor, menus };

map.on('load', () => {
  perf.mark('style-loaded');
  try {
    results.topo = applyTopo3d(map, overlay, { contourTiles, demMaxzoom });
  } catch (e) {
    log(`Topo3D overlay failed: ${e.message}`, 'fail');
    throw e;
  }
  route.addRouteLayers();
  // Map credits start folded (an ⓘ button), so they never cover the map above the route dock.
  document.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
  ctx.applyGroupsFromUI(); // remembered layer switches and opacities (prefs.js)
  view.applyTerrain();     // remembered 2D/3D and exaggeration
  background.start();
  // Horizon haze like the FATMAP references (sky spec: GL JS ≥ 4.5, checked 2026-11-01).
  if (overlay.sky) map.setSky(Object.fromEntries(Object.entries(overlay.sky).filter(([k]) => !k.startsWith('$'))));
  map.once('idle', () => perf.mark('first-idle'));
});

if (DEV) {
  const { initDevtools } = await import('./devtools.js');
  initDevtools(ctx);
}
