# Topo3D hiking route planner (website)

Non-commercial hiking route planner website with a free 3D topographic map of Israel, for the owner and a
few friends. Brief: [`SPEC.md`](SPEC.md) (v3.2) as overridden by [`SPEC-WEB.md`](SPEC-WEB.md) (v4, website).

**Current phase: Phase 0 (web).** See [`PROGRESS.md`](PROGRESS.md).

## Repository layout
```
SPEC.md                 Specification (source of truth)
DECISIONS.md            Decisions, data-source register, licences, open questions
PROGRESS.md             Current phase, tasks, test results, blockers, next task
packages/geo            Pure TypeScript geo logic (no UI, no network), unit-tested with node:test
site/                   The website (deployed to GitHub Pages as-is; no build step)
site/styles/topo3d.json The Topo3D style overlay
site/vendor/geo         packages/geo compiled to browser JS (tsc -p packages/geo/tsconfig.browser.json)
scripts/                browser smoke test, standalone single-file build
.github/workflows       Pages deploy (runs unit tests first)
```

## Prerequisites
- Node.js 22.18+ (TypeScript type stripping is on by default; the geo package needs **no** npm install).
- A modern desktop browser (Chrome/Edge). The site loads MapLibre and tiles from the internet.

## Environment variables
See `.env.example`. No keys are needed.

## Commands
```bash
# Unit tests for the geo package (zero dependencies)
node --test packages/geo/test/

# Rebuild browser copy of the geo package after changing packages/geo
/path/to/tsc -p packages/geo/tsconfig.browser.json

# Browser smoke test (headless Chromium, synthetic DEM tiles)
python3 scripts/browser_smoke_test.py

# Run locally: any static server with site/ as root, e.g.
python3 -m http.server 8080 --directory site
```
The live encoding check is the "בדיקת קידוד" button on the site. See `site/README.md`.

## Attribution
© OpenMapTiles · © OpenStreetMap contributors · Mapterhorn and its per-region sources (see `DECISIONS.md`).
