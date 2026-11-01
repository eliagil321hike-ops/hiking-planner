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
- The live DEM encoding check is a standalone script (`scripts/check-dem-encoding.ts`) to run where the
  tile host is reachable.

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

## Data-source register
| Source | Use | Licence | Commercial use allowed? | Attribution | Limits / caching | Cost | Checked | Link |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| OpenFreeMap | Vector base map | pending | pending | © OpenMapTiles, © OpenStreetMap contributors | pending | free | pending | openfreemap.org |
| Mapterhorn | DEM (terrain, hillshade, contours, elevation sampling) | pending | pending | pending | pending | free | pending | mapterhorn.com |
| OpenStreetMap data | Trails, peaks (via OpenFreeMap) | ODbL | yes | © OpenStreetMap contributors | — | free | spec | openstreetmap.org/copyright |
| Israel Hiking Map tiles | Optional marked-trail overlay | CC BY-NC-SA 3.0 (unverified) | No → personal use only | pending | pending | free | not verified | — |

## Open questions for the owner
1. Phone model, Android version, RAM.
2. First Israel region (default: Upper Galilee / Meron).
3. Where builds run (owner computer OS, USB debugging).
4. Hosting of the Option B test page (GitHub Pages or local Wi-Fi).
5. FATMAP reference screenshots (≥ 3) with location/zoom/tilt.
