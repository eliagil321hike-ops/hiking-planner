// View mode ("צפייה", D-066). Added only: a saved route shown without the route tool bars — the map buttons stay,
// a bar at the bottom holds the name and figures (graph folded), "עריכה" and close. A split route is shown in its
// day colours, numbers, lodgings (fixed) and the day chips as a legend (days.js, read-only).
//
// Owner decisions 2026-11-06: the eye replaces "פתח" as the card's main button; the map buttons all stay; name +
// folded figures; split = colours + numbers + lodgings + legend; leave by "עריכה" (as the card's "ערוך") or X
// (closes the route).

import { statIcon } from './stat-icons.js';

const PHONE = matchMedia('(max-width: 600px)');

export function initView(ctx) {
  const { map, $, t, fmtNumber } = ctx;
  const R = () => ctx.routeLib;
  const hover = new maplibregl.Marker({ color: '#2a241d', scale: 0.7 });
  const n0 = (v) => fmtNumber(Math.round(v ?? 0));
  const km = (m) => fmtNumber((m ?? 0) / 1000, { maximumFractionDigits: (m ?? 0) < 10_000 ? 2 : 1 });
  let on = false, graph = false, id = null, fitted = false, saved = null;

  const split = () => !!R()?.daySplits?.()?.lodgings?.length;
  const graphBox = () => (split() ? $('days-profile') : $('view-profile'));

  async function enter(rec) {
    if (ctx.days?.isOpen?.()) ctx.days.close();   // the editable days screen of the route shown before
    R().openSaved(rec, { edit: false });       // leaves any earlier view first (route.js hook)
    on = true; graph = false; id = rec.id; fitted = false; saved = rec;
    document.body.classList.add('view-mode');
    $('view-bar').hidden = false;
    $('vb-name').textContent = rec.name ?? '';
    $('vb-dot').style.background = rec.color ?? '';
    const n = rec.daySplits?.lodgings?.length ? rec.daySplits.lodgings.length + 1 : 0;
    $('vb-days').hidden = !n;
    $('vb-days').textContent = n ? t('days.count', { n }) : '';
    figures(rec.stats);
    syncGraph();
    if (R().figures()) onFigures();
    else if (rec.bbox) { const b = rec.bbox; fit([[b[0], b[1]], [b[2], b[3]]], false); }
    ctx.results.view = { on: true, id };
  }

  function exit() {
    if (!on) return;
    on = false; graph = false;
    document.body.classList.remove('view-mode');
    $('view-bar').hidden = true;
    $('view-profile').hidden = true;
    if (ctx.days?.isView?.()) ctx.days.close();
    hover.remove();
    document.documentElement.style.setProperty('--view-h', '0px');
    ctx.results.view = { on: false, id: null };
  }

  function figures(st) {
    $('vb-stats').innerHTML = st ? `<span><b>${km(st.distance)}</b><i>${t('unit.km')}</i></span>` +
      `<span class="up">${statIcon('up', 15)}<b>${n0(st.ascent)}</b><i>${t('unit.m')}</i></span>` +
      `<span class="down">${statIcon('down', 15)}<b>${n0(st.descent)}</b><i>${t('unit.m')}</i></span>` : '';
  }

  // the route's figures arrive (or change): days colours, bar, graph, first fit
  function onFigures() {
    if (!on) return;
    if (!R()?.hasRoute?.()) { exit(); return; }
    const f = R().figures();
    if (!f) return;
    figures(f);
    if (split() && !ctx.days.isOpen()) ctx.days.openView();
    syncGraph();
    if (!fitted) { fitted = true; fit(f.profile, false); }
  }
  const prev = ctx.onRouteFigures;
  ctx.onRouteFigures = () => { prev?.(); onFigures(); };

  function syncGraph() {
    $('vb-graph').setAttribute('aria-expanded', String(graph));
    $('vb-graph').title = t(graph ? 'view.hideGraph' : 'view.showGraph');
    $('vb-graph').setAttribute('aria-label', $('vb-graph').title);
    const sp = split();
    $('view-profile').hidden = !graph || sp;
    if (sp && ctx.days?.isView?.()) { $('days-profile').hidden = !graph; if (graph) ctx.days.render(); }
    if (graph && !sp) R().drawProfileInto($('view-profile').querySelector('.vp-svg'), (pt) => hover.setLngLat(pt).addTo(map));
    if (!graph) hover.remove();
    requestAnimationFrame(() => {
      document.documentElement.style.setProperty('--vb-h', `${$('view-bar').offsetHeight}px`);
      const h = $('view-bar').offsetHeight + (graph ? graphBox().offsetHeight + 10 : 0);
      document.documentElement.style.setProperty('--view-h', `${on ? h + 12 : 0}px`);
      ctx.results.view = { on, id, graph, split: sp };
    });
  }

  // fit the route into the map between the top bars, the day chips and the bottom bar (+ graph)
  function fit(coords, animate = true) {
    if (!coords?.length) return;
    let w = 180, s = 90, e = -180, n = -90;
    for (const p of coords) { w = Math.min(w, p[0]); e = Math.max(e, p[0]); s = Math.min(s, p[1]); n = Math.max(n, p[1]); }
    const bottom = ($('view-bar').offsetHeight || 56) + (graph ? (graphBox().offsetHeight || 190) + 10 : 0) + 36;
    const pad = PHONE.matches ? { top: split() ? 170 : 120, bottom, left: 30, right: 50 } : { top: split() ? 130 : 90, bottom, left: 70, right: 90 };
    try { map.fitBounds([[w, s], [e, n]], { padding: pad, maxZoom: 15, duration: animate ? 700 : 0 }); } catch { /* view smaller than the padding */ }
  }

  $('vb-graph').addEventListener('click', () => {
    graph = !graph;
    syncGraph();
    const f = R().figures();
    if (f) requestAnimationFrame(() => fit(f.profile));
  });
  $('vb-edit').addEventListener('click', () => { if (id) ctx.library?.edit(id); });   // as the card's "ערוך": original or copy
  $('vb-close').addEventListener('click', async () => {
    if (!on) return;
    exit();
    await R().closeRoute();
  });
  addEventListener('keydown', (e) => { if (on && e.key === 'Escape' && !document.querySelector('dialog[open]')) $('vb-close').click(); });

  ctx.view = { enter, exit, fit, isOn: () => on, saved: () => saved };
  return ctx.view;
}
