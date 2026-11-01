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
| Owner fixes D-028–D-041 (streams, POIs, colour, toolbar, profile, icons, national/regional/marked trails) | **PASS (automated)** | e2e 77/77 (fixtures); real OSM extract built in CI; owner check pending |

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
node --test "tests/*.test.mjs"                              # 12/12 (router, slope/aspect)
```

## Known limits of the agent workspace
Cannot reach unpkg, OpenFreeMap, Mapterhorn or Esri: real tiles/rendering are verified by the owner;
the e2e test uses the real MapLibre build (from GitHub releases) with fixture style and synthetic DEM.

## Next task
Owner tests route building with real snapping on the live site → Phase 4 (elevation & statistics: reference
routes, profile ↔ map marker sync) → Phase 5 (browser storage: saved routes list) → Phase 6 (GPX).
