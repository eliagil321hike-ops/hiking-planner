# Topo3D website (MapLibre GL JS + maplibre-contour)

One static page: Topo3D style (OpenFreeMap Liberty + Mapterhorn DEM), 3D terrain, hillshade, client-side
contours, trails, Hebrew labels, tap-to-draw line, elevation profile, and the Phase 0 measurements.

## Where it runs
- **GitHub Pages** (main way): deployed automatically from this folder on every push to `main`.
- Locally: `python3 -m http.server 8080 --directory site`, or `start-windows.bat` on Windows.

Needs internet (map tiles, DEM tiles and the libraries load from the web). Use Chrome or Edge.

## Use
- **Layers:** 3D, hillshade, contours, trails, landcover; terrain exaggeration slider (1.0–2.0, default 1.2).
- **Draw:** "צייר קו" → click the map to add points → distance, ascent/descent, min/max, Naismith estimate,
  and a profile; drag on the profile to move a marker on the map.
- The camera is stored in the URL (`#zoom/lat/lon/bearing/pitch`), so a view can be reproduced exactly.
- `?demz=N` sets the DEM max zoom (default 12).

## Phase 0 test buttons
| Button | What it does | Pass condition |
| --- | --- | --- |
| בדיקת קידוד | Real Mapterhorn tiles at Meron (max within 1.2 km), Tel Aviv beach, Dead Sea; then the same tiles decoded as "mapbox" (negative control); then MapLibre's own terrain elevation vs our decoder at Meron | green "PASSED", negative control "detected", engine Δ ≤ 20 m |
| זום DEM מקסימלי | Requests the Meron tile at z10–17 and reports the highest available | informational → use `?demz=` |
| בדיקת FPS | 12 s scripted orbit (360°, pitch 40–65°) with 3D on | avg ≥ 30 fps (on the computer this is informational only — D-006) |
| בדיקת שכבות | Counts rendered features per Topo3D layer in the current view | trails, peaks, contours > 0 around Meron at z13+ |
| העתק תוצאות | Copies the full JSON report (timings, FPS, tests) | send it to the agent |
| ייצוא סגנון | Downloads the merged style JSON | — |

## Automated checks (agent workspace)
`python3 scripts/browser_smoke_test.py` — headless Chromium with synthetic Terrarium WebP tiles. Tests the
DEM sampler, encoding check + negative control, cross-tile summit search, no-data → null, profile gaps.
It does **not** load MapLibre (CDN not reachable from the agent workspace).
