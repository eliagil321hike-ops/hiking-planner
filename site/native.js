// D-078 (A1, SPEC-WEB W10): only inside the Android app (Capacitor). Loaded by app.js behind
// Capacitor.isNativePlatform(); the website never loads this file.
//  - Android back button follows the site's own close logic: an open dialog, the days screen, then the same
//    Escape the site already handles (menus, view mode, marking points, search). Only when nothing was open:
//    unsaved route edits are confirmed with the site's own "unsaved route" dialog, then the app closes.
//  - GPX export (gpx.js downloadText) goes to Android's share sheet: the file is written to the app's cache and
//    shared (save to Files/Drive, send to a navigation app…). WebViews cannot download blob: links.
// Plugins are reached through Capacitor.Plugins (no bundler): App, Filesystem, Share – see DECISIONS D-078.

const P = () => globalThis.Capacitor?.Plugins ?? {};

/** What is open on screen; if the back button changed nothing, there was nothing to close. */
function openState(ctx) {
  const ids = [...document.querySelectorAll('[aria-expanded="true"]')].map((e) => e.id).join(',');
  return JSON.stringify([document.body.className, ids, !!ctx.days?.isOpen?.(), document.querySelectorAll('dialog[open], .popover:not([hidden])').length]);
}

async function onBack(ctx) {
  const dialog = [...document.querySelectorAll('dialog[open]')].pop();
  if (dialog) {
    // the same path as the Escape key on a dialog (cancel event first, so the site's handlers run)
    if (dialog.requestClose) dialog.requestClose(); else if (dialog.dispatchEvent(new Event('cancel', { cancelable: true }))) dialog.close('cancel');
    return 'dialog';
  }
  if (ctx.days?.isOpen?.()) { ctx.days.close(); return 'days'; }
  const before = openState(ctx);
  const target = document.activeElement && document.activeElement !== document.body ? document.activeElement : document;
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
  if (openState(ctx) !== before) return 'escape';
  // Nothing to close: leaving the app. Unsaved route edits ask first (save / continue without saving / cancel).
  if (ctx.routeLib?.isDirty?.() && !(await ctx.routeLib.guardUnsaved())) return 'stay';
  await P().App?.exitApp?.();
  return 'exit';
}

async function shareFile(text, fileName, type) {
  const { Filesystem, Share } = P();
  if (!Filesystem || !Share) throw new Error('Filesystem/Share plugin missing');
  const res = await Filesystem.writeFile({ path: fileName, data: text, directory: 'CACHE', encoding: 'utf8', recursive: true });
  await Share.share({ title: fileName, dialogTitle: fileName, files: [res.uri] });
  return res.uri;
}

export function initNative(ctx) {
  const out = (ctx.results.native = { platform: globalThis.Capacitor?.getPlatform?.() ?? null, plugins: Object.keys(P()), back: [], shared: [] });
  document.documentElement.classList.add('native-app');
  // gpx.js asks for this hook before falling back to a browser download
  globalThis.__topo3dSaveFile = async (text, fileName, type) => {
    try { out.shared.push(await shareFile(text, fileName, type)); }
    catch (e) { if (!/cancel/i.test(String(e?.message))) ctx.notify(`GPX: ${e.message}`); }
  };
  P().App?.addListener?.('backButton', async () => { out.back.push(await onBack(ctx)); });
  return out;
}
