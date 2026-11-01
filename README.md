# Topo3D hiking route planner (website)

Non-commercial hiking route planner website with a free 3D topographic map of Israel and satellite
imagery, for the owner and a few friends. Live: https://eliagil321hike-ops.github.io/hiking-planner/

Brief: [`SPEC.md`](SPEC.md) (v3.2) as overridden by [`SPEC-WEB.md`](SPEC-WEB.md) (v4, website).
State of work: [`PROGRESS.md`](PROGRESS.md). Decisions, sources and licences: [`DECISIONS.md`](DECISIONS.md).

## Repository layout
```
site/                     The website, deployed to GitHub Pages as-is (no build step)
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
scripts/                  Tests (browser smoke, end-to-end) and the CI cache-busting stamp
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

## Attribution
© OpenMapTiles · © OpenStreetMap contributors · OpenFreeMap · Mapterhorn (Israel: isr10, ASTER GDEM courtesy of
METI and NASA processed by 4cast LTD; global: Copernicus GLO-30) · satellite: Esri and its partners /
EOxCloudless (CC BY-NC-SA 4.0). Credits are shown in the map's attribution control.
