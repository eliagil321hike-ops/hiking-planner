// Background switch: topographic / satellite (DECISIONS D-017, D-018, D-021).
// In satellite mode the topo tint and hillshade are hidden (imagery has its own shading); contours,
// trails, labels and the route stay on top. Switching back restores the user's checkbox choices.

import { setSatellite, removeSatellite, store } from './satellite.js';

export function initBackground(ctx) {
  const { map, overlay, results, $, t, log, notify, GROUPS, vis, cbChecked } = ctx;
  const SAT = overlay.satellite;
  const providerById = (id) => SAT.providers.find((p) => p.id === id) ?? SAT.providers[0];
  let baseMode = store.get('topo3d.base') === 'satellite' ? 'satellite' : 'topo';
  let providerId = providerById(store.get('topo3d.satProvider') ?? SAT.default).id;
  const keyName = (id) => `topo3d.key.${id}`;

  function syncKeyRow() {
    const p = providerById(providerId);
    $('sat-key-row').hidden = !p.needsKey;
    $('sat-key-help').textContent = p.embeddedKey ? t('bg.embeddedKey') : (p.keyHelp ?? '');
    $('sat-key').value = store.get(keyName(p.id)) ?? '';
  }

  function applyBackground() {
    $('sat-opts').hidden = baseMode !== 'satellite';
    syncKeyRow();
    const sat = baseMode === 'satellite';
    let shown = false;
    notify(null);
    if (sat) {
      const p = providerById(providerId);
      // A key typed by this user wins; otherwise the owner's embedded public key (D-021).
      shown = setSatellite(map, p, store.get(keyName(p.id)) || p.embeddedKey, SAT.beforeLayer);
      if (!shown) notify(t('bg.needKey', { provider: p.label }));
    } else {
      removeSatellite(map);
    }
    const imagery = sat && shown;
    vis(GROUPS.landcover, !imagery && cbChecked('landcover'));
    vis(GROUPS.hillshade, !imagery && cbChecked('hillshade'));
    results.background = { mode: baseMode, provider: sat ? providerId : null, shown };
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
    map.once('idle', () => log(`background → ${baseMode}${baseMode === 'satellite' ? ` (${providerId})` : ''}: ${Math.round(performance.now() - t0)} ms to idle`));
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
