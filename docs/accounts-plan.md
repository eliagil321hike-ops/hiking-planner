# Accounts and cloud storage (SPEC-WEB W9): stage A analysis and plan

Status: stage A only, no code changed. Written 2026-11-16 against main 7b6bb85. Waiting for the owner's approval
of this plan (and the open decisions in section 6) before stage B.

## 1. How routes are stored today

| What | Where | Code |
| --- | --- | --- |
| Saved routes ("המסלולים שלי", D-056) | IndexedDB `topo3d-library` v2, store `routes` (keyPath `id`, index `folderId`) | library-store.js `idbAdapter` |
| Folders (D-056) | same DB, store `folders` | library-store.js |
| Personal points (D-064) | same DB, store `points` | library-store.js, used by markers.js |
| Route being edited (draft) | localStorage `topo3d.draft` = `editor.toDraft()`, written on every edit, restored on load | route.js `saveDraft/restoreDraft` |
| Its name, colour, link to the saved record, day split | localStorage `topo3d.routeMeta` = `{ name, color, savedId, savedSig, daySplits }` | route.js `getMeta/setMeta` |
| Settings, camera, panel folds | localStorage `topo3d.prefs` | prefs.js |
| Undo / redo | memory only (editor command stacks), never stored | packages/editor |

**Saved route record** (schema 1): `{ schema, id, userId:'local', createdAt, updatedAt, name, folderId, color,
editor: { version:1, state: { vertices:[{id,lon,lat,mode…}], waypoints:[…] }, cache: { routed segments } },
geometry: [[lon,lat]…], profile: [[lon,lat,distM,eleM|null]…] (every 20 m), stats, bbox, thumb (data URL),
daySplits?: { version:1, lodgings:[{lon,lat,name,source,custom,manual}] } }`.

**Flow.** Saving is manual only (owner rule). `r-save` → `library.saveFlow()` → `routeLib.snapshot()` (waits for
elevation figures) → dialog (update original / save as new, name, folder) → `lib.createRoute|updateRoute` →
`routeLib.markSaved`. Opening: library card → `openFlow` → `lib.getRoute` → `routeLib.openSaved(rec)` which loads
the editor state + cache and puts name, colour, `savedId`, `daySplits` into the meta. View mode (D-066) and edit
(D-066) go through the same `getRoute`. Delete is a confirmed hard delete. Signed-out "unsaved" guard:
`guardUnsaved → confirmUnsaved`.

**The seam already exists.** Every read and write goes through `createLibrary(adapter)` with a 4-method adapter
`{ all(store), get(store,id), put(store,obj), del(store,id) }` (idb + memory today). markers.js reaches points
only through `ctx.library.lib()`. So the cloud store can be added as one more adapter without touching the
planner's route object.

**Language / build.** Plain ES modules, no bundler. MapLibre is loaded from unpkg with a pinned version; the
editor/geo packages are TypeScript compiled into `site/vendor`. No CSP. Tests: node unit tests (64), editor
tests (18), Playwright e2e (`scripts/e2e_test.py`, ~155 checks), CI then Pages deploy.

## 2. Verified facts (2026-11-16)

- Firestore document limit **1 MiB (1,048,576 bytes)**; free quota (Spark) **1 GiB stored, 50,000 reads,
  20,000 writes, 20,000 deletes per day, 10 GiB/month egress** (firebase.google.com/docs/firestore/quotas).
  On Spark, operations past the quota are refused, never billed.
- Firestore (Standard edition) **arrays cannot contain arrays** – the current `geometry`/`profile` shape
  (`[[lon,lat]]`) cannot be stored as is.
- `signInWithRedirect` breaks on browsers that block third-party storage unless the auth helper is served from
  the app's own domain (Firebase "redirect best practices"); the documented alternative is `signInWithPopup`.
  GitHub Pages cannot proxy `/__/auth` under `/hiking-planner/`, so **popup is the method**; if a phone blocks
  the popup, the site says so (no redirect fallback). To be re-checked on the owner's phone in stage C.
- Firebase JS SDK current release 13.1.0 (2026-10-21); the version will be pinned (≥ 2 weeks old) in stage C.
- Firestore can be placed in **me-west1 (Tel Aviv)**; the location cannot be changed later.

## 3. Size measurement (synthetic, same formats as today)

1,000 km route, profile every 20 m (site rule) and an assumed routed density of 1 point / 25 m:

| Part | JSON | gzip |
| --- | --- | --- |
| geometry (40,001 points) | 0.91 MiB | 0.26 MiB |
| profile (50,001 rows) | 1.73 MiB | 0.50 MiB |
| editor cache (routed segments) | 0.94 MiB | 0.27 MiB |
| **whole route** | **3.64 MiB** | **1.04 MiB** |

Even compressed, a 1,000 km route is over the 1 MiB limit (and far over 70 %). **Decision proposed: chunking.**
Stage D repeats the measurement with a real long route built on the site and records it in DECISIONS.md.

## 4. Design

### 4.1 Data model (Firestore)

```
meta/userCount                       { count }
users/{uid}                          { displayName, avatarUrl, createdAt }
users/{uid}/routes/{routeId}         { name, description, folderId, color, stats, bbox, thumb, days (count),
                                       schemaVersion: 1, createdAt, updatedAt, deletedAt|null,
                                       rev, prevRev, chunks: n, bytes, sha256 }
users/{uid}/routes/{routeId}/chunks/{i}   { data: Bytes ≤ 700 KB, rev }
users/{uid}/folders/{folderId}       { name, createdAt, updatedAt }        (if decision 6.1 = yes)
users/{uid}/points/{pointId}         { name, icon, lon, lat, ele, source, createdAt, updatedAt }   (idem)
```

- `routeData` = the planner's record exactly as today (editor + cache, geometry, profile, daySplits …),
  `JSON.stringify` → gzip (`CompressionStream`, built into the browser) → split into ≤ 700 KB `Bytes` chunks.
  The route document keeps only what the list needs (name, stats, thumb…), so "My routes" reads 1 document per
  route, and the full route is read only when opened.
- Route + all its chunks are written in **one batched write** (atomic: never half a route). Reading checks the
  chunk count and the SHA-256; any mismatch is an error, never a truncated route. A route that would need more
  than 12 chunks (≈ 8 MiB compressed) is refused with a clear message before anything is written.
- `routeId` is generated in the browser before the first write, so a double click cannot create two routes.

### 4.2 Storage adapter

One interface used by the planner (as asked): `list / get / create / update / softDelete` (+ `restore` for
undo), implemented by:
- `firestoreStore` (signed in) – new file `site/cloud-store.js`; converts to/from the stored form (4.1).
- the existing IndexedDB store, kept **read-only** for migration and for decision 6.3.

Inside, it plugs into the existing `createLibrary(adapter)` seam so library.js / markers.js keep their calls.

### 4.3 Conflicts and offline

- Firestore's offline cache (`persistentLocalCache`, multi-tab) is turned on: the last loaded routes open
  without reception.
- **Compare-and-set in the rules:** every update carries `prevRev` = the `rev` it was loaded with, and the rules
  accept it only if `prevRev == resource.data.rev`. So even a save queued offline cannot overwrite a newer copy:
  the server rejects it, and the site then offers "keep mine / take the newer one / save as a copy".
- A save made offline is shown as "not synced yet" (Firestore `hasPendingWrites`) until the server confirms.
  Unsaved work also stays in the existing browser draft until then: edits are never lost.

### 4.4 Sign-in and the cap

- Google via `signInWithPopup`; session kept with the SDK's local persistence (reload keeps it). The UI shows
  "signed in" only after `onAuthStateChanged` gives a user **and** the profile read succeeds.
- First sign-in: one batched write creates `users/{uid}` and sets `meta/userCount.count + 1`. The rules
  (`getAfter`) allow it only if the counter goes up by exactly 1 and stays ≤ N (N = 10, one constant in the
  rules and the same constant in `site/cloud-config.js`). Account deletion: `−1` only together with removing
  the profile. Users past the cap stay signed in to Google, see "the group is full", and plan / export GPX as
  before.

### 4.5 Security rules (stage B, `firestore.rules`)

Only `request.auth.uid == uid` reads/writes `users/{uid}/**`; owner fields cannot change; known fields only with
types and sizes checked; `createdAt` fixed after create; `updatedAt == request.time`; compare-and-set as in 4.3;
counter rules as in 4.4; nothing else readable or writable. Tested with the Firebase emulator (two test users,
isolation, owner change, cap, counter abuse, stale update) in a new CI job.

### 4.6 Firebase SDK loading

Pinned ES modules from `https://www.gstatic.com/firebasejs/<version>/…` (like MapLibre from unpkg today), loaded
**only when the user signs in or was signed in before**, so a signed-out visit loads nothing new.

## 5. Files I expect to touch

New: `site/cloud-config.js` (public web config + N), `site/cloud.js` (auth, user area, menu, privacy notice,
account deletion), `site/cloud-store.js` (adapter, chunking, conflict), `site/migrate.js` (upload of browser
routes with read-back check), `firestore.rules`, `firestore.indexes.json`, `firebase.json` (emulator only),
`tests/rules/*.test.mjs`, `tests/cloud-store.test.mjs`, README.md section "Accounts setup".

Touched existing (hooks only, listed again in PROGRESS when done):
- `site/index.html` – the user area (sign-in button / avatar) in the top bar, one script tag.
- `site/library.js` – choose the adapter by sign-in state; save offers sign-in when signed out; description
  field in the save dialog; undo toast for delete; conflict dialog; "not synced" mark on cards.
- `site/library-store.js` – `softDelete/restore`, `description`, `rev/prevRev` passed to the adapter.
- `site/app.js` – start `cloud.js`.
- `site/i18n.js` – new Hebrew strings. `site/style.css` – new section only (reusing existing tokens/classes).
- `scripts/e2e_test.py` – existing library checks run against the Firestore emulator (signed in with emulator
  test users); new checks for the acceptance list.
- `.github/workflows/pages.yml` – one new step/job: rules tests on the emulator (Java + firebase-tools).
- DECISIONS.md, PROGRESS.md, SPEC-WEB.md (copy W9 into the repo, it is only in the project copy today).

Not touched: map, layers, routing, editor package, days, profile, GPX, phone layout.

## 6. Open decisions for the owner (before stage B)

1. **Folders and personal points.** They live in the same browser database as routes. If only routes move to
   the account, signing in hides folders and points. Proposal: move them too (same rules, same migration).
2. **The existing "המסלולים שלי" panel** already has list, search, folders, sort, open / view / edit, duplicate,
   move, GPX and delete. Proposal: stage E = this panel on the account data (plus description, undo after
   delete, "not synced" mark, loading/empty/error states), not a second panel.
3. **Signed out.** W9: saving needs an account. What about routes already saved in this browser while signed
   out? Proposal: they stay visible read-only (open, view, GPX) with a "sign in to upload" note; no new saves.
4. **Delete.** Today: confirm dialog, then gone. Task: soft delete with 10 s undo. Proposal: keep the confirm
   dialog and add the undo toast; the document is removed for good after the 10 s (or at the next start, if the
   page was closed), so deleted routes do not use the free quota.
5. **Firestore location:** me-west1 (Tel Aviv) proposed (closest; cannot be changed later).
6. **N = 10** accounts – confirm.
