// Marked points (D-063, owner approved the design 2026-11-03).
//   Personal points: a layer of their own (crimson pins), shown when the layer is switched on (remembered);
//     "marking mode" = roam the map and tap to mark, no route. Each point is saved by its own "save".
//   Route marks: points marked next to a route (a viewpoint beside the trail); the route does not pass through
//     them. They are the route editor's waypoints with a symbol, saved with the route in My Routes.
// A tap on an existing map point (spring, viewpoint, campsite…) takes its name and symbol. Right-click marks too:
// inside route building a route mark, otherwise a personal point. The old waypoints (no symbol) are gone.

import { MARK_ICONS, PERSONAL_RED, PIN, iconSquare, pinImageId, registerMarkerImages, isMarkIcon } from './marker-icons.js';
import { loadPrefs, savePrefs } from './prefs.js';
import { pointsToGpx, gpxFileName, downloadText } from './gpx.js';
import { LibraryError } from './library-store.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const FC = (features) => ({ type: 'FeatureCollection', features });
const pt = (c, props) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: props });

// map point layers → the symbol a mark takes when you tap one of their points
const POI_LAYERS = ['poi-camp', 'poi-water', 'poi-parking', 'poi-other', 'topo-poi-icon', 'topo-peaks'];
const OWN_POI_SOURCES = ['poi-camp', 'poi-water', 'poi-parking', 'poi-other'];
const KIND_ICON = { camp: 'tent', water: 'tap', parking: 'parking', spring: 'spring', viewpoint: 'viewpoint', shelter: 'shelter',
  waterfall: 'waterfall', pool: 'pool', ruins: 'ruins' };
const ICON_OFFSET = [0, (PIN.h - PIN.tipY - 1) * PIN.cssWidth / PIN.w];   // the dot (not the image edge) on the spot

export function initMarkers(ctx) {
  const { $, t, map, notify, fmtNumber } = ctx;
  let mode = null;                          // null | 'personal' | 'route'
  let points = [];                          // personal points (cache of the store)
  let showLayer = loadPrefs().pointsLayer !== false;
  let pending = null;                       // the point being marked (shown until saved or cancelled)
  const view = { text: '', icon: 'all' };
  const lib = () => ctx.library?.lib();
  const panel = $('points-panel'), dlg = $('mk-dialog');

  // ---------------------------------------------------------------- map layers
  registerMarkerImages(map);
  function addLayers() {
    map.addSource('mk-personal', { type: 'geojson', data: FC([]) });
    map.addSource('mk-pending', { type: 'geojson', data: FC([]) });
    const pin = { 'icon-image': ['get', 'image'], 'icon-anchor': 'bottom', 'icon-offset': ICON_OFFSET, 'icon-allow-overlap': true, 'icon-ignore-placement': true };
    map.addLayer({ id: 'mk-personal', type: 'symbol', source: 'mk-personal', layout: { ...pin, visibility: showLayer ? 'visible' : 'none' } });
    map.addLayer({ id: 'mk-pending', type: 'symbol', source: 'mk-pending', layout: pin, paint: { 'icon-opacity': 0.85 } });
    renderPersonal();
  }
  // added by app.js after the route layers, so the pins are on top of everything

  const markedKeys = () => points.filter((p) => p.source?.key).map((p) => p.source.key);
  const baseFilters = {};
  function renderPersonal() {
    if (!map.getSource('mk-personal')) return;
    map.getSource('mk-personal').setData(FC(points.map((p) => pt([p.lon, p.lat], { id: p.id, name: p.name, image: pinImageId(isMarkIcon(p.icon) ? p.icon : 'general', PERSONAL_RED) }))));
    map.setLayoutProperty('mk-personal', 'visibility', showLayer || mode === 'personal' ? 'visible' : 'none');
    // a map point that has been marked hides its small icon: the pin takes its place (own point sources only)
    const keys = showLayer ? markedKeys() : [];
    for (const id of OWN_POI_SOURCES) {
      if (!map.getLayer(id)) continue;
      if (!(id in baseFilters)) baseFilters[id] = map.getFilter(id) ?? null;
      const not = ['!', ['in', ['coalesce', ['get', 'pk'], ''], ['literal', keys]]];
      map.setFilter(id, keys.length ? (baseFilters[id] ? ['all', baseFilters[id], not] : not) : baseFilters[id]);
    }
  }
  function showPending(p, scope) {
    pending = p;
    const fill = scope === 'route' ? ctx.routeLib.color() : PERSONAL_RED;
    map.getSource('mk-pending')?.setData(FC(p ? [pt([p.lon, p.lat], { image: pinImageId(isMarkIcon(p.icon) ? p.icon : 'general', fill) })] : []));
  }

  // ---------------------------------------------------------------- data
  async function reload() {
    try { points = (await lib()?.listPoints()) ?? []; } catch { points = []; }
    renderPersonal();
    renderMenu();
    if (!panel.hidden) renderPanel();
    ctx.results.points = points.length;
  }

  // ---------------------------------------------------------------- modes
  function setMode(m) {
    if (m === 'route' && !ctx.routeLib.dockOpen()) m = null;
    if (m && ctx.routeLib.isPlanning()) ctx.routeLib.setPlanning(false);
    mode = m;
    $('r-mark').setAttribute('aria-pressed', String(mode === 'route'));
    const b = $('mark-banner');
    b.hidden = !mode;
    $('mark-banner-text').textContent = mode === 'route' ? t('mk.bannerRoute') : t('mk.bannerPersonal');
    document.body.classList.toggle('marking', !!mode);
    map.getCanvas().style.cursor = mode ? 'crosshair' : '';
    renderPersonal();
    renderMenu();
    ctx.results.markMode = mode;
  }
  $('r-mark').addEventListener('click', () => setMode(mode === 'route' ? null : 'route'));
  $('mark-done').addEventListener('click', () => setMode(null));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && mode && !document.querySelector('dialog[open]')) setMode(null); });

  // ---------------------------------------------------------------- tapping the map
  const near = (e, layers) => {
    const p = e.point, r = 6;
    return map.queryRenderedFeatures([[p.x - r, p.y - r], [p.x + r, p.y + r]], { layers: layers.filter((l) => map.getLayer(l)) });
  };
  /** The map point under the tap, if any: { lon, lat, name, icon, key }. */
  function poiAt(e) {
    for (const f of near(e, POI_LAYERS)) {
      const p = f.properties ?? {};
      if (p.point_count) continue;                       // a cluster, not a point
      const [lon, lat] = f.geometry.coordinates;
      let icon = 'general';
      if (f.layer.id === 'topo-peaks') icon = p.class === 'saddle' ? 'general' : 'peak';
      else if (p.kind) icon = KIND_ICON[p.kind] ?? 'general';
      else if (f.layer.id === 'poi-camp') icon = 'tent';
      else if (f.layer.id === 'poi-water') icon = 'tap';
      else if (f.layer.id === 'poi-parking') icon = 'parking';
      else {
        const img = f.layer.layout?.['icon-image'];
        const k = typeof img === 'string' ? img : img?.name;
        if (typeof k === 'string') icon = k.replace(/^topo-/, '');
      }
      if (!isMarkIcon(icon)) icon = 'general';
      const name = p['name:he'] || p.name || p['name:latin'] || '';
      return { lon, lat, name, icon, ele: Number.isFinite(+p.ele) ? +p.ele : null, key: p.pk ?? null };
    }
    return null;
  }

  map.on('click', (e) => {
    if (e.defaultPrevented) return;
    // a marked point: open it (or, in route marking, add it to the route)
    // while drawing a route, a tap adds a route point (route.js); only route marks still open from there
    const own = near(e, ctx.routeLib.isPlanning() ? ['route-marks'] : ['mk-personal', 'route-marks'])[0];
    if (own) {
      if (own.layer.id === 'route-marks') return editRouteMark(own.properties.id);
      const p = points.find((x) => x.id === own.properties.id);
      if (!p) return;
      if (mode === 'route') return markFlow('route', { lon: p.lon, lat: p.lat, name: p.name, icon: p.icon, ele: p.ele });
      return editPersonal(p);
    }
    if (!mode) return;
    const poi = poiAt(e);
    markFlow(mode, poi ?? { lon: e.lngLat.lng, lat: e.lngLat.lat, name: '', icon: 'general', ele: null, key: null });
  });
  // Right-click (owner): inside route building a route mark, otherwise a personal point.
  map.on('contextmenu', (e) => {
    e.preventDefault?.();
    const scope = ctx.routeLib.isPlanning() || mode === 'route' ? 'route' : 'personal';
    const poi = poiAt(e);
    markFlow(scope, poi ?? { lon: e.lngLat.lng, lat: e.lngLat.lat, name: '', icon: 'general', ele: null, key: null });
  });

  // ---------------------------------------------------------------- the marking dialog
  const icons = (sel) => `<fieldset class="mk-icons"><legend>${t('mk.icon')}</legend>${MARK_ICONS.map((k) => `<label class="mk-icon">
      <input type="radio" name="icon" value="${k}" ${k === sel ? 'checked' : ''}>${iconSquare(k)}<span>${t(`mk.icons.${k}`)}</span></label>`).join('')}</fieldset>`;
  const where = (p) => `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`;
  /**
   * The one dialog for every point: name + symbol + save. `kind`: 'personal' | 'route' (new), 'edit-personal' |
   * 'edit-route'. Resolves to { action, name, icon } or null when cancelled.
   */
  function pointDialog(kind, p) {
    return new Promise((resolve) => {
      const isNew = kind === 'personal' || kind === 'route';
      const title = { personal: t('mk.newPersonal'), route: t('mk.newRoute'), 'edit-personal': t('mk.editPersonal'), 'edit-route': t('mk.editRoute') }[kind];
      const saveLabel = kind === 'route' ? t('mk.addToRoute') : t('mk.save');
      const fill = kind.endsWith('route') ? ctx.routeLib.color() : PERSONAL_RED;
      dlg.innerHTML = `<form method="dialog" class="lib-form mk-form">
        <div class="mk-head">${iconSquare(p.icon, 26, fill)}<h2>${title}</h2><span class="mk-where" dir="ltr">${where(p)}<span class="mk-ele"></span></span></div>
        <label class="lib-field"><span>${t('mk.name')}</span><input name="name" maxlength="80" value="${esc(p.name)}" placeholder="${t('mk.namePlaceholder')}"></label>
        ${icons(p.icon)}
        <p class="lib-error" role="alert" hidden></p>
        <div class="lib-dlg-actions">
          ${isNew ? '' : `<button type="submit" value="delete" class="lib-btn danger mk-del">${kind === 'edit-route' ? t('mk.removeFromRoute') : t('mk.delete')}</button>`}
          <button type="submit" value="cancel" class="lib-btn">${t('lib.cancel')}</button>
          <button type="submit" value="save" class="lib-btn primary">${saveLabel}</button></div></form>`;
      const form = dlg.querySelector('form');
      const head = form.querySelector('.mk-head .mk-sq');
      form.querySelectorAll('input[name=icon]').forEach((r) => r.addEventListener('change', () => {
        head.outerHTML = iconSquare(r.value, 26, fill);
        if (isNew && pending) showPending({ ...pending, icon: r.value }, kind);
      }));
      // height of the spot (from the map's elevation data) when not known yet
      if (p.ele == null && ctx.sampler) ctx.sampler.elevationAt([p.lon, p.lat]).then((e) => {
        if (e != null) { p.ele = Math.round(e); form.querySelector('.mk-ele').textContent = ` · ${fmtNumber(p.ele)} ${t('unit.m')}`; }
      }).catch(() => {});
      else if (p.ele != null) form.querySelector('.mk-ele').textContent = ` · ${fmtNumber(Math.round(p.ele))} ${t('unit.m')}`;
      const changed = () => form.name.value.trim() !== (p.name ?? '') || form.querySelector('input[name=icon]:checked')?.value !== p.icon;
      let result = null;
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const action = e.submitter?.value ?? 'save';
        if (action === 'cancel' && isNew && changed() && !confirm(t('mk.discardConfirm'))) return;
        if (action === 'delete' && !confirm(kind === 'edit-route' ? t('mk.removeConfirm') : t('mk.deleteConfirm', { name: p.name || t('mk.icons.general') }))) return;
        result = action === 'cancel' ? null : { action, name: form.name.value.trim(), icon: form.querySelector('input[name=icon]:checked')?.value ?? p.icon };
        dlg.close();
      });
      // an unsaved new point also warns when the page is closed (like routes)
      const unload = (e) => { if (isNew) { e.preventDefault(); e.returnValue = ''; } };
      addEventListener('beforeunload', unload);
      dlg.onclose = () => { removeEventListener('beforeunload', unload); resolve(result); };
      dlg.showModal();
      setTimeout(() => form.name.focus(), 0);
    });
  }

  async function markFlow(scope, p) {
    if (dlg.open) return;
    if (scope === 'route' && !ctx.routeLib.dockOpen()) scope = 'personal';
    showPending(p, scope);
    const res = await pointDialog(scope, { ...p });
    showPending(null);
    if (!res) return;
    if (scope === 'route') {
      ctx.routeLib.addRouteMark({ id: `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, lon: p.lon, lat: p.lat,
        name: res.name, icon: res.icon, ...(p.ele != null ? { ele: p.ele } : {}) });
      ctx.results.lastRouteMark = res.name;
      return;
    }
    try {
      await lib().createPoint({ name: res.name, icon: res.icon, lon: p.lon, lat: p.lat, ele: p.ele ?? null,
        source: p.key ? { key: p.key, name: p.name } : null });
      if (!showLayer) setLayer(true);
      await reload();
      toast(t('mk.saved', { name: res.name || t(`mk.icons.${res.icon}`) }));
      ctx.results.lastPoint = res.name;
    } catch (e) { toast(errText(e), true); }
  }
  async function editPersonal(p) {
    const res = await pointDialog('edit-personal', { ...p });
    if (!res) return;
    try {
      if (res.action === 'delete') { await lib().deletePoint(p.id); toast(t('mk.deleted')); }
      else { await lib().updatePoint(p.id, { name: res.name, icon: res.icon }); toast(t('mk.updated')); }
      await reload();
    } catch (e) { toast(errText(e), true); }
  }
  async function editRouteMark(id) {
    const w = ctx.routeLib.routeMarks().find((x) => x.id === id);
    if (!w) return;
    const res = await pointDialog('edit-route', { ...w });
    if (!res) return;
    if (res.action === 'delete') ctx.routeLib.deleteRouteMark(id);
    else ctx.routeLib.editRouteMark(id, { name: res.name, icon: res.icon });
  }

  const errText = (e) => t(`lib.err.${e instanceof LibraryError ? e.code : 'storage'}`, { message: e?.message ?? '' });
  function toast(text, bad = false) {
    notify(text);
    $('status').classList.toggle('ok', !bad);
    setTimeout(() => { if ($('status').textContent === text) notify(null); }, bad ? 8000 : 3500);
  }

  // ---------------------------------------------------------------- layer menu
  function setLayer(on) {
    showLayer = on;
    savePrefs({ pointsLayer: on });
    renderPersonal();
    renderMenu();
  }
  function renderMenu() {
    const sw = $('mk-show');
    if (!sw) return;
    sw.checked = showLayer;
    $('mk-count').textContent = t('mk.count', { n: points.length });
    $('mk-mode').setAttribute('aria-pressed', String(mode === 'personal'));
  }
  $('mk-show').addEventListener('change', (e) => setLayer(e.target.checked));
  $('mk-mode').addEventListener('click', () => { ctx.menus?.closeAll(); setMode(mode === 'personal' ? null : 'personal'); });
  $('mk-list').addEventListener('click', () => { ctx.menus?.closeAll(); openPanel(); });

  // ---------------------------------------------------------------- "my points" window
  function openPanel() { panel.hidden = false; renderPanel(); }
  function closePanel() { panel.hidden = true; }
  const date = (iso) => new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', year: 'numeric' });
  function renderPanel() {
    const q = view.text.trim().toLowerCase();
    const counts = {};
    for (const p of points) counts[p.icon] = (counts[p.icon] ?? 0) + 1;
    if (view.icon !== 'all' && !counts[view.icon]) view.icon = 'all';
    const list = points.filter((p) => (view.icon === 'all' || p.icon === view.icon) && (!q || p.name.toLowerCase().includes(q)))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const chip = (k, label, n) => `<button type="button" class="lib-chip" data-icon="${k}" aria-pressed="${view.icon === k}">${label} <span>${n}</span></button>`;
    panel.innerHTML = `
      <header class="lib-head"><h2>${t('mk.myPoints')}</h2><span class="lib-count">${t('mk.count', { n: points.length })}</span>
        <button type="button" class="lib-x" data-act="close" aria-label="${t('lib.close')}" title="${t('lib.close')}"><svg class="ic" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button></header>
      <div class="lib-tools"><label class="lib-search"><svg class="ic" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5"/></svg>
        <input type="search" value="${esc(view.text)}" placeholder="${t('mk.search')}" aria-label="${t('mk.search')}"></label></div>
      <div class="lib-folders">${chip('all', t('lib.all'), points.length)}${MARK_ICONS.filter((k) => counts[k]).map((k) => chip(k, iconSquare(k, 18), counts[k])).join('')}</div>
      <div class="mk-list">${points.length ? (list.length ? list.map((p) => `<div class="mk-row" data-id="${esc(p.id)}">${iconSquare(p.icon)}
          <div class="mk-row-txt"><b>${esc(p.name || t(`mk.icons.${p.icon}`))}</b><small>${t(`mk.icons.${p.icon}`)} · ${t('mk.savedOn', { d: date(p.updatedAt) })}</small></div>
          <button type="button" class="lib-btn" data-act="show">${t('mk.showOnMap')}</button>
          <button type="button" class="lib-btn icon" data-act="edit" aria-label="${t('mk.edit')}" title="${t('mk.edit')}"><svg class="ic" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 20l4-1 11-11-3-3L5 16z"/><path d="M14 6l3 3"/></svg></button></div>`).join('')
        : `<p class="lib-empty">${t('mk.noResults', { q: esc(view.text) })}</p>`)
        : `<p class="lib-empty"><b>${t('mk.emptyTitle')}</b><br>${t('mk.emptyBody')}</p>`}</div>
      ${points.length ? `<div class="mk-foot"><button type="button" class="lib-btn" data-act="gpx"><svg class="ic" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 4v11m-5-5 5 5 5-5M5 20h14"/></svg> ${t('mk.gpx')}</button></div>` : ''}`;
    const s = panel.querySelector('.lib-search input');
    s.addEventListener('input', () => { view.text = s.value; renderPanel(); const n = panel.querySelector('.lib-search input'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); });
  }
  panel.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.icon) { view.icon = b.dataset.icon; renderPanel(); return; }
    const p = points.find((x) => x.id === b.closest('.mk-row')?.dataset.id);
    switch (b.dataset.act) {
      case 'close': closePanel(); break;
      case 'gpx': downloadText(pointsToGpx(points), gpxFileName(t('mk.myPoints'))); break;
      case 'show':
        if (!p) break;
        if (!showLayer) setLayer(true);
        map.flyTo({ center: [p.lon, p.lat], zoom: Math.max(map.getZoom(), 14), duration: 900 });
        if (matchMedia('(max-width: 600px)').matches) closePanel();
        break;
      case 'edit': if (p) await editPersonal(p); break;
      default:
    }
  });

  ctx.markers = { setMode, mode: () => mode, reload, points: () => points, openPanel, addLayers };
  // the library opens its store asynchronously; points follow it
  setTimeout(() => reload(), 0);
  return ctx.markers;
}
