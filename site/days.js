// Day split ("חלוקה לימים", D-065). Added only: the route builder, its figures, saving and the library work exactly
// as before; this module hooks in through ctx.routeLib (split kept with the route) and its own elements.
//
// Owner decisions 2026-11-05: entry button beside "save" in its own bar; inside, a "route building / days" switch;
// automatic split balanced by distance + ascent (100 m ascent = 1 km), preferring campsites, springs, water,
// shelters and personal points; lodgings dragged on the map or by their boundary in the graph, snapping to such a
// place within 150 m; a lodging may be off the route (dashed line, not counted); no times, dates or warnings
// about them; a table of distance / ascent / descent; day colours only while the days screen is open; one GPX with
// a track per day; a bottom drawer on a phone; "N days" on the library card.

import {
  autoSplit, anchorLodgings, dayStats, suggestDays, maxDaysFor, snapTarget, dayColor, cleanSplit,
  SPLIT_VERSION, MIN_DAYS, FAR_M, CONNECT_M, LODGING_KINDS,
} from './days-core.js';
import { renderDaysProfile } from './days-profile.js';
import { statIcon } from './stat-icons.js';
import { routeToGpx, gpxFileName, downloadText } from './gpx.js';
import { loadPrefs, savePrefs } from './prefs.js';

const FC = (features) => ({ type: 'FeatureCollection', features });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TENT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 19 12 5l8.5 14Z" fill="#203449"/><path d="M12 11.5 9.2 19h5.6Z" fill="#fff"/></svg>';
const PLACE_KEY = { camp: 'days.placeCamp', spring: 'days.placeSpring', water: 'days.placeWater', shelter: 'days.placeShelter' };
const PHONE = matchMedia('(max-width: 600px)');
const DIM = '#A9B4BF';   // a day that is not the selected one: a light grey-blue (lighter --frame), so the selected day stands out
// D-068: every day line is a white casing under the day colour, both from one width table (px at zoom 7/10/12/14/16)
// so the casing is always 3–4 px wider; a dimmed day lowers the opacity of both lines together.
const DAY_W = [3.5, 5, 6.5, 9, 13];
const CASE_W = [6.5, 8, 10, 13, 17];
const zw = (w) => ['interpolate', ['linear'], ['zoom'], 7, w[0], 10, w[1], 12, w[2], 14, w[3], 16, w[4]];
const DIM_OP = 0.75;
// D-068: the summary and the profile fold on a computer; a smaller screen starts with the profile folded until the
// owner chooses (the choice is remembered in this browser, not in the route)
const SMALL = () => innerWidth < 1366 || innerHeight < 800;
const CHEV = '<svg class="chev" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';

export function initDays(ctx) {
  const { map, $, t, fmtNumber, notify } = ctx;
  const R = () => ctx.routeLib;
  let on = false;
  let viewOnly = false;            // D-066: shown from view mode — colours, numbers, lodgings and the chips only, nothing editable
  let sel = null;                 // selected day (null = whole trek)
  let fig = null;                 // the route figures the screen is drawn from
  let cuts = [];                  // [0, boundary sample indices…, last]
  let anchors = [];               // [{ i, offset }] per lodging
  let lodgeMarkers = [];
  let fold = { panel: false, prof: false };   // D-068: folded summary / profile (computer only)
  const hover = new maplibregl.Marker({ color: '#2a241d', scale: 0.7 });
  const n0 = (v) => fmtNumber(Math.round(v ?? 0));
  const km = (m) => fmtNumber(m / 1000, { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  const lodgingName = (l, k) => l.name || t('days.lodging', { n: k + 1 });

  // ---------------------------------------------------------------- map layers (drawn only while the screen is open)
  function addLayers() {
    if (map.getSource('days-route')) return;
    const under = map.getLayer('topo-poi-dot') ? 'topo-poi-dot' : undefined;   // like the route: under point icons
    for (const id of ['days-route', 'days-links', 'days-badges']) map.addSource(id, { type: 'geojson', data: FC([]) });
    const hidden = { visibility: 'none' };
    // D-068: the casing is added in the same step and from the same source, so a day line is never drawn without it
    map.addLayer({ id: 'days-casing', type: 'line', source: 'days-route', layout: { ...hidden, 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#ffffff', 'line-opacity': ['get', 'opacity'], 'line-width': zw(CASE_W) } }, under);
    map.addLayer({ id: 'days-line', type: 'line', source: 'days-route', layout: { ...hidden, 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-opacity': ['get', 'opacity'], 'line-width': zw(DAY_W) } }, under);
    map.addLayer({ id: 'days-link', type: 'line', source: 'days-links', layout: { ...hidden, 'line-cap': 'round' },
      paint: { 'line-color': '#203449', 'line-width': 2, 'line-dasharray': [1.5, 1.6], 'line-opacity': 0.9 } });
    map.addLayer({ id: 'days-badge', type: 'circle', source: 'days-badges', layout: hidden,
      paint: { 'circle-radius': 10, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2, 'circle-opacity': ['get', 'opacity'], 'circle-stroke-opacity': ['get', 'opacity'] } });
    map.addLayer({ id: 'days-badge-n', type: 'symbol', source: 'days-badges',
      layout: { ...hidden, 'text-field': ['get', 'n'], 'text-font': ctx.results.topo?.labelFont ?? ['Noto Sans Bold'], 'text-size': 12, 'text-allow-overlap': true, 'text-ignore-placement': true },
      paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(10,31,10,0.35)', 'text-halo-width': 0.6, 'text-opacity': ['get', 'opacity'] } });
  }
  const LAYERS = ['days-casing', 'days-line', 'days-link', 'days-badge', 'days-badge-n'];
  // while the days screen is open the route's own line and control points step aside (the day lines replace them;
  // D-068: the route's dark casing steps aside too — the days have their own white casing) and come back exactly as
  // they were when it closes
  const ROUTE_OWN = ['route-casing', 'route-line', 'route-points'];
  let routeVis = null;
  function showLayers(v) {
    for (const id of LAYERS) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', v ? 'visible' : 'none');
    if (v && routeVis === null) {
      routeVis = {};
      for (const id of ROUTE_OWN) if (map.getLayer(id)) { routeVis[id] = map.getLayoutProperty(id, 'visibility') ?? 'visible'; map.setLayoutProperty(id, 'visibility', 'none'); }
    } else if (!v && routeVis !== null) {
      for (const [id, vis] of Object.entries(routeVis)) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis);
      routeVis = null;
    }
  }

  // ---------------------------------------------------------------- places a lodging may snap to
  async function candidates() {
    const out = [];
    for (const src of ['poi-camp', 'poi-water', 'poi-other']) {
      const s = map.getSource(src);
      if (!s?.getData) continue;
      try {
        const d = await s.getData();
        for (const f of d?.features ?? []) {
          const k = f.properties?.kind ?? (src === 'poi-camp' ? 'camp' : src === 'poi-water' ? 'water' : null);
          if (!LODGING_KINDS.includes(k) || f.geometry?.type !== 'Point') continue;
          const [lon, lat] = f.geometry.coordinates;
          out.push({ lon, lat, kind: k, name: f.properties.name || t(PLACE_KEY[k]), key: f.properties.pk ?? `${lon},${lat}` });
        }
      } catch { /* a source without data yet */ }
    }
    for (const p of ctx.markers?.points?.() ?? []) out.push({ lon: p.lon, lat: p.lat, kind: 'personal', name: p.name, key: `pt:${p.id}` });
    return out;
  }
  let candCache = [];
  const refreshCandidates = async () => { candCache = await candidates(); ctx.results.daysCandidates = candCache.length; };

  // ---------------------------------------------------------------- state helpers
  const split = () => R()?.daySplits?.() ?? null;
  function setSplit(s) { R().setDaySplits(s); }
  function compute() {
    fig = R()?.figures?.() ?? null;
    const s = split();
    if (!fig || !s) { cuts = []; anchors = []; return false; }
    anchors = anchorLodgings(fig.profile, s.lodgings);
    cuts = [0, ...anchors.map((a) => a.i), fig.profile.length - 1];
    return true;
  }
  const isManual = (s) => s?.lodgings.some((l) => l.manual || l.custom);

  async function makeSplit(n) {
    fig = R().figures();
    if (!fig) return;
    await refreshCandidates();
    const lodgings = autoSplit(fig.profile, Math.max(MIN_DAYS, Math.min(maxDaysFor(fig.profile), n)), candCache);
    setSplit({ version: SPLIT_VERSION, lodgings });
  }

  // ---------------------------------------------------------------- open / close
  async function open() {
    fig = R()?.figures?.();
    if (!fig || fig.profile.length < 7) { notify(t('days.tooShort')); return; }
    if (R().isPlanning()) R().setPlanning(false);
    ctx.markers?.setMode?.(null);
    on = true; sel = null;
    document.body.classList.add('days-mode');
    loadFold();
    $('r-days').setAttribute('aria-pressed', 'true');
    for (const id of ['days-panel', 'days-bar', 'days-profile']) $(id).hidden = false;
    placeProfile();
    addLayers();
    showLayers(true);
    fitRoute(fig.line ?? fig.profile, false);
    if (!split()) {
      // the points of the route's area load with the view: wait for it before looking for lodgings
      await new Promise((ok) => { let done = false; const fin = () => { if (!done) { done = true; ok(); } }; map.once('idle', fin); setTimeout(fin, 4000); });
      await makeSplit(suggestDays(fig.profile));
    } else refreshCandidates();
    render();
    // fit again now that the panel (on a phone: the drawer) has its real height, so the route is not under it
    if (fig) fitRoute(fig.profile, false);
    ctx.results.daysOpen = true;
  }
  function close() {
    if (!on) return;
    on = false; sel = null; viewOnly = false;
    document.body.classList.remove('days-mode', 'days-folded');
    $('days-panel').classList.remove('folded');
    $('days-profile').classList.remove('folded');
    $('r-days').setAttribute('aria-pressed', 'false');
    for (const id of ['days-panel', 'days-bar', 'days-profile']) $(id).hidden = true;
    showLayers(false);
    for (const m of lodgeMarkers) m.remove();
    lodgeMarkers = [];
    hover.remove();
    document.documentElement.style.setProperty('--days-prof-h', '0px');
    ctx.results.daysOpen = false;
  }

  // D-066 view mode: the saved split drawn read-only (no panel, no handles, lodgings fixed); the graph is shown by view.js
  function openView() {
    fig = R()?.figures?.();
    if (!fig || !split()) return false;
    on = true; viewOnly = true; sel = null;
    applyFold();   // D-068: nothing is folded in view mode (its bar has its own graph button)
    ctx.markers?.setMode?.(null);
    $('days-bar').hidden = false;
    $('days-panel').hidden = true;
    placeProfile();
    addLayers();
    showLayers(true);
    refreshCandidates();
    render();
    ctx.results.daysOpen = true;
    return true;
  }

  // ---------------------------------------------------------------- view
  function fitRoute(coords, animate = true) {
    if (viewOnly) { ctx.viewMode?.fit?.(coords, animate); return; }   // D-066: view mode knows its own bars
    if (!coords?.length) return;
    let w = 180, s = 90, e = -180, n = -90;
    for (const p of coords) { w = Math.min(w, p[0]); e = Math.max(e, p[0]); s = Math.min(s, p[1]); n = Math.max(n, p[1]); }
    const phone = PHONE.matches;
    const sheet = phone ? Math.min(innerHeight * 0.62, $('days-panel').offsetHeight || innerHeight * 0.5) : 0;
    const pad = phone
      ? { top: 130, bottom: sheet + 24, left: 30, right: 50 }
      // RTL: the panel is on the right; D-068: its real width and the profile's real height, so a folded panel frees room
      : { top: 130, bottom: ($('days-profile').offsetHeight || 196) + 40, left: 60, right: ($('days-panel').offsetWidth || 340) + 90 };
    try { map.fitBounds([[w, s], [e, n]], { padding: pad, maxZoom: 15, duration: animate ? 700 : 0 }); } catch { /* view smaller than the padding */ }
  }

  function render() {
    if (!on) return;
    if (!compute()) { renderPanelEmpty(); return; }
    const s = split();
    const days = dayStats(fig.profile, anchors);
    const P = fig.profile;
    const op = (k) => (sel === null || sel === k ? 1 : 0.45);
    const lineOp = (k) => (sel === null || sel === k ? 1 : DIM_OP);   // D-068: casing and colour dim together
    const lineColor = (k) => (sel === null || sel === k ? dayColor(k) : DIM);
    // map: one coloured line per day, the day number in the middle, dashed links to off-route lodgings
    map.getSource('days-route')?.setData(FC(days.map((d, k) => ({ type: 'Feature', properties: { day: k, color: lineColor(k), opacity: lineOp(k) },
      geometry: { type: 'LineString', coordinates: P.slice(d.from, d.to + 1).map((p) => [p[0], p[1]]) } }))));
    map.getSource('days-badges')?.setData(FC(days.map((d, k) => {
      const mid = P[d.from + Math.floor((d.to - d.from) / 2)];
      return { type: 'Feature', properties: { n: String(k + 1), color: dayColor(k), opacity: op(k) }, geometry: { type: 'Point', coordinates: [mid[0], mid[1]] } };
    })));
    map.getSource('days-links')?.setData(FC(s.lodgings.flatMap((l, k) => (anchors[k].offset > CONNECT_M
      ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[P[anchors[k].i][0], P[anchors[k].i][1]], [l.lon, l.lat]] } }] : []))));
    renderLodgings(s);
    renderChips(days);
    if (!viewOnly) renderPanel(s, days);
    renderProfile(s);
    ctx.results.days = { n: days.length, sel, days: days.map((d) => ({ distance: Math.round(d.distance), ascent: Math.round(d.ascent), descent: Math.round(d.descent) })),
      lodgings: s.lodgings.map((l, k) => ({ name: lodgingName(l, k), lon: l.lon, lat: l.lat, offset: Math.round(anchors[k].offset), at: anchors[k].i, manual: l.manual, source: l.source?.kind ?? null })) };
  }

  // lodgings: draggable map markers (HTML), snapping to a known place within 150 m
  function renderLodgings(s) {
    while (lodgeMarkers.length > s.lodgings.length) lodgeMarkers.pop().remove();
    s.lodgings.forEach((l, k) => {
      let m = lodgeMarkers[k];
      if (!m) {
        const elx = document.createElement('div');
        elx.className = 'lodge';
        elx.innerHTML = `<span class="lodge-tag"></span><span class="lodge-dot">${TENT}</span>`;
        m = new maplibregl.Marker({ element: elx, draggable: !viewOnly, anchor: 'bottom', offset: [0, 14] });
        m._k = k;
        m.on('dragstart', () => { m._dragged = true; });
        m.on('drag', () => { const p = m.getLngLat(); elx.classList.toggle('snap', !!snapTarget([p.lng, p.lat], candCache)); });
        m.on('dragend', () => { elx.classList.remove('snap'); dropLodging(m._k, m.getLngLat()); setTimeout(() => { m._dragged = false; }, 0); });
        elx.addEventListener('click', (e) => { e.stopPropagation(); if (!m._dragged && !viewOnly) editLodging(m._k); });
        lodgeMarkers[k] = m;
      }
      m._k = k;
      const elx = m.getElement();
      elx.querySelector('.lodge-tag').textContent = lodgingName(l, k);
      elx.classList.toggle('far', anchors[k].offset > FAR_M);
      elx.classList.toggle('dim', sel !== null && sel !== k && sel !== k + 1);
      elx.title = lodgingName(l, k);
      elx.dataset.k = String(k);
      m.setLngLat([l.lon, l.lat]).addTo(map);
    });
  }
  function dropLodging(k, ll) {
    const s = split();
    if (!s) return;
    const target = snapTarget([ll.lng, ll.lat], candCache);
    const l = s.lodgings[k];
    const next = target
      ? { ...l, lon: target.lon, lat: target.lat, source: { key: target.key, kind: target.kind }, name: l.custom ? l.name : target.name, manual: true }
      : { ...l, lon: ll.lng, lat: ll.lat, source: null, name: l.custom ? l.name : '', manual: true };
    s.lodgings[k] = next;
    setSplit(s);
    if (target) notify(t('days.snapped', { name: target.name }));
    render();
  }
  // a boundary dragged in the graph: the lodging moves to that route point (or the known place right there)
  function moveBoundary(k, i, done) {
    const s = split();
    if (!s || !fig) return;
    const p = fig.profile[i];
    const target = done ? snapTarget([p[0], p[1]], candCache) : null;
    const l = s.lodgings[k - 1];
    s.lodgings[k - 1] = target
      ? { ...l, lon: target.lon, lat: target.lat, source: { key: target.key, kind: target.kind }, name: l.custom ? l.name : target.name, manual: true }
      : { ...l, lon: p[0], lat: p[1], source: null, name: l.custom ? l.name : '', manual: true };
    setSplit(s);
    render();
  }

  // ---------------------------------------------------------------- chips, panel, profile
  function renderChips(days) {
    const box = $('days-bar').querySelector('.days-chips');
    box.innerHTML = `<button type="button" class="lib-chip" data-day="" aria-pressed="${sel === null}">${t('days.all')}</button>` +
      days.map((d, k) => `<button type="button" class="lib-chip" data-day="${k}" aria-pressed="${sel === k}"><i class="day-dot" style="--d:${dayColor(k)}"></i>${t('days.dayN', { n: k + 1 })}<span>${km(d.distance)}</span></button>`).join('');
  }
  $('days-bar').addEventListener('click', (e) => { const b = e.target.closest('button[data-day]'); if (b) selectDay(b.dataset.day === '' ? null : Number(b.dataset.day)); });
  function selectDay(k) {
    sel = k === sel ? null : k;
    render();
    if (fig) fitRoute(sel === null ? fig.profile : fig.profile.slice(cuts[sel], cuts[sel + 1] + 1));
  }

  function renderPanelEmpty() {
    $('days-panel').innerHTML = `${head()}<p class="days-empty">${t('days.needRoute')}</p>`;
  }
  const head = () => `<button type="button" class="days-grab" data-act="grab" aria-label="${t('days.collapse')}"></button>
    <div class="days-head"><div class="days-switch" role="group"><button type="button" data-act="build" aria-pressed="false">${t('days.build')}</button><button type="button" data-act="days" aria-pressed="true">${t('days.days')}</button></div>
    ${foldBtn()}
    <button type="button" class="lib-x" data-act="close" aria-label="${t('days.close')}" title="${t('days.close')}"><svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg></button></div>`;
  // D-068: the summary's fold button — the same "הסתר" button as the route panel's, kept in place when folded so focus stays
  const foldBtn = () => `<button type="button" class="panel-btn hide-btn days-fold" data-act="fold" aria-controls="days-panel" aria-expanded="${!fold.panel}"
    aria-label="${t(fold.panel ? 'days.expandSum' : 'days.foldSum')}" title="${t(fold.panel ? 'days.expandSum' : 'days.foldSum')}"><span>${t('route.hide')}</span>${CHEV}</button>`;
  function renderPanel(s, days) {
    const n = days.length;
    const tot = days.reduce((a, d) => ({ distance: a.distance + d.distance, ascent: a.ascent + d.ascent, descent: a.descent + d.descent }), { distance: 0, ascent: 0, descent: 0 });
    const far = anchors.map((a, k) => ({ k, m: a.offset })).filter((x) => x.m > FAR_M);
    const prof = $('days-profile');
    const keepProf = prof.parentElement === $('days-panel');
    $('days-panel').innerHTML = `${head()}
      <div class="days-mini" aria-hidden="${!fold.panel}"><b>${n}</b><span>${t('days.miniDays')}</span><b>${km(tot.distance)}</b><span>${t('unit.km')}</span>
        ${far.length ? `<span class="days-far" role="img" aria-label="${esc(t('days.miniWarn', { n: far.length }))}" title="${esc(far.map((x) => t('days.far', { n: x.k + 1, m: n0(x.m) })).join('\n'))}">!</span>` : ''}</div>
      <div class="days-title"><h2>${t('days.summary')}</h2><small>${n - 1 === 1 ? t('days.sub1', { n }) : t('days.sub', { n, l: n - 1 })}</small></div>
      <div class="days-count"><span>${t('days.countLabel')}</span>
        <button type="button" class="lib-btn icon" data-act="less" aria-label="${t('days.less')}" title="${t('days.less')}" ${n <= MIN_DAYS ? 'disabled' : ''}><svg class="ic" width="16" height="16" viewBox="0 0 24 24"><path d="M5 12h14"/></svg></button>
        <output>${n}</output>
        <button type="button" class="lib-btn icon" data-act="more" aria-label="${t('days.more')}" title="${t('days.more')}" ${n >= maxDaysFor(fig.profile) ? 'disabled' : ''}><svg class="ic" width="16" height="16" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button></div>
      <div class="days-prof-slot"></div>
      <table class="days-table"><thead><tr><th>${t('days.day')}</th><th>${t('days.distance')}</th><th>${t('days.ascent')}</th><th>${t('days.descent')}</th></tr></thead>
        <tbody>${days.map((d, k) => `<tr data-day="${k}" aria-selected="${sel === k}"><td><span class="day-n"><i class="day-dot" style="--d:${dayColor(k)}"></i>${k + 1}</span>${anchors[k] && anchors[k].offset > FAR_M ? `<span class="days-far" title="${esc(t('days.farShort', { m: n0(anchors[k].offset) }))}">!</span>` : ''}</td>
          <td>${km(d.distance)}<i>${t('unit.km')}</i></td><td>${statIcon('up', 15)}${n0(d.ascent)}<i>${t('unit.m')}</i></td><td>${statIcon('down', 15)}${n0(d.descent)}<i>${t('unit.m')}</i></td></tr>`).join('')}</tbody>
        <tfoot><tr><td>${t('days.total')}</td><td>${km(tot.distance)}<i>${t('unit.km')}</i></td><td>${n0(tot.ascent)}<i>${t('unit.m')}</i></td><td>${n0(tot.descent)}<i>${t('unit.m')}</i></td></tr></tfoot></table>
      ${far.length ? `<div class="days-notes">${far.map((x) => `<p>${esc(t('days.far', { n: x.k + 1, m: n0(x.m) }))}</p>`).join('')}</div>` : ''}
      <div class="days-actions"><button type="button" class="lib-btn primary" data-act="resplit">${t('days.resplit')}</button>
        <button type="button" class="lib-btn" data-act="gpx"><svg class="ic" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg> ${t('days.gpx')}</button>
        <button type="button" class="lib-btn quiet" data-act="remove">${t('days.remove')}</button></div>
      <p class="days-foot">${t('days.foot')}</p>`;
    if (keepProf || PHONE.matches) $('days-panel').querySelector('.days-prof-slot').replaceWith(prof);
    syncSheet();
  }
  $('days-panel').addEventListener('click', async (e) => {
    const row = e.target.closest('tr[data-day]');
    if (row) { selectDay(Number(row.dataset.day)); return; }
    const a = e.target.closest('[data-act]')?.dataset.act;
    if (!a) return;
    const s = split();
    if (a === 'close' || a === 'days') { if (a === 'close') close(); return; }
    if (a === 'build') { close(); R().setPlanning(true); return; }
    if (a === 'fold') { setFold('panel', !fold.panel); return; }
    if (a === 'grab') { $('days-panel').classList.toggle('collapsed'); syncSheet(); return; }
    if (a === 'less' || a === 'more' || a === 'resplit') {
      if (isManual(s) && !confirm(t('days.resplitConfirm'))) return;
      const n = (s?.lodgings.length ?? 1) + 1 + (a === 'less' ? -1 : a === 'more' ? 1 : 0);
      sel = null;
      await makeSplit(n);
      render();
      return;
    }
    if (a === 'remove') {
      if (!confirm(t('days.removeConfirm'))) return;
      setSplit(null);
      close();
      return;
    }
    if (a === 'gpx') {
      const f = R().figures();
      if (!f || !s) return;
      const rec = { name: R().name(), updatedAt: new Date().toISOString(), editor: { state: { waypoints: R().routeMarks() } }, profile: f.profile, geometry: f.line, daySplits: s };
      const text = routeToGpx(rec);
      ctx.results.daysGpx = text;
      downloadText(text, gpxFileName(rec.name));
    }
  });

  // ---------------------------------------------------------------- D-068 folding (computer only)
  function loadFold() {
    const p = loadPrefs();
    fold = { panel: p.daysPanelFolded === true, prof: typeof p.daysProfFolded === 'boolean' ? p.daysProfFolded : SMALL() };
  }
  const profBtn = document.createElement('button');
  profBtn.type = 'button';
  profBtn.className = 'panel-btn hide-btn days-prof-fold';
  profBtn.setAttribute('aria-controls', 'days-profile');
  $('days-profile').querySelector('.days-prof-head').append(profBtn);
  profBtn.addEventListener('click', () => setFold('prof', !fold.prof));
  function applyFold() {
    const desk = on && !PHONE.matches && !viewOnly;
    const fp = desk && fold.panel, fq = desk && fold.prof;
    $('days-panel').classList.toggle('folded', fp);
    document.body.classList.toggle('days-folded', fp);
    $('days-profile').classList.toggle('folded', fq);
    const pb = $('days-panel').querySelector('.days-fold');
    if (pb) { const l = t(fp ? 'days.expandSum' : 'days.foldSum'); pb.setAttribute('aria-expanded', String(!fp)); pb.setAttribute('aria-label', l); pb.title = l; }
    $('days-panel').querySelector('.days-mini')?.setAttribute('aria-hidden', String(!fp));
    const pl = t(fq ? 'days.expandProf' : 'days.foldProf');
    profBtn.innerHTML = `<span>${t(fq ? 'days.show' : 'route.hide')}</span>${CHEV}`;
    profBtn.setAttribute('aria-expanded', String(!fq)); profBtn.setAttribute('aria-label', pl); profBtn.title = pl;
    if (desk) document.documentElement.style.setProperty('--days-prof-h', `${$('days-profile').offsetHeight + 12}px`);
    ctx.results.daysFold = { panel: fp, prof: fq };
  }
  function setFold(which, v) {
    fold[which] = v;
    savePrefs(which === 'panel' ? { daysPanelFolded: v } : { daysProfFolded: v });
    applyFold();
    if (which === 'prof' && !v && fig && split()) renderProfile(split());   // drawn again at its real size
  }

  function renderProfile(s) {
    const box = $('days-profile');
    box.querySelector('.days-prof-head b').textContent = sel === null ? t('days.profAll') : t('days.profDay', { n: sel + 1 });
    renderDaysProfile(box.querySelector('.days-prof-svg'), fig.profile, cuts, dayColor, {
      sel,
      label: (k) => lodgingName(s.lodgings[k - 1], k - 1),
      handles: !viewOnly,   // D-066: no dragging in view mode
      onDrag: viewOnly ? undefined : (k, i, done) => moveBoundary(k, i, done),
      onHover: (i) => { if (i === null) hover.remove(); else hover.setLngLat([fig.profile[i][0], fig.profile[i][1]]).addTo(map); },
    });
    if (!PHONE.matches && !viewOnly) document.documentElement.style.setProperty('--days-prof-h', `${box.offsetHeight + 12}px`);
    applyFold();
  }

  // the graph lives in the drawer on a phone, at the bottom of the screen on a computer
  function placeProfile() {
    const prof = $('days-profile');
    if (viewOnly) { if (prof.parentElement !== document.body) document.body.append(prof); return; }   // D-066: view mode places it
    if (PHONE.matches) { const slot = $('days-panel').querySelector('.days-prof-slot'); if (slot) slot.replaceWith(prof); }
    else if (prof.parentElement !== document.body) { document.body.append(prof); }
    document.documentElement.style.setProperty('--days-prof-h', PHONE.matches ? '0px' : `${(prof.offsetHeight || 196) + 12}px`);
  }
  PHONE.addEventListener?.('change', () => { if (on) { placeProfile(); render(); applyFold(); } });
  function syncSheet() {
    requestAnimationFrame(() => document.documentElement.style.setProperty('--days-sheet-h', `${PHONE.matches && on ? $('days-panel').offsetHeight : 0}px`));
  }

  // ---------------------------------------------------------------- lodging name
  function editLodging(k) {
    const s = split();
    if (!s) return;
    const l = s.lodgings[k];
    const dlg = $('days-dialog');
    dlg.innerHTML = `<form method="dialog" class="lib-form"><h2>${esc(t('days.editTitle', { n: k + 1 }))}</h2>
      <label class="lib-field"><span>${t('days.name')}</span><input name="name" maxlength="80" value="${esc(l.name)}" placeholder="${esc(t('days.namePh'))}"></label>
      <div class="lib-dlg-actions"><button class="lib-btn" value="cancel">${t('days.cancel')}</button><button class="lib-btn primary" value="save">${t('days.save')}</button></div></form>`;
    dlg.onclose = () => {
      if (dlg.returnValue !== 'save') return;
      const v = dlg.querySelector('input[name=name]').value.trim().slice(0, 80);
      const s2 = split();
      s2.lodgings[k] = { ...s2.lodgings[k], name: v, custom: !!v };
      setSplit(s2);
      render();
    };
    dlg.showModal();
    dlg.querySelector('input').select();
  }

  // ---------------------------------------------------------------- button + following the route
  $('r-days').addEventListener('click', () => (on ? close() : open()));
  ctx.onRouteFigures = () => {
    const f = R()?.figures?.();
    $('r-days').disabled = !(f && f.profile.length >= 7);
    if (!f && !R()?.hasRoute?.() && split()) setSplit(null);   // the route was cleared: its days go with it
    if (!on) return;
    if (!f) { if (!R()?.hasRoute?.()) close(); return; }
    if (!split()) { close(); return; }                          // another route was opened
    render();
  };

  ctx.days = { open, openView, isView: () => viewOnly, close, isOpen: () => on, selectDay, setFold, fitRoute, addLayers, render, moveBoundary, dropLodging: (k, lon, lat) => dropLodging(k, { lng: lon, lat }), refreshCandidates };
  return ctx.days;
}
