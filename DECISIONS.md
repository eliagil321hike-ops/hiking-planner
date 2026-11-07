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

## D-016 (2026-11-01) Owner verdicts on the topographic map
- Side-by-side at Lünersee vs reference 2 (komoot): owner: **"looks great"** (נראה נהדר).
- Hillshade + contours readable at z12–16, contour labels and trails legible when tilted: owner: **yes**.
- Recorded as the owner's verdict; the agent did not judge "FATMAP quality" itself (P10.5). The satellite
  references (1, 3) are addressed by the satellite layer (D-017), not by this verdict.

## D-017 (2026-11-01) Owner: add satellite, best free quality and resolution (reverses P10.1)
Free options checked 2026-11-01:
| Option | Resolution | Account / key | Free amount | Over the limit | Licence fit (owner + friends, non-commercial) | Source |
| --- | --- | --- | --- | --- | --- | --- |
| EOX Sentinel-2 cloudless 2024 | 10 m (blurry past ~z14) | none | not stated | — | CC BY-NC-SA 4.0 (2018–2025): non-commercial OK with attribution | cloudless.eox.at licence page; URL from OSM wiki |
| Esri World Imagery | sub-metre in many areas (not verified for Israel) | ArcGIS Location Platform account + API key (privilege: static basemap tiles) | 2M basemap tiles/month (third-party summary apio.sh, 2026-06; not on an Esri page) | $0.15/1,000 (same summary) — billing behaviour not verified | to verify on Esri terms | developers.arcgis.com MapLibre tutorial |
| Mapbox satellite | high (not verified for Israel) | Mapbox account + public token (pk.) with URL restriction | 750,000 raster tiles/month (mapbox.com/pricing) | pay-as-you-go $0.25/1,000 | Mapbox docs show use in MapLibre | docs.mapbox.com |
| MapTiler satellite | high | account + key | 100k requests/month; 512 px raster = 4 requests | service pauses (no charge) | free plan "personal or non-commercial" | maptiler.com pricing; satellite tile URL NOT verified → not implemented |
Decision:
- Implemented now: a background switch Topo / Satellite. **EOX S2 cloudless 2024 works immediately** (no
  account) but is only 10 m. High-resolution providers **Esri** and **Mapbox** are implemented as options
  that need a key typed into the site; the key is stored only in that browser (localStorage), never in the
  public repo.
- Which high-res account to open is the owner's decision (budget gate 0.4: Mapbox bills beyond the free
  tier; Esri billing behaviour unverified; MapTiler pauses but its URL is unverified).

## D-018 (2026-11-01) Owner: satellite must be free only (no possible charges)
Checked 2026-11-01:
- **Esri / ArcGIS Location Platform** billing help: a payment method is only needed to *enable*
  pay-as-you-go; without it, only free-tier services are available and access is restricted when the free
  tier is used up (restored next cycle). → No charges possible if no payment method is added.
- **MapTiler** free plan: "service will pause until the next month" at the limit; satellite-v2 tileset:
  zoom 0–22, ~1 m/px in the Middle East, 5–50 cm in Western Europe/USA (docs.maptiler.com). Implemented via
  its TileJSON URL (Tiles API docs), so tile size/zoom/credits come from MapTiler itself.
- **Mapbox** removed: beyond 750k tiles/month it is pay-as-you-go.
Providers now: EOX S2 (no key, 10 m) · Esri World Imagery (key) · MapTiler Satellite (key).
Recommendation to owner: Esri first (largest free quota, likely highest resolution — Israel resolution
not verified), MapTiler as second option.

## D-019 (2026-11-01) Esri World Imagery works on the live site
Owner created an ArcGIS Location Platform API key: public application, no item access, privileges
Location services → Basemaps only, referrer restricted to https://eliagil321hike-ops.github.io, expiry
2027-01-30, no payment method. Key entered in the site (browser storage only; not in the repo).
Owner screenshot (build 8ea6715, Meron, 2D): Esri imagery renders; Hebrew names (name:he) render correctly
right-to-left (e.g. הר מירון, נחל זבד, כפר חושן); peaks with elevation, trails, contours and roads are
drawn on top. Satellite look vs FATMAP references 1 and 3: owner verdict pending (needs a 3D view).
Note: the owner also pasted the key in the chat; it was not stored anywhere by the agent. Embedding the key
in the public site for friends is an open owner decision (agent recommends against).

## D-020 (2026-11-01) Owner verdict on 3D satellite: satisfied
Owner screenshot (build 8ea6715): Esri imagery draped on 3D terrain at Meron, exaggeration 2.0, contours
with labels (800/900/1,000), trails, Hebrew peak labels. Owner: "satisfied" (מרוצה). Recorded as the
owner's quality verdict for the satellite look (P10.5 owner review); the agent did not judge it.

## D-021 (2026-11-01) Owner: embed the Esri key in the public site (option B)
After the implications were explained (key public in repo and git history forever; referrer restriction
can be bypassed outside browsers; misuse can exhaust the 2M-tile free quota → Esri satellite stops for
everyone until the next cycle; no charges possible without a payment method; expiry 2027-01-30), the owner
chose B: write the key directly in the code. This is a deliberate, owner-approved exception to SPEC 0.1
rule 5 ("never hardcode secrets"); the key is a public-application key of the type Esri intends for client
apps. Stored in `site/styles/topo3d.json` (`embeddedKey`). A key typed by a user overrides it.
Esri is now the default satellite provider. To revoke: regenerate/delete the key in the ArcGIS portal and
update `embeddedKey`.

## D-022 (2026-11-01) Owner approved Phase 0 → Phase 1
Owner answer "כן" to "approve Phase 0 and move to Phase 1". Phase 0 closes with every W7 criterion passed
except FPS ≥ 30 in 3D, which stays open by owner decision D-014 (to be measured on newer hardware), and the
Mapterhorn hosted-tile terms, which stay an open question.

## D-023 (2026-11-01) Phase 1 structure
- Site code split into modules: app.js (entry), layers.js, background.js, route.js, devtools.js (dynamic
  import only with ?dev=1), i18n.js (all user text, Hebrew; developer tools stay English).
- User-facing problems go to a status line in the panel (`notify`); the developer log is only visible with
  ?dev=1 and always goes to the browser console.
- Removed: `start-windows.bat`, `serve.ps1`, `.gitattributes` (local server for the pre-website phase),
  `scripts/build_standalone.py` and `dist/` (file:// fallback), Android entries in `.gitignore`.
- New: `scripts/e2e_test.py` — real MapLibre 5.24.0 (GitHub release dist.zip, cached in .cache/) in headless
  Chromium with SwiftShader WebGL, a fixture base style with OpenMapTiles source-layers, synthetic DEM, a
  maplibre-contour stub. CI runs unit + browser smoke + e2e before deploying. Tile URLs with keys are
  redacted in test output because CI logs of a public repo are public.
- Fixed while moving code: duration could show "h:60" (minutes rounded separately); now rounds total minutes.

## D-024 (2026-11-01) Phase 1 confirmed by owner; Phase 2 (map experience)
- Owner: "עובד" (works) for the restructured site (build 2572217) → Phase 1 closed.
- Phase 2 changes:
  - "Center on me": MapLibre GeolocateControl, one fix (`trackUserLocation: false`), permission asked only on
    press (SPEC 8.1, no background location). Error → status line in Hebrew.
  - MapLibre control texts in Hebrew via the Map `locale` option (keys verified in the 5.24.0 dist).
  - **Bug found by the e2e test:** map controls were at top-left, which in the RTL layout is under the panel
    (zoom/compass were hidden for the owner). Moved navigation + location to top-right, scale to bottom-right.
  - Remembered settings (prefs.js, browser storage): layer switches, exaggeration, collapsed panel, last
    camera (used only when the URL has no camera hash).
  - Attribution: verified in e2e that the control shows base-map and DEM credits, and Esri in satellite mode.

## D-025 (2026-11-01) Phase 2 approved; Phase 3A route editor core; SPEC §8.4 off-by-one
- Owner: "2 אושר" → Phase 2 closed.
- `packages/editor` (pure TS, zero deps, 17 tests): vertices with `mode` of the segment ending at them,
  commands with exact inverses (add/move/insert/delete point, segment mode, reverse, close loop, waypoint
  add/edit/delete), undo/redo, segment cache keyed (from, to, mode, profile), stale-response guard through
  the cache, failed snap segments stay snap with status `error` (never silently free), drafts.
- SPEC §8.4 formula "new vertex at position j gets old mode_{n-j}" is off by one: the segment reaching
  position j in the new order is the old segment between v(n-j) and v(n-j+1), mode_{n-j+1}. Implemented the
  rule stated in §8.4's own parenthesis; test with mixed modes ([_, snap, free] → [_, free, snap]).
- Routed geometries are pinned to the exact control points (a router's end within ~1 cm is replaced).

## D-026 (2026-11-01) Owner: routing provider = openrouteservice (option 1)
Checked 2026-11-01: openrouteservice.org/plans — free Standard key, Directions 2,000/day and 40/minute.
BRouter public server not usable (maintainers declined a similar small web planner, GitHub issue #991,
2026-10-21). GraphHopper free: 500 credits/day, non-commercial. FOSSGIS OSRM foot: 1 req/s, policy page not
reachable. Owner to create a key; embedding it (like Esri) offered with the trade-offs (no referrer
restriction found; misuse could exhaust the daily quota; no charges). Profile `foot-hiking` to be verified
with the first real request.

## D-027 (2026-11-01) Phase 3 build: route editor UI + openrouteservice snapping
- Owner created an openrouteservice key and sent it to embed (consent to embed, like Esri D-021). Embedded
  in `site/styles/topo3d.json` → `routing.embeddedKey`. No referrer restriction found for ORS keys; misuse
  can exhaust 2,000 directions/day (routing stops until the next day); no payment method → no charges.
- `site/router.js`: GET /v2/directions/foot-hiking?api_key=…&start=lon,lat&end=lon,lat (ORS API spec:
  profile list includes foot-hiking; GET returns GeoJSON). Requests queued ≥ 1.6 s apart (< 40/minute).
  HTTP errors → codes NO_PATH / AUTH / RATE_LIMITED / SERVER / NETWORK / TIMEOUT. Attribution
  "© openrouteservice.org by HeiGIT" (exact required text not verified: the ToS page was offline).
- `site/route.js` (UI): plan mode; click add, drag move, drag mid-handle insert, select + Delete, right-click
  waypoint with name/note form, undo/redo (buttons + Ctrl+Z/Y), reverse, close loop, clear as ONE command,
  draft saved on every change and restored with a notice. Segment styles by pattern: snap solid, free
  dashed, pending dotted grey, error dotted red + an explicit "switch to straight line" button.
- Bugs found by tests and fixed: background logic cleared the "draft restored" notice; clear was N
  commands (undo restored one point); routed ends kept the router's coordinate instead of the exact point.
- Test notes: e2e uses a fake ORS server (bent lines, and 404 for the failure case); waits poll on an
  interval because software WebGL starves animation-frame polling; panel buttons are clicked from inside the
  page; the offline RTL plugin error is excluded (external script not available in tests).

## D-028 (2026-11-01) Owner fixes: streams, POIs from ~500 m scale, hide profile, fluorescent route
- Streams: own layers on the OpenMapTiles `waterway` source-layer (base waterway layers hidden by schema):
  blue #2f7fd8; width by class (river > canal > stream > drain/ditch), at z14: 4 / 2.6 / 2 / 1 px vs trails
  ~1.6–2 px; intermittent streams (wadis, `intermittent=1`) dashed; names along the line from z12.
  New switch "נחלים".
- Points of interest: own layers on the `poi` source-layer from **z13** (≈ a 500 m scale bar at the owner's
  screen width): parking, campsites, picnic sites, water, springs, viewpoints, shelters, huts, toilets,
  information, ruins/archaeological sites, places of worship, monuments (class or subclass). Hebrew-first
  name, otherwise a Hebrew type label (e.g. "חניון"). Base poi layers hidden. New switch "נקודות עניין".
  Limitation: OpenFreeMap tiles stop at z14 and the poi layer may be rank-limited at z13.
- Elevation stats + profile can be hidden (✕ on the profile or the "הצג גובה ופרופיל" switch); remembered.
- Route line: fluorescent green #39ff14 with a dark casing (owner: "fluorescent, more prominent, a different
  hue from the trails"); pending segments dotted light grey, errors dotted pink-red #ff2d55.

## D-029 (2026-11-01) Owner: toolbar and menus behind icons
- Always-visible prominent "מסלול חדש" button with a plus icon (confirm → clear route as one undoable command
  → planning mode on). Layers menu and route-options menu each open from an icon button and close on a
  second click; opening one closes the other; Escape closes; a map click closes them unless planning.
- A small "עריכת מסלול" badge shows while planning.

## D-030 (2026-11-01) Owner: lower, lighter elevation profile
- Height 170 → 122 px, thin 2 px slope-coloured line over a pale fill, light grid.
- Right end always shows a tick with the **full route length** (owner request); km ticks closer than 48 px to
  the end are dropped so labels never collide.
- Highest/lowest moved out of the plot to a top info row (length · ▲ · ▼); slope percentages moved to their
  own legend row at the top right (coloured bars + "0–8% / 8–15% / 15–25% / 25%+"), clear of the ✕ button
  (now top-right, smaller). Fixes the overlapping labels in the owner's screenshot.

## D-031 (2026-11-01) Owner: tent icon for campsites, tap icon for drinking water
- From z13 (the same ~500 m scale as other POIs): brown tent for OpenMapTiles `campsite` / `camp_site`
  (חניון לילה), blue tap for `drinking_water` / `water_point` / `water_tap`. Separate symbol layer
  `topo-poi-icon` (allow-overlap so the icon never disappears behind labels); the round dot is no longer
  drawn for these classes; the name label sits under the icon. Part of the "נקודות עניין" switch.
- Icons are our own drawings in code (Path2D, white outline for hillshade/satellite), modelled on the
  owner's examples. The owner's tap picture is a watermarked VectorStock stock image, so it is not copied.
- Coverage depends on OSM tagging in the OpenFreeMap tiles; a campsite missing from OSM shows no icon.

## D-032 (2026-11-01) Owner: icons from ~1 km scale; national/regional trails coloured; Israel Trail orange
- Verified: OpenMapTiles `poi` has campsites/taps **only from z14** (poi.sql: z12–13 = railway stations,
  halts, ferry terminals). So the z13 POIs of D-028/D-031 really appeared only at z14 — corrected here.
  OpenMapTiles has **no hiking-route relations** at all.
- New data path: `scripts/fetch_osm_hiking.py` queries the Overpass API **at deploy time in GitHub Actions**
  (the agent workspace cannot reach Overpass) for the Israel bbox (29.45,34.2 – 33.45,35.95): hiking route
  relations with network iwn/nwn/rwn/lwn (+ their child sections), `tourism=camp_site`,
  `amenity=drinking_water`, `man_made=water_tap` (not `drinking_water=no`/private). Output:
  `site/data/osm-trails.geojson`, `site/data/osm-pois.geojson` (Douglas–Peucker 4 m). Weekly scheduled
  redeploy refreshes it. If Overpass fails the deploy continues without the files (layers stay empty).
  Data © OpenStreetMap contributors, ODbL (attribution on the source).
  First CI run: one combined query timed out (504) on overpass-api.de and private.coffee → split into
  small queries (major routes; POIs; marked trails in 0.5° latitude bands), each retried on both servers;
  parts that fail are skipped and reported, the rest is shipped.
- Israel National Trail: any route (or section of a super-route) named "שביל ישראל"/"Israel National Trail"
  → orange #ff7a00. Other national #8e24aa, regional #e0287d. National lines are the widest on the map
  (z14: 9 px, z16: 15 px). Names: thin 11 px text along the line from z14.4 (≈ when the scale bar first
  shows 200 m at Israel's latitude).
- Tent/tap icons from the extract from z11.7 (≈ scale bar 1 km); names from z13. Outside Israel the
  base-tile icons (z14) remain.
- Scale-bar ↔ zoom: MapLibre's bar (max 100 px) rounds to 1/2/3/5×10ⁿ; at lat 33° m/px = 65 644 / 2^z
  → 1 km from z11.7, 500 m from z12.7, 200 m from z14.4.

## D-033 (2026-11-01) Owner: trails before small streams; marked trails before unmarked; width order
- Appearance when zooming in: national/regional routes z7 → rivers/canals z8 → **marked trails z10** →
  unmarked paths/tracks z11 → small streams (stream/drain/ditch) **z13**.
- Marked trails = OSM `network=lwn` hiking routes (Israel Trails Committee trails are tagged this way, e.g.
  relation 1397878 "סובב הר איתן", lwn, osmc:symbol red:white:red_stripe), drawn in their marking colour
  from `osmc:symbol` (red/blue/green/black…), solid, with a white casing.
- Width order at z14 (owner): national 9 > regional 6 ≈ rivers 6 > marked 3.5 > unmarked 1.8 ≈ intermittent
  streams 1.8 (perennial streams 2.2, drains 1).

## D-034 (2026-11-01) Owner: every non-perennial waterway is a small stream
- Any waterway with `intermittent=1` (e.g. Nahal Zin, class river) is drawn as a small stream: tier 4, thin
  light-blue dashes (#5a9fdc, z14 1.2 px — a bit thinner than unmarked paths, as in the owner's example
  image), only from z13. Perennial rivers/canals/streams stay solid blue (#2f7fd8) and appear earlier.
- Limitation: a wadi missing `intermittent=yes` in OSM is shown as perennial.

## D-035 (2026-11-01) Owner: 4x4 tracks like the example; self-review of the last hour
- 4x4 tracks: double dashed brown line (wide dashed #9b7a5a + narrow light inner line), as in the example.
- Self-review changes: unmarked paths dark grey dashes (#5a5550) — they were red-brown, too close to red
  marked trails; marked trails dashed in their colour (as in the example) with a white casing; base-tile
  campsite/water icons and labels hidden inside the Israel bbox (`within`) so they do not duplicate the
  OSM-extract icons; deploy keeps the currently live OSM files when Overpass fails or answers partly.
- Visual check: all line kinds rendered side by side with the real MapLibre build at z14/z15.

## D-036 (2026-11-01) Owner brief "Advanced cartographic refinement" — stage 1: points of interest
- The OSM extract adds: car parks within 400 m of a hiking route (trailheads; underground/multi-storey/
  private dropped), `natural=spring` (seasonal ones flagged), `tourism=viewpoint`, shelters/huts (bus and
  field shelters dropped). Marked-trail queries in 0.25° bands (a central 0.5° band timed out).
- One icon set (poi-icons.js): 24-unit grid, same white outline, one colour per category — tent, tap,
  parking "P", spring drop, viewpoint binoculars, shelter house, peak triangle, saddle.
- Campsites, water and parking: separate clustered GeoJSON sources (a numbered circle per group, expands on
  zoom), visible from **z11** — already before the 500 m scale (z12.7) the brief requires; springs from
  z12.7, viewpoints/shelters from z14. Separate switches for each category.

## D-037 (2026-11-01) Stage 2: peaks, contours, hillshade
- Peaks: triangle icon (saddle: own symbol), elevation in smaller text, importance by elevation — higher
  peaks win label collisions (symbol-sort-key) and show from z10; minor peaks only from z13.
- Contours: index lines fade in from z11 (opacity 0.45 → 1 at z13), round joins; 10 m interval from z14;
  labels from z12.5, 10.5 px, spaced 420 px, padding 8 px, kept upright, avoid tile edges (less clutter,
  no overlapping labels).
- Hillshade: **multidirectional hillshade evaluated and rejected**: MapLibre 5.24 supports it
  (`hillshade-method`), but it made the page hang in the software-WebGL test (65/65 with one light, page
  reload timeout with four), and the owner's Intel HD 4400 already runs 3D at 8–26 fps (D-014). Kept one
  light at 315° with softer warm shadows (exaggeration 0.55).

## D-038 (2026-11-01) Stage 3: main interface — styles, 2D/3D, search, layer menu, terrain layers
- Toolbar: new route · place search · map style · layers · route options; translucent (blurred) floating
  controls. Map controls (top right): zoom/compass, location, **2D/3D button** (3D = terrain on + camera
  eases to 60°; 2D = terrain off, straight down; remembered; exaggeration shared by all styles).
- **Map style** picker with three cards: topographic; satellite (imagery + trails, water, peaks, POIs,
  labels; no contours/hillshade/tint); **hybrid 3D** (imagery + 3D terrain + hillshade + contours + all
  features; switches to 3D). The user's layer switches are kept; a style only hides what does not suit it.
- **Layer menu** in two categories with switches: Terrain (hillshade, contours, slope angle, aspect,
  elevation colouring — opacity sliders and legends where relevant) and Map features (trails, water, peaks,
  parking, drinking water, campsites, springs/viewpoints/shelters, vegetation). Satellite provider and key
  moved to a collapsed "מתקדם" section; developer tools stay behind ?dev=1.
- **Slope angle / aspect**: computed in the browser from the same Mapterhorn DEM tiles (Horn 3×3, latitude-
  correct pixel size, edges clamped), protocol `derive://` (site/terrain-derive.js, 7 unit tests). Slope
  classes 15/25/30/35/45°; aspect in 8 hues, flat ground (< 5°) clear. **Elevation colouring**: MapLibre
  `color-relief` (verified present in 5.24.0) with a hypsometric ramp −430…2800 m.
- **Search**: public Nominatim (OSM, free, no key). Policy respected: no search-as-you-type (Enter/button
  only), ≥ 1.1 s between requests, attribution "Nominatim · © OpenStreetMap" in the results list.
- Phone width: toolbar wraps, search full width, menus open as a bottom sheet.

## D-039 (2026-11-01) Stage 4: floating route panel
- Centered floating card (glass, rounded, soft shadow) at the bottom: distance (largest), ascent, descent,
  estimated time as large figures; min/max, elevation source and warnings in a small second line.
- Elevation profile inside the panel: drawn from the smoothed series (calm line; gaps stay gaps), start
  (green) and finish markers, slope colours, full-length end tick, hover → map marker (already existed).
- Collapse (figures only) / expand (with profile) button, remembered; ✕ hides the panel (route menu switch
  shows it again). The map stays draggable/zoomable around it.
- Not yet done: route panel position relative to important map features (it is fixed at the bottom).

## D-040 (2026-11-01) Stage 5: 3D, and what was checked vs what needs the owner's eyes
- Line labels (trail and stream names) face the camera in 3D (`text-pitch-alignment: viewport`; contour
  labels already did). Points (peaks, POIs) are placed on the terrain by MapLibre and drawn upright.
- Exaggeration: slider 1.0–2.0 with marks at 1.0 / 1.2 / 1.5 / 2.0 and a hint "1.0 = real height". Default
  stays **1.2**: it is the value the owner saw and approved in Phase 0; the agent cannot view real terrain
  (no access to the tile servers), so evaluating other defaults across terrain types is left to the owner.
- Terrain mesh, LOD, seams, draping of lines: handled by MapLibre 5.24 terrain (one DEM, 512-px tiles,
  `centerClampedToGround`); not changed. Multidirectional hillshade rejected (D-037).
- Phone: map controls moved below the wrapped toolbar.
- Verified automatically (fixtures + real MapLibre build, software WebGL): styles, 2D/3D, layer switches,
  slope/aspect tiles, search, route panel, icons and line widths rendered with the real engine.
  Not verifiable here (needs the owner on the live site): real tiles at the 500 m scale, look on satellite,
  terrain in 3D, frame rate on his computer, phone layout on a real phone.

## D-041 (2026-11-01) Efficiency: deploys reuse the live OSM extract
- Every push used to re-run all Overpass queries (~15 min per deploy, needless load on a free service).
  Now a push reuses the live files when their `extract_version` matches `EXTRACT_VERSION` in
  scripts/fetch_osm_hiking.py; the weekly scheduled run and manual runs always fetch fresh data. Changing
  the extract rules = bump EXTRACT_VERSION, and the next push re-downloads.

## D-042 (2026-11-02) Owner: expand coverage beyond Israel; split the data (answers 5, 6)
- Israel: the deploy writes the extract as 0.5° cells (`data/osm/{lat}_{lon}.json` + `index.json`); the
  site loads only the cells in view (+25 % margin), from z7, keeping ≤ 160 cells in memory. Before: one
  4.5 MB trails file + 1.3 MB points file on every visit.
- Elsewhere (any country): trails (iwn/nwn/rwn/lwn routes) and points of interest are loaded on demand from
  the public Overpass API from **z11** (≈ 1 km scale bar), 0.25° cells, one request at a time, at most 6
  cells per request (zoom in further otherwise). Same rules in the browser (site/osm-build.js) as at build
  time (scripts/fetch_osm_hiking.py); tests/osm-build.test.mjs requires identical output on one fixture.
  Limits: abroad, national trails appear only from z11 (not z7), and loading depends on Overpass being up.
- Build-time extract rejects Overpass answers older than 14 days when another server can answer (the backup
  server answered with data from 2026-07-15 on 2026-11-01); out-of-date data is used only as a last resort.

## D-043 (2026-11-02) Owner answers 1–4, 7, 8
- 1: the planned route is the dominant line: width by zoom, wider than national trails at every zoom
  (z14: 11 px + casing 15 px vs national 9 px).
- 2: only the planned route stays fluorescent (#39ff14). Calmer colours for everything else: Israel Trail
  #e3893f (still orange), national #8a5c9c, regional #c2608a, marked-trail colours muted in the style
  (data unchanged, no re-download).
- 3: default exaggeration 1.5; a value remembered under the old default is reset once.
- 4: no multidirectional hillshade for now. 7: slope/aspect computation left as is. 8: next work = more map
  polish (not yet saved routes / GPX).
- Owner check of the live site: icons fine, looks good, "a bit sluggish but not disturbing", snapping great.

## D-044 (2026-11-02) Data refresh must not hang on a dead Overpass server
- Seen: a manual refresh spent 50+ minutes because overpass-api.de timed out (240 s) on each of ~20
  queries before the backup answered (with data from July).
- Now: a total time budget (25 min, `OSM_BUDGET_MIN`); per-request timeout 150 s; a server that failed
  twice is tried last; parts not done in time keep the live data. A new extract older than the live one is
  never deployed (the live files are kept).
- e2e: every wait is polled from Python (in-page polling starved on the busy software-WebGL page and made
  CI flaky, blocking a deploy).

## D-045 (2026-11-02) Owner: campsites/taps from 500 m; category search in the search box
- Campsite (tent) and drinking-water (tap) icons from z12.7 (≈ 500 m scale bar); parking unchanged (z11).
  Owner clarified "חניונים" = campsites.
- Search box: a category word ("חניון לילה", "ברז", "מים", "חניה", "מעיין", "תצפית", "מחסה", English too;
  site/poi-categories.js) shows every point of that category **in the current view at the moment of the
  search** (owner's choice: not following later map moves), at any zoom, grouped with a count when crowded
  (owner's choice), other icons unchanged (owner's choice). A chip shows the count with ✕ to clear. No
  request to Nominatim for category words. Israel cells in view are loaded as needed; abroad, up to 24
  on-demand cells, otherwise the chip asks to zoom in. New icon category = one entry in poi-categories.js.

## D-046 (2026-11-02) Owner re-answered the category-search details
- Ending the display: **emptying the search box** (typing it away or the box's own ✕) clears it; the ✕ on
  the chip still works too.
- A category word now also searches places by name: the results list starts with the category line
  ("N חניוני לילה באזור") and then Nominatim places. Replaces "no Nominatim request for category words"
  in D-045. Grouping with a count and "current view at the moment of the search" stay as in D-045.
- D-045's first deploy was blocked by CI: the e2e still looked for campsite/tap icons at z12 after they
  moved to z12.7; the test now looks at z13 (a test expectation, not a site bug).

## D-047 (2026-11-02) Owner: campsites from the 5 km scale, Gaia-like square icons for all
- Owner's example: Gaia GPS (small dark-grey square with a white tent). Owner chose: that style for every
  point-of-interest icon; campsites from the 5 km scale; overlapping campsite symbols hide each other.
- Icons (poi-icons.js): rounded square in the category colour, white symbol, thin white edge and a soft
  shadow — campsite #4d4a45, tap #1f7fc0, parking #2c4f86, spring #13897f, viewpoint #8c3b1c, shelter
  #56616b. Our own drawings (nothing copied from Gaia). Peaks and saddles stay plain symbols.
- Campsites: from **z9.4** (MapLibre's scale bar first shows "5 km" there at Israel's latitude), own
  unclustered source, `icon-allow-overlap: false` (a hidden badge appears when zooming in). Size ≈ 15 px at
  z9.4 → 24 px at z16.
- Taps, parking, springs, viewpoints, shelters: from **z12.7** (500 m). Parking moved from z11 to z12.7.
  Taps and parking keep grouping with a count (the overlap choice was asked for campsites only).
- Abroad, campsites still appear only from z11 (on-demand loading starts there, D-042).

## D-048 (2026-11-02) Owner: proportions, smaller icons, everything from 500 m except campsites
- Owner's rules: one uniform line, pleasant colours, a size that does not take over the layers, clearly
  visible. Owner chose direction א (coloured square, Gaia-like) from four sketches (coloured square, earth-
  tone circle, white with coloured edge, uniform dark ink).
- Every badge: square 3.5–20.5 of the 24-unit grid, every symbol drawn at 80 % around the centre (same
  proportion for all), one 1-unit white edge, faint shadow. Softer colours: campsite #59544d, tap #3a85bf,
  parking #4a6690, spring #2f8f86, viewpoint #a65f42, shelter #6c7782, new **picnic site** #5e8a52.
- Size on the map: icon-size 0.7 at z12.7 → 0.95 at z16 (square ≈ 12 → 16 px); campsites 0.58 at z9.4.
- Every point symbol only from **z12.7** (500 m), campsites from z9.4 (5 km) — owner repeated this. Category
  search results still show at any zoom (D-045).
- "חניוני יום" = day-use picnic sites (OSM `picnic_site`, base tiles): picnic-table badge instead of a dot,
  label "חניון יום". Peaks keep their own (plain triangle) symbol from z10.
- e2e: the z13 points check is slow in software WebGL (all icons were in fact drawn — diagnostics showed
  water 1, camp 1, parking 1 just after the 60 s limit); limit raised to 150 s.

## D-049 (2026-11-02) Owner: one route dock instead of the route-options menu + stats panel
- Owner chose sketch ג (side tool bar + data panel) from three, with changes, after two sketch rounds.
- Tool bar (bottom corner, icons + tooltips): edit, snap↔straight (one toggle; the hidden `<select>` keeps
  the value), undo, redo, reverse, close loop, delete point, clear.
- Data panel: distance large; route name beside it (click to edit, saved in this browser); a dot in the
  route colour opens six colour dots (no names; owner) — fluorescent green (default), pink, cyan, yellow,
  orange, purple — and recolours the route line; ascent | descent; max | min; no walking time (owner);
  warnings in red; elevation source as a tooltip; safety note behind ⓘ. Profile with 3–5 round elevation
  levels (`elevationTicks`), start/finish markers.
- Hide (arrow): tool bar stays in the corner + a pill (distance, ascent, descent); the pill restores it.
- No route-options button (owner): "מסלול חדש" opens the dock; it is shown while editing or while a route
  exists, and disappears when the route is cleared and editing ends. Map controls move above the dock.
- Fixed on the way: `[hidden]` now always wins over component `display` rules; map credits start folded.

## D-050 (2026-11-02) Bug: hovering the elevation profile threw "ev is not a function"
- Owner screenshot (live site): red error banner while moving over the profile. Cause: in profile.js the
  pointer handler's parameter was named `ev`, shadowing the `ev(i)` elevation helper added in D-039.
  Fixed (parameter renamed). New smoke check hovers a profile and requires the readout, the map-marker
  callback and no page errors; it fails on the old code and passes on the fix.
- Lesson: the e2e never hovered the profile; interactive paths need at least one automated pass.

## D-051 (2026-11-02) Design A2 "Precision Minimal, dark" (owner chose it from sketches A/B/C)
- Owner brief: three directions (A Precision Minimal, B Modern Tech, C Professional Navigation) in the fixed brand
  palette, WCAG first. Owner liked A and asked for darker text, key icons and frames, and for buttons that open or
  close a panel to stand out from other buttons → variant A2, approved after a written plan.
- Palette tokens only (--c-*), plus --frame #848F9B (frames 3.3:1 on white) and --divider #C9D6E2 (inner lines).
  Text Dark Text #203449 (12.7:1), secondary Body Text #3E5265 (8.1:1). Turquoise only for the main action,
  active states and switches; white text on it only large and bold (19px "מסלול חדש", 3.9:1).
- Panel toggles (map style, layers, hide route panel) and the "show" pill: Deep Blue, white text, chevron; open =
  Dark Text + 3px turquoise bar. tests/contrast.test.mjs checks every pair.
- Fonts: IBM Plex Sans Hebrew (UI) + IBM Plex Mono (figures), SIL OFL 1.1, served from the site (site/fonts,
  owner: "בתוך האתר"); taken from github.com/IBM/plex (npm registry was blocked here).
- Layout: top controls float on the map with no bar behind them (owner, after first screenshots): brand + search
  top-right, style, layers, new route top-left. Corners 7px (buttons) / 10px (panels) (owner: "a bit rounder"). Map controls moved to
  the left edge under the bar, scale bottom-left; route tools stay on the right. Route line colours and map POI
  icons unchanged.

## D-052 (2026-11-02) No layers menu; icon-only top-left controls (owner)
- Owner: "remove the layers function; fix the map with all map features, hillshade and contours", and show only
  icons for the top-left controls. The layers button and menu are gone; the switches stay hidden in the page as the
  one place the fixed set is defined (hillshade, contours, trails, streams, peaks, parking, water, campsites, POIs,
  landcover on; slope, aspect, relief off). Old remembered switches are no longer restored.
- The satellite-provider settings ("מתקדם"), the build stamp and the developer panel moved into the map-style menu.
- Map style and new route are icon-only (name kept as tooltip and accessible name).

## D-053 (2026-11-02) Floating layout grid (owner: "scale to the corner, swap + and map, tidy the floating bars,
raise the right tool bar a little")
- One edge inset (16px; 8px on phones), one control height (44px), 8px between stacked controls, 12px between
  groups. Map-style button in the top-left corner, "+" beside it; left control column starts 12px under that row,
  same left edge. Popovers open beside the column.
- Scale in the bottom-left corner with the credits button beside it on one line (attribution moved bottom-left);
  they move up only for the full-width route panel (--panel-h), on phones above the whole dock.
- Right route tool column: with the panel hidden it ends 72px above the bottom (mirrors the left column's 72px from
  the top); with the panel open it sits beside the panel.

## D-054 (2026-11-02) Bug: elevation graph cut at the bottom and narrower than its box (owner screenshot)
- The graph is drawn for the size its box had at that moment and was never redrawn, so a later change (panel
  shown, window resized, a long warning widening the figures column) left it stretched short or cut off; the
  panel had a fixed height, so a warning line pushed the graph below its bottom edge.
- Fix: redraw on every size change of the graph box (ResizeObserver); fixed graph height (136 px), panel grows
  instead of clipping; the figures column has a max width so a warning wraps. New e2e check: the drawing matches
  its box and stays inside the panel, before and after a window resize.

## D-055 (2026-11-02) Small map controls top-right; soft cards for search, controls and route tools (owner)
- Owner: make the whole map-control menu smaller and put it in the top-right corner; style the search box, the
  map controls and the route tool bar as they were before A2 (owner screenshot of the earlier version).
- Map controls (zoom, compass, location, 2D/3D) back to MapLibre's 29 px, top-right corner, white cards with a
  soft shadow and no frame; the search row moved left by the column's width. Search box and route tool bar:
  no frame, soft shadow, rounder corners (12 / 14 px); active route tool in Dark Text (as in the screenshot).
- D-054 follow-up: the redraw on resize used requestAnimationFrame, which never ran while the software-rendered
  map was busy (e2e caught it); it now redraws directly in the ResizeObserver callback. The fixed graph height
  needed an id selector to beat the older `#profile { height: 100% }`.

## D-056 (2026-11-02) My Routes library (owner approved; published)
- Owner brief: card view, folders, manual saving only, map preview picture, edit = update original or create copy;
  every stage shown before it goes live. No server or accounts exist, so the library lives in this browser's
  IndexedDB ("topo3d-library"; the github.io origin is shared by all the owner's sites) behind a small adapter
  (library-store.js), with a userId field ("local") so a synced store (e.g. Google) can be added later.
- A route record keeps everything to restore it exactly: the editor draft (control points, segment modes, routed
  segment geometries), the whole line, the elevation profile every 20 m, figures, bbox, colour and a JPEG preview
  captured from the map fitted to the route (editing handles hidden; a drawn sketch if the map cannot be read).
- The route on the map stays separate: it is linked to a saved record (savedId) and compared with what was saved
  (savedSig) → "saved / unsaved / changes not saved". Leaving unsaved work (new route, opening another, closing
  the page) asks first. Saved routes are drawn only when opened. The existing draft auto-recovery is unchanged
  (owner, 2026-11-02: keep it).
- Owner approved the design (2026-11-02) and expects small fixes later: the library's sizes live in a few tuning
  variables at the top of its CSS section (--lib-w, --lib-cols, --lib-gap, --lib-radius, --lib-card-radius,
  --lib-thumb-ratio, --lib-btn-h, --lib-dlg-w, --lib-title), all texts in i18n.js.
- Owner approved publishing (2026-11-02 22:33) and asked to keep the site as it was, to undo or edit later:
  branch snapshot/site-before-my-routes = the live code before My Routes (c42bae9). Undo = merge a revert of the
  My Routes merge into main (CI tests + redeploys). Saved routes stay in the browser either way.

## D-057 (2026-11-03) Route figures: sketch A (owner)
- Owner: "no space after the comma" in 4+ digit numbers, larger ascent/descent icons, another icon for max/min;
  chose sketch A of three. The figures (route panel, pill, library cards, save dialog) use the interface font with
  same-width digits (tabular figures) instead of IBM Plex Mono, whose comma is a full digit wide.
- Icons (site/stat-icons.js): an arrow on a slope for ascent (turquoise) / descent (medium blue), a peak with a
  gold flag for the highest point, a valley for the lowest. e2e checks the font and the four icons.

## D-058 (2026-11-03) Style sheet cleanup (owner: "remove what is no longer relevant")
- style.css had grown in layers (D-038 → D-056, each overriding the last). Removed: rules for components that no
  longer exist (old route panel and stats, segmented controls, icon buttons, the layers menu's switches and
  swatches, which stay hidden since D-052), and declarations always overridden by a later rule. 691 → ~612 lines.
- Checked by comparing the computed style and box of every element in 14 UI states (computer + phone: start, map
  style, planning, route, save dialog, pill, library, card menu, edit dialog, search) before and after. The first
  pass had dropped the top-right controls' offset (they moved 16 px up); restored, compared again. Remaining
  differences: the hidden layers menu, an empty MapLibre corner container, and the figures area (D-057).

## Data-source register
| Source | Use | Licence | Commercial use allowed? | Attribution | Limits / caching | Cost | Checked | Link |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| OpenFreeMap | Vector base map | ODbL data / OpenMapTiles schema; ToS not read | Spec says yes (not re-verified) | OpenFreeMap, © OpenMapTiles, © OpenStreetMap contributors | Offline ≤ 3,000 tiles / 50 MB, ≤ 4 parallel | free | 2026-11-01 quick start | openfreemap.org/quick_start |
| Mapterhorn tiles | DEM: terrain, hillshade, contours, sampling | not found | unknown → light use by a small group; terms to verify | Mapterhorn + isr10 (ASTER GDEM, METI/NASA, 4cast LTD) + Copernicus GLO-30 (DLR, Airbus, EU/ESA) | fair use not found; light use | free | 2026-11-01 data-access + attribution.json | mapterhorn.com/data-access |
| isr10 (in Mapterhorn) | Israel 10 m DEM | ASTER GDEM Public Domain | yes (per attribution.json) | as above | — | free | 2026-11-01 | download.mapterhorn.com/attribution.json |
| Copernicus GLO-30 (in Mapterhorn) | global 30 m fallback | Copernicus full, free and open | yes | as above | — | free | 2026-11-01 | attribution.json |
| OpenStreetMap data (Geofabrik extract, D-060) | Trails, POIs (build-time extract, daily file, weekly use) | ODbL | yes | © OpenStreetMap contributors | one download per weekly run | free | 2026-11-03 | download.geofabrik.de |
| OpenStreetMap data | Trails, peaks (via OpenFreeMap) | ODbL | yes | © OpenStreetMap contributors | — | free | spec | openstreetmap.org/copyright |
| MapLibre GL JS 5.24.0, maplibre-contour 0.1.0, rtl-text 0.3.0 | rendering, contours, Hebrew | BSD-3 / BSD-3 / BSD-2 (rtl-text: not re-checked) | yes | — | loaded from unpkg CDN | free | 2026-11-01 | — |
| Israel Hiking Map tiles | Optional marked-trail overlay | CC BY-NC-SA 3.0 (unverified) | No → personal use only | pending | pending | free | not verified, not used | — |

## D-060 (2026-11-03) OSM extract from the Geofabrik Israel file instead of Overpass (branch wip/osm-geofabrik)
- Problem: the live OSM extract was stuck at 2026-07-15. The weekly Overpass refresh failed (502/504, 25 min
  budget used up) or got out-of-date answers from the backup server (D-042, D-044).
- Change (data path only; nothing in site/ changes, the map looks the same): weekly and manual deploys download
  `asia/israel-and-palestine-latest.osm.pbf` from Geofabrik (updated daily, ODbL), filter it with osmium
  (`tags-filter` + `add-locations-to-ways`, OPL text) and `scripts/osm_opl.py` turns that into exactly the data
  the Overpass queries returned, so `build()` and every output file are unchanged. Overpass stays the fallback;
  if both fail, the live data is kept (D-035/D-044). Pushes still reuse the live extract (D-041).
- One improvement over Overpass: a route counts as "in the box" also through its child relations (the Israel
  Trail super-route holds only sections); children are followed at any depth (Overpass: one level).
- Checked: tests/osm-opl.test.mjs (same build() output as Overpass on the fixture; escapes, areas, box, missing
  locations, children; it failed before the super-route fix). Dry run on the real file (osm-check.yml, no
  deploy): 59 s in all (download 116 MB in 38 s, filter 3 s), OSM data 2026-11-02 21:21 UTC.
- Comparison with the live data (scripts/osm_compare.py, Geofabrik outline): inside Israel & Palestine the
  counts match (trails 1889 = 1889; campsites 349 = 349; shelters, water equal; springs 767 → 769; viewpoints
  1809 → 1811). Differences inside are OSM edits since July ("Gospel Trail" now "דרך הבשורה", new "שביל קדם",
  "דרך חוצה דן" gone with the 72 Tel Aviv car parks kept only for being near it).
- **Coverage change, owner to decide:** the old box (to 35.95° E, from 29.45° N) also caught parts of Jordan,
  Sinai and south Lebanon: the Jordan Trail (39 sections, "national"), ~313 Wadi Rum/Jordan campsites, ~230
  springs. The Geofabrik file has Israel & Palestine only. Those areas still load on demand from z11 (D-042), but
  no longer from z7 (trails) / z9.4 (campsites). Option: add Geofabrik's Jordan file to the same run.
  **Correction (found 2026-11-03 while building D-061):** the sentence above was wrong for this branch as first
  built: the site took the whole old box as "covered" and asked Overpass nothing there, so Jordan/Sinai inside
  the box would have shown no trails at all. D-061 fixes it: coverage now follows the Geofabrik border outline.
- New files: scripts/osm_opl.py, scripts/osm_source_geofabrik.sh, scripts/osm_compare.py,
  .github/workflows/osm-check.yml (runs on wip/osm-** branches only). Not merged: needs the owner.

## D-061 (2026-11-03) Owner: waterfalls, pools, ruins; worldwide with Georgia and Norway pre-built
- Owner approved the sketch (icons as drawn), chose "no trail difficulty for now" (OSM: only 323 of 188,064
  Israeli paths carry sac_scale, 501 trail_visibility) and "extra countries + everything else": **Georgia, Norway**.
- New points, same badge style and zoom as springs/viewpoints (from 12.7, names from 14), worldwide (pre-built
  regions + Overpass elsewhere), each with category search words:
  waterfall `waterway=waterfall` (#3f6fa3; 330 in Israel) · pool (#3c8ea8): `water=stream_pool`,
  `leisure=swimming_area` (not private), and water bodies named "גב/גבי/בריכת/בריכה …" that are not
  reservoir/wastewater/fishpond/basin/river/canal/lake/lagoon/moat and not swimming/fish/sewage pools by name
  (OSM has no single tag; the name rule works only in Hebrew areas) · ruins `historic=ruins|archaeological_site`
  (#8a6f4e; ~2,700 in Israel). Base-map ruins dots are hidden inside the pre-built regions (no duplicates).
- Regions: each country is extracted from its Geofabrik file into its own files (Israel keeps its names and its
  Overpass fallback; Georgia/Norway keep their previous data when a download fails), then merged into the 0.5° cells.
  index.json lists the regions and `covered`: the 0.25° on-demand cells lying wholly inside a region's Geofabrik
  border outline (a cell counts only if an 8×8 lattice inside it is inside and no outline vertex falls in it).
  The browser asks Overpass only for uncovered cells; along a border both sources load and the same route (by
  relation id) or point (kind + position to 4 decimals) is shown once, the pre-built copy winning.
- Deploy: fresh extract weekly, on manual runs, and on a push that changes EXTRACT_VERSION (now 4); other pushes
  reuse the live files; outlines are fetched every time. Tests: tests/osm-regions.test.mjs, tests/osm-loader.test.mjs,
  fixture with included/excluded pools, e2e (new badges render, base ruins dots hidden, a second region loads from
  cells with no Overpass request).

## D-062 (2026-11-03) Owner: point icons must not be hidden by the planned route (from the 500 m scale)
- Owner screenshot: a campsite icon under the fluorescent route. The route line, casing and pending segments are now
  drawn under the point-icon layers (inserted before `topo-poi-dot`); the route's handles, midpoints and waypoints
  stay above everything (they are dragged and clicked).
- Route about 10 % thinner from z12 (owner: "maybe a little thinner, if it stays clear"), still wider than national
  trails at every zoom (D-043): line z12/14/16 6.8/10/15.6 px (was 7.5/11/16), casing 9.8/13/18.6 (was 11/15/21);
  national 6/9/15, casing 8.5/11.5/17.5. Before/after preview sent to the owner. e2e checks the order and widths.

## D-063 (2026-11-03) Bug: gevim did not show (owner: "for some reason no gevim appear")
- Cause: the D-061 pool rule assumed water bodies named "גב …". A scan of the whole Israel file (temporary
  workflow, branch wip/osm-pools-diag) found that Israeli gevim are tagged **`natural=waterhole`** (nodes, often
  with photos): גב צרור, גבי שיש, גב חצרה, גבי קניון צין, גב קינה, גב עשרון … ; the 72 "pools" shown were almost
  all "בריכת …" water bodies.
- Fix: `natural=waterhole` counts as a pool (worldwide, the standard tag for a natural water hole) in the Python and
  browser rules, the Overpass queries, the OPL rule and the osmium filter; fixture has גב צרור. EXTRACT_VERSION 5,
  so the deploy fetches fresh data at once.

## D-064 (2026-11-03) Owner: waypoints rebuilt as marked points (personal points + route marks)
- Owner sketches approved ("עיצוב נהדר"), with two changes: marking-mode icon replaced (crosshair) and the layer
  button icon replaced (map pin); peak and parking allowed as symbols.
- Two kinds. Personal points: crimson #D0435B (same lightness as the site colours, apart from the map colours),
  white frame and symbol; saved in the library (IndexedDB `points` store, DB version 2), shown on their own layer
  with a remembered on/off switch ("pointsLayer"). Route marks: the route's colour, dark navy frame + white ring,
  dark or white symbol by contrast; saved with the route, shown only while that route is open. The route does not
  pass through marks; they sit beside it. The pin is a rounded square with a pointer and a white dot on the spot.
- Marking: map-pin button → menu (layer switch + count, "mark points" mode, "my points"). The route toolbar has its
  own marking tool (crosshair), never on together with drawing. Right-click marks too: inside route building a route
  mark, otherwise a personal point. Phone: tap marks, drag pans. Tapping a personal point in route marking adds it to
  the route. Tapping a map point (spring, campsite, …) takes its name and symbol and hides its small icon under the pin
  (own-source point layers only; base-map icons/peaks stay visible – known limit). An empty spot → "general location".
- After each mark a dialog: name only + symbol (12: general, viewpoint, spring, tap, waterfall, pool, tent, picnic,
  shelter, ruins, parking, peak), elevation shown, save/cancel/delete; leaving with changes asks first (like routes).
  No dragging: delete and mark again.
- "My points" panel: search, symbol filter, show on map, edit, GPX of all personal points. Library card menu:
  "download GPX" = the route track (with elevations) + its marks.
- The old waypoints (no symbol) are removed completely, also inside saved routes (one-time, keeps updatedAt).
- Tests: tests/points-gpx.test.mjs; e2e covers personal points, POI marking, layer memory, my points, route marks,
  route GPX.

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

## D-065 (2026-11-05) Owner: day split ("חלוקה לימים") – added only
- Owner rules: ADD ONLY (nothing existing changes; minimal hooks, listed in PROGRESS) and keep the site's design
  language (the owner's picture shows what and where, not how it looks). Only the day colours are new.
- Owner answers (2026-11-05): entry button with a clear icon, in its own bar together with "save", a short gap
  above the route tool bar ("as if the bar was cut in the middle"); inside, a "route building / days" switch;
  NO times of any kind (no walking time, hours, dates, sunrise/sunset, warnings, rest days); automatic split
  balanced by distance + ascent (100 m of ascent = 1 km), preferring to end a day near a campsite, spring/water,
  shelter or a personal point; number of days with − / +; "split again" asks first when lodgings were moved by
  hand; lodgings dragged on the map or by their boundary in the graph, snapping to a known place within 150 m and
  taking its name (renamable); a lodging may be off the route: dashed line, not counted in any distance; after a
  route edit lodgings stay where they are and the day boundary moves to the nearest route point (in route order),
  a lodging more than 500 m away gets a note; table = distance, ascent, descent + total; a day chip focuses the
  map on that day, dims the others and shows only that day in the graph; a number on the route for every day
  (not colour alone); day colours only while the days screen is open; one GPX with a track per day and the
  lodgings as waypoints (a route without days exports exactly as before – checked byte for byte); phone: a
  drawer from the bottom; "N days" tag on the library card (owner approved this one touch of an existing screen).
- The split is saved with the route (`daySplits: { version: 1, lodgings: [{ lon, lat, name, source, custom,
  manual }] }`); N days = N − 1 lodgings. Routes without it load, compare ("saved"/"changed") and save exactly as
  before.
- Reused components / tokens per element:
  | element | built from |
  | --- | --- |
  | save + days bar | the route tool bar itself (`.route-tools`, `.tbtn`, `.ic` stroke icons); pressed = `--c-deep` like other pressed tool buttons |
  | build / days switch | segmented control from `--c-page` track + `--c-deep` pressed (as `aria-pressed` chips), `--font` 600 |
  | summary panel | the library panel card: `--c-white`, `--lib-radius`, library shadow, `--top-h` / `--edge` / `--nav` placement |
  | − / + and buttons | `.lib-btn`, `.lib-btn.icon`, `.lib-btn.primary` (library dialogs) |
  | table | `--font` + tabular numbers, `--c-body` headers, `--divider` / `--c-page` rules, stat icons (`stat-icons.js`, D-058) for ascent/descent |
  | note (far lodging) | `--c-page` box with a `--c-gold` start border (the site's existing accent), no new colour |
  | day chips | `.lib-chip` (library folder chips) on a white card with the panel shadow |
  | day graph | the route graph (`profile.js`): `elevationTicks`, `.profile-axis/grid/cursor/readout`, same card (`--frame` border, `--panel-shadow`) |
  | lodging marker | white round badge with `--c-dark` ring (like the map's point badges) + `--c-dark` name tag; snapping ring `--c-turq` |
  | lodging dialog | `.lib-dialog`, `.lib-form`, `.lib-field` |
  | library tag | `--c-light` pill with `--c-dark` text |
- New: day palette `#2F7FD8 #E8892B #9A5BD3 #3E9E4F #D9A90F #D2559A #4B5FD1 #8C6D3F` – mid-tone, distinct from each
  other, from the personal-point crimson and the brand turquoise; drawn at the route's width on its dark casing so
  they read on topo, hybrid and satellite; every day also has a numbered badge on the route.
- Code: `site/days-core.js` (pure, unit-tested), `site/days.js` (screen), `site/days-profile.js` (graph);
  tests `tests/days.test.mjs` + e2e section "day split".
- 2026-11-06 (owner): the button is called "חלוקה למקטעים"; icon = elevation line cut into 3 segments with a dot at
  each cut (sketch "A+D 1"). Only the button label/tooltip changed; the screen keeps "ימים / יום k". Approved for release.

## D-066 View mode ("צפייה"), 2026-11-06/07
- Owner: a saved route can be viewed "only as a map", without the tool bars, by an eye button; a split route is then
  shown only in its segment colours.
- Owner answers: the eye replaces "פתח" as the card's main button (option 2 – a deliberate change of existing
  behaviour, approved explicitly); the thumbnail also opens the view. All map buttons stay (layers, zoom, compass,
  location, search, library, points). A bar with the name + figures (graph folded, opened by a chevron), "עריכה"
  (the card's "ערוך" flow: original / copy) and X (closes the route). Split route: segment colours, numbers,
  lodgings (fixed, no dialog), the day chips as a legend (tap = focus on that segment), graph in day colours without
  drag handles. Route without a split: its own colour, its control points hidden, the existing slope graph.
- Reused: the route figures panel card (white, --frame, --panel-shadow, 10px) for the bar and graph; .lib-btn;
  .lib-days tag; the day chips; stat icons; profile.js / days-profile.js. No new colours or tokens.
- Code: `site/view.js` (new); hooks in route.js (exit view on edit/open, `closeRoute`, `drawProfileInto`),
  days.js (`openView`, read-only), days-profile.js (`handles: false`), library.js (eye button, `viewFlow`,
  `ctx.library.edit`), index.html (`#view-bar`, `#view-profile`), i18n.js, style.css (D-066 section), app.js.

## D-067 Side tool bar without "מחק נקודה" on desktop, 2026-11-07
- Owner: remove the X from the tool bar so the bar does not hide the map buttons (screenshot: on a low window the
  upright bar climbed over "my location" and "2D").
- The X is "מחק נקודה" (delete the selected point), not "clear route" (that is the bin, kept). Hidden only where the
  bar stands upright (> 760 px) and a mouse is used; Delete / Backspace still deletes the selected point. Phones and
  touch screens keep it (no key there). CSS only (style.css D-067); the button and its code stay.
- Measured: the bar is 36 px lower; at 920×600 its top moved from 151 to 187 px (map buttons end at 177 px). Windows
  lower than about 600 px can still overlap.
