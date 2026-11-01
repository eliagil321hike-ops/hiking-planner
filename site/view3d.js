// 2D / 3D toggle (D-038): one map button next to the compass. 3D turns the terrain on and tilts the camera
// smoothly; 2D flattens the terrain and looks straight down. The choice is remembered; the exaggeration is the
// same in every map style.

import { loadPrefs, savePrefs } from './prefs.js';

export function initView3d(ctx) {
  const { map, t } = ctx;
  const prefs = loadPrefs();
  // Older prefs stored the 3D switch as the "terrain" layer group.
  let is3D = typeof prefs.is3D === 'boolean' ? prefs.is3D : prefs.groups?.terrain ?? true;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'btn-3d';
  btn.className = 'ctrl-3d';
  const label = () => {
    btn.textContent = is3D ? '2D' : '3D';                 // shows what a click switches to
    btn.title = t(is3D ? 'view.to2d' : 'view.to3d');
    btn.setAttribute('aria-label', btn.title);
    btn.setAttribute('aria-pressed', String(is3D));
  };
  const control = {
    onAdd() { const box = document.createElement('div'); box.className = 'maplibregl-ctrl maplibregl-ctrl-group'; box.append(btn); return box; },
    onRemove() {},
  };

  function applyTerrain() {
    map.setTerrain(is3D ? { source: 'dem-terrain', exaggeration: ctx.state.exaggeration } : null);
  }
  function set3D(on, { animate = true } = {}) {
    is3D = on;
    label();
    savePrefs({ is3D });
    if (map.getSource('dem-terrain')) applyTerrain();
    if (!animate) return;
    if (on && map.getPitch() < 30) map.easeTo({ pitch: 60, duration: 900 });
    if (!on) map.easeTo({ pitch: 0, duration: 700 });
  }
  btn.addEventListener('click', () => set3D(!is3D));
  label();
  ctx.view = { set3D, is3D: () => is3D, applyTerrain, control };
  return ctx.view;
}
