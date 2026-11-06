// My Routes (D-056): the route library panel, the save dialog, edit (update original / create copy), folders,
// and the "unsaved route" warning. Data: library-store.js (this browser's IndexedDB). Saving is manual only and
// a saved route is shown on the map only when the user opens it.

import { createLibrary, idbAdapter, memoryAdapter, queryRoutes, LibraryError } from './library-store.js';
import { captureMapThumb, sketchThumb, routeBBox } from './thumbnail.js';
import { statIcon } from './stat-icons.js';
import { routeToGpx, gpxFileName, downloadText } from './gpx.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ICON = {
  open: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  eye: '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',   // view mode (D-066)
  edit: '<path d="M4 20l4-1 11-11-3-3L5 16z"/><path d="M14 6l3 3"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  folderPlus: '<path d="M3 6.5h6l2 2h10v10.5H3z"/><path d="M12 11.5v5M9.5 14h5"/>',
  folder: '<path d="M3 6.5h6l2 2h10v10.5H3z"/>',
  pencil: '<path d="M4 20l4-1 11-11-3-3L5 16z"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5"/>',
};
const svg = (k, size = 18) => `<svg class="ic" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${ICON[k]}</svg>`;

export function initLibrary(ctx) {
  const { $, t, map, notify, fmtNumber } = ctx;
  let adapter;
  try { adapter = typeof indexedDB === 'undefined' ? memoryAdapter() : idbAdapter(); } catch { adapter = memoryAdapter(); }
  let lib = createLibrary(adapter);
  const view = { text: '', folder: 'all', sort: 'date' };
  let cache = { routes: [], folders: [] }, loading = false, loadError = null, stripped = false;
  const panel = $('library'), dlg = $('lib-dialog');
  const km = (m) => fmtNumber(m / 1000, { maximumFractionDigits: m < 10_000 ? 2 : 1 });
  const n0 = (v) => (v == null ? '—' : fmtNumber(Math.round(v)));
  const date = (iso) => new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', year: 'numeric' });
  const folderName = (id) => cache.folders.find((f) => f.id === id)?.name ?? null;
  const errText = (e) => t(`lib.err.${e instanceof LibraryError ? e.code : 'storage'}`, { message: e?.message ?? '' });

  // ---------------------------------------------------------------- data
  async function reload() {
    loading = true; loadError = null; render();
    try {
      const [routes, folders] = await Promise.all([lib.listRoutes(), lib.listFolders()]);
      cache = { routes, folders };
    } catch (e) {
      // storage blocked (private window / disabled): keep working for this visit, say clearly it will not last
      if (adapter.persistent) { adapter = memoryAdapter(); lib = createLibrary(adapter); cache = { routes: [], folders: [] }; loadError = e; }
    }
    loading = false;
    if (view.folder !== 'all' && view.folder !== 'none' && !folderName(view.folder)) view.folder = 'all';
    render();
    ctx.results.library = { routes: cache.routes.length, folders: cache.folders.length, persistent: adapter.persistent };
  }

  // ---------------------------------------------------------------- panel
  function render() {
    if (panel.hidden) return;
    const list = queryRoutes(cache.routes, cache.folders, view);
    const count = (id) => cache.routes.filter((r) => (id === 'all' ? true : id === 'none' ? !r.folderId : r.folderId === id)).length;
    const chip = (id, label) => `<button type="button" class="lib-chip" data-folder="${esc(id)}" aria-pressed="${view.folder === id}">${esc(label)} <span>${count(id)}</span></button>`;
    const sel = view.folder !== 'all' && view.folder !== 'none';
    panel.innerHTML = `
      <header class="lib-head">
        <h2>${t('lib.title')}</h2><span class="lib-count">${t('lib.count', { n: cache.routes.length })}</span>
        <button type="button" class="lib-x" data-act="close" aria-label="${t('lib.close')}" title="${t('lib.close')}">${svg('close')}</button>
      </header>
      ${!adapter.persistent ? `<p class="lib-note" role="status">${t('lib.notPersistent')}</p>` : ''}
      <div class="lib-tools">
        <label class="lib-search">${svg('search', 16)}<input type="search" value="${esc(view.text)}" placeholder="${t('lib.search')}" aria-label="${t('lib.search')}"></label>
        <label class="lib-sort"><span>${t('lib.sortBy')}</span><select aria-label="${t('lib.sortBy')}">
          ${['date', 'name', 'distance', 'ascent'].map((k) => `<option value="${k}" ${view.sort === k ? 'selected' : ''}>${t(`lib.sort.${k}`)}</option>`).join('')}
        </select></label>
      </div>
      <div class="lib-folders" role="group" aria-label="${t('lib.folders')}">
        ${chip('all', t('lib.all'))}${chip('none', t('lib.noFolder'))}${cache.folders.map((f) => chip(f.id, f.name)).join('')}
        <button type="button" class="lib-chip lib-newfolder" data-act="new-folder">${svg('folderPlus', 16)} ${t('lib.newFolder')}</button>
      </div>
      ${sel ? `<div class="lib-folderbar"><span>${svg('folder', 14)} ${esc(folderName(view.folder))}</span>
        <button type="button" data-act="rename-folder">${svg('pencil', 14)} ${t('lib.renameFolder')}</button>
        <button type="button" data-act="delete-folder">${svg('trash', 14)} ${t('lib.deleteFolder')}</button></div>` : ''}
      <div class="lib-grid" aria-busy="${loading}">
        ${loading ? '<div class="lib-card skel"></div><div class="lib-card skel"></div>'
          : list.length ? list.map(card).join('') : `<div class="lib-empty">${emptyText()}</div>`}
      </div>`;
    const input = panel.querySelector('.lib-search input');
    input.addEventListener('input', () => { view.text = input.value; const pos = input.selectionStart; render(); const i2 = panel.querySelector('.lib-search input'); i2.focus(); i2.setSelectionRange(pos, pos); });
    panel.querySelector('.lib-sort select').addEventListener('change', (e) => { view.sort = e.target.value; render(); });
  }
  function emptyText() {
    if (loadError) return t('lib.loadError');
    if (!cache.routes.length) return `<b>${t('lib.emptyTitle')}</b><br>${t('lib.emptyBody')}`;
    if (view.text) return t('lib.noResults', { q: esc(view.text) });
    return t('lib.emptyFolder');
  }
  function card(r) {
    const st = r.stats ?? {};
    const minmax = st.min != null && st.max != null ? `<span>${t('lib.height')} <bdi dir="ltr">${n0(st.min)}–${n0(st.max)}</bdi> ${t('unit.m')}</span>` : '';
    return `<article class="lib-card" data-id="${esc(r.id)}">
      <button type="button" class="lib-thumb" data-act="view" aria-label="${t('lib.view')}: ${esc(r.name)}"><img src="${esc(r.thumb ?? '')}" alt="" loading="lazy"><i style="background:${esc(r.color ?? '#39ff14')}"></i></button>
      <div class="lib-body">
        <h3 title="${esc(r.name)}">${esc(r.name)}</h3>
        <p class="lib-folder">${esc(folderName(r.folderId) ?? t('lib.noFolder'))}</p>
        <p class="lib-stats"><b>${km(st.distance ?? 0)}</b> ${t('unit.km')}<span class="up">${statIcon('up', 15)}${n0(st.ascent)} ${t('unit.m')}</span>${minmax}${r.daySplits?.lodgings?.length ? `<span class="lib-days">${t('days.count', { n: r.daySplits.lodgings.length + 1 })}</span>` : ''}</p>
        <p class="lib-date">${t('lib.updated', { d: date(r.updatedAt) })}</p>
      </div>
      <div class="lib-actions">
        <button type="button" class="lib-btn primary" data-act="view">${svg('eye', 16)} ${t('lib.view')}</button>
        <button type="button" class="lib-btn" data-act="edit">${svg('edit', 16)} ${t('lib.edit')}</button>
        <button type="button" class="lib-btn icon" data-act="menu" aria-haspopup="menu" aria-label="${t('lib.more')}" title="${t('lib.more')}">${svg('more', 18)}</button>
      </div>
    </article>`;
  }
  panel.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const id = b.closest('.lib-card')?.dataset.id;
    const rec = id && cache.routes.find((r) => r.id === id);
    if (b.dataset.folder) { view.folder = b.dataset.folder; render(); return; }
    switch (b.dataset.act) {
      case 'close': ctx.menus?.closeAll(); break;
      case 'new-folder': await newFolderFlow(); break;
      case 'rename-folder': await renameFolderFlow(view.folder); break;
      case 'delete-folder': await deleteFolderFlow(view.folder); break;
      case 'open': if (rec) await openFlow(rec, false); break;
      case 'view': if (rec) await viewFlow(rec); break;   // D-066: "צפייה" replaced "פתח" on the card (owner)
      case 'edit': if (rec) await editFlow(rec); break;
      case 'menu': if (rec) cardMenu(b, rec); break;
      default:
    }
  });

  function cardMenu(anchor, rec) {
    document.querySelector('.lib-menu')?.remove();
    const m = document.createElement('div');
    m.className = 'lib-menu'; m.setAttribute('role', 'menu');
    m.innerHTML = [['rename', 'lib.rename'], ['duplicate', 'lib.duplicate'], ['move', 'lib.move'], ['gpx', 'lib.gpx'], ['delete', 'lib.delete']]
      .map(([a, k]) => `<button type="button" role="menuitem" data-m="${a}" class="${a === 'delete' ? 'danger' : ''}">${t(k)}</button>`).join('');
    document.body.append(m);
    const r = anchor.getBoundingClientRect();
    m.style.top = `${Math.min(r.bottom + 4, innerHeight - m.offsetHeight - 8)}px`;
    m.style.left = `${Math.max(8, r.left)}px`;
    m.querySelector('button').focus();
    const close = () => { m.remove(); document.removeEventListener('pointerdown', outside, true); };
    const outside = (ev) => { if (!m.contains(ev.target)) close(); };
    setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
    m.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); close(); anchor.focus(); } });
    m.addEventListener('click', async (ev) => {
      const a = ev.target.closest('button')?.dataset.m;
      if (!a) return;
      close();
      if (a === 'rename') await renameFlow(rec);
      if (a === 'duplicate') await guarded(() => lib.duplicateRoute(rec.id), t('lib.done.duplicated'));
      if (a === 'move') await moveFlow(rec);
      if (a === 'delete') await deleteFlow(rec);
      if (a === 'gpx') { const full = await lib.getRoute(rec.id); if (full) downloadText(routeToGpx(full), gpxFileName(full.name)); ctx.results.lastGpx = full ? routeToGpx(full) : null; }
    });
  }

  // ---------------------------------------------------------------- dialogs
  /** Modal with fields; resolves to { action, values } or null when cancelled. */
  function ask({ title, html = '', actions, init }) {
    return new Promise((resolve) => {
      dlg.innerHTML = `<form method="dialog" class="lib-form"><h2>${title}</h2>${html}
        <p class="lib-error" role="alert" hidden></p>
        <div class="lib-dlg-actions">${actions.map((a) => `<button type="submit" value="${a.value}" class="lib-btn ${a.kind ?? ''}" ${a.autofocus ? 'autofocus' : ''}>${a.label}</button>`).join('')}</div></form>`;
      const form = dlg.querySelector('form');
      init?.(form);
      const done = (v) => { dlg.close(); resolve(v); };
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const action = e.submitter?.value ?? actions.find((a) => a.kind?.includes('primary'))?.value;
        if (action === 'cancel') return done(null);
        const values = Object.fromEntries(new FormData(form));
        const a = actions.find((x) => x.value === action);
        if (a?.run) {
          const err = form.querySelector('.lib-error');
          form.querySelectorAll('button').forEach((x) => { x.disabled = true; });
          try { const out = await a.run(values, form); return done({ action, values, out }); }
          catch (ex) { err.hidden = false; err.textContent = errText(ex); form.querySelectorAll('button').forEach((x) => { x.disabled = false; }); return; }
        }
        done({ action, values });
      });
      dlg.onclose = () => resolve(null);
      dlg.showModal();
    });
  }
  const folderSelect = (selected, { withNew = true } = {}) => `<label class="lib-field"><span>${t('lib.folder')}</span>
      <select name="folder">${[['', t('lib.noFolder')], ...cache.folders.map((f) => [f.id, f.name])]
        .map(([v, l]) => `<option value="${esc(v)}" ${v === (selected ?? '') ? 'selected' : ''}>${esc(l)}</option>`).join('')}
        ${withNew ? `<option value="__new">${t('lib.newFolderOption')}</option>` : ''}</select></label>
      ${withNew ? `<label class="lib-field lib-newname" hidden><span>${t('lib.newFolderName')}</span><input name="newFolder" maxlength="80"></label>` : ''}`;
  const wireFolderSelect = (form) => {
    const s = form.querySelector('select[name=folder]'), n = form.querySelector('.lib-newname');
    if (s && n) s.addEventListener('change', () => { n.hidden = s.value !== '__new'; if (!n.hidden) n.querySelector('input').focus(); });
  };
  async function resolveFolder(values) {
    if (values.folder === '__new') return (await lib.createFolder(values.newFolder)).id;
    return values.folder || null;
  }
  async function guarded(fn, okText) {
    try { await fn(); await reload(); if (okText) toast(okText); return true; }
    catch (e) { toast(errText(e), true); return false; }
  }
  function toast(text, bad = false) {
    notify(text);
    $('status').classList.toggle('ok', !bad);
    setTimeout(() => { if ($('status').textContent === text) notify(null); }, bad ? 8000 : 3500);
  }

  // ---------------------------------------------------------------- flows
  const figures = (s) => `<dl class="lib-figs">
      <div><dt>${t('stats.distance')}</dt><dd>${km(s.distance)} ${t('unit.km')}</dd></div>
      <div><dt>${t('stats.ascent')}</dt><dd>${n0(s.ascent)} ${t('unit.m')}</dd></div>
      <div><dt>${t('stats.min')}</dt><dd>${n0(s.min)} ${t('unit.m')}</dd></div>
      <div><dt>${t('stats.max')}</dt><dd>${n0(s.max)} ${t('unit.m')}</dd></div></dl>`;

  /** Save Route: always opened by the user. A linked route can update the original or be saved as a new one. */
  async function saveFlow() {
    const R = ctx.routeLib;
    let snap;
    try { snap = await R.snapshot(); } catch (e) { toast(t('lib.err.figures'), true); return false; }
    if (!snap) { toast(t('lib.err.route-too-short'), true); return false; }
    await reload();
    const linked = R.linkedId() && cache.routes.find((r) => r.id === R.linkedId());
    const html = `${linked ? `<fieldset class="lib-choice"><legend>${t('lib.saveHow')}</legend>
        <label><input type="radio" name="how" value="update" checked> ${t('lib.saveUpdate', { name: esc(linked.name) })}</label>
        <label><input type="radio" name="how" value="new"> ${t('lib.saveAsNew')}</label></fieldset>` : ''}
      <label class="lib-field"><span>${t('lib.name')}</span><input name="name" required maxlength="80" value="${esc(snap.name || linked?.name || '')}" placeholder="${t('route.defaultName')}"></label>
      <div class="lib-folderfield" ${linked ? 'hidden' : ''}>${folderSelect(linked?.folderId ?? (['all', 'none'].includes(view.folder) ? null : view.folder))}</div>
      ${figures(snap.stats)}
      <p class="hint">${t('lib.saveHint')}</p>`;
    const res = await ask({
      title: linked ? t('lib.saveChangesTitle') : t('lib.saveTitle'), html,
      init: (form) => {
        wireFolderSelect(form);
        form.querySelectorAll('input[name=how]').forEach((r) => r.addEventListener('change', () => { form.querySelector('.lib-folderfield').hidden = form.how.value === 'update'; }));
      },
      actions: [
        { value: 'cancel', label: t('lib.cancel') },
        { value: 'save', label: t('lib.save'), kind: 'primary', autofocus: true, run: async (v) => {
          const bbox = routeBBox(snap.geometry);
          const thumb = (await captureMapThumb(map, bbox, { hide: ['route-points', 'route-mid'] })) ?? sketchThumb(snap.geometry, snap.color);
          const data = { ...snap, name: v.name, bbox, thumb };
          if (linked && v.how !== 'new') return lib.updateRoute(linked.id, data);
          return lib.createRoute({ ...data, folderId: await resolveFolder(v) });
        } },
      ],
    });
    if (!res) return false;
    R.markSaved(res.out);
    await reload();
    toast(t(linked && res.values.how !== 'new' ? 'lib.done.updated' : 'lib.done.saved', { name: res.out.name }));
    ctx.results.lastSaved = { id: res.out.id, how: res.values.how ?? 'new' };
    return true;
  }

  async function openFlow(rec, edit) {
    const R = ctx.routeLib;
    if (R.linkedId() !== rec.id || R.isDirty()) { if (!(await R.guardUnsaved())) return; }
    const full = await lib.getRoute(rec.id);
    if (!full) { toast(t('lib.err.route-missing'), true); await reload(); return; }
    ctx.menus?.closeAll();
    R.openSaved(full, { edit });
    ctx.results.opened = full.id;
  }
  // D-066 view mode: the route without its tool bars (and in its day colours when it is split)
  async function viewFlow(rec) {
    const R = ctx.routeLib;
    if (R.linkedId() !== rec.id || R.isDirty()) { if (!(await R.guardUnsaved())) return; }
    const full = await lib.getRoute(rec.id);
    if (!full) { toast(t('lib.err.route-missing'), true); await reload(); return; }
    ctx.menus?.closeAll();
    await ctx.view.enter(full);
    ctx.results.opened = full.id;
  }
  async function editFlow(rec) {
    const res = await ask({
      title: t('lib.editTitle', { name: esc(rec.name) }),
      html: `<fieldset class="lib-choice"><legend>${t('lib.editHow')}</legend>
          <label><input type="radio" name="how" value="original" checked> <b>${t('lib.updateOriginal')}</b><small>${t('lib.updateOriginalHint')}</small></label>
          <label><input type="radio" name="how" value="copy"> <b>${t('lib.createCopy')}</b><small>${t('lib.createCopyHint')}</small></label></fieldset>
        <div class="lib-copyfields" hidden>
          <label class="lib-field"><span>${t('lib.copyName')}</span><input name="name" maxlength="80" value="${esc(rec.name)} (${t('lib.copySuffix')})"></label>
          ${folderSelect(rec.folderId)}</div>`,
      init: (form) => {
        wireFolderSelect(form);
        form.querySelectorAll('input[name=how]').forEach((r) => r.addEventListener('change', () => { form.querySelector('.lib-copyfields').hidden = form.how.value !== 'copy'; }));
      },
      actions: [{ value: 'cancel', label: t('lib.cancel') }, { value: 'go', label: t('lib.startEdit'), kind: 'primary', autofocus: true,
        run: async (v) => (v.how === 'copy' ? lib.duplicateRoute(rec.id, { name: v.name, folderId: await resolveFolder(v) }) : rec) }],
    });
    if (!res) return;
    await reload();
    await openFlow(res.out, true);
    ctx.results.editMode = res.values.how;
  }
  async function renameFlow(rec) {
    const res = await ask({ title: t('lib.rename'), html: `<label class="lib-field"><span>${t('lib.name')}</span><input name="name" required maxlength="80" value="${esc(rec.name)}"></label>`,
      actions: [{ value: 'cancel', label: t('lib.cancel') }, { value: 'ok', label: t('lib.save'), kind: 'primary', autofocus: true, run: (v) => lib.renameRoute(rec.id, v.name) }] });
    if (res) {
      if (ctx.routeLib.linkedId() === rec.id && !ctx.routeLib.isDirty()) ctx.routeLib.markSaved(res.out);
      await reload(); toast(t('lib.done.renamed'));
    }
  }
  async function moveFlow(rec) {
    const res = await ask({ title: t('lib.moveTitle', { name: esc(rec.name) }), html: folderSelect(rec.folderId), init: wireFolderSelect,
      actions: [{ value: 'cancel', label: t('lib.cancel') }, { value: 'ok', label: t('lib.move'), kind: 'primary', autofocus: true, run: async (v) => lib.moveRoute(rec.id, await resolveFolder(v)) }] });
    if (res) { await reload(); toast(t('lib.done.moved')); }
  }
  async function deleteFlow(rec) {
    const res = await ask({ title: t('lib.deleteTitle'), html: `<p>${t('lib.deleteBody', { name: esc(rec.name) })}</p>`,
      actions: [{ value: 'cancel', label: t('lib.cancel'), autofocus: true }, { value: 'ok', label: t('lib.delete'), kind: 'danger', run: () => lib.deleteRoute(rec.id) }] });
    if (!res) return;
    if (ctx.routeLib.linkedId() === rec.id) ctx.routeLib.unlink();   // the map keeps the line, now unsaved
    await reload(); toast(t('lib.done.deleted'));
  }
  async function newFolderFlow() {
    const res = await ask({ title: t('lib.newFolder'), html: `<label class="lib-field"><span>${t('lib.newFolderName')}</span><input name="name" required maxlength="80"></label>`,
      actions: [{ value: 'cancel', label: t('lib.cancel') }, { value: 'ok', label: t('lib.create'), kind: 'primary', autofocus: true, run: (v) => lib.createFolder(v.name) }] });
    if (res) { view.folder = res.out.id; await reload(); }
  }
  async function renameFolderFlow(id) {
    const res = await ask({ title: t('lib.renameFolder'), html: `<label class="lib-field"><span>${t('lib.newFolderName')}</span><input name="name" required maxlength="80" value="${esc(folderName(id))}"></label>`,
      actions: [{ value: 'cancel', label: t('lib.cancel') }, { value: 'ok', label: t('lib.save'), kind: 'primary', autofocus: true, run: (v) => lib.renameFolder(id, v.name) }] });
    if (res) await reload();
  }
  async function deleteFolderFlow(id) {
    const n = cache.routes.filter((r) => r.folderId === id).length;
    const others = cache.folders.filter((f) => f.id !== id);
    const res = await ask({
      title: t('lib.deleteFolderTitle', { name: esc(folderName(id)) }),
      html: n ? `<p>${t('lib.deleteFolderBody', { n })}</p><label class="lib-field"><span>${t('lib.routesGoTo')}</span><select name="to">
          <option value="">${t('lib.noFolder')}</option>${others.map((f) => `<option value="${esc(f.id)}">${esc(f.name)}</option>`).join('')}</select></label>`
        : `<p>${t('lib.deleteFolderEmpty')}</p>`,
      actions: [{ value: 'cancel', label: t('lib.cancel'), autofocus: true }, { value: 'ok', label: t('lib.deleteFolder'), kind: 'danger', run: (v) => lib.deleteFolder(id, { moveTo: v.to || null }) }],
    });
    if (res) { view.folder = 'all'; await reload(); toast(t('lib.done.folderDeleted')); }
  }

  /** Unsaved work: Save / Continue without saving / Cancel. Resolves true when it is fine to go on. */
  async function confirmUnsaved() {
    const res = await ask({ title: t('lib.unsavedTitle'), html: `<p>${t('lib.unsavedBody')}</p>`,
      actions: [{ value: 'cancel', label: t('lib.cancel') }, { value: 'discard', label: t('lib.discard'), kind: 'danger' }, { value: 'save', label: t('lib.saveFirst'), kind: 'primary', autofocus: true }] });
    if (!res) return false;
    if (res.action === 'discard') return true;
    return saveFlow();
  }

  // ---------------------------------------------------------------- wiring
  $('r-save').addEventListener('click', () => saveFlow());
  new MutationObserver(() => { if (!panel.hidden) reload(); }).observe(panel, { attributes: true, attributeFilter: ['hidden'] });
  // D-064 (owner): the old waypoints are removed for good, also from routes already saved (once per visit)
  if (!stripped) { stripped = true; lib.stripLegacyWaypoints().then((n) => { ctx.results.legacyWaypointsRemoved = n; }).catch(() => {}); }
  ctx.library = { reload, saveFlow, confirmUnsaved, lib: () => lib,
    edit: async (id) => { const rec = cache.routes.find((r) => r.id === id) ?? await lib.getRoute(id); if (rec) await editFlow(rec); } };   // D-066
  return ctx.library;
}
