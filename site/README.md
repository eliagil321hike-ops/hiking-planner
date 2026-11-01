# site/

The deployed website. Plain ES modules, no build step; libraries load from unpkg (pinned versions in
`index.html`). See the repository README for the module map and commands.

- Normal use: https://eliagil321hike-ops.github.io/hiking-planner/
- Developer tests: add `?dev=1` (Phase 0 checks: encoding vs Meron / coast / Dead Sea with a negative
  control, DEM max zoom, FPS orbit with variants, layer feature counts, JSON report, merged style export).
- URL options: `#zoom/lat/lon/bearing/pitch` camera, `?demz=N` DEM max zoom for the map (default 12),
  `?pr=1` pixel ratio.
