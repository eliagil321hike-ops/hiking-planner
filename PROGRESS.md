# PROGRESS

## Current phase
**Phase 0 (web) — map feasibility on the live site.** Product is a website (SPEC-WEB.md, DECISIONS D-010).
Phase 1 starts only after the owner approves Phase 0 (look vs FATMAP, encoding test, FPS).

## Status of Phase 0 criteria (SPEC-WEB W7)
| Criterion | Status | Evidence |
| --- | --- | --- |
| Site deployed on GitHub Pages and opens | **PASS** (owner opened it, screenshot 2026-11-01) | Actions run 41294695181 attempt 2: test ✓, deploy ✓; URL https://eliagil321hike-ops.github.io/hiking-planner/ |
| 3D terrain stable; FPS recorded on owner's computer | **FAIL: 8 fps all layers; 17 without contours; 58.5 in 2D** (Intel HD 4400) | D-013; savings variants pending owner rerun |
| Hillshade + contours readable z12–16 | Not run | owner review |
| Encoding test on real tiles + negative control | **PASS** | owner run: Meron 1202.5, coast 4.5, Dead Sea −432; negative control detected; engine Δ −1.3 m (D-011) |
| Contour labels and trails legible when tilted | Not run | owner review |
| Owner FATMAP review | Not run | needs ≥ 3 screenshots |
| DECISIONS: engine, contours, hosting, attribution, small-group licences | Mostly done | engine = MapLibre GL JS (D-010); Mapterhorn terms open |

## Completed
- `packages/geo` (pure TS, zero deps): `cd packages/geo && node --test "test/**/*.test.ts"` → **31/31**.
- `site/`: the website (MapLibre GL JS 5.24.0, maplibre-contour 0.1.0, Topo3D overlay, draw line + profile,
  Phase 0 test buttons). Geo compiled into `site/vendor/geo` with `tsc -p packages/geo/tsconfig.browser.json`.
- `python3 scripts/browser_smoke_test.py` → **7/7** (headless Chromium, synthetic DEM tiles).
- Served from its own root over HTTP (as on Pages): overlay loads from `./styles/topo3d.json` (verified).
- `.github/workflows/pages.yml`: unit tests, then deploy `site/` (not run yet).
- Local fallbacks: `start-windows.bat` (untested on Windows), `dist/topo3d-standalone.html` (file:// verified
  up to library loading).

## Not verified (agent workspace cannot reach the CDN or tile servers)
Real rendering, OpenFreeMap layer matching / Hebrew names, real encoding check, DEM zoom over Israel, FPS.

## Owner history
- First ZIP + start script: owner could not open it (cause unknown). Standalone file sent; then owner
  decided to restart as a website (D-010).

## Deployment
- Repo: https://github.com/eliagil321hike-ops/hiking-planner (public). Pages source: GitHub Actions
  (set by owner 2026-11-01; agent's GitHub access cannot change repo settings).
- First run: test ✓, deploy ✗ (Pages not enabled). Re-run after owner enabled Pages: test ✓, deploy ✓.
- Note from the run log: actions/configure-pages@v5 targets Node 20 (deprecated, forced to Node 24);
  ubuntu-latest moves to Ubuntu 26. Both warnings only.

## Next task
Owner reruns the new FPS test and layer test, and sends FATMAP references. If FPS stays low with a real GPU:
profile per layer, then try pixelRatio 1, lower maxPitch, contour worker settings.
