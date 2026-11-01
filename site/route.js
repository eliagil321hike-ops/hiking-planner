// Route builder UI (SPEC §8.2, Phase 3A). All editing logic lives in vendor/editor (packages/editor):
// commands with exact inverses, undo/redo, segment cache and the stale-response guard. This module only maps
// user input to commands, renders the editor state, keeps the draft, and shows stats + profile.
//
// Map interaction while planning: click = add point · drag a point = move · drag a small mid-segment handle =
// insert · click a point then Delete = remove · right-click = waypoint · Ctrl+Z / Ctrl+Y = undo / redo.

import { renderProfile } from './profile.js';
import { resampleLine, computeElevationStats, naismithSeconds } from './vendor/geo/index.js';
import {
  RouteEditor, addPoint, movePoint, insertPoint, deletePoint, setSegmentMode, reverseRoute, closeLoop,
  addWaypoint, editWaypoint, deleteWaypoint, clearRoute,
} from './vendor/editor/editor.js';
import { store } from './satellite.js';
import { loadPrefs, savePrefs } from './prefs.js';

const DRAFT_KEY = 'topo3d.draft';
export const ROUTE_COLOR = '#39ff14';   // fluorescent green (owner request)
const FC = (features) => ({ type: 'FeatureCollection', features });
const pt = (c, props = {}) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: props });

export function initRoute(ctx) {
  const { map, sampler, samplingZoom, $, t, log, notify, fmtNumber } = ctx;
  const editor = new RouteEditor('foot-hiking');
  let planning = false;
  let selected = null;           // selected vertex index
  let drag = null;               // { kind: 'vertex'|'mid', index, lngLat }
  let statsSeq = 0;
  let samples = [];
  const hoverMarker = new maplibregl.Marker({ color: '#2a241d', scale: 0.7 });

  // ---------------------------------------------------------------- layers
  function addRouteLayers() {
    const font = ctx.results.topo?.labelFont ?? ['Noto Sans Regular'];
    map.addSource('route', { type: 'geojson', data: FC([]), ...(ctx.router ? { attribution: ctx.router.attribution } : {}) });
    for (const id of ['route-handles', 'route-waypoints']) map.addSource(id, { type: 'geojson', data: FC([]) });
    // Segment styles differ by pattern, not only colour (SPEC §11): snap solid, free dashed,
    // pending dotted grey, error dotted red.
    // Owner request: a fluorescent route colour unlike any trail (red/brown/purple) or stream (blue) colour,
    // with a dark casing so it also stands out on satellite imagery.
    map.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#0a1f0a', 'line-width': 9, 'line-opacity': 0.75 } });
    map.addLayer({ id: 'route-line', type: 'line', source: 'route', filter: ['==', ['get', 'status'], 'ok'],
      layout: { 'line-join': 'round' },
      paint: { 'line-color': ROUTE_COLOR, 'line-width': 5, 'line-dasharray': ['case', ['==', ['get', 'mode'], 'free'], ['literal', [2, 1.2]], ['literal', [1, 0]]] } });
    map.addLayer({ id: 'route-provisional', type: 'line', source: 'route', filter: ['!=', ['get', 'status'], 'ok'],
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': ['case', ['==', ['get', 'status'], 'error'], '#ff2d55', '#e8e8e8'], 'line-width': 4, 'line-dasharray': [0.1, 1.6] } });
    map.addLayer({ id: 'route-mid', type: 'circle', source: 'route-handles', filter: ['==', ['get', 'kind'], 'mid'],
      paint: { 'circle-radius': 4.5, 'circle-color': '#ffffff', 'circle-opacity': 0.9, 'circle-stroke-color': '#0a1f0a', 'circle-stroke-width': 1.5 } });
    map.addLayer({ id: 'route-points', type: 'circle', source: 'route-handles', filter: ['==', ['get', 'kind'], 'vertex'],
      paint: {
        'circle-radius': ['case', ['get', 'selected'], 9, 6.5],
        'circle-color': ['case', ['get', 'first'], ROUTE_COLOR, '#ffffff'],
        'circle-stroke-color': ['case', ['get', 'selected'], '#ff2d55', '#0a1f0a'],
        'circle-stroke-width': 3,
      } });
    map.addLayer({ id: 'route-waypoints', type: 'symbol', source: 'route-waypoints',
      layout: { 'text-field': ['concat', '◆ ', ['get', 'name']], 'text-font': font, 'text-size': 13, 'text-anchor': 'left', 'text-offset': [0.2, 0], 'text-allow-overlap': true },
      paint: { 'text-color': '#1d4e89', 'text-halo-color': '#ffffff', 'text-halo-width': 2 } });
    render();
  }

  // ---------------------------------------------------------------- render
  function render() {
    if (!map.getSource('route')) return;
    const s = editor.state;
    const segs = editor.segments();
    map.getSource('route').setData(FC(segs.map((g) => ({
      type: 'Feature', geometry: { type: 'LineString', coordinates: g.geometry }, properties: { status: g.status, mode: g.mode, index: g.index },
    }))));
    const handles = s.vertices.map((v, i) => pt([v.lon, v.lat], { kind: 'vertex', index: i, first: i === 0, selected: i === selected }));
    if (planning) {
      for (const g of segs) {
        const a = g.geometry[0], b = g.geometry.at(-1);
        handles.push(pt([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], { kind: 'mid', index: g.index }));
      }
    }
    map.getSource('route-handles').setData(FC(handles));
    map.getSource('route-waypoints').setData(FC(s.waypoints.map((w) => pt([w.lon, w.lat], { id: w.id, name: w.name || t('wp.default') }))));
    renderErrors(segs);
    updateButtons();
  }

  function renderErrors(segs) {
    const box = $('seg-errors');
    box.innerHTML = '';
    for (const g of segs.filter((x) => x.status === 'error')) {
      const row = document.createElement('div');
      row.className = 'seg-error';
      row.innerHTML = `<span></span><button class="btn"></button>`;
      row.querySelector('span').textContent = t('route.segmentError', { n: g.index });
      const b = row.querySelector('button');
      b.textContent = t('route.toFree');
      b.addEventListener('click', () => editor.run(setSegmentMode(g.index, 'free', editor.state)));
      box.append(row);
    }
  }

  function updateButtons() {
    const n = editor.state.vertices.length;
    $('r-undo').disabled = !editor.canUndo;
    $('r-redo').disabled = !editor.canRedo;
    $('r-reverse').disabled = n < 2;
    $('r-loop').disabled = n < 2;
    $('r-delete').disabled = selected === null;
    $('r-clear').disabled = n === 0 && editor.state.waypoints.length === 0;
  }

  // ---------------------------------------------------------------- snap availability (router comes in 3B)
  function syncSnapAvailability() {
    const ok = !!ctx.router;
    const opt = $('seg-mode').querySelector('option[value="snap"]');
    opt.disabled = !ok;
    $('seg-mode').value = ok ? 'snap' : 'free';     // SPEC 8.2: snap is the default when routing is available
    $('snap-hint').hidden = ok;
  }
  ctx.onRouterChange = () => { syncSnapAvailability(); requestRoutes(); };
  syncSnapAvailability();
  const newMode = () => $('seg-mode').value;

  // ---------------------------------------------------------------- routing requests (3B hooks in here)
  const inflight = new Set();
  function requestRoutes() {
    if (!ctx.router) return;
    for (const r of editor.pendingRequests()) {
      if (inflight.has(r.key)) continue;
      inflight.add(r.key);
      ctx.router.route(r.from, r.to)
        .then((geometry) => editor.applyRouteResult(r.key, { geometry }))
        .catch((err) => editor.applyRouteResult(r.key, { error: err?.code ?? err?.message ?? 'ERROR' }))
        .finally(() => inflight.delete(r.key));
    }
  }

  // ---------------------------------------------------------------- changes → render, draft, stats, routing
  editor.onChange(() => {
    if (selected !== null && selected >= editor.state.vertices.length) selected = null;
    render();
    saveDraft();
    requestRoutes();
    updateStats();
  });

  function saveDraft() {
    const s = editor.state;
    store.set(DRAFT_KEY, s.vertices.length || s.waypoints.length ? JSON.stringify(editor.toDraft()) : null);
  }
  function restoreDraft() {
    try {
      const d = JSON.parse(store.get(DRAFT_KEY) ?? 'null');
      if (d?.version === 1 && Array.isArray(d.state?.vertices) && (d.state.vertices.length || d.state.waypoints?.length)) {
        editor.load({ vertices: d.state.vertices, waypoints: d.state.waypoints ?? [] }, d.cache ?? {});
        notify(t('route.draftRestored'));
        ctx.results.draftRestored = true;
        setTimeout(() => { if ($('status').textContent === t('route.draftRestored')) notify(null); }, 6000);
      }
    } catch (e) { log(`draft not restored: ${e.message}`, 'fail'); }
  }

  // ---------------------------------------------------------------- planning mode + buttons
  function setPlanning(on) {
    planning = on;
    $('plan-badge').hidden = !on;
    $('plan').setAttribute('aria-pressed', String(on));
    $('plan').textContent = t(on ? 'route.finish' : 'route.plan');
    map.getCanvas().style.cursor = on ? 'crosshair' : '';
    if (!on) selected = null;
    render();
  }
  $('plan').addEventListener('click', () => setPlanning(!planning));
  // "New route" (always visible): clear the current route as one undoable command and start drawing.
  function newRoute() {
    const s = editor.state;
    if ((s.vertices.length || s.waypoints.length) && !confirm(t('route.newConfirm'))) return;
    selected = null;
    if (s.vertices.length || s.waypoints.length) editor.run(clearRoute(editor.state));
    setPlanning(true);
  }
  $('new-route').addEventListener('click', newRoute);
  ctx.isPlanning = () => planning;
  $('r-undo').addEventListener('click', () => editor.undo());
  $('r-redo').addEventListener('click', () => editor.redo());
  $('r-reverse').addEventListener('click', () => editor.run(reverseRoute()));
  $('r-loop').addEventListener('click', () => editor.run(closeLoop(newMode(), editor.state)));
  $('r-delete').addEventListener('click', deleteSelected);
  $('r-clear').addEventListener('click', () => {
    if (!confirm(t('route.clearConfirm'))) return;
    selected = null;
    editor.run(clearRoute(editor.state));   // one command: a single "undo" brings everything back
  });
  function deleteSelected() {
    if (selected === null) return;
    const i = selected;
    selected = null;
    editor.run(deletePoint(i, editor.state));
  }
  document.addEventListener('keydown', (e) => {
    if (e.target.closest?.('input, textarea, select')) return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z' && !e.shiftKey) { e.preventDefault(); editor.undo(); }
    else if ((e.ctrlKey || e.metaKey) && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); editor.redo(); }
    else if ((k === 'delete' || k === 'backspace') && planning && selected !== null) { e.preventDefault(); deleteSelected(); }
  });

  // ---------------------------------------------------------------- map input
  const hit = (e, layers) => map.queryRenderedFeatures(e.point, { layers: layers.filter((l) => map.getLayer(l)) })[0];

  map.on('mousedown', (e) => {
    if (!planning || e.originalEvent.button !== 0) return;
    const f = hit(e, ['route-points', 'route-mid']);
    if (!f) return;
    e.preventDefault();                        // stop map panning while dragging a handle
    drag = { kind: f.properties.kind, index: f.properties.index, start: e.lngLat, moved: false };
    map.getCanvas().style.cursor = 'grabbing';
  });
  map.on('mousemove', (e) => {
    if (planning && !drag) map.getCanvas().style.cursor = hit(e, ['route-points', 'route-mid']) ? 'grab' : 'crosshair';
    if (!drag) return;
    drag.moved = true;
    drag.lngLat = e.lngLat;
    // live preview without creating commands
    const src = map.getSource('route-handles');
    const data = editor.state.vertices.map((v, i) => pt(
      drag.kind === 'vertex' && i === drag.index ? [e.lngLat.lng, e.lngLat.lat] : [v.lon, v.lat],
      { kind: 'vertex', index: i, first: i === 0, selected: i === selected }));
    if (drag.kind === 'mid') data.push(pt([e.lngLat.lng, e.lngLat.lat], { kind: 'vertex', index: -1, first: false, selected: true }));
    src.setData(FC(data));
  });
  map.on('mouseup', () => {
    if (!drag) return;
    const d = drag;
    drag = null;
    map.getCanvas().style.cursor = 'crosshair';
    if (!d.moved) {                            // a click on a handle: select the vertex
      if (d.kind === 'vertex') { selected = selected === d.index ? null : d.index; render(); }
      return;
    }
    const p = [d.lngLat.lng, d.lngLat.lat];   // [lon, lat]
    if (d.kind === 'vertex') editor.run(movePoint(d.index, p, editor.state));
    else editor.run(insertPoint(d.index, p, editor.state));
    swallowClick = true;
  });
  let swallowClick = false;
  map.on('click', (e) => {
    if (swallowClick) { swallowClick = false; return; }
    if (!planning) return;
    if (hit(e, ['route-points', 'route-mid', 'route-waypoints'])) return;
    selected = null;
    editor.run(addPoint([e.lngLat.lng, e.lngLat.lat], newMode()));
  });

  // Waypoints: right-click on the map (desktop equivalent of a long press), click a waypoint to edit.
  map.on('contextmenu', (e) => {
    if (!planning) return;
    e.preventDefault();
    const id = `w${Date.now().toString(36)}`;
    editor.run(addWaypoint({ id, lon: e.lngLat.lng, lat: e.lngLat.lat, name: '', note: '' }));
    openWaypointForm(id);
  });
  map.on('click', 'route-waypoints', (e) => { e.preventDefault?.(); openWaypointForm(e.features[0].properties.id); swallowClick = true; });

  let popup = null;
  function openWaypointForm(id) {
    const w = editor.state.waypoints.find((x) => x.id === id);
    if (!w) return;
    popup?.remove();
    const el = document.createElement('form');
    el.className = 'wp-form';
    el.innerHTML = `<label>${t('wp.name')} <input name="name" maxlength="60"></label>
      <label>${t('wp.note')} <input name="note" maxlength="200"></label>
      <div class="row"><button class="btn btn-primary" type="submit">${t('wp.save')}</button>
      <button class="btn" type="button" data-act="delete">${t('wp.delete')}</button></div>`;
    el.name.value = w.name; el.note.value = w.note;
    el.addEventListener('submit', (ev) => {
      ev.preventDefault();
      editor.run(editWaypoint(id, { name: el.name.value.trim(), note: el.note.value.trim() }, editor.state));
      popup.remove();
    });
    el.querySelector('[data-act=delete]').addEventListener('click', () => { editor.run(deleteWaypoint(id, editor.state)); popup.remove(); });
    popup = new maplibregl.Popup({ closeOnClick: true, maxWidth: '260px' }).setLngLat([w.lon, w.lat]).setDOMContent(el).addTo(map);
    setTimeout(() => el.name.focus(), 0);
  }

  // ---------------------------------------------------------------- stats + profile (from the full geometry)
  async function updateStats() {
    const seq = ++statsSeq;
    const line = editor.geometry();
    if (line.length < 2) { $('profile-box').hidden = true; $('stats').innerHTML = ''; hoverMarker.remove(); return; }
    const t0 = performance.now();
    const pts = resampleLine(line, 20);
    let elevs;
    try { elevs = await sampler.elevations(pts.map((s) => s.point)); }
    catch (err) {
      if (seq === statsSeq) { notify(t('error.elevation', { message: err.message })); log(`elevation sampling failed: ${err.message}`, 'fail'); }
      return;
    }
    if (seq !== statsSeq) return; // a newer edit exists: drop this stale result
    const ms = Math.round(performance.now() - t0);
    samples = pts.map((s, i) => ({ ...s, elevation: elevs[i] }));
    const st = computeElevationStats(elevs, { stepM: 20 });
    const dist = pts.at(-1).distance;
    const totalMin = Math.round(naismithSeconds(dist, st.ascent) / 60);
    const m = (v) => (v === null ? '—' : `${fmtNumber(Math.round(v))} ${t('unit.m')}`);
    const provisional = editor.segments().some((s) => s.provisional);
    const stat = (value, unit, label, cls = '') =>
      `<div class="stat ${cls}"><span class="v">${value}</span>${unit ? `<span class="u">${unit}</span>` : ''}<span class="l">${label}</span></div>`;
    const n0 = (v) => (v === null ? '—' : fmtNumber(Math.round(v)));
    const warn = [st.incomplete && t('stats.incomplete'), provisional && t('stats.provisional')].filter(Boolean);
    $('stats').innerHTML = `
      <div class="rp-main">
        ${stat(fmtNumber(dist / 1000, { maximumFractionDigits: dist < 10_000 ? 2 : 1 }), t('unit.km'), t('stats.distance'), 'big')}
        ${stat(n0(st.ascent), t('unit.m'), t('stats.ascent'), 'up')}
        ${stat(n0(st.descent), t('unit.m'), t('stats.descent'), 'down')}
        ${stat(`${Math.floor(totalMin / 60)}:${String(totalMin % 60).padStart(2, '0')}`, t('unit.hours'), t('stats.duration'))}
      </div>
      <div class="rp-sub"><span>${t('stats.minmax')} ${m(st.min)} / ${m(st.max)}</span>
        <span class="muted">${t('stats.source')}: ${t('stats.sourceValue', { z: samplingZoom })} · ${ms} ms</span>
        ${warn.map((w) => `<span class="warn">${t('stats.warning')}: ${w}</span>`).join('')}</div>`;
    $('profile-box').hidden = !showProfile;
    renderProfile($('profile'), samples, (i) => hoverMarker.setLngLat(samples[i].point).addTo(map), { smoothed: st.smoothed, min: st.min, max: st.max, compact: true });
  }

  // Elevation stats + profile can be hidden (owner request); remembered in prefs.
  let showProfile = loadPrefs().showProfile !== false;
  function applyProfileVisibility() {
    $('show-profile').checked = showProfile;
    $('stats').hidden = !showProfile;
    if (!showProfile) { $('profile-box').hidden = true; hoverMarker.remove(); }
    else if (editor.geometry().length >= 2) updateStats();
  }
  $('show-profile').addEventListener('change', (e) => { showProfile = e.target.checked; savePrefs({ showProfile }); applyProfileVisibility(); });
  $('profile-close').addEventListener('click', () => { showProfile = false; savePrefs({ showProfile }); applyProfileVisibility(); });
  // Compact (figures only) ↔ expanded (figures + profile); remembered.
  let expanded = loadPrefs().profileExpanded !== false;
  function applyExpanded() {
    $('profile-box').classList.toggle('collapsed', !expanded);
    $('profile-toggle').setAttribute('aria-expanded', String(expanded));
    if (!expanded) hoverMarker.remove();
    else if (!$('profile-box').hidden && samples.length) requestAnimationFrame(() => updateStats());
  }
  $('profile-toggle').addEventListener('click', () => { expanded = !expanded; savePrefs({ profileExpanded: expanded }); applyExpanded(); });
  applyExpanded();
  applyProfileVisibility();

  restoreDraft();
  globalThis.__topo3d && (globalThis.__topo3d.editor = editor);
  return { addRouteLayers, editor, setPlanning, newRoute };
}
