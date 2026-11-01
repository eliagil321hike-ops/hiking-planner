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

## D-010 (2026-11-01) Owner: the product is a website (supersedes D-001 Android-only, D-004, D-006)
Owner: "start over, do everything as a website, same feature guidelines". Answers to follow-up questions:
users = **owner + a few friends**; hosting = **GitHub Pages**; **desktop only for now**; storage =
**browser + GPX**. Recorded as `SPEC-WEB.md` (v4 web profile, overrides SPEC v3.2 where they conflict).
Consequences:
- Engine = MapLibre GL JS. Options A (Mapbox native) and C (MapLibre Native) dropped; no APK work.
- Existing work is kept: geo package, Topo3D overlay and the map page were web code already. The page moved
  from `prototypes/b-webview/` to `site/` (the deployed folder); overlay to `site/styles/topo3d.json`.
- GitHub Free → Pages only from a public repo (docs.github.com "What is GitHub Pages", 2026-11-01).
- Deployment: `.github/workflows/pages.yml` (checkout@v6, configure-pages@v5, upload-pages-artifact@v4,
  deploy-pages@v4 from the GitHub Docs example; setup-node@v5 + Node 22 for the unit tests). Not run yet.
- Licence scope widens from "personal use" to "small group": personal-use-only sources are no longer OK
  by default (see register). Mapterhorn hosted-tile terms remain an open question.
- `start-windows.bat` / `dist/topo3d-standalone.html` stay as local fallbacks.

## D-011 (2026-11-01) First real run on the owner's computer — findings and changes
Evidence: owner's "copy results" JSON + screenshot (Chrome 156, Windows, 4 cores, 8 GB, 1178×527, DPR 1.36).
- **Encoding check on real Mapterhorn tiles: PASSED.** Meron max within 1.2 km 1,202.5 m (1,170…1,225),
  Tel Aviv beach 4.5 m (−5…15), Dead Sea −432 m (−450…−390). Negative control ("mapbox") detected.
  MapLibre terrain vs own decoder at the Meron reference point: 1,028.2 vs 1,029.5 m (Δ −1.3 m).
- **DEM zoom at Meron:** z10–13 → 200, z14–17 → 404. Map keeps maxzoom 12 (guaranteed worldwide; z13 not
  guaranteed outside covered areas → possible holes). The elevation sampler now uses z13 with fallback
  to z12 (tested). Visual A/B for the map: `?demz=13`.
- **Rendering works:** screenshot shows 3D terrain, hillshade, contours with index lines, peak labels
  with elevation, drawn route and profile. Trail/peak base layers were matched by schema (12 hidden).
- **Label font bug:** the overlay took the base style's first font, "Noto Sans Italic" → peak and contour
  labels were italic. Fixed: prefer a "Regular" font.
- **FPS: avg 9.6, slowest-5% 4.6, 73 stutters in 12 s** (orbit at z14.2, not at Meron). Far below 30. The
  run mixed tile loading with rendering. The FPS test now: reports the GPU (detects software rendering),
  runs at a fixed Meron view, does an unmeasured warm-up orbit, then measures all layers / no contours /
  no 3D terrain to locate the cost.
- The layer test ran at z10.3 over Turkey (contours and trails start at z11) → zero counts were expected.
  The test now always measures at the same Meron view (z13.5).

## D-012 (2026-11-01) Owner's FATMAP reference screenshots — what they show
Three references received: (1) FATMAP 3D route view with draped **satellite imagery**, bright route line,
stats bar (distance, elevation range, ascent, descent, max slope); (2) a **komoot** 2D topo map
(Lünersee / Schesaplana, Austria) with soft hillshade, muted green woods, contours labelled "2400 m",
peaks "Name (2965 m)", and an elevation profile with slope-coloured line, dark fill, km axis,
highest/lowest point; (3) a FATMAP promo image: 3D **satellite** Alps with peak labels and horizon haze.
Finding: references 1 and 3 get their look mainly from satellite imagery, which SPEC P10 removed
("no satellite layer"). The free topo stack can approach reference 2, not 1 and 3. → Owner question.
Changes made now (independent of that answer): slope-coloured profile with fill, km grid, highest/lowest
point, drag readout, text legend (not colour only); sky + horizon haze (MapLibre sky spec, GL JS ≥ 4.5).

## D-013 (2026-11-01) Performance diagnosis, run 2 (owner computer)
GPU: "ANGLE (Intel, Intel(R) HD Graphics 4400 … Direct3D11)" — hardware acceleration ON, WebGL2 yes; an
integrated GPU from 2013. Pixel ratio 1.36. Orbit at Meron z13.5 after an unmeasured warm-up:
all layers **8.0 fps** · no contours **17.2** · no 3D terrain **58.5** (2D with hillshade + contours).
Layer test at Meron z13.5: contours minor 68 / index 17 / labels 2, trails 21 (track 7, path 14,
footway 0), peaks 7, landcover 42 → the overlay matches real data.
Conclusion: 3D terrain is the cost; contours rendered onto the terrain double it. Next measurements
(added to the FPS test): pixel ratio 1, index contours only (100 m), no contour labels. `?pr=1` sets the
pixel ratio at load. If these are not enough: MapLibre GL JS v6 (release notes list terrain rendering
optimisations), at the cost of re-checking maplibre-contour compatibility. Note: cold-start "first idle"
was 681 s in run 2 → the map rarely becomes fully idle with 3D + contours on this machine.

## D-014 (2026-11-01) Owner: relax the 30 FPS target for this computer
Owner chose option 3 (of: try MapLibre v6 / automatic low-power settings / lower the target for this
machine and measure on newer hardware). Decision:
- The ≥ 30 FPS 3D criterion is **not applied to the owner's current computer** (Intel HD Graphics 4400,
  2013). Its numbers stay recorded as a low-end reference: 3D all layers 8 fps, 3D without contours 17,
  2D 58.5.
- The FPS criterion will be measured on a newer device (computer or phone) when one is available; until
  then it stays **open**, not passed.
- No performance work is scheduled now. Options 1 (MapLibre v6) and 2 (low-power mode) remain available.

## D-015 (2026-11-01) FPS run 3: much faster, but on a cached old page; cache busting added
Run 3 (owner, same computer, two runs, at overlay 0.3.0 but app.js from before d806d46 → only the old
3 variants ran): all layers **27.5 / 25.3 fps** (slowest-5% 15 / 7.5, ~45 stutters), no contours 27.4 / 25.6,
2D 59.0 / 59.3. First idle 9.7 s (run 2: 681 s).
Reading: the same variant measured 8 fps in run 2 and ~26 fps in run 3. Run 2 was probably contaminated by
background work (contour/tile backlog after browsing Turkey, very late first idle). FPS numbers on this
machine are noisy → compare variants only within one run, and repeat runs before deciding. 3D is close
to 30 fps here, with stutters.
Cache: GitHub Pages lets browsers cache ~10 min, so owners can run stale code. Added
`scripts/stamp_build.sh` (CI): `?v=<commit>` on every relative import, entry script, CSS and overlay;
build id shown in the panel header and in the report (`build`). Verified on a stamped copy in headless
Chromium: all 14 local requests carry `?v=`, page loads.

## Data-source register
| Source | Use | Licence | Commercial use allowed? | Attribution | Limits / caching | Cost | Checked | Link |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| OpenFreeMap | Vector base map | ODbL data / OpenMapTiles schema; ToS not read | Spec says yes (not re-verified) | OpenFreeMap, © OpenMapTiles, © OpenStreetMap contributors | Offline ≤ 3,000 tiles / 50 MB, ≤ 4 parallel | free | 2026-11-01 quick start | openfreemap.org/quick_start |
| Mapterhorn tiles | DEM: terrain, hillshade, contours, sampling | not found | unknown → light use by a small group; terms to verify | Mapterhorn + isr10 (ASTER GDEM, METI/NASA, 4cast LTD) + Copernicus GLO-30 (DLR, Airbus, EU/ESA) | fair use not found; light use | free | 2026-11-01 data-access + attribution.json | mapterhorn.com/data-access |
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
1. GitHub account + repository for the site (needed to deploy; only the owner can create it).
2. FATMAP reference screenshots (≥ 3) with location/zoom/tilt.
3. Mapterhorn hosted-tile licence and fair-use policy (not found on the pages that were reachable).
