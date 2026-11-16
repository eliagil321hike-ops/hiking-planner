# SPEC addendum v4 — WEB PROFILE (owner decision 2026-11-01)

Overrides SPEC.md (v3.2) wherever they conflict, including P9 (Android only). Everything not changed here
(features, algorithms §9, data model §7 minus `user_id`, Topo3D P10, known AI pitfalls §14) stays.
**W9 (2026-11-16) overrides W2 and W4 where they conflict.**

## W1. Product form
- The product is a **website** (static web app), not an Android app. No APK, no Expo, no React Native.
- **Desktop browser first.** Phone browsers are a later step (layout must not block them, but no phone
  gates in the current phases).

## W2. Users  *(accounts part superseded by W9)*
- **The owner and a few friends.** ~~No accounts, no sign-in: each person's routes live in their own browser.~~
  → see W9: Google sign-in, routes saved in each user's account.
- Sharing with friends triggers SPEC P8 partly: every data source must allow use by a small group, not
  just "private personal use". Non-commercial sources are still acceptable (no commercial use), but
  **personal-use-only** sources are not, unless their terms explicitly allow this. Israel Hiking Map tiles
  stay out until their licence is verified.

## W3. Hosting
- **GitHub Pages**, deployed from the `site/` folder by `.github/workflows/pages.yml`.
- On GitHub Free, Pages requires a **public repository** (docs.github.com, checked 2026-11-01): the code is
  public; it must never contain secrets. Users' routes are never in the repo.

## W4. Storage  *(superseded by W9)*
- ~~Routes are saved in the browser (IndexedDB) with GPX export/import as backup and for moving between
  devices. No cloud database.~~ → see W9. GPX export/import stays as backup.

## W5. Engine
- Options A and C (native Android) are dropped. The engine is **MapLibre GL JS** (Option B without the
  WebView). Phase 0 still validates rendering, contours, encoding and quality on the owner's computer, and
  the owner's FATMAP side-by-side review still decides whether the look is good enough.

## W6. Revised phases
0 Map feasibility on the live site (render, 3D, contours, encoding check, FPS on the owner's computer,
FATMAP review) · 1 Foundations (site structure, i18n Hebrew-first + RTL, CI tests, deploy) ·
2 Map experience · 3 Route builder (3A local, 3B routing: public BRouter only if its usage policy allows a
small group; otherwise self-hosted) · 4 Elevation and statistics · 5 ~~Browser storage~~ **Accounts and
cloud storage (W9)** + GPX backup · 6 GPX import/export · 7 Hardening · 8 Offline (later; service worker +
cached region).

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

## W9. Accounts and cloud storage (owner decision 2026-11-16) — overrides W2 accounts and W4
- **Sign-in with Google.** An account is created automatically on first sign-in.
- **The account replaces browser storage** as the place where routes are saved. Signing in is needed to
  save; planning, viewing and GPX export work without signing in (the current work is kept temporarily in
  the browser until the user signs in and saves).
- **Existing browser routes:** on first sign-in the site offers to upload them to the account. Local data
  is never deleted automatically; the user may delete it only after a verified upload.
- **Provider: Firebase (Spark, no-cost plan)** — Authentication (Google) + Cloud Firestore, called from the
  static site; no own backend. Chosen over Supabase and Appwrite because their free plans pause a project
  after one week of inactivity (Appwrite also deletes paused free projects after 90 days), which would make
  saved routes unreachable before a trip. VERIFY current Spark quotas and Firestore limits before use.
- **User cap instead of an email allowlist:** a maximum number of accounts (owner sets N, default 10) so the
  project stays within the free plan. Users beyond the cap can sign in but cannot create a profile or save;
  the site tells them the group is full.
- **No billing:** the project stays on Spark. Moving to a paid plan needs the owner's approval (SPEC 0.4).
- **Privacy:** store only display name, avatar URL and the user's routes. Add a short privacy notice and a
  "delete my account and data" action (SPEC P8).
- Conflict rule: saving checks the route's `updatedAt`; an older copy never silently overwrites a newer one.
- GPX export/import remains the user's backup and must keep working without an account.
