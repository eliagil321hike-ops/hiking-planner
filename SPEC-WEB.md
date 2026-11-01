# SPEC addendum v4 — WEB PROFILE (owner decision 2026-11-01)

Overrides SPEC.md (v3.2) wherever they conflict, including P9 (Android only). Everything not changed here
(features, algorithms §9, data model §7 minus `user_id`, Topo3D P10, known AI pitfalls §14) stays.

## W1. Product form
- The product is a **website** (static web app), not an Android app. No APK, no Expo, no React Native.
- **Desktop browser first.** Phone browsers are a later step (layout must not block them, but no phone
  gates in the current phases).

## W2. Users
- **The owner and a few friends.** No accounts, no sign-in: each person's routes live in their own browser.
- Sharing with friends triggers SPEC P8 partly: every data source must allow use by a small group, not
  just "private personal use". Non-commercial sources are still acceptable (no commercial use), but
  **personal-use-only** sources are not, unless their terms explicitly allow this. Israel Hiking Map tiles
  stay out until their licence is verified.

## W3. Hosting
- **GitHub Pages**, deployed from the `site/` folder by `.github/workflows/pages.yml`.
- On GitHub Free, Pages requires a **public repository** (docs.github.com, checked 2026-11-01): the code is
  public; it must never contain secrets. Users' routes are never in the repo.

## W4. Storage
- Routes are saved **in the browser** (IndexedDB) with **GPX export/import** as backup and for moving
  between devices. No cloud database. SPEC Phase 5 becomes "browser storage".

## W5. Engine
- Options A and C (native Android) are dropped. The engine is **MapLibre GL JS** (Option B without the
  WebView). Phase 0 still validates rendering, contours, encoding and quality on the owner's computer, and
  the owner's FATMAP side-by-side review still decides whether the look is good enough.

## W6. Revised phases
0 Map feasibility on the live site (render, 3D, contours, encoding check, FPS on the owner's computer,
FATMAP review) · 1 Foundations (site structure, i18n Hebrew-first + RTL, CI tests, deploy) ·
2 Map experience · 3 Route builder (3A local, 3B routing: public BRouter only if its usage policy allows a
small group; otherwise self-hosted) · 4 Elevation and statistics · 5 Browser storage + GPX backup ·
6 GPX import/export · 7 Hardening · 8 Offline (later; service worker + cached region).

## W7. Phase 0 acceptance criteria (web)
- [ ] Site deployed on GitHub Pages and opens on the owner's computer
- [ ] 3D terrain renders stably; FPS recorded while rotating and tilting (target ≥ 30 FPS on the owner's computer)
- [ ] Hillshade and contours readable at zoom 12–16
- [ ] Encoding test on real tiles passes (Meron, coast, Dead Sea) and the negative control fails loudly
- [ ] Contour labels and trail lines legible when tilted
- [ ] Owner quality review vs ≥ 3 FATMAP screenshots, verdict recorded by the owner
- [ ] DECISIONS.md records engine, contour approach, hosting, attribution, licences for a small group

## W8. Satellite (owner decision 2026-11-01, reverses SPEC P10.1)
- A background switch Topo / Satellite. Satellite: best free quality and resolution.
- Default provider without account: EOX Sentinel-2 cloudless (10 m, CC BY-NC-SA 4.0, non-commercial).
- High-resolution providers (Esri World Imagery, Mapbox Satellite) need a key that each user types into
  the site; keys are stored only in that browser, never in the repository. Opening an account with
  billing beyond a free tier needs the owner's approval (SPEC 0.4).
- Exception (DECISIONS D-021, owner-approved): the owner's Esri public-application key (referrer-restricted,
  basemaps only, no payment method) is embedded in the site so friends get high-resolution imagery.
