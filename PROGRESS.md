# PROGRESS

## Current phase
**Phase 0 — feasibility spike and map-engine decision.** Web-first on the owner's Windows computer (D-006).
Phase 1 must not start until the owner approves the engine.

## Status of P10.5 acceptance criteria
| Criterion | Status | Evidence |
| --- | --- | --- |
| 3D terrain stable on owner's phone, ≥ 30 FPS rotating/tilting | Not run | phone deferred by owner; page has the FPS test |
| Hillshade + contours readable z12–16 in daylight | Not run | needs owner's eyes on the page |
| Encoding test (Meron, coast, Dead Sea) fails loudly if wrong | **Implemented, not yet run on real tiles** | unit tests 31/31; browser smoke test 7/7 with synthetic tiles incl. negative control; real run = "בדיקת קידוד" on owner's computer |
| Contour labels and trails legible when tilted | Not run | needs owner review |
| Owner quality review vs FATMAP screenshots | Not run | needs ≥ 3 screenshots |
| DECISIONS.md records engine, contours, hosting, attribution, open issues | Partly | contours (client-side, maplibre-contour), hosting (home network), attribution, sources done; engine pending |

## Completed tasks
- Repo, SPEC.md (verbatim copy of the project doc), README, DECISIONS, PROGRESS, .env.example.
- `packages/geo`: coords, Vincenty distance, resampling, Terrarium/Mapbox decoding, tile math, bilinear
  sampling, peak/valley hysteresis (D-005), Naismith/Tobler, sourced reference points.
  `cd packages/geo && node --test "test/**/*.test.ts"` → **31/31 pass**; `tsc -p tsconfig.json` clean.
- Research recorded (D-008): MapLibre 5.24.0 + rtl-text 0.3.0 (official example), maplibre-contour 0.1.0 API,
  Mapterhorn format/zoom/attribution (isr10, glo30), OpenFreeMap terms; MapLibre v6 deliberately not used yet.
- `app/styles/topo3d.json` overlay + `prototypes/b-webview/` page (terrain, hillshade, contours, trails,
  peaks, Hebrew names, draw line, profile, stats, tests, report export).
- `start-windows.bat` + `serve.ps1` local server (untested: no PowerShell in agent workspace).
- `python3 scripts/browser_smoke_test.py` → **7/7 pass** (synthetic tiles; MapLibre itself not loaded).

## Not verified here (agent workspace cannot reach the CDN or tile servers)
- That the page loads and renders at all with the real libraries and tiles.
- Which OpenFreeMap layers get hidden/renamed, whether `name:he` exists, glyphs for Hebrew.
- Real encoding check, DEM max zoom over Israel, FPS, toggle times.

## Blockers / waiting for owner
- Owner run of the page on Windows; send back the "העתק תוצאות" JSON and screenshots.
- FATMAP reference screenshots (≥ 3).

## Next task
Fix whatever the owner's first run shows; then contour/hillshade tuning against FATMAP references.
