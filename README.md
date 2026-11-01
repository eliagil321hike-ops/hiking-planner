# Hiking Route Planner (personal, Android only)

Personal, private, non-commercial hiking route planner with a free 3D topographic map of Israel.
The authoritative brief is [`SPEC.md`](SPEC.md) (v3.2). Its Personal-Use Profile (P1–P10) overrides the rest.

**Current phase: Phase 0 (feasibility spike and map-engine decision).** See [`PROGRESS.md`](PROGRESS.md).

## Repository layout
```
SPEC.md                 Specification (source of truth)
DECISIONS.md            Decisions, data-source register, licences, open questions
PROGRESS.md             Current phase, tasks, test results, blockers, next task
packages/geo            Pure TypeScript geo logic (no UI, no network), unit-tested with node:test
app/styles/topo3d.json  The Topo3D MapLibre style (shared by all engine prototypes)
prototypes/b-webview    Option B: MapLibre GL JS + maplibre-contour page (runs in Chrome / Android WebView)
prototypes/c-native     Option C: MapLibre Native terrain build (scaffold, built on the owner's computer)
prototypes/a-mapbox     Option A: @rnmapbox/maps (only if B and C fail)
scripts/                Data tools (live DEM encoding check, contour pipeline)
```

## Prerequisites
- Node.js 22.18+ (TypeScript type stripping is on by default; the geo package needs **no** npm install).
- For native prototypes (C, A) and APK builds: JDK 17, Android SDK, a USB-connected Android phone with
  USB debugging. Exact versions are recorded in `DECISIONS.md` once verified.

## Environment variables
See `.env.example`. Phase 0 options B and C need no keys.

## Commands
```bash
# Unit tests for the geo package (zero dependencies)
node --test packages/geo/test/

# Live DEM encoding check against real Mapterhorn tiles (needs internet access to tiles.mapterhorn.com)
node scripts/check-dem-encoding.ts
```
Prototype run instructions live in each `prototypes/*/README.md`.

## Attribution
© OpenMapTiles · © OpenStreetMap contributors · Mapterhorn and its per-region sources (see `DECISIONS.md`).
