// Map style: topographic / satellite / hybrid 3D (D-017, D-018, D-021, D-038).
//   topographic  clean topo map (hillshade, contours, vegetation tint)
//   satellite    imagery with trails, water, peaks, POIs and labels; no topo tint, hillshade or contours
//   hybrid 3D    imagery + 3D terrain + hillshade + contours + all features; switches the view to 3D
// The user's layer switches are kept; a style only hides what does not suit it (ctx.styleAllows).

import { setSatellite, removeSatellite, store } from './satellite.js';

export function initBackground(ctx) {
  const { map, overlay, results, $, t, log, notify } = ctx;
  const SAT = overlay.satellite;
  const providerById = (id) => SAT.providers.find((p) => p.id === id) ?? SAT.providers[0];
  const HIDE = { topo: [], satellite: ['hillshade', 'landcover', 'contours', 'relief'], hybrid: ['landcover'] };
  const saved = store.get('topo3d.base');
  let baseMode = HIDE[saved] ? saved : 'topo';
  let imagery = false;
  ctx.styleAllows = (g) => !imagery || !HIDE[baseMode].includes(g);
  let providerId = providerById(store.get('topo3d.satProvider') ?? SAT.default).id;
  const keyName = (id) => `topo3d.key.${id}`;

  function syncKeyRow() {
    const p = providerById(providerId);
    $('sat-key-row').hidden = !p.needsKey;
    $('sat-key-help').textContent = p.embeddedKey ? t('bg.embeddedKey') : (p.keyHelp ?? '');
    $('sat-key').value = store.get(keyName(p.id)) ?? '';
  }

  function applyBackground() {
    syncKeyRow();
    const sat = baseMode !== 'topo';
    let shown = false;
    let fallback = null;
    if (sat) {
      const p = providerById(providerId);
      // A key typed on this device wins; otherwise the owner's embedded public key (D-021).
      const key = store.get(keyName(p.id)) || p.embeddedKey;
      // D-076: no key on this device yet → show the free imagery (EOX) instead of nothing, and say so.
      const free = p.needsKey && !key ? SAT.providers.find((x) => !x.needsKey) : null;
      shown = setSatellite(map, free ?? p, key, SAT.beforeLayer);
      if (shown && free) { notify(t('bg.keyFallback', { provider: p.label, free: free.label })); $('status').dataset.source = 'bg'; }
      else if (!shown) { notify(t('bg.needKey', { provider: p.label })); $('status').dataset.source = 'bg'; }
      else if ($('status').dataset.source === 'bg') notify(null);
      fallback = free?.id ?? null;
    } else {
      if ($('status').dataset.source === 'bg') notify(null);
      removeSatellite(map);
    }
    imagery = sat && shown;
    ctx.applyGroupsFromUI?.();
    results.background = { mode: baseMode, provider: sat ? providerId : null, shown, fallback };
  }

  // Called once the style (and the Topo3D layers the satellite layer is inserted under) exist.
  function start() {
    const sel = $('sat-provider');
    sel.innerHTML = SAT.providers.map((p) => `<option value="${p.id}">${p.label}</option>`).join('');
    sel.value = providerId;
    document.querySelector(`input[name="base"][value="${baseMode}"]`).checked = true;
    applyBackground();
  }

  document.querySelectorAll('input[name="base"]').forEach((r) => r.addEventListener('change', () => {
    baseMode = r.value;
    store.set('topo3d.base', baseMode);
    const t0 = performance.now();
    applyBackground();
    if (baseMode === 'hybrid') ctx.view?.set3D(true);
    map.once('idle', () => log(`background → ${baseMode}${baseMode !== 'topo' ? ` (${providerId})` : ''}: ${Math.round(performance.now() - t0)} ms to idle`));
  }));
  $('sat-provider').addEventListener('change', (e) => {
    providerId = e.target.value;
    store.set('topo3d.satProvider', providerId);
    applyBackground();
  });
  $('sat-key-save').addEventListener('click', () => {
    const k = $('sat-key').value.trim();
    store.set(keyName(providerId), k || null);
    applyBackground();
  });

  return { start, applyBackground };
}
