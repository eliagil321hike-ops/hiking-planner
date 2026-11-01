# DECISIONS

Decisions, alternatives, licences, attribution, costs, limitations and open questions.
Dates are local (Asia/Jerusalem). "Unverified" means not yet confirmed on an official page.

## D-001 (2026-11-01) Personal-use, Android-only scope
Per SPEC P1–P10: single owner, no accounts, no cloud sync, no store release, no iOS, no satellite layer.
`SatelliteProvider` is kept as an interface stub only.

## D-002 (2026-11-01) Development environment limits (blocker for on-device work)
The cloud workspace where the agent works can reach GitHub only. npm registry, PyPI, dl.google.com
(Android SDK), tiles.mapterhorn.com and tiles.openfreemap.org are blocked by network policy (proxy 403).
No phone or owner computer is linked.
Consequences:
- APK builds, `npm install`, and live-tile tests must run on the owner's computer or phone.
- The geo package is written to need **zero dependencies** (Node 22 built-in `node:test` and type stripping).
- The live DEM encoding check runs inside the Option B page ("בדיקת קידוד" button) on the owner's
  computer, where the tile host is reachable. Locally it is covered by unit tests and a headless-Chromium
  smoke test with synthetic tiles (`scripts/browser_smoke_test.py`).
- WebFetch/WebSearch work for documentation, but several official pages (OpenFreeMap style JSON,
  Mapterhorn TileJSON, Mapterhorn GitHub) were not fetchable; those items are verified at runtime instead.

## D-003 (2026-11-01) Language
Owner communication: Hebrew. Repository files: English (same as SPEC). Owner may change this.

## D-004 (2026-11-01) Phase 0 order of candidates
B first (GL JS in WebView + maplibre-contour; first test in Chrome on the phone with no build, then inside
a WebView APK), then C (MapLibre Native terrain build + precomputed contours), A last (Mapbox).
Reason: contours decide the engine (P10.4) and only B has a documented client-side contour path.

## D-005 (2026-11-01) Ascent/descent: peak/valley hysteresis instead of the literal §9.1 pseudocode
Finding (test run): the literal pseudocode moves its anchor in T-sized steps and loses up to T (3 m) at
every turning point. On a smoothed sawtooth test it gave 324 m where the smoothed series actually climbs
354.4 m (−9%); on a simple 0→10→0 m profile it reports 8 m instead of 10 m.
Decision: implement a peak/valley hysteresis (the algorithm SPEC v2 change #2 names): track the running
extreme, confirm a reversal only after a ≥ T move back, credit the full leg. It keeps every required
property (wiggles < T ignored, slow climbs counted, nulls never 0). The literal version is kept as
`anchorSteppingHysteresis` for comparison tests. Parameters unchanged: step 20 m, window 80 m (5 samples),
T = 3 m, max gap 3 samples. Owner may veto.

## D-006 (2026-11-01) Owner: build Phase 0 for the web on the computer first
Owner instruction (answer to open question 1): "for now, build it to run as a web app on the computer".
Consequences:
- Option B (MapLibre GL JS + maplibre-contour) is built as a desktop-browser page first. It needs no
  build tools and runs from a static file/host. Options C and A (native Android) are paused.
- Desktop FPS and memory numbers are recorded but **do not satisfy** the P10.5 criterion "on the owner's
  Android phone" (same logic as SPEC §14 pitfall 9). The engine decision stays open until the page is
  measured on the phone (Chrome on Android uses the same engine as the Android WebView).
- Phone model / Android version / RAM: deferred by the owner.

## D-008 (2026-11-01) Option B library versions and data-source facts (research)
- **MapLibre GL JS 5.24.0** (UMD, unpkg) + **mapbox-gl-rtl-text 0.3.0** (Hebrew shaping). Both exactly as in
  the official MapLibre "right-to-left scripts" example (maplibre.org, fetched 2026-11-01).
- MapLibre GL JS **v6.0.0** exists (released 2026-07-22): ESM-only, WebGL2 mandatory, breaking API changes
  (geo.malagis.com summary; MapLibre newsletter Jul 2026). **Not used in Phase 0**: maplibre-contour's
  documented integration is the UMD/global `setupMaplibre(maplibregl)` path, and v6 compatibility of the
  plugin is unverified. Revisit after the engine decision.
- **maplibre-contour 0.1.0** (README on GitHub, BSD-3-Clause): `new mlcontour.DemSource({url, encoding,
  maxzoom, worker, cacheSize, timeoutMs})`, `setupMaplibre`, `contourProtocolUrl({thresholds, elevationKey,
  levelKey, contourLayer, extent, buffer, multiplier})`. Newer versions not checked (npm unreachable).
- **Mapterhorn** (Data Access page): Terrarium, WebP, 512 px, `https://tiles.mapterhorn.com/{z}/{x}/{y}.webp`;
  planet.pmtiles covers z0–12, per-area files cover z13–17. → Default DEM maxzoom **12**; the page has a
  "max DEM zoom" probe at Meron and accepts `?demz=N`. `attribution.json`: `isr10` = "10 meter Digital
  Elevation Model (DEM) of Israel", resolution 10, licence "ASTER GDEM Public Domain", producer "ASTER GDEM
  courtesy of METI and NASA processed by 4cast LTD using VTbuilder"; `glo30` = COPERNICUS GLO-30, 30 m,
  "COPERNICUS full, free and open license". Tile licence and usage/fair-use policy of the hosted tiles:
  **not found** (open question; light personal use only, no bulk scraping).
- **OpenFreeMap** (quick start): style URL `https://tiles.openfreemap.org/styles/liberty`; offline downloads
  capped at 3,000 tiles / 50 MB, ≤ 4 parallel requests, unique User-Agent; custom styles must be self-hosted
  (we do: the overlay is applied on our page). Exact layer ids / `name:he` availability: **not fetchable** →
  the overlay targets OpenMapTiles schema layers and the page reports matched layers and feature counts.
- Possible risk: if Mapterhorn WebP tiles are lossy, decoded elevations get noise. The live encoding check
  and the engine-vs-decoder check on the owner's computer will show it.

## D-009 (2026-11-01) Single-file build that needs no server
Owner reported the app would not open with the start script (details pending). To remove the local
server as a failure point, `scripts/build_standalone.py` builds `dist/topo3d-standalone.html`: all local ES
modules as data: URLs behind an import map, CSS and the Topo3D overlay inlined. Opens by double-click
(file://). Verified in headless Chromium from file://: module graph, import map and embedded overlay load;
a visible red error banner appears when the libraries cannot load. Not verifiable here: real MapLibre
rendering and whether the tile servers accept requests from a file:// page (CORS with origin "null").
The server route (start-windows.bat) is kept.

## Data-source register
| Source | Use | Licence | Commercial use allowed? | Attribution | Limits / caching | Cost | Checked | Link |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| OpenFreeMap | Vector base map | ODbL data / OpenMapTiles schema; ToS not read | Spec says yes (not re-verified) | OpenFreeMap, © OpenMapTiles, © OpenStreetMap contributors | Offline ≤ 3,000 tiles / 50 MB, ≤ 4 parallel | free | 2026-11-01 quick start | openfreemap.org/quick_start |
| Mapterhorn tiles | DEM: terrain, hillshade, contours, sampling | not found | unknown → **personal use only** | Mapterhorn + isr10 (ASTER GDEM, METI/NASA, 4cast LTD) + Copernicus GLO-30 (DLR, Airbus, EU/ESA) | fair use not found; light use | free | 2026-11-01 data-access + attribution.json | mapterhorn.com/data-access |
| isr10 (in Mapterhorn) | Israel 10 m DEM | ASTER GDEM Public Domain | yes (per attribution.json) | as above | — | free | 2026-11-01 | download.mapterhorn.com/attribution.json |
| Copernicus GLO-30 (in Mapterhorn) | global 30 m fallback | Copernicus full, free and open | yes | as above | — | free | 2026-11-01 | attribution.json |
| OpenStreetMap data | Trails, peaks (via OpenFreeMap) | ODbL | yes | © OpenStreetMap contributors | — | free | spec | openstreetmap.org/copyright |
| MapLibre GL JS 5.24.0, maplibre-contour 0.1.0, rtl-text 0.3.0 | rendering, contours, Hebrew | BSD-3 / BSD-3 / BSD-2 (rtl-text: not re-checked) | yes | — | loaded from unpkg CDN | free | 2026-11-01 | — |
| Israel Hiking Map tiles | Optional marked-trail overlay | CC BY-NC-SA 3.0 (unverified) | No → personal use only | pending | pending | free | not verified, not used | — |

## D-007 (2026-11-01) Owner answers
- First region: **Upper Galilee** (initial camera around Har Meron; encoding test peak is in this region).
- Owner computer: **Windows**. Local server = `start-windows.bat` → `serve.ps1` (built-in PowerShell
  HttpListener, no installs). Serves the repo root on http://localhost:8080/. Not yet run on Windows
  (agent workspace has no PowerShell) — first run by the owner is the test.
- Hosting of the test page: **home network** — served from the owner's computer with a one-line local
  static server, reachable from the phone on the same Wi-Fi later. No GitHub Pages.

## Open questions for the owner
1. Phone model, Android version, RAM (deferred by owner, D-006).
2. FATMAP reference screenshots (≥ 3) with location/zoom/tilt.
3. Mapterhorn hosted-tile licence and fair-use policy (not found on the pages that were reachable).
