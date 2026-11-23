// D-077 (A1, SPEC-WEB W10): service worker for the installable desktop app (PWA).
// It keeps ONLY the app shell – the site's own HTML/JS/CSS/JSON config/fonts/icons and the pinned MapLibre
// files – so the app opens without network. Map tiles, DEM, OSM data and routing are not touched at all
// (their requests never reach respondWith; that is step A3).
// Network first: with network every request goes to the network exactly as before (the copy is only
// refreshed), so a new deploy is used on the next start and an old version is never served while online.
// Without network the last copy is served. Not registered inside the Android app (pwa.js).

const CACHE = 'topo3d-shell-v1';
const SCOPE = new URL(self.registration.scope);
const CDN = ['https://unpkg.com/maplibre-gl@', 'https://unpkg.com/maplibre-contour@'];
const SHELL_EXT = /\.(html|js|mjs|css|json|webmanifest|woff2?|ttf|png|svg|ico)$/i;

/** Is this request part of the app shell (and not map content)? */
function isShell(url) {
  if (CDN.some((p) => url.href.startsWith(p))) return true;
  if (url.origin !== SCOPE.origin || !url.pathname.startsWith(SCOPE.pathname)) return false;
  const rest = url.pathname.slice(SCOPE.pathname.length);
  if (rest.startsWith('data/')) return false;            // OSM extract = map content (A3)
  return rest === '' || SHELL_EXT.test(rest);
}

/** The build id a page asks for: app.js?v=<build> (scripts/stamp_build.sh). */
const buildOf = (html) => html.match(/app\.js\?v=([\w.-]+)/)?.[1] ?? null;

/** Relative references worth keeping, found in a shell file. */
function refsIn(text, type) {
  const out = [];
  const add = (re) => { for (const m of text.matchAll(re)) out.push(m[1]); };
  if (type.includes('html')) add(/(?:src|href)="([^"#]+)"/g);
  if (type.includes('javascript')) {
    add(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g);   // static and dynamic module imports
    add(/['"](\.\/styles\/[^'"]+\.json[^'"]*)['"]/g);           // the style overlay fetched by app.js
  }
  if (type.includes('css')) add(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g);
  if (type.includes('manifest') || type.includes('json')) add(/"src"\s*:\s*"([^"]+)"/g);
  return out;
}

/** Install: walk the shell from the start page (index.html → modules → styles/fonts) and keep each file. */
async function precache() {
  const cache = await caches.open(CACHE);
  const start = new URL('./', SCOPE).href;
  const queue = [start, new URL('manifest.webmanifest', SCOPE).href];
  const seen = new Set();
  while (queue.length && seen.size < 400) {
    const href = queue.shift();
    if (seen.has(href)) continue;
    seen.add(href);
    let res;
    try { res = await fetch(href, { cache: 'no-cache' }); } catch { continue; }
    if (!res.ok) continue;
    await cache.put(href, res.clone());
    const type = res.headers.get('content-type') ?? '';
    if (!/html|javascript|css|json|manifest/.test(type)) continue;
    for (const ref of refsIn(await res.text(), type)) {
      let u;
      try { u = new URL(ref, href); } catch { continue; }
      if (isShell(u) && !seen.has(u.href)) queue.push(u.href);
    }
  }
}

/** After a newer start page was fetched: drop shell files stamped with another build. */
async function prune(build) {
  if (!build) return;
  const cache = await caches.open(CACHE);
  for (const req of await cache.keys()) {
    const v = new URL(req.url).searchParams.get('v');
    if (v && v !== build) await cache.delete(req);
  }
}

self.addEventListener('install', (e) => {
  e.waitUntil(precache().catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('topo3d-shell-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const nav = req.mode === 'navigate';
  if (!nav && !isShell(url)) return;                     // map content etc.: untouched, as without a worker
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') {
        const copy = res.clone();
        e.waitUntil((async () => {
          await cache.put(req, copy.clone());
          if (nav) await prune(buildOf(await copy.text()));
        })());
      }
      return res;
    } catch (err) {
      const hit = (await cache.match(req)) ?? (await cache.match(req, { ignoreSearch: true }))
        ?? (nav ? (await cache.match(new URL('./', SCOPE).href)) : undefined);
      if (hit) return hit;
      throw err;
    }
  })());
});
