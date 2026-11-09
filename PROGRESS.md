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

## Marked points (D-064, 2026-11-03, owner approved, live 2026-11-03 – CI run 41677917703 tests + deploy success)
- Built from the approved sketches on wip/markers. Unit 53/53, editor 18/18, smoke pass, full e2e 124 pass / 0 fail (19 new
  checks). Phone fixes after real screenshots: points menu height, edit button in "my points".
- Restore point before publishing: branch snapshot/site-before-markers (removing old waypoints from saved routes cannot be undone).

## Day split (D-065, 2026-11-05; approved and released 2026-11-06)
- New files: site/days-core.js, site/days.js, site/days-profile.js, tests/days.test.mjs.
- Existing files touched (hooks only):
  - site/index.html – "save" moved with the new days button into its own small bar above the route tool bar
    (owner request); the days panel, chips bar, graph and dialog elements added at the end of the body.
  - site/app.js – import + `initDays(ctx)`; `ctx.days.addLayers()` after the route layers.
  - site/route.js – the split kept in the route meta (cleared by "new route", read when a saved route opens);
    included in the "saved/changed" signature only when a split exists; added to the save snapshot only when it
    exists; `ctx.onRouteFigures` call after the figures update; `routeLib` gains `daySplits`, `setDaySplits`,
    `figures`, `name`.
  - site/library-store.js – `daySplits` accepted as a route field; a save without it removes an old one.
  - site/library.js – "N days" tag on the card (owner approved).
  - site/gpx.js – a route with a split exports a track per day + lodging waypoints; without one the file is
    byte-for-byte the same as before (checked against the published gpx.js).
  - site/i18n.js – new `days.*` texts only. site/style.css – new D-065 section only.
  - scripts/e2e_test.py – new "day split (D-065)" section (17 checks); existing checks unchanged.
- Tests (2026-11-06, wip/days): unit 62/62, editor 18/18, smoke 17 PASS, full e2e 141 PASS / 0 FAIL (all existing
  checks for building, save/load, library, layers and GPX export still pass). Not verifiable here: day colours on
  the satellite layer (no satellite tiles offline).
- 2026-11-06: button renamed "חלוקה למקטעים" with the owner-chosen icon (unit 62/62, editor 18/18, smoke 17 PASS,
  title and icon checked in the browser). Restore point: branch snapshot/site-before-days.
- LIVE 2026-11-06: main 22a184f, CI run 42197357110 – test success, deploy success.

## View mode (D-066, 2026-11-07; owner approved, live 2026-11-07 – main 26ce581, CI run 42353906605 test + deploy success;
   restore point: branch snapshot/site-before-view)
- The library card's main button is now "צפייה" (eye) instead of "פתח" (owner, option 2); "ערוך" unchanged.
- View: no route tool bars; bar with name, figures, graph toggle, "עריכה", X. Split routes in segment colours
  (read-only), legend chips, graph without handles. See DECISIONS D-066.
- Existing files touched (hooks): site/route.js, site/days.js, site/days-profile.js, site/library.js,
  site/index.html, site/app.js, site/i18n.js, site/style.css; scripts/e2e_test.py ("open" steps now use the eye;
  new view checks vmShown, vmGraph, vmLodgeFixed, vmClosed, vmEdit).
- Tests (2026-11-07, wip/view): unit 62/62, editor 18/18, smoke 17 PASS, full e2e 146 PASS / 0 FAIL (all existing
  checks incl. building, save/load, library, layers/3D, GPX, day split, plus the 5 view checks).

## Side bar without "מחק נקודה" on desktop (D-067, 2026-11-07, live – commit 3550b9d, CI run 42363985233; snapshot/site-before-no-x)
- site/style.css only (new D-067 rule). Checked in the browser: bar top 151 → 187 px at 920×600 (clear of the map
  buttons), Delete key still deletes the selected point, phone keeps the button.

## Days view: folding panels, casing under day lines (D-068, 2026-11-08, branch wip/days-ui – waiting for owner approval to publish)
- Existing files touched (hooks only): site/days.js (casing layer in addLayers, `route-casing` in ROUTE_OWN, fold
  button / strip / profile button, padding from real sizes), site/days-core.js (DAY_COLORS – owner palette choice),
  site/style.css (new D-068 section + `.dm-warn`), site/i18n.js (7 strings), scripts/e2e_test.py (D-068 checks; the
  D-065 checks open the profile first, since a 1280×800 window now starts with it folded).
- Checked (harness, 1366×657 = a 1366×768 window): default profile folded on a small screen; summary folds by keyboard
  (focus kept, aria-expanded, label), strip shows days / km / "!"; profile folds to its title; fit to day inside the
  free area; lodging dragged on the map with the profile folded; casing visible in all-days, focused, dimmed,
  dragging, tilted 3D; remembered after reload; storage blocked → folding still works in memory.
- Screenshots (fixtures: no real tiles here; light / contours / dark / trails simulated with the site's own paints):
  docs/d068/before-1366.png (before + after), after-1366-folded.png, after-folded-warning.png,
  contrast-before-after.png, palette.png, casing-options.png. Owner to check on the real map after publishing.
- Tests: unit 62/62, editor 18/18, full e2e – see the release note below when published.

## Phone top row; tap closes notifications (D-069, 2026-11-08, branch wip/phone-toast – owner approved, waiting for the full test)
- site/style.css (new D-069 rule), site/app.js (one listener after `notify`). Checked at 412×820 while editing:
  toolbar rows [8, 60] (was [8, 16, 60, 112]), search at 60 px, notification at 124 px under it; a tap on the map
  hides it. Owner approved the screenshot (phone-compare).

## Day boundary drag in the profile always gets the press (D-071, 2026-11-09, branch wip/days-always – owner approved, waiting for the full test)
- site/style.css: one added rule; the hover line and readout of the days profile no longer take clicks.
- Checked: pointer events logged in the browser – before, the press went to the hover line and the lodging stayed (153→153);
  after, it goes to the boundary handle and the lodging moves (153→170, manual).

## Split routes always in day colours (D-070, 2026-11-08, branch wip/days-always – owner approved, waiting for the full test)
- site/days.js only (`renderAmbient` / `clearAmbient` / `drawDays` – the map part of `render` moved into `drawDays`
  unchanged; lodgings fixed outside the screen); scripts/e2e_test.py (D-070 checks, D-065 build expectation).
- Checked in the browser: after "back to building" the 3 days stay coloured with numbers and lodgings, editing points on
  top (computer and phone screenshots approved by the owner).

## Next task
Owner tests route building with real snapping on the live site → Phase 4 (elevation & statistics: reference
routes, profile ↔ map marker sync) → Phase 5 (browser storage: saved routes list) → Phase 6 (GPX).
