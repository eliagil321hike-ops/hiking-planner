// Layer switches (3D, hillshade, contours, trails, landcover), terrain exaggeration, panel collapse.
// Choices are remembered in this browser (prefs.js).

import { loadPrefs, savePrefs } from './prefs.js';

export const GROUPS = {
  hillshade: ['topo-hillshade'],
  contours: ['topo-contours-minor', 'topo-contours-index', 'topo-contour-labels'],
  trails: ['topo-trails-casing', 'topo-trails-track', 'topo-trails-path', 'topo-trails-footway'],
  landcover: ['topo-landcover'],
  water: ['topo-waterway', 'topo-waterway-label'],
  poi: ['topo-poi-dot', 'topo-poi'],
};

/** Shared helpers put on ctx (used by background and developer tools too). */
export function layerHelpers(ctx) {
  const { map } = ctx;
  const vis = (ids, on) => ids.forEach((id) => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'));
  const setGroup = (g, on) => {
    if (g === 'terrain') map.setTerrain(on ? { source: 'dem-terrain', exaggeration: ctx.state.exaggeration } : null);
    else vis(GROUPS[g], on);
  };
  const cbChecked = (g) => document.querySelector(`input[data-group="${g}"]`)?.checked ?? true;
  /** Apply every switch's current state to the map (after the style loaded). */
  const applyGroupsFromUI = () => document.querySelectorAll('input[data-group]').forEach((cb) => setGroup(cb.dataset.group, cb.checked));
  return { GROUPS, vis, setGroup, cbChecked, applyGroupsFromUI };
}

export function initLayers(ctx) {
  const { map, results, $, log, setGroup } = ctx;

  // Restore remembered choices into the controls before the map loads.
  const prefs = loadPrefs();
  document.querySelectorAll('input[data-group]').forEach((cb) => {
    if (typeof prefs.groups?.[cb.dataset.group] === 'boolean') cb.checked = prefs.groups[cb.dataset.group];
  });
  if (prefs.exaggeration >= 1 && prefs.exaggeration <= 2) {
    ctx.state.exaggeration = prefs.exaggeration;
    $('exag').value = String(prefs.exaggeration);
    $('exag-out').textContent = prefs.exaggeration.toFixed(1);
  }
  if (prefs.panelCollapsed) {
    $('panel').classList.add('collapsed');
    $('panel-toggle').setAttribute('aria-expanded', 'false');
  }

  document.querySelectorAll('input[data-group]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const g = cb.dataset.group;
      const t0 = performance.now();
      setGroup(g, cb.checked);
      savePrefs({ groups: { ...loadPrefs().groups, [g]: cb.checked } });
      map.once('idle', () => {
        const ms = Math.round(performance.now() - t0);
        results.toggles.push({ group: g, on: cb.checked, msToIdle: ms });
        log(`toggle ${g} ${cb.checked ? 'on' : 'off'}: ${ms} ms to idle`);
      });
    });
  });
  $('exag').addEventListener('input', (e) => {
    ctx.state.exaggeration = Number(e.target.value);
    $('exag-out').textContent = ctx.state.exaggeration.toFixed(1);
    if (map.getTerrain()) map.setTerrain({ source: 'dem-terrain', exaggeration: ctx.state.exaggeration });
  });
  $('exag').addEventListener('change', () => savePrefs({ exaggeration: ctx.state.exaggeration }));
  $('panel-toggle').addEventListener('click', () => {
    const p = $('panel');
    p.classList.toggle('collapsed');
    const collapsed = p.classList.contains('collapsed');
    $('panel-toggle').setAttribute('aria-expanded', String(!collapsed));
    savePrefs({ panelCollapsed: collapsed });
  });
}
