// Remembered settings (SPEC 8.1 "remembered layer preference"): layer switches, exaggeration, collapsed
// panel and the last camera. Stored in this browser only; storage can be blocked, so all access is guarded.

import { store } from './satellite.js';

const KEY = 'topo3d.prefs';

export function loadPrefs() {
  try { return JSON.parse(store.get(KEY) ?? '{}') ?? {}; } catch { return {}; }
}

export function savePrefs(patch) {
  const next = { ...loadPrefs(), ...patch };
  store.set(KEY, JSON.stringify(next));
  return next;
}
