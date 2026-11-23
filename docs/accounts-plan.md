# Cloud storage for one owner (SPEC-WEB W10): plan for step A2

Revised 2026-11-23 for **W10: one personal app, the owner only, on the computer and the phone with the same
routes**. W10 overrides W1, W2, the W8 exception and the multi-user parts of W9. Earlier version (multi-user,
stage A/B of 2026-11-16): branch `wip/accounts`, `docs/accounts-plan.md` there. **Everything below is step A2
and is not built yet** (A1 = installable app on both devices; A3 offline maps; A4–A5 navigation; A6 offline
routing).

## 1. What changes from the multi-user plan

| Topic | Multi-user plan (2026-11-16) | W10 (one owner) |
| --- | --- | --- |
| Who can sign in and save | anyone with Google, up to N = 10 | **only the owner's Firebase uid**, hard-coded in the rules |
| Sign-up, cap, `meta/userCount` | profile + counter in one batch, ≤ N | **removed** (no counter, no cap, no "group full") |
| Friends' privacy notice, account deletion | required | **removed** (the owner's own data) |
| Sign-in on the phone | popup in the browser | **native Google sign-in in the APK** (section 4) |
| Sign-in on the computer | popup | popup (website and installed desktop app, unchanged) |

Kept from the earlier plan (owner decisions of 2026-11-16 still apply): Firestore offline persistence; full
route stored as gzip JSON in ≤ 700 KB chunks; compare-and-set on every update (`rev` = stored `rev` + 1);
migration of browser routes with a read-back check, never deleting local data automatically; folders and
personal points in the cloud; the existing "המסלולים שלי" panel; delete = confirm + 10-second undo; location
**me-west1 (Tel Aviv)**; Firebase Spark plan only, no billing.

## 2. How routes are stored today (unchanged, from the stage A analysis)

| What | Where | Code |
| --- | --- | --- |
| Saved routes, folders, personal points | IndexedDB `topo3d-library` v2 (stores `routes`, `folders`, `points`) | site/library-store.js |
| Route being edited (draft) | localStorage `topo3d.draft` | site/route.js |
| Its name, colour, saved id, day split | localStorage `topo3d.routeMeta` | site/route.js |
| Settings, camera, panel folds | localStorage `topo3d.prefs` | site/prefs.js |

Every read and write already goes through `createLibrary(adapter)` with a 4-method adapter
(`all/get/put/del`); markers.js reaches points only through it. The cloud store plugs in there.

## 3. Data model and rules (A2)

```
users/{OWNER_UID}                               { displayName, avatarUrl, createdAt }
users/{OWNER_UID}/routes/{routeId}              header: name, description, folderId, color, stats, bbox,
                                                thumb, days, schemaVersion: 1, createdAt, updatedAt,
                                                deletedAt|null, rev, chunks, bytes, sha256
users/{OWNER_UID}/routes/{routeId}/chunks/{i}   { data: Bytes ≤ 700 KB, rev }
users/{OWNER_UID}/folders/{folderId}            { name, createdAt, updatedAt }
users/{OWNER_UID}/points/{pointId}              { name, icon, lon, lat, ele, source, createdAt, updatedAt }
```

Rules (rewrite of `firebase/firestore.rules` from `wip/accounts`):
- `function isOwner() { return request.auth != null && request.auth.uid == 'OWNER_UID'; }` – the uid is
  hard-coded (copied from Authentication → Users after the owner's first sign-in). Everything else denied.
- Path check kept (`uid == request.auth.uid`), field validation kept (known fields, types, sizes),
  `updatedAt == request.time`, `createdAt` fixed, `rev == stored rev + 1`, chunks only with their header and
  the same `rev`.
- Removed: `meta/userCount`, `maxUsers()`, profile-with-counter batch.
- Tests on the emulator (CI workflow `rules.yml`, already working): owner can do everything; any other
  signed-in user and signed-out callers can read and write nothing; stale update refused; field checks;
  chunks. The mutation check is repeated.
- Firebase Authentication: optionally **block other Google accounts at sign-in** too. Without Cloud
  Functions (paid) the simplest guard is the rules; another person could still create an *auth* record by
  signing in, but can read or write nothing. The site signs such a user out with a message.

Size (measured 2026-11-16, synthetic): a 1,000 km route is 3.64 MiB JSON / 1.04 MiB gzip → chunking needed
(Firestore document limit 1 MiB). A real long route is measured in A2.

## 4. Sign-in on each device

**Computer (website and installed desktop app):** `signInWithPopup` with the Firebase web SDK, as planned.
`signInWithRedirect` needs the auth helper on the site's own domain, which GitHub Pages under
`/hiking-planner/` cannot provide.

**Phone (APK):** Google blocks its OAuth pages inside embedded WebViews (`disallowed_useragent`): announced
2021-06-29, enforced from 2021-09-30 (developers.googleblog.com, checked 2026-11-23). A Capacitor app *is* a
WebView, so the web popup cannot be used there. Plan:
- Plugin **`@capacitor-firebase/authentication`** (Capawesome, repo capawesome-team/capacitor-firebase;
  supports Capacitor 8 and the modular Firebase web SDK – checked 2026-11-23).
- Config `skipNativeAuth: true`, provider `google.com`: the plugin shows Android's native Google account
  picker and returns the Google ID token; the site then calls the web SDK's
  `signInWithCredential(GoogleAuthProvider.credential(idToken))`, so Firestore (web SDK) runs signed in exactly
  as on the computer. This is the plugin's documented way to use it with the Firebase JS SDK.
- Needs: an **Android app registered in the same Firebase project** (package name of the APK, SHA-1 and
  SHA-256 of the release signing key) and `google-services.json` in the Android project (public config, may
  be committed; not a secret).
- **VERIFY in A2** (with dates): plugin version ≥ 2 weeks old and its licence (read from npm in CI), its
  peer `firebase` version vs. the web SDK version the site loads, and that it is still maintained.

## 5. Files expected in A2

New: `site/cloud-config.js` (public web config, OWNER_UID), `site/cloud.js` (sign-in on both platforms, user
area), `site/cloud-store.js` (adapter, chunking, conflict), `site/migrate.js`, tests.
Hooks in existing files (to be listed in PROGRESS): `site/index.html` (user area), `site/library.js`,
`site/library-store.js`, `site/app.js`, `site/i18n.js`, `site/style.css` (new section only), e2e tests on the
Firestore emulator, `android/` (plugin, google-services.json).

## 6. Owner steps already done / still needed (A2)

- Done: Firebase project `topo3d-hiking` created (2026-11-17).
- Still needed in A2: enable Google sign-in, authorized domain `eliagil321hike-ops.github.io`, Firestore in
  me-west1 with the owner-only rules, web app config, Android app registration with the release key's
  SHA fingerprints (after the keystore exists, A1).
