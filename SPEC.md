---
document: Hiking Route Planner
document_type: Product Requirements Document and Engineering Specification
version: 3.2
status: Personal-use specification (revised 2026-10-31)
usage: personal, private, non-commercial, single owner, not distributed
primary_audience: AI coding agents
platforms: [Android]  # owner uses Android only (v3.1)
initial_market: Israel
development_budget: near-zero
---

<!-- Copied verbatim from the owner's project document "Hiking_Route_Planner_AI_Spec_v3_2_topo (1).md" on 2026-11-01. -->

# Hiking Route Planner — AI Agent Project Specification (v3.2, personal use, Android only, free topographic 3D)

> **Purpose:** the authoritative brief for building the MVP. Work phase by phase.
> Do not start a phase before the previous phase's acceptance criteria pass.
> Items marked **VERIFY** must be checked against current official documentation before use.
> Never report a task or criterion as complete unless it was implemented **and** tested.

## What changed from v1 to v2 (read first; v3 changes are in the Personal-Use Profile below)

1. **The map-engine default was wrong.** Research (2026-10-31) shows MapLibre Native (the engine under
   `@maplibre/maplibre-react-native`) does **not** officially support 3D terrain on Android or iOS; only experimental
   community builds of its `feature/terrain-3d` branch exist. Phase 0 is now a time-boxed comparison of three
   options, with a decision rule (Section 4).
2. **Ascent/descent algorithm fixed.** v1 said to ignore consecutive elevation differences below a threshold.
   That silently drops gentle, long climbs (a 3% slope sampled every 20 m rises only 0.6 m per step) and
   underestimates ascent. v2 uses a peak/valley hysteresis algorithm (Section 9.1).
3. **`RouteSegment` added to the data model.** Control points plus one full geometry are not enough to edit a
   saved route without re-requesting every segment from the router. Each segment's geometry is now stored.
4. **Israel data and licensing facts added** (Section 5), including a warning not to use the Israel Hiking Map
   tiles in production (non-commercial licence).
5. **Free-tier reality for satellite imagery and terrain tiles** recorded, with a cost-approval gate.
6. **Accuracy criteria made realistic** for a ~30 m global DEM (Section 12, Phase 4).
7. Added: algorithms and pseudocode, repository layout, a "known AI pitfalls" list, stop conditions.

---

## PERSONAL-USE PROFILE (v3) — overrides any conflicting text below

The owner will use this app **only personally**: private, non-commercial, not published to app stores, not shared
with other users. Where this profile conflicts with a later section, **this profile wins**. If the owner ever
decides to share or publish the app, stop and re-clear every licence first (see P8).

### P1. What this removes or simplifies
| Topic | v2 said | Personal-use rule |
| --- | --- | --- |
| Users and accounts | Multi-user accounts, email auth, RLS, password recovery | **Single owner.** No sign-up flow, no password recovery, no sign-in providers. Local-first storage. |
| Cloud sync | Required | **Optional.** Default = local SQLite plus GPX export as backup. Add one private cloud copy (single-user Supabase, or a file in the owner's own storage) only if the owner wants a second device. |
| Security tests | User A vs user B | Replace with: the cloud copy, if any, is private (not public), and secrets are not committed. |
| Store release | Store checklists, privacy policy, beta testers | **Removed.** Build and install directly on the owner's own phone(s). |
| Phase 7 | Hardening and release | Becomes "Personal hardening": error states, drafts never lost, battery check, test on the owner's phone. |
| Rate limiting, soft-delete purge policy | Required | Not required. Keep soft delete and undo (they protect against accidental loss). |
| Languages | Hebrew and English | Keep only the languages the owner actually needs; confirm with the owner. RTL still matters if Hebrew is used. |

### P2. Licensing relaxes, but does not disappear
- **Non-commercial data sources are now allowed** (for example Israel Hiking Map tiles, whose stated terms permit
  private non-commercial use; free non-commercial tiers of tile/satellite providers). **VERIFY each provider's
  exact terms**, because "personal use" is defined differently by each. Use light traffic, cache politely, and
  never redistribute tiles, data, or the app.
- **Attribution is still required** for OpenStreetMap, DEM and imagery providers; show it in the app.
- Add a column "Commercial use allowed?" to the data-source register. If the answer is "No", record
  "personal use only" in `DECISIONS.md`.
- Mapbox (if chosen in Phase 0) is acceptable for personal use within its free tier; its main downside (lock-in
  and per-user pricing) matters much less. **VERIFY** current terms and free-tier limits.

### P3. Distribution (VERIFY current rules)
- **Android:** build an APK/AAB and install it directly on the owner's phone. No store account needed.
- **iPhone:** installing your own build needs an Apple developer account for long-lived installs (a free
  account's builds expire quickly). Ask the owner which phone they use **before Phase 1**; build for that
  platform first and add the other only if needed.
- Recommend **one platform first.** This halves testing and removes the "both platforms must pass" gate.

### P4. Phase 0 map-engine decision rule — adjusted
Order of criteria becomes: (a) 3D terrain stable on the owner's real phone and meets the FPS target,
(b) least effort and least maintenance for a solo owner, (c) cost stays within the owner's budget (free tier is
enough for personal use), (d) licence allows **personal** use of every needed data source, (e) openness.
Vendor lock-in is a minor concern in personal use. Mapbox via `@rnmapbox/maps` is therefore a strong default
candidate if it passes the 3D test; still run the comparison, but a time-box of about 3 working days is enough.

### P5. Features that become more valuable in personal use
- **Offline maps** (formerly Phase 8) matter in real hiking with weak signal. Move it up as the first
  post-MVP feature, and verify each provider's offline-caching rights (Mapbox and many satellite providers
  restrict it; OSM vector tiles and DEM are easier to cache).
- **GPX export** doubles as backup and as a way to load routes on a watch or another app; keep it in the MVP.

### P6. Routing server for one user
A self-hosted BRouter or Valhalla instance can run on the owner's own computer or a very cheap VPS. For light
personal use, a public BRouter instance may also be acceptable (**VERIFY** its usage policy; do not hammer it).
Keep routing behind `RoutingProvider` so the choice can change.

### P7. Revised phase list (use this instead of Section 12 where it differs)
0 Feasibility spike and engine decision · 1 Foundations · 2 Map experience · 3 Route builder (3A local, 3B routing)
· 4 Elevation and statistics · 5 **Local storage + optional private cloud copy** (no multi-user auth) ·
6 GPX import/export · 7 Personal hardening · 8 Offline maps (first future feature).
Phase 4 criteria, the algorithms in Section 9, the data model (Section 7, minus `user_id` if no cloud copy),
and the "known AI pitfalls" list all stay as written.

### P9. ANDROID-ONLY DECISION (v3.1) — owner confirmed Android; overrides iOS references everywhere below
- **Platform:** Android only. Do not build, test, configure or document iOS. Remove every "iOS and Android" or
  "both platforms" criterion; each now means "on the owner's Android phone".
- **Distribution:** build a signed APK and install it directly (sideload). No Google Play account, listing, or
  review is needed. Keep the signing keystore private and backed up; never commit it. **VERIFY** current Expo/EAS
  local-build options (a local Gradle build avoids cloud-build limits).
- **CI (Phase 1):** one Android build job only. Remove the iOS build job.
- **Map engine (Phase 0):** Android-only makes the options easier to test. Option C (MapLibre Native terrain
  build) has Android community builds; Option B (MapLibre GL JS in the Android WebView) benefits from Chrome's
  WebView; Option A (Mapbox) is unchanged. Run all three on the owner's real phone, time-box about 3 days.
- **Test device:** the owner's own phone is the reference device. Before Phase 0, record: phone model, Android
  version, RAM. Use these for the FPS and memory numbers.
- **Android specifics to handle:** runtime location permission (foreground only; no background location),
  battery-optimization behaviour, back-button handling in the route editor (confirm before discarding unsaved
  edits), file picker and share sheet for GPX, display cutouts and gesture navigation, large system font.
- **Updated phase wording:** Phase 1 criteria "iOS and Android builds" → "Android build succeeds"; Phase 2 criteria
  → "all of Section 8.1 works on the owner's Android phone"; Phase 7 → "all MVP journeys work on the owner's
  Android phone".

### P10. FREE TOPOGRAPHIC 3D PROFILE (v3.2) — overrides Sections 3, 4, 5, 8.1 and Phases 0–2 where they conflict

**Owner decision (2026-11-01):** no satellite layer in the MVP (2D or 3D). In its place the app must have a
**high-quality 3D topographic map built only from free sources**, aiming at the look of FATMAP's topographic
view: clear relief, contour lines, trails, peak labels.

**P10.1 Removed / deferred.** Satellite layer and all satellite providers (MapTiler satellite, EOX Sentinel-2,
Esri). Keep a `SatelliteProvider` interface stub only. Mapbox's main advantage (bundled satellite) no longer
applies. "Layer switch" now means toggling topographic overlays (hillshade, contours, trails), not Map/Satellite.

**P10.2 Free source stack** (facts checked 2026-11-01 on the official pages; items under "VERIFY" were NOT confirmed):

| Layer | Source | What the official page says | VERIFY before use |
| --- | --- | --- | --- |
| Vector base map (roads, paths, water, landcover, peaks) | OpenFreeMap (openfreemap.org) | Free, no API key, no registration; no limits on map views on the public instance; commercial use allowed; styles: Positron, Bright, Liberty, Dark, Fiord, 3D; attribution "© OpenMapTiles" and "Data from OpenStreetMap" (MapLibre adds it automatically); offline downloads in apps capped at 3,000 tiles or 50 MB; weekly full-planet MBTiles available | Which style layers include peaks, `name:he`, hiking paths; no contour layer is documented |
| Elevation (DEM) for 3D and hillshade | Mapterhorn (mapterhorn.com) | Terrarium encoding, WebP, 512 px; single tiles at `https://tiles.mapterhorn.com/{z}/{x}/{y}.webp`, TileJSON at `https://tiles.mapterhorn.com/tilejson.json`; bulk PMTiles from `download.mapterhorn.com` (use `pmtiles extract` with a bounding box). Per `attribution.json`: **Israel = 10 m DEM (source id `isr10`, listed as ASTER GDEM public domain)**; global fallback = Copernicus GLO-30 (30 m, free and open licence) | Whether hosted access is free long term, fair-use limits, licence of the tiles themselves, max zoom (z17 appears in an example; not stated), Israel resolution in practice |
| Hillshade | MapLibre `hillshade` layer on the same `raster-dem` source | Built into the style spec; no extra data needed | Visual quality on the owner's phone |
| Contour lines | See P10.4 | Not provided by OpenFreeMap or Mapterhorn tiles | Chosen approach per engine |
| Trails | OSM paths/tracks from the OpenFreeMap vector tiles | Standard OpenMapTiles transportation classes | Whether marked-trail colours/refs are available |
| Marked-trail overlay (optional, Israel) | Israel Hiking Map raster tiles | Earlier research found terms limited to private, non-commercial use (CC BY-NC-SA 3.0) | Current licence text, tile URL, whether it can be draped on 3D terrain, load policy. The licence page could not be fetched; do not use until verified |

**P10.3 "Topo3D" style (build as one custom MapLibre style, kept in `/app/styles/topo3d.json`).** Start from an
OpenFreeMap style (Liberty or Bright, **VERIFY**) and add, in this order:
1. `raster-dem` source from Mapterhorn with `"encoding": "terrarium"`, `"tileSize": 512`, correct `maxzoom`. Both
   values must be explicit (see Known AI pitfalls). Terrain exaggeration default 1.2, adjustable.
2. `hillshade` layer from that source (soft, neutral shadow colours; illumination from the north-west; tune
   exaggeration roughly 0.4–0.8 so the relief reads without darkening trails and labels).
3. Landcover tints (forest, scrub, rock, water) in muted, topo-style colours so relief stays readable.
4. **Contours** (P10.4): minor lines every 20 m at zoom ≥ 13 and index lines every 100 m with elevation labels;
   coarser intervals (50/250 m) at zoom 11–12; none below zoom 10.
5. Trails: dashed lines styled by class (path, track, footway); distinguish them from roads without relying on
   colour alone.
6. Peak labels with elevation; water names; Hebrew labels (`name:he`) with English fallback.
7. Camera: tilt up to at least 60°, rotation, pitch limits that keep the horizon sensible; smooth zoom.

**P10.4 Contours (the hard part — decides the map engine).**
- **Option B (MapLibre GL JS in the Android WebView):** the `maplibre-contour` plugin generates contour vector
  tiles client-side from the `raster-dem` source (documented for GL JS only). Intervals and units can change at
  runtime without storing contour tiles.
- **Native engines (Option C, or Mapbox):** no client-side equivalent is documented. Use **precomputed contour
  vector tiles for Israel only**: extract the Israel DEM, run `gdal_contour` (with an `ele` attribute and an
  index flag every 100 m), convert with `tippecanoe` to PMTiles, and serve or bundle them. The area is small, but
  size and generation time are not verified.
- Phase 0 must test the chosen contour approach on the owner's phone and record quality and speed.

**P10.5 Phase 0 revised (replaces the Section 4.2 prototype; time-box about 3 working days).**
Candidates: **B** (GL JS in WebView + `maplibre-contour`), **C** (MapLibre Native terrain build + precomputed
contours), **A** (Mapbox via `@rnmapbox/maps`, lowest priority, only if it accepts custom `raster-dem` and vector
sources within its free tier; VERIFY). Prototype for each: 3D terrain from Mapterhorn, tilt/rotation, Topo3D style
(hillshade, contours, trails, peaks, Hebrew labels), draw a line by tapping, sample elevation, basic profile.
**Acceptance criteria:**
- [ ] 3D terrain renders stably on the owner's Android phone, at least 30 FPS while rotating and tilting
- [ ] Hillshade and contours are readable at zoom 12–16 on the phone screen in daylight
- [ ] **Encoding test:** decoded elevations match known points within the DEM's tolerance: a summit such as Har
      Meron (about 1,208 m, VERIFY), the Mediterranean coast (about 0 m), and the Dead Sea shore (negative, about
      −430 m or lower, VERIFY the current level). A wrong encoding must fail this test loudly
- [ ] Contour labels and trail lines stay legible when the map is tilted
- [ ] **Owner quality review:** the owner supplies at least 3 FATMAP reference screenshots; the agent captures
      matching views of the prototype; the owner judges them side by side and records a verdict. The agent must
      not declare "FATMAP quality" itself
- [ ] `DECISIONS.md` records the engine, contour approach, tile hosting choice, attribution, and open issues

**P10.6 Honest quality expectation.** FATMAP was reported to use a much finer terrain model (about 2 m grid). This
stack gives about 10 m in Israel and 30 m elsewhere, so ridges, gullies and cliffs will look smoother and
slope-based numbers will be less precise. The goal is a *good* 3D topographic map, not identical output. If the
owner's review finds the relief too soft, the next options are (a) a higher-resolution national DEM, which needs
its own licence check, or (b) stronger hillshade and exaggeration tuning.

**P10.7 Offline-ready by design (personal-use advantage).** For a fixed region (Israel), download the DEM as a
PMTiles extract (`pmtiles extract` with the Israel bounding box) and, if desired, the vector tiles (OpenFreeMap
publishes weekly planet MBTiles; extracting a region needs a separate tool, VERIFY). Hosting these on the phone
or on the owner's own storage removes dependence on third-party servers and makes Phase 8 (offline) much easier.
VERIFY file sizes, Mapterhorn's terms for bulk download, and keep the data personal-use only.

**P10.8 Attribution in the app (always visible or one tap away):** © OpenMapTiles, © OpenStreetMap contributors,
Mapterhorn and the per-region sources listed in `attribution.json` (for Israel the `isr10` source; Copernicus for
the global fallback). Re-read `attribution.json` and `mapterhorn.com/attribution` before release.

**P10.9 Elevation statistics.** Use the same Mapterhorn DEM for sampling so the profile matches what the map shows.
With a 10 m DEM in Israel, ascent may be more accurate than the ~10% target in Phase 4. Record the actual
difference per reference route; do not tighten the criterion until measured.

### P8. Re-clearing (if the app is ever shared or published)
Before any sharing: re-check every data source for commercial/redistribution rights, replace
non-commercial sources, add multi-user auth with ownership enforcement, a privacy policy, store requirements,
and the safety notice review. Treat that as a new project phase.

---

# 0. Instructions for the coding agent

## 0.1 Execution rules
1. This document is the source of truth. Inspect the existing repository before changing anything.
2. Small, reviewable increments. No unrelated features in the same change.
3. Follow phases in order. Do not skip acceptance criteria.
4. Before adding a dependency or external service, check compatibility, maintenance status, licence,
   attribution, restrictions, and cost. Record it in `DECISIONS.md`.
5. Never hardcode secrets. Use environment variables; document them in `.env.example`.
6. Keep external providers behind replaceable interfaces (Section 6.2).
7. Prefer the simplest implementation that meets the requirements.
8. If a requirement is ambiguous, write the question in `DECISIONS.md`, choose the simplest safe default,
   and ask the product owner when the choice affects architecture, cost, licensing, or UX.
9. Run relevant tests after each task; run the app on a physical device whenever possible.
10. **Stop conditions:** stop and report (do not build on an assumption) when a required capability cannot be
    verified, a phase criterion fails twice after fixes, a cost or licence issue appears, or a task needs
    credentials/accounts you do not have.

## 0.2 Required project files
- `README.md` — prerequisites, setup, env variables, run/build/test commands.
- `DECISIONS.md` — decisions, alternatives, licences, attribution, costs, limitations, open questions.
- `PROGRESS.md` — current phase, completed tasks, test results, failed criteria, blockers, next task.
- `.env.example` — variable names and descriptions only.

## 0.3 Report after each task
What changed · files touched · commands and tests run · **actual** results · known issues ·
which acceptance criteria now pass · next smallest useful task.

## 0.4 Budget gate (near-zero budget)
Before introducing a paid service or recurring cost: explain why, estimate setup and monthly cost,
list free/open alternatives and trade-offs, then wait for product-owner approval.
A publicly reachable free endpoint is **not** automatically allowed in production.

---

# 1. Product definition

## 1.1 Vision
A mobile app for **hikers on foot** to plan, visualize, edit, analyze and save walking routes on an
interactive 3D terrain map. Inspired by the route-planning part of FATMAP (shut down Oct 2024).
Do not copy FATMAP branding, assets, or interface. Build only what is specified here.

## 1.2 Core user journey
1. Open an interactive 3D terrain map (Israel first).
2. Tap points to build a route; segments follow walkable trails (snap) or run straight (free).
3. See distance, ascent, descent, min/max elevation, estimated duration, and an elevation profile.
4. Save to a personal account; open on another device.
5. Import and export GPX.

## 1.3 Principles
Map-first · simple · accurate and honest about limits · responsive · reliable (never silently lose a draft) ·
modular providers · cost-conscious · one-handed, intermittent-connectivity friendly.

## 1.4 Scope
**In scope:** 3D terrain map; open (OSM-based) map and satellite layers; route builder with snapping and free
segments; elevation statistics and profile; accounts and private cloud storage; sync; GPX import/export;
local draft recovery.

**Out of scope (do NOT build):** ski/bike modes, avalanche/slope/aspect layers, snow/lift data, social or public
sharing, curated guides, watch integrations, payments, turn-by-turn navigation, activity recording,
offline maps (possible Phase 8; keep interfaces compatible).

---

# 2. Decisions and defaults

| Topic | Default |
| --- | --- |
| Initial coverage | Israel first; do not block global coverage |
| Languages | Hebrew and English; RTL from day one |
| Units | Metric default; user can switch to imperial |
| Privacy | Routes private by default |
| Without account | Local planning and drafts allowed; account required for cloud sync |
| Platforms | iOS and Android |

**Open owner decisions** (ask before the phase that needs them; do not block Phase 0):
1. Priority regions inside Israel.
2. Maximum monthly spend (tiles, satellite, DEM, routing server).
3. Self-hosted routing server vs managed provider.
4. Hebrew-first or English-first UI.
5. Public sharing after MVP?
6. Must iOS and Android launch together?
7. Is Mapbox acceptable (proprietary SDK, vendor lock-in) if it is the only option that gives 3D terrain and
   bundled satellite imagery within budget? (See Section 4.)

---

# 3. Research findings (checked 2026-10-31 — re-verify before relying on them)

| Finding | Consequence |
| --- | --- |
| MapLibre style spec lists `terrain` as supported in MapLibre GL JS (web) but **not** in MapLibre Native Android/iOS (tracking issue #252). Community builds of the `feature/terrain-3d` branch for iOS and Android exist and are updated frequently, but are forks, not official releases. | The v1 default (`@maplibre/maplibre-react-native` + 3D terrain) is unproven. Phase 0 must test, not assume. |
| MapLibre GL JS 3D terrain works with any `raster-dem` source. | A WebView-hosted GL JS map is a possible fallback. |
| Mapbox Maps SDKs (iOS/Android) support 3D terrain and bill by monthly active users; a third-party 2026 summary lists a free tier of 25,000 MAU. `@rnmapbox/maps` is the community React Native wrapper. | Likely the fastest route to a working 3D map inside the free budget, with vendor lock-in. **VERIFY** current pricing, terms, and whether custom DEM/satellite sources are allowed. |
| AWS Open Data "Terrarium" elevation tiles (`s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`) are free, keyless, global, zoom 0–15, derived from SRTM/other sources. Sources describe them as slow at times and without a production guarantee. | Use for the prototype. For production, self-host (e.g. PMTiles on cheap object storage) or use a paid/SLA provider. |
| Mapterhorn publishes open Terrarium-format tiles (WebP/PMTiles, up to zoom 12 globally). | Candidate free production DEM; **VERIFY** licence, availability, and resolution over Israel. |
| `raster-dem` has two encodings: `mapbox` (default) and `terrarium`. Declaring the wrong one gives silently wrong elevations. | Always set `encoding` explicitly and add a test with a known point (Section 14). |
| The Israel Hiking Map project (OSM + SRTM based) states its tiles are for private, non-commercial use (CC BY-NC-SA 3.0). Its underlying data is OpenStreetMap and has strong volunteer coverage of marked trails in Israel. | Do **not** use Israel Hiking Map tiles in the product. Use OSM data directly (ODbL, attribution required). |
| Free satellite tiers are often non-commercial. | Satellite imagery is the hardest layer to get free *and* commercial. Treat it as a cost line item needing approval (Section 5). |

---

# 4. Technology and the Phase 0 map-engine decision

## 4.1 Stack (defaults except the map engine)

| Area | Default | Notes |
| --- | --- | --- |
| Mobile | React Native + TypeScript, Expo Development Builds | Not Expo Go (native map modules). **VERIFY** SDK compatibility. |
| Map engine | **Decided in Phase 0** (4.2) | |
| Base map | OpenStreetMap vector tiles, OpenMapTiles-compatible style, contours | **VERIFY** provider terms/attribution; self-hosting an Israel extract is an option. |
| Terrain (DEM) | Terrarium tiles | Prototype: AWS tiles. Production: self-hosted or approved provider. |
| Satellite | Licensed provider | Needs cost/licence approval. |
| Routing | BRouter or Valhalla, hiking/pedestrian profile, on an OSM Israel extract | Needs a small server; cost approval. |
| Backend | Supabase (Auth, Postgres + PostGIS, Edge Functions) | **VERIFY** free-tier limits (e.g. inactivity pausing). |
| Local storage | SQLite (or MMKV for settings) | **VERIFY** Expo compatibility. |
| Charts | RN-compatible, with touch-drag interaction | **VERIFY** maintenance. |
| Tests | Jest + React Native Testing Library | |

## 4.2 Phase 0 map-engine spike (time-box: about 5 working days total)

Build the same minimal prototype with each candidate, in this order, and record results:

| Option | What it is | Expected strengths | Expected risks |
| --- | --- | --- | --- |
| **A. Mapbox via `@rnmapbox/maps`** | Official Mapbox native SDK through a community wrapper | Native 3D terrain, tilt, bundled satellite, good performance | Proprietary, MAU pricing, token/ToS limits on custom sources |
| **B. MapLibre GL JS in a WebView** | Web map inside the app | Open source, proven 3D terrain, any tile source | Gesture/performance overhead, harder offline, bridge complexity |
| **C. MapLibre Native terrain build** | Community build of `feature/terrain-3d` via MapLibre RN | Open source, native performance | Experimental, forks may lag, integration and maintenance risk |

**Prototype for each:** 3D terrain from a `raster-dem` source, tilt and rotate, open-map layer, satellite layer,
switch layers keeping camera, draw a line by tapping, sample elevation along it, show a basic profile.

**Measure on a physical mid-range Android phone (and an iPhone if available):** sustained FPS while rotating and
tilting, cold start to first map, memory if measurable, layer-switch time, crashes, and integration effort.

**Decision rule:**
1. Discard any option that fails to render 3D terrain stably on a physical device.
2. Among the rest, prefer the option with the **lowest long-term risk to the product**, in this order:
   (a) meets the FPS target, (b) fits the budget including satellite, (c) licence allows commercial use of
   the data sources we need, (d) least custom native code to maintain, (e) openness.
3. If two options tie, choose the simpler one (A or B over C).
4. Record the decision, numbers, and rejected alternatives in `DECISIONS.md`, and keep the map behind `MapProvider`.
5. If the winner has a cost or lock-in implication, obtain product-owner approval before Phase 1.

---

# 5. Data-source register (starting point — complete and verify each row)

For every source record: provider/product · origin · licence and commercial-use permission · attribution text and
placement · rate limits · caching rules · offline restrictions · dev and production cost · date checked · link.

| Source | Use | Known status (2026-10-31) | Action |
| --- | --- | --- | --- |
| OpenStreetMap data | Base map, trails, routing graph | ODbL; attribution "© OpenStreetMap contributors" required | Use Geofabrik Israel extract for routing; plan refresh cadence (e.g. monthly) |
| AWS Terrarium tiles | DEM (prototype) | Free, keyless, no production guarantee | Prototype only |
| Mapterhorn / self-hosted DEM | DEM (production candidate) | Open; up to z12 globally | VERIFY licence and quality over Israel |
| Satellite imagery | Satellite layer | Provider and cost undecided | Needs approval (A: bundled with Mapbox MAU billing? VERIFY) |
| Israel Hiking Map tiles | — | Non-commercial only | **Do not use** |
| Public map demo servers (e.g. demo tile servers in docs) | — | Not for production | Do not use |

---

# 6. Architecture

## 6.1 Layers
- **Mobile app:** map rendering, camera, layers, attribution, route editing, waypoints, stats and profile UI,
  auth UI, route library, GPX file selection/sharing, local drafts, localization, accessibility.
- **Backend:** auth integration, route persistence, sync, ownership enforcement, routing proxy, elevation sampling,
  GPX processing where server-side is appropriate.
- **Geographic data services:** base tiles, DEM tiles, satellite imagery, trail data, snapping engine.
- **Core geo library (pure TypeScript, no UI/network imports):** coordinate validation, geodesic distance,
  geometry normalization, elevation interpolation/smoothing, ascent/descent, duration, GPX parse/serialize.
  Do not duplicate this logic in components or backend handlers; share it between app and backend if practical.

## 6.2 Provider interfaces (keep provider SDK calls out of business logic and UI)
`MapProvider`, `TerrainProvider`, `SatelliteProvider`, `RoutingProvider`, `ElevationProvider`, `StorageProvider`.

## 6.3 Suggested repository layout
```
/app            React Native app (screens, components, navigation, i18n)
/packages/geo   Pure TS: distance, elevation stats, duration, gpx, geometry (100% unit-tested)
/packages/editor  Route editing state: commands, undo/redo, segment cache, stale-response guard
/services       Provider implementations behind interfaces
/supabase       SQL migrations, RLS policies, edge functions
/docs           README, DECISIONS, PROGRESS, reference-route fixtures (GPX)
```

---

# 7. Data model

Coordinates: GeoJSON order `[longitude, latitude, elevation_m]`. Never swap. Distances in metres internally;
convert only for display.

**Route:** `id, user_id, name, description, geometry (LineString Z, SRID 4326), distance_m, ascent_m, descent_m,
min_elev_m, max_elev_m, estimated_duration_s, elevation_source (text, e.g. "terrarium z13"), stats_version,
created_at, updated_at, deleted_at`.

**RouteVertex** (user control points, ordered): `id, route_id, vertex_index, longitude, latitude, mode`.
`mode` ∈ {`snap`,`free`} describes the segment **ending at this vertex**; vertex 0 has `mode = NULL`.

**RouteSegment** (new in v2): `id, route_id, segment_index, from_vertex_index, to_vertex_index, mode, geometry`.
Segment *i* connects vertex *i* and vertex *i+1*. The full `Route.geometry` is the concatenation of segment
geometries (without duplicating joint points). Store segments so a saved route can be edited without re-routing
every segment.

**Waypoint:** `id, route_id, longitude, latitude, elevation_m, name, note`.

Rules: persist control points, segments, and the full geometry. Never reconstruct control points from geometry.
Waypoints are independent of segments. **Reverse** (Section 8.4) must update `mode` semantics correctly.

---

# 8. Functional requirements

## 8.1 Map
Pan, zoom, rotate, tilt; 3D terrain with adjustable exaggeration (default 1.0–1.5; readability over drama);
Open Map and Satellite layers, switching preserves camera and current route; user location only when permission
is granted, with a center-on-me button; remembered layer preference; visible, correct attribution for every source.
Location is requested only when the user invokes a location feature and stops when the map is inactive. No
background GPS.

**Open Map style** (where data exists): roads, hiking trails and paths (visually distinguishing marked trails),
water/features, contour lines, Hebrew and English labels.

## 8.2 Route builder (primary feature)
- **Plan Route** enters editing mode with toolbar, route line, control points, live stats panel.
- **Add point (tap):** add control point; immediately draw a provisional dashed segment from the previous point;
  in Snap mode request a hiking route and replace the provisional line when it succeeds; never block the UI.
- **Snap mode (default):** pedestrian/hiking profile; prefer trails/paths. Never claim the route is safe,
  open, or legal because the router returned it.
- **Free mode:** straight line; applies to newly created segments; existing segments keep their mode unless
  the user changes it.
- **Routing failure:** keep provisional line, show a clear error, offer "use Free mode for this segment".
  **Never silently convert a failed snapped segment to a straight line.**
- **Edit:** drag a point, insert a point into a segment (drag from segment midpoint), select, delete; recompute
  only affected adjacent segments.
- **Undo/redo:** unlimited per session over add/move/insert/delete point, change segment mode, reverse,
  close loop, waypoint add/edit/delete. Use a command model (Section 9.3).
- **Reverse:** see 8.4. **Close loop:** add a segment from the last point to the first using the selected mode;
  invoking it again must not add a duplicate.
- **Waypoints:** long press creates one (name, note, position, elevation).
- **Save:** name required for cloud save; description optional; auto-save a local draft while editing; recover
  after interruption/restart; never discard unsaved changes without confirmation; clearly distinguish a local
  draft from a cloud-saved route.
- **Async safety:** routing and elevation responses can arrive out of order. Tag each request with the edit
  version/segment inputs that created it; ignore stale responses; a late response must never overwrite a newer
  edit; cancel obsolete requests where possible (Section 9.4).

## 8.3 Elevation statistics and profile
All stats derive from the final route geometry and a documented DEM (record source and zoom/resolution).
- **Distance:** sum of geodesic segment lengths.
- **Elevation sampling:** every ~10–25 m along the route, interpolated bilinearly from DEM pixels. Define
  missing/invalid handling (Section 9.1).
- **Ascent/descent, min/max:** Section 9.1.
- **Duration:** one centralized, unit-tested function (Section 9.2), labelled as an estimate.
- **Elevation profile:** x = cumulative distance, y = elevation. Dragging on the chart moves a marker on the
  map; moving the map marker updates the chart; show selected distance and elevation. Gradient colouring optional.
- **Display limits:** state that values come from a global DEM and can differ from GPS or barometer readings.

## 8.4 Reverse semantics (must be exact)
For vertices `v0..vn` with `mode_i` (segment ending at `v_i`, `i ≥ 1`):
after reversal the new vertex order is `vn..v0`; new vertex at position `j` gets mode = old `mode_{n-j}`
(the segment that connects it to its predecessor in the new order), position 0 gets `NULL`. Reverse each
segment's geometry array; do not re-request routes. Waypoints keep their positions and metadata.
Add a unit test with a mixed snap/free route.

## 8.5 Accounts, library, sync
- Email sign-up, login, logout, password recovery. Add Apple/Google sign-in only if required by store policy
  (**VERIFY**) or approved.
- **My Routes:** name, distance, ascent, last modified, optional thumbnail; open, edit, export, delete,
  search by name, sort by modified date.
- **Sync:** `updated_at` tracking; last-write-wins is acceptable for MVP but keep sync isolated for later
  conflict handling; an old local draft must never silently overwrite a newer cloud route (show a choice).
- **Soft delete** with undo; sync must not resurrect deleted routes; define a purge policy before production.
- **Security:** private by default; ownership enforced in the database (Postgres Row Level Security), never
  only in the client. Test that user A cannot read, update, or delete user B's routes.

## 8.6 GPX
- **Import:** tracks, routes, waypoints, elevation if present. If elevation is missing, sample the DEM.
  Result is an **editable draft**; do not auto-save permanently. Imported tracks have no user control points:
  create simplified control points (e.g. Douglas–Peucker) in `free` mode and tell the user. Validate
  malformed, oversized, or unsupported files with actionable errors.
- **Export:** GPX 1.1 with name, track points (lon/lat/ele), waypoints with names/notes. Verify in at least one
  independent third-party app.

---

# 9. Algorithms (implement once, in `packages/geo` / `packages/editor`)

## 9.1 Ascent and descent (hysteresis, not per-step threshold)
```
inputs: samples[] at fixed step (10–25 m), elevations in metres (null = missing)
1. Fill short gaps (≤ 3 consecutive nulls) by linear interpolation; if longer, mark stats "incomplete"
   and report which stretch is missing. Never treat null as 0.
2. Smooth: centred moving average (window ≈ 60–100 m of path, odd number of samples); keep endpoints.
3. Hysteresis with threshold T (default 3 m, configurable):
     anchor = e[0]; ascent = descent = 0
     for each e[i]:
        if e[i] - anchor >= T:  ascent  += e[i] - anchor; anchor = e[i]
        elif anchor - e[i] >= T: descent += anchor - e[i]; anchor = e[i]
        // otherwise keep waiting: small wiggles never accumulate, slow steady climbs do
     (finalize: add any remaining ≥ T movement to the correct total)
4. min/max from smoothed valid samples (also keep raw min/max for display if they differ materially).
```
Document sampling interval, window, T, interpolation, and missing-data policy next to the function. Do not tune
parameters to a single reference route.

## 9.2 Duration
Default Naismith: 5 km/h horizontal + 1 hour per 600 m of ascent (ignore descent). Optionally compare with a
Tobler hiking function. Single function, unit-tested, labelled "estimate", assumptions documented.

## 9.3 Editing state: command pattern
Each user action is a command `{ apply(state), invert(state) }` pushed on an undo stack (redo stack cleared on
new commands). Keep a **segment cache** keyed by `(fromLonLat, toLonLat, mode, profile)` so undo/redo restores
geometry without new routing calls. Avoid storing full-route snapshots per step.

## 9.4 Stale-response guard
Each pending segment gets `requestKey = hash(from, to, mode, profile)` and a monotonically increasing `seq`.
When a response arrives, apply it only if a segment with the same `requestKey` still exists and has not been
superseded; otherwise cache it (it may be useful after undo) but do not render it. Cancel in-flight requests for
removed segments.

---

# 10. Backend API (logical contract)

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/routes` | List current user's routes, paginated |
| POST | `/routes` | Create route (vertices, segments, geometry, waypoints) |
| GET | `/routes/{id}` | Retrieve route |
| PUT | `/routes/{id}` | Update route |
| DELETE | `/routes/{id}` | Soft-delete |
| POST | `/routing/snap` | Snapped segment between two points |
| POST | `/elevation/sample` | Elevation along a line |
| POST | `/routes/import-gpx` | Parse GPX into a draft |
| GET | `/routes/{id}/export.gpx` | Export GPX |

Authenticated and ownership-enforced, except documented on-device operations. If the backend (e.g. Supabase)
makes custom endpoints unnecessary, document the equivalent. Add rate limiting and request-size limits on
`/routing/snap`, `/elevation/sample` and GPX import.

```json
// POST /routing/snap
{ "from": { "lon": 35.2, "lat": 31.7 }, "to": { "lon": 35.3, "lat": 31.8 }, "profile": "hiking" }
// POST /elevation/sample
{ "line": [[35.2, 31.7], [35.3, 31.8]], "step_m": 20 }
```
Responses: ordered geometry (snap) or ordered samples with elevation and explicit nulls (elevation), plus clear
error codes (e.g. `NO_PATH`, `OUT_OF_COVERAGE`, `RATE_LIMITED`).

---

# 11. Non-functional, localization, accessibility, privacy, safety

- **Performance:** ≥ 30 FPS 3D terrain on a representative mid-range phone (≈ last 4 years), measured on a
  physical device; route edit to updated stats < 1.5 s on a normal mobile connection for routes under 50 km
  where providers allow; never block the UI.
- **Reliability:** handle network loss, routing failure, missing elevation, expired auth, interruption while
  editing, invalid GPX, stale responses, partial sync failure.
- **Battery:** no background GPS; no polling; avoid repeated tile/API requests.
- **Localization:** Hebrew and English, no hardcoded strings, RTL verified for map controls, charts and sheets;
  localize dates, numbers, units.
- **Accessibility:** touch targets ≥ 44 pt, large system fonts, accessible labels on icon-only controls,
  sufficient contrast, never colour alone for modes/errors.
- **Privacy:** minimal permissions, explain location use, no unnecessary location history.
- **Safety notice** (show in an appropriate place):
  > Planned routes, terrain representations, elevation values, and duration estimates may be inaccurate. Always
  > assess actual terrain, weather, water availability, and local conditions before and during your hike. The
  > user is responsible for route selection and safety.

---

# 12. Roadmap and phase gates

**Rule:** complete and demonstrate each phase's criteria before the next. If a criterion fails, fix it or get
explicit written product-owner approval for a documented change.

## Phase 0 — Feasibility spike and map-engine decision (highest priority)
Build the prototype from Section 4.2 for options A, B, C (time-boxed). Measure and record FPS, load time,
memory, layer-switch behaviour, elevation latency, and integration effort.
- [ ] 3D terrain renders stably on a physical device in at least one option
- [ ] Tilt and rotation work; open-map and satellite layers both work; switching keeps camera state
- [ ] Elevation sampled along a drawn line; basic profile shown
- [ ] `raster-dem` encoding verified with a known-elevation test point
- [ ] Performance acceptable on the test device (numbers recorded)
- [ ] `DECISIONS.md` has: chosen engine and why, rejected options and why, DEM and satellite providers,
      licences, attribution, costs, unresolved issues; cost/lock-in approved by the owner
Do not proceed if the core map approach is unvalidated.

## Phase 1 — Foundations
Repo structure, TypeScript, lint/format, CI, env config, navigation, theming, i18n and RTL foundations.
- [ ] iOS and Android builds succeed in CI · [ ] app launches with an empty map screen
- [ ] no secrets committed · [ ] setup documented

## Phase 2 — Map experience
Layer switch, 3D/camera controls, location and center-on-me, attribution, remembered settings.
- [ ] all of Section 8.1 works on Android and iOS · [ ] permissions asked only when needed
- [ ] attributions visible and correct · [ ] preferences persist

## Phase 3 — Route builder
**3A local editing:** add/move/insert/delete, free mode, undo/redo, reverse, close loop, waypoints, local drafts.
**3B routing:** routing service (on an OSM Israel extract), hiking profile, snap mode, failure handling,
provisional geometry, stale-response protection.
- [ ] a 20-point route with snapped and free segments can be created and edited
- [ ] undo/redo restore exact prior states · [ ] reverse test with mixed modes passes
- [ ] routing failure never silently becomes free mode · [ ] late responses cannot overwrite newer edits
- [ ] draft survives app restart

## Phase 4 — Elevation and statistics
DEM sampling service, distance, interpolation, smoothing, hysteresis ascent/descent, min/max, duration, interactive
profile, map/profile marker sync.
- [ ] unit tests pass for all geo functions, including a gentle-long-climb case that a per-step threshold would miss
- [ ] three reference routes tested; **distance within ~3%** of the reference
- [ ] **ascent measured and compared with the reference; target within ~10%** for a ~30 m DEM (tighter only if
      a higher-resolution DEM is adopted). Record each difference and its likely cause; do not tune to fit.
- [ ] chart and map markers stay synchronized

## Phase 5 — Accounts and cloud storage
Auth, schema (including `RouteSegment`), RLS, CRUD, My Routes, search/sort, sync, draft recovery.
- [ ] route saved on one device opens identically on another (control points, segments, waypoints preserved)
- [ ] user A cannot read/update/delete user B's routes (automated test)
- [ ] soft delete and undo work · [ ] old drafts cannot silently overwrite newer cloud data

## Phase 6 — GPX import/export
- [ ] third-party GPX imports correctly · [ ] missing elevations handled per spec · [ ] waypoints preserved
- [ ] exported GPX opens in a third-party app with correct geometry and elevations

## Phase 7 — Hardening and release
Error/loading/empty states, performance and battery checks, accessibility checks, crash reporting, privacy policy,
store requirements, beta test with hikers in Israel.
- [ ] no known critical crash · [ ] all MVP journeys work on both platforms
- [ ] performance results recorded · [ ] privacy, attribution and data licensing satisfied · [ ] store checklists done

## Phase 8 — Optional future: offline support
Not part of the MVP. Verify each provider's caching and offline rights first.

---

# 13. Testing strategy

**Unit:** geodesic distance; coordinate order and validation; date-line and pole handling; interpolation;
smoothing; hysteresis ascent/descent (including gentle long climb, noisy flat, sawtooth); duration; reverse;
undo/redo; stale-response guard; GPX parse and serialize.
**Integration:** routing wrapper; elevation sampling; route create/update; auth; RLS and ownership; sync
behaviour; GPX flow.
**Manual device tests:** one low/mid-range Android phone and one iPhone; weak signal, network loss, airplane
mode, long routes, many control points, rapid edits, interrupted editing, expired login, large system font,
Hebrew RTL.
**Reference routes:** keep three (published distance and ascent, GPX fixture, DEM source/resolution, settings,
tolerance, source of the reference). Do not compare statistics across data sources without documenting
the differences.

---

# 14. Known AI pitfalls — check these explicitly

1. **Coordinate order:** GeoJSON/MapLibre/Mapbox use `[lon, lat]`; many UIs and GPX attributes use lat/lon.
2. **DEM encoding:** `terrarium` vs `mapbox` — declare explicitly; test with a known peak or sea-level point.
3. **Elevation decoding:** Terrarium: `elevation = (R*256 + G + B/256) - 32768`. Mapbox: `-10000 + (R*65536 + G*256 + B)*0.1`.
4. **Per-step ascent thresholds** lose gentle climbs — use the hysteresis algorithm.
5. **Expo Go** cannot run native map modules — use Development Builds.
6. **Stale async responses** overwriting newer edits.
7. **Silent fallbacks** (router failure → straight line) are forbidden.
8. **RTL:** icons, chart axes, sheets, and text alignment must be tested in Hebrew.
9. **Simulator performance** says nothing about 3D terrain performance.
10. **Attribution** is required for OSM, DEM and imagery providers; missing attribution is a licence breach.
11. **Don't claim done:** never mark criteria passed without running them.
12. **Don't add out-of-scope features** or reuse provider endpoints not approved in the data-source register.

---

# 15. MVP definition of done
A user can: open the app; navigate a 3D terrain map; switch open map and satellite; create a route with snapped
and free segments; edit, reverse and close it; add waypoints; view distance, ascent, descent, min/max elevation
and an estimated duration; interact with the elevation profile; save to a personal account; open it on another
device; import a third-party GPX; export GPX; and recover an interrupted draft — on both iOS and Android, while
meeting performance, privacy, security, attribution, and licensing requirements.

**Product rule:** build a reliable, useful hiking route planner before attempting a broad outdoor platform.

---

# 16. First instruction to the coding agent
Start with **Phase 0 only**. Do not build the full application.
1. Inspect the repository and environment.
2. Read current official docs for Expo, `@rnmapbox/maps`, MapLibre (GL JS and Native terrain status), and the
   candidate DEM/tile/satellite providers.
3. Propose the smallest physical-device prototype for options A, B, C and the test plan.
4. List required API keys and estimated costs; ask for approval before using anything paid.
5. Create or update `DECISIONS.md` with findings and open questions.
6. Implement only the prototypes; test on a physical device.
7. Report results against every Phase 0 criterion and recommend one engine using the decision rule.
If a required capability cannot be verified, stop and report the blocker.
