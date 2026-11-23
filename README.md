# Topo3D hiking route planner (website)

Non-commercial hiking route planner website with a free 3D topographic map of Israel and satellite
imagery, for the owner and a few friends. Live: https://eliagil321hike-ops.github.io/hiking-planner/

Brief: [`SPEC.md`](SPEC.md) (v3.2) as overridden by [`SPEC-WEB.md`](SPEC-WEB.md) (v4, website).
State of work: [`PROGRESS.md`](PROGRESS.md). Decisions, sources and licences: [`DECISIONS.md`](DECISIONS.md).

## Repository layout
```
site/                     The website, deployed to GitHub Pages as-is (no build step); also the content of both apps
  index.html, style.css   Page and styles (Hebrew, right-to-left)
  app.js                  Entry: config, map, wiring
  i18n.js                 All user-facing text (Hebrew)
  layers.js               Layer switches, exaggeration
  background.js           Topographic / satellite switch
  satellite.js            Satellite providers (EOX, Esri, MapTiler)
  route.js, profile.js    Drawing a line, stats, elevation profile
  topo3d.js               Applies the Topo3D overlay on the OpenFreeMap base style
  dem-sampler.js          Elevation sampling with the shared Terrarium decoder
  devtools.js, perf.js    Phase 0 developer tests (only with ?dev=1)
  styles/topo3d.json      Topo3D overlay: DEM, contours, layers, sky, satellite providers
  vendor/geo/             packages/geo compiled to browser JavaScript (committed)
packages/geo/             Pure TypeScript geo logic (distance, DEM decoding, elevation stats, duration)
scripts/                  Tests (browser smoke, end-to-end, desktop app, Android emulator) and the CI cache-busting stamp
app/                      The Android app (Capacitor 8): capacitor.config.json, android/ project (A1, D-078)
docs/                     Plans (accounts-plan.md = A2) and check results (a1/)
.github/workflows/        Tests, then deploy site/ to GitHub Pages
```

## Commands
```bash
# Unit tests (zero dependencies, Node 22.18+)
cd packages/geo && node --test "test/**/*.test.ts"

# After changing packages/geo: rebuild the browser copy (TypeScript compiler)
tsc -p packages/geo/tsconfig.browser.json

# Browser tests (Python Playwright + Chromium + Pillow)
python3 scripts/browser_smoke_test.py   # decoder, sampler, profile, satellite config (synthetic tiles)
python3 scripts/e2e_test.py             # real MapLibre build, fixture style + DEM; downloads MapLibre once into .cache/

# Run locally
python3 -m http.server 8080 --directory site     # then open http://localhost:8080/
```
Add `?dev=1` to the URL for the developer tests (encoding check, DEM zoom, FPS, layer check, report).

## Deploy
Every push to `main` runs the tests and, if they pass, publishes `site/` to GitHub Pages
(`.github/workflows/pages.yml`). The build id shown in the panel header is the commit.

## One app on the computer and the phone (A1, SPEC-WEB W10)
The same `site/` code runs as the website, as an installed desktop app (PWA, D-077) and as an Android app (APK,
Capacitor, D-078). Routes still live on each device (IndexedDB) until step A2 (cloud storage, `docs/accounts-plan.md`).

### Desktop app (Chrome or Edge on the computer)
1. Open https://eliagil321hike-ops.github.io/hiking-planner/ in Chrome or Edge.
2. In the address bar, at the right end, there is an **install icon** (a screen with a down arrow). Click it →
   **Install**. (Or: ⋮ menu → *Cast, save and share* / *Apps* → *Install Topo3D*.)
3. Topo3D opens in its own window and gets an icon in the Start menu / on the desktop. The browser's tab keeps
   working as before.
- Without network the app still opens (the map content needs network until A3).
- After a new deploy the app uses it at the next start. If the app stays open while a deploy happens, a small
  notice **"גרסה חדשה זמינה – רענן"** appears; one tap loads the new version.
- Uninstall: in the app window ⋮ → *Uninstall Topo3D*.

### Android app (APK)
Every push to `main` builds the APK after the site's tests and deploy pass (`.github/workflows/android.yml`).
It is kept 30 days as a download on the run's page. Until the release key exists it is a **debug** test build.

**1. Create the release key (once) and back it up.** The key proves that every new APK comes from you, so
Android installs it as an update. **If the key is lost, the next APK cannot update the app: it must be
uninstalled (losing the routes kept in the app) and installed again.** Keep two copies (e.g. a USB stick and
your password manager / a private cloud folder), never in the repository.
How it is created is still to be decided with Claude (it cannot be done for you without the file passing
through the chat); the file is `topo3d-release.jks`, alias `topo3d`, valid 30 years, RSA 4096.

**2. Put the key into GitHub Secrets** (github.com → the repository → *Settings* → *Secrets and variables* →
*Actions* → *New repository secret*), four secrets:
| Name | Value |
| --- | --- |
| `TOPO3D_KEYSTORE_BASE64` | the key file as base64 text (Windows PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("topo3d-release.jks")) \| Set-Clipboard`, then paste) |
| `TOPO3D_KEYSTORE_PASSWORD` | the key store password |
| `TOPO3D_KEY_ALIAS` | `topo3d` |
| `TOPO3D_KEY_PASSWORD` | the key password (same as the store password if you used one) |

**3. Download the APK.** github.com → the repository → *Actions* → *Android app* → the newest green run →
at the bottom, *Artifacts* → **topo3d-apk** (a .zip; inside: `topo3d-release-<commit>-v<n>.apk`). On the phone
you can open the same page in Chrome (signed in to GitHub) and download it there.

**4. Install on the phone.** Open the downloaded .apk (Files app → Downloads). The first time Android asks to
allow installs from this source (Chrome or Files): *Settings* → allow → back → **Install**. Google Play Protect may
ask to scan an unknown app: *Scan app* or *Install anyway*. Later APKs install over it as updates (same key).
If a debug test build was installed before the release key existed, **uninstall it first** (different key).

What the app does differently from the website (only inside the app):
- Android **back**: closes an open window/menu/days screen like Escape; with nothing open it leaves the app,
  asking first if the route has unsaved changes.
- **GPX export** opens Android's share sheet (save to Files/Drive, send to a navigation app).
- **"Center on me"** asks Android's location permission the first time it is pressed (while using the app only).
- The OSM trails/points data is read from the live site; the app's own code updates only with a new APK.

### Satellite key (Esri) – per device
The Esri key is no longer in the public code (D-076). On each device (website, desktop app, APK): *סגנון מפה* →
*לוויין* → provider *Esri World Imagery* → paste the key → *שמירה*. It is kept only on that device. Until then the
free Sentinel-2 (EOX) imagery is shown.

**Rotate the old key (it stays in the public git history):**
1. https://location.arcgis.com → sign in → *My portal* (or arcgis.com → your portal) → *Content* → *My content*.
2. Open the **API key credentials** item used for Topo3D → *Settings* → *Application* → *API keys*.
3. **Generate a secondary API key** (or create a new *API key credentials* item: *New item* → *Developer
   credentials* → *API key credentials*), privileges: *Location services → Basemaps* only, an expiration date,
   **no payment method / pay-as-you-go**. Referrers: `https://eliagil321hike-ops.github.io` for the website and
   desktop app; the Android app's pages come from `https://localhost`, so either add `https://localhost` or make a
   second key for the phone without referrers. Copy the key and type it on each device as above.
4. Back in *API keys*: on the **old** key → **Invalidate API key** → *Yes, invalidate API key*. It stops working
   immediately.

## Attribution
© OpenMapTiles · © OpenStreetMap contributors · OpenFreeMap · Mapterhorn (Israel: isr10, ASTER GDEM courtesy of
METI and NASA processed by 4cast LTD; global: Copernicus GLO-30) · satellite: Esri and its partners /
EOxCloudless (CC BY-NC-SA 4.0). Credits are shown in the map's attribution control.
