// D-077 (A1, SPEC-WEB W10): installable desktop app. Registers the shell service worker (sw.js), shows
// "גרסה חדשה זמינה – רענן" when a newer deploy exists than the page that is running, and asks the browser to
// keep this site's storage (routes) when running as the installed app. Inside the Android app (Capacitor)
// none of this runs: the app ships its own copy of the site and updates with a new APK (D-078).

import { t } from './i18n.js';

const native = () => !!globalThis.Capacitor?.isNativePlatform?.();
const standalone = () => matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: window-controls-overlay)').matches;

/** Build id of the running page and of the live start page ('__BUILD__' = not deployed: no check). */
const runningBuild = (BUILD) => (BUILD && !BUILD.startsWith('__') ? BUILD : null);
async function liveBuild() {
  const res = await fetch(`./?check=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) return null;
  return (await res.text()).match(/app\.js\?v=([\w.-]+)/)?.[1] ?? null;
}

function showUpdate() {
  let b = document.getElementById('app-update');
  if (!b) {
    // Built from the site's own notice (.status.toast, the calm .ok colours); one tap reloads.
    b = Object.assign(document.createElement('button'), { id: 'app-update', type: 'button', className: 'status ok toast app-update' });
    b.textContent = t('app.update');
    b.addEventListener('click', () => location.reload());
    document.body.append(b);
  }
  b.hidden = false;
}

export async function initPwa(ctx) {
  const out = (ctx.results.pwa = { native: native(), standalone: standalone(), sw: null, persist: null, update: false });
  if (out.native || !('serviceWorker' in navigator)) return out;
  try {
    const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
    out.sw = reg.scope;
  } catch (e) { out.sw = `error: ${e.message}`; }

  // The installed app keeps its storage (routes live in IndexedDB until A2); the result is recorded.
  if (out.standalone && navigator.storage?.persist) {
    try { out.persist = (await navigator.storage.persisted()) || (await navigator.storage.persist()); } catch { out.persist = 'error'; }
    ctx.log?.(`storage.persist → ${out.persist}`);
  }

  // A newer deploy than the running page → the notice. Checked at start and whenever the app comes back.
  const mine = runningBuild(ctx.BUILD);
  if (!mine) return out;
  const check = async () => {
    try {
      const live = await liveBuild();
      if (live && live !== mine) { out.update = live; showUpdate(); }
    } catch { /* offline: nothing to compare */ }
  };
  check();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
  return out;
}
