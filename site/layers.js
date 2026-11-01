// Layer switches, opacity sliders, 2D/3D and terrain exaggeration (D-038). Choices are remembered in this
// browser (prefs.js). A switch says what the user wants; the map style (topo / satellite / hybrid 3D) may
// still hide a group that does not suit it (styleAllows), and showing it again restores the user's choice.

import { loadPrefs, savePrefs } from './prefs.js';

export const GROUPS = {
  hillshade: ['topo-hillshade'],
  contours: ['topo-contours-minor', 'topo-contours-index', 'topo-contour-labels'],
  slope: ['topo-slope'],
  aspect: ['topo-aspect'],
  relief: ['topo-relief'],
  trails: ['topo-trails-casing', 'topo-trails-track', 'topo-trails-track-inner', 'topo-trails-path', 'topo-trails-footway', 'topo-marked-casing', 'topo-marked-line', 'topo-hike-casing', 'topo-hike-line', 'topo-hike-label'],
  landcover: ['topo-landcover'],
  water: ['topo-waterway', 'topo-waterway-label'],
  peaks: ['topo-peaks'],
  camp: ['poi-camp-cluster', 'poi-camp'],
  drinking: ['poi-water-cluster', 'poi-water'],
  parking: ['poi-parking-cluster', 'poi-parking'],
  poi: ['topo-poi-dot', 'topo-poi-icon', 'topo-poi', 'poi-other'],
};

// Opacity slider → [layer, paint property, scale]. Hillshade has no opacity property; its exaggeration
// is the closest equivalent (0.55 at slider 0.9).
const OPACITY = {
  hillshade: [['topo-hillshade', 'hillshade-exaggeration', 0.61]],
  slope: [['topo-slope', 'raster-opacity', 1]],
  aspect: [['topo-aspect', 'raster-opacity', 1]],
  relief: [['topo-relief', 'color-relief-opacity', 1]],
};

/** Shared helpers put on ctx (used by background, view and developer tools too). */
export function layerHelpers(ctx) {
  const { map } = ctx;
  const vis = (ids, on) => ids.forEach((id) => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'));
  const cbChecked = (g) => document.querySelector(`input[data-group="${g}"]`)?.checked ?? true;
  const allowed = (g) => ctx.styleAllows?.(g) ?? true;
  const setGroup = (g, on) => {
    if (g === 'terrain') map.setTerrain(on ? { source: 'dem-terrain', exaggeration: ctx.state.exaggeration } : null);
    else vis(GROUPS[g] ?? [], on && allowed(g));
  };
  const setOpacity = (g, v) => (OPACITY[g] ?? []).forEach(([id, prop, k]) => map.getLayer(id) && map.setPaintProperty(id, prop, v * k));
  /** Apply every switch and slider to the map (after the style loaded, and after a style change). */
  const applyGroupsFromUI = () => {
    document.querySelectorAll('input[data-group]').forEach((cb) => setGroup(cb.dataset.group, cb.checked));
    document.querySelectorAll('input[data-opacity]').forEach((r) => setOpacity(r.dataset.opacity, Number(r.value)));
  };
  return { GROUPS, vis, setGroup, setOpacity, cbChecked, applyGroupsFromUI };
}

export function initLayers(ctx) {
  const { map, results, $, log, setGroup, setOpacity } = ctx;

  // Restore remembered choices into the controls before the map loads.
  const prefs = loadPrefs();
  document.querySelectorAll('input[data-group]').forEach((cb) => {
    if (typeof prefs.groups?.[cb.dataset.group] === 'boolean') cb.checked = prefs.groups[cb.dataset.group];
  });
  document.querySelectorAll('input[data-opacity]').forEach((r) => {
    const v = prefs.opacity?.[r.dataset.opacity];
    if (v >= 0.1 && v <= 1) r.value = String(v);
  });
  const syncRow = (cb) => cb.closest('.layer-row')?.classList.toggle('on', cb.checked);
  document.querySelectorAll('input[data-group]').forEach(syncRow);
  if (prefs.exaggeration >= 1 && prefs.exaggeration <= 2) ctx.state.exaggeration = prefs.exaggeration;
  $('exag').value = String(ctx.state.exaggeration);
  $('exag-out').textContent = ctx.state.exaggeration.toFixed(1);

  document.querySelectorAll('input[data-group]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const g = cb.dataset.group;
      const t0 = performance.now();
      setGroup(g, cb.checked);
      syncRow(cb);
      savePrefs({ groups: { ...loadPrefs().groups, [g]: cb.checked } });
      map.once('idle', () => {
        const ms = Math.round(performance.now() - t0);
        results.toggles.push({ group: g, on: cb.checked, msToIdle: ms });
        log(`toggle ${g} ${cb.checked ? 'on' : 'off'}: ${ms} ms to idle`);
      });
    });
  });
  document.querySelectorAll('input[data-opacity]').forEach((r) => {
    r.addEventListener('input', () => setOpacity(r.dataset.opacity, Number(r.value)));
    r.addEventListener('change', () => savePrefs({ opacity: { ...loadPrefs().opacity, [r.dataset.opacity]: Number(r.value) } }));
  });
  $('exag').addEventListener('input', (e) => {
    ctx.state.exaggeration = Number(e.target.value);
    $('exag-out').textContent = ctx.state.exaggeration.toFixed(1);
    if (map.getTerrain()) map.setTerrain({ source: 'dem-terrain', exaggeration: ctx.state.exaggeration });
  });
  $('exag').addEventListener('change', () => savePrefs({ exaggeration: ctx.state.exaggeration }));
}
