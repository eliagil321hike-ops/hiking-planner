# Topo3D hiking route planner (website)

Non-commercial hiking route planner website with a free 3D topographic map of Israel and satellite
imagery, for the owner and a few friends. Live: https://eliagil321hike-ops.github.io/hiking-planner/

Brief: [`SPEC.md`](SPEC.md) (v3.2) as overridden by [`SPEC-WEB.md`](SPEC-WEB.md) (v4, website).
State of work: [`PROGRESS.md`](PROGRESS.md). Decisions, sources and licences: [`DECISIONS.md`](DECISIONS.md).

## Repository layout
```
site/                     The website, deployed to GitHub Pages as-is (no build step)
  index.html, style.css   Page and styles (Hebrew, right-to-left)
  app.js                  Entry: config, map, wiring
  i18n.js                 All user-facing text (Hebrew)
  layers.js               Layer switches, exaggeration
  background.js           Topographic / satellite switch
  satellite.js            Satellite providers (EOX, Esri, MapTiler)
  route.js, profile.js    Drawing a line, stats, elevation profile
  topo3d.js               Applies the Topo3D overlay on the OpenFreeMap base style
  dem-sampler.js          Elevation sampling with the shared Terrarium decoder
  devtools.js, perf.js    Phase 0 developer tests (only with ?dev=1)
  styles/topo3d.json      Topo3D overlay: DEM, contours, layers, sky, satellite providers
  vendor/geo/             packages/geo compiled to browser JavaScript (committed)
packages/geo/             Pure TypeScript geo logic (distance, DEM decoding, elevation stats, duration)
scripts/                  Tests (browser smoke, end-to-end) and the CI cache-busting stamp
firebase/                 Firestore security rules + their emulator tests (accounts, W9); not deployed with the site
docs/                     Plans and screenshots
.github/workflows/        Tests, then deploy site/ to GitHub Pages
```

## Commands
```bash
# Unit tests (zero dependencies, Node 22.18+)
cd packages/geo && node --test "test/**/*.test.ts"

# After changing packages/geo: rebuild the browser copy (TypeScript compiler)
tsc -p packages/geo/tsconfig.browser.json

# Browser tests (Python Playwright + Chromium + Pillow)
python3 scripts/browser_smoke_test.py   # decoder, sampler, profile, satellite config (synthetic tiles)
python3 scripts/e2e_test.py             # real MapLibre build, fixture style + DEM; downloads MapLibre once into .cache/

# Run locally
python3 -m http.server 8080 --directory site     # then open http://localhost:8080/
```
Add `?dev=1` to the URL for the developer tests (encoding check, DEM zoom, FPS, layer check, report).

## Deploy
Every push to `main` runs the tests and, if they pass, publishes `site/` to GitHub Pages
(`.github/workflows/pages.yml`). The build id shown in the panel header is the commit.

## Accounts setup (Firebase, SPEC-WEB W9)
Sign-in with Google and per-user storage use **Firebase on the free Spark plan** (Authentication + Cloud Firestore).
Plan and design: [`docs/accounts-plan.md`](docs/accounts-plan.md). Security rules: [`firebase/firestore.rules`](firebase/firestore.rules),
tested on the emulator by `.github/workflows/rules.yml` (`cd firebase && npm install && npm test` locally, needs Java 21).
The web config (apiKey etc.) is public by design and goes in the repo; the rules are the protection.
**Never link a billing account, never upgrade to Blaze, never put a service-account key in the repo.**

Steps for the owner (one time, about 30 minutes, signed in with the owner's Google account):

1. **Create the project.** https://console.firebase.google.com → *Create a project* → name `topo3d-hiking`
   (any name; the project ID shown under the name is used below as `PROJECT_ID`). Google Analytics: **off**.
   When it is ready, open ⚙ *Project settings* → *Usage and billing* → *Details & settings* and check that the
   plan is **Spark** and no billing account is linked. Ignore any offer to upgrade or of free credit.
2. **Turn on Google sign-in.** *Build → Authentication → Get started → Sign-in method → Google → Enable*.
   *Public-facing name*: `Topo3D`. *Support email*: the owner's address. *Save*.
   Then *Authentication → Settings → Authorized domains → Add domain*: `eliagil321hike-ops.github.io`
   (the domain only, without `/hiking-planner/`). `localhost` is already in the list; leave it for development.
3. **Consent screen** (what Google shows when someone signs in). https://console.cloud.google.com → choose the
   same project → *Google Auth Platform*.
   - *Branding*: App name `Topo3D`, user support email and developer contact = the owner's address.
     **Leave the logo empty** (a logo needs Google's brand verification).
   - *Audience*: User type **External**. Publishing status: press **Publish app** (In production). The site asks
     only for the basic scopes (name, email, profile picture), so no verification is needed.
   - *Data access*: add nothing.
4. **Create the database.** *Build → Firestore Database → Create database* → **Standard edition** → location
   **me-west1 (Tel Aviv)** (cannot be changed later) → start in **production mode**.
   - *Rules* tab: replace everything with the content of `firebase/firestore.rules` → *Publish*.
   - *Data* tab: *Start collection* → collection ID `meta` → document ID `userCount` → field `count`, type
     **number**, value `0` → *Save*. (The site never creates this document; without it nobody can sign up.)
5. **Register the website and restrict its key.**
   - ⚙ *Project settings → General → Your apps → Web (</>)* → nickname `site` → do **not** tick Firebase
     Hosting → *Register app*. Copy the `firebaseConfig` block shown (apiKey, authDomain, projectId,
     storageBucket, messagingSenderId, appId) and send it to Claude: it goes into `site/cloud-config.js`.
   - https://console.cloud.google.com → *APIs & Services → Credentials* → the key named
     *Browser key (auto created by Firebase)* → *Application restrictions*: **Websites** → add
     `https://eliagil321hike-ops.github.io/*` and `https://PROJECT_ID.firebaseapp.com/*` (the sign-in window
     runs there) → *Save*. Leave *API restrictions* as Firebase set them.
6. **Deploy and verify** (after stage C is approved): the site is published as usual by a push to `main`.
   Open the site, press *התחברות*, sign in, and check in the console that *Authentication → Users* shows the
   account and *Firestore → Data* shows `users/<uid>` and `meta/userCount.count = 1`.

The cap on accounts is `maxUsers()` in `firebase/firestore.rules` (10) and `MAX_USERS` in `site/cloud-config.js`;
change both and publish the rules again (step 4) to change it.

## Attribution
© OpenMapTiles · © OpenStreetMap contributors · OpenFreeMap · Mapterhorn (Israel: isr10, ASTER GDEM courtesy of
METI and NASA processed by 4cast LTD; global: Copernicus GLO-30) · satellite: Esri and its partners /
EOxCloudless (CC BY-NC-SA 4.0). Credits are shown in the map's attribution control.
