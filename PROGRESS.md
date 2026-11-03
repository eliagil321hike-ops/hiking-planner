# PROGRESS

## Current phase
**Phase 3 (web) — route builder.** Phase 2 approved by the owner ("2 אושר", D-025).

## Phase 3 criteria (SPEC §12 Phase 3)
| Criterion | Status | Evidence |
| --- | --- | --- |
| A 20-point route with snapped and free segments can be created and edited | **PASS (automated)** | editor unit test (20 points, move/delete/insert/reverse); e2e add/drag/delete/insert |
| Undo/redo restore exact prior states | **PASS (automated)** | editor test over every command type; e2e buttons + Ctrl+Z/Y |
| Reverse test with mixed modes | **PASS (automated)** | editor test incl. [_, snap, free] → [_, free, snap] (D-025) |
| Routing failure never silently becomes free mode | **PASS (automated)** | editor test; e2e: fake ORS 404 → segment snap/error, explicit switch button |
| Late responses cannot overwrite newer edits | **PASS (automated)** | editor test (stale key cached, not rendered; reused after undo) |
| Draft survives app restart | **PASS (automated)** | e2e reload restores the exact state + notice |
| Real snapping with openrouteservice foot-hiking on the live site | Pending | owner check |
| Owner fixes D-028–D-043 (streams, POIs, colour, toolbar, profile, icons, national/regional/marked trails) | **PASS (automated)** | e2e 77/77 (fixtures); real OSM extract built in CI; owner check pending |

## Phase 2 (closed, owner: approved)

## Phase 2 criteria (SPEC 8.1 for the website)
| Criterion | Status | Evidence |
| --- | --- | --- |
| Pan/zoom/rotate/tilt, 3D with adjustable exaggeration, layer switches keep the camera | **PASS** | Phase 0/1 owner runs; e2e |
| Location only when the user asks; one fix; center-on-me | **PASS (automated)** | e2e: 0 calls at load and after reload, 1 getCurrentPosition on click, 0 watchPosition, map centred |
| Remembered preferences | **PASS (automated)** | e2e: layer switch, exaggeration, last view after reload |
| Attribution visible and correct for every source | **PASS (automated)** for presence | e2e; real OpenFreeMap text to be checked by owner |
| Controls visible (not under the panel), Hebrew control texts | **PASS (automated)** | e2e (bug found and fixed, D-024) |
| Owner confirms on the live site (incl. location on his computer) | Pending | |

## Phase 1 (closed, owner: works)
Live site: https://eliagil321hike-ops.github.io/hiking-planner/ · repo: github.com/eliagil321hike-ops/hiking-planner

## Phase 1 criteria (SPEC-WEB W6)
| Criterion | Status | Evidence |
| --- | --- | --- |
| End-to-end test with the real MapLibre build, local and in CI before deploy | **PASS** | `scripts/e2e_test.py` 17/17 locally; CI step "Browser tests" green on b32e47c |
| Code split into modules, behaviour unchanged | **PASS (automated)** | app/layers/background/route/devtools/i18n; e2e 17/17 after the split |
| All UI text from one i18n file, Hebrew default, RTL | **PASS (automated)** | `site/i18n.js`; e2e checks text, `lang=he`, `dir=rtl` |
| Phase 0 tests hidden by default, shown with `?dev=1` | **PASS (automated)** | e2e checks both |
| Leftovers removed, docs updated | **PASS** | Windows server scripts, standalone build, Android ignores removed (D-023) |
| Deploy green; owner confirms the site works as before | **PASS** | owner: "עובד" |

## Phase 0 result (closed, D-022)
Passed: site deployed; encoding check on real tiles (Meron 1,202.5 m, coast 4.5 m, Dead Sea −432 m, negative
control detected, engine Δ −1.3 m); hillshade/contours readable; labels/trails legible tilted; owner verdicts:
topo "looks great", 3D satellite "satisfied". Open: FPS ≥ 30 in 3D (owner's Intel HD 4400: ~26 fps with
stutters; to be measured on newer hardware, D-014); Mapterhorn hosted-tile terms.

## How to verify
```bash
cd packages/geo && node --test "test/**/*.test.ts"       # 31/31
python3 scripts/browser_smoke_test.py                       # 16/16
python3 scripts/e2e_test.py                                 # 77/77
cd packages/editor && node --test "test/**/*.test.ts"    # 18/18
node --test "tests/*.test.mjs"                              # 13/13 (router, slope/aspect, OSM rules)
```

## Known limits of the agent workspace
Cannot reach unpkg, OpenFreeMap, Mapterhorn or Esri: real tiles/rendering are verified by the owner;
the e2e test uses the real MapLibre build (from GitHub releases) with fixture style and synthetic DEM.

## Design A2 (D-051, 2026-11-02)
- Owner picked sketch A, darker variant A2 (text/icons Dark Text, 1.9px icons, clear frames, Deep Blue panel
  toggles), then owner tweaks: no top bar, rounder corners, icon-only top-left, no layers menu (D-052).
  Built on wip/a2-redesign: unit 30/30 (incl. new contrast test), smoke all PASS, e2e 87/87 locally.
  Owner approved ("תעלה"); merged to main and deployed (CI test + deploy green, 2026-11-02).

## My Routes (D-056, 2026-11-02)
- Library of saved routes (cards, folders, manual save, open, edit original or copy, previews), stored in this
  browser. Owner approved design + publishing. Before merging: unit 38/38, smoke all PASS, e2e 101/101.
  Restore point: branch snapshot/site-before-my-routes.

## Review of the 2026-11-02 work (done 2026-11-03)
**State checked.** main = fe56cd2 = the live site (CI test + deploy green 2026-11-02 21:06 UTC; the deploy log lists
library*.js, thumbnail.js and the fonts). The live URL itself is not reachable from the agent workspace: the owner's
look on the real map and on a phone is still the final check.
**Tests on main, fresh run:** unit 38/38, packages geo 31/31 + editor 18/18, smoke 17/17, e2e 101/101.

**Found and fixed on branch wip/review-fixes (not merged, owner to approve):**
1. Saving a route moved the user's view: the preview picture fits the map to the route (flat, north up) and never
   put the view back. Now the centre, zoom, tilt and bearing come back; new e2e check (not run against the old
   code; there the view after saving is flat and fitted to the route, so it should fail).
2. The "route saved" message was hidden behind the library panel → messages above it.
3. On a phone the library covered the map-control column (top right) → it leaves that column free.

**Performance (branch wip/perf, on top of the fixes, not merged):** MapLibre scripts deferred + early connections
to unpkg / OpenFreeMap / Mapterhorn (the page paints before ~800 kB of JS is parsed); DEM tile cache bounded to
64 tiles (it kept every tile ever touched, ~1 MB each) and a failed tile download is retried instead of failing for
the rest of the visit; the handle hover test runs at most every 50 ms instead of on every mouse event. Unit tests
for the cache (fail on the old code). wip/perf: unit 40/40, smoke 17/17, e2e 102/102.

**Not fixed, to decide:**
- OSM data on the live site is still from 2026-07-15: the weekly refresh (2026-11-02 02:56 UTC) hit Overpass
  502/504 and its time budget, and kept the old files rather than deploy a partial set (by design). Next weekly
  run 2026-11-09. Proposal: refresh area by area over several runs and keep each fresh part.
- style.css has grown in layers (D-038 → D-055 each overriding the last; some rules for the old top-left controls
  are dead). A cleanup pass would make later small fixes safer.
- Number display (owner, 2026-11-03): sketch sent (proportional figures without the wide mono comma; larger
  ascent/descent icons; peak/valley icons for max/min), waiting for approval.

**Lessons (how the work is done):**
- Never edit files that a running e2e serves: one e2e run was spoiled that way → separate git worktrees per branch.
- Software WebGL starves in-page timing (requestAnimationFrame, Playwright's "stable" check), worst in a tilted 3D
  view: tests wait by polling from Python and keep the view flat; app code that must run (graph redraw) does not
  depend on requestAnimationFrame.
- Context was lost twice during long turns; work was recovered from git and the session log. Commit each step.
- A git tag push is refused by the proxy here; restore points are branches (snapshot/site-before-my-routes).

## Release 2026-11-03 (owner approved)
- Route figures (D-057, sketch A), style sheet cleanup (D-058), the three review fixes and the performance work.
  Before merging: unit 40/40, smoke 17/17, e2e 103/103. Restore point: branch snapshot/site-before-1103.
- Found while merging: a stray `.cache` link had slipped into the perf branch → removed, `.cache` now ignored as a
  link too. e2e: the reload with an unsaved route takes ~57 s on this machine → wait up to 180 s.

## OSM data from Geofabrik (D-060, 2026-11-03, merged 2026-11-03)
- Weekly refresh no longer depends on Overpass: Geofabrik Israel file + osmium, same output, Overpass as fallback.
- Unit 40/40 (2 new), geo 31/31, editor 18/18; smoke/e2e not run (nothing in site/ changed; CI runs them on merge).
- Dry run on the real file green twice (59 s; OSM 2026-11-02). Inside Israel & Palestine counts match the live
  data; outside the old box (Jordan Trail, Wadi Rum) is no longer pre-built → owner decision (D-060).

## New points, worldwide regions, route under icons (D-061, D-062, 2026-11-03, merged 2026-11-03)
- Waterfalls, pools, ruins (owner-approved sketch); Georgia + Norway pre-built like Israel; coverage by real borders
  (fixes the D-060 box problem); route line under the point icons and ~10 % thinner (owner screenshot).
- Tests: unit 46/46, geo 31/31, editor 18/18, smoke 17/17, e2e 105/105 (latest commit e2d429a).
- Real-data dry run (osm-check, green): Israel 329 waterfalls / 72 pools / 2,684 ruins; Georgia 214 trails,
  8,565 points; Norway 2,946 trails, 27,454 points; all cells ≈ 25 MB (Pages limit 1 GB). Norway's 1.3 GB download
  took 15 min → the weekly refresh takes ~20 min. A few pool names are doubtful (e.g. "בריכת הקצינים"); Norway's
  pools are mostly lake bathing spots (Badeplass).
- Owner approved publishing (2026-11-03 14:20). Merged on top of the 2026-11-03 release; decisions renumbered
  D-057/58/59 → D-060/61/62 (main had used D-057/D-058). Restore point: branch snapshot/site-before-osm-regions.
  The push changes EXTRACT_VERSION (3 → 4), so the deploy fetches fresh data itself (no manual run needed).
- **Live 2026-11-03** (run 41634979444: test + deploy green): OSM data 2026-11-02 21:21 UTC for Israel, Georgia and
  Norway (Norway download 570 s); 464 cells, 25 MB; site/data 50 MB in all. Merged code: unit 48/48, geo 31/31,
  editor 18/18, smoke 17/17 locally; e2e in CI. Owner's look on the real map is the final check.

## Gevim fix (D-063, 2026-11-03)
- Pools now include `natural=waterhole` (how Israeli gevim are tagged). Unit 48/48; published with CI tests.

## Marked points (D-064, 2026-11-03, owner approved, merged 2026-11-03)
- Built from the approved sketches on wip/markers. Unit 53/53, editor 18/18, smoke pass, full e2e 124 pass / 0 fail (19 new
  checks). Phone fixes after real screenshots: points menu height, edit button in "my points".
- Restore point before publishing: branch snapshot/site-before-markers (removing old waypoints from saved routes cannot be undone).

## Next task
Owner tests route building with real snapping on the live site → Phase 4 (elevation & statistics: reference
routes, profile ↔ map marker sync) → Phase 5 (browser storage: saved routes list) → Phase 6 (GPX).
