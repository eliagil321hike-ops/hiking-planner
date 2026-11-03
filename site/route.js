// Route builder UI (SPEC §8.2, Phase 3A). All editing logic lives in vendor/editor (packages/editor):
// commands with exact inverses, undo/redo, segment cache and the stale-response guard. This module only maps
// user input to commands, renders the editor state, keeps the draft, and shows stats + profile.
//
// Map interaction while planning: click = add point · drag a point = move · drag a small mid-segment handle =
// insert · click a point then Delete = remove · right-click = waypoint · Ctrl+Z / Ctrl+Y = undo / redo.

import { renderProfile } from './profile.js';
import { statIcon } from './stat-icons.js';
import { resampleLine, computeElevationStats, naismithSeconds } from './vendor/geo/index.js';
import {
  RouteEditor, addPoint, movePoint, insertPoint, deletePoint, setSegmentMode, reverseRoute, closeLoop,
  addWaypoint, editWaypoint, deleteWaypoint, clearRoute,
} from './vendor/editor/editor.js';
import { store } from './satellite.js';
import { loadPrefs, savePrefs } from './prefs.js';

const DRAFT_KEY = 'topo3d.draft';
export const ROUTE_COLOR = '#39ff14';   // fluorescent green (owner request); the default of the colour choice
// Route colours to choose from (owner, D-049): shown as dots only.
export const ROUTE_COLORS = ['#39ff14', '#ff2bd6', '#00e5ff', '#ffe500', '#ff6a00', '#7c4dff'];
const META_KEY = 'topo3d.routeMeta';   // { name, color } of the route being edited
function routeColor() {
  try { const c = JSON.parse(store.get(META_KEY) ?? '{}')?.color; return ROUTE_COLORS.includes(c) ? c : ROUTE_COLOR; } catch { return ROUTE_COLOR; }
}
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
  let drawProfile = null, lastSize = '';   // redraw of the elevation graph at its current size (D-054)
  // My Routes (D-056): figures of the current line for saving; resolves when the figures are up to date.
  let lastFigures = null;
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
    // Owner (D-062): point icons (campsites, water, …) are drawn above the route line so it never hides them;
    // only the route's handles and waypoints stay above the icons (they are what you drag and click).
    const underIcons = map.getLayer('topo-poi-dot') ? 'topo-poi-dot' : undefined;
    map.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' },
      // Owner (D-043): the planned route is the dominant line — wider than national trails at every zoom
      // (national z12/14/16: 6/9/15 px, casing 8.5/11.5/17.5). D-062: about 10 % thinner from z12 on.
      paint: { 'line-color': '#0a1f0a', 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 6, 10, 8, 12, 9.8, 14, 13, 16, 18.6], 'line-opacity': 0.8 } }, underIcons);
    map.addLayer({ id: 'route-line', type: 'line', source: 'route', filter: ['==', ['get', 'status'], 'ok'],
      layout: { 'line-join': 'round' },
      paint: { 'line-color': routeColor(), 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 3.5, 10, 5, 12, 6.8, 14, 10, 16, 15.6], 'line-dasharray': ['case', ['==', ['get', 'mode'], 'free'], ['literal', [2, 1.2]], ['literal', [1, 0]]] } }, underIcons);
    map.addLayer({ id: 'route-provisional', type: 'line', source: 'route', filter: ['!=', ['get', 'status'], 'ok'],
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': ['case', ['==', ['get', 'status'], 'error'], '#ff2d55', '#e8e8e8'], 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 4, 14, 8, 16, 11], 'line-dasharray': [0.1, 1.6] } }, underIcons);
    map.addLayer({ id: 'route-mid', type: 'circle', source: 'route-handles', filter: ['==', ['get', 'kind'], 'mid'],
      paint: { 'circle-radius': 4.5, 'circle-color': '#ffffff', 'circle-opacity': 0.9, 'circle-stroke-color': '#0a1f0a', 'circle-stroke-width': 1.5 } });
    map.addLayer({ id: 'route-points', type: 'circle', source: 'route-handles', filter: ['==', ['get', 'kind'], 'vertex'],
      paint: {
        'circle-radius': ['case', ['get', 'selected'], 9, 6.5],
        'circle-color': ['case', ['get', 'first'], routeColor(), '#ffffff'],
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
    $('seg-toggle').disabled = !ok;
    syncSegToggle();
  }
  function syncSegToggle() {
    const snap = $('seg-mode').value === 'snap';
    $('seg-toggle').setAttribute('aria-pressed', String(snap));
    $('seg-toggle').title = t(snap ? 'route.modeSnap' : 'route.modeFree');
    $('seg-toggle').setAttribute('aria-label', $('seg-toggle').title);
  }
  // one button: snap to trails ↔ straight line (D-049); the hidden <select> keeps the value
  $('seg-toggle').addEventListener('click', () => {
    $('seg-mode').value = $('seg-mode').value === 'snap' ? 'free' : 'snap';
    $('seg-mode').dispatchEvent(new Event('change'));
    syncSegToggle();
  });
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
    syncDock();
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
    $('plan').title = t(on ? 'route.finish' : 'route.plan');
    $('plan').setAttribute('aria-label', $('plan').title);
    syncDock();
    map.getCanvas().style.cursor = on ? 'crosshair' : '';
    if (!on) selected = null;
    render();
  }
  $('plan').addEventListener('click', () => setPlanning(!planning));
  // "New route" (always visible): clear the current route as one undoable command and start drawing.
  // A saved, unchanged route is simply closed; unsaved work asks first (save / continue without saving / cancel).
  async function newRoute() {
    const s = editor.state;
    if (!(await guardUnsaved())) return false;
    selected = null;
    if (s.vertices.length || s.waypoints.length) editor.run(clearRoute(editor.state));
    setMeta({ name: '', savedId: null, savedSig: null });
    setPlanning(true);
    return true;
  }
  $('new-route').addEventListener('click', async () => { if (await newRoute() && !expanded) setExpanded(true); });
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
  // Hover: the handle hit-test (a feature query on the GPU frame) runs at most every 50 ms, not on every mouse
  // event (perf review 2026-11-03); dragging always follows the mouse.
  let lastHover = 0;
  map.on('mousemove', (e) => {
    if (planning && !drag) {
      const now = performance.now();
      if (now - lastHover > 50) { lastHover = now; map.getCanvas().style.cursor = hit(e, ['route-points', 'route-mid']) ? 'grab' : 'crosshair'; }
    }
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

  // ---------------------------------------------------------------- route dock: figures + profile (D-049)
  const n0 = (v) => (v === null || v === undefined ? '—' : fmtNumber(Math.round(v)));
  const pair = (a, b) => `<div class="rd-pair">${a}${b}</div>`;
  const stat = (value, unit, label, cls = '') =>
    `<span class="rd-st ${cls}">${statIcon(cls)}<b>${value}</b><i>${unit}</i><small>${label}</small></span>`;
  async function updateStats() {
    const seq = ++statsSeq;
    const line = editor.geometry();
    const empty = line.length < 2;
    $('profile-box').classList.toggle('empty', empty);
    $('draw-hint').hidden = !empty;
    if (empty) {
      lastFigures = null;
      samples = [];
      $('stats').innerHTML = ''; $('rd-dist').textContent = '0'; $('profile').innerHTML = ''; $('pill-stats').innerHTML = '';
      hoverMarker.remove();
      return;
    }
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
    const km = fmtNumber(dist / 1000, { maximumFractionDigits: dist < 10_000 ? 2 : 1 });
    const provisional = editor.segments().some((s) => s.provisional);
    const warn = [st.incomplete && t('stats.incomplete'), provisional && t('stats.provisional')].filter(Boolean);
    $('rd-dist').textContent = km;
    // owner (D-049): no walking time; ascent | descent, then max | min
    $('stats').innerHTML =
      pair(stat(n0(st.ascent), t('unit.m'), t('stats.ascent'), 'up'), stat(n0(st.descent), t('unit.m'), t('stats.descent'), 'down')) +
      pair(stat(n0(st.max), t('unit.m'), t('stats.max'), 'max'), stat(n0(st.min), t('unit.m'), t('stats.min'), 'min')) +
      warn.map((w) => `<div class="rd-warn">${t('stats.warning')}: ${w}</div>`).join('');
    $('stats').title = `${t('stats.source')}: ${t('stats.sourceValue', { z: samplingZoom })} · ${ms} ms`;
    lastFigures = { seq, line, distance: dist, ascent: st.ascent, descent: st.descent, min: st.min, max: st.max,
      profile: samples.map((p) => [p.point[0], p.point[1], Math.round(p.distance * 10) / 10, p.elevation === null ? null : Math.round(p.elevation * 10) / 10]) };
    $('pill-stats').innerHTML = `<b>${km}</b><i>${t('unit.km')}</i><span class="up">${statIcon('up', 15)}${n0(st.ascent)}</span><span class="down">${statIcon('down', 15)}${n0(st.descent)}</span>`;
    drawProfile = () => renderProfile($('profile'), samples, (i) => hoverMarker.setLngLat(samples[i].point).addTo(map), { smoothed: st.smoothed, min: st.min, max: st.max, compact: true });
    if (expanded) drawProfile();
  }
  // The graph is drawn for the size of its box; redraw whenever that box changes (panel shown, window resized,
  // the figures column grows), otherwise an old drawing is stretched or cut (owner screenshot, 2026-11-02).
  new ResizeObserver(() => {
    const p = $('profile'), size = `${p.clientWidth}x${p.clientHeight}`;
    if (size === lastSize || !p.clientWidth) return;
    lastSize = size;
    if (expanded && drawProfile) drawProfile();   // directly: a rAF can starve while the map renders
  }).observe($('profile'));

  // Dock visibility (owner, D-049): no route button — the dock is shown while editing or while a route exists
  // ("מסלול חדש" opens it); inside, the panel can be hidden (tool bar + pill stay).
  let expanded = loadPrefs().profileExpanded !== false;
  const hasRoute = () => editor.state.vertices.length > 0 || editor.state.waypoints.length > 0;
  function syncDock() {
    const open = planning || hasRoute();
    $('route-dock').hidden = !open;
    $('profile-box').hidden = !expanded;
    $('route-pill').hidden = expanded || editor.geometry().length < 2;
    $('profile-toggle').setAttribute('aria-expanded', String(expanded));
    document.body.classList.toggle('dock-open', open);
    if (!expanded || !open) { hoverMarker.remove(); $('color-pop').hidden = true; }
    document.body.classList.toggle('dock-panel', open && expanded);
    requestAnimationFrame(() => {
      const root = document.documentElement.style;
      root.setProperty('--dock-h', `${open ? $('route-dock').offsetHeight + 12 : 0}px`);
      // the bottom-left scale/credits only move up for the full-width data panel, not for the corner tool bar
      root.setProperty('--panel-h', `${open && expanded ? $('profile-box').offsetHeight + 8 : 0}px`);
    });
  }
  function setExpanded(on) {
    expanded = on; savePrefs({ profileExpanded: on }); syncDock();
    if (on && samples.length) updateStats();
  }
  $('profile-toggle').addEventListener('click', () => setExpanded(false));
  $('route-pill').addEventListener('click', () => setExpanded(true));
  ctx.routeDock = { setExpanded, isOpen: () => !$('route-dock').hidden, isExpanded: () => expanded };

  // Route name (click to edit) and colour (dots), kept with the draft in this browser.
  function getMeta() { try { return JSON.parse(store.get(META_KEY) ?? '{}') ?? {}; } catch { return {}; } }
  function setMeta(patch) {
    const m = { ...getMeta(), ...patch };
    store.set(META_KEY, JSON.stringify(m));
    applyMeta();
  }
  function applyMeta() {
    syncSaved();
    const m = getMeta();
    const name = $('route-name');
    if (document.activeElement !== name) name.textContent = m.name || t('route.defaultName');
    name.classList.toggle('placeholder', !m.name);
    const c = routeColor();
    $('route-color').style.setProperty('--c', c);
    if (map.getLayer('route-line')) {
      map.setPaintProperty('route-line', 'line-color', c);
      map.setPaintProperty('route-points', 'circle-color', ['case', ['get', 'first'], c, '#ffffff']);
    }
    $('color-pop').querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.color === c)));
    ctx.results.routeMeta = { name: m.name ?? '', color: c };
  }
  const nameEl = $('route-name');
  nameEl.addEventListener('focus', () => { if (!getMeta().name) nameEl.textContent = ''; });
  nameEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); } if (e.key === 'Escape') { nameEl.textContent = getMeta().name ?? ''; nameEl.blur(); } });
  nameEl.addEventListener('blur', () => setMeta({ name: nameEl.textContent.trim().slice(0, 80) }));
  for (const c of ROUTE_COLORS) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'color-dot'; b.dataset.color = c; b.style.setProperty('--c', c); b.setAttribute('role', 'option');
    b.addEventListener('click', () => { setMeta({ color: c }); $('color-pop').hidden = true; });
    $('color-pop').append(b);
  }
  $('route-color').addEventListener('click', (e) => { e.stopPropagation(); $('color-pop').hidden = !$('color-pop').hidden; });
  document.addEventListener('click', (e) => { if (!$('color-pop').contains(e.target)) $('color-pop').hidden = true; });

  // ---------------------------------------------------------------- My Routes link (D-056)
  // The route on the map may be linked to a saved route (savedId). "Saved" means: the editor state, name and
  // colour are exactly what was last saved (savedSig). Nothing is saved automatically.
  const signature = () => JSON.stringify([editor.state, getMeta().name ?? '', routeColor()]);
  const isDirty = () => hasRoute() && getMeta().savedSig !== signature();
  function syncSaved() {
    const m = getMeta(), chip = $('rd-saved');
    if (!chip) return;
    const state = !hasRoute() ? 'none' : isDirty() ? (m.savedId ? 'changed' : 'unsaved') : 'saved';
    chip.dataset.state = state;
    chip.textContent = state === 'none' ? '' : t(`lib.state.${state}`);
    chip.hidden = state === 'none';
    $('r-save').classList.toggle('attn', state === 'unsaved' || state === 'changed');
    ctx.results.savedState = state;
  }
  editor.onChange(syncSaved);
  async function guardUnsaved() {
    if (!isDirty()) return true;
    return ctx.library ? ctx.library.confirmUnsaved() : confirm(t('route.newConfirm'));
  }
  addEventListener('beforeunload', (e) => { if (isDirty()) { e.preventDefault(); e.returnValue = ''; } });
  async function snapshot() {
    if (editor.geometry().length < 2) return null;
    // wait until the figures belong to the current line (elevation sampling is asynchronous)
    for (let i = 0; i < 150 && lastFigures?.seq !== statsSeq; i++) await new Promise((ok) => setTimeout(ok, 100));
    const f = lastFigures, d = editor.toDraft();
    if (!f || f.seq !== statsSeq) throw new Error('figures-not-ready');
    return { name: getMeta().name || '', color: routeColor(), editor: d, geometry: editor.geometry().map((p) => [p[0], p[1]]),
      profile: f.profile, stats: { distance: f.distance, ascent: f.ascent, descent: f.descent, min: f.min, max: f.max } };
  }
  function markSaved(rec) {
    setMeta({ name: rec.name, savedId: rec.id });
    setMeta({ savedSig: signature() });
  }
  /** Show a saved route (never shown automatically): load it into the editor, fit the view, show the panel. */
  function openSaved(rec, { edit = false } = {}) {
    selected = null;
    editor.load({ vertices: rec.editor.state.vertices, waypoints: rec.editor.state.waypoints ?? [] }, rec.editor.cache ?? {});
    setMeta({ name: rec.name, color: ROUTE_COLORS.includes(rec.color) ? rec.color : ROUTE_COLOR, savedId: rec.id });
    setMeta({ savedSig: signature() });
    setPlanning(edit);
    if (!expanded) setExpanded(true);
    const b = rec.bbox;
    if (b) map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: { top: 90, bottom: 240, left: 80, right: 90 }, maxZoom: 15, duration: 900 });
  }
  ctx.routeLib = { hasRoute, isDirty, snapshot, markSaved, openSaved, guardUnsaved, linkedId: () => getMeta().savedId ?? null,
    unlink: () => setMeta({ savedId: null, savedSig: null }),
    color: routeColor, setPlanning };

  syncDock();
  applyMeta();
  updateStats();

  restoreDraft();
  globalThis.__topo3d && (globalThis.__topo3d.editor = editor);
  return { addRouteLayers, editor, setPlanning, newRoute };
}
