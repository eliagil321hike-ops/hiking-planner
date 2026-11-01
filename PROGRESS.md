# PROGRESS

## Current phase
**Phase 0 — feasibility spike and map-engine decision.** Phase 1 must not start until the owner approves the engine.

## Status of P10.5 acceptance criteria
| Criterion | Status | Evidence |
| --- | --- | --- |
| 3D terrain stable on owner's phone, ≥ 30 FPS rotating/tilting | Not run | needs phone |
| Hillshade + contours readable z12–16 in daylight | Not run | needs phone |
| Encoding test (Meron, coast, Dead Sea) fails loudly if wrong | Not run | — |
| Contour labels and trails legible when tilted | Not run | needs phone |
| Owner quality review vs FATMAP screenshots | Not run | needs screenshots |
| DECISIONS.md records engine, contours, hosting, attribution, open issues | In progress | — |

## Completed tasks
- 2026-11-01: repo created; README, DECISIONS, PROGRESS, .env.example, .gitignore.
- 2026-11-01: `packages/geo` (coords, Vincenty distance, resampling, Terrarium/Mapbox decoding, tile math,
  bilinear sampling, peak/valley hysteresis, Naismith/Tobler). `node --test "test/**/*.test.ts"` in
  packages/geo → **31/31 pass**; `tsc` typecheck clean. Includes a synthetic encoding check: correct
  `terrarium` decoding passes, `mapbox` decoding of the same tile throws `EncodingCheckError`.
  This is NOT yet the P10.5 encoding criterion (needs real Mapterhorn tiles and sourced reference points).
- 2026-11-01: Option B building blocks: `perf.js` (FPS runs, timings), `dem-sampler.js` (same decoder,
  colour conversion off, tileSize enforced), `profile.js`; geo compiled to `prototypes/b-webview/vendor/geo`.

## In progress
- Research of VERIFY items (Mapterhorn, OpenFreeMap, MapLibre GL JS + maplibre-contour, MapLibre Native
  terrain, Expo/rnmapbox, reference elevations). Results go to DECISIONS.md.
- Pending on research: `packages/geo/src/references.ts` (sourced reference points), `app/styles/topo3d.json`,
  `prototypes/b-webview/index.html`.

## Blockers
- Workspace network: only GitHub reachable (see DECISIONS D-002). No device link.
- Waiting for owner inputs (DECISIONS → Open questions).

## Next task
Research VERIFY items; build `packages/geo` with tests; Topo3D style; Option B page.
